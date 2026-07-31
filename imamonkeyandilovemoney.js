/* ==================================
   PERYA DICE ROOM ACCESS
================================== */

import { authReady, db } from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    serverTimestamp,
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const REDIRECT_PAGE = "dashboard.html";
const KEYBIND_STORAGE_KEY = "peryaDiceRoomAccessKeybinds";
const KEYBOARD_ENABLED_STORAGE_KEY = "peryaDiceRoomAccessKeyboardEnabled";

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

const DEFAULT_KEYBINDS = Object.freeze({
    red: "1",
    blue: "2",
    green: "3",
    yellow: "4",
    purple: "5",
    orange: "6",
    enableAll: "r",
    toggleAll: "a",
    randomize: "g",
    saveChanges: "Tab"
});

const COLOR_ACTIONS = [
    { action: "red", colorIndex: 0 },
    { action: "blue", colorIndex: 1 },
    { action: "green", colorIndex: 2 },
    { action: "yellow", colorIndex: 3 },
    { action: "purple", colorIndex: 4 },
    { action: "orange", colorIndex: 5 }
];

let signedInUser = null;
let loadedRoomRef = null;
let loadedRoomPath = "";
let editableNextRolls = [];
let allowedNextOneColors = new Set(ALL_COLOR_INDEXES);
let unsubscribeRoomListener = null;
let saveTimer = null;
let saveSequence = Promise.resolve();
let isApplyingLocalChange = false;
let keybinds = loadKeybinds();
let keyboardShortcutsEnabled =
    localStorage.getItem(KEYBOARD_ENABLED_STORAGE_KEY) !== "false";
let recordingAction = null;
let toastTimer = null;

const accessChecking = document.getElementById("roomAccessChecking");
const roomAccessPanel = document.getElementById("roomAccessPanel");
const rollContainer = document.getElementById("rollContainer");
const roomStatus = document.getElementById("roomStatus");
const roomIdentity = document.getElementById("roomIdentity");
const saveStatus = document.getElementById("saveStatus");
const saveChangesButton = document.getElementById("saveChangesButton");
const keybindSettingsButton = document.getElementById("keybindSettingsButton");
const keyboardStatus = document.getElementById("keyboardStatus");
const keybindModal = document.getElementById("keybindModal");
const keybindModalPanel = document.getElementById("keybindModalPanel");
const closeKeybindModalButton = document.getElementById("closeKeybindModalButton");
const restoreDefaultKeybindsButton = document.getElementById("restoreDefaultKeybindsButton");
const keyboardEnabledCheckbox = document.getElementById("keyboardEnabledCheckbox");
const keybindRows = document.getElementById("keybindRows");
const keybindMessage = document.getElementById("keybindMessage");
const toast = document.getElementById("roomAccessToast");

function redirectAway() {
    window.location.replace(REDIRECT_PAGE);
}

function timestampToMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function permissionIsActive(data) {
    if (!data || data.roomAccess !== true) return false;

    const expiresAt = timestampToMillis(data.roomAccessExpiresAt);
    return expiresAt === null || expiresAt > Date.now();
}

function decodeRoll(value) {
    if (Array.isArray(value)) {
        return value
            .map(Number)
            .filter(index => Number.isInteger(index) && diceImages[index]);
    }

    if (typeof value !== "string") return [];

    return value
        .split(",")
        .map(Number)
        .filter(index => Number.isInteger(index) && diceImages[index]);
}

function encodeRoll(values) {
    return values.join(",");
}

function normalizeNextRolls(nextRolls) {
    return Array.isArray(nextRolls)
        ? nextRolls
            .map(decodeRoll)
            .filter(values => values.length > 0)
            .slice(0, 10)
        : [];
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
    showToast("Next roll randomized.");
}

function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("isError", isError);
    toast.classList.add("show");

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 1200);
}

function stopRoomListener() {
    if (typeof unsubscribeRoomListener === "function") {
        unsubscribeRoomListener();
        unsubscribeRoomListener = null;
    }
}

function loadKeybinds() {
    try {
        const stored = JSON.parse(localStorage.getItem(KEYBIND_STORAGE_KEY));
        return { ...DEFAULT_KEYBINDS, ...(stored || {}) };
    } catch {
        return { ...DEFAULT_KEYBINDS };
    }
}

function saveKeybinds() {
    localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(keybinds));
}

function normalizeKeyboardKey(event) {
    if (event.key === "Escape") return "Escape";
    if (event.key === " ") return "Space";
    return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function displayKey(key) {
    if (key === "Escape") return "Esc";
    if (key === "Space") return "Space";
    return key.length === 1 ? key.toUpperCase() : key;
}

function isTypingTarget(target) {
    return target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
}

function keyboardIsActive() {
    return keyboardShortcutsEnabled &&
        !recordingAction &&
        keybindModal.hidden &&
        !isTypingTarget(document.activeElement);
}

function updateKeyboardStatus() {
    const active = keyboardIsActive();
    keyboardStatus.textContent = `⌨ Keyboard: ${active ? "ON" : "OFF"}`;
    keyboardStatus.classList.toggle("isOn", active);
    keyboardStatus.classList.toggle("isOff", !active);
}

function resetAllowedColors(message = "All colors enabled.") {
    allowedNextOneColors = new Set(ALL_COLOR_INDEXES);
    renderRolls();
    setSavingStatus(message);
    showToast(`✓ ${message}`);
}

function toggleAllColors() {
    if (allowedNextOneColors.size === ALL_COLOR_INDEXES.length) {
        allowedNextOneColors = new Set([ALL_COLOR_INDEXES[0]]);
        if (editableNextRolls[0]?.length) {
            editableNextRolls[0] = editableNextRolls[0].map(() => ALL_COLOR_INDEXES[0]);
            isApplyingLocalChange = true;
            markUnsaved();
        }
        renderRolls();
        showToast("Only Red remains enabled.");
        return;
    }

    resetAllowedColors();
}

function createAllowedColorsPanel() {
    const panel = document.createElement("section");
    panel.className = "allowedColorsPanel";
    panel.setAttribute("aria-label", "Allowed colors for Next number 1");

    const title = document.createElement("p");
    title.className = "allowedColorsTitle";
    title.textContent = "ALL POSSIBLE COLORS NEXT ROLL";
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
        button.title = `${diceColorNames[colorIndex]} — click to ${enabled ? "disable" : "enable"}`;
        button.appendChild(createDiceImage(colorIndex, ""));
        button.addEventListener("click", () => toggleAllowedColor(colorIndex));
        row.appendChild(button);
    });

    panel.appendChild(row);
    return panel;
}

function toggleAllowedColor(colorIndex) {
    const enabled = allowedNextOneColors.has(colorIndex);

    if (enabled && allowedNextOneColors.size === 1) {
        setSavingStatus("At least one color must remain enabled.", true);
        showToast("At least one color must remain enabled.", true);
        return;
    }

    if (enabled) allowedNextOneColors.delete(colorIndex);
    else allowedNextOneColors.add(colorIndex);

    if (editableNextRolls[0]?.length) {
        editableNextRolls[0] = editableNextRolls[0].map(() => randomAllowedColor());
        isApplyingLocalChange = true;
        markUnsaved();
    }

    renderRolls();
    showToast(`${diceColorNames[colorIndex]} ${enabled ? "disabled" : "enabled"}.`);
}

function createColorSelect(rollIndex, dieIndex, selectedValue) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Next roll ${rollIndex + 1}, die ${dieIndex + 1}`);

    diceColorNames.forEach((colorName, colorIndex) => {
        const option = document.createElement("option");
        option.value = String(colorIndex);
        option.textContent = colorName;
        option.selected = colorIndex === selectedValue;
        select.appendChild(option);
    });

    select.addEventListener("focus", updateKeyboardStatus);
    select.addEventListener("blur", updateKeyboardStatus);
    return select;
}

function renderRolls() {
    rollContainer.innerHTML = "";

    if (editableNextRolls.length === 0) {
        const message = document.createElement("p");
        message.className = "emptyHistory roomAccessError";
        message.textContent = "Your permanent room does not currently have a stored next roll.";
        rollContainer.appendChild(message);
        return;
    }

    const editor = document.createElement("div");
    editor.className = "futureRollEditor";
    editor.appendChild(createAllowedColorsPanel());

    editableNextRolls.slice(0, 1).forEach((diceValues, rollIndex) => {
        const row = document.createElement("div");
        row.className = "futureRollRow";

        const number = document.createElement("span");
        number.className = "futureRollNumber";
        number.textContent = "NEXT ROLL";
        row.appendChild(number);

        diceValues.forEach((value, dieIndex) => {
            const dieEditor = document.createElement("label");
            dieEditor.className = "futureDieEditor";

            const image = createDiceImage(value);
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

function keybindDefinitions() {
    return [
        ...COLOR_ACTIONS.map(({ action, colorIndex }) => ({
            action,
            label: `Toggle ${diceColorNames[colorIndex]}`
        })),
        { action: "enableAll", label: "Enable All Colors" },
        { action: "toggleAll", label: "Toggle All Colors" },
        { action: "randomize", label: "Randomize Next Roll" },
        { action: "saveChanges", label: "Save Changes" }
    ];
}

function renderKeybindRows() {
    keybindRows.innerHTML = "";

    keybindDefinitions().forEach(({ action, label }) => {
        const row = document.createElement("div");
        row.className = "keybindRow";

        const name = document.createElement("span");
        name.textContent = label;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "keybindCaptureButton";
        button.dataset.action = action;
        button.textContent = recordingAction === action
            ? "Press any key..."
            : displayKey(keybinds[action]);

        button.addEventListener("click", () => {
            recordingAction = action;
            keybindMessage.textContent = "Press a key. Press Esc to cancel.";
            renderKeybindRows();
            updateKeyboardStatus();
        });

        row.append(name, button);
        keybindRows.appendChild(row);
    });
}

function openKeybindModal() {
    recordingAction = null;
    keybindMessage.textContent = "";
    keyboardEnabledCheckbox.checked = keyboardShortcutsEnabled;
    renderKeybindRows();
    keybindModal.hidden = false;
    document.body.classList.add("modalOpen");
    updateKeyboardStatus();
    closeKeybindModalButton.focus();
}

function closeKeybindModal() {
    recordingAction = null;
    keybindModal.hidden = true;
    document.body.classList.remove("modalOpen");
    updateKeyboardStatus();
    keybindSettingsButton.focus();
}

function assignRecordedKey(event) {
    if (!recordingAction) return false;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
        recordingAction = null;
        keybindMessage.textContent = "Key change cancelled.";
        renderKeybindRows();
        updateKeyboardStatus();
        return true;
    }

    const newKey = normalizeKeyboardKey(event);
    const duplicate = Object.entries(keybinds).find(
        ([action, assignedKey]) => action !== recordingAction && assignedKey === newKey
    );

    if (duplicate) {
        const duplicateLabel = keybindDefinitions()
            .find(item => item.action === duplicate[0])?.label || duplicate[0];
        keybindMessage.textContent = `That key is already assigned to ${duplicateLabel}.`;
        showToast("Duplicate keybind blocked.", true);
        return true;
    }

    keybinds[recordingAction] = newKey;
    saveKeybinds();
    recordingAction = null;
    keybindMessage.textContent = "Keybind saved.";
    renderKeybindRows();
    updateKeyboardStatus();
    showToast("Keybind saved.");
    return true;
}

function performShortcut(action) {
    const colorAction = COLOR_ACTIONS.find(item => item.action === action);

    if (colorAction) {
        toggleAllowedColor(colorAction.colorIndex);
        return;
    }

    if (action === "enableAll") {
        resetAllowedColors("All colors enabled.");
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

function handleGlobalKeydown(event) {
    if (assignRecordedKey(event)) return;
    if (!keyboardIsActive()) return;
    if (event.repeat) return;

    const pressedKey = normalizeKeyboardKey(event);
    const match = Object.entries(keybinds)
        .find(([, assignedKey]) => assignedKey === pressedKey);

    if (!match) return;

    event.preventDefault();
    performShortcut(match[0]);
}

async function getActivePermission(user) {
    const snapshot = await getDoc(doc(db, "specialPermissions", user.uid));
    return snapshot.exists() && permissionIsActive(snapshot.data());
}

async function isRegisteredUser(user) {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    return snapshot.exists();
}

async function findRoomByDocumentId(uid) {
    const snapshot = await getDoc(doc(db, "permanentRooms", uid));
    return snapshot.exists() ? snapshot : null;
}

async function findRoomByOwnerField(uid) {
    const possibleOwnerFields = ["ownerUid", "userId", "uid", "createdBy"];

    for (const field of possibleOwnerFields) {
        const snapshot = await getDocs(query(
            collection(db, "permanentRooms"),
            where(field, "==", uid),
            limit(1)
        ));

        if (!snapshot.empty) return snapshot.docs[0];
    }

    return null;
}

async function findOwnedPermanentRoom(user) {
    return await findRoomByDocumentId(user.uid) || await findRoomByOwnerField(user.uid);
}

function displayRoomIdentity(snapshot) {
    const data = snapshot.data();
    const diceId = data.diceId || data.gameId || snapshot.id;
    roomIdentity.textContent = `Permanent Room • Dice ID: ${diceId}`;
}

function startRoomListener(roomRef) {
    stopRoomListener();

    unsubscribeRoomListener = onSnapshot(
        roomRef,
        snapshot => {
            if (!snapshot.exists()) {
                roomStatus.textContent = "Your permanent room no longer exists.";
                rollContainer.innerHTML = "";
                loadedRoomRef = null;
                return;
            }

            loadedRoomRef = snapshot.ref;
            loadedRoomPath = snapshot.ref.path;
            roomStatus.textContent = "🟢 Your room is connected";
            displayRoomIdentity(snapshot);

            const incomingRolls = normalizeNextRolls(snapshot.data().nextRolls);
            const queueAdvanced = didFutureQueueAdvance(editableNextRolls, incomingRolls);
            const incomingMatchesLocal = rollQueuesAreEqual(editableNextRolls, incomingRolls);

            if (isApplyingLocalChange && !queueAdvanced && !incomingMatchesLocal) return;

            if (queueAdvanced) {
                allowedNextOneColors = new Set(ALL_COLOR_INDEXES);
                setSavingStatus("All disabled colors reset after the roll.");
                showToast("All colors reset for the new next roll.");
            }

            editableNextRolls = incomingRolls;
            if (queueAdvanced || incomingMatchesLocal) isApplyingLocalChange = false;
            renderRolls();
        },
        error => {
            console.error("Room Access listener failed:", error);
            roomStatus.textContent = "Live updates stopped. Check Firestore rules.";
        }
    );
}

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
        await updateDoc(roomRefToSave, {
            nextRolls: rollsToSave.map(encodeRoll),
            updatedAt: serverTimestamp()
        });
        if (loadedRoomPath === roomPathToSave &&
            rollQueuesAreEqual(editableNextRolls, rollsToSave)) {
            markSaved();
            showToast("Changes saved.");
        }
    } catch (error) {
        console.error("Could not save future rolls:", error);
        isApplyingLocalChange = true;
        setSavingStatus("❌ Could not save. Check your Room Access Firestore rules.", true);
        if (saveChangesButton) saveChangesButton.disabled = false;
        showToast("Save failed.", true);
    }
}

async function initializeRoomAccessPage() {
    try {
        const user = await authReady;
        if (!user) {
            redirectAway();
            return;
        }

        signedInUser = user;

        const [registered, allowed] = await Promise.all([
            isRegisteredUser(user),
            getActivePermission(user)
        ]);

        if (!registered || !allowed) {
            redirectAway();
            return;
        }

        const roomSnapshot = await findOwnedPermanentRoom(user);
        if (!roomSnapshot) {
            redirectAway();
            return;
        }

        loadedRoomRef = roomSnapshot.ref;
        loadedRoomPath = roomSnapshot.ref.path;
        editableNextRolls = normalizeNextRolls(roomSnapshot.data().nextRolls);

        accessChecking.hidden = true;
        roomAccessPanel.hidden = false;
        roomStatus.textContent = "Your permanent room was found.";
        displayRoomIdentity(roomSnapshot);
        renderRolls();
        updateKeyboardStatus();
        startRoomListener(roomSnapshot.ref);
    } catch (error) {
        console.error("Room Access initialization failed:", error);
        redirectAway();
    }
}

saveChangesButton?.addEventListener("click", saveChanges);
keybindSettingsButton.addEventListener("click", openKeybindModal);
closeKeybindModalButton.addEventListener("click", closeKeybindModal);

restoreDefaultKeybindsButton.addEventListener("click", () => {
    keybinds = { ...DEFAULT_KEYBINDS };
    saveKeybinds();
    recordingAction = null;
    keybindMessage.textContent = "Default keybinds restored.";
    renderKeybindRows();
    showToast("Default keybinds restored.");
});

keyboardEnabledCheckbox.addEventListener("change", () => {
    keyboardShortcutsEnabled = keyboardEnabledCheckbox.checked;
    localStorage.setItem(
        KEYBOARD_ENABLED_STORAGE_KEY,
        String(keyboardShortcutsEnabled)
    );
    updateKeyboardStatus();
});

keybindModal.addEventListener("click", event => {
    if (event.target === keybindModal) closeKeybindModal();
});

document.addEventListener("keydown", handleGlobalKeydown);
document.addEventListener("focusin", updateKeyboardStatus);
document.addEventListener("focusout", () => setTimeout(updateKeyboardStatus, 0));
document.addEventListener("pointerdown", () => setTimeout(updateKeyboardStatus, 0));

window.addEventListener("beforeunload", stopRoomListener);
initializeRoomAccessPage();
