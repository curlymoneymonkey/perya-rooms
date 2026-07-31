import { db, waitForAuthState } from "./firebase.js";

import {
    doc,
    getDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const form = document.getElementById("editProfileForm");
const preview = document.getElementById("editProfilePreview");
const bioInput = document.getElementById("profileBioInput");
const bioCount = document.getElementById("bioCount");
const message = document.getElementById("editProfileMessage");
const saveButton = document.getElementById("saveProfileButton");
const cancelButton = document.getElementById("cancelEditProfile");

let currentUser = null;

function updateBioCount() {
    bioInput.value = bioInput.value.slice(0, 300);
    bioCount.textContent = `${bioInput.value.length} / 300`;
}

function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("errorMessage", isError);
}

bioInput.addEventListener("input", updateBioCount);

preview.addEventListener("error", () => {
    preview.src = "favicon.png";
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
        setMessage("You must be signed in to edit your profile.", true);
        return;
    }

    saveButton.disabled = true;
    setMessage("Saving profile...");

    try {
        // Only the bio is editable here. The profile picture is never changed.
        await updateDoc(doc(db, "publicProfiles", currentUser.uid), {
            bio: bioInput.value.trim(),
            updatedAt: serverTimestamp()
        });

        setMessage("Profile saved.");

        setTimeout(() => {
            location.replace(`profile.html?id=${encodeURIComponent(currentUser.uid)}`);
        }, 500);
    } catch (error) {
        console.error("Could not save profile:", error);
        setMessage("Could not save your profile. Please try again.", true);
        saveButton.disabled = false;
    }
});

(async function initializeEditProfile() {
    try {
        currentUser = await waitForAuthState();

        if (!currentUser || currentUser.isAnonymous) {
            location.replace("index.html");
            return;
        }

        const profileReference = doc(db, "publicProfiles", currentUser.uid);
        const profileSnapshot = await getDoc(profileReference);

        if (!profileSnapshot.exists()) {
            location.replace("username.html");
            return;
        }

        const profile = profileSnapshot.data();

        preview.src = currentUser.photoURL || "favicon.png";
        bioInput.value = profile.bio || "";
        updateBioCount();

        cancelButton.href = `profile.html?id=${encodeURIComponent(currentUser.uid)}`;
    } catch (error) {
        console.error("Could not load profile:", error);
        setMessage("Could not load your profile.", true);
        saveButton.disabled = true;
    }
})();
