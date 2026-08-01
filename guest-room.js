/* ==================================
   IMPORTS
================================== */

import {
    db,
    auth,
    authReady,
    functions
} from "./firebase.js";

import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    onSnapshot,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    httpsCallable
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";

const startSecureMiddlemanRoll = httpsCallable(
    functions,
    "startSecureMiddlemanRoll"
);


/* ==================================
   DICE
================================== */

const diceImages = [
    "images/red.png",
    "images/blue.png",
    "images/green.png",
    "images/yellow.png",
    "images/purple.png",
    "images/orange.png"
];

const diceColors = [
    { id: "red", name: "Red", image: "images/red.png" },
    { id: "blue", name: "Blue", image: "images/blue.png" },
    { id: "green", name: "Green", image: "images/green.png" },
    { id: "yellow", name: "Yellow", image: "images/yellow.png" },
    { id: "purple", name: "Purple", image: "images/purple.png" },
    { id: "orange", name: "Orange", image: "images/orange.png" }
];

const whiteDiceImage = "images/white.png";

const rollSound = new Audio("sounds/dice-roll.mp3");
rollSound.volume = 0.6;


/* ==================================
   ELEMENTS
================================== */

const homeScreen = document.getElementById("homeScreen");
const gameScreen = document.getElementById("gameScreen");
const historySection = document.getElementById("historySection");

const playerNameInput = document.getElementById("playerName");
const joinGameIdInput = document.getElementById("joinGameId");

const createRoomButton = document.getElementById("createRoomButton");
const joinBettorButton = document.getElementById("joinBettorButton");

const homeMessage = document.getElementById("homeMessage");

const gameIdElement = document.getElementById("gameId");
const copyGameIdButton = document.getElementById("copyGameId");
const currentRoleElement = document.getElementById("currentRole");

const middlemanName = document.getElementById("middlemanName");
const bettor1Name = document.getElementById("bettor1Name");
const bettor2Name = document.getElementById("bettor2Name");

const bettor1BetStatus = document.getElementById("bettor1BetStatus");
const bettor2BetStatus = document.getElementById("bettor2BetStatus");

const betSentButton = document.getElementById("betSentButton");
const middlemanBetControls = document.getElementById("middlemanBetControls");
const markBettor1SentButton =
    document.getElementById("markBettor1SentButton");
const markBettor2SentButton =
    document.getElementById("markBettor2SentButton");

const kickBettor1 = document.getElementById("kickBettor1");
const kickBettor2 = document.getElementById("kickBettor2");

const roomStatus = document.getElementById("roomStatus");
const hostSettings = document.getElementById("hostSettings");
const diceCount = document.getElementById("diceCount");

const results = document.getElementById("results");
const currentResultPanel =
    document.getElementById("currentResultPanel");

const currentResult =
    document.getElementById("currentResult");
const rollButton = document.getElementById("rollButton");
const waitingText = document.getElementById("waitingText");
const leaveRoomButton = document.getElementById("leaveRoomButton");
const history = document.getElementById("history");
const queuePanel = document.getElementById("queuePanel");
const queueList = document.getElementById("queueList");

const colorPickPanel = document.getElementById("colorPickPanel");
const colorChoices = document.getElementById("colorChoices");
const selectedColorText = document.getElementById("selectedColorText");

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatButton = document.getElementById("sendChatButton");

const roomClosingOverlay =
    document.getElementById("roomClosingOverlay");
const roomClosingCountdown =
    document.getElementById("roomClosingCountdown");
const roomClosingMessage =
    document.getElementById("roomClosingMessage");


/* ==================================
   CURRENT USER / ROOM
================================== */

let currentUser = null;
let currentGameId = "";
let currentRole = "";
let currentGameData = null;
let stopRoomListener = null;
let animationTimer = null;
let leavingRoom = false;
let roomClosingTimer = null;
let roomDeleteTimer = null;
let roundResetTimer = null;
let closingOverlayActive = false;
let fallbackClosingAt = null;


/* ==================================
   HELPERS
================================== */

function generateGameId(length = 5) {
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    const randomBytes = new Uint8Array(length);
    crypto.getRandomValues(randomBytes);

    return Array.from(
        randomBytes,
        byte => characters[byte % characters.length]
    ).join("");
}


// This randomness is visual-only and is never used as the final result.
// The real dice result is generated by Firebase Cloud Functions.
function generateAnimationDice(amount) {
    return Array.from(
        { length: amount },
        () => Math.floor(Math.random() * diceImages.length)
    );
}


function cleanName() {
    const name = playerNameInput.value.trim();

    if (!name) {
        throw new Error("Please enter your Username.");
    }

    return name.slice(0, 20);
}


function cleanGameId() {
    const enteredId =
        joinGameIdInput.value
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");

    if (enteredId.length !== 5) {
        throw new Error(
            "Dice ID must contain 5 characters."
        );
    }

    return enteredId;
}


function getGameReference(gameId) {
    return doc(db, "games", gameId);
}


function roleLabel(role) {
    if (role === "middleman") {
        return "Middleman 👑";
    }

    if (role === "bettor1") {
        return "Bettor 1";
    }

    if (role === "bettor2") {
        return "Bettor 2";
    }

    if (role === "queue") {
        return "Queued Bettor";
    }

    return "Viewer";
}


function setHomeMessage(message, isError = false) {
    homeMessage.textContent = message;

    homeMessage.classList.toggle(
        "errorMessage",
        isError
    );
}


function saveRoomSession() {
    sessionStorage.setItem(
        "peryaGameId",
        currentGameId
    );

    sessionStorage.setItem(
        "peryaRole",
        currentRole
    );
}


function clearRoomSession() {
    sessionStorage.removeItem("peryaGameId");
    sessionStorage.removeItem("peryaRole");
}


function setBetStatusElement(
    element,
    playerExists,
    betRequested,
    betApproved
) {
    if (!element) {
        return;
    }

    if (!playerExists) {
        element.textContent = "Waiting for player...";
    }
    else if (betApproved) {
        element.textContent = "✅ Bet Accepted";
    }
    else if (betRequested) {
        element.textContent = "📨 Waiting for Middleman approval";
    }
    else {
        element.textContent = "⏳ Waiting for bet";
    }

    element.classList.toggle(
        "sent",
        playerExists && betApproved
    );

    element.classList.toggle(
        "pending",
        playerExists &&
        betRequested &&
        !betApproved
    );

    element.classList.toggle(
        "waiting",
        !playerExists || !betRequested
    );
}


/* ==================================
   SCREEN CONTROL
================================== */

function showHomeScreen() {
    homeScreen.hidden = false;
    gameScreen.hidden = true;
    historySection.hidden = true;
}


function showGameScreen() {
    homeScreen.hidden = true;
    gameScreen.hidden = false;
    historySection.hidden = false;

    gameIdElement.textContent = currentGameId;
    currentRoleElement.textContent =
        roleLabel(currentRole);
}


/* ==================================
   CREATE ROOM
================================== */

async function createRoom() {
    try {
        setHomeMessage("Creating room...");

        const name = cleanName();

        let newGameId = "";
        let roomReference = null;

        while (true) {
            newGameId = generateGameId();
            roomReference =
                getGameReference(newGameId);

            const existingRoom =
                await getDoc(roomReference);

            if (!existingRoom.exists()) {
                break;
            }
        }

        const newRoom = {
            hostId: currentUser.uid,

            players: {
                middleman: {
                    uid: currentUser.uid,
                    name
                },
                bettor1: null,
                bettor2: null
            },

            betRequested: {
                bettor1: false,
                bettor2: false
            },

            betSent: {
                bettor1: false,
                bettor2: false
            },

            selectedColors: {
                bettor1: null,
                bettor2: null
            },

            messages: [],

            queue: [],
            kickedUsers: [],
            roomLocked: false,
            guestRollingSuspended: false,
            guestSuspensionReason: "",
            guestSuspendedAt: null,
            guestSuspendedBy: "",
            status: "waiting",
            diceCount: 3,
            rolling: false,
            rollNumber: 0,
            latestResult: [],
            history: [],
            roomClosing: false,
            closingAt: null,
            nextRoundAt: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(
            roomReference,
            newRoom
        );

        currentGameId = newGameId;
        currentRole = "middleman";

        saveRoomSession();
        showGameScreen();
        listenToRoom();
    }
    catch (error) {
        console.error(
            "Could not create the room:",
            error
        );

        setHomeMessage(
            error.message ||
                "Could not create the room.",
            true
        );
    }
}


/* ==================================
   JOIN ROOM
================================== */

async function joinRoom() {
    try {
        setHomeMessage("Joining room...");

        const name = cleanName();
        const gameId = cleanGameId();
        const gameReference =
            getGameReference(gameId);

        let assignedRole = "queue";

        await runTransaction(
            db,
            async transaction => {
                const snapshot =
                    await transaction.get(
                        gameReference
                    );

                if (!snapshot.exists()) {
                    throw new Error(
                        "Dice ID was not found."
                    );
                }

                const game = snapshot.data();

                if (game.roomLocked) {
                    throw new Error(
                        "This room is locked."
                    );
                }

                if (
                    game.kickedUsers?.includes(
                        currentUser.uid
                    )
                ) {
                    throw new Error(
                        "The host removed you from this room."
                    );
                }

                const alreadyPlaying =
                    Object.values(
                        game.players || {}
                    ).some(
                        player =>
                            player?.uid ===
                            currentUser.uid
                    );

                const alreadyQueued =
                    (game.queue || []).some(
                        player =>
                            player.uid ===
                            currentUser.uid
                    );

                if (alreadyPlaying || alreadyQueued) {
                    assignedRole =
                        Object.entries(
                            game.players || {}
                        ).find(
                            ([, player]) =>
                                player?.uid ===
                                currentUser.uid
                        )?.[0] || "queue";

                    return;
                }

                const updates = {
                    updatedAt: serverTimestamp()
                };

                if (!game.players?.bettor1) {
                    assignedRole = "bettor1";
                    updates["players.bettor1"] = {
                        uid: currentUser.uid,
                        name
                    };
                    updates["betRequested.bettor1"] =
                        false;
                    updates["betSent.bettor1"] =
                        false;
                    updates["selectedColors.bettor1"] =
                        null;
                }
                else if (!game.players?.bettor2) {
                    assignedRole = "bettor2";
                    updates["players.bettor2"] = {
                        uid: currentUser.uid,
                        name
                    };
                    updates["betRequested.bettor2"] =
                        false;
                    updates["betSent.bettor2"] =
                        false;
                    updates["selectedColors.bettor2"] =
                        null;
                }
                else {
                    assignedRole = "queue";

                    updates.queue = [
                        ...(game.queue || []),
                        {
                            uid: currentUser.uid,
                            name,
                            joinedAt: Date.now()
                        }
                    ];
                }

                transaction.update(
                    gameReference,
                    updates
                );
            }
        );

        currentGameId = gameId;
        currentRole = assignedRole;

        saveRoomSession();
        showGameScreen();
        listenToRoom();
    }
    catch (error) {
        console.error(
            "Could not join the room:",
            error
        );

        setHomeMessage(
            error.message ||
                "Could not join the room.",
            true
        );
    }
}

/* ==================================
   LIVE ROOM LISTENER
================================== */

function listenToRoom() {
    if (stopRoomListener) {
        stopRoomListener();
        stopRoomListener = null;
    }

    const gameReference =
        getGameReference(currentGameId);

    stopRoomListener = onSnapshot(
        gameReference,

        snapshot => {
            if (!snapshot.exists()) {
                /*
                 * Never kick players instantly when the room disappears.
                 * A stale host tab or an older deployed script may delete
                 * the room before clients receive the roomClosing update.
                 * In that case, show the same 10-second closing screen.
                 */
                if (!leavingRoom && currentGameId) {
                    startFallbackRoomClosing();
                    return;
                }

                exitRoomLocally();
                return;
            }

            currentGameData = snapshot.data();

            if (currentGameData.roomClosing) {
                /*
                 * Keep everyone inside the room during the countdown.
                 * Do not run normal room/player checks while closing.
                 */
                handleRoomClosing();
                return;
            }

            hideRoomClosingOverlay();
            checkCurrentPlayer();
            updateRoomScreen();
        },

        error => {
            console.error(
                "Room listener error:",
                error
            );

            alert(
                "The room could not be loaded. Check your Firebase rules."
            );
        }
    );
}


/* ==================================
   UNROLLED WHITE DICE
================================== */

function showWhiteDice(amount = 3) {

    results.innerHTML = "";

    for (let index = 0; index < amount; index++) {

        const image = document.createElement("img");

        image.src = whiteDiceImage;
        image.alt = "White Dice";
        image.className = "dice unrolledDice";

        results.appendChild(image);

    }

}


function showCurrentResult(result = []) {

    if (!currentResult || !currentResultPanel) {
        return;
    }

    currentResult.innerHTML = "";

    if (!Array.isArray(result) || result.length === 0) {

        currentResultPanel.hidden = true;
        return;

    }

    result.forEach(diceIndex => {

        const image = document.createElement("img");

        image.src = diceImages[diceIndex];
        image.alt = "Current Result";
        image.className = "currentResultDice";

        currentResult.appendChild(image);

    });

    currentResultPanel.hidden = false;

}


/* ==================================
   ROOM CLOSING COUNTDOWN
================================== */

function disableRoomControls(disabled) {
    const controls = [
        rollButton,
        diceCount,
        betSentButton,
        markBettor1SentButton,
        markBettor2SentButton,
        kickBettor1,
        kickBettor2,
        chatInput,
        sendChatButton,
        leaveRoomButton
    ];

    controls.forEach(control => {
        if (control) {
            control.disabled = disabled;
        }
    });

    if (colorChoices) {
        colorChoices
            .querySelectorAll("button")
            .forEach(button => {
                button.disabled = disabled;
            });
    }
}


function hideRoomClosingOverlay() {
    if (!closingOverlayActive) {
        return;
    }

    closingOverlayActive = false;
    fallbackClosingAt = null;

    if (roomClosingOverlay) {
        roomClosingOverlay.hidden = true;
    }

    if (roomClosingTimer) {
        clearInterval(roomClosingTimer);
        roomClosingTimer = null;
    }

    if (roomDeleteTimer) {
        clearTimeout(roomDeleteTimer);
        roomDeleteTimer = null;
    }

    disableRoomControls(false);
}


function showRoomClosingCountdown(
    closingAt,
    message =
        "The Middleman has left. Everyone will be returned to the lobby."
) {
    const validClosingAt = Number(closingAt);

    if (!validClosingAt) {
        return;
    }

    closingOverlayActive = true;
    stopRollingAnimation();
    disableRoomControls(true);

    if (roomClosingOverlay) {
        roomClosingOverlay.hidden = false;
    }

    if (roomClosingMessage) {
        roomClosingMessage.textContent = message;
    }

    const updateCountdown = () => {
        const millisecondsLeft =
            Math.max(0, validClosingAt - Date.now());

        const secondsLeft =
            Math.ceil(millisecondsLeft / 1000);

        if (roomClosingCountdown) {
            roomClosingCountdown.textContent =
                String(secondsLeft);
        }

        if (millisecondsLeft > 0) {
            return;
        }

        if (roomClosingTimer) {
            clearInterval(roomClosingTimer);
            roomClosingTimer = null;
        }

        /*
         * Only the Middleman's client attempts deletion.
         * Bettors simply remain on the countdown overlay
         * and return to the lobby when it reaches zero.
         */
        if (
            currentRole === "middleman" &&
            currentGameData?.hostId === currentUser.uid &&
            currentGameId
        ) {
            deleteDoc(
                getGameReference(currentGameId)
            ).catch(error => {
                console.error(
                    "Could not delete closed room:",
                    error
                );
            });
        }

        setTimeout(() => {
            if (currentGameId) {
                exitRoomLocally(
                    "The room was closed by the Middleman."
                );
            }
        }, 250);
    };

    updateCountdown();

    if (roomClosingTimer) {
        clearInterval(roomClosingTimer);
    }

    roomClosingTimer =
        setInterval(updateCountdown, 200);
}


function handleRoomClosing() {
    const closingAt =
        Number(currentGameData?.closingAt || 0);

    if (!closingAt) {
        return;
    }

    fallbackClosingAt = null;

    showRoomClosingCountdown(
        closingAt,
        "The Middleman has left. Everyone will be returned to the lobby."
    );
}


function startFallbackRoomClosing() {
    /*
     * This fallback prevents an instant kick when the room
     * is deleted by an older or stale host script.
     */
    if (!fallbackClosingAt) {
        fallbackClosingAt =
            Date.now() + 10000;
    }

    showRoomClosingCountdown(
        fallbackClosingAt,
        "The room was closed. Everyone will be returned to the lobby."
    );
}


/* ==================================
   NEXT ROUND RESET
================================== */

function scheduleNextRoundReset() {
    if (roundResetTimer) {
        clearTimeout(roundResetTimer);
        roundResetTimer = null;
    }

    if (
        currentRole !== "middleman" ||
        currentGameData?.hostId !== currentUser.uid ||
        currentGameData?.status !== "result" ||
        !currentGameData?.nextRoundAt
    ) {
        return;
    }

    const delay = Math.max(
        0,
        Number(currentGameData.nextRoundAt) -
            Date.now()
    );

    roundResetTimer = setTimeout(
        async () => {
            try {
                await updateDoc(
                    getGameReference(currentGameId),
                    {
                        status: "waiting",
                        latestResult: [],
                        nextRoundAt: null,
                        updatedAt: serverTimestamp()
                    }
                );
            }
            catch (error) {
                console.error(
                    "Could not prepare next round:",
                    error
                );
            }
        },
        delay
    );
}


/* ==================================
   CHECK CURRENT PLAYER
================================== */

function checkCurrentPlayer() {
    if (
        !currentGameData ||
        !currentRole ||
        leavingRoom
    ) {
        return;
    }

    const wasKicked =
        currentGameData.kickedUsers?.includes(
            currentUser.uid
        );

    if (wasKicked) {
        alert(
            "The Middleman removed you from the room."
        );
        exitRoomLocally();
        return;
    }

    const playerEntries =
        Object.entries(
            currentGameData.players || {}
        );

    const assignedEntry =
        playerEntries.find(
            ([, player]) =>
                player?.uid === currentUser.uid
        );

    if (assignedEntry) {
        const [assignedRole] = assignedEntry;

        if (currentRole !== assignedRole) {
            currentRole = assignedRole;
            saveRoomSession();

            currentRoleElement.textContent =
                roleLabel(currentRole);

            alert(
                `You are now ${roleLabel(currentRole)}.`
            );
        }

        return;
    }

    const isQueued =
        (currentGameData.queue || []).some(
            player =>
                player.uid === currentUser.uid
        );

    if (isQueued) {
        if (currentRole !== "queue") {
            currentRole = "queue";
            saveRoomSession();
            currentRoleElement.textContent =
                roleLabel(currentRole);
        }

        return;
    }

    alert(
        "Your player position is no longer available."
    );

    exitRoomLocally();
}

/* ==================================
   PROMOTE QUEUED BETTOR
================================== */

async function promoteNextQueuedPlayer() {
    if (
        currentRole !== "middleman" ||
        currentGameData?.hostId !==
            currentUser.uid
    ) {
        return;
    }

    const players =
        currentGameData.players || {};

    if (
        players.bettor1 &&
        players.bettor2
    ) {
        return;
    }

    if (!(currentGameData.queue || []).length) {
        return;
    }

    try {
        await runTransaction(
            db,
            async transaction => {
                const gameReference =
                    getGameReference(
                        currentGameId
                    );

                const snapshot =
                    await transaction.get(
                        gameReference
                    );

                if (!snapshot.exists()) {
                    return;
                }

                const game = snapshot.data();
                const queue = [
                    ...(game.queue || [])
                ];

                if (!queue.length) {
                    return;
                }

                let openRole = "";

                if (!game.players?.bettor1) {
                    openRole = "bettor1";
                }
                else if (!game.players?.bettor2) {
                    openRole = "bettor2";
                }
                else {
                    return;
                }

                const nextPlayer = queue.shift();

                transaction.update(
                    gameReference,
                    {
                        [`players.${openRole}`]: {
                            uid: nextPlayer.uid,
                            name: nextPlayer.name
                        },
                        [`betRequested.${openRole}`]:
                            false,
                        [`betSent.${openRole}`]:
                            false,
                        [`selectedColors.${openRole}`]:
                            null,
                        queue,
                        updatedAt:
                            serverTimestamp()
                    }
                );
            }
        );
    }
    catch (error) {
        console.error(
            "Could not promote queued bettor:",
            error
        );
    }
}


/* ==================================
   COLOR PICKING
================================== */

function colorName(colorId) {
    return diceColors.find(
        color => color.id === colorId
    )?.name || "None";
}


function renderColorChoices() {
    if (!colorPickPanel || !colorChoices) {
        return;
    }

    const isBettor =
        currentRole === "bettor1" ||
        currentRole === "bettor2";

    colorPickPanel.hidden = !isBettor;

    if (!isBettor || !currentGameData) {
        return;
    }

    const ownColor =
        currentGameData.selectedColors?.[
            currentRole
        ] || null;

    const otherRole =
        currentRole === "bettor1"
            ? "bettor2"
            : "bettor1";

    const otherColor =
        currentGameData.selectedColors?.[
            otherRole
        ] || null;

    const ownBetRequested =
        currentGameData.betRequested?.[
            currentRole
        ] === true;

    const ownBetAccepted =
        currentGameData.betSent?.[
            currentRole
        ] === true;

    colorChoices.innerHTML = "";

    diceColors.forEach(color => {
        const button =
            document.createElement("button");

        button.type = "button";
        button.className = "colorChoiceButton";

        if (ownColor === color.id) {
            button.classList.add("selected");
        }

        const image =
            document.createElement("img");

        image.src = color.image;
        image.alt = color.name;

        const label =
            document.createElement("span");

        label.textContent = color.name;

        button.append(image, label);

        const takenByOther =
            otherColor === color.id;

        button.disabled =
            takenByOther ||
            ownBetRequested ||
            ownBetAccepted;

        if (takenByOther) {
            button.title =
                "This color is already chosen by the other bettor.";
            button.classList.add("taken");
        }

        button.addEventListener(
            "click",
            () => lockBettorColor(color.id)
        );

        colorChoices.appendChild(button);
    });

    if (selectedColorText) {
        selectedColorText.textContent =
            ownColor
                ? `Locked color: ${colorName(ownColor)}`
                : "Pick and lock one color before sending your bet.";
    }
}


async function lockBettorColor(colorId) {
    if (
        currentRole !== "bettor1" &&
        currentRole !== "bettor2"
    ) {
        return;
    }

    if (!diceColors.some(color => color.id === colorId)) {
        return;
    }

    try {
        await runTransaction(
            db,
            async transaction => {
                const gameReference =
                    getGameReference(currentGameId);

                const snapshot =
                    await transaction.get(gameReference);

                if (!snapshot.exists()) {
                    throw new Error("Room no longer exists.");
                }

                const game = snapshot.data();
                const player =
                    game.players?.[currentRole];

                if (
                    !player ||
                    player.uid !== currentUser.uid
                ) {
                    throw new Error(
                        "You no longer own this bettor spot."
                    );
                }

                if (
                    game.betRequested?.[currentRole] ||
                    game.betSent?.[currentRole]
                ) {
                    throw new Error(
                        "Your color is locked for this round."
                    );
                }

                const otherRole =
                    currentRole === "bettor1"
                        ? "bettor2"
                        : "bettor1";

                if (
                    game.selectedColors?.[otherRole] ===
                    colorId
                ) {
                    throw new Error(
                        "The other bettor already chose this color."
                    );
                }

                transaction.update(
                    gameReference,
                    {
                        [`selectedColors.${currentRole}`]:
                            colorId,
                        updatedAt:
                            serverTimestamp()
                    }
                );
            }
        );
    }
    catch (error) {
        console.error("Could not lock color:", error);
        alert(
            error.message ||
                "The color could not be selected."
        );
    }
}


/* ==================================
   ROOM CHAT
================================== */

function renderChat(messages = []) {
    if (!chatMessages) {
        return;
    }

    chatMessages.innerHTML = "";

    const recentMessages =
        messages.slice(-50);

    if (recentMessages.length === 0) {
        const empty =
            document.createElement("p");

        empty.className = "chatEmpty";
        empty.textContent =
            "No messages yet. Say hello!";
        chatMessages.appendChild(empty);
        return;
    }

    recentMessages.forEach(message => {
        const row =
            document.createElement("div");

        row.className = "chatMessage";

        if (message.uid === currentUser.uid) {
            row.classList.add("ownMessage");
        }

        const header =
            document.createElement("div");

        header.className = "chatMessageHeader";
        header.textContent =
            `${message.name || "Player"} • ${roleLabel(message.role)}`;

        const text =
            document.createElement("p");

        text.textContent =
            String(message.text || "").slice(0, 200);

        row.append(header, text);
        chatMessages.appendChild(row);
    });

    chatMessages.scrollTop =
        chatMessages.scrollHeight;
}


async function sendChatMessage() {
    if (
        !currentGameId ||
        !currentGameData ||
        !chatInput
    ) {
        return;
    }

    const text =
        chatInput.value.trim().slice(0, 200);

    if (!text) {
        return;
    }

    sendChatButton.disabled = true;

    try {
        await runTransaction(
            db,
            async transaction => {
                const gameReference =
                    getGameReference(currentGameId);

                const snapshot =
                    await transaction.get(gameReference);

                if (!snapshot.exists()) {
                    throw new Error("Room no longer exists.");
                }

                const game = snapshot.data();

                const player =
                    currentRole === "queue"
                        ? (game.queue || []).find(
                            item =>
                                item.uid === currentUser.uid
                        )
                        : game.players?.[currentRole];

                if (!player) {
                    throw new Error(
                        "You are not currently in this room."
                    );
                }

                const messages = [
                    ...(game.messages || []),
                    {
                        id:
                            `${Date.now()}-${currentUser.uid}`,
                        uid: currentUser.uid,
                        name: player.name,
                        role: currentRole,
                        text,
                        sentAt: Date.now()
                    }
                ].slice(-50);

                transaction.update(
                    gameReference,
                    {
                        messages,
                        updatedAt:
                            serverTimestamp()
                    }
                );
            }
        );

        chatInput.value = "";
    }
    catch (error) {
        console.error(
            "Could not send chat message:",
            error
        );

        alert(
            error.message ||
                "Your message could not be sent."
        );
    }
    finally {
        sendChatButton.disabled = false;
        chatInput.focus();
    }
}


/* ==================================
   UPDATE ROOM SCREEN
================================== */

function updateRoomScreen() {
    if (!currentGameData) {
        return;
    }

    const players =
        currentGameData.players || {};

    const bettor1Exists =
        Boolean(players.bettor1);

    const bettor2Exists =
        Boolean(players.bettor2);

    const bettor1Requested =
        bettor1Exists &&
        currentGameData.betRequested?.bettor1 === true;

    const bettor2Requested =
        bettor2Exists &&
        currentGameData.betRequested?.bettor2 === true;

    const bettor1Sent =
        bettor1Exists &&
        currentGameData.betSent?.bettor1 === true;

    const bettor2Sent =
        bettor2Exists &&
        currentGameData.betSent?.bettor2 === true;

    middlemanName.textContent =
        players.middleman?.name || "Waiting...";

    bettor1Name.textContent =
        players.bettor1
            ? `${players.bettor1.name}${
                currentGameData.selectedColors?.bettor1
                    ? ` — ${colorName(
                        currentGameData.selectedColors.bettor1
                    )}`
                    : ""
            }`
            : "Waiting...";

    bettor2Name.textContent =
        players.bettor2
            ? `${players.bettor2.name}${
                currentGameData.selectedColors?.bettor2
                    ? ` — ${colorName(
                        currentGameData.selectedColors.bettor2
                    )}`
                    : ""
            }`
            : "Waiting...";

    setBetStatusElement(
        bettor1BetStatus,
        bettor1Exists,
        bettor1Requested,
        bettor1Sent
    );

    setBetStatusElement(
        bettor2BetStatus,
        bettor2Exists,
        bettor2Requested,
        bettor2Sent
    );

    const isHost =
        currentRole === "middleman" &&
        currentGameData.hostId ===
            currentUser.uid;

    const isBettor =
        currentRole === "bettor1" ||
        currentRole === "bettor2";

    hostSettings.hidden = !isHost;
    rollButton.hidden = !isHost;

    kickBettor1.hidden =
        !isHost || !bettor1Exists;

    kickBettor2.hidden =
        !isHost || !bettor2Exists;

    if (middlemanBetControls) {
        middlemanBetControls.hidden = !isHost;
    }

    if (betSentButton) {
        betSentButton.hidden = !isBettor;

        if (isBettor) {
            const currentBettorRequested =
                currentGameData.betRequested?.[
                    currentRole
                ] === true;

            const currentBettorApproved =
                currentGameData.betSent?.[
                    currentRole
                ] === true;

            const selectedColor =
                currentGameData.selectedColors?.[
                    currentRole
                ] || null;

            betSentButton.disabled =
                !selectedColor ||
                currentBettorRequested ||
                currentBettorApproved;

            betSentButton.textContent =
                currentBettorApproved
                    ? "✓ Bet Accepted"
                    : currentBettorRequested
                        ? "⏳ Waiting for Approval"
                        : selectedColor
                            ? "✓ I Sent My Bet"
                            : "Pick a Color First";
        }
    }

    if (markBettor1SentButton) {
        markBettor1SentButton.disabled =
            !bettor1Exists ||
            !bettor1Requested ||
            bettor1Sent;

        markBettor1SentButton.textContent =
            bettor1Sent
                ? "✓ Bettor 1 Bet Accepted"
                : bettor1Requested
                    ? "✓ Accept Bettor 1 Bet"
                    : "Waiting for Bettor 1";
    }

    if (markBettor2SentButton) {
        markBettor2SentButton.disabled =
            !bettor2Exists ||
            !bettor2Requested ||
            bettor2Sent;

        markBettor2SentButton.textContent =
            bettor2Sent
                ? "✓ Bettor 2 Bet Accepted"
                : bettor2Requested
                    ? "✓ Accept Bettor 2 Bet"
                    : "Waiting for Bettor 2";
    }

    diceCount.value = String(
        currentGameData.diceCount || 3
    );

    const allPlayersReady = Boolean(
        players.middleman &&
        players.bettor1 &&
        players.bettor2
    );

    const queuedPlayers =
        currentGameData.queue || [];

    if (queuePanel && queueList) {
        queuePanel.hidden =
            queuedPlayers.length === 0;

        queueList.innerHTML = "";

        queuedPlayers.forEach(
            (player, index) => {
                const item =
                    document.createElement("li");

                item.textContent =
                    `${index + 1}. ${player.name}`;

                if (
                    player.uid ===
                    currentUser.uid
                ) {
                    item.textContent += " (You)";
                }

                queueList.appendChild(item);
            }
        );
    }

    if (
        isHost &&
        queuedPlayers.length > 0 &&
        (!bettor1Exists || !bettor2Exists)
    ) {
        promoteNextQueuedPlayer();
    }

    if (currentGameData.rolling) {
        roomStatus.textContent =
            "Dice are rolling...";

        startRollingAnimation(
            currentGameData.diceCount || 3
        );
    }
    else {
        stopRollingAnimation();

        if (
            currentGameData.status === "result" &&
            currentGameData.latestResult?.length
        ) {
            roomStatus.textContent =
                "Roll completed — preparing the next round...";

            showDice(
                currentGameData.latestResult
            );

            scheduleNextRoundReset();
        }
        else {
            showWhiteDice(
                currentGameData.diceCount || 3
            );

            if (allPlayersReady) {
                roomStatus.textContent =
                    "Unrolled — waiting for accepted bets";
            }
            else {
                roomStatus.textContent =
                    "Unrolled — waiting for all three players";
            }
        }
    }

    const guestRollingSuspended =
        currentGameData.guestRollingSuspended === true;

    if (guestRollingSuspended) {
        roomStatus.textContent =
            currentGameData.guestSuspensionReason ||
            "Rolling suspended by an administrator.";
    }

    rollButton.disabled =
        !allPlayersReady ||
        currentGameData.rolling ||
        guestRollingSuspended;

    if (isHost) {
        rollButton.textContent = guestRollingSuspended
            ? "Rolling Suspended"
            : "Roll Dice";

        rollButton.title = guestRollingSuspended
            ? (currentGameData.guestSuspensionReason ||
                "Rolling has been suspended by an administrator.")
            : "";
    }

    waitingText.hidden = isHost;

    if (!isHost) {
        if (currentRole === "queue") {
            const queuePosition =
                queuedPlayers.findIndex(
                    player =>
                        player.uid ===
                        currentUser.uid
                ) + 1;

            waitingText.textContent =
                queuePosition > 0
                    ? `You are number ${queuePosition} in the queue.`
                    : "Waiting for an open bettor spot...";
        }
        else {
            waitingText.textContent =
                currentGameData.rolling
                    ? "The Middleman is rolling..."
                    : "Waiting for the Middleman...";
        }
    }

    renderColorChoices();
    renderChat(currentGameData.messages || []);

    renderHistory(
        currentGameData.history || []
    );
}


/* ==================================
   BET CONFIRMATION
================================== */

async function confirmOwnBetSent() {
    if (
        currentRole !== "bettor1" &&
        currentRole !== "bettor2"
    ) {
        return;
    }

    if (!currentGameId) {
        return;
    }

    try {
        if (betSentButton) {
            betSentButton.disabled = true;
        }

        await runTransaction(
            db,
            async transaction => {
                const gameReference =
                    getGameReference(currentGameId);

                const snapshot =
                    await transaction.get(gameReference);

                if (!snapshot.exists()) {
                    throw new Error("Room no longer exists.");
                }

                const game = snapshot.data();
                const selectedColor =
                    game.selectedColors?.[currentRole];

                if (!selectedColor) {
                    throw new Error(
                        "Pick and lock a color first."
                    );
                }

                const otherRole =
                    currentRole === "bettor1"
                        ? "bettor2"
                        : "bettor1";

                if (
                    game.selectedColors?.[otherRole] ===
                    selectedColor
                ) {
                    throw new Error(
                        "That color is already used by the other bettor."
                    );
                }

                transaction.update(
                    gameReference,
                    {
                        [`betRequested.${currentRole}`]:
                            true,
                        updatedAt:
                            serverTimestamp()
                    }
                );
            }
        );
    }
    catch (error) {
        console.error(
            "Could not confirm bet:",
            error
        );

        if (betSentButton) {
            betSentButton.disabled = false;
        }

        alert(
            error.message ||
                "Your bet status could not be updated."
        );
    }
}


async function markBettorBetSent(role) {
    if (
        currentRole !== "middleman" ||
        currentGameData?.hostId !==
            currentUser.uid
    ) {
        return;
    }

    if (
        role !== "bettor1" &&
        role !== "bettor2"
    ) {
        return;
    }

    if (!currentGameData.players?.[role]) {
        return;
    }

    if (
        currentGameData.betRequested?.[role] !==
        true
    ) {
        alert(
            `${roleLabel(role)} has not sent a bet confirmation yet.`
        );
        return;
    }

    try {
        await updateDoc(
            getGameReference(currentGameId),
            {
                [`betSent.${role}`]: true,
                updatedAt: serverTimestamp()
            }
        );
    }
    catch (error) {
        console.error(
            `Could not mark ${role}:`,
            error
        );

        alert(
            `${roleLabel(role)} could not be marked.`
        );
    }
}


/* ==================================
   SHOW DICE
================================== */

function showDice(values, shaking = false) {
    results.innerHTML = "";

    values.forEach(value => {
        const image =
            document.createElement("img");

        image.src = diceImages[value];
        image.alt = "Dice result";

        image.className =
            shaking
                ? "dice shake"
                : "dice";

        results.appendChild(image);
    });
}


/* ==================================
   ROLLING ANIMATION
================================== */

function startRollingAnimation(amount) {
    if (animationTimer) {
        return;
    }

    rollSound.currentTime = 0;
    rollSound.play().catch(() => {});

    animationTimer = setInterval(
        () => {
            showDice(
                generateAnimationDice(amount),
                true
            );
        },
        100
    );
}


function stopRollingAnimation() {
    if (!animationTimer) {
        return;
    }

    clearInterval(animationTimer);
    animationTimer = null;
}


/* ==================================
   HOST ROLL
================================== */

async function rollDice() {
    if (
        currentRole !== "middleman" ||
        !currentGameData ||
        currentGameData.rolling === true
    ) {
        return;
    }

    if (currentGameData.guestRollingSuspended === true) {
        rollButton.disabled = true;
        rollButton.textContent = "Rolling Suspended";
        roomStatus.textContent =
            currentGameData.guestSuspensionReason ||
            "Rolling suspended by an administrator.";
        return;
    }

    const players = currentGameData.players;

    if (
        !players?.middleman ||
        !players?.bettor1 ||
        !players?.bettor2
    ) {
        alert("All three players must join before rolling.");
        return;
    }

    const bothBetsAccepted =
        currentGameData.betSent?.bettor1 === true &&
        currentGameData.betSent?.bettor2 === true;

    if (!bothBetsAccepted) {
        alert("The Middleman must accept both bets before rolling.");
        return;
    }

    const selectedDiceCount = Number(diceCount.value);
    rollButton.disabled = true;
    startRollingAnimation(selectedDiceCount);

    try {
        const response = await startSecureMiddlemanRoll({
            roomId: currentGameId,
            diceCount: selectedDiceCount
        });

        const finalResult = Array.isArray(response.data?.result)
            ? response.data.result.map(Number)
            : [];

        if (finalResult.length !== selectedDiceCount) {
            throw new Error("The server did not return a complete dice result.");
        }

        stopRollingAnimation();
        showDice(finalResult, false);
    }
    catch (error) {
        console.error("The dice could not be rolled:", error);
        stopRollingAnimation();

        try {
            const latestSnapshot = await getDoc(
                getGameReference(currentGameId)
            );

            if (
                latestSnapshot.exists() &&
                latestSnapshot.data().guestRollingSuspended === true
            ) {
                currentGameData = {
                    id: latestSnapshot.id,
                    ...latestSnapshot.data()
                };

                rollButton.disabled = true;
                rollButton.textContent = "Rolling Suspended";
                roomStatus.textContent =
                    currentGameData.guestSuspensionReason ||
                    "Rolling suspended by an administrator.";
                return;
            }
        }
        catch (refreshError) {
            console.error(
                "Could not refresh guest-room suspension state:",
                refreshError
            );
        }

        alert(
            error?.message ||
            "The dice could not be rolled."
        );
    }
}


/* ==================================
   HISTORY
================================== */

function renderHistory(savedHistory) {
    history.innerHTML = "";

    const lastFive =
        [...savedHistory]
            .slice(-5)
            .reverse();

    if (lastFive.length === 0) {
        history.textContent =
            "No rolls yet.";
        return;
    }

    lastFive.forEach(item => {
        const row =
            document.createElement("div");

        row.className = "historyRow";

        item.dice.forEach(value => {
            const image =
                document.createElement("img");

            image.src = diceImages[value];
            image.alt = "Previous dice";
            image.className = "historyDice";

            row.appendChild(image);
        });

        history.appendChild(row);
    });
}


/* ==================================
   KICK PLAYER
================================== */

async function kickPlayer(role) {
    if (
        currentRole !== "middleman" ||
        currentGameData?.hostId !==
            currentUser.uid
    ) {
        return;
    }

    const player =
        currentGameData.players?.[role];

    if (!player) {
        return;
    }

    const shouldKick = confirm(
        `Remove ${player.name} from the room?`
    );

    if (!shouldKick) {
        return;
    }

    try {
        await updateDoc(
            getGameReference(currentGameId),
            {
                [`players.${role}`]: null,
                [`betRequested.${role}`]: false,
                [`betSent.${role}`]: false,
                [`selectedColors.${role}`]: null,

                kickedUsers:
                    arrayUnion(player.uid),

                updatedAt:
                    serverTimestamp()
            }
        );
    }
    catch (error) {
        console.error(
            "Could not remove player:",
            error
        );

        alert(
            "The player could not be removed."
        );
    }
}


/* ==================================
   LEAVE ROOM / DELETE EMPTY ROOM
================================== */

async function leaveRoom() {
    if (!currentGameId || !currentRole) {
        exitRoomLocally();
        return;
    }

    const isHost =
        currentRole === "middleman" &&
        currentGameData?.hostId === currentUser.uid;

    const shouldLeave = confirm(
        isHost
            ? "Leaving will close the room for everyone after a 10-second countdown. Continue?"
            : "Are you sure you want to leave this room?"
    );

    if (!shouldLeave) {
        return;
    }

    leaveRoomButton.disabled = true;

    const leavingGameId = currentGameId;
    const leavingRole = currentRole;
    const gameReference =
        getGameReference(leavingGameId);

    if (isHost) {
        try {
            const closingAt =
                Date.now() + 5000;

            await updateDoc(
                gameReference,
                {
                    roomClosing: true,
                    closingAt,
                    status: "closing",
                    rolling: false,
                    updatedAt: serverTimestamp()
                }
            );

            currentGameData = {
                ...currentGameData,
                roomClosing: true,
                closingAt,
                status: "closing",
                rolling: false
            };

            handleRoomClosing();
            return;
        }
        catch (error) {
            leaveRoomButton.disabled = false;

            console.error(
                "Could not close room:",
                error
            );

            alert(
                "The room could not be closed."
            );
            return;
        }
    }

    leavingRoom = true;

    try {
        await runTransaction(
            db,
            async transaction => {
                const snapshot =
                    await transaction.get(
                        gameReference
                    );

                if (!snapshot.exists()) {
                    return;
                }

                const room = snapshot.data();

                if (room.roomClosing) {
                    return;
                }

                const players = {
                    middleman:
                        room.players?.middleman ??
                        null,
                    bettor1:
                        room.players?.bettor1 ??
                        null,
                    bettor2:
                        room.players?.bettor2 ??
                        null
                };

                const queue = [
                    ...(room.queue || [])
                ];

                if (leavingRole === "queue") {
                    const queueIndex =
                        queue.findIndex(
                            player =>
                                player.uid ===
                                auth.currentUser?.uid
                        );

                    if (queueIndex === -1) {
                        throw new Error(
                            "You are not in this room queue."
                        );
                    }

                    queue.splice(queueIndex, 1);

                    transaction.update(
                        gameReference,
                        {
                            queue,
                            updatedAt:
                                serverTimestamp()
                        }
                    );

                    return;
                }

                const leavingPlayer =
                    players[leavingRole];

                if (
                    !leavingPlayer ||
                    leavingPlayer.uid !==
                        auth.currentUser?.uid
                ) {
                    throw new Error(
                        "You do not own this room position."
                    );
                }

                const updates = {
                    [`players.${leavingRole}`]:
                        null,
                    [`betRequested.${leavingRole}`]:
                        false,
                    [`betSent.${leavingRole}`]:
                        false,
                    [`selectedColors.${leavingRole}`]:
                        null,
                    updatedAt:
                        serverTimestamp()
                };

                transaction.update(
                    gameReference,
                    updates
                );
            }
        );

        exitRoomLocally();
    }
    catch (error) {
        leavingRoom = false;
        leaveRoomButton.disabled = false;

        console.error(
            "Leave room error:",
            error
        );

        alert(
            error.message ||
                "The room could not be left."
        );
    }
}

function exitRoomLocally(message = "") {
    stopRollingAnimation();

    if (roomClosingTimer) {
        clearInterval(roomClosingTimer);
        roomClosingTimer = null;
    }

    if (roomDeleteTimer) {
        clearTimeout(roomDeleteTimer);
        roomDeleteTimer = null;
    }

    if (roundResetTimer) {
        clearTimeout(roundResetTimer);
        roundResetTimer = null;
    }

    closingOverlayActive = false;
    fallbackClosingAt = null;

    if (roomClosingOverlay) {
        roomClosingOverlay.hidden = true;
    }

    if (stopRoomListener) {
        stopRoomListener();
        stopRoomListener = null;
    }

    currentGameId = "";
    currentRole = "";
    currentGameData = null;
    leavingRoom = false;

    clearRoomSession();

    results.innerHTML = "";
    history.innerHTML = "";

    if (betSentButton) {
        betSentButton.hidden = true;
        betSentButton.disabled = false;
        betSentButton.textContent =
            "✓ I Sent My Bet";
    }

    if (middlemanBetControls) {
        middlemanBetControls.hidden = true;
    }

    leaveRoomButton.disabled = false;

    showHomeScreen();

    if (message) {
        setHomeMessage(message, true);
    }
}


/* ==================================
   COPY ID
================================== */

async function copyGameId() {
    try {
        await navigator.clipboard.writeText(
            currentGameId
        );

        copyGameIdButton.textContent = "✅";

        setTimeout(
            () => {
                copyGameIdButton.textContent =
                    "📋";
            },
            1200
        );
    }
    catch {
        alert(`Dice ID: ${currentGameId}`);
    }
}


/* ==================================
   RESTORE SESSION
================================== */

async function restoreSession() {
    const savedGameId =
        sessionStorage.getItem("peryaGameId");

    const savedRole =
        sessionStorage.getItem("peryaRole");

    if (!savedGameId || !savedRole) {
        showHomeScreen();
        return;
    }

    const snapshot = await getDoc(
        getGameReference(savedGameId)
    );

    if (!snapshot.exists()) {
        clearRoomSession();
        showHomeScreen();
        return;
    }

    const game = snapshot.data();

    const assignedRole =
        Object.entries(
            game.players || {}
        ).find(
            ([, player]) =>
                player?.uid === currentUser.uid
        )?.[0];

    const isQueued =
        (game.queue || []).some(
            player =>
                player.uid === currentUser.uid
        );

    if (!assignedRole && !isQueued) {
        clearRoomSession();
        showHomeScreen();
        return;
    }

    currentGameId = savedGameId;
    currentRole =
        assignedRole ||
        "queue";

    showGameScreen();
    listenToRoom();
}


/* ==================================
   EVENTS
================================== */

createRoomButton.addEventListener(
    "click",
    createRoom
);

joinBettorButton.addEventListener(
    "click",
    joinRoom
);

rollButton.addEventListener(
    "click",
    rollDice
);

kickBettor1.addEventListener(
    "click",
    () => kickPlayer("bettor1")
);

kickBettor2.addEventListener(
    "click",
    () => kickPlayer("bettor2")
);

copyGameIdButton.addEventListener(
    "click",
    copyGameId
);

leaveRoomButton.addEventListener(
    "click",
    leaveRoom
);

if (betSentButton) {
    betSentButton.addEventListener(
        "click",
        confirmOwnBetSent
    );
}

if (markBettor1SentButton) {
    markBettor1SentButton.addEventListener(
        "click",
        () =>
            markBettorBetSent("bettor1")
    );
}

if (markBettor2SentButton) {
    markBettor2SentButton.addEventListener(
        "click",
        () =>
            markBettorBetSent("bettor2")
    );
}

if (sendChatButton) {
    sendChatButton.addEventListener(
        "click",
        sendChatMessage
    );
}

if (chatInput) {
    chatInput.addEventListener(
        "keydown",
        event => {
            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {
                event.preventDefault();
                sendChatMessage();
            }
        }
    );
}

joinGameIdInput.addEventListener(
    "input",
    () => {
        joinGameIdInput.value =
            joinGameIdInput.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 10);
    }
);

diceCount.addEventListener(
    "change",
    async () => {
        if (
            currentRole !== "middleman" ||
            !currentGameId ||
            currentGameData?.roomClosing
        ) {
            return;
        }

        const selectedDiceCount =
            Number(diceCount.value);

        showWhiteDice(selectedDiceCount);

        try {
            await updateDoc(
                getGameReference(currentGameId),
                {
                    diceCount: selectedDiceCount,
                    status: "waiting",
                    latestResult: [],
                    nextRoundAt: null,
                    "betRequested.bettor1": false,
                    "betRequested.bettor2": false,
                    "betSent.bettor1": false,
                    "betSent.bettor2": false,
                    "selectedColors.bettor1": null,
                    "selectedColors.bettor2": null,
                    updatedAt: serverTimestamp()
                }
            );
        }
        catch (error) {
            console.error(
                "Could not change dice count:",
                error
            );
        }
    }
);


/* ==================================
   STARTUP
================================== */

async function startApp() {
    try {
        currentUser = await authReady;
        await restoreSession();
    }
    catch (error) {
        console.error(error);

        setHomeMessage(
            "Firebase login failed. Make sure Anonymous Authentication is enabled.",
            true
        );
    }
}

startApp();
