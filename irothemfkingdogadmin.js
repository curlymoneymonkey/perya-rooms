/* ==================================
   PERYA DICE ADMIN VIEWER
================================== */

import { authReady, db, functions } from "./firebase.js";
import { isEnabledAdmin } from "./permissions.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";



import {
    httpsCallable
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";

const getSecureRollQueue = httpsCallable(functions, "getSecureRollQueue");
const setSecureRollQueue = httpsCallable(functions, "setSecureRollQueue");

/* ==================================
   DICE DATA
================================== */

const diceImages = [
    "images/red.png",
    "images/blue.png",
    "images/green.png",
    "images/yellow.png",
    "images/purple.png",
    "images/orange.png"
];

const diceColorNames = [
    "Red",
    "Blue",
    "Green",
    "Yellow",
    "Purple",
    "Orange"
];

const ALL_COLOR_INDEXES = diceImages.map((_, index) => index);

const KEYBIND_STORAGE_KEY = "peryaDiceAdminKeybindsV1";
const DEFAULT_KEYBINDS = Object.freeze({
    color0: "1",
    color1: "2",
    color2: "3",
    color3: "4",
    color4: "5",
    color5: "6",
    enableAll: "r",
    toggleAll: "a",
    randomize: "g",
    saveChanges: "Tab"
});

const KEYBIND_LABELS = {
    color0: "Toggle Red",
    color1: "Toggle Blue",
    color2: "Toggle Green",
    color3: "Toggle Yellow",
    color4: "Toggle Purple",
    color5: "Toggle Orange",
    enableAll: "Enable All Colors",
    toggleAll: "Toggle All Colors",
    randomize: "Randomize Next Roll",
    saveChanges: "Save Changes"
};


/* ==================================
   STATE
================================== */

let loadedRoomRef = null;
let loadedRoomType = "";
let loadedRoomPath = "";
let editableNextRolls = [];
let allowedNextOneColors = new Set(ALL_COLOR_INDEXES);
let unsubscribeRoomListener = null;
let autoLoadTimer = null;
let saveTimer = null;
let saveSequence = Promise.resolve();
let loadRequestNumber = 0;
let isApplyingLocalChange = false;
let keybinds = { ...DEFAULT_KEYBINDS };
let keyboardShortcutsEnabled = true;
let keybindBeingEdited = null;
let toastTimer = null;


/* ==================================
   ELEMENTS
================================== */

const accessChecking = document.getElementById("adminAccessChecking");
const adminPanel = document.getElementById("adminPanel");
const gameIdInput = document.getElementById("gameIdInput");
const searchRoomButton = document.getElementById("searchRoomButton");
const rollContainer = document.getElementById("rollContainer");
const gameStatus = document.getElementById("gameStatus");
const roomType = document.getElementById("roomType");
const saveStatus = document.getElementById("saveStatus");
const saveChangesButton = document.getElementById("saveChangesButton");
const keyboardStatus = document.getElementById("keyboardStatus");
const openKeybindSettingsButton = document.getElementById("openKeybindSettingsButton");
const keybindModal = document.getElementById("keybindModal");
const keybindModalCard = document.getElementById("keybindModalCard");
const closeKeybindSettingsButton = document.getElementById("closeKeybindSettingsButton");
const restoreDefaultKeybindsButton = document.getElementById("restoreDefaultKeybindsButton");
const keyboardEnabledCheckbox = document.getElementById("keyboardEnabledCheckbox");
const keybindRows = document.getElementById("keybindRows");
const keybindMessage = document.getElementById("keybindMessage");
const adminToast = document.getElementById("adminToast");


/* ==================================
   HELPERS
================================== */

function cleanGameId(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 20);
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

function encodeRoll(values) {
    return values.join(",");
}

function cloneRolls(rolls) {
    return rolls.map(roll => [...roll]);
}

function rollsAreEqual(first, second) {
    return Array.isArray(first) &&
        Array.isArray(second) &&
        first.length === second.length &&
        first.every((value, index) => value === second[index]);
}

function rollQueuesAreEqual(first, second) {
    return Array.isArray(first) &&
        Array.isArray(second) &&
        first.length === second.length &&
        first.every((roll, index) => rollsAreEqual(roll, second[index]));
}

function didFutureQueueAdvance(previousRolls, incomingRolls) {
    // A completed roll consumes the old Next #1, so the old Next #2
    // becomes the new Next #1. This detects that queue shift.
    return previousRolls.length >= 2 &&
        incomingRolls.length >= 1 &&
        rollsAreEqual(previousRolls[1], incomingRolls[0]);
}

function createDiceImage(value, className = "historyDice") {
    const image = document.createElement("img");
    image.src = diceImages[value];
    image.className = className;
    image.alt = `${diceColorNames[value]} die`;
    return image;
}

function randomAllowedColor() {
    const allowed = [...allowedNextOneColors];
    return allowed[Math.floor(Math.random() * allowed.length)];
}

function stopRoomListener() {
    if (typeof unsubscribeRoomListener === "function") {
        unsubscribeRoomListener();
        unsubscribeRoomListener = null;
    }
}

function clearLoadedRoom() {
    stopRoomListener();
    clearTimeout(saveTimer);
    saveTimer = null;

    loadedRoomRef = null;
    loadedRoomType = "";
    loadedRoomPath = "";
    editableNextRolls = [];
    allowedNextOneColors = new Set(ALL_COLOR_INDEXES);

    rollContainer.innerHTML = "";
    roomType.textContent = "";
    saveStatus.textContent = "";
}

function setSavingStatus(message, isError = false) {
    saveStatus.textContent = message;
    saveStatus.style.color = isError ? "#ff8585" : "";
}

function markUnsaved() {
    isApplyingLocalChange = true;
    setSavingStatus("🟡 Unsaved Changes");
    saveStatus.style.color = "#ffd95a";
    if (saveChangesButton) saveChangesButton.disabled = false;
}

function markSaved(message = "🟢 Saved") {
    isApplyingLocalChange = false;
    setSavingStatus(message);
    saveStatus.style.color = "#7dff9a";
    if (saveChangesButton) saveChangesButton.disabled = true;
}

function randomizeNextRoll() {
    if (!editableNextRolls[0]?.length) {
        showToast("No next roll is loaded.", true);
        return;
    }
    editableNextRolls[0] = editableNextRolls[0].map(() => randomAllowedColor());
    markUnsaved();
    renderRolls();
    showToast("🎲 Next roll randomized");
}


/* ==================================
   KEYBOARD SHORTCUTS
================================== */

function normalizeKeyName(key) {
    if (key === " ") return "Space";
    if (key === "Esc") return "Escape";
    return key.length === 1 ? key.toLowerCase() : key;
}

function displayKeyName(key) {
    if (key === "Escape") return "Esc";
    if (key === "Space") return "Space";
    return key.length === 1 ? key.toUpperCase() : key;
}

function loadKeybindPreferences() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEYBIND_STORAGE_KEY) || "null");
        if (!saved || typeof saved !== "object") return;

        if (saved.keybinds && typeof saved.keybinds === "object") {
            Object.keys(DEFAULT_KEYBINDS).forEach(action => {
                if (typeof saved.keybinds[action] === "string" && saved.keybinds[action]) {
                    keybinds[action] = normalizeKeyName(saved.keybinds[action]);
                }
            });
        }

        if (typeof saved.enabled === "boolean") {
            keyboardShortcutsEnabled = saved.enabled;
        }
    } catch (error) {
        console.warn("Could not load keybind settings:", error);
    }
}

function saveKeybindPreferences() {
    localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify({
        enabled: keyboardShortcutsEnabled,
        keybinds
    }));
}

function isTypingElement(element = document.activeElement) {
    if (!element) return false;
    const tagName = element.tagName;
    return tagName === "INPUT" || tagName === "SELECT" ||
        tagName === "TEXTAREA" || element.isContentEditable;
}

function keyboardIsActive() {
    return keyboardShortcutsEnabled &&
        keybindModal.hidden &&
        !keybindBeingEdited &&
        !isTypingElement();
}

function updateKeyboardStatus() {
    const active = keyboardIsActive();
    keyboardStatus.textContent = active ? "⌨ Keyboard: ON" : "⌨ Keyboard: OFF";
    keyboardStatus.classList.toggle("isOn", active);
    keyboardStatus.classList.toggle("isOff", !active);
}

function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    adminToast.textContent = message;
    adminToast.classList.toggle("isError", isError);
    adminToast.classList.add("isVisible");

    toastTimer = setTimeout(() => {
        adminToast.classList.remove("isVisible");
    }, 1200);
}

function setAllColorsEnabled({ regenerate = true, notify = true } = {}) {
    const alreadyAllEnabled = allowedNextOneColors.size === ALL_COLOR_INDEXES.length;
    allowedNextOneColors = new Set(ALL_COLOR_INDEXES);

    if (regenerate && editableNextRolls[0]?.length && !alreadyAllEnabled) {
        editableNextRolls[0] = editableNextRolls[0].map(() => randomAllowedColor());
        isApplyingLocalChange = true;
        renderRolls();
        markUnsaved();
    } else {
        renderRolls();
    }

    if (notify) showToast("✓ All colors enabled");
}

function toggleAllColors() {
    if (allowedNextOneColors.size === ALL_COLOR_INDEXES.length) {
        // Keep one color enabled so the roll can always be generated safely.
        allowedNextOneColors = new Set([ALL_COLOR_INDEXES.at(-1)]);
        if (editableNextRolls[0]?.length) {
            editableNextRolls[0] = editableNextRolls[0].map(() => randomAllowedColor());
            isApplyingLocalChange = true;
            renderRolls();
            markUnsaved();
        } else {
            renderRolls();
        }
        showToast("All except Orange disabled");
        return;
    }

    setAllColorsEnabled();
}

function findActionForKey(key) {
    return Object.keys(keybinds).find(action => keybinds[action] === key) || null;
}

function runKeybindAction(action) {
    if (action.startsWith("color")) {
        const colorIndex = Number(action.replace("color", ""));
        const wasEnabled = allowedNextOneColors.has(colorIndex);
        const changed = toggleAllowedColor(colorIndex);
        if (changed) {
            showToast(`${wasEnabled ? "✕" : "✓"} ${diceColorNames[colorIndex]} ${wasEnabled ? "disabled" : "enabled"}`);
        }
        return;
    }

    if (action === "enableAll") {
        setAllColorsEnabled();
        return;
    }
    if (action === "toggleAll") {
        toggleAllColors();
        return;
    }
    if (action === "randomize") {
        randomizeNextRoll();
        return;
    }
    if (action === "saveChanges") saveChanges();
}

function renderKeybindSettings() {
    keybindRows.innerHTML = "";

    Object.keys(DEFAULT_KEYBINDS).forEach(action => {
        const row = document.createElement("div");
        row.className = "keybindSettingRow";

        const label = document.createElement("span");
        label.textContent = KEYBIND_LABELS[action];

        const button = document.createElement("button");
        button.type = "button";
        button.className = "keybindCaptureButton";
        button.dataset.action = action;
        button.textContent = keybindBeingEdited === action
            ? "Press any key..."
            : displayKeyName(keybinds[action]);

        button.addEventListener("click", () => {
            keybindBeingEdited = action;
            keybindMessage.textContent = "Press a key, or press Esc to cancel.";
            renderKeybindSettings();
            updateKeyboardStatus();
        });

        row.append(label, button);
        keybindRows.appendChild(row);
    });

    keyboardEnabledCheckbox.checked = keyboardShortcutsEnabled;
}

function openKeybindSettings() {
    keybindBeingEdited = null;
    keybindMessage.textContent = "";
    renderKeybindSettings();
    keybindModal.hidden = false;
    updateKeyboardStatus();
    closeKeybindSettingsButton.focus();
}

function closeKeybindSettings() {
    keybindBeingEdited = null;
    keybindModal.hidden = true;
    keybindMessage.textContent = "";
    updateKeyboardStatus();
    openKeybindSettingsButton.focus();
}

function handleKeybindRecording(event) {
    if (!keybindBeingEdited) return false;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
        keybindBeingEdited = null;
        keybindMessage.textContent = "Key change cancelled.";
        renderKeybindSettings();
        updateKeyboardStatus();
        return true;
    }

    const newKey = normalizeKeyName(event.key);
    const conflictAction = Object.keys(keybinds).find(action =>
        action !== keybindBeingEdited && keybinds[action] === newKey
    );

    if (conflictAction) {
        keybindMessage.textContent = `That key is already assigned to ${KEYBIND_LABELS[conflictAction]}.`;
        return true;
    }

    keybinds[keybindBeingEdited] = newKey;
    keybindBeingEdited = null;
    saveKeybindPreferences();
    keybindMessage.textContent = "✓ Keybind saved.";
    renderKeybindSettings();
    updateKeyboardStatus();
    return true;
}

/* ==================================
   NEXT #1 ALLOWED COLOR SELECTOR
================================== */

function createAllowedColorsPanel() {
    const panel = document.createElement("section");
    panel.className = "allowedColorsPanel";
    panel.setAttribute("aria-label", "Allowed colors for Next number 1");

    const title = document.createElement("p");
    title.className = "allowedColorsTitle";
    title.textContent = "ALL POSSIBLE COLORS FOR NEXT #1";
    panel.appendChild(title);

    const row = document.createElement("div");
    row.className = "allowedColorsRow";

    ALL_COLOR_INDEXES.forEach(colorIndex => {
        const enabled = allowedNextOneColors.has(colorIndex);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "allowedColorButton";
        button.classList.toggle("isDisabled", !enabled);
        button.setAttribute("aria-pressed", String(enabled));
        button.setAttribute(
            "aria-label",
            `${diceColorNames[colorIndex]} is ${enabled ? "enabled" : "disabled"} for Next number 1`
        );
        button.title = `${diceColorNames[colorIndex]} — click to ${enabled ? "disable" : "enable"}`;
        button.appendChild(createDiceImage(colorIndex, ""));

        button.addEventListener("click", () => {
            toggleAllowedColor(colorIndex);
        });

        row.appendChild(button);
    });

    panel.appendChild(row);
    return panel;
}

function toggleAllowedColor(colorIndex) {
    const isCurrentlyEnabled = allowedNextOneColors.has(colorIndex);

    if (isCurrentlyEnabled && allowedNextOneColors.size === 1) {
        setSavingStatus("At least one color must remain enabled.", true);
        showToast("At least one color must remain enabled", true);
        return false;
    }

    if (isCurrentlyEnabled) {
        allowedNextOneColors.delete(colorIndex);
    } else {
        allowedNextOneColors.add(colorIndex);
    }

    if (!editableNextRolls[0] || editableNextRolls[0].length === 0) {
        renderRolls();
        return true;
    }

    editableNextRolls[0] = editableNextRolls[0].map(() => randomAllowedColor());
    isApplyingLocalChange = true;
    renderRolls();
    markUnsaved();
    return true;
}


/* ==================================
   ROLL EDITOR
================================== */

function createColorSelect(rollIndex, dieIndex, selectedValue) {
    const select = document.createElement("select");
    select.setAttribute(
        "aria-label",
        `Next roll ${rollIndex + 1}, die ${dieIndex + 1}`
    );

    diceColorNames.forEach((colorName, colorIndex) => {
        const option = document.createElement("option");
        option.value = String(colorIndex);
        option.textContent = colorName;
        option.selected = colorIndex === selectedValue;
        select.appendChild(option);
    });

    return select;
}

function normalizeNextRolls(nextRolls) {
    return Array.isArray(nextRolls)
        ? nextRolls
            .map(decodeRoll)
            .filter(values => values.length > 0)
            .slice(0, 10)
        : [];
}

function renderRolls() {
    rollContainer.innerHTML = "";

    if (editableNextRolls.length === 0) {
        const message = document.createElement("p");
        message.className = "emptyHistory";
        message.textContent =
            "This room exists, but it does not currently have stored future rolls.";
        rollContainer.appendChild(message);
        return;
    }

    const editor = document.createElement("div");
    editor.className = "futureRollEditor";

    // This selector is shown once and affects only Next #1.
    editor.appendChild(createAllowedColorsPanel());

    editableNextRolls.forEach((diceValues, rollIndex) => {
        const row = document.createElement("div");
        row.className = "futureRollRow";

        const number = document.createElement("span");
        number.className = "futureRollNumber";
        number.textContent = `Next #${rollIndex + 1}`;
        row.appendChild(number);

        diceValues.forEach((value, dieIndex) => {
            const dieEditor = document.createElement("label");
            dieEditor.className = "futureDieEditor";

            const image = createDiceImage(value);
            image.alt = `${diceColorNames[value]} future die`;

            const select = createColorSelect(rollIndex, dieIndex, value);

            select.addEventListener("change", () => {
                const newValue = Number(select.value);
                editableNextRolls[rollIndex][dieIndex] = newValue;
                image.src = diceImages[newValue];
                image.alt = `${diceColorNames[newValue]} future die`;

                isApplyingLocalChange = true;
                markUnsaved();
            });

            dieEditor.appendChild(image);
            dieEditor.appendChild(select);
            row.appendChild(dieEditor);
        });

        editor.appendChild(row);
    });

    rollContainer.appendChild(editor);
}


/* ==================================
   FIND ROOM
================================== */

async function findGuestRoom(gameId) {
    const snapshot = await getDoc(doc(db, "games", gameId));

    if (!snapshot.exists()) {
        return null;
    }

    return {
        type: "Guest Room",
        ref: snapshot.ref,
        data: snapshot.data()
    };
}

async function findPermanentRoom(gameId) {
    const permanentRoomQuery = query(
        collection(db, "permanentRooms"),
        where("diceId", "==", gameId),
        limit(1)
    );

    const snapshot = await getDocs(permanentRoomQuery);

    if (snapshot.empty) {
        return null;
    }

    return {
        type: "Permanent Room",
        ref: snapshot.docs[0].ref,
        data: snapshot.docs[0].data()
    };
}

async function findRoom(gameId) {
    const guestRoom = await findGuestRoom(gameId);
    return guestRoom || await findPermanentRoom(gameId);
}


function secureRoomType(type) {
    return type === "Guest Room" ? "guest" : "permanent";
}

async function loadSecureQueue(roomRef, type) {
    const response = await getSecureRollQueue({
        roomType: secureRoomType(type),
        roomId: roomRef.id
    });
    return normalizeNextRolls(response.data?.rolls);
}

/* ==================================
   LIVE ROOM UPDATES
================================== */

function startRoomListener(roomRef, type) {
    stopRoomListener();
    let lastRollNumber = null;

    unsubscribeRoomListener = onSnapshot(
        roomRef,
        async snapshot => {
            if (!snapshot.exists()) {
                gameStatus.textContent = "This room no longer exists.";
                rollContainer.innerHTML = "";
                loadedRoomRef = null;
                return;
            }

            loadedRoomRef = snapshot.ref;
            loadedRoomType = type;
            loadedRoomPath = snapshot.ref.path;
            gameStatus.textContent = "🟢 Room connected";
            roomType.textContent = type;

            const rollNumber = Number(snapshot.data()?.rollNumber || 0);
            if (lastRollNumber === null) {
                lastRollNumber = rollNumber;
                return;
            }
            if (rollNumber === lastRollNumber || isApplyingLocalChange) return;
            lastRollNumber = rollNumber;

            try {
                editableNextRolls = await loadSecureQueue(snapshot.ref, type);
                allowedNextOneColors = new Set(ALL_COLOR_INDEXES);
                isApplyingLocalChange = false;
                setSavingStatus("Color choices reset for the new Next #1.");
                showToast("✓ New roll: all colors re-enabled");
                renderRolls();
            } catch (error) {
                console.error("Could not refresh secure future rolls:", error);
            }
        },
        error => {
            console.error("Live admin room listener failed:", error);
            gameStatus.textContent = "Live updates stopped. Check the browser console.";
        }
    );
}

/* ==================================
   AUTO LOAD ROOM
================================== */

async function loadGame() {
    const gameId = cleanGameId(gameIdInput.value);
    gameIdInput.value = gameId;

    const requestNumber = ++loadRequestNumber;
    clearLoadedRoom();

    if (gameId.length < 4 || gameId.length > 20) {
        gameStatus.textContent =
            gameId.length === 0
                ? ""
                : "Dice ID must be between 4 and 20 characters.";
        return;
    }

    gameStatus.textContent = "Searching for room...";
    gameIdInput.disabled = true;
    searchRoomButton.disabled = true;

    try {
        const room = await findRoom(gameId);

        if (requestNumber !== loadRequestNumber) {
            return;
        }

        if (!room) {
            gameStatus.textContent = "Game not found.";
            return;
        }

        allowedNextOneColors = new Set(ALL_COLOR_INDEXES);
        loadedRoomRef = room.ref;
        loadedRoomType = room.type;
        loadedRoomPath = room.ref.path;
        editableNextRolls = await loadSecureQueue(room.ref, room.type);

        gameStatus.textContent = "Room found.";
        roomType.textContent = room.type;
        renderRolls();
        startRoomListener(room.ref, room.type);
    } catch (error) {
        console.error("Could not load admin room:", error);
        gameStatus.textContent =
            "Could not load the room. Check Firestore rules and the browser console.";
    } finally {
        if (requestNumber === loadRequestNumber) {
            gameIdInput.disabled = false;
            searchRoomButton.disabled = false;
            gameIdInput.focus();
        }
    }
}

function scheduleAutoLoad() {
    clearTimeout(autoLoadTimer);

    const gameId = cleanGameId(gameIdInput.value);
    gameIdInput.value = gameId;

    if (gameId.length < 4) {
        ++loadRequestNumber;
        clearLoadedRoom();
        gameStatus.textContent = "";
        return;
    }

    gameStatus.textContent = "Waiting to search...";
    autoLoadTimer = setTimeout(loadGame, 650);
}


/* ==================================
   MANUAL SAVE
================================== */

async function saveChanges() {
    if (!loadedRoomRef || !loadedRoomPath || editableNextRolls.length === 0) {
        showToast("No room is loaded.", true);
        return;
    }
    if (saveChangesButton?.disabled) {
        showToast("No unsaved changes.");
        return;
    }

    const roomRefToSave = loadedRoomRef;
    const roomPathToSave = loadedRoomPath;
    const rollsToSave = cloneRolls(editableNextRolls);

    if (saveChangesButton) saveChangesButton.disabled = true;
    setSavingStatus("Saving changes...");

    try {
        await setSecureRollQueue({
            roomType: secureRoomType(loadedRoomType),
            roomId: roomRefToSave.id,
            rolls: rollsToSave.map(encodeRoll)
        });
        if (loadedRoomPath === roomPathToSave &&
            rollQueuesAreEqual(editableNextRolls, rollsToSave)) {
            markSaved();
            showToast("✓ Changes saved");
        }
    } catch (error) {
        console.error("Could not save future rolls:", error);
        if (loadedRoomPath === roomPathToSave) {
            isApplyingLocalChange = true;
            setSavingStatus("❌ Could not save the secure future-roll queue.", true);
            if (saveChangesButton) saveChangesButton.disabled = false;
            showToast("Save failed.", true);
        }
    }
}


/* ==================================
   EVENTS
================================== */

searchRoomButton.addEventListener("click", () => {
    clearTimeout(autoLoadTimer);
    loadGame();
});

gameIdInput.addEventListener("input", scheduleAutoLoad);

gameIdInput.addEventListener("paste", () => {
    setTimeout(scheduleAutoLoad, 0);
});

gameIdInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(autoLoadTimer);
        loadGame();
    }
});


saveChangesButton?.addEventListener("click", saveChanges);
openKeybindSettingsButton.addEventListener("click", openKeybindSettings);
closeKeybindSettingsButton.addEventListener("click", closeKeybindSettings);

keybindModal.addEventListener("click", event => {
    if (event.target === keybindModal) closeKeybindSettings();
});

keybindModalCard.addEventListener("click", event => event.stopPropagation());

keyboardEnabledCheckbox.addEventListener("change", () => {
    keyboardShortcutsEnabled = keyboardEnabledCheckbox.checked;
    saveKeybindPreferences();
    updateKeyboardStatus();
});

restoreDefaultKeybindsButton.addEventListener("click", () => {
    keybinds = { ...DEFAULT_KEYBINDS };
    keyboardShortcutsEnabled = true;
    saveKeybindPreferences();
    keybindMessage.textContent = "✓ Default keybinds restored.";
    renderKeybindSettings();
    updateKeyboardStatus();
});

document.addEventListener("focusin", updateKeyboardStatus);
document.addEventListener("focusout", () => setTimeout(updateKeyboardStatus, 0));
document.addEventListener("click", () => setTimeout(updateKeyboardStatus, 0));

document.addEventListener("keydown", event => {
    if (handleKeybindRecording(event)) return;

    if (!keybindModal.hidden) {
        if (event.key === "Escape") {
            event.preventDefault();
            closeKeybindSettings();
        }
        return;
    }

    if (!keyboardIsActive() || event.repeat) return;

    const normalizedKey = normalizeKeyName(event.key);
    const action = findActionForKey(normalizedKey);
    if (!action) return;

    event.preventDefault();
    runKeybindAction(action);
});

/* ==================================
   SECURE ADMIN ACCESS
================================== */

async function initializeAdminPage() {
    try {
        const user = await authReady;
        const allowed = await isEnabledAdmin(user);

        if (!allowed) {
            window.location.replace("index.html");
            return;
        }

        loadKeybindPreferences();
        renderKeybindSettings();

        accessChecking.style.display = "none";
        adminPanel.style.display = "block";
        gameIdInput.focus();
        updateKeyboardStatus();
    } catch (error) {
        console.error("Administrator access check failed:", error);
        window.location.replace("index.html");
    }
}

window.addEventListener("beforeunload", stopRoomListener);

initializeAdminPage();
