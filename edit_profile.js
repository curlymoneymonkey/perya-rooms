import { db, storage, waitForAuthState } from "./firebase.js";

import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    deleteObject,
    getDownloadURL,
    ref,
    uploadBytes
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

const PROFILE_OUTPUT_SIZE = 512;
const PROFILE_WEBP_QUALITY = 0.88;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const form = document.getElementById("editProfileForm");
const preview = document.getElementById("editProfilePreview");
const editorCanvas = document.getElementById("profileCropCanvas");
const fileInput = document.getElementById("profilePhotoInput");
const zoomInput = document.getElementById("profilePhotoZoom");
const chooseButton = document.getElementById("chooseProfilePhotoButton");
const removeButton = document.getElementById("removeProfilePhotoButton");
const resetCropButton = document.getElementById("resetProfileCropButton");
const cropControls = document.getElementById("profileCropControls");
const bioInput = document.getElementById("profileBioInput");
const bioCount = document.getElementById("bioCount");
const message = document.getElementById("editProfileMessage");
const saveButton = document.getElementById("saveProfileButton");
const cancelButton = document.getElementById("cancelEditProfile");

let currentUser = null;
let currentProfile = {};
let selectedImage = null;
let selectedObjectUrl = "";
let removeCustomPhoto = false;
let crop = { zoom: 1, offsetX: 0, offsetY: 0 };
let dragState = null;

function updateBioCount() {
    bioInput.value = bioInput.value.slice(0, 300);
    bioCount.textContent = `${bioInput.value.length} / 300`;
}

function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("errorMessage", isError);
}

function fallbackPhotoUrl() {
    return currentUser?.photoURL || "favicon.png";
}

function revokeSelectedObjectUrl() {
    if (!selectedObjectUrl) return;
    URL.revokeObjectURL(selectedObjectUrl);
    selectedObjectUrl = "";
}

function imageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not read the selected image."));
        image.src = url;
    });
}

function canvasCoordinates(event) {
    const rect = editorCanvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (editorCanvas.width / rect.width),
        y: (event.clientY - rect.top) * (editorCanvas.height / rect.height)
    };
}

function baseCoverScale(image) {
    return Math.max(
        editorCanvas.width / image.naturalWidth,
        editorCanvas.height / image.naturalHeight
    );
}

function clampCropOffsets() {
    if (!selectedImage) return;
    const scale = baseCoverScale(selectedImage) * crop.zoom;
    const width = selectedImage.naturalWidth * scale;
    const height = selectedImage.naturalHeight * scale;
    const maxX = Math.max(0, (width - editorCanvas.width) / 2);
    const maxY = Math.max(0, (height - editorCanvas.height) / 2);
    crop.offsetX = Math.max(-maxX, Math.min(maxX, crop.offsetX));
    crop.offsetY = Math.max(-maxY, Math.min(maxY, crop.offsetY));
}

function drawCropPreview() {
    const context = editorCanvas.getContext("2d", { alpha: true });
    context.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    context.fillStyle = "#151925";
    context.fillRect(0, 0, editorCanvas.width, editorCanvas.height);

    if (!selectedImage) return;

    clampCropOffsets();
    const scale = baseCoverScale(selectedImage) * crop.zoom;
    const width = selectedImage.naturalWidth * scale;
    const height = selectedImage.naturalHeight * scale;
    const x = (editorCanvas.width - width) / 2 + crop.offsetX;
    const y = (editorCanvas.height - height) / 2 + crop.offsetY;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(selectedImage, x, y, width, height);
}

function resetCrop() {
    crop = { zoom: 1, offsetX: 0, offsetY: 0 };
    zoomInput.value = "1";
    drawCropPreview();
}

async function selectPhoto(file) {
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        throw new Error("Choose a PNG, JPG, or WebP image.");
    }

    if (file.size > MAX_SOURCE_BYTES) {
        throw new Error("Profile picture must not exceed 8 MB.");
    }

    revokeSelectedObjectUrl();
    selectedObjectUrl = URL.createObjectURL(file);
    selectedImage = await imageFromUrl(selectedObjectUrl);

    if (selectedImage.naturalWidth < 128 || selectedImage.naturalHeight < 128) {
        throw new Error("Choose an image that is at least 128 × 128 pixels.");
    }

    removeCustomPhoto = false;
    cropControls.hidden = false;
    resetCrop();
    preview.src = selectedObjectUrl;
    removeButton.disabled = false;
    setMessage("Move the image to position it, then adjust the zoom if needed.");
}

function canvasToWebpBlob() {
    if (!selectedImage) return Promise.resolve(null);

    const output = document.createElement("canvas");
    output.width = PROFILE_OUTPUT_SIZE;
    output.height = PROFILE_OUTPUT_SIZE;
    const context = output.getContext("2d", { alpha: true });

    const previewScale = baseCoverScale(selectedImage) * crop.zoom;
    const previewWidth = selectedImage.naturalWidth * previewScale;
    const previewHeight = selectedImage.naturalHeight * previewScale;
    const previewX = (editorCanvas.width - previewWidth) / 2 + crop.offsetX;
    const previewY = (editorCanvas.height - previewHeight) / 2 + crop.offsetY;
    const multiplier = PROFILE_OUTPUT_SIZE / editorCanvas.width;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
        selectedImage,
        previewX * multiplier,
        previewY * multiplier,
        previewWidth * multiplier,
        previewHeight * multiplier
    );

    return new Promise((resolve, reject) => {
        output.toBlob(
            blob => blob ? resolve(blob) : reject(new Error("This browser could not create a WebP profile picture.")),
            "image/webp",
            PROFILE_WEBP_QUALITY
        );
    });
}

async function deleteStoredPhoto(path) {
    if (!path || !String(path).startsWith(`profile-pictures/${currentUser.uid}/`)) return;
    try {
        await deleteObject(ref(storage, path));
    } catch (error) {
        if (error?.code !== "storage/object-not-found") {
            console.warn("Could not delete the previous profile picture:", error);
        }
    }
}

async function uploadSelectedPhoto() {
    const blob = await canvasToWebpBlob();
    if (!blob) return null;

    const path = `profile-pictures/${currentUser.uid}/profile-${Date.now()}.webp`;
    const storageReference = ref(storage, path);

    await uploadBytes(storageReference, blob, {
        contentType: "image/webp",
        cacheControl: "public,max-age=31536000,immutable"
    });

    return {
        photoURL: await getDownloadURL(storageReference),
        photoPath: path
    };
}

bioInput.addEventListener("input", updateBioCount);
chooseButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
    try {
        await selectPhoto(fileInput.files?.[0]);
    } catch (error) {
        console.error(error);
        fileInput.value = "";
        setMessage(error.message || "Could not use that image.", true);
    }
});

zoomInput.addEventListener("input", () => {
    crop.zoom = Number(zoomInput.value) || 1;
    drawCropPreview();
});
resetCropButton.addEventListener("click", resetCrop);

editorCanvas.addEventListener("pointerdown", event => {
    if (!selectedImage) return;
    editorCanvas.setPointerCapture(event.pointerId);
    const point = canvasCoordinates(event);
    dragState = { pointerId: event.pointerId, x: point.x, y: point.y, offsetX: crop.offsetX, offsetY: crop.offsetY };
    editorCanvas.classList.add("dragging");
});

editorCanvas.addEventListener("pointermove", event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const point = canvasCoordinates(event);
    crop.offsetX = dragState.offsetX + point.x - dragState.x;
    crop.offsetY = dragState.offsetY + point.y - dragState.y;
    drawCropPreview();
});

function endDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    editorCanvas.classList.remove("dragging");
}
editorCanvas.addEventListener("pointerup", endDrag);
editorCanvas.addEventListener("pointercancel", endDrag);

removeButton.addEventListener("click", () => {
    selectedImage = null;
    revokeSelectedObjectUrl();
    fileInput.value = "";
    removeCustomPhoto = true;
    cropControls.hidden = true;
    preview.src = fallbackPhotoUrl();
    removeButton.disabled = true;
    setMessage("Your Google profile picture will be used after you save.");
});

preview.addEventListener("error", () => {
    if (!preview.src.endsWith("favicon.png")) preview.src = "favicon.png";
});

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!currentUser) {
        setMessage("You must be signed in to edit your profile.", true);
        return;
    }

    saveButton.disabled = true;
    chooseButton.disabled = true;
    removeButton.disabled = true;
    setMessage(selectedImage ? "Optimizing and uploading profile picture..." : "Saving profile...");

    let uploadedPhoto = null;

    try {
        if (selectedImage) uploadedPhoto = await uploadSelectedPhoto();

        const previousPath = String(currentProfile.photoPath || "");
        const nextPhotoURL = uploadedPhoto?.photoURL
            || (removeCustomPhoto ? fallbackPhotoUrl() : currentProfile.photoURL || fallbackPhotoUrl());
        const nextPhotoPath = uploadedPhoto?.photoPath || (removeCustomPhoto ? "" : previousPath);

        const updates = {
            bio: bioInput.value.trim(),
            photoURL: nextPhotoURL,
            photoPath: nextPhotoPath,
            hasCustomPhoto: Boolean(nextPhotoPath),
            updatedAt: serverTimestamp()
        };

        await Promise.all([
            setDoc(doc(db, "publicProfiles", currentUser.uid), updates, { merge: true }),
            setDoc(doc(db, "users", currentUser.uid), {
                photoURL: nextPhotoURL,
                photoPath: nextPhotoPath,
                updatedAt: serverTimestamp()
            }, { merge: true })
        ]);

        if ((uploadedPhoto || removeCustomPhoto) && previousPath && previousPath !== nextPhotoPath) {
            await deleteStoredPhoto(previousPath);
        }

        setMessage("Profile saved.");
        window.setTimeout(() => {
            location.replace(`profile.html?id=${encodeURIComponent(currentUser.uid)}`);
        }, 400);
    } catch (error) {
        console.error("Could not save profile:", error);
        if (uploadedPhoto?.photoPath) await deleteStoredPhoto(uploadedPhoto.photoPath);
        setMessage(error.message || "Could not save your profile. Please try again.", true);
        saveButton.disabled = false;
        chooseButton.disabled = false;
        removeButton.disabled = !currentProfile.photoPath && !selectedImage;
    }
});

window.addEventListener("beforeunload", revokeSelectedObjectUrl);

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

        currentProfile = profileSnapshot.data();
        preview.decoding = "async";
        preview.fetchPriority = "high";
        preview.src = currentProfile.photoURL || fallbackPhotoUrl();
        bioInput.value = currentProfile.bio || "";
        removeButton.disabled = !currentProfile.photoPath;
        updateBioCount();

        cancelButton.href = `profile.html?id=${encodeURIComponent(currentUser.uid)}`;
    } catch (error) {
        console.error("Could not load profile:", error);
        setMessage("Could not load your profile.", true);
        saveButton.disabled = true;
    }
})();
