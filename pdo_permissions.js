import { auth, db, waitForAuthState } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const pageName = location.pathname.split("/").pop() || "pdo_hub.html";
const adminOnlyPages = new Set(["pdo_hub.html", "pdo_console.html", "pdo_dice_skins.html"]);

const user = await waitForAuthState();
if (!user || user.isAnonymous) {
  location.replace("index.html");
} else {
  try {
    const [adminSnapshot, moderatorSnapshot] = await Promise.all([
      getDoc(doc(db, "admins", user.uid)),
      getDoc(doc(db, "moderators", user.uid))
    ]);

    const isAdmin = adminSnapshot.exists() && adminSnapshot.data().enabled === true;
    const isHeadAdmin = isAdmin && adminSnapshot.data().role === "head-admin";
    const isModerator = moderatorSnapshot.exists() && moderatorSnapshot.data().enabled === true;
    const isAuthorized = adminOnlyPages.has(pageName) ? isAdmin : (isAdmin || isModerator);

    if (!isAuthorized) {
      location.replace("dashboard.html");
    } else {
      const roleLabel = isHeadAdmin ? "Head Administrator" : (isAdmin ? "Administrator" : "Moderator");
      document.querySelectorAll("[data-staff-role]").forEach((node) => {
        node.textContent = roleLabel;
      });
      if (!isAdmin) {
        document.querySelectorAll("[data-admin-only]").forEach((node) => node.remove());
      }
      document.documentElement.dataset.staffReady = "true";
    }
  } catch (error) {
    console.error("Unable to verify staff access:", error);
    location.replace("dashboard.html");
  }
}

document.querySelector("[data-open-menu]")?.addEventListener("click", () => {
  document.body.classList.add("pdo-menu-open");
});
document.querySelector("[data-close-menu]")?.addEventListener("click", () => {
  document.body.classList.remove("pdo-menu-open");
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") document.body.classList.remove("pdo-menu-open");
});
