import { auth, db, logOut, waitForAuthState } from "./firebase.js";
import { isEnabledAdmin } from "./permissions.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

function closeMenu(menu, button) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
}

async function initializeAccountMenu() {
    const root = document.getElementById("accountMenuRoot");
    if (!root) return;

    const user = await waitForAuthState();
    if (!user || user.isAnonymous) {
        root.hidden = true;
        return;
    }

    const button = root.querySelector("[data-account-button]");
    const menu = root.querySelector("[data-account-dropdown]");
    const avatar = root.querySelector("[data-account-avatar]");
    const usernameText = root.querySelector("[data-account-username]");
    const profileLink = root.querySelector("[data-my-profile]");
    const adminLink = root.querySelector("[data-admin-link]");
    const signOutButton = root.querySelector("[data-account-signout]");

    let profile = {};
    try {
        const snapshot = await getDoc(doc(db, "publicProfiles", user.uid));
        if (snapshot.exists()) profile = snapshot.data();
    } catch (error) {
        console.warn("Could not load account menu profile:", error);
    }

    avatar.src = profile.photoURL || user.photoURL || "favicon.png";
    avatar.alt = `${profile.username || user.displayName || "User"} profile picture`;
    usernameText.textContent = `@${profile.username || user.displayName || "user"}`;
    profileLink.href = `profile.html?id=${encodeURIComponent(user.uid)}`;
    try {
        adminLink.hidden = !(await isEnabledAdmin(user));
    } catch (error) {
        adminLink.hidden = true;
    }

    root.hidden = false;

    button.addEventListener("click", event => {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
        button.setAttribute("aria-expanded", String(!menu.hidden));
    });

    menu.addEventListener("click", event => event.stopPropagation());
    document.addEventListener("click", () => closeMenu(menu, button));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeMenu(menu, button);
    });

    signOutButton.addEventListener("click", async () => {
        signOutButton.disabled = true;
        try {
            await logOut();
            location.replace("index.html");
        } catch (error) {
            console.error("Sign out failed:", error);
            signOutButton.disabled = false;
        }
    });
}

initializeAccountMenu();
