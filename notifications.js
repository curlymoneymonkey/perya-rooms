import { db, waitForAuthState } from "./firebase.js";

import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    onSnapshot,
    query,
    updateDoc,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const notificationRoot = document.getElementById("notificationRoot");
const notificationButton = document.getElementById("notificationButton");
const notificationBadge = document.getElementById("notificationBadge");
const notificationPanel = document.getElementById("notificationPanel");
const closeNotificationsButton = document.getElementById("closeNotificationsButton");
const notificationSummary = document.getElementById("notificationSummary");
const notificationMessage = document.getElementById("notificationMessage");
const notificationList = document.getElementById("notificationList");
const markAllNotificationsReadButton = document.getElementById("markAllNotificationsReadButton");
const clearNotificationsButton = document.getElementById("clearNotificationsButton");

let currentUser = null;
let notifications = [];
let recipientNotifications = new Map();
let uidNotifications = new Map();
let unsubscribeRecipientNotifications = null;
let unsubscribeUidNotifications = null;
let knownNotificationIds = new Set();
let initialSnapshotsReceived = 0;
let notificationAudioContext = null;
let notificationAudioUnlocked = false;

function requiredElementsExist() {
    return Boolean(
        notificationRoot &&
        notificationButton &&
        notificationBadge &&
        notificationPanel &&
        notificationSummary &&
        notificationMessage &&
        notificationList &&
        markAllNotificationsReadButton &&
        clearNotificationsButton
    );
}

function getNotificationAudioContext() {
    if (notificationAudioContext) return notificationAudioContext;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    notificationAudioContext = new AudioContextClass();
    return notificationAudioContext;
}

async function unlockNotificationSound() {
    const audioContext = getNotificationAudioContext();
    if (!audioContext) return;

    try {
        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }
        notificationAudioUnlocked = audioContext.state === "running";
    } catch (error) {
        console.debug("Notification sound is waiting for browser permission:", error);
    }
}

function playNotificationSound() {
    const audioContext = getNotificationAudioContext();
    if (!audioContext || !notificationAudioUnlocked || audioContext.state !== "running") return;

    const now = audioContext.currentTime;
    const masterGain = audioContext.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    masterGain.connect(audioContext.destination);

    const firstTone = audioContext.createOscillator();
    const secondTone = audioContext.createOscillator();

    firstTone.type = "sine";
    secondTone.type = "sine";
    firstTone.frequency.setValueAtTime(740, now);
    secondTone.frequency.setValueAtTime(988, now + 0.11);

    firstTone.connect(masterGain);
    secondTone.connect(masterGain);
    firstTone.start(now);
    firstTone.stop(now + 0.22);
    secondTone.start(now + 0.11);
    secondTone.stop(now + 0.45);
}

["pointerdown", "keydown", "touchstart"].forEach(eventName => {
    window.addEventListener(eventName, unlockNotificationSound, {
        once: true,
        passive: true
    });
});

function timestampMillis(value) {
    if (value?.toMillis) return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    return 0;
}

function formatTime(value) {
    const milliseconds = timestampMillis(value);
    if (!milliseconds) return "Just now";

    const difference = Date.now() - milliseconds;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (difference < minute) return "Just now";
    if (difference < hour) return `${Math.floor(difference / minute)}m ago`;
    if (difference < day) return `${Math.floor(difference / hour)}h ago`;
    if (difference < 7 * day) return `${Math.floor(difference / day)}d ago`;

    return new Date(milliseconds).toLocaleString([], {
        month: "short",
        day: "numeric",
        year: new Date(milliseconds).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
        hour: "numeric",
        minute: "2-digit"
    });
}

function notificationView(notification) {
    const type = String(notification.type || "").toLowerCase();

    if (["favorite_room_live", "favorite-room-live", "room_live"].includes(type)) {
        return {
            icon: "🔴",
            title: notification.title || `${notification.roomName || "A favorite room"} is LIVE!`,
            body: notification.message || "A room you saved has started a live session.",
            actionLabel: "🎲 Watch Room"
        };
    }

    if (type.includes("vouch") || type.includes("recommend")) {
        return {
            icon: "⭐",
            title: notification.title || "New vouch activity",
            body: notification.message || "Someone interacted with your vouches.",
            actionLabel: notification.profileUid || notification.hostUid ? "View Profile" : ""
        };
    }

    if (type.includes("review")) {
        return {
            icon: "📝",
            title: notification.title || "New review activity",
            body: notification.message || "There is new activity on a room review.",
            actionLabel: notification.profileUid || notification.hostUid ? "View Profile" : ""
        };
    }

    if (type.includes("restriction") || type.includes("suspend") || type.includes("moderation")) {
        return {
            icon: "🛡️",
            title: notification.title || "Account notice",
            body: notification.message || notification.reason || "A staff action was applied to your account.",
            actionLabel: ""
        };
    }

    if (type.includes("announcement") || type.includes("system")) {
        return {
            icon: "📢",
            title: notification.title || "PERYA DICE announcement",
            body: notification.message || "There is a new platform announcement.",
            actionLabel: notification.url ? "Open" : ""
        };
    }

    return {
        icon: "🔔",
        title: notification.title || "New notification",
        body: notification.message || "You have a new notification.",
        actionLabel: notification.url ? "Open" : ""
    };
}

function setPanelOpen(open) {
    if (!notificationPanel || !notificationButton) return;
    notificationPanel.hidden = !open;
    notificationButton.setAttribute("aria-expanded", String(open));
    notificationRoot?.classList.toggle("notificationOpen", open);
}

function setMessage(text, isError = false) {
    if (!notificationMessage) return;
    notificationMessage.textContent = text;
    notificationMessage.classList.toggle("notificationError", isError);
}

function updateBadge() {
    const unreadCount = notifications.filter(item => item.read !== true).length;

    notificationBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    notificationBadge.hidden = unreadCount === 0;
    notificationSummary.textContent = unreadCount === 0
        ? "No unread notifications"
        : `${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}`;

    markAllNotificationsReadButton.disabled = unreadCount === 0;
    clearNotificationsButton.disabled = notifications.length === 0;
}

async function markNotificationRead(notification) {
    if (!notification?.id || notification.read === true) return;

    try {
        await updateDoc(doc(db, "notifications", notification.id), { read: true });
    } catch (error) {
        console.error("Could not mark notification as read:", error);
        setMessage("Could not update this notification.", true);
    }
}

async function resolveNotificationDestination(notification) {
    if (notification.url) return notification.url;

    const type = String(notification.type || "").toLowerCase();
    const isLiveRoom = ["favorite_room_live", "favorite-room-live", "room_live"].includes(type);

    if (isLiveRoom) {
        if (notification.diceId) {
            return `room.html?id=${encodeURIComponent(notification.diceId)}`;
        }

        const roomDocumentId = notification.roomId || notification.hostUid || notification.ownerUid;
        if (roomDocumentId) {
            const roomSnapshot = await getDoc(doc(db, "permanentRooms", roomDocumentId));
            const diceId = roomSnapshot.exists() ? roomSnapshot.data().diceId : "";
            if (diceId) return `room.html?id=${encodeURIComponent(diceId)}`;
        }
    }

    const profileUid = notification.profileUid || notification.hostUid || notification.ownerUid;
    if ((type.includes("review") || type.includes("vouch")) && profileUid) {
        return `profile.html?id=${encodeURIComponent(profileUid)}`;
    }

    return "";
}

async function openNotification(notification) {
    setMessage("");
    await markNotificationRead(notification);

    try {
        const destination = await resolveNotificationDestination(notification);
        if (destination) window.location.href = destination;
    } catch (error) {
        console.error("Could not open notification destination:", error);
        setMessage("The notification was read, but its destination could not be opened.", true);
    }
}

function createNotificationItem(notification) {
    const view = notificationView(notification);
    const item = document.createElement("article");
    item.className = "notificationItem";
    item.classList.toggle("notificationUnread", notification.read !== true);

    const mainButton = document.createElement("button");
    mainButton.className = "notificationMainButton";
    mainButton.type = "button";
    mainButton.addEventListener("click", () => openNotification(notification));

    const icon = document.createElement("span");
    icon.className = "notificationItemIcon";
    icon.textContent = view.icon;

    const content = document.createElement("span");
    content.className = "notificationItemContent";

    const title = document.createElement("strong");
    title.className = "notificationItemTitle";
    title.textContent = view.title;

    const body = document.createElement("span");
    body.className = "notificationItemBody";
    body.textContent = view.body;

    const meta = document.createElement("span");
    meta.className = "notificationItemMeta";
    meta.textContent = formatTime(notification.createdAt);

    content.append(title, body, meta);

    if (view.actionLabel) {
        const action = document.createElement("span");
        action.className = "notificationActionLabel";
        action.textContent = view.actionLabel;
        content.appendChild(action);
    }

    mainButton.append(icon, content);

    const deleteButton = document.createElement("button");
    deleteButton.className = "notificationDeleteButton";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", "Delete notification");
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", async event => {
        event.stopPropagation();
        deleteButton.disabled = true;

        try {
            await deleteDoc(doc(db, "notifications", notification.id));
        } catch (error) {
            console.error("Could not delete notification:", error);
            deleteButton.disabled = false;
            setMessage("Could not delete this notification.", true);
        }
    });

    item.append(mainButton, deleteButton);
    return item;
}

function renderNotifications() {
    notificationList.innerHTML = "";
    updateBadge();

    if (notifications.length === 0) {
        const empty = document.createElement("div");
        empty.className = "notificationEmptyState";
        empty.innerHTML = "<span>🔕</span><strong>No notifications yet</strong><p>Updates about favorite rooms and account activity will appear here.</p>";
        notificationList.appendChild(empty);
        return;
    }

    notifications.forEach(notification => {
        notificationList.appendChild(createNotificationItem(notification));
    });
}

async function markAllRead() {
    const unread = notifications.filter(item => item.read !== true);
    if (!unread.length) return;

    markAllNotificationsReadButton.disabled = true;
    setMessage("Marking notifications as read...");

    try {
        for (let start = 0; start < unread.length; start += 450) {
            const batch = writeBatch(db);
            unread.slice(start, start + 450).forEach(item => {
                batch.update(doc(db, "notifications", item.id), { read: true });
            });
            await batch.commit();
        }
        setMessage("");
    } catch (error) {
        console.error("Could not mark all notifications as read:", error);
        setMessage("Could not mark all notifications as read.", true);
        markAllNotificationsReadButton.disabled = false;
    }
}

async function clearAllNotifications() {
    if (!notifications.length) return;

    const confirmed = window.confirm("Delete all notifications? This cannot be undone.");
    if (!confirmed) return;

    clearNotificationsButton.disabled = true;
    setMessage("Clearing notifications...");

    try {
        for (let start = 0; start < notifications.length; start += 450) {
            const batch = writeBatch(db);
            notifications.slice(start, start + 450).forEach(item => {
                batch.delete(doc(db, "notifications", item.id));
            });
            await batch.commit();
        }
        setMessage("");
    } catch (error) {
        console.error("Could not clear notifications:", error);
        setMessage("Could not clear all notifications.", true);
        clearNotificationsButton.disabled = false;
    }
}

function mergeAndRenderNotifications() {
    const merged = new Map([...recipientNotifications, ...uidNotifications]);
    const nextNotifications = [...merged.values()]
        .filter(item => item.recipientUid === currentUser.uid || item.uid === currentUser.uid)
        .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));

    const nextIds = new Set(nextNotifications.map(item => item.id));
    const initialLoadComplete = initialSnapshotsReceived >= 2;

    if (initialLoadComplete) {
        const hasNewUnread = nextNotifications.some(item =>
            !knownNotificationIds.has(item.id) && item.read !== true
        );

        if (hasNewUnread && knownNotificationIds.size > 0) {
            playNotificationSound();
            notificationButton?.classList.remove("notificationBellPulse");
            void notificationButton?.offsetWidth;
            notificationButton?.classList.add("notificationBellPulse");
        }
    }

    notifications = nextNotifications;
    knownNotificationIds = nextIds;
    setMessage("");
    renderNotifications();
}

function attachNotificationQuery(fieldName, targetMap, onReady) {
    const notificationsQuery = query(
        collection(db, "notifications"),
        where(fieldName, "==", currentUser.uid)
    );

    return onSnapshot(
        notificationsQuery,
        snapshot => {
            targetMap.clear();
            snapshot.docs.forEach(item => {
                targetMap.set(item.id, { id: item.id, ...item.data() });
            });
            onReady();
            mergeAndRenderNotifications();
        },
        error => {
            console.warn(`Notification query using ${fieldName} failed:`, error);
            onReady();
            mergeAndRenderNotifications();

            if (recipientNotifications.size === 0 && uidNotifications.size === 0) {
                setMessage(
                    `Could not load notifications. Firestore rejected the ${fieldName} query. Check your notification read rules.`,
                    true
                );
            }
        }
    );
}

function startNotificationsListener() {
    unsubscribeRecipientNotifications?.();
    unsubscribeUidNotifications?.();

    recipientNotifications = new Map();
    uidNotifications = new Map();
    knownNotificationIds = new Set();
    initialSnapshotsReceived = 0;

    const markSnapshotReady = () => {
        initialSnapshotsReceived = Math.min(2, initialSnapshotsReceived + 1);
    };

    // Your Cloud Function currently writes both recipientUid and uid.
    // Listening to both makes the UI work with either Firestore rule style.
    unsubscribeRecipientNotifications = attachNotificationQuery(
        "recipientUid",
        recipientNotifications,
        markSnapshotReady
    );

    unsubscribeUidNotifications = attachNotificationQuery(
        "uid",
        uidNotifications,
        markSnapshotReady
    );
}

notificationButton?.addEventListener("click", event => {
    event.stopPropagation();
    setPanelOpen(notificationPanel.hidden);
});

closeNotificationsButton?.addEventListener("click", () => setPanelOpen(false));
markAllNotificationsReadButton?.addEventListener("click", markAllRead);
clearNotificationsButton?.addEventListener("click", clearAllNotifications);
notificationPanel?.addEventListener("click", event => event.stopPropagation());
document.addEventListener("click", () => setPanelOpen(false));
document.addEventListener("keydown", event => {
    if (event.key === "Escape") setPanelOpen(false);
});

async function initializeNotifications() {
    if (!requiredElementsExist()) {
        console.error("Notification center HTML is incomplete. One or more required element IDs are missing.");
        return;
    }

    currentUser = await waitForAuthState();

    if (!currentUser || currentUser.isAnonymous) {
        notificationRoot.hidden = true;
        return;
    }

    console.info("Notification center signed in as:", currentUser.uid);
    notificationRoot.hidden = false;
    renderNotifications();
    startNotificationsListener();
}

initializeNotifications().catch(error => {
    console.error("Notification center failed:", error);
    if (notificationRoot) notificationRoot.hidden = true;
});

window.addEventListener("beforeunload", () => {
    unsubscribeRecipientNotifications?.();
    unsubscribeUidNotifications?.();
});
