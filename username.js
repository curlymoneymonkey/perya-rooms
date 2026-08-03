import { auth, db, logOut, waitForAuthState } from "./firebase.js";

import {
    doc,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const form = document.getElementById("usernameForm");
const input = document.getElementById("usernameInput");
const saveButton = document.getElementById("saveUsernameButton");
const cancelButton = document.getElementById("cancelUsernameButton");
const message = document.getElementById("usernameMessage");

function normalizeUsername(value) {
    return String(value || "").trim();
}

function usernameKey(value) {
    return normalizeUsername(value).toLowerCase();
}

function isValidUsername(value) {
    return /^[A-Za-z0-9_]{3,20}$/.test(value);
}

async function requireGoogleUser() {
    const user = await waitForAuthState();

    if (!user || user.isAnonymous) {
        window.location.replace("index.html");
        return null;
    }

    return user;
}

form.addEventListener("submit", async event => {
    event.preventDefault();

    const user = auth.currentUser;
    const username = normalizeUsername(input.value);
    const key = usernameKey(username);

    if (!user || user.isAnonymous) {
        window.location.replace("index.html");
        return;
    }

    if (!isValidUsername(username)) {
        message.textContent = "Use 3–20 letters, numbers, or underscores only.";
        message.classList.add("errorMessage");
        return;
    }

    saveButton.disabled = true;
    input.disabled = true;
    message.classList.remove("errorMessage");
    message.textContent = "Checking username...";

    try {
        await runTransaction(db, async transaction => {
            const userRef = doc(db, "users", user.uid);
            const usernameRef = doc(db, "usernames", key);

            const userSnapshot = await transaction.get(userRef);
            const usernameSnapshot = await transaction.get(usernameRef);

            if (userSnapshot.exists() && userSnapshot.data().username) {
                return;
            }

            if (usernameSnapshot.exists() && usernameSnapshot.data().uid !== user.uid) {
                throw new Error("USERNAME_TAKEN");
            }

            transaction.set(usernameRef, {
                uid: user.uid,
                username,
                claimedAt: serverTimestamp()
            });

            transaction.set(userRef, {
                username,
                usernameLower: key,
                email: user.email || "",
                photoURL: user.photoURL || "",
                roomId: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }, { merge: true });

            transaction.set(doc(db, "publicProfiles", user.uid), {
                uid: user.uid,
                username,
                usernameLower: key,
                photoURL: user.photoURL || "",
                bio: "",
                photoChangedAt: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }, { merge: true });
        });

        message.textContent = "Username saved.";
        window.location.replace("dashboard.html");
    } catch (error) {
        console.error("Username claim failed:", error);
        message.classList.add("errorMessage");
        message.textContent = error.message === "USERNAME_TAKEN"
            ? "That username is already taken."
            : "Could not save your username. Check Firestore rules.";
        saveButton.disabled = false;
        input.disabled = false;
        input.focus();
    }
});

input.addEventListener("input", () => {
    input.value = input.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
});

cancelButton.addEventListener("click", async () => {
    await logOut();
    window.location.replace("index.html");
});

const user = await requireGoogleUser();
if (user) input.focus();
