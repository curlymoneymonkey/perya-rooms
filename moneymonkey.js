/* ==================================
   Tile Dice ADMIN VIEWER
================================== */

import { authReady, db, functions, realtimeDb } from "./firebase.js";
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

import {
    get as getRealtimeValue,
    ref as realtimeRef
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const getSecureRollQueue = httpsCallable(functions, "getSecureRollQueue");
const setSecureRollQueue = httpsCallable(functions, "setSecureRollQueue");
const getSecureBallDropQueue = httpsCallable(functions, "getSecureBallDropQueue");
const setSecureBallDropQueue = httpsCallable(functions, "setSecureBallDropQueue");

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



const ballDropColorNames = ["Purple", "Yellow", "Red", "Green", "Orange", "Blue"];

function activeColorNames() {
    return loadedGameMode === "ballDrop"
        ? ballDropColorNames
        : diceColorNames;
}

function activeColorName(colorIndex) {
    return activeColorNames()[colorIndex] || "Color";
}

function createAllowedColorPreview(colorIndex) {
    if (loadedGameMode === "ballDrop") {
        const preview = createBallDropPreview(colorIndex);
        preview.classList.add("allowedBallColorPreview");
        return preview;
    }

    return createDiceImage(colorIndex, "");
}

function normalizeGameMode(room) {
    return room?.gameMode === "ballDrop" ? "ballDrop" : "dice";
}

function updateWeightedPatternPercentagesVisibility() {
    if (!weightedPatternPercentages || !favorThreeColorRollsCheckbox) return;
    weightedPatternPercentages.hidden =
        loadedGameMode !== "dice" || !favorThreeColorRollsCheckbox.checked;
}

function createBallDropPreview(value) {
    const preview = document.createElement("span");
    preview.className = `ballDropAdminPreview ${String(ballDropColorNames[value] || "").toLowerCase()}`;
    preview.title = ballDropColorNames[value] || "Color";
    return preview;
}

function createBallDropColorSelect(rollIndex, ballIndex, selectedValue) {
    const select = document.createElement("select");
    select.setAttribute(
        "aria-label",
        `Color Balls result ${rollIndex + 1}, ball ${ballIndex + 1}`
    );

    const allowedIndexes = [...allowedNextOneColors].sort((a, b) => a - b);

    allowedIndexes.forEach(index => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = ballDropColorNames[index];
        option.selected = index === selectedValue;
        select.appendChild(option);
    });

    return select;
}

function renderBallDropRolls() {
    rollContainer.innerHTML = "";

    if (!editableNextRolls.length) {
        rollContainer.innerHTML =
            '<p class="emptyHistory">No future Color Balls results are available.</p>';
        return;
    }

    const editor = document.createElement("div");
    editor.className = "futureRollEditor ballDropFutureEditor";

    editor.appendChild(createAllowedColorsPanel());

    const extraDropsContainer = document.createElement("div");
    extraDropsContainer.className = "extraFutureRolls ballDropExtraFutureRolls";
    extraDropsContainer.hidden = !extraRollsVisible;

    editableNextRolls.forEach((values, rollIndex) => {
        const row = document.createElement("div");
        row.className = "futureRollRow ballDropFutureRow";

        const number = document.createElement("span");
        number.className = "futureRollNumber";
        number.textContent =
            rollIndex === 0
                ? "Next Drop"
                : `Next #${rollIndex + 1}`;
        row.appendChild(number);

        values.forEach((value, ballIndex) => {
            const editorCell = document.createElement("label");
            editorCell.className = "futureDieEditor ballDropBallEditor";

            const preview = createBallDropPreview(value);
            const select = createBallDropColorSelect(
                rollIndex,
                ballIndex,
                value
            );

            select.addEventListener("change", () => {
                const newValue = Number(select.value);
                editableNextRolls[rollIndex][ballIndex] = newValue;
                preview.className =
                    `ballDropAdminPreview ${ballDropColorNames[newValue].toLowerCase()}`;
                isApplyingLocalChange = true;
                markUnsaved();
                scheduleAutoSave();
            });

            editorCell.append(preview, select);
            row.appendChild(editorCell);
        });

        if (rollIndex === 0) {
            editor.appendChild(row);
            editor.appendChild(createInlineSaveButton());
        } else {
            extraDropsContainer.appendChild(row);
        }
    });

    if (editableNextRolls.length > 1) {
        const toggleWrap = document.createElement("div");
        toggleWrap.className = "moreRollsToggleWrap";

        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "moreRollsToggleButton";
        toggleButton.textContent = extraRollsVisible
            ? "Hide Next #2–#10"
            : "Show Next #2–#10";
        toggleButton.setAttribute(
            "aria-expanded",
            String(extraRollsVisible)
        );

        toggleButton.addEventListener("click", () => {
            extraRollsVisible = !extraRollsVisible;
            renderRolls();
        });

        toggleWrap.appendChild(toggleButton);
        editor.appendChild(toggleWrap);
        editor.appendChild(extraDropsContainer);
    }

    rollContainer.appendChild(editor);
}

/* ==================================
   STATE
================================== */

let loadedRoomRef = null;
let loadedRoomType = "";
let loadedRoomPath = "";
let editableNextRolls = [];
let loadedGameMode = "dice";
let loadedOneToSixDiceMode = false;
let loadedBallDropCount = 3;
let allowedNextOneColors = new Set(ALL_COLOR_INDEXES);
let unsubscribeRoomListener = null;
let currentAdminUser = null;
let isRefreshingRoom = false;
let saveTimer = null;
let saveSequence = Promise.resolve();
let loadRequestNumber = 0;
let isApplyingLocalChange = false;
let keybinds = { ...DEFAULT_KEYBINDS };
let keyboardShortcutsEnabled = true;
let keybindBeingEdited = null;
let toastTimer = null;
let extraRollsVisible = true;
let favorThreeColorRolls = false;


/* ==================================
   ELEMENTS
================================== */

const accessChecking = document.getElementById("adminAccessChecking");
const adminPanel = document.getElementById("adminPanel");
const gameIdInput = document.getElementById("gameIdInput");
const searchRoomButton = document.getElementById("searchRoomButton");
const rollContainer = document.getElementById("rollContainer");
const gameStatus = document.getElementById("gameStatus");
const connectedRoomId = document.getElementById("connectedRoomId");
const roomType = document.getElementById("roomType");
const saveStatus = document.getElementById("saveStatus");
function getSaveChangesButton() {
    return document.getElementById("saveChangesButton");
}
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
const favorThreeColorRollsCheckbox = document.getElementById("favorThreeColorRollsCheckbox");
const weightedPatternPercentages = document.getElementById("weightedPatternPercentages");


/* ==================================
   HELPERS
================================== */

function cleanGameId(value) {
    return String(value || "")
        .trim()
        .replace(/[^A-Za-z0-9]/g, "")
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
    extraRollsVisible = true;
    favorThreeColorRolls = false;

    if (favorThreeColorRollsCheckbox) {
        favorThreeColorRollsCheckbox.checked = false;
        favorThreeColorRollsCheckbox.closest(".colorWeightingToggle")?.setAttribute("hidden", "");
    }
    updateWeightedPatternPercentagesVisibility();

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
    getSaveChangesButton()?.removeAttribute("disabled");
}

// Automatically save edits after a short pause so rapid changes are grouped
// into one secure queue update instead of requiring the Save Changes button.
function scheduleAutoSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveChanges();
    }, 500);
}

function createInlineSaveButton() {
    const wrap = document.createElement("div");
    wrap.className = "saveChangesWrap inlineSaveChangesWrap";

    const button = document.createElement("button");
    button.id = "saveChangesButton";
    button.type = "button";
    button.textContent = "💾 Save Changes";
    button.disabled = !isApplyingLocalChange;
    button.addEventListener("click", saveChanges);

    wrap.appendChild(button);
    return wrap;
}

function markSaved(message = "🟢 Saved") {
    isApplyingLocalChange = false;
    setSavingStatus(message);
    saveStatus.style.color = "#7dff9a";
    getSaveChangesButton()?.setAttribute("disabled", "");
}

function chooseWeightedPattern() {
    // For four dice, these pattern probabilities total 100%:
    // 4 same = 0.29%
    // 3 same + 1 different = 5.84%
    // 2 + 2 = 7.57%
    // 3 colors (2 + 1 + 1) = 80%
    // 4 different = 6.30%
    const patterns = [
        { name: "fourSame", weight: 0.36 },
        { name: "threeSame", weight: 7.30 },
        { name: "twoAndTwo", weight: 9.46 },
        { name: "threeColors", weight: 75 },
        { name: "fourDifferent", weight: 7.88 }
    ];

    const totalWeight = patterns.reduce((sum, pattern) => sum + pattern.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const pattern of patterns) {
        roll -= pattern.weight;
        if (roll < 0) return pattern.name;
    }

    return "threeColors";
}

function generateFourDiceWeightedRoll() {
    const allowedColors = [...allowedNextOneColors];

    if (!allowedColors.length) {
        return Array(4).fill(0);
    }

    const randomColor = () =>
        allowedColors[Math.floor(Math.random() * allowedColors.length)];

    const pickDistinctColors = (count) => {
        const pool = [...allowedColors];

        // If there are not enough allowed colors, use the maximum available.
        const target = Math.min(count, pool.length);

        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        return pool.slice(0, target);
    };

    const shuffle = (values) => {
        for (let i = values.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [values[i], values[j]] = [values[j], values[i]];
        }
        return values;
    };

    const pattern = chooseWeightedPattern();
    let result;

    // If the selected pattern cannot be produced because too few unique
    // colors are enabled, fall back to the closest possible pattern.
    switch (pattern) {
        case "fourSame": {
            const color = randomColor();
            result = [color, color, color, color];
            break;
        }

        case "threeSame": {
            const colors = pickDistinctColors(2);
            if (colors.length < 2) {
                const color = colors[0] ?? randomColor();
                result = [color, color, color, color];
            } else {
                result = [colors[0], colors[0], colors[0], colors[1]];
            }
            break;
        }

        case "twoAndTwo": {
            const colors = pickDistinctColors(2);
            if (colors.length < 2) {
                const color = colors[0] ?? randomColor();
                result = [color, color, color, color];
            } else {
                result = [colors[0], colors[0], colors[1], colors[1]];
            }
            break;
        }

        case "threeColors": {
            const colors = pickDistinctColors(3);
            if (colors.length < 3) {
                if (colors.length === 2) {
                    result = [colors[0], colors[0], colors[1], colors[1]];
                } else {
                    const color = colors[0] ?? randomColor();
                    result = [color, color, color, color];
                }
            } else {
                // 2 + 1 + 1: exactly three unique colors.
                result = [colors[0], colors[0], colors[1], colors[2]];
            }
            break;
        }

        case "fourDifferent": {
            const colors = pickDistinctColors(4);
            if (colors.length < 4) {
                if (colors.length === 3) {
                    result = [colors[0], colors[0], colors[1], colors[2]];
                } else if (colors.length === 2) {
                    result = [colors[0], colors[0], colors[1], colors[1]];
                } else {
                    const color = colors[0] ?? randomColor();
                    result = [color, color, color, color];
                }
            } else {
                result = colors.slice(0, 4);
            }
            break;
        }

        default:
            result = Array(4).fill(null).map(randomColor);
    }

    return shuffle(result);
}

function generateWeightedNextRoll(diceCount) {
    if (!favorThreeColorRolls) {
        return Array.from({ length: diceCount }, () => randomAllowedColor());
    }

    // The requested pattern probabilities are specifically for a 4-dice roll.
    // Preserve normal independent randomization for other dice counts.
    if (diceCount !== 4) {
        return Array.from({ length: diceCount }, () => randomAllowedColor());
    }

    return generateFourDiceWeightedRoll();
}

function shuffleArray(values) {
    const shuffled = [...values];

    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] =
            [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled;
}


function randomizeNextRoll() {
    if (!editableNextRolls[0]?.length) {
        showToast("No next roll is loaded.", true);
        return;
    }

    editableNextRolls[0] = generateWeightedNextRoll(editableNextRolls[0].length);
    markUnsaved();
    renderRolls();

    if (loadedGameMode === "ballDrop") {
        showToast("⚪ Next drop randomized");
    } else if (favorThreeColorRolls) {
        showToast("🎲 Next roll randomized — 3-color mode");
    } else {
        showToast("🎲 Next roll randomized");
    }
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
        editableNextRolls[0] = generateWeightedNextRoll(editableNextRolls[0].length);
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
            editableNextRolls[0] = generateWeightedNextRoll(editableNextRolls[0].length);
            isApplyingLocalChange = true;
            renderRolls();
            markUnsaved();
        } else {
            renderRolls();
        }
        showToast(`All except ${activeColorName(ALL_COLOR_INDEXES.at(-1))} disabled`);
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
            showToast(
                `${wasEnabled ? "✕" : "✓"} ${activeColorName(colorIndex)} ` +
                `${wasEnabled ? "disabled" : "enabled"}`
            );
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
        if (action.startsWith("color")) {
            const colorIndex = Number(action.replace("color", ""));
            label.textContent = `Toggle ${activeColorName(colorIndex)}`;
        } else if (action === "randomize") {
            label.textContent = loadedGameMode === "ballDrop"
                ? "Randomize Next Drop"
                : "Randomize Next Roll";
        } else {
            label.textContent = KEYBIND_LABELS[action];
        }

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
        const colorName = activeColorName(colorIndex);
        const enabled = allowedNextOneColors.has(colorIndex);
        const button = document.createElement("button");

        button.type = "button";
        button.className = "allowedColorButton";
        button.classList.toggle("isDisabled", !enabled);
        button.setAttribute("aria-pressed", String(enabled));
        button.setAttribute(
            "aria-label",
            `${colorName} is ${enabled ? "enabled" : "disabled"} for Next number 1`
        );
        button.title =
            `${colorName} — click to ${enabled ? "disable" : "enable"}`;

        button.appendChild(createAllowedColorPreview(colorIndex));

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

    editableNextRolls[0] = generateWeightedNextRoll(editableNextRolls[0].length);
    isApplyingLocalChange = true;
    renderRolls();
    markUnsaved();
    scheduleAutoSave();
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

function createDiceCountSelect(rollIndex, diceCount) {
    const wrap = document.createElement("label");
    wrap.className = "futureDiceCountEditor";
    const label = document.createElement("span");
    label.textContent = "Dice count";
    const select = document.createElement("select");
    select.className = "futureDiceCountSelect";
    select.setAttribute("aria-label", `Predetermined dice count for roll ${rollIndex + 1}`);

    // Only allow changing the predetermined count when the room is configured
    // to use the 1-to-6 dice mode. In other modes, show the count read-only.
    const maxCount = loadedOneToSixDiceMode ? 6 : Math.max(6, diceCount);
    for (let count = 1; count <= maxCount; count++) {
        const option = document.createElement("option");
        option.value = String(count);
        option.textContent = String(count);
        option.selected = count === diceCount;
        select.appendChild(option);
    }
    select.disabled = !loadedOneToSixDiceMode;
    select.title = loadedOneToSixDiceMode
        ? "Choose how many dice the next roll will contain"
        : 'Dice count can only be changed in "1 to 6 dice" mode';

    select.addEventListener("change", () => {
        if (!loadedOneToSixDiceMode) {
            select.value = String(diceCount);
            return;
        }
        const newCount = Math.min(6, Math.max(1, Number(select.value) || diceCount));
        const current = editableNextRolls[rollIndex] || [];
        const fallbackColor = current[0] ?? randomAllowedColor();
        editableNextRolls[rollIndex] = current.slice(0, newCount);
        while (editableNextRolls[rollIndex].length < newCount) {
            editableNextRolls[rollIndex].push(fallbackColor);
        }
        markUnsaved();
        renderRolls();
        if (typeof scheduleAutoSave === "function") scheduleAutoSave();
    });

    wrap.append(label, select);
    return wrap;
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
    if (loadedGameMode === "ballDrop") {
        renderBallDropRolls();
        return;
    }
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

    // This selector affects only the immediate next roll.
    editor.appendChild(createAllowedColorsPanel());

    const extraRollsContainer = document.createElement("div");
    extraRollsContainer.className = "extraFutureRolls";
    extraRollsContainer.hidden = !extraRollsVisible;

    editableNextRolls.forEach((diceValues, rollIndex) => {
        const row = document.createElement("div");
        row.className = "futureRollRow";

        const number = document.createElement("span");
        number.className = "futureRollNumber";
        number.textContent =
            rollIndex === 0
                ? "Next Roll"
                : `Next #${rollIndex + 1}`;
        const header = document.createElement("div");
        header.className = "futureRollHeader";
        header.appendChild(number);
        // Only show the dice-count selector while the room is configured for
        // the dedicated 1-to-6 dice mode. In all other modes, hide it entirely.
        if (loadedOneToSixDiceMode) {
            header.appendChild(createDiceCountSelect(rollIndex, diceValues.length));
        }
        row.appendChild(header);

        diceValues.forEach((value, dieIndex) => {
            const dieEditor = document.createElement("label");
            dieEditor.className = "futureDieEditor";

            const image = createDiceImage(value);
            image.alt = `${diceColorNames[value]} future die`;

            // The die itself is the color picker trigger; no visible select box.
            const colorButton = document.createElement("button");
            colorButton.type = "button";
            colorButton.className = "futureDieColorButton";
            colorButton.setAttribute("aria-label", `Choose color for Next ${rollIndex + 1}, die ${dieIndex + 1}`);
            colorButton.title = `Click to change color (${diceColorNames[value]})`;
            colorButton.appendChild(image);

            const select = createColorSelect(rollIndex, dieIndex, value);
            select.classList.add("futureDieColorSelect");

            colorButton.addEventListener("click", () => {
                // showPicker opens the native color-choice list from the die click.
                if (typeof select.showPicker === "function") {
                    try { select.showPicker(); }
                    catch (_) { select.click(); }
                } else {
                    select.focus();
                    select.click();
                }
            });

            select.addEventListener("change", () => {
                const newValue = Number(select.value);
                editableNextRolls[rollIndex][dieIndex] = newValue;
                image.src = diceImages[newValue];
                image.alt = `${diceColorNames[newValue]} future die`;
                colorButton.title = `Click to change color (${diceColorNames[newValue]})`;
                colorButton.setAttribute("aria-label", `Choose color for Next ${rollIndex + 1}, die ${dieIndex + 1}; current color ${diceColorNames[newValue]}`);

                isApplyingLocalChange = true;
                markUnsaved();
                scheduleAutoSave();
            });

            dieEditor.append(colorButton, select);
            row.appendChild(dieEditor);
        });

        if (rollIndex === 0) {
            editor.appendChild(row);
            editor.appendChild(createInlineSaveButton());
        } else {
            extraRollsContainer.appendChild(row);
        }
    });

    if (editableNextRolls.length > 1) {
        const toggleWrap = document.createElement("div");
        toggleWrap.className = "moreRollsToggleWrap";

        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "moreRollsToggleButton";
        toggleButton.textContent =
            extraRollsVisible
                ? "Hide More Rolls"
                : "Show More Rolls";
        toggleButton.setAttribute("aria-expanded", String(extraRollsVisible));

        toggleButton.addEventListener("click", () => {
            extraRollsVisible = !extraRollsVisible;
            renderRolls();
        });

        toggleWrap.appendChild(toggleButton);
        editor.appendChild(toggleWrap);
        editor.appendChild(extraRollsContainer);
    }

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

/**
 * Automatically resolve the signed-in administrator's own room.
 * Permanent rooms are preferred; guest rooms are checked as a fallback.
 */
/**
 * Resolve the room the signed-in user is actively hosting right now.
 * The main room page publishes its live host presence at
 * roomPresence/{roomId}; do not select permanent rooms merely by ownership.
 */
async function findActiveRoom(user) {
    if (!user?.uid) return null;

    // Only connect to a room that this signed-in admin is actively hosting.
    // Do not accept arbitrary room IDs from the URL or a manual search field.

    const presenceSnapshot = await getRealtimeValue(
        realtimeRef(realtimeDb, "roomPresence")
    );

    if (!presenceSnapshot.exists()) return null;

    const activeRoomIds = [];
    presenceSnapshot.forEach(roomSnapshot => {
        const presence = roomSnapshot.val() || {};
        if (presence.online === true && presence.hostUid === user.uid) {
            activeRoomIds.push(cleanGameId(roomSnapshot.key));
        }
    });

    for (const roomId of activeRoomIds.reverse()) {
        if (!roomId) continue;
        const room = await findRoom(roomId);
        if (room) return room;
    }

    return null;
}

function secureRoomType(type) {
    return type === "Guest Room" ? "guest" : "permanent";
}

async function loadSecureQueue(roomRef, type, roomData = null) {
    loadedGameMode = normalizeGameMode(roomData);
    loadedOneToSixDiceMode = roomData?.oneToSixDiceMode === true;
    if (loadedGameMode === "ballDrop") {
        const response = await getSecureBallDropQueue({
            roomType: secureRoomType(type),
            roomId: roomRef.id
        });
        loadedBallDropCount = Number(response.data?.ballCount || roomData?.ballDropBallCount || 3);
        return normalizeNextRolls(response.data?.results);
    }

    const response = await getSecureRollQueue({
        roomType: secureRoomType(type),
        roomId: roomRef.id
    });
    // Match irothemfkingdogadmin.js: preserve each queued roll's exact dice count
    // and colors, including 1-to-6 mode. Do not pad shorter rolls to six dice.
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
            if (connectedRoomId) {
                connectedRoomId.textContent = `Dice ID: ${cleanGameId(snapshot.data()?.diceId || snapshot.ref.id)}`;
            }
            gameStatus.textContent = "🟢 Room connected";
            roomType.textContent = type;

            const snapshotRoom = snapshot.data() || {};
            const previousOneToSixMode = loadedOneToSixDiceMode;
            loadedOneToSixDiceMode = snapshotRoom.oneToSixDiceMode === true;
            const oneToSixModeChanged = previousOneToSixMode !== loadedOneToSixDiceMode;
            const currentMode = normalizeGameMode(snapshotRoom);
            const rollNumber = currentMode === "ballDrop"
                ? Number(snapshotRoom.ballDropRound || 0)
                : Number(snapshotRoom.rollNumber || 0);
            if (lastRollNumber === null) {
                lastRollNumber = rollNumber;
                return;
            }
            if ((rollNumber === lastRollNumber && !oneToSixModeChanged) || isApplyingLocalChange) return;
            lastRollNumber = rollNumber;

            try {
                editableNextRolls = await loadSecureQueue(snapshot.ref, type, snapshot.data());
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

    gameStatus.textContent = "Connecting...";
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
        if (connectedRoomId) {
            connectedRoomId.textContent = `Dice ID: ${cleanGameId(room.data?.diceId || room.ref.id)}`;
        }
        editableNextRolls = await loadSecureQueue(room.ref, room.type, room.data);

        favorThreeColorRolls = false;
        if (favorThreeColorRollsCheckbox) {
            favorThreeColorRollsCheckbox.checked = false;
            favorThreeColorRollsCheckbox.closest(".colorWeightingToggle")?.removeAttribute("hidden");
        }
        updateWeightedPatternPercentagesVisibility();

        gameStatus.textContent = "🟢 Room connected";
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


/* ==================================
   MANUAL SAVE
================================== */

async function saveChanges() {
    if (!loadedRoomRef || !loadedRoomPath || editableNextRolls.length === 0) {
        showToast("No room is loaded.", true);
        return;
    }
    if (getSaveChangesButton()?.disabled) {
        showToast("No unsaved changes.");
        return;
    }

    const roomRefToSave = loadedRoomRef;
    const roomPathToSave = loadedRoomPath;
    const rollsToSave = cloneRolls(editableNextRolls);

    getSaveChangesButton()?.setAttribute("disabled", "");
    setSavingStatus("Saving changes...");

    try {
        if (loadedGameMode === "ballDrop") {
            await setSecureBallDropQueue({
                roomType: secureRoomType(loadedRoomType),
                roomId: roomRefToSave.id,
                results: rollsToSave.map(encodeRoll)
            });
        } else {
            await setSecureRollQueue({
                roomType: secureRoomType(loadedRoomType),
                roomId: roomRefToSave.id,
                rolls: rollsToSave.map(encodeRoll)
            });
        }
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
            getSaveChangesButton()?.removeAttribute("disabled");
            showToast("Save failed.", true);
        }
    }
}


/* ==================================
   EVENTS
================================== */

if (favorThreeColorRollsCheckbox) {
    favorThreeColorRollsCheckbox.addEventListener("change", async () => {
        if (!loadedRoomRef) {
            favorThreeColorRollsCheckbox.checked = false;
            return;
        }

        favorThreeColorRolls = favorThreeColorRollsCheckbox.checked;
        updateWeightedPatternPercentagesVisibility();

        if (loadedGameMode === "dice" && editableNextRolls.length) {
            // Apply the ON/OFF mode to all currently loaded future rolls (up to 10).
            // ON = weighted pattern probabilities.
            // OFF = normal unbiased randomization.
            editableNextRolls = editableNextRolls.slice(0, 10).map(values =>
                generateWeightedNextRoll(values.length)
            );

            markUnsaved();
            renderRolls();

            // Checking or unchecking automatically saves the updated queue.
            await saveChanges();
        }

        showToast(
            favorThreeColorRolls
                ? "✓ Weighted patterns enabled and saved"
                : "✓ Normal randomization restored and saved"
        );
    });
}



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

async function refreshCurrentRoom(preferredRoomId = "") {
    if (!currentAdminUser) return;

    // Do not block a newer room change while an older Firestore request is still running.
    // loadGame() uses request numbers so only the latest requested room can win.
    isRefreshingRoom = true;
    searchRoomButton.disabled = true;
    gameStatus.textContent = "Refreshing room connection...";

    try {
        let activeId = cleanGameId(
            preferredRoomId || localStorage.getItem("peryaActiveRoomId") || ""
        );

        // Fast path: the main game page publishes the room ID to localStorage as soon
        // as the user creates or enters a room. Use presence only as a fallback.
        if (!activeId) {
            const activeRoom = await findActiveRoom(currentAdminUser);
            if (activeRoom) {
                activeId = cleanGameId(activeRoom.data?.diceId || activeRoom.ref.id);
            }
        }

        if (!activeId) {
            clearLoadedRoom();
            if (connectedRoomId) connectedRoomId.textContent = "Dice ID: —";
            gameStatus.textContent = "No active room found yet. Enter a room, or click Refresh Room.";
            return;
        }

        gameIdInput.value = activeId;
        await loadGame();
    } catch (error) {
        console.error("Could not refresh active room:", error);
        gameStatus.textContent = "Could not refresh the room. Check the browser console.";
    } finally {
        // Don't let an older refresh re-enable the button while a newer one is running.
        if (loadRequestNumber >= 0) {
            isRefreshingRoom = false;
            searchRoomButton.disabled = false;
        }
    }
}

searchRoomButton.addEventListener("click", () => refreshCurrentRoom());

// Room changes from the main game page are shared across tabs through localStorage.
// This makes the viewer switch immediately instead of relying on stale RTDB presence.
window.addEventListener("storage", event => {
    if (event.key !== "peryaActiveRoomId" || !event.newValue) return;
    const nextRoomId = cleanGameId(event.newValue);
    if (!nextRoomId || nextRoomId === cleanGameId(gameIdInput.value)) return;
    refreshCurrentRoom(nextRoomId);
});

async function initializeAdminPage() {
    try {
        const user = await authReady;
        let allowed = await isEnabledAdmin(user);

        // Allow enabled administrators as before, plus users explicitly granted
        // Monkey access in their own Firestore user document.
        if (!allowed && user && !user.isAnonymous) {
            const userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists()) {
                const userData = userSnap.data();
                allowed = userData.moneymonkeyAccess === true
                    || userData.imamonkeyandilovemoneyAccess === true
                    || (Array.isArray(userData.allowedPages)
                        && (userData.allowedPages.includes("moneymonkey.html")
                            || userData.allowedPages.includes("imamonkeyandilovemoney.html")));
            }
        }

        if (!allowed) {
            window.location.replace("index.html");
            return;
        }

        currentAdminUser = user;
        loadKeybindPreferences();
        renderKeybindSettings();

        accessChecking.style.display = "none";
        adminPanel.style.display = "block";
        updateKeyboardStatus();

        gameIdInput.disabled = true;
        gameIdInput.value = "";
        searchRoomButton.disabled = false;
        gameStatus.textContent = "Connecting to your active room...";
        if (connectedRoomId) connectedRoomId.textContent = "Dice ID: —";

        // Automatically connect to the administrator's active room on page load.
        // The Refresh Room button remains available to reconnect after changing rooms.
        await refreshCurrentRoom();
    } catch (error) {
        console.error("Administrator access check failed:", error);
        window.location.replace("index.html");
    }
}

window.addEventListener("beforeunload", () => {
    stopRoomListener();
});

initializeAdminPage();
