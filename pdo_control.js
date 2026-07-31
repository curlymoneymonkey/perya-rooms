import { auth, db, waitForAuthState } from "./firebase.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const userForm = document.getElementById("pdoUserSearchForm");
const userInput = document.getElementById("pdoUserSearch");
const userButton = document.getElementById("pdoUserSearchButton");
const userMessage = document.getElementById("pdoUserMessage");
const userResult = document.getElementById("pdoUserResult");
const roomForm = document.getElementById("pdoRoomSearchForm");
const roomInput = document.getElementById("pdoRoomSearch");
const roomButton = document.getElementById("pdoRoomSearchButton");
const roomMessage = document.getElementById("pdoRoomMessage");
const roomResult = document.getElementById("pdoRoomResult");
const directoryBody = document.getElementById("pdoDirectoryBody");
const directorySearch = document.getElementById("pdoDirectorySearch");
const directorySort = document.getElementById("pdoDirectorySort");
const directoryRefresh = document.getElementById("pdoDirectoryRefresh");
const directoryMessage = document.getElementById("pdoDirectoryMessage");
const directoryRoleButtons = [...document.querySelectorAll("[data-directory-role]")];

let staffUser = null;
let isAdminUser = false;
let isHeadAdminUser = false;
let selectedUser = null;
let selectedRoom = null;
let adminReady = null;
let directoryAccounts = [];
let directoryRoleFilter = "all";

const clean = value => String(value || "").trim();
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));

function setMessage(node, text, error = false) {
  node.textContent = text;
  node.classList.toggle("error", error);
}

async function verifyStaff() {
  staffUser = await waitForAuthState();
  if (!staffUser || staffUser.isAnonymous) throw new Error("Please sign in first.");

  const [adminSnap, moderatorSnap] = await Promise.all([
    getDoc(doc(db, "admins", staffUser.uid)),
    getDoc(doc(db, "moderators", staffUser.uid))
  ]);

  isAdminUser = adminSnap.exists() && adminSnap.data().enabled === true;
  isHeadAdminUser = isAdminUser && adminSnap.data().role === "head-admin";
  const isModeratorUser = moderatorSnap.exists() && moderatorSnap.data().enabled === true;

  if (!isAdminUser && !isModeratorUser) {
    throw new Error("Staff access is required.");
  }
}

async function logAction(type, targetType, targetId, details) {
  await addDoc(collection(db, "activityLogs"), {
    type, targetType, targetId, details,
    staffUid: staffUser.uid,
    staffEmail: staffUser.email || "",
    createdAt: serverTimestamp()
  });
}

async function notifyUser(uid, title, message, type) {
  if (!uid) return;
  await addDoc(collection(db, "users", uid, "notifications"), {
    uid, title, message, type, read: false,
    createdBy: staffUser.uid,
    createdAt: serverTimestamp()
  });
}

async function readUserBundle(uid) {
  const [privateSnap, publicSnap] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "publicProfiles", uid))
  ]);

  if (!privateSnap.exists() && !publicSnap.exists()) return null;

  return {
    id: uid,
    ...(publicSnap.exists() ? publicSnap.data() : {}),
    ...(privateSnap.exists() ? privateSnap.data() : {})
  };
}

async function findUser(rawTerm) {
  const term = clean(rawTerm);
  const usernameTerm = term.replace(/^@/, "");
  const lower = usernameTerm.toLowerCase();

  // 1. UID lookup. This also works when only a public profile exists.
  const direct = await readUserBundle(term);
  if (direct) return direct;

  // 2. Username reservation is the most reliable username -> UID mapping.
  if (lower) {
    const usernameSnap = await getDoc(doc(db, "usernames", lower));
    if (usernameSnap.exists() && usernameSnap.data().uid) {
      const mapped = await readUserBundle(usernameSnap.data().uid);
      if (mapped) return mapped;
    }
  }

  // 3. Fallback for older accounts that may not have a username mapping.
  const usernameQueries = [
    query(collection(db, "users"), where("usernameLower", "==", lower), limit(1)),
    query(collection(db, "publicProfiles"), where("usernameLower", "==", lower), limit(1))
  ];

  for (const userQuery of usernameQueries) {
    const snap = await getDocs(userQuery);
    if (!snap.empty) {
      const bundled = await readUserBundle(snap.docs[0].id);
      if (bundled) return bundled;
    }
  }

  // 4. Email is private and is stored in users/{uid}.
  const emailCandidates = [...new Set([term, term.toLowerCase()])];
  for (const email of emailCandidates) {
    const snap = await getDocs(query(
      collection(db, "users"),
      where("email", "==", email),
      limit(1)
    ));
    if (!snap.empty) {
      const bundled = await readUserBundle(snap.docs[0].id);
      if (bundled) return bundled;
    }
  }

  return null;
}

async function userRole(uid) {
  const [adminSnap, modSnap, userSnap] = await Promise.all([
    getDoc(doc(db, "admins", uid)),
    getDoc(doc(db, "moderators", uid)),
    getDoc(doc(db, "users", uid))
  ]);

  if (adminSnap.exists() && adminSnap.data().enabled === true) {
    return adminSnap.data().role === "head-admin" ? "Head Administrator" : "Administrator";
  }
  if (modSnap.exists() && modSnap.data().enabled === true) return "Moderator";
  if (userSnap.exists() && userSnap.data().vip === true) return "VIP";
  return "User";
}

async function renderUser(user) {
  const role = await userRole(user.id);
  selectedUser = { ...user, role };
  const username = user.username || user.displayName || "Unknown";
  const photoURL = user.photoURL || "favicon.png";
  const targetIsHeadAdmin = role === "Head Administrator";
  const mayManageTarget = !targetIsHeadAdmin || isHeadAdminUser;
  const roleLocked = !mayManageTarget || (user.id === staffUser?.uid && targetIsHeadAdmin);
  const headAdminOption = isHeadAdminUser || targetIsHeadAdmin
    ? `<option value="Head Administrator" ${targetIsHeadAdmin ? "selected" : ""}>Head Administrator 👑</option>`
    : "";

  userResult.hidden = false;
  userResult.innerHTML = `
    <article class="control-result">
      <div class="result-head">
        <div class="user-result-identity">
          <img src="${esc(photoURL)}" alt="" class="user-result-avatar" onerror="this.src='favicon.png'">
          <div><h3>@${esc(username)}</h3><p>${esc(user.email || "No email stored")}</p></div>
        </div>
        <span class="pdo-badge">${esc(role)}${targetIsHeadAdmin ? " 👑" : ""}</span>
      </div>
      <dl class="result-details">
        <div><dt>UID</dt><dd>${esc(user.id)}</dd></div>
        <div><dt>Username</dt><dd>${esc(username)}</dd></div>
        <div><dt>Email</dt><dd>${esc(user.email || "Not stored")}</dd></div>
        <div><dt>Room ID</dt><dd>${esc(user.roomId || "None")}</dd></div>
      </dl>
      ${!mayManageTarget ? '<p class="pdo-message">This Head Administrator account is protected. Only a Head Administrator can change it.</p>' : ""}
      <div class="control-grid">
        <label><span>Role</span><select class="pdo-input" id="userRoleSelect" ${roleLocked ? "disabled" : ""}><option value="User" ${role === "User" ? "selected" : ""}>User</option><option value="VIP" ${role === "VIP" ? "selected" : ""}>VIP</option><option value="Moderator" ${role === "Moderator" ? "selected" : ""}>Moderator</option><option value="Administrator" ${role === "Administrator" ? "selected" : ""}>Administrator</option>${headAdminOption}</select></label>
        <label class="check-row"><input type="checkbox" id="userRollingRestricted" ${user.rollingRestricted === true ? "checked" : ""} ${!mayManageTarget ? "disabled" : ""}> Prevent rolling</label>
        <label class="check-row"><input type="checkbox" id="userReviewsRestricted" ${user.reviewsRestricted === true ? "checked" : ""} ${!mayManageTarget ? "disabled" : ""}> Prevent reviews</label>
        <label class="check-row"><input type="checkbox" id="userAccountSuspended" ${user.accountSuspended === true ? "checked" : ""} ${!mayManageTarget ? "disabled" : ""}> Suspend account</label>
        <label class="full"><span>Reason</span><textarea class="pdo-input" id="userRestrictionReason" maxlength="300" placeholder="Reason for this action" ${!mayManageTarget ? "disabled" : ""}>${esc(user.restrictionReason || "")}</textarea></label>
      </div>
      <div class="result-actions"><a class="pdo-button secondary" href="profile.html?id=${encodeURIComponent(user.id)}">View profile</a><button class="pdo-button" id="saveUserControls" type="button" ${!mayManageTarget ? "disabled" : ""}>Save changes</button></div>
      <p class="pdo-message" id="saveUserMessage" aria-live="polite"></p>
    </article>`;
  document.getElementById("saveUserControls").addEventListener("click", saveUserControls);
}

async function saveUserControls() {
  const button = document.getElementById("saveUserControls");
  const message = document.getElementById("saveUserMessage");
  const roleSelect = document.getElementById("userRoleSelect");

  if (!selectedUser || !staffUser || !isAdminUser) {
    setMessage(message, "No user is selected.", true);
    return;
  }

  const previousRole = selectedUser.role;
  const nextRole = roleSelect.value;
  const validRoles = ["User", "VIP", "Moderator", "Administrator", "Head Administrator"];

  if (!validRoles.includes(nextRole)) {
    setMessage(message, "Invalid role selected.", true);
    return;
  }

  if (previousRole === "Head Administrator" && !isHeadAdminUser) {
    setMessage(message, "Only a Head Administrator can change this account.", true);
    return;
  }

  if (nextRole === "Head Administrator" && !isHeadAdminUser) {
    setMessage(message, "Only a Head Administrator can grant this role.", true);
    roleSelect.value = previousRole;
    return;
  }

  if (selectedUser.id === staffUser.uid && ["Administrator", "Head Administrator"].includes(previousRole) && nextRole !== previousRole) {
    setMessage(message, `You cannot remove or change your own ${previousRole} access.`, true);
    roleSelect.value = previousRole;
    return;
  }

  if (previousRole !== nextRole) {
    const confirmed = confirm(`Change @${selectedUser.username || selectedUser.displayName || "user"} from ${previousRole} to ${nextRole}?`);
    if (!confirmed) {
      roleSelect.value = previousRole;
      return;
    }
  }

  const reason = clean(document.getElementById("userRestrictionReason").value).slice(0, 300);
  const shouldHaveVip = ["VIP", "Moderator", "Administrator", "Head Administrator"].includes(nextRole);
  const alreadyHadVip = selectedUser.vip === true;

  const changes = {
    vip: shouldHaveVip,
    vipGrantedBy: shouldHaveVip ? staffUser.uid : "",
    vipStartedAt: shouldHaveVip
      ? (alreadyHadVip && selectedUser.vipStartedAt ? selectedUser.vipStartedAt : serverTimestamp())
      : null,
    vipExpiresAt: null,
    rollingRestricted: document.getElementById("userRollingRestricted").checked,
    reviewsRestricted: document.getElementById("userReviewsRestricted").checked,
    accountSuspended: document.getElementById("userAccountSuspended").checked,
    restrictionReason: reason,
    restrictionsUpdatedAt: serverTimestamp(),
    restrictionsUpdatedBy: staffUser.uid
  };

  button.disabled = true;
  setMessage(message, "Saving account controls…");

  try {
    await setDoc(doc(db, "users", selectedUser.id), changes, { merge: true });

    const adminRef = doc(db, "admins", selectedUser.id);
    const moderatorRef = doc(db, "moderators", selectedUser.id);
    const [adminSnap, moderatorSnap] = await Promise.all([getDoc(adminRef), getDoc(moderatorRef)]);

    if (["Administrator", "Head Administrator"].includes(nextRole)) {
      const adminRole = nextRole === "Head Administrator" ? "head-admin" : "admin";
      await setDoc(adminRef, {
        uid: selectedUser.id,
        enabled: true,
        role: adminRole,
        promotedBy: adminSnap.exists() ? (adminSnap.data().promotedBy || staffUser.uid) : staffUser.uid,
        promotedAt: adminSnap.exists() ? (adminSnap.data().promotedAt || serverTimestamp()) : serverTimestamp(),
        lastChangedBy: staffUser.uid,
        lastChangedAt: serverTimestamp()
      }, { merge: true });

      if (moderatorSnap.exists()) {
        await updateDoc(moderatorRef, {
          enabled: false, disabledBy: staffUser.uid, disabledAt: serverTimestamp(),
          lastChangedBy: staffUser.uid, lastChangedAt: serverTimestamp()
        });
      }
    } else {
      if (adminSnap.exists() && selectedUser.id !== staffUser.uid) {
        await updateDoc(adminRef, {
          enabled: false,
          role: adminSnap.data().role === "head-admin" ? "head-admin" : "admin",
          disabledBy: staffUser.uid, disabledAt: serverTimestamp(),
          lastChangedBy: staffUser.uid, lastChangedAt: serverTimestamp()
        });
      }

      if (nextRole === "Moderator") {
        await setDoc(moderatorRef, {
          uid: selectedUser.id, enabled: true,
          promotedBy: moderatorSnap.exists() ? (moderatorSnap.data().promotedBy || staffUser.uid) : staffUser.uid,
          promotedAt: moderatorSnap.exists() ? (moderatorSnap.data().promotedAt || serverTimestamp()) : serverTimestamp(),
          lastChangedBy: staffUser.uid, lastChangedAt: serverTimestamp()
        }, { merge: true });
      } else if (moderatorSnap.exists()) {
        await updateDoc(moderatorRef, {
          enabled: false, disabledBy: staffUser.uid, disabledAt: serverTimestamp(),
          lastChangedBy: staffUser.uid, lastChangedAt: serverTimestamp()
        });
      }
    }

    selectedUser = { ...selectedUser, ...changes, role: nextRole };
    const notificationTitle = nextRole === "Head Administrator" ? "Head Administrator access granted"
      : nextRole === "Administrator" ? "Administrator access granted"
      : nextRole === "Moderator" ? "Moderator access granted"
      : nextRole === "VIP" ? "VIP access granted" : "Account role updated";
    const notificationMessage = reason || `A staff member changed your account role from ${previousRole} to ${nextRole}.`;

    const sideEffects = await Promise.allSettled([
      logAction("user_control_updated", "user", selectedUser.id, {
        previousRole, role: nextRole, rollingRestricted: changes.rollingRestricted,
        reviewsRestricted: changes.reviewsRestricted, accountSuspended: changes.accountSuspended,
        restrictionReason: reason, vip: changes.vip
      }),
      notifyUser(selectedUser.id, notificationTitle, notificationMessage,
        nextRole === "Head Administrator" ? "head_admin_granted"
          : nextRole === "Administrator" ? "admin_granted"
          : nextRole === "Moderator" ? "moderator_granted"
          : nextRole === "VIP" ? "vip_granted" : "account_control")
    ]);

    const sideEffectFailed = sideEffects.some(result => result.status === "rejected");
    await renderUser(selectedUser);
    setMessage(document.getElementById("saveUserMessage"),
      sideEffectFailed ? "Account controls saved. The activity log or notification could not be created." : "User controls saved successfully.",
      sideEffectFailed);
  } catch (error) {
    console.error("User Management save failed:", error);
    setMessage(message, `Could not save: ${error.message || "Unknown error"}`, true);
  } finally {
    const currentButton = document.getElementById("saveUserControls");
    if (currentButton) currentButton.disabled = false;
  }
}

async function findRoom(term) {
  const raw = clean(term);
  const upper = raw.toUpperCase();

  const direct = await getDoc(doc(db, "permanentRooms", raw));
  if (direct.exists()) return { kind: "permanent", id: direct.id, ...direct.data() };

  const diceMap = await getDoc(doc(db, "permanentRoomIds", upper));
  if (diceMap.exists()) {
    const roomId = diceMap.data().roomId || diceMap.data().ownerUid;
    if (roomId) {
      const roomSnap = await getDoc(doc(db, "permanentRooms", roomId));
      if (roomSnap.exists()) return { kind: "permanent", id: roomSnap.id, ...roomSnap.data() };
    }
  }

  const exactDice = await getDocs(query(collection(db, "permanentRooms"), where("diceId", "==", upper), limit(1)));
  if (!exactDice.empty) return { kind: "permanent", id: exactDice.docs[0].id, ...exactDice.docs[0].data() };

  const permanentByUsername = await getDocs(query(collection(db, "permanentRooms"), where("hostUsername", "==", raw.replace(/^@/, "")), limit(1)));
  if (!permanentByUsername.empty) return { kind: "permanent", id: permanentByUsername.docs[0].id, ...permanentByUsername.docs[0].data() };

  if (isAdminUser) {
    const guestDirect = await getDoc(doc(db, "games", upper));
    if (guestDirect.exists()) return { kind: "guest", id: guestDirect.id, ...guestDirect.data() };

    for (const guestQuery of [
      query(collection(db, "games"), where("hostId", "==", raw), limit(1)),
      query(collection(db, "games"), where("players.middleman.name", "==", raw.replace(/^@/, "")), limit(1))
    ]) {
      const guestSnap = await getDocs(guestQuery);
      if (!guestSnap.empty) return { kind: "guest", id: guestSnap.docs[0].id, ...guestSnap.docs[0].data() };
    }
  }

  return null;
}

function renderRoom(room) {
  selectedRoom = room;
  if (room.kind === "guest") return renderGuestRoom(room);
  roomResult.hidden = false;
  roomResult.innerHTML = `
    <article class="control-result">
      <div class="result-head"><div><h3>${esc(room.roomName || "Dice Room")}</h3><p>@${esc(room.hostUsername || "Unknown host")}</p></div><span class="pdo-badge ${room.rollingSuspended ? "danger-badge" : ""}">${room.rollingSuspended ? "Rolling suspended" : (room.isLive ? "Live" : "Permanent room")}</span></div>
      <dl class="result-details"><div><dt>Room ID</dt><dd>${esc(room.id)}</dd></div><div><dt>Dice ID</dt><dd>${esc(room.diceId || "Unknown")}</dd></div><div><dt>Platform</dt><dd>${esc(room.platform || "Not set")}</dd></div><div><dt>IGN</dt><dd>${esc(room.ign || "Not set")}</dd></div></dl>
      <div class="control-grid">
        <label class="full"><span>Room name</span><input class="pdo-input" id="roomNameControl" maxlength="80" value="${esc(room.roomName || "Dice Room")}"></label>
        <label class="check-row full"><input type="checkbox" id="roomRollingSuspended" ${room.rollingSuspended === true ? "checked" : ""}> Suspend room rolling</label>
        <label class="full"><span>Reason</span><textarea class="pdo-input" id="roomSuspensionReason" maxlength="300">${esc(room.rollingSuspensionReason || "")}</textarea></label>
      </div>
      <div class="result-actions"><a class="pdo-button secondary" href="room.html?id=${encodeURIComponent(room.diceId || "")}">Open room</a><button class="pdo-button secondary" id="forceCloseRoom" type="button">Force close live session</button><button class="pdo-button" id="saveRoomControls" type="button">Save changes</button>${isAdminUser ? '<button class="pdo-button danger" id="deleteRoom" type="button">Delete room</button>' : ''}</div>
      <p class="pdo-message" id="saveRoomMessage" aria-live="polite"></p>
    </article>`;
  document.getElementById("saveRoomControls").addEventListener("click", saveRoomControls);
  document.getElementById("forceCloseRoom").addEventListener("click", forceCloseRoom);
  document.getElementById("deleteRoom")?.addEventListener("click", deleteSelectedRoom);
}

function renderGuestRoom(room) {
  const suspended = room.guestRollingSuspended === true;
  const closing = room.roomClosing === true || room.status === "closing";
  roomResult.hidden = false;
  roomResult.innerHTML = `
    <article class="control-result">
      <div class="result-head"><div><h3>Guest Room ${esc(room.id)}</h3><p>${esc(room.players?.middleman?.name || "Unknown Middleman")}</p></div><span class="pdo-badge ${suspended || closing ? "danger-badge" : ""}">${closing ? "Closing" : suspended ? "Rolling suspended" : "Guest room"}</span></div>
      <dl class="result-details"><div><dt>Dice ID</dt><dd>${esc(room.id)}</dd></div><div><dt>Host UID</dt><dd>${esc(room.hostId || "Unknown")}</dd></div><div><dt>Status</dt><dd>${esc(room.status || "waiting")}</dd></div><div><dt>Roll number</dt><dd>${esc(room.rollNumber || 0)}</dd></div></dl>
      <div class="control-grid"><label class="check-row full"><input type="checkbox" id="guestRollingSuspended" ${suspended ? "checked" : ""}> Suspend guest-room rolling</label><label class="full"><span>Reason</span><textarea class="pdo-input" id="guestSuspensionReason" maxlength="300">${esc(room.guestSuspensionReason || "")}</textarea></label></div>
      <div class="result-actions"><button class="pdo-button secondary" id="forceCloseGuestRoom" type="button">Force close room</button><button class="pdo-button" id="saveGuestRoomControls" type="button">Save changes</button><button class="pdo-button danger" id="deleteGuestRoom" type="button">Delete guest room</button></div>
      <p class="pdo-message" id="saveRoomMessage" aria-live="polite"></p>
    </article>`;
  document.getElementById("saveGuestRoomControls").addEventListener("click", saveGuestRoomControls);
  document.getElementById("forceCloseGuestRoom").addEventListener("click", forceCloseGuestRoom);
  document.getElementById("deleteGuestRoom").addEventListener("click", deleteGuestRoom);
}

async function saveRoomControls() {
  const button = document.getElementById("saveRoomControls");
  const message = document.getElementById("saveRoomMessage");
  const suspended = document.getElementById("roomRollingSuspended").checked;
  const reason = clean(document.getElementById("roomSuspensionReason").value).slice(0, 300);
  const roomName = clean(document.getElementById("roomNameControl").value).slice(0, 80);
  if (roomName.length < 2) return setMessage(message, "Room name must contain at least 2 characters.", true);
  button.disabled = true;
  try {
    await updateDoc(doc(db, "permanentRooms", selectedRoom.id), { roomName, rollingSuspended: suspended, rollingSuspensionReason: reason, rollingSuspendedAt: suspended ? serverTimestamp() : null, rollingSuspendedBy: suspended ? staffUser.uid : "", rolling: false, pendingResult: [], updatedAt: serverTimestamp() });
    await logAction("room_controls_updated", "room", selectedRoom.id, { roomKind: "permanent", diceId: selectedRoom.diceId || "", roomName, rollingSuspended: suspended, reason });
    await notifyUser(selectedRoom.ownerUid, suspended ? "Room rolling suspended" : "Room rolling restored", reason || "A staff member updated your room.", suspended ? "room_suspended" : "room_restored");
    selectedRoom = { ...selectedRoom, roomName, rollingSuspended: suspended, rollingSuspensionReason: reason };
    renderRoom(selectedRoom);
    setMessage(document.getElementById("saveRoomMessage"), "Permanent-room controls saved.");
  } catch (error) { setMessage(message, `Could not save: ${error.message}`, true); }
  finally { const current = document.getElementById("saveRoomControls"); if (current) current.disabled = false; }
}

async function forceCloseRoom() {
  const message = document.getElementById("saveRoomMessage");
  if (!confirm("Force this permanent room offline and stop its current roll?")) return;
  try {
    await updateDoc(doc(db, "permanentRooms", selectedRoom.id), { isLive: false, liveStartedAt: null, streamLink: "", rolling: false, pendingResult: [], updatedAt: serverTimestamp() });
    await logAction("room_force_closed", "room", selectedRoom.id, { roomKind: "permanent", diceId: selectedRoom.diceId || "" });
    await notifyUser(selectedRoom.ownerUid, "Room force-closed", "A staff member ended your live room session.", "room_force_closed");
    setMessage(message, "Permanent room force-closed.");
  } catch (error) { setMessage(message, `Could not force-close: ${error.message}`, true); }
}

async function deleteSelectedRoom() {
  if (!isAdminUser || selectedRoom?.kind === "guest") return;

  const roomId = selectedRoom.id;
  const ownerUid = selectedRoom.ownerUid || roomId;
  const diceId = clean(selectedRoom.diceId).toUpperCase();
  const expected = diceId || clean(roomId).toUpperCase();
  const typed = prompt(`Type ${expected} to permanently delete this room.`);

  if (clean(typed).toUpperCase() !== expected) return;

  const message = document.getElementById("saveRoomMessage");
  const roomRef = doc(db, "permanentRooms", roomId);
  const ownerRef = doc(db, "users", ownerUid);
  const diceIdRef = diceId ? doc(db, "permanentRoomIds", diceId) : null;

  try {
    await runTransaction(db, async transaction => {
      // Firestore requires every transaction read to finish before any write.
      const [roomSnap, ownerSnap] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(ownerRef)
      ]);

      if (!roomSnap.exists()) {
        throw new Error("This permanent room no longer exists.");
      }

      // All transaction writes happen only after the reads above are complete.
      transaction.delete(roomRef);

      if (diceIdRef) {
        transaction.delete(diceIdRef);
      }

      if (ownerSnap.exists() && ownerSnap.data().roomId === roomId) {
        transaction.update(ownerRef, {
          roomId: "",
          updatedAt: serverTimestamp()
        });
      }
    });

    await logAction("room_deleted", "room", roomId, {
      roomKind: "permanent",
      diceId: expected
    });

    selectedRoom = null;
    roomResult.hidden = true;
    setMessage(roomMessage, "Permanent room deleted.");
  } catch (error) {
    console.error("Permanent room deletion failed:", error);
    setMessage(message, `Could not delete: ${error.message || "Unknown error"}`, true);
  }
}

async function saveGuestRoomControls() {
  if (!isAdminUser || selectedRoom?.kind !== "guest") return;
  const message = document.getElementById("saveRoomMessage");
  const suspended = document.getElementById("guestRollingSuspended").checked;
  const reason = clean(document.getElementById("guestSuspensionReason").value).slice(0, 300);
  try {
    await updateDoc(doc(db, "games", selectedRoom.id), { guestRollingSuspended: suspended, guestSuspensionReason: reason, guestSuspendedAt: suspended ? serverTimestamp() : null, guestSuspendedBy: suspended ? staffUser.uid : "", rolling: false, updatedAt: serverTimestamp() });
    await logAction(suspended ? "guest_room_rolling_suspended" : "guest_room_rolling_restored", "guest_room", selectedRoom.id, { reason });
    selectedRoom = { ...selectedRoom, guestRollingSuspended: suspended, guestSuspensionReason: reason, rolling: false };
    renderGuestRoom(selectedRoom);
    setMessage(document.getElementById("saveRoomMessage"), suspended ? "Guest-room rolling suspended." : "Guest-room rolling restored.");
  } catch (error) { setMessage(message, `Could not save: ${error.message}`, true); }
}

async function forceCloseGuestRoom() {
  if (!isAdminUser || selectedRoom?.kind !== "guest" || !confirm("Force-close this guest room for everyone?")) return;
  const message = document.getElementById("saveRoomMessage");
  try {
    await updateDoc(doc(db, "games", selectedRoom.id), { roomClosing: true, closingAt: Date.now() + 5000, status: "closing", rolling: false, guestClosedBy: staffUser.uid, updatedAt: serverTimestamp() });
    await logAction("guest_room_force_closed", "guest_room", selectedRoom.id, { hostId: selectedRoom.hostId || "" });
    setMessage(message, "Guest room is closing for everyone.");
  } catch (error) { setMessage(message, `Could not force-close: ${error.message}`, true); }
}

async function deleteGuestRoom() {
  if (!isAdminUser || selectedRoom?.kind !== "guest") return;
  const typed = prompt(`Type ${selectedRoom.id} to permanently delete this guest room.`);
  if (clean(typed).toUpperCase() !== selectedRoom.id.toUpperCase()) return;
  try {
    await deleteDoc(doc(db, "games", selectedRoom.id));
    await logAction("guest_room_deleted", "guest_room", selectedRoom.id, { hostId: selectedRoom.hostId || "" });
    roomResult.hidden = true;
    setMessage(roomMessage, "Guest room deleted.");
  } catch (error) { setMessage(document.getElementById("saveRoomMessage"), `Could not delete guest room: ${error.message}`, true); }
}


function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeVip(data) {
  if (data?.vip !== true) return false;
  if (!data.vipExpiresAt) return true;
  return timestampMs(data.vipExpiresAt) > Date.now();
}

function directoryRole(account) {
  if (account.admin?.enabled === true) {
    return account.admin.role === "head-admin"
      ? { key: "admin", label: "Head Administrator" }
      : { key: "admin", label: "Administrator" };
  }
  if (account.moderator?.enabled === true) return { key: "moderator", label: "Moderator" };
  if (activeVip(account.user)) return { key: "vip", label: "VIP" };
  return { key: "user", label: "User" };
}

function updateDirectoryCounts() {
  const counts = { all: directoryAccounts.length, user: 0, vip: 0, moderator: 0, admin: 0 };
  directoryAccounts.forEach(account => counts[directoryRole(account).key]++);
  const ids = {
    all: "directoryAllCount", user: "directoryUserCount", vip: "directoryVipCount",
    moderator: "directoryModeratorCount", admin: "directoryAdminCount"
  };
  Object.entries(ids).forEach(([key, id]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = counts[key].toLocaleString();
  });
}

function renderDirectory() {
  if (!directoryBody) return;
  const term = clean(directorySearch?.value).toLowerCase();
  const sortMode = directorySort?.value || "username";
  const filtered = directoryAccounts.filter(account => {
    const role = directoryRole(account);
    if (directoryRoleFilter !== "all" && role.key !== directoryRoleFilter) return false;
    if (!term) return true;
    const username = account.username || account.displayName || "";
    const email = account.email || "";
    return [username, email, account.id].some(value => String(value).toLowerCase().includes(term));
  });

  filtered.sort((a, b) => {
    if (sortMode === "role") return directoryRole(a).label.localeCompare(directoryRole(b).label) || (a.username || "").localeCompare(b.username || "");
    if (sortMode === "newest") return (b.createdAtMs || 0) - (a.createdAtMs || 0);
    return (a.username || a.displayName || "").localeCompare(b.username || b.displayName || "");
  });

  if (!filtered.length) {
    directoryBody.innerHTML = '<tr><td colspan="4" class="directory-empty">No matching accounts found.</td></tr>';
    setMessage(directoryMessage, `Showing 0 of ${directoryAccounts.length} loaded accounts.`);
    return;
  }

  directoryBody.innerHTML = filtered.map(account => {
    const role = directoryRole(account);
    const username = account.username || account.displayName || "Unknown";
    const email = account.email || "No email stored";
    const photo = account.photoURL || "favicon.png";
    return `<tr>
      <td><div class="directory-account"><img class="directory-avatar" src="${esc(photo)}" alt="" onerror="this.src='favicon.png'"><div><strong>@${esc(username)}</strong><span>${esc(email)}</span></div></div></td>
      <td><span class="directory-role">${esc(role.label)}${role.label === "Head Administrator" ? " 👑" : ""}</span></td>
      <td>${esc(account.id)}</td>
      <td><button class="pdo-button secondary directory-open" type="button" data-directory-open="${esc(account.id)}">Manage</button></td>
    </tr>`;
  }).join("");

  directoryBody.querySelectorAll("[data-directory-open]").forEach(button => {
    button.addEventListener("click", async () => {
      const account = directoryAccounts.find(item => item.id === button.dataset.directoryOpen);
      if (!account) return;
      const bundled = await readUserBundle(account.id);
      if (!bundled) return setMessage(directoryMessage, "This account profile could not be opened.", true);
      await renderUser(bundled);
      userResult?.scrollIntoView({ behavior: "smooth", block: "start" });
      setMessage(userMessage, "User selected from Account Directory.");
    });
  });
  setMessage(directoryMessage, `Showing ${filtered.length} of ${directoryAccounts.length} loaded accounts.`);
}

async function loadAccountDirectory() {
  if (!directoryBody || !isAdminUser) return;
  directoryRefresh.disabled = true;
  directoryBody.innerHTML = '<tr><td colspan="4" class="directory-empty">Loading accounts…</td></tr>';
  setMessage(directoryMessage, "Loading account directory…");
  try {
    // A safety limit keeps one admin page visit from reading an unlimited collection.
    const [usersSnap, profilesSnap, adminsSnap, moderatorsSnap] = await Promise.all([
      getDocs(query(collection(db, "users"), limit(250))),
      getDocs(query(collection(db, "publicProfiles"), limit(250))),
      getDocs(query(collection(db, "admins"), limit(250))),
      getDocs(query(collection(db, "moderators"), limit(250)))
    ]);
    const map = new Map();
    const ensure = id => {
      if (!map.has(id)) map.set(id, { id, user: {}, public: {}, admin: null, moderator: null });
      return map.get(id);
    };
    usersSnap.forEach(snap => { const item = ensure(snap.id); item.user = snap.data(); });
    profilesSnap.forEach(snap => { const item = ensure(snap.id); item.public = snap.data(); });
    adminsSnap.forEach(snap => { const item = ensure(snap.id); item.admin = snap.data(); });
    moderatorsSnap.forEach(snap => { const item = ensure(snap.id); item.moderator = snap.data(); });
    directoryAccounts = [...map.values()].map(item => ({
      ...item.public, ...item.user, id: item.id,
      user: item.user, admin: item.admin, moderator: item.moderator,
      createdAtMs: timestampMs(item.user.createdAt || item.public.createdAt)
    }));
    updateDirectoryCounts();
    renderDirectory();
  } catch (error) {
    console.error("Account directory failed:", error);
    directoryBody.innerHTML = '<tr><td colspan="4" class="directory-empty">Could not load the account directory.</td></tr>';
    setMessage(directoryMessage, error.message || "Could not load accounts.", true);
  } finally {
    directoryRefresh.disabled = false;
  }
}

userForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const term = clean(userInput.value);
  if (!term) return setMessage(userMessage, "Enter a username, UID, or email.", true);
  userButton.disabled = true; userResult.hidden = true; setMessage(userMessage, "Searching…");
  try { await adminReady; const user = await findUser(term); if (!user) throw new Error("No matching user found."); await renderUser(user); setMessage(userMessage, "User found."); }
  catch (error) { setMessage(userMessage, error.message, true); }
  finally { userButton.disabled = false; }
});

roomForm.addEventListener("submit", async event => {
  event.preventDefault();
  const term = clean(roomInput.value);
  if (!term) return setMessage(roomMessage, "Enter a permanent Room ID, guest Dice ID, host UID, or username.", true);
  roomButton.disabled = true; roomResult.hidden = true; setMessage(roomMessage, "Searching…");
  try { await adminReady; const room = await findRoom(term); if (!room) throw new Error("No matching room found."); renderRoom(room); setMessage(roomMessage, "Room found."); }
  catch (error) { setMessage(roomMessage, error.message, true); }
  finally { roomButton.disabled = false; }
});


directorySearch?.addEventListener("input", renderDirectory);
directorySort?.addEventListener("change", renderDirectory);
directoryRefresh?.addEventListener("click", loadAccountDirectory);
directoryRoleButtons.forEach(button => button.addEventListener("click", () => {
  directoryRoleFilter = button.dataset.directoryRole || "all";
  directoryRoleButtons.forEach(item => item.classList.toggle("active", item === button));
  renderDirectory();
}));

adminReady = verifyStaff();
adminReady.then(() => { if (isAdminUser) loadAccountDirectory(); });
adminReady.catch(error => {
  console.error(error);
  if (userMessage) setMessage(userMessage, error.message, true);
  setMessage(roomMessage, error.message, true);
  if (userButton) userButton.disabled = true;
  roomButton.disabled = true;
});
