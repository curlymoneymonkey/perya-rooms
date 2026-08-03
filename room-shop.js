import { initializeShop } from "./shop.js";

let started = false;

window.addEventListener("perya-room-ready", event => {
    if (started) return;
    const ownerUid = String(event.detail?.ownerUid || "").trim();
    if (!ownerUid) return;
    started = true;
    initializeShop(ownerUid).catch(error => {
        console.error("Could not initialize room shop:", error);
        const message = document.getElementById("shopMessage");
        if (message) message.textContent = "Unable to open the shop.";
    });
}, { once: true });
