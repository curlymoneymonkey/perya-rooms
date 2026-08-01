import { initializeShop } from "./shop.js";
import { authReady, db } from "./firebase.js";
import {
    collection,
    doc,
    onSnapshot,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const profileOwnerUid = new URLSearchParams(window.location.search).get("id")?.trim() || "";

const customerOrdersBox = document.getElementById("profileCustomerOrdersBox");
const customerOrdersList = document.getElementById("profileCustomerOrdersList");
const customerOrdersSummary = document.getElementById("profileCustomerOrdersSummary");
const customerOrderSearch = document.getElementById("profileCustomerOrderSearch");

const customerProofModal = document.getElementById("customerProofModal");
const customerProofModalImage = document.getElementById("customerProofModalImage");
const customerProofOpenOriginal = document.getElementById("customerProofOpenOriginal");
const closeCustomerProofButton = document.getElementById("closeCustomerProofButton");

function openCustomerProof(url) {
    if (!url || !customerProofModal || !customerProofModalImage) return;
    customerProofModalImage.src = url;
    if (customerProofOpenOriginal) customerProofOpenOriginal.href = url;
    customerProofModal.hidden = false;
    document.body.classList.add("modalOpen");
}

function closeCustomerProof() {
    if (!customerProofModal) return;
    customerProofModal.hidden = true;
    customerProofModalImage?.removeAttribute("src");
    if (customerProofOpenOriginal) customerProofOpenOriginal.href = "#";
    document.body.classList.remove("modalOpen");
}

const newOrderSound = new Audio("sounds/new-order.mp3");
newOrderSound.volume = 0.8;
newOrderSound.preload = "auto";

let currentUser = null;
let isShopOwner = false;
let currentCustomerOrders = [];
let customerOrderActionRunning = false;
let ordersInitialized = false;
const seenPendingOrderIds = new Set();
let ordersUnsubscribe = null;

function normalizeOrderStatus(status) {
    if (!status || status === "pending_verification") return "order_sent";
    if (status === "approved") return "completed";
    return String(status);
}

function customerOrderTime(order) {
    return order.createdAt?.toMillis?.()
        || order.updatedAt?.toMillis?.()
        || 0;
}

function customerOrderItems(order) {
    if (Array.isArray(order.items) && order.items.length) return order.items;

    return [{
        productId: order.productId,
        productName: order.productName || "Unknown Product",
        quantity: Number(order.quantity || 0),
        price: Number(order.price || 0),
        subtotal: Number(order.totalAmount || 0)
    }];
}

function customerOrderBuyerName(order) {
    return String(
        order.buyerUsername
        || order.buyerIgn
        || order.ign
        || "Not provided"
    ).trim();
}

function formatPrice(value) {
    return Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function formatPaymentMethod(value) {
    const method = String(value || "").trim().toLowerCase();
    if (method === "gcash") return "GCash";
    if (method === "maya") return "Maya";
    if (method === "paypal") return "PayPal";
    return method ? method.charAt(0).toUpperCase() + method.slice(1) : "Not provided";
}

function formatPaymentDateTime(dateValue, timeValue) {
    if (!dateValue && !timeValue) return "Not provided";

    const rawDate = String(dateValue || "").trim();
    const rawTime = String(timeValue || "").trim();
    const parsed = new Date(`${rawDate || "1970-01-01"}T${rawTime || "00:00"}`);

    if (Number.isNaN(parsed.getTime())) {
        return [rawDate, rawTime].filter(Boolean).join(" • ");
    }

    return parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function formatOrderTime(value) {
    if (!value?.toDate) return "Time unavailable";

    return value.toDate().toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

async function copyCustomerUsername(username, button) {
    const text = String(username || "").trim();
    if (!text || text === "Not provided") return;

    const originalText = button.textContent;
    button.disabled = true;

    try {
        await navigator.clipboard.writeText(text);
        button.textContent = "✓";
    } catch {
        button.textContent = "Failed";
    } finally {
        window.setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 1200);
    }
}

function setOrderButtonsDisabled(disabled) {
    customerOrdersList?.querySelectorAll(".customerOrderActionButton")
        .forEach(button => {
            button.disabled = disabled;
        });
}

async function completeCustomerOrder(order) {
    if (!isShopOwner || customerOrderActionRunning) return;

    const confirmed = await window.showPeryaConfirm(
        "Mark this order as completed?",
        {
            title: "Complete Order",
            confirmText: "Complete",
            cancelText: "Cancel"
        }
    );
    if (!confirmed) return;

    customerOrderActionRunning = true;
    setOrderButtonsDisabled(true);

    try {
        const orderRef = doc(db, "users", profileOwnerUid, "orders", order.id);

        await runTransaction(db, async transaction => {
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists()) throw new Error("This order no longer exists.");

            const latestOrder = { id: orderSnapshot.id, ...orderSnapshot.data() };
            if (normalizeOrderStatus(latestOrder.status) !== "order_sent") {
                throw new Error("This order has already been reviewed.");
            }

            if (!latestOrder.stockReserved) {
                const productReads = [];

                for (const item of customerOrderItems(latestOrder)) {
                    if (!item.productId) throw new Error("An ordered product ID is missing.");

                    const productRef = doc(
                        db,
                        "users",
                        profileOwnerUid,
                        "shopProducts",
                        item.productId
                    );

                    productReads.push({
                        item,
                        productRef,
                        productSnapshot: await transaction.get(productRef)
                    });
                }

                for (const { item, productRef, productSnapshot } of productReads) {
                    if (!productSnapshot.exists()) {
                        throw new Error(`${item.productName || "A product"} no longer exists.`);
                    }

                    const stock = Number(productSnapshot.data().stock || 0);
                    const quantity = Number(item.quantity || 0);

                    if (!Number.isInteger(quantity) || quantity < 1 || stock < quantity) {
                        throw new Error(
                            `There is not enough stock for ${item.productName || "one of the products"}.`
                        );
                    }

                    transaction.update(productRef, {
                        stock: stock - quantity,
                        updatedAt: serverTimestamp()
                    });
                }
            }

            transaction.update(orderRef, {
                status: "completed",
                stockReserved: true,
                completedAt: serverTimestamp(),
                reviewedAt: serverTimestamp(),
                reviewedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });
        });
    } catch (error) {
        console.error("Could not complete order:", error);
        await window.showPeryaAlert(error.message || "Could not complete this order.", {
            type: "error",
            title: "Order Error"
        });
    } finally {
        customerOrderActionRunning = false;
        renderCustomerOrders();
    }
}

async function rejectCustomerOrder(order) {
    if (!isShopOwner || customerOrderActionRunning) return;

    const reason = await window.showPeryaPrompt(
        `Reason for rejecting "${customerOrderBuyerName(order)}" (optional):`,
        {
            title: "Reject Order",
            placeholder: "Enter a reason (optional)",
            confirmText: "Reject",
            cancelText: "Cancel"
        }
    );

    if (reason === null) return;

    customerOrderActionRunning = true;
    setOrderButtonsDisabled(true);

    try {
        const orderRef = doc(db, "users", profileOwnerUid, "orders", order.id);

        await runTransaction(db, async transaction => {
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists()) throw new Error("This order no longer exists.");

            const latestOrder = { id: orderSnapshot.id, ...orderSnapshot.data() };
            if (normalizeOrderStatus(latestOrder.status) !== "order_sent") {
                throw new Error("This order has already been reviewed.");
            }

            const latestItems = customerOrderItems(latestOrder);
            const productReads = [];

            if (latestOrder.stockReserved === true) {
                for (const item of latestItems) {
                    if (!item.productId) throw new Error("An ordered product ID is missing.");

                    const productRef = doc(
                        db,
                        "users",
                        profileOwnerUid,
                        "shopProducts",
                        item.productId
                    );

                    const reservationId = item.reservationId || `${latestOrder.id}_${item.productId}`;
                    const reservationRef = doc(
                        db,
                        "users",
                        profileOwnerUid,
                        "stockReservations",
                        reservationId
                    );

                    productReads.push({
                        item,
                        productRef,
                        productSnapshot: await transaction.get(productRef),
                        reservationRef,
                        reservationSnapshot: await transaction.get(reservationRef)
                    });
                }

                for (const entry of productReads) {
                    const {
                        item,
                        productRef,
                        productSnapshot,
                        reservationRef,
                        reservationSnapshot
                    } = entry;

                    if (!productSnapshot.exists()) {
                        throw new Error(`${item.productName || "A product"} no longer exists.`);
                    }

                    const quantity = Number(item.quantity || 0);
                    const currentStock = Number(productSnapshot.data().stock || 0);

                    if (!Number.isInteger(quantity) || quantity < 1) {
                        throw new Error("An ordered quantity is invalid.");
                    }

                    if (
                        !reservationSnapshot.exists()
                        || reservationSnapshot.data().status === "reserved"
                    ) {
                        transaction.update(productRef, {
                            stock: currentStock + quantity,
                            updatedAt: serverTimestamp()
                        });
                    }

                    if (reservationSnapshot.exists()) {
                        transaction.update(reservationRef, {
                            status: "released",
                            releasedAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        });
                    }
                }
            }

            transaction.update(orderRef, {
                status: "rejected",
                rejectionReason: String(reason).trim().slice(0, 300),
                stockRestored: latestOrder.stockReserved === true,
                reviewedAt: serverTimestamp(),
                reviewedBy: currentUser.uid,
                updatedAt: serverTimestamp()
            });
        });
    } catch (error) {
        console.error("Could not reject order:", error);
        await window.showPeryaAlert(error.message || "Could not reject this order.", {
            type: "error",
            title: "Order Error"
        });
    } finally {
        customerOrderActionRunning = false;
        renderCustomerOrders();
    }
}

function renderCustomerOrders() {
    if (!customerOrdersList || !customerOrdersSummary) return;

    customerOrdersList.innerHTML = "";

    const searchTerm = String(customerOrderSearch?.value || "").trim().toUpperCase();
    const matchingOrders = [...currentCustomerOrders]
        .filter(order => {
            if (!searchTerm) return true;

            const buyer = customerOrderBuyerName(order).toUpperCase();
            const items = customerOrderItems(order)
                .map(item => String(item.productName || "").toUpperCase())
                .join(" ");

            return buyer.includes(searchTerm) || items.includes(searchTerm);
        })
        .sort((a, b) => {
            const aPending = normalizeOrderStatus(a.status) === "order_sent";
            const bPending = normalizeOrderStatus(b.status) === "order_sent";
            if (aPending !== bPending) return aPending ? -1 : 1;
            return aPending
                ? customerOrderTime(a) - customerOrderTime(b)
                : customerOrderTime(b) - customerOrderTime(a);
        });

    const pending = matchingOrders.filter(
        order => normalizeOrderStatus(order.status) === "order_sent"
    );
    const finished = matchingOrders
        .filter(order => normalizeOrderStatus(order.status) !== "order_sent")
        .slice(0, 15);

    const visibleOrders = searchTerm ? matchingOrders : [...pending, ...finished];

    customerOrdersSummary.textContent = visibleOrders.length
        ? `${visibleOrders.length} order${visibleOrders.length === 1 ? "" : "s"}`
        : "No customer orders.";

    if (!visibleOrders.length) {
        const empty = document.createElement("p");
        empty.className = "emptyOrders";
        empty.textContent = "No customer orders.";
        customerOrdersList.appendChild(empty);
        return;
    }

    visibleOrders.forEach(order => {
        const items = customerOrderItems(order);
        const status = normalizeOrderStatus(order.status);

        const card = document.createElement("article");
        card.className = "pendingCustomerOrder";

        const header = document.createElement("div");
        header.className = "pendingCustomerOrderHeader";

        const buyerRow = document.createElement("div");
        buyerRow.className = "pendingCustomerOrderBuyerRow";

        const buyerName = customerOrderBuyerName(order);
        const buyer = document.createElement("strong");
        buyer.className = "pendingCustomerOrderBuyer";
        buyer.textContent = `IGN: ${buyerName}`;

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "copyCustomerUsernameButton";
        copyButton.textContent = "📋";
        copyButton.title = `Copy ${buyerName}`;
        copyButton.addEventListener("click", () =>
            copyCustomerUsername(buyerName, copyButton)
        );

        buyerRow.append(buyer, copyButton);

        const time = document.createElement("time");
        time.className = "pendingCustomerOrderTime";
        time.textContent = formatOrderTime(order.updatedAt || order.createdAt);

        header.append(buyerRow, time);
        card.appendChild(header);

        const content = document.createElement("div");
        content.className = "pendingCustomerOrderItems";

        items.forEach(item => {
            const itemRow = document.createElement("div");
            itemRow.className = "pendingCustomerOrderItemRow";

            const amount = item.subtotal
                ?? Number(item.price || 0) * Number(item.quantity || 0);

            const imageWrap = document.createElement("div");
            imageWrap.className = "pendingCustomerOrderItemImageWrap";

            if (item.imageUrl) {
                const image = document.createElement("img");
                image.className = "pendingCustomerOrderItemImage";
                image.src = item.imageUrl;
                image.alt = item.productName || "Ordered product";
                image.loading = "lazy";
            image.decoding = "async";
            image.fetchPriority = "low";
                imageWrap.appendChild(image);
            } else {
                const placeholder = document.createElement("span");
                placeholder.className = "pendingCustomerOrderItemImagePlaceholder";
                placeholder.textContent = "No image";
                imageWrap.appendChild(placeholder);
            }

            const itemInfo = document.createElement("div");
            itemInfo.className = "pendingCustomerOrderItemInfo";

            const name = document.createElement("strong");
            name.className = "pendingCustomerOrderProductName";
            name.textContent = item.productName || "Unknown Product";

            const itemMeta = document.createElement("div");
            itemMeta.className = "pendingCustomerOrderItemMeta";

            const quantity = document.createElement("div");
            quantity.className = "pendingCustomerOrderQuantity";
            quantity.append("Quantity: ");
            const quantityValue = document.createElement("strong");
            quantityValue.textContent = `${Number(item.quantity || 0)}x`;
            quantity.appendChild(quantityValue);

            const amountLine = document.createElement("div");
            amountLine.className = "pendingCustomerOrderAmount";
            amountLine.append("Amount: ");
            const amountValue = document.createElement("strong");
            amountValue.textContent = `₱${formatPrice(amount)}`;
            amountLine.appendChild(amountValue);

            itemMeta.append(quantity, amountLine);
            itemInfo.append(name, itemMeta);
            itemRow.append(imageWrap, itemInfo);
            content.appendChild(itemRow);
        });

        const privateDetails = document.createElement("div");
        privateDetails.className = "pendingCustomerOrderPrivateDetails";

        const makeBuyerDetail = (label, value) => {
            const row = document.createElement("p");
            row.append(`${label}: `);
            const strong = document.createElement("strong");
            strong.textContent = value;
            row.appendChild(strong);
            return row;
        };

        privateDetails.append(
            makeBuyerDetail("💳 Payment", formatPaymentMethod(order.paymentMethod)),
            makeBuyerDetail("# Ref No.", String(order.paymentReferenceNumber || "Not provided")),
            makeBuyerDetail("🗓 Paid on", formatPaymentDateTime(order.paymentDate, order.paymentTime))
        );

        card.append(content, privateDetails);

        if (status === "rejected" && order.rejectionReason) {
            const reason = document.createElement("p");
            reason.className = "customerOrderRejectionReason";
            reason.textContent = `Reason: ${String(order.rejectionReason).slice(0, 300)}`;
            card.appendChild(reason);
        }

        const proofToggle = document.createElement("button");
        proofToggle.type = "button";
        proofToggle.className = "customerProofToggle";
        proofToggle.textContent = order.paymentProofUrl
            ? "📷 Show Payment Proof"
            : "📷 No Payment Proof";
        proofToggle.disabled = !order.paymentProofUrl;

        const orderFooter = document.createElement("div");
        orderFooter.className = "pendingCustomerOrderFooter";
        orderFooter.hidden = true;

        const proofPanel = document.createElement("div");
        proofPanel.className = "pendingCustomerOrderProofPanel";

        if (order.paymentProofUrl) {
            const proofThumb = document.createElement("button");
            proofThumb.type = "button";
            proofThumb.className = "customerProofThumbnailButton";
            proofThumb.title = "Click to enlarge payment proof";
            proofThumb.setAttribute("aria-label", "Open buyer payment proof in full screen");

            const proofImage = document.createElement("img");
            proofImage.src = order.paymentProofUrl;
            proofImage.alt = "Buyer payment proof";
            proofImage.loading = "lazy";
            proofImage.decoding = "async";
            proofImage.fetchPriority = "low";
            proofThumb.appendChild(proofImage);
            proofThumb.addEventListener("click", () => openCustomerProof(order.paymentProofUrl));
            proofPanel.appendChild(proofThumb);
        } else {
            const noProof = document.createElement("div");
            noProof.className = "customerProofMissing";
            noProof.textContent = "No payment proof uploaded";
            proofPanel.appendChild(noProof);
        }

        const totalAmount = document.createElement("div");
        totalAmount.className = "pendingCustomerOrderTotal";
        const computedTotal = order.totalAmount ?? items.reduce((sum, item) => (
            sum + Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0))
        ), 0);
        totalAmount.innerHTML = `<span>Total Amount</span><strong>₱${formatPrice(computedTotal)}</strong>`;
        orderFooter.append(proofPanel, totalAmount);

        proofToggle.addEventListener("click", () => {
            const willShow = orderFooter.hidden;
            orderFooter.hidden = !willShow;
            proofToggle.textContent = willShow
                ? "🙈 Hide Payment Proof"
                : "📷 Show Payment Proof";
            proofToggle.setAttribute("aria-expanded", String(willShow));
        });

        card.append(proofToggle, orderFooter);

        const actions = document.createElement("div");
        actions.className = "pendingCustomerOrderActions";

        if (status === "order_sent") {
            const completeButton = document.createElement("button");
            completeButton.type = "button";
            completeButton.className =
                "customerOrderActionButton customerOrderCompleteButton";
            completeButton.textContent = "✓ COMPLETE";
            completeButton.disabled = customerOrderActionRunning;
            completeButton.addEventListener("click", () =>
                completeCustomerOrder(order)
            );

            const rejectButton = document.createElement("button");
            rejectButton.type = "button";
            rejectButton.className =
                "customerOrderActionButton customerOrderRejectButton";
            rejectButton.textContent = "✕ REJECT";
            rejectButton.disabled = customerOrderActionRunning;
            rejectButton.addEventListener("click", () =>
                rejectCustomerOrder(order)
            );

            actions.append(completeButton, rejectButton);
        } else {
            const badge = document.createElement("span");
            badge.className = `customerOrderStatusBadge ${
                status === "completed" ? "statusCompleted" : "statusRejected"
            }`;
            badge.textContent =
                status === "completed" ? "✅ Completed" : "❌ Rejected";
            actions.appendChild(badge);
        }

        card.appendChild(actions);
        customerOrdersList.appendChild(card);
    });
}

function playNewOrderSound() {
    newOrderSound.currentTime = 0;
    newOrderSound.play().catch(error => {
        console.warn("New-order sound was blocked or unavailable:", error);
    });
}

function listenForCustomerOrders() {
    if (!isShopOwner || !profileOwnerUid || !customerOrdersBox) return;

    customerOrdersBox.hidden = false;
    customerOrdersSummary.textContent = "Loading orders...";

    const ordersRef = collection(db, "users", profileOwnerUid, "orders");

    ordersUnsubscribe = onSnapshot(
        ordersRef,
        snapshot => {
            currentCustomerOrders = snapshot.docs
                .map(orderDocument => ({
                    id: orderDocument.id,
                    ...orderDocument.data()
                }))
                .sort((a, b) => customerOrderTime(b) - customerOrderTime(a));

            const pendingIds = currentCustomerOrders
                .filter(order => normalizeOrderStatus(order.status) === "order_sent")
                .map(order => order.id);

            if (!ordersInitialized) {
                pendingIds.forEach(id => seenPendingOrderIds.add(id));
                ordersInitialized = true;
            } else {
                const hasNew = pendingIds.some(id => !seenPendingOrderIds.has(id));
                pendingIds.forEach(id => seenPendingOrderIds.add(id));
                if (hasNew) playNewOrderSound();
            }

            renderCustomerOrders();
        },
        error => {
            console.error("Could not load profile customer orders:", error);
            customerOrdersSummary.textContent = "Orders unavailable.";
            customerOrdersList.innerHTML =
                '<p class="emptyOrders errorMessage">Could not load customer orders.</p>';
        }
    );
}

customerOrderSearch?.addEventListener("input", renderCustomerOrders);
closeCustomerProofButton?.addEventListener("click", closeCustomerProof);
customerProofModal?.querySelector("[data-close-customer-proof]")?.addEventListener("click", closeCustomerProof);
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && customerProofModal && !customerProofModal.hidden) {
        closeCustomerProof();
    }
});

window.addEventListener("pagehide", () => {
    ordersUnsubscribe?.();
});

(async function initializeProfileShop() {
    try {
        currentUser = await authReady;
        isShopOwner = Boolean(
            currentUser
            && !currentUser.isAnonymous
            && currentUser.uid === profileOwnerUid
        );

        await initializeShop(profileOwnerUid);
        listenForCustomerOrders();
    } catch (error) {
        console.error("Could not initialize profile shop:", error);
        const message = document.getElementById("shopMessage");
        if (message) message.textContent = "Unable to open the shop.";
    }
})();
