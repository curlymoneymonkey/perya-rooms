import { authReady, db, storage } from "./firebase.js";

import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    deleteObject,
    getDownloadURL,
    ref,
    uploadBytes
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

/* =========================================================
   ELEMENTS
========================================================= */

const shopTitle = document.getElementById("shopTitle");
const shopMessage = document.getElementById("shopMessage");
const sellerControls = document.getElementById("sellerControls");
const productList = document.getElementById("productList");
const buyerCartControls = document.getElementById("buyerCartControls");
const openCartButton = document.getElementById("openCartButton");
const cartCountElement = document.getElementById("cartCount");

const addProductButton = document.getElementById("addProductButton");
const paymentInfoButton = document.getElementById("paymentInfoButton");
const sellingToggleButton = document.getElementById("sellingToggleButton");
const sellingStatusMessage = document.getElementById("sellingStatusMessage");

const productModal = document.getElementById("productModal");
const productModalTitle = document.getElementById("productModalTitle");
const productImageInput = document.getElementById("productImage");
const productImagePreview = document.getElementById("productImagePreview");
const productNameInput = document.getElementById("productName");
const productPriceInput = document.getElementById("productPrice");
const productStockInput = document.getElementById("productStock");
const productMinimumInput = document.getElementById("productMinimum");
const productDeliveryInput = document.getElementById("productDelivery");
const productDescriptionInput = document.getElementById("productDescription");
const cancelProductButton = document.getElementById("cancelProductButton");
const saveProductButton = document.getElementById("saveProductButton");

const paymentInfoModal = document.getElementById("paymentInfoModal");
const paymentInfoTitle = document.getElementById("paymentInfoTitle");
const enableGcashInput = document.getElementById("enableGcash");
const gcashNameInput = document.getElementById("gcashName");
const gcashNumberInput = document.getElementById("gcashNumber");
const gcashQrInput = document.getElementById("gcashQrInput");
const gcashQrPreview = document.getElementById("gcashQrPreview");
const enableMayaInput = document.getElementById("enableMaya");
const mayaNameInput = document.getElementById("mayaName");
const mayaNumberInput = document.getElementById("mayaNumber");
const mayaQrInput = document.getElementById("mayaQrInput");
const mayaQrPreview = document.getElementById("mayaQrPreview");
const enablePaypalInput = document.getElementById("enablePaypal");
const paypalEmailInput = document.getElementById("paypalEmail");
const paypalQrInput = document.getElementById("paypalQrInput");
const paypalQrPreview = document.getElementById("paypalQrPreview");
const allowGuestOrdersInput = document.getElementById("allowGuestOrders");
const cancelPaymentInfoButton = document.getElementById("cancelPaymentInfoButton");
const savePaymentInfoButton = document.getElementById("savePaymentInfoButton");
const paymentSetupStep1 = document.getElementById("paymentSetupStep1");
const paymentSetupStep2 = document.getElementById("paymentSetupStep2");
const continuePaymentSetupButton = document.getElementById("continuePaymentSetupButton");
const backPaymentSetupButton = document.getElementById("backPaymentSetupButton");
const paymentMethodSelectionError = document.getElementById("paymentMethodSelectionError");
const gcashSettingsSection = document.getElementById("gcashSettingsSection");
const mayaSettingsSection = document.getElementById("mayaSettingsSection");
const paypalSettingsSection = document.getElementById("paypalSettingsSection");

const cartModal = document.getElementById("cartModal");
const cartItemsElement = document.getElementById("cartItems");
const cartTotalElement = document.getElementById("cartTotal");
const closeCartButton = document.getElementById("closeCartButton");
const checkoutCartButton = document.getElementById("checkoutCartButton");

const paymentModal = document.getElementById("paymentModal");
const paymentCartItems = document.getElementById("paymentCartItems");
const buyerPaymentMethodTitle = document.getElementById("buyerPaymentMethodTitle");
const paymentMethodChoices = document.getElementById("paymentMethodChoices");
const buyerAccountName = document.getElementById("buyerAccountName");
const buyerPaymentDestination = document.getElementById("buyerPaymentDestination");
const copyPaymentDestinationButton = document.getElementById("copyPaymentDestinationButton");
const buyerQrImage = document.getElementById("buyerQrImage");
const paymentAmount = document.getElementById("paymentAmount");
const paymentDateInput = document.getElementById("paymentDate");
const paymentTimeInput = document.getElementById("paymentTime");
const paymentReferenceLabel = document.getElementById("paymentReferenceLabel");
const paymentReferenceInput = document.getElementById("paymentReference");
const paymentProofInput = document.getElementById("paymentProof");
const paymentProofPreview = document.getElementById("paymentProofPreview");
const buyerUsernameInput = document.getElementById("buyerUsername");
const buyerNotesInput = document.getElementById("buyerNotes");
const selectedPaymentDetails = document.getElementById("selectedPaymentDetails");
const paymentFillUpForm = document.getElementById("paymentFillUpForm");
const backToCartButton = document.getElementById("backToCartButton");
const submitOrderButton = document.getElementById("submitOrderButton")

/* =========================================================
   STATE
========================================================= */

let currentUser = null;
let shopOwnerUid = "";
let isOwner = false;

let editingProductId = null;
let editingProductImageUrl = "";
let editingProductImagePath = "";

const cart = new Map();
let sellerPaymentInformation = null;
let selectedPaymentMethod = "";
let shopIsSelling = true;
let sellingStatusLoaded = false;

const objectUrls = new Set();

/* =========================================================
   SHOP POPUP SYSTEM
========================================================= */

let activeShopPopupResolver = null;
let previousShopPopupFocus = null;

function ensureShopPopup() {
    let overlay = document.getElementById("shopPopupOverlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "shopPopupOverlay";
    overlay.className = "shopPopupOverlay";
    overlay.hidden = true;

    const dialog = document.createElement("section");
    dialog.className = "shopPopupDialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "shopPopupTitle");

    const icon = document.createElement("div");
    icon.id = "shopPopupIcon";
    icon.className = "shopPopupIcon";
    icon.setAttribute("aria-hidden", "true");

    const title = document.createElement("h2");
    title.id = "shopPopupTitle";
    title.className = "shopPopupTitle";

    const message = document.createElement("p");
    message.id = "shopPopupMessage";
    message.className = "shopPopupMessage";

    const actions = document.createElement("div");
    actions.className = "shopPopupActions";

    const cancelButton = document.createElement("button");
    cancelButton.id = "shopPopupCancelButton";
    cancelButton.type = "button";
    cancelButton.className = "shopPopupButton shopPopupCancelButton";
    cancelButton.textContent = "Cancel";

    const confirmButton = document.createElement("button");
    confirmButton.id = "shopPopupConfirmButton";
    confirmButton.type = "button";
    confirmButton.className = "shopPopupButton shopPopupConfirmButton";
    confirmButton.textContent = "OK";

    actions.append(cancelButton, confirmButton);
    dialog.append(icon, title, message, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    return overlay;
}

function closeShopPopup(result) {
    const overlay = document.getElementById("shopPopupOverlay");
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.classList.remove("shopPopupOpen");

    const resolver = activeShopPopupResolver;
    activeShopPopupResolver = null;

    if (previousShopPopupFocus && typeof previousShopPopupFocus.focus === "function") {
        previousShopPopupFocus.focus();
    }

    previousShopPopupFocus = null;
    resolver?.(result);
}

function openShopPopup({
    type = "info",
    title = "Notice",
    message = "",
    confirmText = "OK",
    cancelText = "Cancel",
    showCancel = false
} = {}) {
    const overlay = ensureShopPopup();
    const icon = overlay.querySelector("#shopPopupIcon");
    const titleElement = overlay.querySelector("#shopPopupTitle");
    const messageElement = overlay.querySelector("#shopPopupMessage");
    const cancelButton = overlay.querySelector("#shopPopupCancelButton");
    const confirmButton = overlay.querySelector("#shopPopupConfirmButton");

    if (activeShopPopupResolver) closeShopPopup(false);

    const icons = {
        success: "✓",
        error: "!",
        warning: "!",
        info: "i",
        confirm: "?"
    };

    previousShopPopupFocus = document.activeElement;
    overlay.dataset.type = type;
    icon.textContent = icons[type] || icons.info;
    titleElement.textContent = title;
    messageElement.textContent = String(message || "");
    cancelButton.hidden = !showCancel;
    cancelButton.textContent = cancelText;
    confirmButton.textContent = confirmText;
    overlay.hidden = false;
    document.body.classList.add("shopPopupOpen");

    return new Promise(resolve => {
        activeShopPopupResolver = resolve;
        confirmButton.onclick = () => closeShopPopup(true);
        cancelButton.onclick = () => closeShopPopup(false);

        overlay.onclick = event => {
            if (event.target === overlay && showCancel) closeShopPopup(false);
        };

        window.setTimeout(() => confirmButton.focus(), 0);
    });
}

function showShopAlert(message, options = {}) {
    const text = String(message || "");
    const type = options.type
        || (/saved|success|sent successfully|copied/i.test(text) ? "success"
            : /could not|unable|invalid|error|not found|not available|stopped|cannot/i.test(text) ? "error"
            : /please|enter|choose|select|upload|wait|minimum|stock|enable/i.test(text) ? "warning"
            : "info");

    const titles = {
        success: "Success",
        error: "Something Went Wrong",
        warning: "Please Check",
        info: "Notice"
    };

    return openShopPopup({
        type,
        title: options.title || titles[type],
        message: text,
        confirmText: options.confirmText || "OK",
        showCancel: false
    });
}

function showShopConfirm(message, options = {}) {
    return openShopPopup({
        type: "confirm",
        title: options.title || "Please Confirm",
        message,
        confirmText: options.confirmText || "Confirm",
        cancelText: options.cancelText || "Cancel",
        showCancel: true
    });
}

document.addEventListener("keydown", event => {
    const overlay = document.getElementById("shopPopupOverlay");
    if (!overlay || overlay.hidden) return;

    if (event.key === "Escape") {
        event.preventDefault();
        closeShopPopup(false);
    }
});


/* =========================================================
   HELPERS
========================================================= */

function formatPrice(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
        return "₱0";
    }

    return `₱${amount.toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    })}`;
}

function getMinimum(product) {
    const minimum = Number(product.minimumPurchase ?? 1);
    return Number.isInteger(minimum) && minimum > 0 ? minimum : 1;
}

function setPreview(imageElement, source) {
    if (!source) {
        imageElement.removeAttribute("src");
        imageElement.style.display = "none";
        return;
    }

    imageElement.decoding = "async";
    imageElement.src = source;
    imageElement.style.display = "block";
}

function previewFile(input, imageElement, maximumBytes) {
    const file = input.files?.[0];

    if (!file) {
        setPreview(imageElement, "");
        return true;
    }

    const allowed = ["image/png", "image/jpeg", "image/webp"];

    if (!allowed.includes(file.type)) {
        showShopAlert("Choose a PNG, JPG, or WebP image.");
        input.value = "";
        setPreview(imageElement, "");
        return false;
    }

    if (file.size > maximumBytes) {
        showShopAlert(`Image must not exceed ${Math.round(maximumBytes / 1024 / 1024)} MB.`);
        input.value = "";
        setPreview(imageElement, "");
        return false;
    }

    const url = URL.createObjectURL(file);
    objectUrls.add(url);
    setPreview(imageElement, url);
    return true;
}

function closeModal(modal) {
    modal.hidden = true;
}

function openModal(modal) {
    modal.hidden = false;
}

function productCollection(ownerUid = shopOwnerUid) {
    return collection(db, "users", ownerUid, "shopProducts");
}

function paymentInformationReference(ownerUid = shopOwnerUid) {
    return doc(db, "users", ownerUid, "shopSettings", "paymentInformation");
}

function sellingStatusReference(ownerUid = shopOwnerUid) {
    return doc(db, "users", ownerUid, "shopSettings", "sellingStatus");
}

async function loadSellingStatus() {
    const snapshot = await getDoc(sellingStatusReference());

    // Existing shops remain open unless the seller explicitly stops selling.
    shopIsSelling = !snapshot.exists() || snapshot.data().isSelling !== false;
    sellingStatusLoaded = true;
    renderSellingStatus();
    return shopIsSelling;
}

function renderSellingStatus() {
    if (sellingToggleButton) {
        sellingToggleButton.textContent = shopIsSelling
            ? "⏸ Stop Accepting Orders"
            : "▶ Start Accepting Orders";

        sellingToggleButton.classList.toggle("isSelling", shopIsSelling);
        sellingToggleButton.classList.toggle("isStopped", !shopIsSelling);
        sellingToggleButton.setAttribute("aria-pressed", String(!shopIsSelling));
    }

    if (sellingStatusMessage) {
        sellingStatusMessage.hidden = false;
        sellingStatusMessage.textContent = shopIsSelling
            ? "🟢 Shop is accepting orders."
            : "🔴 Shop is temporarily not accepting orders.";

        sellingStatusMessage.classList.toggle("shopOpen", shopIsSelling);
        sellingStatusMessage.classList.toggle("shopClosed", !shopIsSelling);
    }

    if (buyerCartControls && !isOwner) {
        buyerCartControls.hidden = !shopIsSelling;
    }
}

async function toggleSellingStatus() {
    if (!isOwner || !currentUser || currentUser.isAnonymous || !sellingToggleButton) {
        return;
    }

    const nextStatus = !shopIsSelling;
    const confirmation = nextStatus
        ? "Start accepting customer orders again?"
        : "Stop accepting new customer orders? Visitors can still view your products.";

    if (!await showShopConfirm(confirmation, {
        title: nextStatus ? "Start Accepting Orders" : "Stop Accepting Orders",
        confirmText: nextStatus ? "Start Orders" : "Stop Orders"
    })) {
        return;
    }

    sellingToggleButton.disabled = true;

    try {
        await setDoc(
            sellingStatusReference(currentUser.uid),
            {
                isSelling: nextStatus,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.uid
            },
            { merge: true }
        );

        shopIsSelling = nextStatus;

        if (!shopIsSelling) {
            cart.clear();
            renderCart();
            closeModal(cartModal);
            closeModal(paymentModal);
        }

        renderSellingStatus();
        await loadProducts();
    } catch (error) {
        console.error("Could not update selling status:", error);
        showShopAlert("Could not update the shop selling status.");
    } finally {
        sellingToggleButton.disabled = false;
    }
}

/* =========================================================
   PRODUCT FORM
========================================================= */

function clearProductForm() {
    editingProductId = null;
    editingProductImageUrl = "";
    editingProductImagePath = "";

    productImageInput.value = "";
    productNameInput.value = "";
    productPriceInput.value = "";
    productStockInput.value = "";
    productMinimumInput.value = "1";
    productDeliveryInput.value = "";
    productDescriptionInput.value = "";
    setPreview(productImagePreview, "");
}

function openAddProductForm() {
    clearProductForm();
    productModalTitle.textContent = "Add Product";
    saveProductButton.textContent = "Save Product";
    openModal(productModal);
}

function openEditProductForm(product) {
    editingProductId = product.id;
    editingProductImageUrl = product.imageUrl || "";
    editingProductImagePath = product.imagePath || "";

    productModalTitle.textContent = "Edit Product";
    saveProductButton.textContent = "Save Changes";

    productImageInput.value = "";
    productNameInput.value = product.name || "";
    productPriceInput.value = Number(product.price || 0);
    productStockInput.value = Number(product.stock || 0);
    productMinimumInput.value = getMinimum(product);
    productDeliveryInput.value = product.deliveryTime || "";
    productDescriptionInput.value = product.description || "";
    setPreview(productImagePreview, editingProductImageUrl);

    openModal(productModal);
}

function getProductFormData() {
    return {
        name: productNameInput.value.trim(),
        price: Number(productPriceInput.value),
        stock: Number(productStockInput.value),
        minimumPurchase: Number(productMinimumInput.value),
        deliveryTime: productDeliveryInput.value.trim(),
        description: productDescriptionInput.value.trim()
    };
}

function validateProduct(data) {

    // Require an image when creating a new product
    if (!editingProductId && productImageInput.files.length === 0) {
        showShopAlert("Please upload a product image.");
        productImageInput.focus();
        return false;
    }

    if (!data.name) {
        showShopAlert("Enter a product name.");
        return false;
    }

    if (!Number.isFinite(data.price) || data.price <= 0) {
        showShopAlert("Enter a valid price greater than 0.");
        return false;
    }

    if (!Number.isInteger(data.stock) || data.stock < 0) {
        showShopAlert("Stock must be a whole number of 0 or higher.");
        return false;
    }

    if (!Number.isInteger(data.minimumPurchase) || data.minimumPurchase < 1) {
        showShopAlert("Minimum purchase must be at least 1.");
        return false;
    }

    if (data.stock > 0 && data.minimumPurchase > data.stock) {
        showShopAlert("Minimum purchase cannot be higher than the available stock.");
        return false;
    }

    if (!data.deliveryTime) {
        showShopAlert("Enter the delivery time.");
        return false;
    }

    return true;
}

async function uploadProductImage(productId) {
    const file = productImageInput.files?.[0];

    if (!file) {
        return null;
    }

    const extension = file.name.split(".").pop()?.toLowerCase() || "image";
    const path = `shop-products/${currentUser.uid}/${productId}.${extension}`;
    const storageReference = ref(storage, path);

    await uploadBytes(storageReference, file, { contentType: file.type });

    return {
        imageUrl: await getDownloadURL(storageReference),
        imagePath: path
    };
}

async function deleteStoredFile(path) {
    if (!path) {
        return;
    }

    try {
        await deleteObject(ref(storage, path));
    } catch (error) {
        if (error?.code !== "storage/object-not-found") {
            throw error;
        }
    }
}

async function saveProduct() {
    if (!isOwner || !currentUser || currentUser.isAnonymous) {
        showShopAlert("Only the signed-in shop owner can manage products.");
        return;
    }

    const data = getProductFormData();

    if (!validateProduct(data)) {
        return;
    }

    saveProductButton.disabled = true;

    try {
        if (editingProductId) {
            const productRef = doc(db, "users", currentUser.uid, "shopProducts", editingProductId);
            const uploaded = await uploadProductImage(editingProductId);

            const updates = {
                ...data,
                updatedAt: serverTimestamp()
            };

            if (uploaded) {
                if (editingProductImagePath && editingProductImagePath !== uploaded.imagePath) {
                    await deleteStoredFile(editingProductImagePath);
                }

                updates.imageUrl = uploaded.imageUrl;
                updates.imagePath = uploaded.imagePath;
            }

            await updateDoc(productRef, updates);
        } else {
            const productRef = await addDoc(productCollection(currentUser.uid), {
                ownerUid: currentUser.uid,
                ...data,
                maximumPurchase: null,
                imageUrl: "",
                imagePath: "",
                hidden: false,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            const uploaded = await uploadProductImage(productRef.id);

            if (uploaded) {
                await updateDoc(productRef, {
                    ...uploaded,
                    updatedAt: serverTimestamp()
                });
            }
        }

        closeModal(productModal);
        clearProductForm();
        await loadProducts();
    } catch (error) {
        console.error(error);
        showShopAlert("Could not save the product. Check the browser console.");
    } finally {
        saveProductButton.disabled = false;
        saveProductButton.textContent = editingProductId ? "Save Changes" : "Save Product";
    }
}

async function deleteProduct(product, button) {
    if (!isOwner) {
        return;
    }

    if (!await showShopConfirm(`Delete "${product.name}"? This cannot be undone.`, {
        title: "Delete Product",
        confirmText: "Delete"
    })) {
        return;
    }

    button.disabled = true;

    try {
        await deleteStoredFile(product.imagePath || "");
        await deleteDoc(doc(db, "users", currentUser.uid, "shopProducts", product.id));
        await loadProducts();
    } catch (error) {
        console.error(error);
        showShopAlert("Could not delete the product.");
        button.disabled = false;
    }
}

/* =========================================================
   PAYMENT INFORMATION
========================================================= */

async function loadPaymentInformation() {
    const snapshot = await getDoc(paymentInformationReference());
    sellerPaymentInformation = snapshot.exists() ? snapshot.data() : null;
    return sellerPaymentInformation;
}

function normalizePaymentMethods(data = {}) {
    const legacyGcash = Boolean(data.gcashName && data.gcashNumber && data.qrImageUrl);
    return {
        gcash: {
            enabled: data.gcash?.enabled === true || legacyGcash,
            name: data.gcash?.name || data.gcashName || "",
            destination: data.gcash?.number || data.gcashNumber || "",
            qrImageUrl: data.gcash?.qrImageUrl || data.qrImageUrl || "",
            qrImagePath: data.gcash?.qrImagePath || data.qrImagePath || ""
        },
        maya: {
            enabled: data.maya?.enabled === true,
            name: data.maya?.name || "",
            destination: data.maya?.number || "",
            qrImageUrl: data.maya?.qrImageUrl || "",
            qrImagePath: data.maya?.qrImagePath || ""
        },
        paypal: {
            enabled: data.paypal?.enabled === true,
            name: "",
            destination: data.paypal?.email || "",
            qrImageUrl: data.paypal?.qrImageUrl || "",
            qrImagePath: data.paypal?.qrImagePath || ""
        }
    };
}

async function openPaymentInformationEditor() {
    if (!isOwner) return;
    try {
        const data = await loadPaymentInformation();
        const methods = normalizePaymentMethods(data || {});
        enableGcashInput.checked = methods.gcash.enabled;
        gcashNameInput.value = methods.gcash.name;
        gcashNumberInput.value = methods.gcash.destination;
        gcashQrInput.value = "";
        setPreview(gcashQrPreview, methods.gcash.qrImageUrl);
        enableMayaInput.checked = methods.maya.enabled;
        mayaNameInput.value = methods.maya.name;
        mayaNumberInput.value = methods.maya.destination;
        mayaQrInput.value = "";
        setPreview(mayaQrPreview, methods.maya.qrImageUrl);
        enablePaypalInput.checked = methods.paypal.enabled;
        paypalEmailInput.value = methods.paypal.destination;
        paypalQrInput.value = "";
        setPreview(paypalQrPreview, methods.paypal.qrImageUrl);
        allowGuestOrdersInput.checked = data?.allowGuestOrders === true;
        showPaymentSetupStep(1);
        updatePaymentMethodSelectionState();
        openModal(paymentInfoModal);
    } catch (error) {
        console.error(error);
        showShopAlert("Could not load payment information.");
    }
}

function selectedPaymentMethodCount() {
    return [enableGcashInput, enableMayaInput, enablePaypalInput]
        .filter(input => input.checked).length;
}

function updatePaymentMethodSelectionState() {
    const hasSelection = selectedPaymentMethodCount() > 0;
    continuePaymentSetupButton.disabled = !hasSelection;
    paymentMethodSelectionError.hidden = hasSelection;

    gcashSettingsSection.hidden = !enableGcashInput.checked;
    mayaSettingsSection.hidden = !enableMayaInput.checked;
    paypalSettingsSection.hidden = !enablePaypalInput.checked;
}

function showPaymentSetupStep(step) {
    const firstStep = step === 1;
    paymentSetupStep1.hidden = !firstStep;
    paymentSetupStep2.hidden = firstStep;
    paymentInfoTitle.textContent = firstStep
        ? "EDIT PAYMENT INFORMATION"
        : "PAYMENT DETAILS";
}

function continuePaymentSetup() {
    updatePaymentMethodSelectionState();
    if (!selectedPaymentMethodCount()) return;
    showPaymentSetupStep(2);
}

function togglePaymentAccordion(button) {
    const body = button.nextElementSibling;
    const expanded = button.getAttribute("aria-expanded") !== "false";
    button.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
    const arrow = button.querySelector(".paymentAccordionArrow");
    if (arrow) arrow.textContent = expanded ? "▶" : "▼";
}

async function uploadPaymentQr(input, method) {
    const file = input.files?.[0];
    if (!file) return null;
    const extension = file.name.split(".").pop()?.toLowerCase() || "image";
    const path = `payment-qr/${currentUser.uid}/${method}.${extension}`;
    const storageReference = ref(storage, path);
    await uploadBytes(storageReference, file, { contentType: file.type });
    return { qrImageUrl: await getDownloadURL(storageReference), qrImagePath: path };
}

function validateEnabledPaymentMethod(label, enabled, name, destination, qrUrl, needsName = true) {
    if (!enabled) return true;

    if (needsName && !name) {
        showShopAlert(`Enter the ${label} account name.`);
        return false;
    }

    // Number is optional for GCash and Maya.
    if (label === "PayPal" && !destination) {
        showShopAlert("Enter the PayPal email.");
        return false;
    }

    if (!qrUrl) {
        showShopAlert(`Upload the ${label} QR code.`);
        return false;
    }

    return true;
}

async function savePaymentInformation() {
    if (!isOwner || !currentUser || currentUser.isAnonymous) {
        showShopAlert("Only the signed-in shop owner can edit payment information.");
        return;
    }
    if (!enableGcashInput.checked && !enableMayaInput.checked && !enablePaypalInput.checked) {
        showShopAlert("Enable at least one payment method.");
        return;
    }

    const gcashNumber = gcashNumberInput.value.replace(/\D/g, "");
    gcashNumberInput.value = gcashNumber;

    // Number is optional. Only validate if provided.
    if (enableGcashInput.checked && gcashNumber && !/^09\d{9}$/.test(gcashNumber)) {
        showShopAlert("Please enter a valid GCash mobile number (11 digits starting with 09).");
        gcashNumberInput.focus();
        return;
    }

    savePaymentInfoButton.disabled = true;
    try {
        const existing = await loadPaymentInformation();
        const old = normalizePaymentMethods(existing || {});
        const [gcashUpload, mayaUpload, paypalUpload] = await Promise.all([
            uploadPaymentQr(gcashQrInput, "gcash"),
            uploadPaymentQr(mayaQrInput, "maya"),
            uploadPaymentQr(paypalQrInput, "paypal")
        ]);
        const methods = {
            gcash: { enabled: enableGcashInput.checked, name: gcashNameInput.value.trim(), number: gcashNumber, qrImageUrl: gcashUpload?.qrImageUrl || old.gcash.qrImageUrl, qrImagePath: gcashUpload?.qrImagePath || old.gcash.qrImagePath },
            maya: { enabled: enableMayaInput.checked, name: mayaNameInput.value.trim(), number: mayaNumberInput.value.trim(), qrImageUrl: mayaUpload?.qrImageUrl || old.maya.qrImageUrl, qrImagePath: mayaUpload?.qrImagePath || old.maya.qrImagePath },
            paypal: { enabled: enablePaypalInput.checked, email: paypalEmailInput.value.trim(), qrImageUrl: paypalUpload?.qrImageUrl || old.paypal.qrImageUrl, qrImagePath: paypalUpload?.qrImagePath || old.paypal.qrImagePath }
        };
        if (!validateEnabledPaymentMethod("GCash", methods.gcash.enabled, methods.gcash.name, methods.gcash.number, methods.gcash.qrImageUrl)) return;
        if (!validateEnabledPaymentMethod("Maya", methods.maya.enabled, methods.maya.name, methods.maya.number, methods.maya.qrImageUrl)) return;
        if (!validateEnabledPaymentMethod("PayPal", methods.paypal.enabled, "", methods.paypal.email, methods.paypal.qrImageUrl, false)) return;
        const data = { methods: Object.keys(methods).filter(key => methods[key].enabled), gcash: methods.gcash, maya: methods.maya, paypal: methods.paypal, allowGuestOrders: allowGuestOrdersInput.checked, updatedAt: serverTimestamp() };
        await setDoc(paymentInformationReference(currentUser.uid), data, { merge: true });
        sellerPaymentInformation = data;
        closeModal(paymentInfoModal);
        showShopAlert("Payment information saved.");
    } catch (error) {
        console.error(error);
        showShopAlert("Could not save payment information.");
    } finally {
        savePaymentInfoButton.disabled = false;
    }
}

/* =========================================================
   PRODUCT CARDS
========================================================= */

function createProductCard(product) {
    const card = document.createElement("article");
    card.className = "productCard";

    const imageContainer = document.createElement("div");
    imageContainer.className = "productImageContainer";

    if (product.imageUrl) {
        const image = document.createElement("img");
        image.className = "productImage";
        image.src = product.imageUrl;
        image.alt = product.name || "Product image";
        image.loading = "lazy";
        image.decoding = "async";
        image.fetchPriority = "low";
        imageContainer.appendChild(image);
    }

    const name = document.createElement("h3");
    name.textContent = product.name || "Unnamed Product";

    const price = document.createElement("p");
    price.className = "productPrice";
    price.textContent = formatPrice(product.price);

    const stock = document.createElement("p");
    stock.textContent = `Stock: ${Number(product.stock || 0)}`;

    const minimum = document.createElement("p");
    minimum.textContent = `Minimum Qty: ${getMinimum(product)}`;

    const delivery = document.createElement("p");
    delivery.textContent = `Delivery: ${product.deliveryTime || "Not specified"}`;

    const description = document.createElement("p");
    description.className = "productDescription";
    description.textContent = product.description || "";

    const actions = document.createElement("div");
    actions.className = "productActions";

    if (isOwner) {
        const editButton = document.createElement("button");
        editButton.className = "editProductButton";
        editButton.textContent = "✏️ Edit";
        editButton.addEventListener("click", () => openEditProductForm(product));

        const deleteButton = document.createElement("button");
        deleteButton.className = "deleteProductButton";
        deleteButton.textContent = "🗑️ Delete";
        deleteButton.addEventListener("click", () => deleteProduct(product, deleteButton));

        actions.append(editButton, deleteButton);
    } else {
        const cartButton = document.createElement("button");

        if (!shopIsSelling) {
            cartButton.className = "soldOutButton";
            cartButton.textContent = "Selling Paused";
            cartButton.disabled = true;
        } else if (Number(product.stock || 0) <= 0) {
            cartButton.className = "soldOutButton";
            cartButton.textContent = "Sold Out";
            cartButton.disabled = true;
        } else {
            cartButton.className = "buyNowButton";
            cartButton.textContent = cart.has(product.id) ? "✓ In Cart" : "🛒 Add to Cart";
            cartButton.addEventListener("click", () => addToCart(product));
        }

        actions.appendChild(cartButton);
    }

    card.append(
        imageContainer,
        name,
        price,
        stock,
        minimum,
        delivery,
        description,
        actions
    );

    return card;
}

async function loadProducts() {
    productList.innerHTML = "<p>Loading products...</p>";

    try {
        const snapshot = await getDocs(productCollection());
        let products = snapshot.docs.map(item => ({
            id: item.id,
            ...item.data()
        }));

        products.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        });

        if (!isOwner) {
            products = products.filter(product => !product.hidden);
        }

        productList.innerHTML = "";

        if (!products.length) {
            productList.innerHTML = `<p>${isOwner ? "No products yet." : "This shop has no available products."}</p>`;
            return;
        }

        const productFragment = document.createDocumentFragment();

        products.forEach(product => {
            productFragment.appendChild(createProductCard(product));
        });

        productList.appendChild(productFragment);
    } catch (error) {
        console.error(error);
        productList.innerHTML = "<p>Unable to load products.</p>";
    }
}

/* =========================================================
   MULTI-ITEM CART AND CHECKOUT
========================================================= */

function cartTotal() {
    return [...cart.values()].reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
}

function addToCart(product) {
    if (!shopIsSelling) {
        showShopAlert("This seller is temporarily not accepting orders.");
        return;
    }

    if (isOwner || currentUser?.uid === shopOwnerUid) {
        showShopAlert("You cannot buy your own products.");
        return;
    }

    const minimum = getMinimum(product);
    const stock = Number(product.stock || 0);
    if (stock < minimum) {
        showShopAlert("This product does not have enough stock for its minimum purchase quantity.");
        return;
    }

    const existing = cart.get(product.id);
    if (existing) {
        existing.quantity = Math.min(stock, existing.quantity + 1);
    } else {
        cart.set(product.id, { product, quantity: minimum });
    }

    renderCart();
    openModal(cartModal);
    loadProducts();
}

function changeCartQuantity(productId, amount) {
    const item = cart.get(productId);
    if (!item) return;

    const minimum = getMinimum(item.product);
    const stock = Number(item.product.stock || 0);
    item.quantity = Math.max(minimum, Math.min(stock, item.quantity + amount));
    renderCart();
}

function removeFromCart(productId) {
    cart.delete(productId);
    renderCart();
    loadProducts();
}

function renderCart() {
    cartCountElement.textContent = String([...cart.values()].reduce((sum, item) => sum + item.quantity, 0));
    cartItemsElement.innerHTML = "";

    if (!cart.size) {
        cartItemsElement.innerHTML = '<p class="cartEmpty">Your cart is empty.</p>';
        cartTotalElement.textContent = formatPrice(0);
        checkoutCartButton.disabled = true;
        return;
    }

    const cartFragment = document.createDocumentFragment();

    for (const [productId, item] of cart) {
        const row = document.createElement("article");
        row.className = "cartItem";

        const image = document.createElement("img");
        image.src = item.product.imageUrl || "";
        image.alt = item.product.name || "Product";
        image.loading = "lazy";
        image.decoding = "async";

        const info = document.createElement("div");
        info.className = "cartItemInfo";
        const name = document.createElement("strong");
        name.textContent = item.product.name || "Unnamed Product";
        const price = document.createElement("span");
        price.textContent = `${formatPrice(item.product.price)} each`;
        info.append(name, price);

        const controls = document.createElement("div");
        controls.className = "cartQuantityControls";
        const minus = document.createElement("button");
        minus.type = "button";
        minus.textContent = "−";
        minus.disabled = item.quantity <= getMinimum(item.product);
        minus.addEventListener("click", () => changeCartQuantity(productId, -1));
        const quantity = document.createElement("strong");
        quantity.textContent = String(item.quantity);
        const plus = document.createElement("button");
        plus.type = "button";
        plus.textContent = "+";
        plus.disabled = item.quantity >= Number(item.product.stock || 0);
        plus.addEventListener("click", () => changeCartQuantity(productId, 1));
        controls.append(minus, quantity, plus);

        const subtotal = document.createElement("strong");
        subtotal.className = "cartItemSubtotal";
        subtotal.textContent = formatPrice(Number(item.product.price) * item.quantity);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "cartRemoveButton";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => removeFromCart(productId));

        row.append(image, info, controls, subtotal, remove);
        cartFragment.appendChild(row);
    }

    cartItemsElement.appendChild(cartFragment);
    cartTotalElement.textContent = formatPrice(cartTotal());
    checkoutCartButton.disabled = false;
}

function renderPaymentCartSummary() {
    paymentCartItems.innerHTML = "";
    const paymentCartFragment = document.createDocumentFragment();

    for (const { product, quantity } of cart.values()) {
        const row = document.createElement("div");
        row.className = "paymentCartItem";
        const label = document.createElement("span");
        label.textContent = `${product.name || "Product"} × ${quantity}`;
        const amount = document.createElement("strong");
        amount.textContent = formatPrice(Number(product.price) * quantity);
        row.append(label, amount);
        paymentCartFragment.appendChild(row);
    }

    paymentCartItems.appendChild(paymentCartFragment);
    paymentAmount.textContent = formatPrice(cartTotal());
}

function getEnabledPaymentMethods(data) {
    const normalized = normalizePaymentMethods(data || {});
    return Object.entries(normalized).filter(([, method]) => method.enabled && method.destination && method.qrImageUrl);
}

function renderSelectedPaymentMethod(methodKey) {
    const methods = normalizePaymentMethods(sellerPaymentInformation || {});
    const method = methods[methodKey];
    if (!method) return;
    selectedPaymentMethod = methodKey;
    if (selectedPaymentDetails) selectedPaymentDetails.hidden = false;
    if (paymentFillUpForm) paymentFillUpForm.hidden = false;
    const label = methodKey === "gcash" ? "GCash" : methodKey === "maya" ? "Maya" : "PayPal";
    buyerPaymentMethodTitle.textContent = `${label} Payment`;
    buyerAccountName.textContent = method.name || "";
    buyerAccountName.hidden = !method.name;
    buyerPaymentDestination.textContent = method.destination;
    copyPaymentDestinationButton.textContent = methodKey === "paypal" ? "Copy Email" : "Copy Number";
    paymentReferenceLabel.textContent = methodKey === "paypal" ? "Transaction ID *" : "Reference Number *";
    setPreview(buyerQrImage, method.qrImageUrl);
    paymentMethodChoices.querySelectorAll("button").forEach(button => button.classList.toggle("selected", button.dataset.method === methodKey));
}

function renderPaymentMethodChoices(data) {
    paymentMethodChoices.innerHTML = "";
    const enabled = getEnabledPaymentMethods(data);
    const methodFragment = document.createDocumentFragment();

    for (const [key] of enabled) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "paymentMethodChoice";
        button.dataset.method = key;
        button.textContent = key === "gcash" ? "GCash" : key === "maya" ? "Maya" : "PayPal";
        button.addEventListener("click", () => renderSelectedPaymentMethod(key));
        methodFragment.appendChild(button);
    }

    paymentMethodChoices.appendChild(methodFragment);
    selectedPaymentMethod = "";
    if (selectedPaymentDetails) selectedPaymentDetails.hidden = true;
    if (paymentFillUpForm) paymentFillUpForm.hidden = true;
    buyerPaymentMethodTitle.textContent = "Choose Payment Method";
}

function setDefaultPaymentDateTime() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    paymentDateInput.value = local.toISOString().slice(0, 10);
    paymentTimeInput.value = local.toISOString().slice(11, 16);
}

async function continueToPayment() {
    await loadSellingStatus();
    if (!shopIsSelling) { showShopAlert("This seller is temporarily not accepting orders."); cart.clear(); renderCart(); closeModal(cartModal); return; }
    if (!cart.size) { showShopAlert("Add at least one product to your cart."); return; }
    checkoutCartButton.disabled = true;
    try {
        const data = await loadPaymentInformation();
        if (!getEnabledPaymentMethods(data).length) { showShopAlert("The seller has not completed their payment information yet."); return; }
        renderPaymentMethodChoices(data);
        setDefaultPaymentDateTime();
        paymentReferenceInput.value = "";
        paymentProofInput.value = "";
        buyerUsernameInput.value = "";
        buyerNotesInput.value = "";
        setPreview(paymentProofPreview, "");
        renderPaymentCartSummary();
        closeModal(cartModal);
        openModal(paymentModal);
    } catch (error) {
        console.error(error);
        showShopAlert("Could not load the seller's payment information.");
    } finally { checkoutCartButton.disabled = false; }
}

async function uploadPaymentProof(orderId) {
    const file = paymentProofInput.files?.[0];
    const extension = file.name.split(".").pop()?.toLowerCase() || "image";
    const buyerFolder = currentUser?.uid || "unknown-buyer";
    const path = `payment-proofs/${shopOwnerUid}/${buyerFolder}/${orderId}.${extension}`;
    const storageReference = ref(storage, path);
    await uploadBytes(storageReference, file, { contentType: file.type });
    return {
        paymentProofUrl: await getDownloadURL(storageReference),
        paymentProofPath: path
    };
}

async function submitOrder() {
    await loadSellingStatus();

    if (!shopIsSelling) {
        showShopAlert("This seller has stopped accepting orders.");
        cart.clear();
        renderCart();
        closeModal(paymentModal);
        return;
    }

    if (!cart.size) return;

    if (!currentUser) {
        showShopAlert("Unable to identify your session. Refresh the page and try again.");
        return;
    }

    const buyerIsGuest = currentUser.isAnonymous === true;
    const paymentSettings = sellerPaymentInformation || await loadPaymentInformation();

    if (buyerIsGuest && paymentSettings?.allowGuestOrders !== true) {
        showShopAlert("This seller does not allow guest orders. Please sign in with a registered account.");
        return;
    }

    if (isOwner || currentUser.uid === shopOwnerUid) {
        showShopAlert("You cannot buy your own products.");
        return;
    }

    const referenceNumber = paymentReferenceInput.value.trim();
    const paymentDate = paymentDateInput.value;
    const paymentTime = paymentTimeInput.value;
    const buyerNotes = buyerNotesInput.value.trim();
    const buyerUsername = buyerUsernameInput.value.trim();
    const proof = paymentProofInput.files?.[0];

    if (!selectedPaymentMethod) return showShopAlert("Choose a payment method.");
    if (!paymentDate) return showShopAlert("Select the payment date.");
    if (!paymentTime) return showShopAlert("Select the payment time.");
    if (!referenceNumber) return showShopAlert(selectedPaymentMethod === "paypal" ? "Enter the PayPal transaction ID." : "Enter the payment reference number.");
    if (!proof) return showShopAlert("Upload your payment proof.");
    if (!buyerUsername) return showShopAlert("Enter your username or IGN.");
    if (!previewFileValidation(proof, 2 * 1024 * 1024)) return;

    submitOrderButton.disabled = true;
    submitOrderButton.textContent = "Sending Order...";

    let uploadedProof = null;

    try {
        // Create the order ID before uploading so the proof and reservation
        // records all use the same permanent order ID.
        const orderReference = doc(collection(db, "users", shopOwnerUid, "orders"));
        uploadedProof = await uploadPaymentProof(orderReference.id);

        await runTransaction(db, async transaction => {
            const requestedItems = [...cart.values()];
            const productReads = [];

            // Registered buyers: 2 minutes. Guest buyers: 5 minutes.
            const cooldownReference = doc(
                db,
                "users",
                currentUser.uid,
                "orderLimits",
                "cartOrder"
            );

            const cooldownSnapshot = await transaction.get(cooldownReference);

            if (cooldownSnapshot.exists()) {
    const lastOrderAt = cooldownSnapshot.data().lastOrderAt;
    const lastOrderMilliseconds = lastOrderAt?.toMillis?.() || 0;

    const cooldownMilliseconds = buyerIsGuest ? 300000 : 120000;

    const remainingMilliseconds =
        cooldownMilliseconds - (Date.now() - lastOrderMilliseconds);

    if (remainingMilliseconds > 0) {
        const remainingSeconds = Math.ceil(remainingMilliseconds / 1000);

        throw new Error(
            `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} before sending another order.`
        );
    }
}

            // Firestore requires every transaction read to happen before writes.
            for (const { product, quantity } of requestedItems) {
                const productReference = doc(
                    db,
                    "users",
                    shopOwnerUid,
                    "shopProducts",
                    product.id
                );

                const productSnapshot = await transaction.get(productReference);

                productReads.push({
                    product,
                    quantity,
                    productReference,
                    productSnapshot
                });
            }

            const validatedItems = [];

            for (const entry of productReads) {
                const {
                    product,
                    quantity,
                    productReference,
                    productSnapshot
                } = entry;

                if (!productSnapshot.exists()) {
                    throw new Error(`${product.name || "A product"} is no longer available.`);
                }

                const latest = {
                    id: productSnapshot.id,
                    ...productSnapshot.data()
                };

                const minimum = getMinimum(latest);
                const stock = Number(latest.stock || 0);
                const requestedQuantity = Number(quantity || 0);

                if (
                    latest.hidden ||
                    !Number.isInteger(requestedQuantity) ||
                    requestedQuantity < minimum ||
                    requestedQuantity > stock
                ) {
                    throw new Error(
                        `${latest.name || "A product"} has changed or does not have enough stock.`
                    );
                }

                const price = Number(latest.price);
                const reservationId = `${orderReference.id}_${latest.id}`;
                const reservationReference = doc(
                    db,
                    "users",
                    shopOwnerUid,
                    "stockReservations",
                    reservationId
                );

                validatedItems.push({
                    productId: latest.id,
                    productName: latest.name,
                    imageUrl: latest.imageUrl || "",
                    quantity: requestedQuantity,
                    price,
                    subtotal: price * requestedQuantity,
                    reservationId
                });

                // Reserve stock immediately. Concurrent buyers are protected by
                // the Firestore transaction: only one transaction can use the
                // final available units.
                transaction.set(reservationReference, {
                    reservationId,
                    orderId: orderReference.id,
                    productId: latest.id,
                    sellerUid: shopOwnerUid,
                    buyerUid: currentUser.uid,
                    buyerIsGuest,
                    quantity: requestedQuantity,
                    status: "reserved",
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                transaction.update(productReference, {
                    stock: stock - requestedQuantity,
                    lastReservationId: reservationId,
                    updatedAt: serverTimestamp()
                });
            }

            const totalAmount = validatedItems.reduce(
                (sum, item) => sum + item.subtotal,
                0
            );

            const totalQuantity = validatedItems.reduce(
                (sum, item) => sum + item.quantity,
                0
            );

            transaction.set(cooldownReference, {
                buyerUid: currentUser.uid,
                buyerIsGuest,
                cooldownSeconds: buyerIsGuest ? 300 : 120,
                lastOrderAt: serverTimestamp()
            });

            const displayOrderId = `PD-${orderReference.id.slice(0, 8).toUpperCase()}`;

            transaction.set(orderReference, {
                orderId: orderReference.id,
                displayOrderId,
                buyerUid: currentUser.uid,
                buyerIsGuest,
                buyerUsername,
                sellerUid: shopOwnerUid,
                items: validatedItems,
                itemCount: validatedItems.length,
                quantity: totalQuantity,
                productName:
                    validatedItems.length === 1
                        ? validatedItems[0].productName
                        : `${validatedItems.length} products`,
                totalAmount,
                paymentMethod: selectedPaymentMethod,
                paymentDate,
                paymentTime,
                paymentReferenceNumber: referenceNumber,
                gcashReferenceNumber: selectedPaymentMethod === "gcash" ? referenceNumber : "",
                buyerNotes,
                paymentProofUrl: uploadedProof.paymentProofUrl,
                paymentProofPath: uploadedProof.paymentProofPath,
                status: "order_sent",
                stockReserved: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });

        cart.clear();
        renderCart();
        closeModal(paymentModal);
        await loadProducts();

        const displayOrderId = `PD-${orderReference.id.slice(0, 8).toUpperCase()}`;
        showShopAlert(
            `Order sent successfully!\n\nUsername: ${buyerUsername}\nStatus: Waiting for seller confirmation.\n\nThe seller can find your order using your username.`
        );
    } catch (error) {
        console.error(error);

        // The uploaded proof may remain in Storage when the transaction fails.
        // Remove it so failed orders do not leave unused files.
        if (uploadedProof?.paymentProofPath) {
            try {
                await deleteStoredFile(uploadedProof.paymentProofPath);
            } catch (cleanupError) {
                console.warn("Could not remove unused payment proof:", cleanupError);
            }
        }

        showShopAlert(error.message || "Could not send the order. Check the browser console.");
    } finally {
        submitOrderButton.disabled = false;
        submitOrderButton.textContent = "Send Order";
    }
}

function previewFileValidation(file, maximumBytes) {
    const allowed = ["image/png", "image/jpeg", "image/webp"];

    if (!allowed.includes(file.type)) {
        showShopAlert("Payment proof must be PNG, JPG, or WebP.");
        return false;
    }

    if (file.size > maximumBytes) {
        showShopAlert("Payment proof must not exceed 2 MB.");
        return false;
    }

    return true;
}

/* =========================================================
   STARTUP
========================================================= */

export async function initializeShop(ownerUid = "") {
    try {
        currentUser = await authReady;

        const ownerFromUrl = new URLSearchParams(location.search).get("id");
        shopOwnerUid = String(ownerUid || ownerFromUrl || currentUser?.uid || "").trim();

        if (!shopOwnerUid) {
            shopTitle.textContent = "SHOP";
            shopMessage.textContent = "Shop owner was not found.";
            productList.innerHTML = "<p>Unable to open this shop.</p>";
            return;
        }

        isOwner = Boolean(
            currentUser &&
            !currentUser.isAnonymous &&
            currentUser.uid === shopOwnerUid
        );

        await loadSellingStatus();

        if (isOwner) {
            shopTitle.textContent = document.body.classList.contains("profilePage") ? "Shop" : "My Shop";
            shopMessage.textContent = "";
            sellerControls.hidden = false;
            buyerCartControls.hidden = true;
        } else {
            shopTitle.textContent = document.body.classList.contains("profilePage") ? "Shop" : "Shop";
            shopMessage.textContent = shopIsSelling
                ? "Browse the seller's available products."
                : "You may browse products, but this seller is not accepting orders right now.";
            sellerControls.hidden = true;
            buyerCartControls.hidden = !shopIsSelling;
        }

        renderSellingStatus();
        await loadProducts();
    } catch (error) {
        console.error(error);
        shopMessage.textContent = "Unable to open the shop.";
        productList.innerHTML = "<p>Something went wrong.</p>";
    }
}

/* =========================================================
   EVENTS
========================================================= */

addProductButton.addEventListener("click", openAddProductForm);
paymentInfoButton.addEventListener("click", openPaymentInformationEditor);
sellingToggleButton?.addEventListener("click", toggleSellingStatus);

cancelProductButton.addEventListener("click", () => {
    closeModal(productModal);
    clearProductForm();
});

saveProductButton.addEventListener("click", saveProduct);


if (gcashNumberInput) {
    gcashNumberInput.addEventListener("input", () => {
        gcashNumberInput.value = gcashNumberInput.value.replace(/\D/g, "").slice(0, 11);
    });
}

productImageInput.addEventListener("change", () => {
    const valid = previewFile(productImageInput, productImagePreview, 1024 * 1024);

    if (!valid && editingProductImageUrl) {
        setPreview(productImagePreview, editingProductImageUrl);
    }
});

cancelPaymentInfoButton.addEventListener("click", () => closeModal(paymentInfoModal));
continuePaymentSetupButton.addEventListener("click", continuePaymentSetup);
backPaymentSetupButton.addEventListener("click", () => showPaymentSetupStep(1));
[enableGcashInput, enableMayaInput, enablePaypalInput].forEach(input => {
    input.addEventListener("change", updatePaymentMethodSelectionState);
});
document.querySelectorAll("[data-payment-accordion]").forEach(button => {
    button.addEventListener("click", () => togglePaymentAccordion(button));
});
savePaymentInfoButton.addEventListener("click", savePaymentInformation);

gcashQrInput.addEventListener("change", () => previewFile(gcashQrInput, gcashQrPreview, 2 * 1024 * 1024));
mayaQrInput.addEventListener("change", () => previewFile(mayaQrInput, mayaQrPreview, 2 * 1024 * 1024));
paypalQrInput.addEventListener("change", () => previewFile(paypalQrInput, paypalQrPreview, 2 * 1024 * 1024));
copyPaymentDestinationButton.addEventListener("click", async () => {
    const value = buyerPaymentDestination.textContent.trim();
    if (!value || value === "—") return;
    try {
        await navigator.clipboard.writeText(value);
        const original = copyPaymentDestinationButton.textContent;
        copyPaymentDestinationButton.textContent = "Copied!";
        setTimeout(() => { copyPaymentDestinationButton.textContent = original; }, 1200);
    } catch {
        showShopAlert(`Copy this payment detail: ${value}`);
    }
});

openCartButton.addEventListener("click", () => { renderCart(); openModal(cartModal); });
closeCartButton.addEventListener("click", () => closeModal(cartModal));
checkoutCartButton.addEventListener("click", continueToPayment);
backToCartButton.addEventListener("click", () => {
    closeModal(paymentModal);
    renderCart();
    openModal(cartModal);
});

paymentProofInput.addEventListener("change", () => {
    const file = paymentProofInput.files?.[0];

    if (!file) {
        setPreview(paymentProofPreview, "");
        return;
    }

    if (previewFileValidation(file, 2 * 1024 * 1024)) {
        const url = URL.createObjectURL(file);
        objectUrls.add(url);
        setPreview(paymentProofPreview, url);
    } else {
        paymentProofInput.value = "";
        setPreview(paymentProofPreview, "");
    }
});

submitOrderButton.addEventListener("click", submitOrder);

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") {
        return;
    }

    [productModal, paymentInfoModal, cartModal, paymentModal].forEach(closeModal);
});

window.addEventListener("beforeunload", () => {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
});


// Start automatically only on the standalone My Shop page.
if (!document.body.classList.contains("profilePage")) {
    initializeShop();
}
