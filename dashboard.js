import { auth, db, logOut, waitForAuthState } from "./firebase.js";

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
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const usernameText = document.getElementById("dashboardUsername");
const message = document.getElementById("dashboardMessage");
const noRoomPanel = document.getElementById("noRoomPanel");
const roomPanel = document.getElementById("roomPanel");
const createRoomPanel = document.getElementById("createRoomPanel");
const showCreateRoomButton = document.getElementById("showCreateRoomButton");
const cancelCreateRoomButton = document.getElementById("cancelCreateRoomButton");
const createRoomForm = document.getElementById("createRoomForm");
const createRoomButton = document.getElementById("createRoomButton");
const createRoomMessage = document.getElementById("createRoomMessage");
const diceIdInput = document.getElementById("diceIdInput");
const roomNameInput = document.getElementById("roomNameInput");
const descriptionInput = document.getElementById("descriptionInput");
const gameSelect = document.getElementById("gameSelect");
const robloxGameGroup = document.getElementById("robloxGameGroup");
const robloxGameSelect = document.getElementById("robloxGameSelect");
const platformSelect = document.getElementById("platformSelect");
const visibilitySelect = document.getElementById("visibilitySelect");
const ignInput = document.getElementById("ignInput");
const roomFormTitle = document.getElementById("roomFormTitle");
const roomNameText = document.getElementById("roomNameText");
const roomDiceIdText = document.getElementById("roomDiceIdText");
const roomLiveText = document.getElementById("roomLiveText");
const roomGameText = document.getElementById("roomGameText");
const roomPlatformText = document.getElementById("roomPlatformText");
const roomIgnText = document.getElementById("roomIgnText");
const editRoomButton = document.getElementById("editRoomButton");
const openRoomButton = document.getElementById("openRoomButton");
const myProfileButton = document.getElementById("myProfileButton");
const staffMenuRoot = document.getElementById("staffMenuRoot");
const staffMenuButton = document.getElementById("staffMenuButton");
const staffMenuDropdown = document.getElementById("staffMenuDropdown");

const searchDiceForm = document.getElementById("searchDiceForm");
const searchDiceInput = document.getElementById("searchDiceInput");
const searchDiceButton = document.getElementById("searchDiceButton");
const searchDiceMessage = document.getElementById("searchDiceMessage");
const searchProfileForm=document.getElementById("searchProfileForm");
const searchProfileInput=document.getElementById("searchProfileInput");
const searchProfileButton=document.getElementById("searchProfileButton");
const searchProfileMessage=document.getElementById("searchProfileMessage");

const roomSearchModal = document.getElementById("roomSearchModal");
const closeRoomSearchModal = document.getElementById("closeRoomSearchModal");
const cancelRoomSearchButton = document.getElementById("cancelRoomSearchButton");
const joinFoundRoomButton = document.getElementById("joinFoundRoomButton");
const foundRoomName = document.getElementById("foundRoomName");
const foundRoomHost = document.getElementById("foundRoomHost");
const foundRoomGame = document.getElementById("foundRoomGame");
const foundRoomPlatform = document.getElementById("foundRoomPlatform");
const foundRoomStatus = document.getElementById("foundRoomStatus");
const foundRoomDescription = document.getElementById("foundRoomDescription");
const liveRoomsList = document.getElementById("liveRoomsList");
const liveRoomsMessage = document.getElementById("liveRoomsMessage");
const liveRoomsCount = document.getElementById("liveRoomsCount");
const favoriteRoomsSection = document.getElementById("favoriteRoomsSection");
const favoriteRoomsList = document.getElementById("favoriteRoomsList");
const favoriteRoomsMessage = document.getElementById("favoriteRoomsMessage");
const favoriteRoomsCount = document.getElementById("favoriteRoomsCount");
const directorySearchInput = document.getElementById("directorySearchInput");
const directoryGameFilter = document.getElementById("directoryGameFilter");
const directoryRobloxGameGroup = document.getElementById("directoryRobloxGameGroup");
const directoryRobloxGameFilter = document.getElementById("directoryRobloxGameFilter");
const directoryPlatformFilter = document.getElementById("directoryPlatformFilter");
const directoryTabs = [...document.querySelectorAll("[data-directory-section]")];

let currentUser = null;
let currentProfile = null;
let currentRoom = null;
let foundDiceId = "";
let unsubscribeLiveRooms = null;
let unsubscribeFavoriteRooms = null;
let allPublicRooms = [];
let favoriteRoomIds = new Set();
let activeDirectorySection = "trending";
let editingRoom = false;


function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}

function debounce(callback, delay = 200) {
    let timer = null;
    return (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => callback(...args), delay);
    };
}

function timestampMillis(value) {
    if (value?.toMillis) return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    return 0;
}

function roomViewerCount(room) {
    return Number(room.viewerCount || room.activeViewers || room.viewers || 0);
}

function roomRating(room) {
    const directRating = Number(room.averageRating || room.rating || 0);
    if (Number.isFinite(directRating) && directRating > 0) return Math.min(5, directRating);

    const recommends = Number(room.recommendCount || 0);
    const reviews = Number(room.reviewCount || 0);
    if (reviews > 0) return Math.min(5, (recommends / reviews) * 5);
    return 0;
}

function roomTrendingScore(room) {
    const viewers = roomViewerCount(room);
    const recommends = Number(room.recommendCount || 0);
    const recentLiveBoost = room.isLive ? 1000 : 0;
    return recentLiveBoost + (viewers * 20) + (recommends * 5) + roomRating(room);
}

function updateDirectoryOptions() {
    const selectedGame = directoryGameFilter.value;
    const selectedPlatform = directoryPlatformFilter.value;

    const defaultGames = [
        "Roblox",
        "Minecraft",
        "Mobile Legends",
        "Call of Duty",
        "Fortnite",
        "Other"
    ];

    const defaultPlatforms = [
        "TikTok",
        "YouTube",
        "Facebook",
        "Twitch",
        "Kick",
        "Other"
    ];

    const roomGames = allPublicRooms.map(room => room.game || "Other");
    const roomPlatforms = allPublicRooms.map(room => room.platform || "Other");

    const games = [...new Set([...defaultGames, ...roomGames])];
    const platforms = [...new Set([...defaultPlatforms, ...roomPlatforms])];

    directoryGameFilter.innerHTML = '<option value="all">All Games</option>';
    games.forEach(game => {
        const option = document.createElement("option");
        option.value = game;
        option.textContent = game;
        directoryGameFilter.appendChild(option);
    });

    directoryPlatformFilter.innerHTML = '<option value="all">All Platforms</option>';
    platforms.forEach(platform => {
        const option = document.createElement("option");
        option.value = platform;
        option.textContent = platform;
        directoryPlatformFilter.appendChild(option);
    });

    if ([...directoryGameFilter.options].some(option => option.value === selectedGame)) {
        directoryGameFilter.value = selectedGame;
    }

    if ([...directoryPlatformFilter.options].some(option => option.value === selectedPlatform)) {
        directoryPlatformFilter.value = selectedPlatform;
    }
}

function selectedRobloxGame(room) {
    return room.gameTitle || room.robloxGame || "";
}

function updateRobloxDirectoryFilter() {
    const isRoblox = directoryGameFilter.value === "Roblox";
    directoryRobloxGameGroup.hidden = !isRoblox;

    if (!isRoblox) {
        directoryRobloxGameFilter.value = "all";
    }
}

function getFilteredDirectoryRooms() {
    const searchTerm = directorySearchInput.value.trim().toLowerCase();
    const selectedGame = directoryGameFilter.value;
    const selectedRobloxTitle = directoryRobloxGameFilter.value;
    const selectedPlatform = directoryPlatformFilter.value;

    let rooms = allPublicRooms.filter(room => {
        const searchText = [
            room.roomName,
            room.hostUsername,
            room.diceId,
            room.game,
            room.gameCategory,
            room.gameTitle,
            room.robloxGame,
            room.platform,
            room.description
        ].join(" ").toLowerCase();

        const matchesSearch = !searchTerm || searchText.includes(searchTerm);
        const matchesGame = selectedGame === "all" || (room.game || "Other") === selectedGame;
        const matchesRobloxGame = selectedGame !== "Roblox" ||
            selectedRobloxTitle === "all" ||
            selectedRobloxGame(room) === selectedRobloxTitle;
        const matchesPlatform = selectedPlatform === "all" || (room.platform || "Other") === selectedPlatform;
        return matchesSearch && matchesGame && matchesRobloxGame && matchesPlatform;
    });

    if (activeDirectorySection === "live") {
        rooms = rooms.sort((a, b) => {
            return roomViewerCount(b) - roomViewerCount(a) ||
                timestampMillis(b.liveStartedAt) - timestampMillis(a.liveStartedAt);
        });
    } else if (activeDirectorySection === "rated") {
        rooms.sort((a, b) => {
            return roomRating(b) - roomRating(a) ||
                Number(b.recommendCount || 0) - Number(a.recommendCount || 0);
        });
    } else if (activeDirectorySection === "new") {
        rooms.sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
    } else {
        rooms.sort((a, b) => roomTrendingScore(b) - roomTrendingScore(a));
    }

    return rooms;
}

function sectionEmptyMessage() {
    if (activeDirectorySection === "live") return "No public rooms are live right now.";
    if (activeDirectorySection === "rated") return "No rated public rooms match these filters yet.";
    if (activeDirectorySection === "new") return "No new public hosts match these filters yet.";
    return "No public creator rooms match these filters.";
}

function createDirectoryRoomCard(room, favorite = false) {
    const card = document.createElement("article");
    card.className = "liveRoomItem directoryRoomCard";

    const titleRow = document.createElement("div");
    titleRow.className = "liveRoomTitleRow";
    titleRow.appendChild(createTextElement("h3", "", room.roomName || "Permanent Room"));
    titleRow.appendChild(createTextElement("span", "liveBadge", "● LIVE"));
    card.appendChild(titleRow);

    const hostText = document.createElement("p");
    hostText.className = "liveRoomHost";
    const hostLink = document.createElement("a");
    hostLink.className = "profileUsernameLink";
    hostLink.textContent = `Hosted by @${room.hostUsername || "Host"}`;
    hostLink.href = room.ownerUid ? `profile.html?id=${encodeURIComponent(room.ownerUid)}` : "#";
    if (!room.ownerUid) hostLink.addEventListener("click", event => event.preventDefault());
    hostText.appendChild(hostLink);
    card.appendChild(hostText);
    card.appendChild(createTextElement("p", "liveRoomGame", formatGame(room)));

    const metadata = document.createElement("div");
    metadata.className = "liveRoomMeta";
    metadata.appendChild(createTextElement("span", "", `📺 ${room.platform || "Other"}`));
    metadata.appendChild(createTextElement("span", "", `👁 ${roomViewerCount(room)} Watching`));
    metadata.appendChild(createTextElement("span", "", `⭐ ${Number(room.favoriteCount || 0).toLocaleString()} Favorites`));
    card.appendChild(metadata);

    card.appendChild(createTextElement("p", "liveRoomDiceId", `Dice ID: ${room.diceId || ""}`));
    if (favorite) card.appendChild(createTextElement("p", "favoriteSavedBadge", "⭐ Saved Room"));
    if (room.description) card.appendChild(createTextElement("p", "liveRoomDescription", room.description));

    const joinButton = createTextElement("button", "liveRoomJoinButton", "🎲 Watch Room");
    joinButton.type = "button";
    joinButton.disabled = !room.diceId;
    joinButton.addEventListener("click", () => {
        window.location.href = `room.html?id=${encodeURIComponent(room.diceId)}`;
    });
    card.appendChild(joinButton);
    return card;
}

function renderLiveRooms() {
    const rooms = getFilteredDirectoryRooms();
    const favoriteRooms = rooms.filter(room => favoriteRoomIds.has(room.id));
    const otherRooms = rooms.filter(room => !favoriteRoomIds.has(room.id));

    favoriteRoomsList.innerHTML = "";
    liveRoomsList.innerHTML = "";
    liveRoomsCount.textContent = `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`;
    favoriteRoomsCount.textContent = `${favoriteRooms.length} ${favoriteRooms.length === 1 ? "room" : "rooms"}`;

    favoriteRoomsSection.hidden = favoriteRooms.length === 0;
    favoriteRoomsMessage.textContent = "";

    const favoriteFragment = document.createDocumentFragment();
    favoriteRooms.forEach(room => favoriteFragment.appendChild(createDirectoryRoomCard(room, true)));
    favoriteRoomsList.appendChild(favoriteFragment);

    if (rooms.length === 0) {
        liveRoomsMessage.textContent = sectionEmptyMessage();
        liveRoomsMessage.classList.remove("errorMessage");
        return;
    }

    liveRoomsMessage.textContent = otherRooms.length ? "" : "All matching live rooms are already shown in Favorite Rooms.";
    liveRoomsMessage.classList.remove("errorMessage");

    const roomsFragment = document.createDocumentFragment();
    otherRooms.forEach(room => roomsFragment.appendChild(createDirectoryRoomCard(room, false)));
    liveRoomsList.appendChild(roomsFragment);
}

function startFavoriteRoomsListener() {
    if (unsubscribeFavoriteRooms) unsubscribeFavoriteRooms();
    if (!currentUser || currentUser.isAnonymous) {
        favoriteRoomIds = new Set();
        renderLiveRooms();
        return;
    }

    unsubscribeFavoriteRooms = onSnapshot(
        collection(db, "users", currentUser.uid, "favoriteRooms"),
        snapshot => {
            favoriteRoomIds = new Set(snapshot.docs.map(item => item.id));
            renderLiveRooms();
        },
        error => {
            console.error("Favorite rooms listener failed:", error);
            favoriteRoomIds = new Set();
            renderLiveRooms();
        }
    );
}

function setDirectorySection(section) {
    activeDirectorySection = section;
    directoryTabs.forEach(tab => {
        const isActive = tab.dataset.directorySection === section;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-pressed", String(isActive));
    });
    renderLiveRooms();
}

function startLiveRoomsListener() {
    if (unsubscribeLiveRooms) unsubscribeLiveRooms();

    liveRoomsMessage.textContent = "Loading creator rooms...";
    liveRoomsCount.textContent = "0 rooms";

    unsubscribeLiveRooms = onSnapshot(
        collection(db, "permanentRooms"),
        snapshot => {
            allPublicRooms = snapshot.docs
                .map(documentSnapshot => ({
                    id: documentSnapshot.id,
                    ...documentSnapshot.data()
                }))
                .filter(room =>
                    String(room.visibility || "public").toLowerCase() === "public" &&
                    room.isLive === true
                );

            updateDirectoryOptions();
            updateRobloxDirectoryFilter();
            renderLiveRooms();
        },
        error => {
            console.error("Creator directory listener failed:", error);
            allPublicRooms = [];
            liveRoomsList.innerHTML = "";
            liveRoomsCount.textContent = "0 rooms";
            liveRoomsMessage.textContent = "Could not load the creator directory. Check your Firestore read rules.";
            liveRoomsMessage.classList.add("errorMessage");
        }
    );
}

function cleanDiceId(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10);
}

function formatGame(room) {
    if (room.game === "Roblox") {
        const title = room.gameTitle || room.robloxGame;
        return title ? `Roblox > ${title}` : "Roblox";
    }

    return room.game || "Other";
}

function setSearchMessage(text, isError = false) {
    searchDiceMessage.textContent = text;
    searchDiceMessage.classList.toggle("errorMessage", isError);
}

function showRoom(room) {
    currentRoom = room;
    noRoomPanel.hidden = true;
    createRoomPanel.hidden = true;
    roomPanel.hidden = false;

    roomNameText.textContent = room.roomName || "Permanent Room";
    roomDiceIdText.textContent = room.diceId || "";
    roomLiveText.textContent = room.isLive ? "🔴 LIVE" : "⚫ OFFLINE";
    roomLiveText.className = room.isLive ? "statusLive" : "statusOffline";
    roomGameText.textContent = formatGame(room);
    roomPlatformText.textContent = room.platform || "Other";
    roomIgnText.textContent = room.ign || "Not set";
}

function openSearchResult(room, diceId) {
    foundDiceId = diceId;

    foundRoomName.textContent = room.roomName || "Permanent Room";
    foundRoomHost.textContent = room.hostUsername || "Host";
    foundRoomGame.textContent = formatGame(room);
    foundRoomPlatform.textContent = room.platform || "Other";
    foundRoomStatus.textContent = room.isLive ? "🔴 LIVE" : "⚫ OFFLINE";
    foundRoomStatus.className = room.isLive ? "statusLive" : "statusOffline";
    foundRoomDescription.textContent = room.description || "No description provided.";

    roomSearchModal.hidden = false;
    document.body.classList.add("modalOpen");
    closeRoomSearchModal.focus();
}

function closeSearchResult() {
    roomSearchModal.hidden = true;
    document.body.classList.remove("modalOpen");
    foundDiceId = "";
    searchDiceInput.focus();
}

function closeStaffMenu() {
    if (!staffMenuButton || !staffMenuDropdown) return;
    staffMenuDropdown.hidden = true;
    staffMenuButton.setAttribute("aria-expanded", "false");
}

function setupStaffMenuInteractions() {
    if (!staffMenuButton || !staffMenuDropdown) return;

    staffMenuButton.addEventListener("click", event => {
        event.stopPropagation();
        const willOpen = staffMenuDropdown.hidden;
        staffMenuDropdown.hidden = !willOpen;
        staffMenuButton.setAttribute("aria-expanded", String(willOpen));
    });

    staffMenuDropdown.addEventListener("click", event => event.stopPropagation());
    document.addEventListener("click", closeStaffMenu);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeStaffMenu();
    });
}

async function loadStaffMenu() {
    if (!currentUser || currentUser.isAnonymous || !staffMenuRoot) return;

    try {
        const [adminSnapshot, moderatorSnapshot] = await Promise.all([
            getDoc(doc(db, "admins", currentUser.uid)),
            getDoc(doc(db, "moderators", currentUser.uid))
        ]);

        const isAdmin = adminSnapshot.exists() && adminSnapshot.data().enabled === true;
        const isModerator = moderatorSnapshot.exists() && moderatorSnapshot.data().enabled === true;

        if (!isAdmin && !isModerator) {
            staffMenuRoot.hidden = true;
            return;
        }

        staffMenuRoot.hidden = false;
        document.querySelectorAll("[data-staff-admin-only]").forEach(node => {
            node.hidden = !isAdmin;
        });

        // Moderators may open User & Room Control, but they only receive the
        // room-management tools because user-management elements are admin-only.
        document.querySelectorAll("[data-staff-control]").forEach(node => {
            node.hidden = false;
        });
    } catch (error) {
        console.error("Could not load staff menu:", error);
        staffMenuRoot.hidden = true;
    }
}

async function loadDashboard() {
    currentUser = await waitForAuthState();

    if (!currentUser || currentUser.isAnonymous) {
        window.location.replace("index.html");
        return;
    }

    const profileSnapshot = await getDoc(doc(db, "users", currentUser.uid));

    if (!profileSnapshot.exists() || !profileSnapshot.data().username) {
        window.location.replace("username.html");
        return;
    }

    currentProfile = profileSnapshot.data();

    // Keep a public-safe profile document separate from private account data.
    await setDoc(doc(db, "publicProfiles", currentUser.uid), {
        uid: currentUser.uid,
        username: currentProfile.username,
        usernameLower: currentProfile.usernameLower || String(currentProfile.username).toLowerCase(),
        photoURL: currentProfile.photoURL || currentUser.photoURL || "",
        bio: currentProfile.bio || "",
        createdAt: currentProfile.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
    }, { merge: true });

    usernameText.textContent = currentProfile.username;
    await loadStaffMenu();
    startFavoriteRoomsListener();
    startLiveRoomsListener();

    if (!currentProfile.roomId) {
        noRoomPanel.hidden = false;
        roomPanel.hidden = true;
        return;
    }

    const roomSnapshot = await getDoc(doc(db, "permanentRooms", currentProfile.roomId));

    if (!roomSnapshot.exists()) {
        message.textContent = "Your room reference is missing. Please check Firestore.";
        message.classList.add("errorMessage");
        noRoomPanel.hidden = false;
        return;
    }

    showRoom({ id: roomSnapshot.id, ...roomSnapshot.data() });
}

directoryTabs.forEach(tab => {
    tab.addEventListener("click", () => setDirectorySection(tab.dataset.directorySection));
});

directorySearchInput.addEventListener("input", debounce(renderLiveRooms, 180));
directoryGameFilter.addEventListener("change", () => {
    updateRobloxDirectoryFilter();
    renderLiveRooms();
});
directoryRobloxGameFilter.addEventListener("change", renderLiveRooms);
directoryPlatformFilter.addEventListener("change", renderLiveRooms);

showCreateRoomButton.addEventListener("click", () => {
    noRoomPanel.hidden = true;
    createRoomPanel.hidden = false;
    diceIdInput.focus();
});

editRoomButton?.addEventListener("click", () => {
    if (!currentRoom) return;
    editingRoom = true;
    roomFormTitle.textContent = "Edit Your Room";
    createRoomButton.textContent = "Save Changes";
    diceIdInput.value = currentRoom.diceId || "";
    diceIdInput.disabled = true;
    roomNameInput.value = currentRoom.roomName || "";
    descriptionInput.value = currentRoom.description || "";
    gameSelect.value = currentRoom.game || "Other";
    robloxGameSelect.value = currentRoom.robloxGame || "Steal a Brainrot";
    robloxGameGroup.hidden = gameSelect.value !== "Roblox";
    platformSelect.value = currentRoom.platform || "TikTok";
    visibilitySelect.value = currentRoom.visibility || "public";
    ignInput.value = currentRoom.ign || "";
    roomPanel.hidden = true;
    noRoomPanel.hidden = true;
    createRoomPanel.hidden = false;
    roomNameInput.focus();
});

cancelCreateRoomButton.addEventListener("click", () => {
    createRoomPanel.hidden = true;
    if (editingRoom && currentRoom) {
        editingRoom = false;
        diceIdInput.disabled = false;
        roomFormTitle.textContent = "Create Your Permanent Room";
        createRoomButton.textContent = "Create Room";
        roomPanel.hidden = false;
    } else {
        noRoomPanel.hidden = false;
    }
});

gameSelect.addEventListener("change", () => {
    robloxGameGroup.hidden = gameSelect.value !== "Roblox";
});

diceIdInput.addEventListener("input", () => {
    diceIdInput.value = cleanDiceId(diceIdInput.value);
});

searchDiceInput.addEventListener("input", () => {
    searchDiceInput.value = cleanDiceId(searchDiceInput.value);
    setSearchMessage("");
});

searchDiceForm.addEventListener("submit", async event => {
    event.preventDefault();

    const diceId = cleanDiceId(searchDiceInput.value);

    if (diceId.length < 6) {
        setSearchMessage("Enter a Dice ID with at least 6 characters.", true);
        searchDiceInput.focus();
        return;
    }

    searchDiceButton.disabled = true;
    searchDiceInput.disabled = true;
    setSearchMessage("Searching for room...");

    try {
        const diceIdSnapshot = await getDoc(doc(db, "permanentRoomIds", diceId));

        if (!diceIdSnapshot.exists()) {
            throw new Error("ROOM_NOT_FOUND");
        }

        const mapping = diceIdSnapshot.data();
        const roomId = mapping.roomId || mapping.ownerUid;

        if (!roomId) {
            throw new Error("ROOM_REFERENCE_MISSING");
        }

        const roomSnapshot = await getDoc(doc(db, "permanentRooms", roomId));

        if (!roomSnapshot.exists()) {
            throw new Error("ROOM_NOT_FOUND");
        }

        const room = { id: roomSnapshot.id, ...roomSnapshot.data() };

        setSearchMessage("Room found.");
        openSearchResult(room, room.diceId || diceId);
    } catch (error) {
        console.error("Dice ID search failed:", error);

        if (error.message === "ROOM_NOT_FOUND") {
            setSearchMessage("❌ Dice ID not found.", true);
        } else if (error.message === "ROOM_REFERENCE_MISSING") {
            setSearchMessage("This Dice ID has a missing room reference.", true);
        } else {
            setSearchMessage("Could not search right now. Check Firestore rules.", true);
        }
    } finally {
        searchDiceButton.disabled = false;
        searchDiceInput.disabled = false;
    }
});

closeRoomSearchModal.addEventListener("click", closeSearchResult);
cancelRoomSearchButton.addEventListener("click", closeSearchResult);

roomSearchModal.addEventListener("click", event => {
    if (event.target.hasAttribute("data-close-search-modal")) {
        closeSearchResult();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !roomSearchModal.hidden) {
        closeSearchResult();
    }
});

joinFoundRoomButton.addEventListener("click", () => {
    if (!foundDiceId) return;

    window.location.href = `room.html?id=${encodeURIComponent(foundDiceId)}`;
});

createRoomForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!currentUser || !currentProfile) return;

    const diceId = cleanDiceId(diceIdInput.value);
    const roomName = roomNameInput.value.trim();

    if (diceId.length < 6 || roomName.length < 2) {
        createRoomMessage.textContent = "Enter a Dice ID of at least 6 characters and a room name.";
        createRoomMessage.classList.add("errorMessage");
        return;
    }

    createRoomButton.disabled = true;
    createRoomMessage.classList.remove("errorMessage");
    createRoomMessage.textContent = editingRoom ? "Saving changes..." : "Creating room...";

    try {
        if (editingRoom) {
            await updateDoc(doc(db, "permanentRooms", currentUser.uid), {
                roomName,
                description: descriptionInput.value.trim(),
                hostUsername: currentProfile.username,
                game: gameSelect.value,
                gameCategory: gameSelect.value === "Roblox" ? "Roblox" : "",
                gameTitle: gameSelect.value === "Roblox" ? robloxGameSelect.value : gameSelect.value,
                robloxGame: gameSelect.value === "Roblox" ? robloxGameSelect.value : "",
                platform: platformSelect.value,
                ign: ignInput.value.trim(),
                visibility: visibilitySelect.value,
                updatedAt: serverTimestamp()
            });
            window.location.reload();
            return;
        }
        await runTransaction(db, async transaction => {
            const userRef = doc(db, "users", currentUser.uid);
            const roomRef = doc(db, "permanentRooms", currentUser.uid);
            const diceIdRef = doc(db, "permanentRoomIds", diceId);

            const userSnapshot = await transaction.get(userRef);
            const roomSnapshot = await transaction.get(roomRef);
            const diceIdSnapshot = await transaction.get(diceIdRef);

            if (!userSnapshot.exists() || !userSnapshot.data().username) {
                throw new Error("PROFILE_MISSING");
            }

            if (userSnapshot.data().roomId || roomSnapshot.exists()) {
                throw new Error("ROOM_EXISTS");
            }

            if (diceIdSnapshot.exists()) {
                throw new Error("DICE_ID_TAKEN");
            }

            const roomData = {
                ownerUid: currentUser.uid,
                diceId,
                roomName,
                description: descriptionInput.value.trim(),
                hostUsername: currentProfile.username,
                game: gameSelect.value,
                gameCategory: gameSelect.value === "Roblox" ? "Roblox" : "",
                gameTitle: gameSelect.value === "Roblox" ? robloxGameSelect.value : gameSelect.value,
                // Kept for compatibility with older room.html/dashboard code.
                robloxGame: gameSelect.value === "Roblox" ? robloxGameSelect.value : "",
                platform: platformSelect.value,
                visibility: visibilitySelect.value,
                streamLink: "",
                isLive: false,
                liveStartedAt: null,
                lastRollAt: null,
                diceCount: 3,
                rolling: false,
                latestResult: [],
                pendingResult: [],
                history: [],
                nextRolls: [],
                rollNumber: 0,
                reviewCount: 0,
                recommendCount: 0,
                favoriteCount: 0,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            transaction.set(roomRef, roomData);
            transaction.set(diceIdRef, {
                roomId: currentUser.uid,
                ownerUid: currentUser.uid,
                createdAt: serverTimestamp()
            });
            transaction.update(userRef, {
                roomId: currentUser.uid,
                updatedAt: serverTimestamp()
            });
        });

        window.location.reload();
    } catch (error) {
        console.error("Permanent room creation failed:", error);
        createRoomMessage.classList.add("errorMessage");
        createRoomMessage.textContent = error.message === "DICE_ID_TAKEN"
            ? "That Dice ID is already taken."
            : error.message === "ROOM_EXISTS"
                ? "Your account already owns a permanent room."
                : "Could not create the room. Check Firestore rules.";
        createRoomButton.disabled = false;
    }
});

openRoomButton.addEventListener("click", () => {
    if (currentRoom?.diceId) {
        window.location.href = `room.html?id=${encodeURIComponent(currentRoom.diceId)}`;
    }
});

myProfileButton?.addEventListener("click", () => {
    if (currentUser?.uid) window.location.href = `profile.html?id=${encodeURIComponent(currentUser.uid)}`;
});

document.getElementById("homeButton").addEventListener("click", () => {
    window.location.href = "index.html";
});

document.getElementById("signOutButton").addEventListener("click", async () => {
    await logOut();
    window.location.replace("index.html");
});

setupStaffMenuInteractions();

loadDashboard().catch(error => {
    console.error("Dashboard failed:", error);
    message.textContent = "Could not load the dashboard.";
    message.classList.add("errorMessage");
});


window.addEventListener("beforeunload", () => {
    if (unsubscribeLiveRooms) unsubscribeLiveRooms();
    if (unsubscribeFavoriteRooms) unsubscribeFavoriteRooms();
});


function cleanProfileUsername(v){
 return String(v||"").trim().replace(/^@+/,"").toLowerCase();
}

searchProfileForm?.addEventListener("submit",async(e)=>{
 e.preventDefault();
 const username=cleanProfileUsername(searchProfileInput.value);
 searchProfileMessage.textContent="Searching...";
 try{
   const map=await getDoc(doc(db,"usernames",username));
   let uid=map.exists()?map.data().uid:"";
   if(!uid){
      const snap=await getDocs(query(collection(db,"publicProfiles"),where("usernameLower","==",username),limit(1)));
      if(!snap.empty) uid=snap.docs[0].id;
   }
   if(!uid){
      searchProfileMessage.textContent="Profile not found.";
      return;
   }
   window.location.href=`profile.html?id=${encodeURIComponent(uid)}`;
 }catch(err){
   console.error(err);
   searchProfileMessage.textContent="Search failed.";
 }
});
