const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

const { initializeApp } = require("firebase-admin/app");
const {
    getFirestore,
    FieldValue
} = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

setGlobalOptions({
    region: "asia-southeast1",
    maxInstances: 10
});

const LIVE_NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000;
const FIRESTORE_BATCH_LIMIT = 450;

/**
 * Creates notifications whenever a permanent room changes
 * from offline to live.
 *
 * Watched path:
 * permanentRooms/{hostUid}
 */
exports.notifyFavoriteUsersWhenRoomGoesLive = onDocumentUpdated(
    "permanentRooms/{hostUid}",
    async event => {
        const beforeSnapshot = event.data?.before;
        const afterSnapshot = event.data?.after;

        if (!beforeSnapshot || !afterSnapshot) {
            logger.warn("Missing before or after room snapshot.");
            return;
        }

        const before = beforeSnapshot.data();
        const after = afterSnapshot.data();

        // Only continue when isLive changes from false/not-live to true.
        const wasLive = before?.isLive === true;
        const isLiveNow = after?.isLive === true;

        if (wasLive || !isLiveNow) {
            return;
        }

        const hostUid = event.params.hostUid;
        const roomRef = afterSnapshot.ref;

        // Confirm the room belongs to the document owner.
        if (after.ownerUid && after.ownerUid !== hostUid) {
            logger.error("Room owner does not match document ID.", {
                hostUid,
                ownerUid: after.ownerUid
            });
            return;
        }

        // Prevent duplicate notifications when a host repeatedly
        // switches the room offline and online.
        const lastNotificationMillis =
            after.lastLiveNotificationAt?.toMillis?.() || 0;

        if (
            lastNotificationMillis > 0 &&
            Date.now() - lastNotificationMillis <
                LIVE_NOTIFICATION_COOLDOWN_MS
        ) {
            logger.info("Live notification skipped because of cooldown.", {
                hostUid
            });
            return;
        }

        const roomName =
            String(after.roomName || "Permanent Room").trim() ||
            "Permanent Room";

        const diceId = String(after.diceId || "").trim();

        /*
         * Searches all subcollections named favoriteRooms:
         *
         * users/{viewerUid}/favoriteRooms/{hostUid}
         */
        const favoritesSnapshot = await db
            .collectionGroup("favoriteRooms")
            .where("roomId", "==", hostUid)
            .get();

        let batch = db.batch();
        let pendingWrites = 0;
        let createdNotifications = 0;

        for (const favoriteDocument of favoritesSnapshot.docs) {
            const favorite = favoriteDocument.data();

            const viewerUid =
                String(favorite.userUid || "").trim() ||
                favoriteDocument.ref.parent.parent?.id ||
                "";

            if (!viewerUid) {
                logger.warn("Favorite document has no viewer UID.", {
                    path: favoriteDocument.ref.path
                });
                continue;
            }

            // The host should never receive their own room notification.
            if (viewerUid === hostUid) {
                continue;
            }

            const notificationRef = db
                .collection("notifications")
                .doc();

            batch.set(notificationRef, {
                uid: viewerUid,
                recipientUid: viewerUid,

                type: "favorite_room_live",

                title: `${roomName} is LIVE!`,
                message:
                    "A room in your favorites has started a live session.",

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

            /*
             * Firestore batches support up to 500 writes.
             * Commit early to leave a safety margin.
             */
            if (pendingWrites >= FIRESTORE_BATCH_LIMIT) {
                await batch.commit();
                batch = db.batch();
                pendingWrites = 0;
            }
        }

        /*
         * Store the cooldown timestamp on the room.
         * Updating this field triggers the function again, but the next
         * execution exits because isLive did not change from false to true.
         */
        batch.update(roomRef, {
            lastLiveNotificationAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        logger.info("Favorite-room live notifications completed.", {
            hostUid,
            roomName,
            createdNotifications
        });
    }
);