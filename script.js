import {
    db,
    auth,
    authReady,
    realtimeDb,
    signInWithGoogle,
    logOut
} from "./firebase.js";

import {
    collection,
    doc,
    deleteDoc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    get,
    onDisconnect,
    onValue,
    push,
    ref,
    remove,
    serverTimestamp as realtimeServerTimestamp,
    set
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";


const defaultDiceImages = [
    "images/red.png",
    "images/blue.png",
    "images/green.png",
    "images/yellow.png",
    "images/purple.png",
    "images/orange.png"
];

let diceImages = [...defaultDiceImages];
let availableDiceSkins = [];
let currentDiceSkinId = "default";
let currentDiceSkinUserData = {};

const whiteDiceImage = "images/white.png";

const rollSound = new Audio("sounds/dice-roll.mp3");
rollSound.volume = 0.6;


const loadingScreen = document.getElementById("loadingScreen");
const loadingMessage = document.getElementById("loadingMessage");
const gameScreen = document.getElementById("gameScreen");

const roleText = document.getElementById("roleText");
const roomStatus = document.getElementById("roomStatus");
const gameIdElement = document.getElementById("gameId");

const roomViewerCount = null;
const copyGameIdButton = document.getElementById("copyGameId");

const hostSettings = document.getElementById("hostSettings");
const toggleHostControls = document.getElementById("toggleHostControls");
const diceCountSelect = document.getElementById("diceCount");
const decreaseDiceCountButton = document.getElementById("decreaseDiceCount");
const increaseDiceCountButton = document.getElementById("increaseDiceCount");
const diceCountDisplay = document.getElementById("diceCountDisplay");

const guestDiceBlurToolbar = document.getElementById("guestDiceBlurToolbar");
const guestDiceBlurCheckbox = document.getElementById("guestDiceBlurCheckbox");
const guestDiceSkinControl = document.getElementById("guestDiceSkinControl");
const guestDiceSkinSelect = document.getElementById("guestDiceSkinSelect");
const guestDiceSkinGallery = document.getElementById("guestDiceSkinGallery");
const guestDiceSkinPickerButton = document.getElementById("guestDiceSkinPickerButton");
const guestDiceSkinSelectedName = document.getElementById("guestDiceSkinSelectedName");
const guestDiceSkinMessage = document.getElementById("guestDiceSkinMessage");

let hostControlsHidden = false;

if (toggleHostControls) {
    toggleHostControls.addEventListener("click", () => {

        hostControlsHidden = !hostControlsHidden;

        if (hostSettings) {
            hostSettings.style.display = hostControlsHidden ? "none" : "";
        }

        toggleHostControls.textContent =
            hostControlsHidden
                ? "Show Host Controls"
                : "Hide Host Controls";
    });
}

diceCountSelect.innerHTML = "";

for (let amount = 1; amount <= 15; amount++) {
    const option = document.createElement("option");

    option.value = String(amount);
    option.textContent = `${amount} ${amount === 1 ? "Die" : "Dice"}`;

    if (amount === 3) {
        option.selected = true;
    }

    diceCountSelect.appendChild(option);
}

function syncGuestDiceCountDisplay() {
    if (!diceCountDisplay || !diceCountSelect) {
        return;
    }

    diceCountDisplay.value = String(
        clampDiceCount(diceCountSelect.value)
    );

    diceCountDisplay.disabled = diceCountSelect.disabled;
}

async function setGuestDiceCount(nextAmount) {
    if (!isHost || !diceCountSelect || diceCountSelect.disabled) {
        return;
    }

    const amount = clampDiceCount(nextAmount);

    if (String(amount) === diceCountSelect.value) {
        syncGuestDiceCountDisplay();
        return;
    }

    diceCountSelect.value = String(amount);
    syncGuestDiceCountDisplay();
    await updateDiceCount();
}

function updateGuestBlurVisibility() {
    if (!guestDiceBlurToolbar) {
        return;
    }

    guestDiceBlurToolbar.hidden = !isHost;

    if (isHost) {
        guestDiceBlurToolbar.style.removeProperty("display");
    } else {
        guestDiceBlurToolbar.style.setProperty("display", "none", "important");
    }
}

const rollButton = document.getElementById("rollButton");
const waitingText = document.getElementById("waitingText");

// Force-hide host-only controls while the room is loading.
// Inline display:none prevents CSS from overriding the hidden attribute.
if (rollButton) {
    rollButton.hidden = true;
    rollButton.style.setProperty("display", "none", "important");
}

if (hostSettings) {
    hostSettings.hidden = true;
    hostSettings.style.setProperty("display", "none", "important");
}

const results = document.getElementById("results");

const history = document.getElementById("history");

const currentResultPanel = document.getElementById("currentResultPanel");
const currentResult = document.getElementById("currentResult");

const joinRoomIdInput = document.getElementById("joinRoomId");
const joinRoomButton = document.getElementById("joinRoomButton");
const joinMessage = document.getElementById("joinMessage");

const profileUsernameSearch = document.getElementById("profileUsernameSearch");
const searchProfileButton = document.getElementById("searchProfileButton");
const profileSearchMessage = document.getElementById("profileSearchMessage");

const googleSignInButton = document.getElementById("googleSignInButton");
const signOutButton = document.getElementById("signOutButton");
const dashboardButton = document.getElementById("dashboardButton");
const signedOutControls = document.getElementById("signedOutControls");
const signedInControls = document.getElementById("signedInControls");
const accountName = document.getElementById("accountName");
const authMessage = document.getElementById("authMessage");
const guestText = document.getElementById("guestText");


let currentUser = null;
let currentRoomId = "";
let currentRoom = null;
let isHost = false;
let isRollingLocally = false;
let hostAccountControls = {};
let hostAccountControlsLoaded = false;
let activeHostControlUid = "";
let unsubscribeHostAccountControls = null;

let unsubscribeRoom = null;
let animationTimer = null;
let startupRollNumber = null;

let activePresenceRoomId = "";
let unsubscribePresenceConnection = null;
let activePresenceRef = null;

let viewerPresenceRef = null;
let viewerCountUnsubscribe = null;
let viewerConnectionUnsubscribe = null;
let activeViewerRoomId = "";
let viewerRegisteredAsViewer = false;

const ROOM_EXPIRATION_MS = 60 * 60 * 1000;


function normalizedSkinImages(skin) {
    const images = skin?.images || {};
    const ordered = [images.red, images.blue, images.green, images.yellow, images.purple, images.orange]
        .map(value => String(value || "").trim());
    return ordered.every(Boolean) ? ordered : null;
}

function diceSkinAccessLevels(skin) {
    const levels = Array.isArray(skin?.accessLevels)
        ? skin.accessLevels
        : [String(skin?.accessLevel || "everyone")];
    return [...new Set(levels.filter(level => ["everyone", "users", "vip"].includes(level)))];
}

function canSelectDiceSkin(skin, userData = {}) {
    if (skin?.enabled !== true) return false;
    const levels = diceSkinAccessLevels(skin);
    if (levels.includes("everyone")) return true;
    const registered = Boolean(currentUser && !currentUser.isAnonymous);
    if (registered && levels.includes("users")) return true;
    if (registered && userData?.vip === true && levels.includes("vip")) return true;
    return false;
}

function diceSkinAccessSuffix(skin) {
    const levels = diceSkinAccessLevels(skin);
    const icons = [];
    if (levels.includes("everyone")) icons.push("🌍");
    if (levels.includes("users")) icons.push("👤");
    if (levels.includes("vip")) icons.push("👑");
    return icons.length ? ` ${icons.join("")}` : "";
}

function diceSkinAccessLabel(skin) {
    const levels = diceSkinAccessLevels(skin);
    const labels = [];
    if (levels.includes("everyone")) labels.push("Guests");
    if (levels.includes("users")) labels.push("Users");
    if (levels.includes("vip")) labels.push("VIP");
    return labels.join(" + ") || "Unavailable";
}

function setMiniDicePreview(container, images) {
    if (!container) return;
    container.innerHTML = "";
    images.forEach(source => {
        const image = document.createElement("img");
        image.src = source;
        image.alt = "";
        container.appendChild(image);
    });
}

function renderGuestDiceSkinGallery() {
    if (!guestDiceSkinGallery || !guestDiceSkinSelect) return;

    const selectedId = currentRoom?.diceSkinId || guestDiceSkinSelect.value || "default";
    guestDiceSkinGallery.innerHTML = "";

    const skins = [{ id: "default", name: "Default", images: {
        red: defaultDiceImages[0], blue: defaultDiceImages[1], green: defaultDiceImages[2],
        yellow: defaultDiceImages[3], purple: defaultDiceImages[4], orange: defaultDiceImages[5]
    }, accessLevels: ["everyone"], enabled: true }, ...availableDiceSkins];

    const selectedSkin = skins.find(skin => skin.id === selectedId) || skins[0];
    if (guestDiceSkinSelectedName) guestDiceSkinSelectedName.textContent = selectedSkin.name || "Unnamed Skin";

    skins.forEach(skin => {
        const allowed = skin.id === "default" || canSelectDiceSkin(skin, currentDiceSkinUserData);
        const images = skin.id === "default" ? defaultDiceImages : normalizedSkinImages(skin);
        if (!images) return;

        const option = document.createElement("button");
        option.type = "button";
        option.className = "diceSkinOption";
        option.disabled = !allowed;
        option.classList.toggle("isSelected", skin.id === selectedId);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", skin.id === selectedId ? "true" : "false");

        const name = document.createElement("span");
        name.className = "diceSkinOptionName";
        name.textContent = skin.name || "Unnamed Skin";

        const status = document.createElement("span");
        status.className = `diceSkinOptionStatus${allowed ? "" : " unavailable"}`;
        if (allowed) {
            status.textContent = skin.id === selectedId ? "✓" : "";
        } else {
            const levels = diceSkinAccessLevels(skin);

            if (levels.includes("users")) {
                status.textContent = "🔒 LOGGED-IN USERS / VIP ONLY";
            } else if (levels.includes("vip")) {
                status.textContent = "👑 VIP ONLY";
            } else {
                status.textContent = "UNAVAILABLE";
            }
        }

        option.append(name, status);
        if (allowed) {
            option.addEventListener("click", async () => {
                guestDiceSkinSelect.value = skin.id;
                guestDiceSkinGallery.hidden = true;
                guestDiceSkinPickerButton?.setAttribute("aria-expanded", "false");
                renderGuestDiceSkinGallery();
                await saveGuestDiceSkin();
            });
        }
        guestDiceSkinGallery.appendChild(option);
    });
}

function applyDiceSkin(skinId) {
    const cleanedId = String(skinId || "default");
    const skin = availableDiceSkins.find(item => item.id === cleanedId);
    const images = normalizedSkinImages(skin);
    diceImages = images || [...defaultDiceImages];
    currentDiceSkinId = images ? cleanedId : "default";
}

async function loadDiceSkins() {
    try {
        let userData = {};
        if (currentUser && !currentUser.isAnonymous) {
            const userSnapshot = await getDoc(doc(db, "users", currentUser.uid));
            userData = userSnapshot.exists() ? userSnapshot.data() : {};
        }

        const snapshot = await getDocs(collection(db, "diceSkins"));
        availableDiceSkins = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .filter(skin => skin.enabled === true && normalizedSkinImages(skin))
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

        currentDiceSkinUserData = userData;
        if (guestDiceSkinSelect) {
            guestDiceSkinSelect.innerHTML = '<option value="default">Default</option>';
            availableDiceSkins.forEach(skin => {
                const option = document.createElement("option");
                option.value = skin.id;
                option.textContent = `${skin.name || "Unnamed Skin"}${diceSkinAccessSuffix(skin)}`;
                option.disabled = !canSelectDiceSkin(skin, userData);
                guestDiceSkinSelect.appendChild(option);
            });
            renderGuestDiceSkinGallery();
        }
    } catch (error) {
        console.error("Could not load dice skins:", error);
        availableDiceSkins = [];
    }
}

async function saveGuestDiceSkin() {
    if (!isHost || !currentRoomId || !guestDiceSkinSelect) return;
    const skinId = guestDiceSkinSelect.value || "default";
    guestDiceSkinSelect.disabled = true;
    if (guestDiceSkinMessage) guestDiceSkinMessage.textContent = "Saving skin...";
    try {
        await updateDoc(roomReference(currentRoomId), {
            diceSkinId: skinId,
            updatedAt: serverTimestamp()
        });
        if (guestDiceSkinMessage) guestDiceSkinMessage.textContent = "Dice skin saved.";
    } catch (error) {
        console.error("Could not save dice skin:", error);
        if (guestDiceSkinMessage) guestDiceSkinMessage.textContent = "Could not save dice skin.";
    } finally {
        guestDiceSkinSelect.disabled = false;
    }
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}


function clampDiceCount(value) {
    return Math.min(15, Math.max(1, Number(value) || 3));
}


function cleanRoomId(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 20);
}


function generateRoomId(length = 7) {

    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(length);

    crypto.getRandomValues(bytes);

    return Array.from(
        bytes,
        byte => characters[byte % characters.length]
    ).join("");
}


function generateDice(amount) {
    return Array.from(
        { length: amount },
        () => Math.floor(Math.random() * diceImages.length)
    );
}

function encodeRoll(values) {
    return values.join(",");
}

function decodeRoll(value) {
    if (Array.isArray(value)) {
        return value
            .map(Number)
            .filter(index => Number.isInteger(index) && diceImages[index]);
    }

    if (typeof value !== "string") {
        return [];
    }

    return value
        .split(",")
        .map(Number)
        .filter(index => Number.isInteger(index) && diceImages[index]);
}

function generateFutureRolls(amount, count = 10) {
    return Array.from(
        { length: count },
        () => encodeRoll(generateDice(amount))
    );
}


function prepareFutureRolls(storedRolls, amount, count = 10) {
    const validRolls = Array.isArray(storedRolls)
        ? storedRolls
            .map(decodeRoll)
            // Accept old 15-dice queues, but only use the active dice count.
            .filter(values => values.length >= amount)
            .map(values => encodeRoll(values.slice(0, amount)))
        : [];

    while (validRolls.length < count) {
        validRolls.push(encodeRoll(generateDice(amount)));
    }

    return validRolls.slice(0, count);
}


function roomReference(roomId) {
    return doc(db, "games", roomId);
}

function permanentRoomIdReference(diceId) {
    return doc(db, "permanentRoomIds", diceId);
}


function setRoomInUrl(roomId) {

    const url = new URL(window.location.href);
    url.searchParams.set("id", roomId);

    window.history.replaceState({}, "", url);
}


function getRoomFromUrl() {

    const parameters = new URLSearchParams(window.location.search);

    return cleanRoomId(
        parameters.get("id")
    );
}


function showLoading(message) {

    loadingMessage.textContent = message;
    loadingScreen.hidden = false;
    gameScreen.hidden = true;
}


function showGame() {

    loadingScreen.hidden = true;
    gameScreen.hidden = false;
}


function setJoinMessage(message, isError = false) {

    joinMessage.textContent = message;

    joinMessage.classList.toggle(
        "errorMessage",
        isError
    );
}


function createDiceImage(source, className, altText) {

    const image = document.createElement("img");

    image.src = source;
    image.className = className;
    image.alt = altText;

    return image;
}


function showWhiteDice(amount) {

    results.innerHTML = "";

    for (let index = 0; index < amount; index++) {

        results.appendChild(
            createDiceImage(
                whiteDiceImage,
                "dice",
                "Unrolled dice"
            )
        );
    }
}


function showDice(container, values, className = "dice") {

    container.innerHTML = "";

    values.forEach(value => {

        const index = Number(value);

        if (
            !Number.isInteger(index) ||
            !diceImages[index]
        ) {
            return;
        }

        container.appendChild(
            createDiceImage(
                diceImages[index],
                className,
                "Dice result"
            )
        );
    });
}


function startRollingAnimation(amount) {

    stopRollingAnimation();

    showWhiteDice(amount);

    animationTimer = window.setInterval(() => {

        showDice(
            results,
            generateDice(amount),
            "dice shake"
        );

    }, 100);
}


function stopRollingAnimation() {

    if (animationTimer !== null) {

        clearInterval(animationTimer);
        animationTimer = null;
    }
}


function renderHistory(room) {

    history.innerHTML = "";

    const roomHistory = Array.isArray(room?.history)
        ? room.history.slice(-7).reverse()
        : [];

    if (roomHistory.length === 0) {

        const empty = document.createElement("p");

        empty.className = "emptyHistory";
        empty.textContent = "No rolls yet.";

        history.appendChild(empty);
        return;
    }

    roomHistory.forEach(roll => {

        const diceValues =
            typeof roll === "string"
                ? roll
                    .split(",")
                    .map(value => Number(value))
                    .filter(value =>
                        Number.isInteger(value) &&
                        diceImages[value]
                    )
                : Array.isArray(roll?.dice)
                    ? roll.dice
                    : [];

        if (diceValues.length === 0) {
            return;
        }

        const row = document.createElement("div");

        row.className = "historyRow";

        showDice(
            row,
            diceValues,
            "historyDice"
        );

        history.appendChild(row);
    });
}



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
    viewerRegisteredAsViewer = false;
}

async function startViewerPresence(roomId, registerAsViewer = true) {
    const cleanedRoomId = cleanRoomId(roomId);
    const shouldRegisterAsViewer = registerAsViewer === true;

    if (!cleanedRoomId || !currentUser?.uid) return;

    if (
        activeViewerRoomId === cleanedRoomId &&
        viewerCountUnsubscribe &&
        viewerRegisteredAsViewer === shouldRegisterAsViewer
    ) {
        return;
    }

    await stopViewerPresence();

    activeViewerRoomId = cleanedRoomId;
    viewerRegisteredAsViewer = shouldRegisterAsViewer;

    const viewersRef = ref(realtimeDb, `roomViewers/${cleanedRoomId}`);

    // Everyone, including the host, listens to the live viewer count.
    viewerCountUnsubscribe = onValue(viewersRef, snapshot => {
        if (roomViewerCount) {
            roomViewerCount.textContent = String(snapshot.size || 0);
        }
    }, error => {
        console.error("Could not read viewer count:", error);

        if (roomViewerCount) {
            roomViewerCount.textContent = "—";
        }
    });

    // The host only listens to the count and is not added as a viewer.
    if (!shouldRegisterAsViewer) {
        return;
    }

    viewerPresenceRef = push(viewersRef);

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

async function stopHostPresence(markOffline = true) {

    if (unsubscribePresenceConnection) {
        unsubscribePresenceConnection();
        unsubscribePresenceConnection = null;
    }

    if (!activePresenceRef) {
        activePresenceRoomId = "";
        return;
    }

    try {
        await onDisconnect(activePresenceRef).cancel();

        if (markOffline && currentUser?.uid) {
            await set(activePresenceRef, {
                online: false,
                hostUid: currentUser.uid,
                disconnectedAt: realtimeServerTimestamp()
            });
        }
    } catch (error) {
        console.warn("Could not stop host presence:", error);
    }

    activePresenceRef = null;
    activePresenceRoomId = "";
}


async function startHostPresence(roomId) {

    const cleanedRoomId = cleanRoomId(roomId);

    if (!cleanedRoomId || !currentUser?.uid || !isHost) {
        return;
    }

    if (activePresenceRoomId === cleanedRoomId) {
        return;
    }

    await stopHostPresence(true);

    activePresenceRoomId = cleanedRoomId;
    activePresenceRef = ref(
        realtimeDb,
        `roomPresence/${cleanedRoomId}`
    );

    const connectedRef = ref(realtimeDb, ".info/connected");

    unsubscribePresenceConnection = onValue(
        connectedRef,
        async snapshot => {

            if (snapshot.val() !== true || !activePresenceRef) {
                return;
            }

            try {
                await onDisconnect(activePresenceRef).set({
                    online: false,
                    hostUid: currentUser.uid,
                    disconnectedAt: realtimeServerTimestamp()
                });

                await set(activePresenceRef, {
                    online: true,
                    hostUid: currentUser.uid,
                    connectedAt: realtimeServerTimestamp(),
                    disconnectedAt: null
                });
            } catch (error) {
                console.error("Could not update host presence:", error);
            }
        }
    );
}


async function cleanupExpiredRooms() {

    let snapshot;

    try {
        snapshot = await get(ref(realtimeDb, "roomPresence"));
    } catch (error) {
        console.warn("Could not check expired rooms:", error);
        return;
    }

    if (!snapshot.exists()) {
        return;
    }

    const now = Date.now();
    const cleanupTasks = [];

    snapshot.forEach(roomSnapshot => {

        const roomId = cleanRoomId(roomSnapshot.key);
        const presence = roomSnapshot.val() || {};
        const disconnectedAt = Number(presence.disconnectedAt || 0);

        const expired =
    roomId.length >= 4 &&
    roomId.length <= 20 &&
    presence.online !== true &&
    disconnectedAt > 0 &&
    now - disconnectedAt >= ROOM_EXPIRATION_MS;

        if (!expired) {
            return;
        }

        cleanupTasks.push(
            (async () => {
                try {
                    await deleteDoc(roomReference(roomId));
                    await remove(ref(realtimeDb, `roomPresence/${roomId}`));
                    console.info(`Deleted expired room ${roomId}.`);
                } catch (error) {
                    console.warn(`Could not delete expired room ${roomId}:`, error);
                }
            })()
        );
    });

    await Promise.allSettled(cleanupTasks);
}


async function createRoom() {

    await stopHostPresence(true);

    showLoading("Generating your Room...");

    let roomId = "";
    let reference = null;

    for (let attempt = 0; attempt < 25; attempt++) {

        roomId = generateRoomId();

        const candidate = roomReference(roomId);
        const existing = await getDoc(candidate);

        if (!existing.exists()) {
            reference = candidate;
            break;
        }
    }

    if (!reference) {
        throw new Error("Could not create a unique Dice ID.");
    }

    await setDoc(reference, {
        mode: "solo",
        hostId: currentUser.uid,
        diceCount: 3,
        diceSkinId: "default",
        rolling: false,
        latestResult: [],
        pendingResult: [],
        history: [],
        nextRolls: generateFutureRolls(3, 10),
        rollNumber: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    currentRoomId = roomId;
    startupRollNumber = null;

    setRoomInUrl(roomId);
    listenToRoom();
}


async function joinRoom(roomId) {

    const cleanedRoomId = cleanRoomId(roomId);

    if (
        cleanedRoomId.length < 4 ||
        cleanedRoomId.length > 20
    ) {
        throw new Error(
            "Dice ID must be between 4 and 20 characters."
        );
    }

    if (
        activePresenceRoomId &&
        activePresenceRoomId !== cleanedRoomId
    ) {
        await stopHostPresence(true);
    }

    showLoading(`Searching for room ${cleanedRoomId}...`);

    // ==========================
    // Check temporary guest room
    // ==========================

    const guestSnapshot = await getDoc(
        roomReference(cleanedRoomId)
    );

    if (guestSnapshot.exists()) {

        currentRoomId = cleanedRoomId;
        startupRollNumber = null;

        setRoomInUrl(cleanedRoomId);
        listenToRoom();

        return;
    }

    // ==========================
    // Check permanent creator room
    // ==========================

    const permanentSnapshot = await getDoc(
        permanentRoomIdReference(cleanedRoomId)
    );

    if (permanentSnapshot.exists()) {

        window.location.href =
            `room.html?id=${encodeURIComponent(cleanedRoomId)}`;

        return;
    }

    throw new Error("Dice ID was not found.");
}


function stopHostAccountControlsListener() {
    if (unsubscribeHostAccountControls) {
        unsubscribeHostAccountControls();
        unsubscribeHostAccountControls = null;
    }

    activeHostControlUid = "";
    hostAccountControls = {};
    hostAccountControlsLoaded = false;
}

function listenToHostAccountControls(hostUid) {
    const uid = String(hostUid || "").trim();

    if (!isHost || !uid) {
        stopHostAccountControlsListener();
        return;
    }

    if (activeHostControlUid === uid && unsubscribeHostAccountControls) {
        return;
    }

    stopHostAccountControlsListener();
    activeHostControlUid = uid;
    hostAccountControlsLoaded = false;

    unsubscribeHostAccountControls = onSnapshot(
        doc(db, "users", uid),
        snapshot => {
            hostAccountControls = snapshot.exists() ? snapshot.data() : {};
            hostAccountControlsLoaded = true;
            updateScreen();
        },
        error => {
            console.error("Could not read host account controls:", error);
            hostAccountControls = {};
            hostAccountControlsLoaded = true;
            updateScreen();
        }
    );
}

function listenToRoom() {

    if (unsubscribeRoom) {
        unsubscribeRoom();
        unsubscribeRoom = null;
    }

    unsubscribeRoom = onSnapshot(
        roomReference(currentRoomId),

        snapshot => {

            if (!snapshot.exists()) {
                showLoading("This room no longer exists.");
                return;
            }

            currentRoom = snapshot.data();

            if (startupRollNumber === null) {
                startupRollNumber =
                    Number(currentRoom.rollNumber || 0);
            }

            isHost =
                currentRoom.hostId ===
                currentUser.uid;

            if (isHost) {
                listenToHostAccountControls(currentRoom.hostId);
            } else {
                stopHostAccountControlsListener();
            }

            // Both host and guests see the live count.
            // Only guests are registered under roomViewers.
            startViewerPresence(
                currentRoomId,
                !isHost
            ).catch(console.error);

            if (isHost) {
                startHostPresence(currentRoomId);
            } else if (activePresenceRoomId === currentRoomId) {
                stopHostPresence(false);
            }

            updateScreen();
            showGame();
        },

        error => {

            console.error(
                "Room listener failed:",
                error
            );

            showLoading(
                "Could not load the room. Check Firebase Authentication and Firestore rules."
            );
        }
    );
}


function updateScreen() {

    if (!currentRoom) {
        return;
    }

    const amount =
        clampDiceCount(
            currentRoom.diceCount
        );

    const latestResult =
        Array.isArray(currentRoom.latestResult)
            ? currentRoom.latestResult
            : [];

    applyDiceSkin(currentRoom.diceSkinId);

    if (guestDiceSkinSelect) {
        guestDiceSkinSelect.value = currentRoom.diceSkinId || "default";
        renderGuestDiceSkinGallery();
    }

    gameIdElement.textContent =
        currentRoomId;

    roleText.textContent =
        isHost
            ? ""
            : "You are watching this room.";

    // Only the actual room creator can see host controls.
    // Use inline display rules because some CSS can override [hidden].
    if (hostSettings) {
        hostSettings.hidden = !isHost;

        if (toggleHostControls) {
            toggleHostControls.hidden = !isHost;
        }

        if (isHost) {

            if (hostControlsHidden) {
                hostSettings.style.setProperty("display", "none", "important");
            } else {
                hostSettings.style.removeProperty("display");
            }

            if (toggleHostControls) {
                toggleHostControls.textContent =
                    hostControlsHidden
                        ? "Show Host Controls"
                        : "Hide Host Controls";
            }

        } else {

            hostSettings.style.setProperty("display", "none", "important");

            if (toggleHostControls) {
                toggleHostControls.style.setProperty("display", "none", "important");
            }
        }
    }

    if (guestDiceSkinControl) {
        guestDiceSkinControl.hidden = !isHost;
    }

    if (rollButton) {
        rollButton.hidden = !isHost;

        if (isHost) {
            rollButton.style.removeProperty("display");
        } else {
            rollButton.style.setProperty("display", "none", "important");
        }
    }

    if (waitingText) {
        waitingText.hidden = isHost;

        if (isHost) {
            waitingText.style.setProperty("display", "none", "important");
        } else {
            waitingText.style.removeProperty("display");
        }
    }

    diceCountSelect.value =
        String(amount);

    syncGuestDiceCountDisplay();
    updateGuestBlurVisibility();

    const roomIsRolling =
        currentRoom.rolling === true;

    const roomRollingIsSuspended =
        currentRoom.rollingSuspended === true;

    const hostRollingIsRestricted =
        isHost && hostAccountControls.rollingRestricted === true;

    const checkingHostControls =
        isHost && !hostAccountControlsLoaded;

    const rollingIsSuspended =
        roomRollingIsSuspended || hostRollingIsRestricted;

    const rollingControlsDisabled =
        !isHost ||
        roomIsRolling ||
        isRollingLocally ||
        rollingIsSuspended ||
        checkingHostControls;

    rollButton.disabled = rollingControlsDisabled;
    diceCountSelect.disabled = rollingControlsDisabled;

    if (decreaseDiceCountButton) {
        decreaseDiceCountButton.disabled =
            rollingControlsDisabled || amount <= 1;
    }

    if (increaseDiceCountButton) {
        increaseDiceCountButton.disabled =
            rollingControlsDisabled || amount >= 15;
    }

    if (isHost) {
        rollButton.textContent = checkingHostControls
            ? "Checking Access..."
            : rollingIsSuspended
                ? "Rolling Suspended"
                : "Roll Dice";
    }

    syncGuestDiceCountDisplay();

    renderHistory(currentRoom);

    if (roomIsRolling) {

        roomStatus.textContent =
            "🎲 Rolling...";

        if (currentResultPanel) currentResultPanel.hidden = true;

        if (animationTimer === null) {
            startRollingAnimation(amount);
        }

        return;
    }

    stopRollingAnimation();

    const suspensionReason = hostRollingIsRestricted
        ? String(hostAccountControls.restrictionReason || "").trim()
        : String(currentRoom.rollingSuspensionReason || "").trim();

    roomStatus.textContent = checkingHostControls
        ? "Checking rolling access..."
        : rollingIsSuspended
            ? `Rolling suspended${suspensionReason ? `: ${suspensionReason}` : "."}`
            : (isHost
                ? "Ready to roll."
                : "Waiting for the room creator to roll.");

    const currentRollNumber =
        Number(currentRoom.rollNumber || 0);

    const hasNewRollSinceStartup =
        startupRollNumber !== null &&
        currentRollNumber > startupRollNumber;

    if (
    latestResult.length > 0 &&
    (
        !isHost ||
        hasNewRollSinceStartup
    )
) {

        showDice(
            results,
            latestResult,
            "dice"
        );

        if (currentResult && currentResultPanel) {
            showDice(
                currentResult,
                latestResult,
                "currentResultDice"
            );

            currentResultPanel.hidden = false;
        }

    } else {

        showWhiteDice(amount);

        if (currentResult) {
            currentResult.innerHTML = "";
        }

        if (currentResultPanel) {
            currentResultPanel.hidden = true;
        }
    }
}


async function rollDice() {

    if (
        !isHost ||
        !currentRoomId ||
        isRollingLocally ||
        currentRoom?.rolling === true ||
        currentRoom?.rollingSuspended === true ||
        hostAccountControlsLoaded !== true ||
        hostAccountControls.rollingRestricted === true
    ) {
        return;
    }

    isRollingLocally = true;
    updateScreen();

    const reference = roomReference(currentRoomId);

    let finalResult = [];
    let selectedAmount = 3;
    let rollCompleted = false;

    try {
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(reference);

            if (!snapshot.exists()) {
                throw new Error("This room no longer exists.");
            }

            const room = snapshot.data();

            if (room.hostId !== currentUser.uid) {
                throw new Error("Only the room creator can roll.");
            }

            if (room.rollingSuspended === true) {
                throw new Error("ROLLING_SUSPENDED");
            }

            if (hostAccountControls.rollingRestricted === true) {
                throw new Error("ROLLING_SUSPENDED");
            }

            if (room.rolling === true) {
                throw new Error("The dice are already rolling.");
            }

            selectedAmount = clampDiceCount(room.diceCount);

            // Use the same queue behavior as permanent rooms.
            const nextRolls = prepareFutureRolls(
                room.nextRolls,
                selectedAmount,
                10
            );

            finalResult = decodeRoll(nextRolls[0]);

            const remainingNextRolls = nextRolls.slice(1);
            remainingNextRolls.push(
                encodeRoll(generateDice(selectedAmount))
            );

            transaction.update(reference, {
                rolling: true,
                pendingResult: finalResult,
                nextRolls: remainingNextRolls,
                updatedAt: serverTimestamp()
            });
        });

        startRollingAnimation(selectedAmount);

        try {
            rollSound.currentTime = 0;
            await rollSound.play();
        } catch (error) {
            console.info("Dice sound was blocked by the browser.");
        }

        await wait(600);
        await finishRoll(finalResult);

        rollCompleted = true;
        stopRollingAnimation();

        // Show the exact queued result immediately while waiting for onSnapshot.
        showDice(results, finalResult, "dice");

        if (currentResult && currentResultPanel) {
            showDice(currentResult, finalResult, "currentResultDice");
            currentResultPanel.hidden = false;
        }

    } catch (error) {
        if (error?.message === "ROLLING_SUSPENDED") {
            try {
                const suspendedSnapshot = await getDoc(reference);
                if (suspendedSnapshot.exists()) {
                    currentRoom = suspendedSnapshot.data();
                    updateScreen();
                }
            } catch {}
            return;
        }

        console.error("Roll failed:", error);

        try {
            const snapshot = await getDoc(reference);

            if (
                snapshot.exists() &&
                snapshot.data().hostId === currentUser.uid &&
                snapshot.data().rolling === true
            ) {
                await updateDoc(reference, {
                    rolling: false,
                    pendingResult: [],
                    updatedAt: serverTimestamp()
                });
            }
        } catch (unlockError) {
            console.error("Could not unlock the room:", unlockError);
        }

        alert(error.message || "The dice could not be rolled.");

    } finally {
        isRollingLocally = false;

        if (!rollCompleted) {
            stopRollingAnimation();

            if (currentRoom) {
                updateScreen();
            }
        }
    }
}


async function finishRoll(fallbackResult) {

    const reference =
        roomReference(currentRoomId);

    await runTransaction(
        db,

        async transaction => {

            const snapshot =
                await transaction.get(reference);

            if (!snapshot.exists()) {
                throw new Error(
                    "The room disappeared before the roll finished."
                );
            }

            const room = snapshot.data();

            if (
                room.hostId !==
                currentUser.uid
            ) {
                throw new Error(
                    "Only the room creator can finish the roll."
                );
            }

            if (room.rolling !== true) {
                return;
            }

            const pendingResult =
                Array.isArray(room.pendingResult)
                    ? room.pendingResult
                    : [];

            const completedResult =
                pendingResult.length > 0
                    ? pendingResult
                    : fallbackResult;

            if (
                !Array.isArray(completedResult) ||
                completedResult.length === 0
            ) {
                throw new Error(
                    "No final dice result was created."
                );
            }

            const oldHistory =
                Array.isArray(room.history)
                    ? room.history
                    : [];

            /*
             * Firestore does not allow nested arrays.
             * Save every roll as one string such as "0,1,2".
             */
            const newHistory = [
                ...oldHistory,
                completedResult.join(",")
            ].slice(-8);

            transaction.update(
                reference,
                {
                    rolling: false,
                    latestResult: completedResult,
                    pendingResult: [],
                    history: newHistory,
                    rollNumber:
                        Number(room.rollNumber || 0) + 1,
                    updatedAt: serverTimestamp()
                }
            );
        }
    );
}


async function updateDiceCount() {

    if (
        !isHost ||
        !currentRoomId ||
        currentRoom?.rolling === true ||
        currentRoom?.rollingSuspended === true ||
        hostAccountControlsLoaded !== true ||
        hostAccountControls.rollingRestricted === true ||
        isRollingLocally
    ) {
        return;
    }

    const amount =
        clampDiceCount(
            diceCountSelect.value
        );

    diceCountSelect.disabled = true;

    try {

        await updateDoc(
            roomReference(currentRoomId),
            {
                diceCount: amount,
                latestResult: [],
                pendingResult: [],
                nextRolls: generateFutureRolls(amount, 10),
                updatedAt: serverTimestamp()
            }
        );

    } catch (error) {

        console.error(
            "Could not change dice count:",
            error
        );

        alert(
            "Could not change the number of dice."
        );

    } finally {

        diceCountSelect.disabled = false;
        syncGuestDiceCountDisplay();
    }
}


async function copyRoomLink() {

    if (!currentRoomId) {
        return;
    }

    const roomUrl =
        new URL(window.location.href);

    roomUrl.searchParams.set(
        "id",
        currentRoomId
    );

    try {

        await navigator.clipboard.writeText(
    currentRoomId
);

    } catch (error) {

        const input =
            document.createElement("input");

        input.value =
    currentRoomId;

        document.body.appendChild(input);

        input.select();

        document.execCommand("copy");

        input.remove();
    }

    const oldText =
        copyGameIdButton.textContent;

    copyGameIdButton.textContent =
        "✅ Copied";

    setTimeout(() => {

        copyGameIdButton.textContent =
            oldText;

    }, 1200);
}


async function joinAnotherRoom() {

    const roomId =
        cleanRoomId(
            joinRoomIdInput.value
        );

    joinRoomIdInput.value =
        roomId;

    if (roomId.length < 4 || roomId.length > 20) {
    setJoinMessage("Dice ID must be between 4 and 20 characters.", true);
    return;
}

    joinRoomButton.disabled = true;
    joinRoomIdInput.disabled = true;

    setJoinMessage(
        "Joining room..."
    );

    try {

        await joinRoom(roomId);

        joinRoomIdInput.value = "";

        setJoinMessage(
            `Joined room ${roomId}.`
        );

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

    } catch (error) {

        console.error(
            "Could not join room:",
            error
        );

        setJoinMessage(
            error.message ||
            "Could not join the room.",
            true
        );

        showGame();

    } finally {

        joinRoomButton.disabled = false;
        joinRoomIdInput.disabled = false;
    }
}



function cleanProfileUsername(value) {
    return String(value || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 30);
}

function setProfileSearchMessage(message, isError = false) {
    if (!profileSearchMessage) return;
    profileSearchMessage.textContent = message;
    profileSearchMessage.classList.toggle("errorMessage", isError);
}

async function openProfileByExactUsername() {
    if (!profileUsernameSearch || !searchProfileButton) return;

    const usernameLower = cleanProfileUsername(profileUsernameSearch.value);
    profileUsernameSearch.value = usernameLower;

    if (!usernameLower) {
        setProfileSearchMessage("Enter a username.", true);
        profileUsernameSearch.focus();
        return;
    }

    searchProfileButton.disabled = true;
    profileUsernameSearch.disabled = true;
    setProfileSearchMessage("Searching profile...");

    try {
        const usernameSnapshot = await getDoc(doc(db, "usernames", usernameLower));
        let profileUid = usernameSnapshot.exists()
            ? String(usernameSnapshot.data().uid || "").trim()
            : "";

        if (!profileUid) {
            const profileSnapshot = await getDocs(query(
                collection(db, "publicProfiles"),
                where("usernameLower", "==", usernameLower),
                limit(1)
            ));
            if (!profileSnapshot.empty) profileUid = profileSnapshot.docs[0].id;
        }

        if (!profileUid) {
            setProfileSearchMessage("Profile not found. Check the exact username.", true);
            return;
        }

        window.location.href = `profile.html?id=${encodeURIComponent(profileUid)}`;
    } catch (error) {
        console.error("Could not search profile:", error);
        setProfileSearchMessage(
            error?.code === "permission-denied"
                ? "Profile search is blocked by your Firestore rules."
                : "Could not search profiles. Please try again.",
            true
        );
    } finally {
        searchProfileButton.disabled = false;
        profileUsernameSearch.disabled = false;
    }
}

async function routeGoogleUser(user) {
    const userSnapshot = await getDoc(doc(db, "users", user.uid));
    const username = userSnapshot.exists()
        ? String(userSnapshot.data().username || "").trim()
        : "";

    window.location.href = username ? "dashboard.html" : "username.html";
}

async function updateAccountControls(user) {
    const isGoogleUser = Boolean(
        user &&
        !user.isAnonymous &&
        user.providerData.some(
            provider => provider.providerId === "google.com"
        )
    );

    if (signedOutControls) {
        signedOutControls.hidden = isGoogleUser;
    }

    if (signedInControls) {
        signedInControls.hidden = !isGoogleUser;
    }

    // The guest instruction must only appear while signed out.
    if (guestText) {
        guestText.hidden = isGoogleUser;
    }

    if (accountName) {
        accountName.textContent = isGoogleUser
            ? (user.displayName || user.email || "Creator")
            : "";

        const oldBadge = document.getElementById("accountVipBadge");
        if (oldBadge) oldBadge.remove();

        if (isGoogleUser) {
            try {
                const userSnapshot = await getDoc(doc(db, "users", user.uid));
                const isVip = userSnapshot.exists() && userSnapshot.data().vip === true;

                if (isVip) {
                    const badge = document.createElement("span");
                    badge.id = "accountVipBadge";
                    badge.textContent = "VIP";
                    badge.setAttribute("aria-label", "VIP member");
                    badge.style.cssText = [
                        "display:inline-flex",
                        "align-items:center",
                        "margin-left:7px",
                        "padding:3px 8px",
                        "border-radius:999px",
                        "background:linear-gradient(135deg,#ffd700,#ff9d00)",
                        "color:#2a1800",
                        "font-size:11px",
                        "font-weight:800",
                        "letter-spacing:.5px",
                        "vertical-align:middle"
                    ].join(";");
                    accountName.insertAdjacentElement("afterend", badge);
                }
            } catch (error) {
                console.error("Could not load VIP status:", error);
            }
        }
    }
}

if (googleSignInButton) {
    googleSignInButton.addEventListener("click", async () => {
        googleSignInButton.disabled = true;
        authMessage.textContent = "Opening Google sign-in...";

        try {
            const user = await signInWithGoogle();
            authMessage.textContent = "Signed in successfully.";
            await routeGoogleUser(user);
        } catch (error) {
            console.error("Google sign-in failed:", error);
            authMessage.textContent = error.code === "auth/popup-closed-by-user"
                ? "Google sign-in was cancelled."
                : "Could not sign in with Google.";
            googleSignInButton.disabled = false;
        }
    });
}

if (dashboardButton) {
    dashboardButton.addEventListener("click", async () => {
        if (auth.currentUser && !auth.currentUser.isAnonymous) {
            await routeGoogleUser(auth.currentUser);
        }
    });
}

if (signOutButton) {
    signOutButton.addEventListener("click", async () => {
        signOutButton.disabled = true;
        try {
            await logOut();
            window.location.href = "index.html";
        } catch (error) {
            console.error("Sign out failed:", error);
            authMessage.textContent = "Could not sign out.";
            signOutButton.disabled = false;
        }
    });
}

onAuthStateChanged(auth, updateAccountControls);

rollButton.addEventListener(
    "click",
    rollDice
);

if (decreaseDiceCountButton) {
    decreaseDiceCountButton.addEventListener("click", () => {
        setGuestDiceCount(Number(diceCountSelect.value) - 1);
    });
}

if (increaseDiceCountButton) {
    increaseDiceCountButton.addEventListener("click", () => {
        setGuestDiceCount(Number(diceCountSelect.value) + 1);
    });
}

if (diceCountDisplay) {
    diceCountDisplay.addEventListener("change", () => {
        setGuestDiceCount(diceCountDisplay.value);
    });

    diceCountDisplay.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            diceCountDisplay.blur();
        }
    });

    diceCountDisplay.addEventListener("input", () => {
        diceCountDisplay.value = diceCountDisplay.value.replace(/\D/g, "").slice(0, 2);
    });
}

if (guestDiceBlurCheckbox) {
    guestDiceBlurCheckbox.addEventListener("change", () => {
        document.body.classList.toggle(
            "guestDiceBlurEnabled",
            guestDiceBlurCheckbox.checked
        );
    });
}

if (guestDiceSkinPickerButton && guestDiceSkinGallery) {
    guestDiceSkinPickerButton.addEventListener("click", () => {
        const opening = guestDiceSkinGallery.hidden;
        guestDiceSkinGallery.hidden = !opening;
        guestDiceSkinPickerButton.setAttribute("aria-expanded", opening ? "true" : "false");
    });

    document.addEventListener("click", event => {
        if (!guestDiceSkinPickerButton.contains(event.target) && !guestDiceSkinGallery.contains(event.target)) {
            guestDiceSkinGallery.hidden = true;
            guestDiceSkinPickerButton.setAttribute("aria-expanded", "false");
        }
    });
}

if (guestDiceSkinSelect) {
    guestDiceSkinSelect.addEventListener("change", saveGuestDiceSkin);
}

diceCountSelect.addEventListener(
    "change",
    async () => {
        syncGuestDiceCountDisplay();
        await updateDiceCount();
    }
);

copyGameIdButton.addEventListener(
    "click",
    copyRoomLink
);

joinRoomButton.addEventListener(
    "click",
    joinAnotherRoom
);

joinRoomIdInput.addEventListener(
    "input",
    () => {

        joinRoomIdInput.value =
            cleanRoomId(
                joinRoomIdInput.value
            );
    }
);

joinRoomIdInput.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {
            joinAnotherRoom();
        }
    }
);

if (searchProfileButton) {
    searchProfileButton.addEventListener("click", openProfileByExactUsername);
}

if (profileUsernameSearch) {
    profileUsernameSearch.addEventListener("input", () => {
        profileUsernameSearch.value = cleanProfileUsername(profileUsernameSearch.value);
        setProfileSearchMessage("");
    });

    profileUsernameSearch.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            openProfileByExactUsername();
        }
    });
}

window.addEventListener(
    "beforeunload",
    () => {

        stopRollingAnimation();

        if (unsubscribeRoom) {
            unsubscribeRoom();
        }

        stopHostAccountControlsListener();
    }
);


async function startApplication() {

    try {

        showLoading(
            "Connecting..."
        );

        currentUser =
            await authReady;

        if (!currentUser?.uid) {
            throw new Error(
                "Anonymous Firebase sign-in failed."
            );
        }

// await cleanupExpiredRooms();

        await loadDiceSkins();

        const roomIdFromUrl =
            getRoomFromUrl();

        if (roomIdFromUrl) {

            await joinRoom(
                roomIdFromUrl
            );

        } else {

            await createRoom();
        }

    } catch (error) {

        console.error(
            "Application startup failed:",
            error
        );

        showLoading(
            error.message ||
            "The Room could not be opened."
        );
    }
}


[
    ...defaultDiceImages,
    whiteDiceImage
].forEach(source => {

    const image = new Image();
    image.src = source;
});


startApplication();

