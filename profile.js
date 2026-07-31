import { authReady, db } from "./firebase.js";
import { isEnabledAdmin, getUserRole } from "./permissions.js";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const loading = document.getElementById("profileLoading");
const errorBox = document.getElementById("profileError");
const profileCard = document.getElementById("profileCard");
const photo = document.getElementById("profilePhoto");
const username = document.getElementById("profileUsername");
const vipBadge = document.getElementById("profileVipBadge");
const trust = document.getElementById("profileTrust");
const bio = document.getElementById("profileBio");
const memberSince = document.getElementById("profileMemberSince");
const roomName = document.getElementById("profileRoomName");
const roomStatus = document.getElementById("profileRoomStatus");
const roomFavorites = document.getElementById("profileRoomFavorites");
const roomGame = document.getElementById("profileRoomGame");
const roomPlatform = document.getElementById("profileRoomPlatform");
const joinRoom = document.getElementById("profileJoinRoom");
const preview = document.getElementById("profileReviewPreview");
const viewAllButton = document.getElementById("viewAllReviewsButton");
const reviewsModal = document.getElementById("reviewsModal");
const closeReviewsButton = document.getElementById("closeReviewsButton");
const allReviewsList = document.getElementById("allReviewsList");
const staffManagement = document.getElementById("staffManagement");
const internalRole = document.getElementById("internalRole");
const toggleModeratorButton = document.getElementById("toggleModeratorButton");
const staffActionMessage = document.getElementById("staffActionMessage");
const editOwnProfileButton = document.getElementById("editOwnProfileButton");
const profileVisitShop = document.getElementById("profileVisitShop");

const targetUid = new URLSearchParams(location.search).get("id")?.trim() || "";
let currentViewer = null;
let viewerIsAdmin = false;
let targetIsModerator = false;
let targetIsAdmin = false;
let targetIsVip = false;
let reviews = [];

function formatDate(value) {
    if (!value?.toDate) return "";
    return value.toDate().toLocaleDateString([], { year: "numeric", month: "long" });
}

function relativeDate(value) {
    if (!value?.toDate) return "Date unavailable";
    const milliseconds = Date.now() - value.toDate().getTime();
    const days = Math.max(0, Math.floor(milliseconds / 86400000));
    if (days === 0) return "Today";
    if (days === 1) return "1 day ago";
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
}

function timestampMillis(value) {
    return value?.toMillis?.() || 0;
}

function createReviewCard(review) {
    const card = document.createElement("article");
    card.className = "profileReviewCard";

    const vote = document.createElement("strong");
    vote.textContent = review.recommend === true ? "👍 I Vouch" : "👎 I Don't Vouch";

    const comment = String(review.review || "").trim();
    const text = comment ? document.createElement("p") : null;
    if (text) text.textContent = comment;

    const meta = document.createElement("small");
    const author = document.createElement(review.reviewerUid ? "a" : "span");
    author.className = "profileUsernameLink";
    author.textContent = `@${review.username || "Player"}`;
    if (review.reviewerUid) author.href = `profile.html?id=${encodeURIComponent(review.reviewerUid)}`;
    meta.append(author, document.createTextNode(` • ${relativeDate(review.createdAt)}`));

    card.appendChild(vote);
    if (text) card.appendChild(text);
    card.appendChild(meta);
    return card;
}

function renderReviews() {
    preview.innerHTML = "";
    allReviewsList.innerHTML = "";

    if (reviews.length === 0) {
        preview.textContent = "No community reviews yet.";
        viewAllButton.hidden = true;
        return;
    }

    reviews.slice(0, 3).forEach(review => preview.appendChild(createReviewCard(review)));
    reviews.forEach(review => allReviewsList.appendChild(createReviewCard(review)));
    viewAllButton.hidden = false;
}

function renderTrust() {
    const vouches = reviews.filter(item => item.recommend === true).length;
    const against = reviews.filter(item => item.recommend === false).length;
    const total = vouches + against;

    if (total === 0) {
        trust.textContent = "🛡️ No community trust score yet";
        return;
    }

    const percent = Math.round((vouches / total) * 100);
    trust.textContent = `🛡️ ${percent}% Trusted • 👍 ${vouches} Vouches`;
}

async function loadProfile() {
    if (!targetUid) throw new Error("Missing profile ID.");

    if (profileVisitShop) profileVisitShop.href = `my_shop.html?id=${encodeURIComponent(targetUid)}`;

    const [profileSnapshot, roomSnapshot, reviewSnapshot] = await Promise.all([
        getDoc(doc(db, "publicProfiles", targetUid)),
        getDoc(doc(db, "permanentRooms", targetUid)),
        getDocs(collection(db, "users", targetUid, "reviews"))
    ]);

    if (!profileSnapshot.exists()) throw new Error("This profile does not exist.");

    const profile = profileSnapshot.data();
    photo.src = profile.photoURL || "favicon.png";
    username.textContent = `@${profile.username || "user"}`;
    bio.textContent = profile.bio?.trim() || "No bio added.";
    memberSince.textContent = profile.createdAt ? `Member since ${formatDate(profile.createdAt)}` : "";

    reviews = reviewSnapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));

    renderTrust();
    renderReviews();

    if (roomSnapshot.exists()) {
        const room = roomSnapshot.data();
        roomName.textContent = room.roomName || "Dice Room";
        roomStatus.textContent = room.isLive === true ? "🔴 LIVE NOW" : "⚫ Offline";
        roomFavorites.textContent = `⭐ ${Number(room.favoriteCount || 0).toLocaleString()} ${Number(room.favoriteCount || 0) === 1 ? "Favorite" : "Favorites"}`;
        roomGame.textContent = room.game === "Roblox" && room.robloxGame
            ? `🎮 Roblox • ${room.robloxGame}`
            : room.game ? `🎮 ${room.game}` : "";
        roomPlatform.textContent = room.platform ? `📺 ${room.platform}` : "";
        if (room.diceId) {
            joinRoom.href = `room.html?id=${encodeURIComponent(room.diceId)}`;
            joinRoom.hidden = false;
        }
    } else {
        roomStatus.textContent = "⚫ No permanent room";
        roomFavorites.textContent = "";
    }
}

async function loadPrivateStaffControls() {
    viewerIsAdmin = await isEnabledAdmin(currentViewer);
    if (!viewerIsAdmin || currentViewer.uid === targetUid) return;

    const targetRole = await getUserRole(targetUid);

    targetIsAdmin = targetRole.isAdmin;
    targetIsModerator = targetRole.isModerator;
    targetIsVip = targetRole.isVip;

    staffManagement.hidden = false;
    internalRole.textContent = targetRole.label;

    // VIP status is private because it is stored in users/{uid}.
    // Only an administrator viewing this profile sees this badge.
    vipBadge.hidden = !targetIsVip;

    if (targetIsAdmin) {
        toggleModeratorButton.hidden = true;
        return;
    }

    toggleModeratorButton.hidden = false;
    toggleModeratorButton.textContent = targetIsModerator
        ? "Demote to User"
        : "Promote to Moderator";
}

async function toggleModerator() {
    if (!viewerIsAdmin || targetIsAdmin) return;

    const action = targetIsModerator ? "demote this moderator to User" : "promote this user to Moderator";
    if (!(await window.showPeryaConfirm(
        `Are you sure you want to ${action}?`,
        {
            title: "Change Staff Role",
            confirmText: targetIsModerator ? "Demote" : "Promote",
            cancelText: "Cancel"
        }
    ))) return;

    toggleModeratorButton.disabled = true;
    staffActionMessage.textContent = "Saving role…";

    try {
        const moderatorRef = doc(db, "moderators", targetUid);

        if (targetIsModerator) {
            await deleteDoc(moderatorRef);
            targetIsModerator = false;
            internalRole.textContent = targetIsVip ? "VIP" : "User";
            toggleModeratorButton.textContent = "Promote to Moderator";
            staffActionMessage.textContent = targetIsVip
                ? "Moderator was demoted and remains VIP."
                : "Moderator was demoted to User.";
        } else {
            await setDoc(moderatorRef, {
                enabled: true,
                uid: targetUid,
                promotedBy: currentViewer.uid,
                promotedAt: serverTimestamp()
            });
            targetIsModerator = true;
            internalRole.textContent = "Moderator";
            toggleModeratorButton.textContent = "Demote to User";
            staffActionMessage.textContent = "User was promoted to Moderator.";
        }
    } catch (error) {
        console.error("Could not change moderator role:", error);
        staffActionMessage.textContent = "Could not change this role. Check Firestore rules.";
        staffActionMessage.classList.add("errorMessage");
    } finally {
        toggleModeratorButton.disabled = false;
    }
}

function closeReviews() {
    reviewsModal.hidden = true;
    document.body.classList.remove("modalOpen");
}

viewAllButton.addEventListener("click", () => {
    reviewsModal.hidden = false;
    document.body.classList.add("modalOpen");
});
closeReviewsButton.addEventListener("click", closeReviews);
reviewsModal.querySelector("[data-close-reviews]").addEventListener("click", closeReviews);
toggleModeratorButton.addEventListener("click", toggleModerator);

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !reviewsModal.hidden) closeReviews();
});

(async function initialize() {
    try {
        currentViewer = await authReady;
        if (currentViewer && !currentViewer.isAnonymous && currentViewer.uid === targetUid) {
            editOwnProfileButton.hidden = false;
        }
        await loadProfile();
        await loadPrivateStaffControls();
        loading.hidden = true;
        profileCard.hidden = false;
    } catch (error) {
        console.error("Could not load profile:", error);
        loading.hidden = true;
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Could not load this profile.";
    }
})();
