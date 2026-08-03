import { authReady, db, realtimeDb } from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    onDisconnect,
    onValue,
    push,
    ref,
    remove,
    set
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const diceImages = [
    "images/red.png",
    "images/blue.png",
    "images/green.png",
    "images/yellow.png",
    "images/purple.png",
    "images/orange.png"
];
const whiteDiceImage = "images/white.png";
const rollSound = new Audio("sounds/dice-roll.mp3");
rollSound.volume = 0.6;
const AUTO_OFFLINE_MS = 60 * 60 * 1000;

const roomLoading = document.getElementById("roomLoading");
const roomScreen = document.getElementById("permanentRoom");
const roomNameText = document.getElementById("permanentRoomName");
const diceIdText = document.getElementById("permanentDiceId");
const roomViewerCounts = document.querySelectorAll(".roomViewerCountValue");
const publicRoomViewerRow = document.getElementById("publicRoomViewerRow");
const hostRoomViewerRow = document.getElementById("hostRoomViewerRow");
const hostHistoryToolbar = document.getElementById("hostHistoryToolbar");
const hostText = document.getElementById("permanentHost");
const gameText = document.getElementById("permanentGame");
const platformText = document.getElementById("permanentPlatform");
const hostDiceCountControl = document.getElementById("hostDiceCountControl");
const viewerRoomInformation = document.getElementById("viewerRoomInformation");
const permanentRoomCard = document.getElementById("permanentRoomCard");
const ignText = document.getElementById("permanentIgn");
const ignRow = document.getElementById("permanentIgnRow");
const ignInput = document.getElementById("ignInput");
const saveIgnButton = document.getElementById("saveIgnButton");
const descriptionText = document.getElementById("permanentDescription");
const liveStatusText = document.getElementById("permanentLiveStatus");
const hostControlPanel = document.getElementById("hostControlPanel");
const liveToggleButton = document.getElementById("liveToggleButton");
const toggleHostControls = document.getElementById("togglePermanentHostControls");
const streamLinkInput = document.getElementById("streamLinkInput");
const viewerStreamSection = document.getElementById("viewerStreamSection");
const viewerStreamFrame = document.getElementById("viewerStreamFrame");
const viewerStreamPlayer = document.getElementById("viewerStreamPlayer");
const viewerStreamFrameLink = document.getElementById("viewerStreamFrameLink");
const viewerStreamHeading = document.getElementById("viewerStreamHeading");
const viewerStreamFallback = document.getElementById("viewerStreamFallback");
const viewerStreamOpenButton = document.getElementById("viewerStreamOpenButton");
const viewerTikTokCard = document.getElementById("viewerTikTokCard");
const viewerTikTokUsername = document.getElementById("viewerTikTokUsername");
const hostControlMessage = document.getElementById("hostControlMessage");
const hostSettings = document.getElementById("permanentHostSettings");
const diceCountSelect = document.getElementById("permanentDiceCount");
const diceCountDisplay = document.getElementById("diceCountDisplay");
const decreaseDiceCountButton = document.getElementById("decreaseDiceCount");
const increaseDiceCountButton = document.getElementById("increaseDiceCount");
const rollStatus = document.getElementById("permanentRollStatus");
const results = document.getElementById("permanentResults");
const rollButton = document.getElementById("permanentRollButton");
const waitingText = document.getElementById("permanentWaitingText");
const history = document.getElementById("permanentHistory");
const hostDiceBlurControl = document.getElementById("hostDiceBlurControl");
const hostDiceBlurCheckbox = document.getElementById("hostDiceBlurCheckbox");
const roomFavoriteCount = document.getElementById("roomFavoriteCount");
const favoriteRoomButton = document.getElementById("favoriteRoomButton");
const favoriteRoomMessage = document.getElementById("favoriteRoomMessage");
const favoriteCountDisplay = document.getElementById("favoriteCountDisplay");
const customerOrdersBox = document.getElementById("customerOrdersBox");
const customerOrdersList = document.getElementById("customerOrdersList");
const customerOrderSearchWrap = document.getElementById("customerOrderSearchWrap");
const customerOrderSearch = document.getElementById("customerOrderSearch");
const customerOrdersTitle = document.getElementById("customerOrdersTitle");
const customerOrdersSummary = document.getElementById("customerOrdersSummary");

const reviewTrustSummary = document.getElementById("reviewTrustSummary");
const reviewBreakdown = document.getElementById("reviewBreakdown");
const reviewsList = document.getElementById("reviewsList");
const openReviewModalButton = document.getElementById("openReviewModalButton");
const reviewEligibilityMessage = document.getElementById("reviewEligibilityMessage");
const reviewModal = document.getElementById("reviewModal");
const closeReviewModalButton = document.getElementById("closeReviewModalButton");
const cancelReviewButton = document.getElementById("cancelReviewButton");
const vouchButton = document.getElementById("vouchButton");
const notVouchButton = document.getElementById("notVouchButton");
const reviewTextInput = document.getElementById("reviewTextInput");
const reviewCharacterCount = document.getElementById("reviewCharacterCount");
const reviewFormMessage = document.getElementById("reviewFormMessage");
const submitReviewButton = document.getElementById("submitReviewButton");

const removalRequestModal = document.getElementById("removalRequestModal");
const closeRemovalRequestModalButton = document.getElementById("closeRemovalRequestModalButton");
const cancelRemovalRequestButton = document.getElementById("cancelRemovalRequestButton");
const removalReasonSelect = document.getElementById("removalReasonSelect");
const removalDetailsInput = document.getElementById("removalDetailsInput");
const removalDetailsCount = document.getElementById("removalDetailsCount");
const removalRequestMessage = document.getElementById("removalRequestMessage");
const submitRemovalRequestButton = document.getElementById("submitRemovalRequestButton");


for (let amount = 1; amount <= 15; amount++) {
    const option = document.createElement("option");
    option.value = String(amount);
    option.textContent = `${amount} ${amount === 1 ? "Die" : "Dice"}`;
    diceCountSelect.appendChild(option);
}

let currentUser = null;
let roomRef = null;
let currentRoom = null;
let isHost = false;
let animationTimer = null;
let rollingLocally = false;
let hostControlsHidden = false;
let creatingNextRolls = false;
let currentReviews = [];
let myReview = null;
let selectedVouch = null;
let reviewsUnsubscribe = null;
let currentUsername = "Player";
let currentAccount = {};
let accountUnsubscribe = null;

let currentRemovalRequests = new Map();
let removalRequestsUnsubscribe = null;
let selectedRemovalReview = null;

let vouchCooldownUntil = 0;
let vouchCooldownUnsubscribe = null;
let favoriteUnsubscribe = null;
let roomIsFavorite = false;
let favoriteSaving = false;
let customerOrdersUnsubscribe = null;
let currentCustomerOrders = [];
let customerOrderActionRunning = false;

let viewerPresenceRef = null;
let viewerCountUnsubscribe = null;
let viewerConnectionUnsubscribe = null;
let activeViewerRoomId = "";


/* =========================================================
   LIVE ROOM VIEWER COUNT
========================================================= */

async function stopViewerPresence() {
    if (viewerConnectionUnsubscribe) {
        viewerConnectionUnsubscribe();
        viewerConnectionUnsubscribe = null;
    }

    if (viewerCountUnsubscribe) {
        viewerCountUnsubscribe();
        viewerCountUnsubscribe = null;
    }

    if (viewerPresenceRef) {
        try {
            await onDisconnect(viewerPresenceRef).cancel();
            await remove(viewerPresenceRef);
        } catch (error) {
            console.warn("Could not remove viewer presence:", error);
        }
    }

    viewerPresenceRef = null;
    activeViewerRoomId = "";
}

async function startViewerPresence(diceId) {
    const cleanedDiceId = cleanDiceId(diceId);
    if (!cleanedDiceId || !currentUser?.uid) return;
    if (activeViewerRoomId === cleanedDiceId && viewerPresenceRef) return;

    await stopViewerPresence();
    activeViewerRoomId = cleanedDiceId;

    const viewersRef = ref(realtimeDb, `roomViewers/${cleanedDiceId}`);
    viewerPresenceRef = push(viewersRef);

    viewerCountUnsubscribe = onValue(viewersRef, snapshot => {
        roomViewerCounts.forEach(element => {
            element.textContent = String(snapshot.size || 0);
        });
    }, error => {
        console.error("Could not read viewer count:", error);
        roomViewerCounts.forEach(element => {
            element.textContent = "—";
        });
    });

    const connectedRef = ref(realtimeDb, ".info/connected");
    viewerConnectionUnsubscribe = onValue(connectedRef, async snapshot => {
        if (snapshot.val() !== true || !viewerPresenceRef) return;

        try {
            await onDisconnect(viewerPresenceRef).remove();
            await set(viewerPresenceRef, {
                uid: currentUser.uid,
                joinedAt: Date.now()
            });
        } catch (error) {
            console.error("Could not register room viewer:", error);
        }
    });
}

/* =========================================================
   PERYA CUSTOM POPUP SYSTEM
========================================================= */

let activePeryaPopupResolver = null;
let previousPeryaPopupFocus = null;

function peryaPopupElements() {
    return {
        overlay: document.getElementById("peryaPopupOverlay"),
        icon: document.getElementById("peryaPopupIcon"),
        title: document.getElementById("peryaPopupTitle"),
        message: document.getElementById("peryaPopupMessage"),
        input: document.getElementById("peryaPopupInput"),
        cancelButton: document.getElementById("peryaPopupCancelButton"),
        confirmButton: document.getElementById("peryaPopupConfirmButton")
    };
}

function closePeryaPopup(result) {
    const elements = peryaPopupElements();

    if (!elements.overlay || elements.overlay.hidden) return;

    elements.overlay.hidden = true;
    document.body.classList.remove("peryaPopupOpen");

    const resolver = activePeryaPopupResolver;
    activePeryaPopupResolver = null;

    if (
        previousPeryaPopupFocus
        && typeof previousPeryaPopupFocus.focus === "function"
    ) {
        previousPeryaPopupFocus.focus();
    }

    previousPeryaPopupFocus = null;
    resolver?.(result);
}

function openPeryaPopup({
    type = "info",
    title = "Notice",
    message = "",
    mode = "message",
    defaultValue = "",
    confirmText = "OK",
    cancelText = "Cancel",
    placeholder = ""
} = {}) {
    const elements = peryaPopupElements();

    if (
        !elements.overlay
        || !elements.icon
        || !elements.title
        || !elements.message
        || !elements.input
        || !elements.cancelButton
        || !elements.confirmButton
    ) {
        console.error("PERYA popup HTML is missing.");
        return Promise.resolve(mode === "choice" ? false : null);
    }

    if (activePeryaPopupResolver) {
        closePeryaPopup(null);
    }

    const icons = {
        success: "✅",
        error: "❌",
        warning: "⚠️",
        info: "ℹ️",
        choice: "❓",
        input: "✏️"
    };

    previousPeryaPopupFocus = document.activeElement;

    elements.overlay.dataset.type = type;
    elements.icon.textContent = icons[type] || icons.info;
    elements.title.textContent = title;
    elements.message.textContent = String(message || "");

    elements.input.hidden = mode !== "input";
    elements.input.value = String(defaultValue || "");
    elements.input.placeholder = placeholder;

    elements.cancelButton.hidden = mode === "message";
    elements.cancelButton.textContent = cancelText;
    elements.confirmButton.textContent = confirmText;

    elements.overlay.hidden = false;
    document.body.classList.add("peryaPopupOpen");

    window.setTimeout(() => {
        if (mode === "input") {
            elements.input.focus();
            elements.input.select();
        } else {
            elements.confirmButton.focus();
        }
    }, 0);

    return new Promise(resolve => {
        activePeryaPopupResolver = resolve;

        elements.confirmButton.onclick = () => {
            closePeryaPopup(
                mode === "input"
                    ? elements.input.value
                    : true
            );
        };

        elements.cancelButton.onclick = () => {
            closePeryaPopup(mode === "choice" ? false : null);
        };

        elements.overlay.onclick = event => {
            if (event.target === elements.overlay && mode !== "message") {
                closePeryaPopup(mode === "choice" ? false : null);
            }
        };
    });
}

function showPeryaAlert(message, {
    type = "info",
    title,
    buttonText = "OK"
} = {}) {
    const defaultTitles = {
        success: "Success",
        error: "Error",
        warning: "Warning",
        info: "Notice"
    };

    return openPeryaPopup({
        type,
        title: title || defaultTitles[type] || "Notice",
        message,
        mode: "message",
        confirmText: buttonText
    });
}

function showPeryaConfirm(message, {
    title = "Please Confirm",
    confirmText = "Confirm",
    cancelText = "Cancel"
} = {}) {
    return openPeryaPopup({
        type: "choice",
        title,
        message,
        mode: "choice",
        confirmText,
        cancelText
    });
}

function showPeryaPrompt(message, {
    title = "Enter Information",
    defaultValue = "",
    placeholder = "",
    confirmText = "Submit",
    cancelText = "Cancel"
} = {}) {
    return openPeryaPopup({
        type: "input",
        title,
        message,
        mode: "input",
        defaultValue,
        placeholder,
        confirmText,
        cancelText
    });
}

document.addEventListener("keydown", event => {
    const elements = peryaPopupElements();

    if (!elements.overlay || elements.overlay.hidden) return;

    if (event.key === "Escape") {
        event.preventDefault();

        closePeryaPopup(
            elements.cancelButton.hidden
                ? true
                : null
        );
    }

    if (
        event.key === "Enter"
        && document.activeElement === elements.input
        && !elements.input.hidden
    ) {
        event.preventDefault();
        elements.confirmButton.click();
    }
});




if (toggleHostControls) {
    toggleHostControls.addEventListener("click", () => {
        hostControlsHidden = !hostControlsHidden;

        if (hostControlPanel) {
            hostControlPanel.hidden = !isHost || hostControlsHidden;
        }

        toggleHostControls.textContent = hostControlsHidden
            ? "Show Host Controls"
            : "Hide Host Controls";
    });
}


function accountRestrictionMessage(action = "use this feature") {
    const reason = String(currentAccount?.restrictionReason || "").trim();
    if (currentAccount?.accountSuspended === true) {
        return `Your account is suspended${reason ? `: ${reason}` : "."}`;
    }
    if (action === "roll" && currentAccount?.rollingRestricted === true) {
        return `You are not allowed to roll dice${reason ? `: ${reason}` : "."}`;
    }
    if (action === "review" && currentAccount?.reviewsRestricted === true) {
        return `You are not allowed to submit vouches${reason ? `: ${reason}` : "."}`;
    }
    return "";
}

function listenForAccountRestrictions() {
    if (accountUnsubscribe) accountUnsubscribe();
    if (!currentUser || currentUser.isAnonymous) {
        currentAccount = {};
        return;
    }

    const userRef = doc(db, "users", currentUser.uid);
    accountUnsubscribe = onSnapshot(userRef, snapshot => {
        currentAccount = snapshot.exists() ? snapshot.data() : {};
        if (currentRoom) renderRoom(currentRoom);
        if (currentReviews) renderReviews();
    }, error => {
        console.error("Could not load account restrictions:", error);
    });
}

function cleanDiceId(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}
function clampDiceCount(value) {
    return Math.min(15, Math.max(1, Number(value) || 3));
}
function generateDice(amount) {
    return Array.from({ length: amount }, () => Math.floor(Math.random() * diceImages.length));
}

function encodeRoll(values) {
    return values.join(",");
}

function decodeStoredRoll(value) {
    if (Array.isArray(value)) {
        return value
            .map(Number)
            .filter(number => Number.isInteger(number) && diceImages[number]);
    }

    return String(value || "")
        .split(",")
        .map(Number)
        .filter(number => Number.isInteger(number) && diceImages[number]);
}

function generateNextRolls(amount, total = 10) {
    return Array.from(
        { length: total },
        () => encodeRoll(generateDice(amount))
    );
}

function prepareNextRolls(storedRolls, amount) {
    const validRolls = Array.isArray(storedRolls)
        ? storedRolls
            .map(roll => encodeRoll(decodeStoredRoll(roll)))
            .filter(roll => decodeStoredRoll(roll).length === amount)
        : [];

    while (validRolls.length < 10) {
        validRolls.push(encodeRoll(generateDice(amount)));
    }

    return validRolls.slice(0, 10);
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function createImage(source, className) {
    const image = document.createElement("img");
    image.src = source;
    image.className = className;
    image.alt = "Dice";
    return image;
}
function showDice(container, values, className = "dice") {
    container.innerHTML = "";
    values.forEach(value => {
        if (diceImages[value]) container.appendChild(createImage(diceImages[value], className));
    });
}
function showWhiteDice(amount) {
    results.innerHTML = "";
    for (let i = 0; i < amount; i++) results.appendChild(createImage(whiteDiceImage, "dice"));
}
function startAnimation(amount) {
    stopAnimation();
    animationTimer = window.setInterval(() => showDice(results, generateDice(amount), "dice shake"), 100);
}
function stopAnimation() {
    if (animationTimer !== null) {
        clearInterval(animationTimer);
        animationTimer = null;
    }
}
function renderHistory(room) {
    history.innerHTML = "";
    const rows = Array.isArray(room.history) ? room.history.slice(-8).reverse() : [];
    if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "emptyHistory";
        empty.textContent = "No rolls yet.";
        history.appendChild(empty);
        return;
    }
    rows.forEach(encoded => {
        const values = String(encoded).split(",").map(Number).filter(value => diceImages[value]);
        const row = document.createElement("div");
        row.className = "historyRow";
        showDice(row, values, "historyDice");
        history.appendChild(row);
    });
}
function timestampMillis(timestamp) {
    return timestamp && typeof timestamp.toMillis === "function" ? timestamp.toMillis() : 0;
}
async function enforceAutoOffline(room) {
    if (!isHost || room.isLive !== true || !roomRef) return;

    const liveStartedAt = timestampMillis(room.liveStartedAt);

    // Wait until the current live session has a valid start time.
    // This prevents an old dice roll from immediately forcing a newly-live room offline.
    if (!liveStartedAt) return;

    const lastRollAt = timestampMillis(room.lastRollAt);
    const lastActivity = Math.max(liveStartedAt, lastRollAt);

    if (Date.now() - lastActivity >= AUTO_OFFLINE_MS) {
        await updateDoc(roomRef, {
            isLive: false,
            liveEndedAt: Timestamp.now(),
            updatedAt: serverTimestamp()
        });
    }
}

async function ensureNextRolls(room, amount) {
    if (!isHost || creatingNextRolls || room.rolling) return;

    const current = Array.isArray(room.nextRolls) ? room.nextRolls : [];
    const needsUpdate =
        current.length !== 10 ||
        current.some(roll => decodeStoredRoll(roll).length !== amount);

    if (!needsUpdate) return;

    creatingNextRolls = true;

    try {
        await updateDoc(roomRef, {
            nextRolls: prepareNextRolls(current, amount),
            updatedAt: serverTimestamp()
        });
    } finally {
        creatingNextRolls = false;
    }
}


function normalizeOrderStatus(status) {
    if (!status || status === "pending_verification") return "order_sent";
    if (status === "approved") return "completed";
    return String(status);
}

function customerOrderTime(order) {
    return order.createdAt?.toMillis?.()
        || order.updatedAt?.toMillis?.()
        || 0;
}

function customerOrderItems(order) {
    if (Array.isArray(order.items) && order.items.length) {
        return order.items;
    }

    return [{
        productId: order.productId,
        productName: order.productName || "Unknown Product",
        quantity: Number(order.quantity || 0),
        price: Number(order.price || 0),
        subtotal: Number(order.totalAmount || 0)
    }];
}

function formatCustomerOrderPrice(value) {
    const amount = Number(value || 0);

    return amount.toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function formatCustomerPaymentMethod(value) {
    const method = String(value || "").trim().toLowerCase();

    if (method === "gcash") return "GCash";
    if (method === "maya") return "Maya";
    if (method === "paypal") return "PayPal";

    return method ? method.charAt(0).toUpperCase() + method.slice(1) : "Not provided";
}

function formatCustomerPaymentDateTime(dateValue, timeValue) {
    if (!dateValue && !timeValue) return "Not provided";

    const rawDate = String(dateValue || "").trim();
    const rawTime = String(timeValue || "").trim();
    const parsed = new Date(`${rawDate || "1970-01-01"}T${rawTime || "00:00"}`);

    if (Number.isNaN(parsed.getTime())) {
        return [rawDate, rawTime].filter(Boolean).join(" • ");
    }

    return parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function formatCustomerOrderTime(value) {
    if (!value?.toDate) return "Time unavailable";

    return value.toDate().toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function customerOrderBuyerName(order) {
    return String(
        order.buyerUsername
        || order.buyerIgn
        || order.ign
        || "Not provided"
    ).trim();
}

function setCustomerOrderButtonsDisabled(disabled) {
    customerOrdersList
        ?.querySelectorAll(".customerOrderActionButton")
        .forEach(button => {
            button.disabled = disabled;
        });
}

async function completeCustomerOrder(order) {
    if (!isHost || customerOrderActionRunning) return;
    if (!(await showPeryaConfirm("Mark this order as completed?", {
        title: "Complete Order",
        confirmText: "Complete",
        cancelText: "Cancel"
    }))) return;

    customerOrderActionRunning = true;
    setCustomerOrderButtonsDisabled(true);
    customerOrdersSummary.textContent = "Completing order...";

    try {
        const orderRef = doc(
            db,
            "users",
            currentRoom.ownerUid,
            "orders",
            order.id
        );

        await runTransaction(db, async transaction => {
            const orderSnapshot = await transaction.get(orderRef);

            if (!orderSnapshot.exists()) {
                throw new Error("This order no longer exists.");
            }

            const latestOrder = {
                id: orderSnapshot.id,
                ...orderSnapshot.data()
            };

            if (normalizeOrderStatus(latestOrder.status) !== "order_sent") {
                throw new Error("This order has already been reviewed.");
            }

            // Older orders may not have reserved their stock at checkout.
            if (!latestOrder.stockReserved) {
                const latestItems = customerOrderItems(latestOrder);
                const productReads = [];

                for (const item of latestItems) {
                    if (!item.productId) {
                        throw new Error("An ordered product ID is missing.");
                    }

                    const productRef = doc(
                        db,
                        "users",
                        currentRoom.ownerUid,
                        "shopProducts",
                        item.productId
                    );

                    productReads.push({
                        item,
                        productRef,
                        productSnapshot: await transaction.get(productRef)
                    });
                }

                for (const { item, productRef, productSnapshot } of productReads) {
                    if (!productSnapshot.exists()) {
                        throw new Error(
                            `${item.productName || "A product"} no longer exists.`
                        );
                    }

                    const stock = Number(productSnapshot.data().stock || 0);
                    const quantity = Number(item.quantity || 0);

                    if (
                        !Number.isInteger(quantity)
                        || quantity < 1
                        || stock < quantity
                    ) {
                        throw new Error(
                            `There is not enough stock for ${item.productName || "one of the products"}.`
                        );
                    }

                    transaction.update(productRef, {
                        stock: stock - quantity,
                        updatedAt: serverTimestamp()
                    });
                }
            }

            transaction.update(orderRef, {
                status: "completed",
                stockReserved: true,
                completedAt: serverTimestamp(),
                reviewedAt: serverTimestamp(),
                reviewedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });
        });
    } catch (error) {
        console.error("Could not complete order:", error);
        await showPeryaAlert(
            error.message || "Could not complete this order.",
            { type: "error", title: "Order Error" }
        );
    } finally {
        customerOrderActionRunning = false;
        renderCustomerOrders();
    }
}

async function rejectCustomerOrder(order) {
    if (!isHost || customerOrderActionRunning) return;

    const reason = await showPeryaPrompt(
        `Reason for rejecting "${customerOrderBuyerName(order)}" (optional):`,
        {
            title: "Reject Order",
            placeholder: "Enter a reason (optional)",
            confirmText: "Reject",
            cancelText: "Cancel"
        }
    );

    if (reason === null) return;

    customerOrderActionRunning = true;
    setCustomerOrderButtonsDisabled(true);
    customerOrdersSummary.textContent = "Rejecting order...";

    try {
        const orderRef = doc(
            db,
            "users",
            currentRoom.ownerUid,
            "orders",
            order.id
        );

        await runTransaction(db, async transaction => {
            const orderSnapshot = await transaction.get(orderRef);

            if (!orderSnapshot.exists()) {
                throw new Error("This order no longer exists.");
            }

            const latestOrder = {
                id: orderSnapshot.id,
                ...orderSnapshot.data()
            };

            if (normalizeOrderStatus(latestOrder.status) !== "order_sent") {
                throw new Error("This order has already been reviewed.");
            }

            const latestItems = customerOrderItems(latestOrder);
            const productReads = [];

            if (latestOrder.stockReserved === true) {
                for (const item of latestItems) {
                    if (!item.productId) {
                        throw new Error("An ordered product ID is missing.");
                    }

                    const productRef = doc(
                        db,
                        "users",
                        currentRoom.ownerUid,
                        "shopProducts",
                        item.productId
                    );

                    const reservationId =
                        item.reservationId
                        || `${latestOrder.id}_${item.productId}`;

                    const reservationRef = doc(
                        db,
                        "users",
                        currentRoom.ownerUid,
                        "stockReservations",
                        reservationId
                    );

                    productReads.push({
                        item,
                        productRef,
                        productSnapshot: await transaction.get(productRef),
                        reservationRef,
                        reservationSnapshot: await transaction.get(reservationRef)
                    });
                }

                for (const entry of productReads) {
                    const {
                        item,
                        productRef,
                        productSnapshot,
                        reservationRef,
                        reservationSnapshot
                    } = entry;

                    if (!productSnapshot.exists()) {
                        throw new Error(
                            `${item.productName || "A product"} no longer exists.`
                        );
                    }

                    const quantity = Number(item.quantity || 0);
                    const currentStock = Number(productSnapshot.data().stock || 0);

                    if (!Number.isInteger(quantity) || quantity < 1) {
                        throw new Error("An ordered quantity is invalid.");
                    }

                    if (
                        !reservationSnapshot.exists()
                        || reservationSnapshot.data().status === "reserved"
                    ) {
                        transaction.update(productRef, {
                            stock: currentStock + quantity,
                            updatedAt: serverTimestamp()
                        });
                    }

                    if (reservationSnapshot.exists()) {
                        transaction.update(reservationRef, {
                            status: "released",
                            releasedAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        });
                    }
                }
            }

            transaction.update(orderRef, {
                status: "rejected",
                rejectionReason: reason.trim().slice(0, 300),
                stockRestored: latestOrder.stockReserved === true,
                reviewedAt: serverTimestamp(),
                reviewedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });
        });
    } catch (error) {
        console.error("Could not reject order:", error);
        await showPeryaAlert(
            error.message || "Could not reject this order.",
            { type: "error", title: "Order Error" }
        );
    } finally {
        customerOrderActionRunning = false;
        renderCustomerOrders();
    }
}


async function copyCustomerUsername(username, button) {
    const text = String(username || "").trim();

    if (!text || text === "Not provided") {
        await showPeryaAlert(
            "No customer username was provided.",
            { type: "warning", title: "Username Unavailable" }
        );
        return;
    }

    const originalText = button.textContent;
    button.disabled = true;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const temporaryInput = document.createElement("textarea");
            temporaryInput.value = text;
            temporaryInput.setAttribute("readonly", "");
            temporaryInput.style.position = "fixed";
            temporaryInput.style.opacity = "0";
            document.body.appendChild(temporaryInput);
            temporaryInput.select();

            const copied = document.execCommand("copy");
            temporaryInput.remove();

            if (!copied) {
                throw new Error("Copy command failed.");
            }
        }

        button.textContent = "✓ Copied";
        button.classList.add("copied");
    } catch (error) {
        console.error("Could not copy customer username:", error);
        button.textContent = "Copy failed";
    } finally {
        window.setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove("copied");
            button.disabled = false;
        }, 1400);
    }
}

function customerOrderStatusDetails(order) {
    const status = normalizeOrderStatus(order.status);

    if (status === "completed") {
        return {
            label: "✅ Completed",
            className: "statusCompleted",
            note: "The seller marked this order as completed."
        };
    }

    if (status === "rejected") {
        return {
            label: "❌ Rejected",
            className: "statusRejected",
            note: "The seller could not complete this order."
        };
    }

    return {
        label: "⏳ Pending",
        className: "statusPending",
        note: "The order was sent and is waiting for the seller."
    };
}

function renderCustomerOrders() {
    if (!customerOrdersList || !customerOrdersSummary) return;

    customerOrdersList.innerHTML = "";

    if (customerOrdersTitle) {
        customerOrdersTitle.textContent = isHost ? "Customer Orders" : "Order Tracking";
    }

    if (customerOrderSearchWrap) customerOrderSearchWrap.hidden = !isHost;
    const searchTerm = String(customerOrderSearch?.value || "").trim().toUpperCase();

    const matchingOrders = [...currentCustomerOrders]
        .filter(order => {
            if (isHost) return true;
            const status = normalizeOrderStatus(order.status);
            return status === "order_sent" || order.buyerUid === currentUser?.uid;
        })
        .filter(order => {
            if (!isHost || !searchTerm) return true;
            const buyer = customerOrderBuyerName(order).toUpperCase();
            const itemNames = customerOrderItems(order)
                .map(item => String(item.productName || "").toUpperCase())
                .join(" ");
            return buyer.includes(searchTerm) || itemNames.includes(searchTerm);
        })
        .sort((a, b) => {
            const aPending = normalizeOrderStatus(a.status) === "order_sent";
            const bPending = normalizeOrderStatus(b.status) === "order_sent";
            if (aPending !== bPending) return aPending ? -1 : 1;
            return aPending
                ? customerOrderTime(a) - customerOrderTime(b)
                : customerOrderTime(b) - customerOrderTime(a);
        });

    let visibleOrders = matchingOrders;
    if (isHost && !searchTerm) {
        const pending = matchingOrders.filter(order => normalizeOrderStatus(order.status) === "order_sent");
        const finished = matchingOrders.filter(order => normalizeOrderStatus(order.status) !== "order_sent").slice(0, 15);
        visibleOrders = [...pending, ...finished];
    }

    customerOrdersSummary.textContent = visibleOrders.length
        ? `${visibleOrders.length} order${visibleOrders.length === 1 ? "" : "s"}`
        : (isHost ? "No customer orders." : "No pending orders or personal order updates.");

    if (!visibleOrders.length) {
        const empty = document.createElement("p");
        empty.className = "emptyOrders";
        empty.textContent = customerOrdersSummary.textContent;
        customerOrdersList.appendChild(empty);
        return;
    }

    visibleOrders.forEach(order => {
        const items = customerOrderItems(order);
        const isOwnOrder = order.buyerUid === currentUser?.uid;
        const maySeePrivatePayment = isHost || isOwnOrder;

        const card = document.createElement("article");
        card.className = "pendingCustomerOrder";

        const header = document.createElement("div");
        header.className = "pendingCustomerOrderHeader";

        const buyerRow = document.createElement("div");
        buyerRow.className = "pendingCustomerOrderBuyerRow";
        const buyerName = customerOrderBuyerName(order);
        const buyer = document.createElement("strong");
        buyer.className = "pendingCustomerOrderBuyer";
        buyer.textContent = `IGN: ${buyerName}`;
        buyerRow.appendChild(buyer);

        if (isHost) {
            const copyButton = document.createElement("button");
            copyButton.type = "button";
            copyButton.className = "copyCustomerUsernameButton";
            copyButton.textContent = "📋";
            copyButton.title = `Copy ${buyerName}`;
            copyButton.setAttribute("aria-label", `Copy IGN ${buyerName}`);
            copyButton.addEventListener("click", () => copyCustomerUsername(buyerName, copyButton));
            buyerRow.appendChild(copyButton);
        }

        const time = document.createElement("time");
        time.className = "pendingCustomerOrderTime";
        time.textContent = formatCustomerOrderTime(order.updatedAt || order.createdAt);
        header.append(buyerRow, time);
        card.appendChild(header);

        const content = document.createElement("div");
        content.className = "pendingCustomerOrderContent";

        const firstItem = items[0] || {};
        const imageWrap = document.createElement("div");
        imageWrap.className = "pendingCustomerOrderImageWrap";
        if (firstItem.imageUrl) {
            const image = document.createElement("img");
            image.className = "pendingCustomerOrderImage";
            image.src = firstItem.imageUrl;
            image.alt = firstItem.productName || "Ordered product";
            image.loading = "lazy";
            imageWrap.appendChild(image);
        } else {
            imageWrap.textContent = "No image";
        }

        const info = document.createElement("div");
        info.className = "pendingCustomerOrderInfo";

        items.forEach(item => {
            const itemBlock = document.createElement("div");
            itemBlock.className = "pendingCustomerOrderItem";
            const amount = item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0);

            const name = document.createElement("strong");
            name.className = "pendingCustomerOrderProductName";
            name.textContent = item.productName || "Unknown Product";

            const quantity = document.createElement("p");
            quantity.append("Quantity: ");
            const quantityValue = document.createElement("strong");
            quantityValue.textContent = `${Number(item.quantity || 0)}x`;
            quantity.appendChild(quantityValue);

            const amountLine = document.createElement("p");
            amountLine.append("Amount: ");
            const amountValue = document.createElement("strong");
            amountValue.textContent = formatCustomerOrderPrice(amount);
            amountLine.appendChild(amountValue);

            itemBlock.append(name, quantity, amountLine);
            info.appendChild(itemBlock);
        });

        if (maySeePrivatePayment) {
            const privateDetails = document.createElement("div");
            privateDetails.className = "pendingCustomerOrderPrivateDetails";

            const payment = document.createElement("p");
            payment.textContent = `💳 Payment: ${formatCustomerPaymentMethod(order.paymentMethod)}`;
            const reference = document.createElement("p");
            reference.textContent = `# Ref No.: ${String(order.paymentReferenceNumber || "Not provided")}`;
            const paid = document.createElement("p");
            paid.textContent = `🗓 Paid on: ${formatCustomerPaymentDateTime(order.paymentDate, order.paymentTime)}`;
            privateDetails.append(payment, reference, paid);
            info.appendChild(privateDetails);
        }

        content.append(imageWrap, info);
        card.appendChild(content);

        if (maySeePrivatePayment && normalizeOrderStatus(order.status) === "rejected" && order.rejectionReason) {
            const reason = document.createElement("p");
            reason.className = "customerOrderRejectionReason";
            reason.textContent = `Reason: ${String(order.rejectionReason).slice(0, 300)}`;
            card.appendChild(reason);
        }

        const actions = document.createElement("div");
        actions.className = "pendingCustomerOrderActions";

        if (isHost && normalizeOrderStatus(order.status) === "order_sent") {
            const completeButton = document.createElement("button");
            completeButton.type = "button";
            completeButton.className = "customerOrderActionButton customerOrderCompleteButton";
            completeButton.textContent = "✓ COMPLETE";
            completeButton.disabled = customerOrderActionRunning;
            completeButton.addEventListener("click", () => completeCustomerOrder(order));

            const rejectButton = document.createElement("button");
            rejectButton.type = "button";
            rejectButton.className = "customerOrderActionButton customerOrderRejectButton";
            rejectButton.textContent = "✕ REJECT";
            rejectButton.disabled = customerOrderActionRunning;
            rejectButton.addEventListener("click", () => rejectCustomerOrder(order));
            actions.append(completeButton, rejectButton);
        } else {
            const status = customerOrderStatusDetails(order);
            const badge = document.createElement("span");
            badge.className = `customerOrderStatusBadge ${status.className}`;
            badge.textContent = status.label;
            actions.appendChild(badge);
        }

        card.appendChild(actions);
        customerOrdersList.appendChild(card);
    });
}

function listenForCustomerOrders() {
    if (customerOrdersUnsubscribe) {
        customerOrdersUnsubscribe();
        customerOrdersUnsubscribe = null;
    }

    currentCustomerOrders = [];
    renderCustomerOrders();

    if (!currentRoom?.ownerUid || !currentUser?.uid) return;

    const ordersRef = collection(
        db,
        "users",
        currentRoom.ownerUid,
        "orders"
    );

    customerOrdersSummary.textContent = "Loading orders...";

    // Firestore security rules evaluate the whole query. Viewers cannot query
    // every order and then hide private completed/rejected orders in JavaScript.
    // Use two rule-compatible queries instead:
    // 1. Every pending order.
    // 2. This viewer's own orders in any status.
    if (isHost) {
        customerOrdersUnsubscribe = onSnapshot(
            ordersRef,
            snapshot => {
                currentCustomerOrders = snapshot.docs
                    .map(orderDocument => ({
                        id: orderDocument.id,
                        ...orderDocument.data()
                    }))
                    .sort((a, b) => customerOrderTime(b) - customerOrderTime(a));

                renderCustomerOrders();
            },
            handleCustomerOrdersError
        );
        return;
    }

    const pendingOrdersQuery = query(
        ordersRef,
        where("status", "==", "order_sent")
    );

    const ownOrdersQuery = query(
        ordersRef,
        where("buyerUid", "==", currentUser.uid)
    );

    let pendingOrders = [];
    let ownOrders = [];

    const mergeAndRenderOrders = () => {
        const mergedOrders = new Map();

        pendingOrders.forEach(order => mergedOrders.set(order.id, order));
        ownOrders.forEach(order => mergedOrders.set(order.id, order));

        currentCustomerOrders = [...mergedOrders.values()]
            .sort((a, b) => customerOrderTime(b) - customerOrderTime(a));

        renderCustomerOrders();
    };

    const unsubscribePending = onSnapshot(
        pendingOrdersQuery,
        snapshot => {
            pendingOrders = snapshot.docs.map(orderDocument => ({
                id: orderDocument.id,
                ...orderDocument.data()
            }));
            mergeAndRenderOrders();
        },
        handleCustomerOrdersError
    );

    const unsubscribeOwn = onSnapshot(
        ownOrdersQuery,
        snapshot => {
            ownOrders = snapshot.docs.map(orderDocument => ({
                id: orderDocument.id,
                ...orderDocument.data()
            }));
            mergeAndRenderOrders();
        },
        handleCustomerOrdersError
    );

    customerOrdersUnsubscribe = () => {
        unsubscribePending();
        unsubscribeOwn();
    };
}

function handleCustomerOrdersError(error) {
    console.error("Could not load customer orders:", error);
    currentCustomerOrders = [];

    if (customerOrdersList) {
        customerOrdersList.innerHTML = "";

        const errorMessage = document.createElement("p");
        errorMessage.className = "emptyOrders errorMessage";
        errorMessage.textContent = error?.code === "permission-denied"
            ? "Order tracking is blocked by the Firestore security rules."
            : "Could not load order tracking.";

        customerOrdersList.appendChild(errorMessage);
    }

    if (customerOrdersSummary) {
        customerOrdersSummary.textContent = "Orders unavailable.";
    }
}

function parseSupportedStreamLink(rawLink) {
    const value = String(rawLink || "").trim();

    if (!value) {
        return {
            valid: true,
            empty: true,
            originalUrl: "",
            platform: "",
            embedUrl: ""
        };
    }

    let url;

    try {
        url = new URL(value);
    } catch {
        return {
            valid: false,
            message: "Enter a valid TikTok LIVE or YouTube livestream link."
        };
    }

    if (url.protocol !== "https:") {
        return {
            valid: false,
            message: "For security, the livestream link must begin with https://"
        };
    }

    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const pathParts = url.pathname.split("/").filter(Boolean);

    // TikTok LIVE: https://www.tiktok.com/@username/live
    if (hostname === "tiktok.com" || hostname === "m.tiktok.com") {
        const username = pathParts[0] || "";
        const isLivePath = pathParts.length === 2
            && /^@[A-Za-z0-9._-]{2,24}$/.test(username)
            && pathParts[1].toLowerCase() === "live";

        if (!isLivePath) {
            return {
                valid: false,
                message: "Use a TikTok LIVE link like https://www.tiktok.com/@username/live"
            };
        }

        return {
            valid: true,
            empty: false,
            platform: "TikTok",
            username,
            originalUrl: url.href,
            embedUrl: ""
        };
    }

    // YouTube: watch?v=ID, live/ID, youtu.be/ID, or embed/ID.
    if (
        hostname === "youtube.com"
        || hostname === "m.youtube.com"
        || hostname === "music.youtube.com"
        || hostname === "youtu.be"
        || hostname === "youtube-nocookie.com"
    ) {
        let videoId = "";

        if (hostname === "youtu.be") {
            videoId = pathParts[0] || "";
        } else if (pathParts[0] === "watch") {
            videoId = url.searchParams.get("v") || "";
        } else if (["live", "embed", "shorts"].includes(pathParts[0])) {
            videoId = pathParts[1] || "";
        }

        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
            return {
                valid: false,
                message: "Use a complete YouTube livestream link containing a valid video ID."
            };
        }

        const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
        embedUrl.searchParams.set("autoplay", "0");
        embedUrl.searchParams.set("playsinline", "1");
        embedUrl.searchParams.set("rel", "0");
        if (window.location.origin && window.location.origin !== "null") {
            embedUrl.searchParams.set("origin", window.location.origin);
        }

        return {
            valid: true,
            empty: false,
            platform: "YouTube",
            originalUrl: url.href,
            embedUrl: embedUrl.href
        };
    }

    return {
        valid: false,
        message: "Only TikTok LIVE and YouTube livestream links are supported."
    };
}

function clearViewerStreamPlayer() {
    if (viewerStreamPlayer) {
        viewerStreamPlayer.removeAttribute("src");
        viewerStreamPlayer.hidden = true;
    }

    if (viewerStreamFrame) viewerStreamFrame.hidden = true;
    if (viewerStreamFrameLink) viewerStreamFrameLink.removeAttribute("href");
    if (viewerTikTokCard) {
        viewerTikTokCard.hidden = true;
        viewerTikTokCard.removeAttribute("href");
    }
    if (viewerTikTokUsername) viewerTikTokUsername.textContent = "";
    if (viewerStreamFallback) {
        viewerStreamFallback.hidden = true;
        viewerStreamFallback.textContent = "";
    }

    if (viewerStreamOpenButton) {
        viewerStreamOpenButton.hidden = true;
        viewerStreamOpenButton.removeAttribute("href");
        viewerStreamOpenButton.textContent = "Open Livestream";
    }
}

function renderViewerStream(room) {
    if (!viewerStreamSection || !viewerStreamPlayer) return;

    const parsed = parseSupportedStreamLink(room.streamLink);
    const shouldShow = !isHost && room.isLive === true && parsed.valid && !parsed.empty;

    viewerStreamSection.hidden = !shouldShow;

    if (!shouldShow) {
        clearViewerStreamPlayer();
        return;
    }

    clearViewerStreamPlayer();
    viewerStreamSection.hidden = false;
    viewerStreamHeading.textContent = `🔴 ${parsed.platform} Live Stream`;
    viewerStreamOpenButton.href = parsed.originalUrl;
    viewerStreamOpenButton.hidden = false;

    if (parsed.platform === "TikTok") {
        viewerTikTokCard.href = parsed.originalUrl;
        viewerTikTokCard.hidden = false;
        viewerTikTokUsername.textContent = parsed.username || `@${room.hostUsername || "Host"}`;
        viewerStreamOpenButton.textContent = "Open TikTok Livestream";
        return;
    }

    viewerStreamPlayer.hidden = false;
    viewerStreamFrame.hidden = false;
    viewerStreamFrameLink.href = parsed.originalUrl;
    viewerStreamOpenButton.textContent = "Open on YouTube";

    // Avoid reloading the YouTube iframe on every Firestore snapshot.
    if (viewerStreamPlayer.src !== parsed.embedUrl) {
        viewerStreamPlayer.src = parsed.embedUrl;
    }
}

function renderRoom(room) {
    currentRoom = room;
    isHost = room.ownerUid === currentUser.uid;
    const amount = clampDiceCount(room.diceCount);

    ensureNextRolls(room, amount).catch(console.error);

    roomNameText.textContent = room.roomName || "Permanent Room";
    diceIdText.textContent = room.diceId || "";
    hostText.innerHTML = "";
    const hostProfileLink = document.createElement("a");
    hostProfileLink.className = "profileUsernameLink";
    hostProfileLink.textContent = `@${room.hostUsername || "Host"}`;
    hostProfileLink.href = room.ownerUid
        ? `profile.html?id=${encodeURIComponent(room.ownerUid)}`
        : "#";
    if (!room.ownerUid) hostProfileLink.addEventListener("click", event => event.preventDefault());
    hostText.appendChild(hostProfileLink);
    gameText.textContent = room.game === "Roblox" && room.robloxGame ? `${room.game} — ${room.robloxGame}` : room.game || "Other";
    platformText.textContent = room.platform || "Other";
    const roomIgn = String(room.ign || "").trim();
    if (ignRow) ignRow.hidden = !roomIgn;
    if (ignText) ignText.textContent = roomIgn;
    descriptionText.textContent = room.description || "";
    const roomIsLive = room.isLive === true;
    liveStatusText.textContent = roomIsLive ? "🔴 LIVE" : "⚫ OFFLINE";
    liveStatusText.classList.toggle("statusLive", roomIsLive);
    liveStatusText.classList.toggle("statusOffline", !roomIsLive);

    if (roomFavoriteCount) {
        roomFavoriteCount.textContent = Number(room.favoriteCount || 0).toLocaleString();
    }
    renderFavoriteControls();

    // Order tracking is visible to everyone.
    // Viewers see all pending orders plus only their own completed/rejected orders.
    // Only the host gets action buttons.
    if (customerOrdersBox) customerOrdersBox.hidden = false;
    renderCustomerOrders();

    if (liveToggleButton) {
        liveToggleButton.textContent = roomIsLive ? "🔴 End Live" : "🟢 Go Live";
        liveToggleButton.classList.toggle("dangerButton", roomIsLive);
        liveToggleButton.classList.toggle("goLiveButton", !roomIsLive);
        liveToggleButton.setAttribute("aria-pressed", String(roomIsLive));
        liveToggleButton.title = roomIsLive
            ? "Click to make this room offline"
            : "Click to make this room live";
    }

    if (toggleHostControls) {
        toggleHostControls.hidden = !isHost;
        toggleHostControls.textContent = hostControlsHidden
            ? "Show Host Controls"
            : "Hide Host Controls";
    }

    // Hide/show only the livestream Host Controls panel.
    hostControlPanel.hidden = !isHost || hostControlsHidden;

    // Keep Number of Dice visible for the host.
    hostSettings.hidden = !isHost;

    rollButton.hidden = !isHost;
    waitingText.hidden = isHost;

    // Host sees the dice stepper; viewers keep the room host/game/platform details.
    if (hostDiceCountControl) hostDiceCountControl.hidden = !isHost;
    if (viewerRoomInformation) viewerRoomInformation.hidden = isHost;
    if (permanentRoomCard) permanentRoomCard.classList.toggle("hostRoomPerspective", isHost);

    if (publicRoomViewerRow) {
        publicRoomViewerRow.hidden = isHost;
    }

    if (hostHistoryToolbar) {
        hostHistoryToolbar.hidden = !isHost;
    }

    if (hostRoomViewerRow) {
        hostRoomViewerRow.hidden = !isHost;
    }

    if (hostDiceBlurControl) {
        hostDiceBlurControl.hidden = !isHost;
    }
    streamLinkInput.value = room.streamLink || "";
    if (ignInput && document.activeElement !== ignInput) ignInput.value = room.ign || "";
    diceCountSelect.value = String(amount);
    if (diceCountDisplay && document.activeElement !== diceCountDisplay) diceCountDisplay.value = String(amount);

    // The host manages the saved URL in Host Controls. Viewers only see the
    // clickable TikTok card or YouTube preview below Platform and above IGN.
    renderViewerStream(room);

    const accountRollBlocked = Boolean(accountRestrictionMessage("roll"));
    const rollingBlocked = room.rollingSuspended === true || accountRollBlocked;
    rollButton.disabled = room.rolling || rollingLocally || rollingBlocked;
    diceCountSelect.disabled = room.rolling || rollingLocally || rollingBlocked;
    const diceControlsDisabled = room.rolling || rollingLocally || rollingBlocked;
    if (diceCountDisplay) diceCountDisplay.disabled = diceControlsDisabled;
    if (decreaseDiceCountButton) decreaseDiceCountButton.disabled = diceControlsDisabled || amount <= 1;
    if (increaseDiceCountButton) increaseDiceCountButton.disabled = diceControlsDisabled || amount >= 15;
    renderHistory(room);

    if (room.rolling) {
        rollStatus.textContent = "🎲 Rolling...";
        if (animationTimer === null) startAnimation(amount);
    } else {
        stopAnimation();
        const accountMessage = accountRestrictionMessage("roll");
        rollStatus.textContent = accountMessage
            || (room.rollingSuspended === true
                ? `Rolling suspended${room.rollingSuspensionReason ? `: ${room.rollingSuspensionReason}` : "."}`
                : (isHost ? "Ready to roll." : "Waiting for the host to roll."));
        if (Array.isArray(room.latestResult) && room.latestResult.length) showDice(results, room.latestResult);
        else showWhiteDice(amount);
    }

    enforceAutoOffline(room).catch(console.error);
}

async function findRoomByDiceId(diceId) {
    const roomQuery = query(collection(db, "permanentRooms"), where("diceId", "==", diceId), limit(1));
    const snapshot = await getDocs(roomQuery);
    if (snapshot.empty) return null;
    const documentSnapshot = snapshot.docs[0];
    return { ref: documentSnapshot.ref, data: documentSnapshot.data() };
}

async function rollDice() {
    if (!isHost || rollingLocally || currentRoom?.rolling) return;

    const restriction = accountRestrictionMessage("roll");
    if (restriction) {
        await showPeryaAlert(
            restriction,
            { type: "warning", title: "Rolling Restricted" }
        );
        return;
    }

    rollingLocally = true;
    const amount = clampDiceCount(diceCountSelect.value);
    let selectedResult = [];

    try {
        await runTransaction(db, async transaction => {
            const userRef = doc(db, "users", currentUser.uid);
            const [snapshot, userSnapshot] = await Promise.all([
                transaction.get(roomRef),
                transaction.get(userRef)
            ]);
            if (!snapshot.exists()) throw new Error("Room not found.");

            const account = userSnapshot.exists() ? userSnapshot.data() : {};
            if (account.accountSuspended === true) {
                throw new Error(account.restrictionReason || "Your account has been suspended.");
            }
            if (account.rollingRestricted === true) {
                throw new Error(account.restrictionReason || "You are not allowed to roll dice.");
            }

            const room = snapshot.data();
            if (room.ownerUid !== currentUser.uid) throw new Error("Only the host can roll.");
            if (room.rollingSuspended === true) throw new Error(room.rollingSuspensionReason || "Rolling has been suspended by staff.");
            if (room.rolling) throw new Error("Dice are already rolling.");

            const nextRolls = prepareNextRolls(room.nextRolls, amount);
            selectedResult = decodeStoredRoll(nextRolls[0]);

            const remainingRolls = nextRolls.slice(1);
            remainingRolls.push(encodeRoll(generateDice(amount)));

            transaction.update(roomRef, {
                rolling: true,
                pendingResult: selectedResult,
                nextRolls: remainingRolls,
                updatedAt: serverTimestamp()
            });
        });

        startAnimation(amount);

        try {
            rollSound.currentTime = 0;
            await rollSound.play();
        } catch {}

        await wait(500);

        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(roomRef);
            if (!snapshot.exists()) throw new Error("Room not found.");

            const room = snapshot.data();
            if (room.ownerUid !== currentUser.uid) throw new Error("Only the host can finish a roll.");

            const completed =
                Array.isArray(room.pendingResult) && room.pendingResult.length
                    ? room.pendingResult
                    : selectedResult;

            const oldHistory = Array.isArray(room.history) ? room.history : [];

            transaction.update(roomRef, {
                rolling: false,
                latestResult: completed,
                pendingResult: [],
                history: [...oldHistory, completed.join(",")].slice(-5),
                rollNumber: Number(room.rollNumber || 0) + 1,
                lastRollAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });
    } catch (error) {
        console.error(error);
        await showPeryaAlert(
            error.message || "Roll failed.",
            { type: "error", title: "Roll Failed" }
        );
    } finally {
        rollingLocally = false;
        stopAnimation();
    }
}


function renderFavoriteControls() {
    if (!favoriteRoomButton || !favoriteRoomMessage) return;

    const canFavorite = Boolean(currentUser && !currentUser.isAnonymous && currentRoom && !isHost);
    favoriteRoomButton.hidden = !canFavorite;
    if (favoriteCountDisplay) favoriteCountDisplay.hidden = canFavorite;
    favoriteRoomButton.disabled = favoriteSaving;
    favoriteRoomButton.classList.toggle("isFavorite", roomIsFavorite);
    favoriteRoomButton.textContent = roomIsFavorite ? "⭐ Favorited ✓" : "⭐ Favorite";

    if (isHost) {
        favoriteRoomMessage.textContent = "";
    } else if (!currentUser || currentUser.isAnonymous) {
        favoriteRoomMessage.textContent = "Sign in with Google to add this room to your favorites.";
    } else if (roomIsFavorite) {
        favoriteRoomMessage.textContent = "This room will appear first in your Live Directory when it is live.";
    } else {
        favoriteRoomMessage.textContent = "Save this room for quick access when it goes live.";
    }
}

function listenForFavoriteStatus() {
    if (favoriteUnsubscribe) favoriteUnsubscribe();
    roomIsFavorite = false;

    if (!currentUser || currentUser.isAnonymous || !roomRef || isHost) {
        renderFavoriteControls();
        return;
    }

    const favoriteRef = doc(db, "users", currentUser.uid, "favoriteRooms", roomRef.id);
    favoriteUnsubscribe = onSnapshot(favoriteRef, snapshot => {
        roomIsFavorite = snapshot.exists();
        renderFavoriteControls();
    }, error => {
        console.error("Could not load favorite status:", error);
        roomIsFavorite = false;
        renderFavoriteControls();
    });
}

async function toggleFavoriteRoom() {
    if (!currentUser || currentUser.isAnonymous || !roomRef || !currentRoom || isHost || favoriteSaving) return;

    favoriteSaving = true;
    renderFavoriteControls();

    try {
        await runTransaction(db, async transaction => {
            const favoriteRef = doc(db, "users", currentUser.uid, "favoriteRooms", roomRef.id);
            const [latestRoomSnapshot, favoriteSnapshot] = await Promise.all([
                transaction.get(roomRef),
                transaction.get(favoriteRef)
            ]);

            if (!latestRoomSnapshot.exists()) throw new Error("Room not found.");
            const latestRoom = latestRoomSnapshot.data();
            if (latestRoom.ownerUid === currentUser.uid) throw new Error("You cannot favorite your own room.");

            const currentCount = Math.max(0, Number(latestRoom.favoriteCount || 0));

            if (favoriteSnapshot.exists()) {
                transaction.delete(favoriteRef);
                transaction.update(roomRef, {
                    favoriteCount: Math.max(0, currentCount - 1),
                    updatedAt: serverTimestamp()
                });
            } else {
                transaction.set(favoriteRef, {
                    userUid: currentUser.uid,
                    roomId: roomRef.id,
                    ownerUid: latestRoom.ownerUid,
                    diceId: latestRoom.diceId || "",
                    roomName: latestRoom.roomName || "Permanent Room",
                    createdAt: serverTimestamp()
                });
                transaction.update(roomRef, {
                    favoriteCount: currentCount + 1,
                    updatedAt: serverTimestamp()
                });
            }
        });
    } catch (error) {
        console.error("Could not update favorite:", error);
        favoriteRoomMessage.textContent = error.message || "Could not update favorites. Check Firestore rules.";
        favoriteRoomMessage.classList.add("errorMessage");
    } finally {
        favoriteSaving = false;
        renderFavoriteControls();
    }
}

favoriteRoomButton?.addEventListener("click", toggleFavoriteRoom);

function cleanVouchText(value) {
    return String(value || "").trim().slice(0, 200);
}

function reviewDate(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== "function") return "Just now";
    return timestamp.toDate().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function updateVouchChoiceButtons() {
    vouchButton.classList.toggle("selected", selectedVouch === true);
    notVouchButton.classList.toggle("selected", selectedVouch === false);
}

function cooldownTimestampMillis(value) {
    return value && typeof value.toMillis === "function"
        ? value.toMillis()
        : 0;
}

function hasActiveVouchCooldown() {
    return vouchCooldownUntil > Date.now();
}

function formatCooldownDate(milliseconds) {
    return new Date(milliseconds).toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function cooldownMessage() {
    return hasActiveVouchCooldown()
        ? `A removed vouch has a 7-day cooldown. You can vouch again after ${formatCooldownDate(vouchCooldownUntil)}.`
        : "";
}

function openReviewModal() {
    if (
        !currentUser ||
        currentUser.isAnonymous ||
        isHost ||
        myReview ||
        hasActiveVouchCooldown()
    ) {
        return;
    }

    selectedVouch = null;
    reviewTextInput.value = "";
    reviewCharacterCount.textContent = "0 / 200";
    reviewFormMessage.textContent = "";
    reviewFormMessage.classList.remove("errorMessage");
    document.getElementById("reviewModalTitle").textContent = "Leave a Vouch";
    submitReviewButton.textContent = "Submit Vouch";
    updateVouchChoiceButtons();

    reviewModal.hidden = false;
    document.body.classList.add("modalOpen");
}

function closeReviewModal() {
    reviewModal.hidden = true;
    document.body.classList.remove("modalOpen");
}

function renderReviews() {
    const total = currentReviews.length;
    const vouches = currentReviews.filter(review => review.recommend === true).length;
    const notVouched = total - vouches;
    const percent = total ? Math.round((vouches / total) * 100) : 0;

    if (total) {
        reviewTrustSummary.textContent = `🛡️ ${percent}%  trusted (${total} vouch${total === 1 ? "" : "es"})`;
        reviewBreakdown.textContent = `👍 ${vouches} Vouch · 👎 ${notVouched} Don't Vouch`;
    } else {
        reviewTrustSummary.textContent = "No vouches yet.";
        reviewBreakdown.textContent = "No vouches yet.";
    }

    myReview = currentReviews.find(review => review.id === currentUser?.uid) || null;

    if (isHost) {
        openReviewModalButton.hidden = true;
        reviewEligibilityMessage.textContent = "";
    } else if (currentUser?.isAnonymous) {
        openReviewModalButton.hidden = true;
        reviewEligibilityMessage.textContent = "Sign in with Google to leave a vouch.";
    } else if (accountRestrictionMessage("review")) {
        openReviewModalButton.hidden = true;
        reviewEligibilityMessage.textContent = accountRestrictionMessage("review");
    } else if (myReview) {
        openReviewModalButton.hidden = true;
        reviewEligibilityMessage.textContent = "Your vouch has been submitted and cannot be changed.";
    } else if (hasActiveVouchCooldown()) {
        openReviewModalButton.hidden = true;
        reviewEligibilityMessage.textContent = cooldownMessage();
    } else {
        openReviewModalButton.hidden = false;
        openReviewModalButton.textContent = "👍 Leave a Vouch";
        reviewEligibilityMessage.textContent = "";
    }

    reviewsList.innerHTML = "";

    if (!total) {
        const empty = document.createElement("p");
        empty.className = "emptyReviews";
        empty.textContent = "No vouches yet. Be the first to vouch for this host.";
        reviewsList.appendChild(empty);
        return;
    }

    const sortedReviews = [...currentReviews].sort((a, b) => {
        const bTime = timestampMillis(b.updatedAt) || timestampMillis(b.createdAt);
        const aTime = timestampMillis(a.updatedAt) || timestampMillis(a.createdAt);
        return bTime - aTime;
    });

    sortedReviews.forEach(review => {
        const item = document.createElement("article");
        item.className = "reviewItem";

        const header = document.createElement("div");
        header.className = "reviewItemHeader";

        const author = document.createElement(review.reviewerUid ? "a" : "span");
        author.className = "reviewAuthor profileUsernameLink";
        author.textContent = `@${review.username || "Player"}`;
        if (review.reviewerUid) {
            author.href = `profile.html?id=${encodeURIComponent(review.reviewerUid)}`;
        }

        const vote = document.createElement("span");
        vote.className = `reviewVote ${review.recommend ? "recommends" : "notRecommended"}`;
        vote.textContent = review.recommend ? "👍 Vouches" : "👎 Doesn't Vouch";

        header.append(author, vote);
        item.appendChild(header);

        if (review.review) {
            const body = document.createElement("p");
            body.className = "reviewBody";
            body.textContent = review.review;
            item.appendChild(body);
        }

        const meta = document.createElement("p");
        meta.className = "reviewMeta";
        meta.textContent = reviewDate(review.updatedAt || review.createdAt);
        item.appendChild(meta);

        if (isHost) {
            const actions = document.createElement("div");
            actions.className = "reviewActions";

            const requestButton = document.createElement("button");
            requestButton.type = "button";
            requestButton.className = "dangerButton";

            const existingRequest = currentRemovalRequests.get(review.id);

            if (existingRequest) {
                const requestStatus = existingRequest.status || "pending";

                requestButton.disabled = true;

                if (requestStatus === "approved") {
                    requestButton.textContent = "Removal Approved";
                } else if (requestStatus === "rejected") {
                    requestButton.textContent = "Removal Request Rejected";
                } else {
                    requestButton.textContent = "Removal Request Pending";
                }

                const statusBox = document.createElement("div");
                statusBox.className = `hostRemovalStatus hostRemovalStatus-${requestStatus}`;

                const statusTitle = document.createElement("strong");

                if (requestStatus === "approved") {
                    statusTitle.textContent = "✅ Removal request approved";
                } else if (requestStatus === "rejected") {
                    statusTitle.textContent = "❌ Removal request rejected";
                } else {
                    statusTitle.textContent = "⏳ Removal request pending";
                }

                statusBox.appendChild(statusTitle);

                if (
                    requestStatus !== "pending" &&
                    String(existingRequest.moderatorNote || "").trim()
                ) {
                    const moderatorNote = document.createElement("p");
                    moderatorNote.textContent =
                        `Administrator note: ${String(existingRequest.moderatorNote).trim()}`;
                    statusBox.appendChild(moderatorNote);
                }

                actions.appendChild(requestButton);
                item.append(actions, statusBox);
            } else {
                requestButton.textContent = "Request Removal";
                requestButton.addEventListener(
                    "click",
                    () => openRemovalRequestModal(review)
                );

                actions.appendChild(requestButton);
                item.appendChild(actions);
            }
        }

        reviewsList.appendChild(item);
    });
}


function cleanRemovalDetails(value) {
    return String(value || "").trim().slice(0, 300);
}

function openRemovalRequestModal(review) {
    if (!isHost || !review || currentRemovalRequests.has(review.id)) return;

    selectedRemovalReview = review;
    removalReasonSelect.value = "";
    removalDetailsInput.value = "";
    removalDetailsCount.textContent = "0 / 300";
    removalRequestMessage.textContent = "";
    removalRequestMessage.classList.remove("errorMessage");

    removalRequestModal.hidden = false;
    document.body.classList.add("modalOpen");
}

function closeRemovalRequestModal() {
    removalRequestModal.hidden = true;
    selectedRemovalReview = null;

    if (reviewModal.hidden) {
        document.body.classList.remove("modalOpen");
    }
}

function listenForRemovalRequests() {
    if (removalRequestsUnsubscribe) removalRequestsUnsubscribe();

    if (!isHost) {
        currentRemovalRequests = new Map();
        renderReviews();
        return;
    }

    const requestsRef = collection(db, "users", currentRoom.ownerUid, "vouchRemovalRequests");
    removalRequestsUnsubscribe = onSnapshot(requestsRef, snapshot => {
        currentRemovalRequests = new Map(
            snapshot.docs.map(documentSnapshot => [
                documentSnapshot.id,
                { id: documentSnapshot.id, ...documentSnapshot.data() }
            ])
        );
        renderReviews();
    }, error => {
        console.error("Could not load removal requests:", error);
    });
}

async function submitRemovalRequest() {
    if (!isHost || !selectedRemovalReview) return;

    const reason = removalReasonSelect.value;
    if (!reason) {
        removalRequestMessage.textContent = "Select a reason for the removal request.";
        removalRequestMessage.classList.add("errorMessage");
        return;
    }

    submitRemovalRequestButton.disabled = true;
    removalRequestMessage.textContent = "Submitting request...";
    removalRequestMessage.classList.remove("errorMessage");

    try {
        const requestRef = doc(
            db,
            "users",
            currentRoom.ownerUid,
            "vouchRemovalRequests",
            selectedRemovalReview.id
        );

        const existingRequest = await getDoc(requestRef);
        if (existingRequest.exists()) {
            throw new Error("A removal request for this vouch is already pending.");
        }

        const vouchPath =
            `users/${currentRoom.ownerUid}/reviews/${selectedRemovalReview.id}`;

        await setDoc(requestRef, {
            hostUid: currentRoom.ownerUid,
            reviewerUid: selectedRemovalReview.id,
            roomId: roomRef.id,
            vouchPath,
            reason,
            details: cleanRemovalDetails(removalDetailsInput.value),
            status: "pending",
            vouchSnapshot: {
                username: selectedRemovalReview.username || "Player",
                recommend: selectedRemovalReview.recommend === true,
                review: String(selectedRemovalReview.review || "").slice(0, 200)
            },
            createdAt: serverTimestamp()
        });

        closeRemovalRequestModal();
    } catch (error) {
        console.error(error);
        removalRequestMessage.textContent = error.message || "Could not submit the removal request.";
        removalRequestMessage.classList.add("errorMessage");
    } finally {
        submitRemovalRequestButton.disabled = false;
    }
}

async function loadCurrentUsername() {
    if (!currentUser || currentUser.isAnonymous) return;

    try {
        const userSnapshot = await getDoc(doc(db, "users", currentUser.uid));
        const userData = userSnapshot.exists() ? userSnapshot.data() : {};
        currentUsername = userData.username || currentUser.displayName || "Player";
    } catch (error) {
        console.error("Could not load username:", error);
        currentUsername = currentUser.displayName || "Player";
    }
}

function listenForVouchCooldown() {
    if (vouchCooldownUnsubscribe) {
        vouchCooldownUnsubscribe();
        vouchCooldownUnsubscribe = null;
    }

    vouchCooldownUntil = 0;

    if (!currentUser || currentUser.isAnonymous || isHost) {
        renderReviews();
        return;
    }

    const cooldownRef = doc(
        db,
        "users",
        currentRoom.ownerUid,
        "vouchCooldowns",
        currentUser.uid
    );

    vouchCooldownUnsubscribe = onSnapshot(
        cooldownRef,
        snapshot => {
            vouchCooldownUntil = snapshot.exists()
                ? cooldownTimestampMillis(snapshot.data().blockedUntil)
                : 0;

            renderReviews();
        },
        error => {
            console.error("Could not load vouch cooldown:", error);
            vouchCooldownUntil = 0;
            renderReviews();
        }
    );
}

function listenForReviews() {
    if (reviewsUnsubscribe) reviewsUnsubscribe();

    const reviewsRef = collection(db, "users", currentRoom.ownerUid, "reviews");
    reviewsUnsubscribe = onSnapshot(reviewsRef, snapshot => {
        currentReviews = snapshot.docs.map(documentSnapshot => ({
            id: documentSnapshot.id,
            ...documentSnapshot.data()
        }));
        renderReviews();
    }, error => {
        console.error("Could not load reviews:", error);
        reviewsList.innerHTML = '<p class="emptyReviews">Could not load reviews.</p>';
    });
}

async function submitReview() {
    if (!currentUser || currentUser.isAnonymous) {
        reviewFormMessage.textContent = "Sign in with Google before leaving a vouch.";
        reviewFormMessage.classList.add("errorMessage");
        return;
    }

    const reviewRestriction = accountRestrictionMessage("review");
    if (reviewRestriction) {
        reviewFormMessage.textContent = reviewRestriction;
        reviewFormMessage.classList.add("errorMessage");
        return;
    }

    if (isHost) {
        reviewFormMessage.textContent = "You cannot vouch for your own room.";
        reviewFormMessage.classList.add("errorMessage");
        return;
    }

    if (selectedVouch === null) {
        reviewFormMessage.textContent = "Choose I Vouch or I Don't Vouch.";
        reviewFormMessage.classList.add("errorMessage");
        return;
    }

    submitReviewButton.disabled = true;
    reviewFormMessage.textContent = "Saving vouch...";
    reviewFormMessage.classList.remove("errorMessage");

    try {
        const reviewRef = doc(
            db,
            "users",
            currentRoom.ownerUid,
            "reviews",
            currentUser.uid
        );

        const cooldownRef = doc(
            db,
            "users",
            currentRoom.ownerUid,
            "vouchCooldowns",
            currentUser.uid
        );

        const [existingSnapshot, cooldownSnapshot] = await Promise.all([
            getDoc(reviewRef),
            getDoc(cooldownRef)
        ]);

        if (existingSnapshot.exists()) {
            throw new Error("Your vouch has already been submitted and cannot be changed.");
        }

        if (cooldownSnapshot.exists()) {
            const blockedUntil = cooldownTimestampMillis(
                cooldownSnapshot.data().blockedUntil
            );

            if (blockedUntil > Date.now()) {
                vouchCooldownUntil = blockedUntil;
                renderReviews();
                throw new Error(cooldownMessage());
            }
        }

        await setDoc(reviewRef, {
            reviewerUid: currentUser.uid,
            hostUid: currentRoom.ownerUid,
            roomId: roomRef.id,
            username: currentUsername,
            recommend: selectedVouch,
            review: cleanVouchText(reviewTextInput.value),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        closeReviewModal();
    } catch (error) {
        console.error(error);
        reviewFormMessage.textContent = error.message || "Could not save your vouch.";
        reviewFormMessage.classList.add("errorMessage");
    } finally {
        submitReviewButton.disabled = false;
    }
}


openReviewModalButton.addEventListener("click", openReviewModal);
closeReviewModalButton.addEventListener("click", closeReviewModal);
cancelReviewButton.addEventListener("click", closeReviewModal);
reviewModal.querySelector("[data-close-review-modal]").addEventListener("click", closeReviewModal);
vouchButton.addEventListener("click", () => {
    selectedVouch = true;
    updateVouchChoiceButtons();
});
notVouchButton.addEventListener("click", () => {
    selectedVouch = false;
    updateVouchChoiceButtons();
});
reviewTextInput.addEventListener("input", () => {
    if (reviewTextInput.value.length > 200) {
        reviewTextInput.value = reviewTextInput.value.slice(0, 200);
    }

    reviewCharacterCount.textContent = `${reviewTextInput.value.length} / 200`;
});
submitReviewButton.addEventListener("click", submitReview);

closeRemovalRequestModalButton.addEventListener("click", closeRemovalRequestModal);
cancelRemovalRequestButton.addEventListener("click", closeRemovalRequestModal);
removalRequestModal.querySelector("[data-close-removal-modal]").addEventListener("click", closeRemovalRequestModal);
removalDetailsInput.addEventListener("input", () => {
    if (removalDetailsInput.value.length > 300) {
        removalDetailsInput.value = removalDetailsInput.value.slice(0, 300);
    }
    removalDetailsCount.textContent = `${removalDetailsInput.value.length} / 300`;
});
submitRemovalRequestButton.addEventListener("click", submitRemovalRequest);

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!removalRequestModal.hidden) closeRemovalRequestModal();
    else if (!reviewModal.hidden) closeReviewModal();
});


rollButton.addEventListener("click", rollDice);

async function saveDiceCount(nextAmount) {
    if (!isHost || !roomRef || currentRoom?.rolling || rollingLocally) return;

    const amount = clampDiceCount(nextAmount);
    const currentAmount = clampDiceCount(currentRoom?.diceCount ?? diceCountSelect.value);
    if (amount === currentAmount) return;

    diceCountSelect.value = String(amount);
    if (diceCountDisplay) diceCountDisplay.value = String(amount);
    if (decreaseDiceCountButton) decreaseDiceCountButton.disabled = amount <= 1;
    if (increaseDiceCountButton) increaseDiceCountButton.disabled = amount >= 15;

    await updateDoc(roomRef, {
        diceCount: amount,
        latestResult: [],
        pendingResult: [],
        nextRolls: generateNextRolls(amount, 10),
        updatedAt: serverTimestamp()
    });
}

diceCountSelect.addEventListener("change", () => saveDiceCount(diceCountSelect.value));

function applyTypedDiceCount() {
    if (!diceCountDisplay) return;

    const amount = clampDiceCount(diceCountDisplay.value);
    diceCountDisplay.value = String(amount);
    saveDiceCount(amount);
}

diceCountDisplay?.addEventListener("input", () => {
    // Allow temporary empty input while the host is typing.
    if (diceCountDisplay.value === "") return;

    const numericValue = Math.trunc(Number(diceCountDisplay.value));
    if (!Number.isFinite(numericValue)) return;

    if (numericValue > 15) diceCountDisplay.value = "15";
    if (numericValue < 1) diceCountDisplay.value = "1";
});

diceCountDisplay?.addEventListener("change", applyTypedDiceCount);
diceCountDisplay?.addEventListener("blur", applyTypedDiceCount);
diceCountDisplay?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        applyTypedDiceCount();
        diceCountDisplay.blur();
    }
});

decreaseDiceCountButton?.addEventListener("click", () => {
    saveDiceCount(clampDiceCount(diceCountSelect.value) - 1);
});
increaseDiceCountButton?.addEventListener("click", () => {
    saveDiceCount(clampDiceCount(diceCountSelect.value) + 1);
});
liveToggleButton?.addEventListener("click", async () => {
    if (!isHost || !roomRef || !currentUser || liveToggleButton.disabled) return;

    liveToggleButton.disabled = true;
    hostControlMessage.classList.remove("errorMessage");

    let nextLiveState = false;
    let liveStartedAt = null;

    try {
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(roomRef);

            if (!snapshot.exists()) {
                throw new Error("Room not found.");
            }

            const latestRoom = snapshot.data();

            if (latestRoom.ownerUid !== currentUser.uid) {
                throw new Error("Only the host can change the live status.");
            }

            nextLiveState = latestRoom.isLive !== true;

            const changes = {
                isLive: nextLiveState,
                updatedAt: serverTimestamp()
            };

            if (nextLiveState) {
                // Timestamp.now() is available immediately on the local snapshot.
                // This stops the auto-offline system from reading an old roll time.
                liveStartedAt = Timestamp.now();
                changes.liveStartedAt = liveStartedAt;
                changes.liveEndedAt = null;
            } else {
                changes.liveEndedAt = Timestamp.now();
            }

            transaction.update(roomRef, changes);
        });

        // Update the host UI immediately. The Firestore onSnapshot listener
        // will then confirm the same state for the host and every viewer.
        currentRoom = {
            ...currentRoom,
            isLive: nextLiveState,
            ...(nextLiveState && liveStartedAt ? { liveStartedAt } : {})
        };
        renderRoom(currentRoom);

        hostControlMessage.textContent = nextLiveState
            ? "Your room is now live."
            : "Your room is now offline.";
    } catch (error) {
        console.error("Could not change live status:", error);
        hostControlMessage.textContent =
            error.message || "Could not change the room status.";
        hostControlMessage.classList.add("errorMessage");
    } finally {
        liveToggleButton.disabled = false;
    }
});
document.getElementById("saveStreamButton").addEventListener("click", async event => {
    if (!isHost || !roomRef) return;

    const saveButton = event.currentTarget;
    const value = streamLinkInput.value.trim();

    hostControlMessage.classList.remove("errorMessage");

    const parsedStream = parseSupportedStreamLink(value);

    if (!parsedStream.valid) {
        hostControlMessage.textContent = parsedStream.message;
        hostControlMessage.classList.add("errorMessage");
        return;
    }

    const safeStreamLink = parsedStream.empty ? "" : parsedStream.originalUrl;

    saveButton.disabled = true;
    hostControlMessage.textContent = "Saving stream link...";

    try {
        await updateDoc(roomRef, {
            streamLink: safeStreamLink,
            updatedAt: serverTimestamp()
        });

        hostControlMessage.textContent = safeStreamLink
            ? `${parsedStream.platform} livestream saved. Viewers can now open it from the room.`
            : "Stream link removed.";
    } catch (error) {
        console.error("Could not save stream link:", error);
        hostControlMessage.textContent = error.message || "Could not save the stream link.";
        hostControlMessage.classList.add("errorMessage");
    } finally {
        saveButton.disabled = false;
    }
});
saveIgnButton?.addEventListener("click", async () => {
    if (!isHost || !roomRef) return;
    const value = String(ignInput?.value || "").trim();
    saveIgnButton.disabled = true;
    hostControlMessage.classList.remove("errorMessage");
    hostControlMessage.textContent = "Saving IGN...";
    try {
        await updateDoc(roomRef, { ign: value, updatedAt: serverTimestamp() });
        hostControlMessage.textContent = value
            ? "IGN updated. Everyone in the room can now see it."
            : "IGN removed.";
    } catch (error) {
        console.error("Could not save IGN:", error);
        hostControlMessage.textContent = error.message || "Could not save IGN.";
        hostControlMessage.classList.add("errorMessage");
    } finally {
        saveIgnButton.disabled = false;
    }
});

document.getElementById("backDashboardButton").addEventListener("click", () => location.href = "dashboard.html");
document.getElementById("backHomeButton").addEventListener("click", () => location.href = "index.html");


window.addEventListener("beforeunload", () => {
    if (viewerCountUnsubscribe) viewerCountUnsubscribe();
    if (viewerConnectionUnsubscribe) viewerConnectionUnsubscribe();
});

async function start() {
    currentUser = await authReady;
    const diceId = cleanDiceId(new URLSearchParams(location.search).get("id"));
    if (!diceId) throw new Error("Missing Dice Room ID.");
    const found = await findRoomByDiceId(diceId);
    if (!found) throw new Error("Permanent room not found.");
    roomRef = found.ref;
    currentRoom = found.data;
    isHost = currentRoom.ownerUid === currentUser.uid;
    await startViewerPresence(diceId);
    window.dispatchEvent(new CustomEvent("perya-room-ready", {
        detail: { ownerUid: currentRoom.ownerUid, isHost }
    }));
    listenForAccountRestrictions();
    await loadCurrentUsername();
    listenForReviews();
    listenForRemovalRequests();
    listenForVouchCooldown();
    listenForFavoriteStatus();
    listenForCustomerOrders();

    onSnapshot(roomRef, snapshot => {
        if (!snapshot.exists()) {
            roomLoading.innerHTML = "<h2>This room no longer exists.</h2>";
            return;
        }
        roomLoading.hidden = true;
        roomScreen.hidden = false;
        renderRoom(snapshot.data());
    }, error => {
        console.error(error);
        roomLoading.innerHTML = "<h2>Could not load this room.</h2>";
    });
}

start().catch(error => {
    console.error(error);
    roomLoading.innerHTML = `<h2>${error.message || "Could not open room."}</h2>`;
});


const copyIgnButton=document.getElementById("copyIgnButton");

if(copyIgnButton){
copyIgnButton.addEventListener("click",async()=>{
    const username=(ignText?.textContent||"").trim();
    if(!username)return;
    try{
        await navigator.clipboard.writeText(username);
        const old=copyIgnButton.textContent;
        copyIgnButton.textContent="✅ Copied";
        setTimeout(()=>copyIgnButton.textContent=old,1500);
    }catch{}
});
}


/* ==================================
   HOST-ONLY DICE BLUR
   Local visual effect only.
================================== */

if (hostDiceBlurCheckbox) {
    hostDiceBlurCheckbox.addEventListener("change", () => {
        document.body.classList.toggle(
            "hostDiceBlurEnabled",
            hostDiceBlurCheckbox.checked
        );
    });
}


customerOrderSearch?.addEventListener("input", renderCustomerOrders);
