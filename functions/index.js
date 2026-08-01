const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { randomInt } = require("node:crypto");

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: "asia-southeast1", maxInstances: 10 });

const QUEUE_SIZE = 10;
const MIN_DICE = 1;
const MAX_DICE = 15;
const COLOR_COUNT = 6;
const MAX_HISTORY = 10;
const LIVE_NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000;
const FIRESTORE_BATCH_LIMIT = 450;

function requireFirebaseAuth(request) {
    const auth = request.auth;
    if (!auth || !auth.uid) {
        throw new HttpsError(
            "unauthenticated",
            "Firebase authentication is required."
        );
    }
    return auth.uid;
}

function requireRegisteredAuth(request) {
    const uid = requireFirebaseAuth(request);
    if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
        throw new HttpsError(
            "unauthenticated",
            "Sign in with your registered account first."
        );
    }
    return uid;
}

function cleanRoomType(value) {
    const type = String(value || "").trim().toLowerCase();
    if (type !== "guest" && type !== "permanent") {
        throw new HttpsError("invalid-argument", "roomType must be guest or permanent.");
    }
    return type;
}

function cleanRoomId(value) {
    const roomId = String(value || "").trim();
    if (!roomId || roomId.length > 128 || roomId.includes("/")) {
        throw new HttpsError("invalid-argument", "A valid roomId is required.");
    }
    return roomId;
}

function clampDiceCount(value) {
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < MIN_DICE || amount > MAX_DICE) {
        throw new HttpsError("invalid-argument", `Dice count must be from ${MIN_DICE} to ${MAX_DICE}.`);
    }
    return amount;
}

function roomRefFor(type, roomId) {
    return db.collection(type === "guest" ? "games" : "permanentRooms").doc(roomId);
}

function queueRefFor(type, roomId) {
    return db.collection("_secureRollQueues").doc(`${type}__${roomId}`);
}

function randomRoll(amount) {
    return Array.from({ length: amount }, () => randomInt(0, COLOR_COUNT));
}

function encodeRoll(roll) {
    return roll.join(",");
}

function decodeRoll(value, expectedAmount = null) {
    const values = Array.isArray(value)
        ? value.map(Number)
        : String(value || "").split(",").map(Number);

    const valid = values.every(value => Number.isInteger(value) && value >= 0 && value < COLOR_COUNT);
    if (!valid || values.length < MIN_DICE || values.length > MAX_DICE) return null;
    if (expectedAmount !== null && values.length !== expectedAmount) return null;
    return values;
}

function makeQueue(amount) {
    return Array.from({ length: QUEUE_SIZE }, () => randomRoll(amount));
}

function normalizeQueue(rawRolls, amount) {
    const output = [];
    if (Array.isArray(rawRolls)) {
        for (const raw of rawRolls) {
            const decoded = decodeRoll(raw, amount);
            if (decoded) output.push(decoded);
            if (output.length >= QUEUE_SIZE) break;
        }
    }
    while (output.length < QUEUE_SIZE) output.push(randomRoll(amount));
    return output;
}

async function readAccess(uid) {
    const [userSnap, adminSnap] = await Promise.all([
        db.collection("users").doc(uid).get(),
        db.collection("admins").doc(uid).get()
    ]);

    const user = userSnap.exists ? userSnap.data() : {};
    const admin = adminSnap.exists ? adminSnap.data() : {};
    const allowedPages = Array.isArray(user.allowedPages)
        ? user.allowedPages.map(value => String(value || "").trim())
        : [];

    return {
        user,
        isAdmin: adminSnap.exists && admin.enabled === true,
        hasPrivatePageAccess:
            user.imamonkeyandilovemoneyAccess === true ||
            allowedPages.includes("imamonkeyandilovemoney.html")
    };
}

function assertAccountCanRoll(user) {
    if (user.accountSuspended === true) {
        throw new HttpsError("permission-denied", "This account is suspended.");
    }
    if (user.rollingRestricted === true) {
        throw new HttpsError("permission-denied", "Rolling is restricted for this account.");
    }
}

function isRoomOwner(type, room, uid) {
    return type === "guest" ? room.hostId === uid : room.ownerUid === uid;
}

async function authorizeQueueAccess(uid, type, room) {
    const access = await readAccess(uid);
    if (access.isAdmin) return access;

    if (type !== "permanent" || !isRoomOwner(type, room, uid) || !access.hasPrivatePageAccess) {
        throw new HttpsError("permission-denied", "Secure room access is required.");
    }
    return access;
}

exports.getSecureRollQueue = onCall(async request => {
    const uid = requireRegisteredAuth(request);
    const type = cleanRoomType(request.data?.roomType);
    const roomId = cleanRoomId(request.data?.roomId);
    const roomRef = roomRefFor(type, roomId);
    const queueRef = queueRefFor(type, roomId);

    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) throw new HttpsError("not-found", "Room not found.");
    const room = roomSnap.data();
    await authorizeQueueAccess(uid, type, room);

    const amount = Math.min(MAX_DICE, Math.max(MIN_DICE, Number(room.diceCount || 3)));
    const queueSnap = await queueRef.get();
    const rolls = normalizeQueue(queueSnap.exists ? queueSnap.data()?.rolls : [], amount);

    if (!queueSnap.exists || JSON.stringify(queueSnap.data()?.rolls || []) !== JSON.stringify(rolls.map(encodeRoll))) {
        await queueRef.set({
            roomType: type,
            roomId,
            diceCount: amount,
            rolls: rolls.map(encodeRoll),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    }

    return { rolls: rolls.map(encodeRoll) };
});

exports.setSecureRollQueue = onCall(async request => {
    const uid = requireRegisteredAuth(request);
    const type = cleanRoomType(request.data?.roomType);
    const roomId = cleanRoomId(request.data?.roomId);
    const submitted = request.data?.rolls;
    if (!Array.isArray(submitted) || submitted.length < 1 || submitted.length > QUEUE_SIZE) {
        throw new HttpsError("invalid-argument", `rolls must contain 1 to ${QUEUE_SIZE} rolls.`);
    }

    const roomRef = roomRefFor(type, roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) throw new HttpsError("not-found", "Room not found.");
    const room = roomSnap.data();
    await authorizeQueueAccess(uid, type, room);

    const amount = Math.min(MAX_DICE, Math.max(MIN_DICE, Number(room.diceCount || 3)));
    const rolls = submitted.map(value => decodeRoll(value, amount));
    if (rolls.some(value => !value)) {
        throw new HttpsError("invalid-argument", "Every roll must match the room dice count and use colors 0 through 5.");
    }
    while (rolls.length < QUEUE_SIZE) rolls.push(randomRoll(amount));

    await queueRefFor(type, roomId).set({
        roomType: type,
        roomId,
        diceCount: amount,
        rolls: rolls.map(encodeRoll),
        updatedBy: uid,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { ok: true, rolls: rolls.map(encodeRoll) };
});

exports.startSecureRoll = onCall(async request => {
    const uid = requireFirebaseAuth(request);
    const type = cleanRoomType(request.data?.roomType);
    const roomId = cleanRoomId(request.data?.roomId);
    const roomRef = roomRefFor(type, roomId);
    const queueRef = queueRefFor(type, roomId);

    const result = await db.runTransaction(async transaction => {
        const [roomSnap, userSnap, queueSnap] = await Promise.all([
            transaction.get(roomRef),
            transaction.get(db.collection("users").doc(uid)),
            transaction.get(queueRef)
        ]);

        if (!roomSnap.exists) throw new HttpsError("not-found", "Room not found.");
        const room = roomSnap.data();
        if (!isRoomOwner(type, room, uid)) {
            throw new HttpsError("permission-denied", "Only the room creator can roll.");
        }

        const user = userSnap.exists ? userSnap.data() : {};
        assertAccountCanRoll(user);
        if (room.rollingSuspended === true || room.guestRollingSuspended === true) {
            throw new HttpsError("failed-precondition", "Rolling is suspended for this room.");
        }
        if (room.rolling === true) {
            throw new HttpsError("failed-precondition", "A roll is already in progress.");
        }

        const amount = Math.min(MAX_DICE, Math.max(MIN_DICE, Number(room.diceCount || 3)));
        const queue = normalizeQueue(queueSnap.exists ? queueSnap.data()?.rolls : [], amount);
        const selected = queue.shift() || randomRoll(amount);
        queue.push(randomRoll(amount));

        const oldHistory = Array.isArray(room.history) ? room.history : [];
        const history = [...oldHistory, encodeRoll(selected)].slice(-MAX_HISTORY);
        const nextRollNumber = Number(room.rollNumber || 0) + 1;

        transaction.set(queueRef, {
            roomType: type,
            roomId,
            diceCount: amount,
            rolls: queue.map(encodeRoll),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        transaction.update(roomRef, {
            rolling: false,
            pendingResult: [],
            latestResult: selected,
            history,
            rollNumber: nextRollNumber,
            lastRollAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        return selected;
    });

    return { result };
});

exports.setSecureDiceCount = onCall(async request => {
    const uid = requireFirebaseAuth(request);
    const type = cleanRoomType(request.data?.roomType);
    const roomId = cleanRoomId(request.data?.roomId);
    const amount = clampDiceCount(request.data?.amount);
    const roomRef = roomRefFor(type, roomId);
    const queueRef = queueRefFor(type, roomId);

    await db.runTransaction(async transaction => {
        const [roomSnap, userSnap] = await Promise.all([
            transaction.get(roomRef),
            transaction.get(db.collection("users").doc(uid))
        ]);
        if (!roomSnap.exists) throw new HttpsError("not-found", "Room not found.");
        const room = roomSnap.data();
        if (!isRoomOwner(type, room, uid)) {
            throw new HttpsError("permission-denied", "Only the room creator can change the dice count.");
        }
        assertAccountCanRoll(userSnap.exists ? userSnap.data() : {});
        if (room.rolling === true) throw new HttpsError("failed-precondition", "Wait for the current roll to finish.");
        if (room.rollingSuspended === true || room.guestRollingSuspended === true) {
            throw new HttpsError("failed-precondition", "Rolling is suspended for this room.");
        }

        transaction.update(roomRef, {
            diceCount: amount,
            pendingResult: [],
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.set(queueRef, {
            roomType: type,
            roomId,
            diceCount: amount,
            rolls: makeQueue(amount).map(encodeRoll),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });

    return { ok: true, amount };
});

exports.startSecureMiddlemanRoll = onCall(async request => {
    const uid = requireFirebaseAuth(request);
    const roomId = cleanRoomId(request.data?.roomId);
    const amount = clampDiceCount(request.data?.diceCount);
    const roomRef = db.collection("games").doc(roomId);

    const result = await db.runTransaction(async transaction => {
        const [roomSnap, userSnap] = await Promise.all([
            transaction.get(roomRef),
            transaction.get(db.collection("users").doc(uid))
        ]);
        if (!roomSnap.exists) throw new HttpsError("not-found", "Room not found.");
        const room = roomSnap.data();
        if (room.players?.middleman?.uid !== uid || room.hostId !== uid) {
            throw new HttpsError("permission-denied", "Only the room middleman can roll.");
        }
        assertAccountCanRoll(userSnap.exists ? userSnap.data() : {});
        if (room.guestRollingSuspended === true || room.rollingSuspended === true) {
            throw new HttpsError("failed-precondition", "Rolling is suspended for this room.");
        }
        if (!room.players?.bettor1 || !room.players?.bettor2) {
            throw new HttpsError("failed-precondition", "Both bettors must be in the room.");
        }
        if (room.betSent?.bettor1 !== true || room.betSent?.bettor2 !== true) {
            throw new HttpsError("failed-precondition", "Both bets must be accepted before rolling.");
        }

        const selected = randomRoll(amount);
        const oldHistory = Array.isArray(room.history) ? room.history : [];
        const history = [...oldHistory, encodeRoll(selected)].slice(-MAX_HISTORY);

        transaction.update(roomRef, {
            diceCount: amount,
            rolling: false,
            latestResult: selected,
            history,
            rollNumber: Number(room.rollNumber || 0) + 1,
            updatedAt: FieldValue.serverTimestamp()
        });
        return selected;
    });

    return { result };
});

exports.notifyFavoriteUsersWhenRoomGoesLive = onDocumentUpdated(
    "permanentRooms/{hostUid}",
    async event => {
        const beforeSnapshot = event.data?.before;
        const afterSnapshot = event.data?.after;
        if (!beforeSnapshot || !afterSnapshot) return;

        const before = beforeSnapshot.data();
        const after = afterSnapshot.data();
        if (before?.isLive === true || after?.isLive !== true) return;

        const hostUid = event.params.hostUid;
        if (after.ownerUid && after.ownerUid !== hostUid) {
            logger.error("Room owner does not match document ID.", { hostUid, ownerUid: after.ownerUid });
            return;
        }

        const lastNotificationMillis = after.lastLiveNotificationAt?.toMillis?.() || 0;
        if (lastNotificationMillis && Date.now() - lastNotificationMillis < LIVE_NOTIFICATION_COOLDOWN_MS) return;

        const roomName = String(after.roomName || "Permanent Room").trim() || "Permanent Room";
        const diceId = String(after.diceId || "").trim();
        const favoritesSnapshot = await db.collectionGroup("favoriteRooms").where("roomId", "==", hostUid).get();

        let batch = db.batch();
        let pendingWrites = 0;
        let createdNotifications = 0;

        for (const favoriteDocument of favoritesSnapshot.docs) {
            const favorite = favoriteDocument.data();
            const viewerUid = String(favorite.userUid || "").trim() || favoriteDocument.ref.parent.parent?.id || "";
            if (!viewerUid || viewerUid === hostUid) continue;

            batch.set(db.collection("notifications").doc(), {
                uid: viewerUid,
                recipientUid: viewerUid,
                type: "favorite_room_live",
                title: `${roomName} is LIVE!`,
                message: "A room in your favorites has started a live session.",
                hostUid,
                ownerUid: hostUid,
                roomId: hostUid,
                roomName,
                diceId,
                read: false,
                createdAt: FieldValue.serverTimestamp()
            });
            pendingWrites++;
            createdNotifications++;

            if (pendingWrites >= FIRESTORE_BATCH_LIMIT) {
                await batch.commit();
                batch = db.batch();
                pendingWrites = 0;
            }
        }

        batch.update(afterSnapshot.ref, { lastLiveNotificationAt: FieldValue.serverTimestamp() });
        await batch.commit();
        logger.info("Favorite-room live notifications completed.", { hostUid, roomName, createdNotifications });
    }
);
