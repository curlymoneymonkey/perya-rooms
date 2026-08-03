import { authReady, db } from "./firebase.js";
import {
    collection,
    doc,
    getDocs,
    runTransaction,
    serverTimestamp,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const loading = document.getElementById("ordersLoading");
const errorBox = document.getElementById("ordersError");
const workspace = document.getElementById("ordersWorkspace");
const list = document.getElementById("ordersList");
const message = document.getElementById("ordersMessage");
const refreshButton = document.getElementById("refreshOrdersButton");
const backToProfile = document.getElementById("backToProfile");
const filters = [...document.querySelectorAll("[data-filter]")];
const pendingCount = document.getElementById("pendingCount");
const approvedCount = document.getElementById("approvedCount");
const rejectedCount = document.getElementById("rejectedCount");
const allCount = document.getElementById("allCount");
const proofModal = document.getElementById("proofModal");
const proofModalImage = document.getElementById("proofModalImage");
const proofOpenOriginal = document.getElementById("proofOpenOriginal");
const closeProofButton = document.getElementById("closeProofButton");

let seller = null;
let orders = [];
let activeFilter = "order_sent";

function formatPrice(value) {
    const amount = Number(value || 0);
    return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
    if (!value?.toDate) return "Date unavailable";
    return value.toDate().toLocaleString([], {
        year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
    });
}

function normalizedStatus(status) {
    // Keep old orders visible after upgrading the marketplace.
    if (!status || status === "pending_verification") return "order_sent";
    if (status === "approved") return "completed";
    return status;
}

function statusLabel(status) {
    const value = normalizedStatus(status);
    if (value === "completed") return "✅ Completed";
    if (value === "rejected") return "❌ Rejected";
    return "📦 Order Sent";
}

function orderTime(order) {
    return order.createdAt?.toMillis?.() || 0;
}

function showProof(url) {
    if (!url) return;
    proofModalImage.src = url;
    proofOpenOriginal.href = url;
    proofModal.hidden = false;
    document.body.style.overflow = "hidden";
}

function closeProof() {
    proofModal.hidden = true;
    proofModalImage.removeAttribute("src");
    proofOpenOriginal.href = "#";
    document.body.style.overflow = "";
}

function detail(label, value) {
    const item = document.createElement("div");
    const name = document.createElement("span");
    const data = document.createElement("strong");
    name.textContent = label;
    data.textContent = value;
    item.append(name, data);
    return item;
}

function getOrderItems(order) {
    if (Array.isArray(order.items) && order.items.length) return order.items;
    return [{
        productId: order.productId,
        productName: order.productName || "Unknown Product",
        quantity: Number(order.quantity || 0),
        price: Number(order.price || 0),
        subtotal: Number(order.totalAmount || 0)
    }];
}

function createOrderCard(order) {
    const items = getOrderItems(order);
    const normalized = normalizedStatus(order.status);
    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    const card = document.createElement("article");
    card.className = "orderCard";

    const header = document.createElement("header");
    header.className = "orderCardHeader";

    const top = document.createElement("div");
    top.className = "orderCardTop";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "orderTitle";
    title.textContent = items.length === 1 ? items[0].productName : `${items.length} Products`;

    const id = document.createElement("p");
    id.className = "orderId";
    id.textContent = `Order ID: ${order.id}`;
    titleWrap.append(title, id);

    const status = document.createElement("span");
    status.className = `orderStatus ${normalized}`;
    status.textContent = statusLabel(order.status);
    top.append(titleWrap, status);

    const date = document.createElement("p");
    date.className = "orderCardDate";
    date.textContent = `Submitted ${formatDate(order.createdAt)}`;
    header.append(top, date);

    const body = document.createElement("div");
    body.className = "orderCardBody";

    const itemList = document.createElement("div");
    itemList.className = "orderItemsList";
    items.forEach(item => {
        const row = document.createElement("div");
        row.className = "orderItemRow";

        const name = document.createElement("strong");
        name.textContent = item.productName || "Unknown Product";

        const subtotal = document.createElement("strong");
        subtotal.textContent = formatPrice(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0));

        const meta = document.createElement("span");
        meta.className = "orderItemMeta";
        meta.textContent = `Qty ${Number(item.quantity || 0)} × ${formatPrice(item.price)}`;

        row.append(name, subtotal, meta);
        itemList.appendChild(row);
    });

    const details = document.createElement("div");
    details.className = "orderDetails";
    [
        ["Buyer IGN", order.buyerUsername || "Not provided"],
        ["Products", String(items.length)],
        ["Total Quantity", String(totalQuantity)],
        ["Order Total", formatPrice(order.totalAmount)],
        ["GCash Reference", order.gcashReferenceNumber || "Not provided"]
    ].forEach(([label, value]) => {
        const wrapper = detail(label, value);
        wrapper.className = "orderDetail";
        details.appendChild(wrapper);
    });

    body.append(itemList, details);

    const proofSection = document.createElement("div");
    proofSection.className = "orderProofSection";

    if (order.paymentProofUrl) {
        const proofButton = document.createElement("button");
        proofButton.className = "proofThumbnailButton";
        proofButton.type = "button";
        proofButton.title = "View payment proof";

        const proof = document.createElement("img");
        proof.src = order.paymentProofUrl;
        proof.alt = "Payment proof";
        proof.loading = "lazy";
        proof.decoding = "async";
        proof.fetchPriority = "low";

        const copy = document.createElement("span");
        copy.className = "proofCopy";
        const copyTitle = document.createElement("strong");
        copyTitle.textContent = "Payment Proof";
        const copyText = document.createElement("span");
        copyText.textContent = "Tap to view the full image";
        copy.append(copyTitle, copyText);

        proofButton.append(proof, copy);
        proofButton.addEventListener("click", () => showProof(order.paymentProofUrl));
        proofSection.appendChild(proofButton);
    } else {
        const noProof = document.createElement("div");
        noProof.className = "noProof";
        noProof.textContent = "No payment proof uploaded.";
        proofSection.appendChild(noProof);
    }

    card.append(header, body, proofSection);

    if (normalized === "order_sent") {
        const actions = document.createElement("div");
        actions.className = "orderActions";

        const reject = document.createElement("button");
        reject.className = "ordersButton orderRejectButton";
        reject.type = "button";
        reject.textContent = "Reject";

        const complete = document.createElement("button");
        complete.className = "ordersButton orderApproveButton";
        complete.type = "button";
        complete.textContent = "Complete";

        reject.addEventListener("click", () => rejectOrder(order, reject, complete));
        complete.addEventListener("click", () => completeOrder(order, complete, reject));
        actions.append(reject, complete);
        card.appendChild(actions);
    } else {
        const closed = document.createElement("p");
        closed.className = "orderClosed";
        closed.textContent = normalized === "completed"
            ? "This order has been completed."
            : "This order was rejected.";
        card.appendChild(closed);
    }

    return card;
}

function updateCounts() {
    pendingCount.textContent = String(
        orders.filter(order => normalizedStatus(order.status) === "order_sent").length
    );
    approvedCount.textContent = String(
        orders.filter(order => normalizedStatus(order.status) === "completed").length
    );
    rejectedCount.textContent = String(
        orders.filter(order => normalizedStatus(order.status) === "rejected").length
    );
    allCount.textContent = String(orders.length);
}

function renderOrders() {
    list.innerHTML = "";
    const visible = activeFilter === "all"
        ? orders
        : orders.filter(order => normalizedStatus(order.status) === activeFilter);

    if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "ordersEmpty";
        empty.textContent = activeFilter === "order_sent"
            ? "No orders have been sent."
            : activeFilter === "completed"
                ? "No completed orders."
                : `No ${activeFilter} orders.`;
        list.appendChild(empty);
        return;
    }

    visible.forEach(order => list.appendChild(createOrderCard(order)));
}

async function loadOrders() {
    refreshButton.disabled = true;
    message.textContent = "Loading orders…";
    try {
        const snapshot = await getDocs(collection(db, "users", seller.uid, "orders"));
        orders = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .sort((a, b) => orderTime(b) - orderTime(a));
        updateCounts();
        renderOrders();
        message.textContent = `Loaded ${orders.length} order${orders.length === 1 ? "" : "s"}.`;
    } catch (error) {
        console.error("Could not load orders:", error);
        message.textContent = "";
        errorBox.hidden = false;
        errorBox.textContent = error?.code === "permission-denied"
            ? "You do not have permission to view these orders. Publish the included Firestore rules."
            : "Could not load customer orders.";
    } finally {
        refreshButton.disabled = false;
    }
}

async function completeOrder(order, completeButton, rejectButton) {
    if (!confirm("Mark this order as completed?")) return;

    completeButton.disabled = true;
    rejectButton.disabled = true;
    message.textContent = "Completing order…";

    try {
        const orderRef = doc(db, "users", seller.uid, "orders", order.id);

        await runTransaction(db, async transaction => {
            const orderSnapshot = await transaction.get(orderRef);

            if (!orderSnapshot.exists()) {
                throw new Error("This order no longer exists.");
            }

            const latestOrder = {
                id: orderSnapshot.id,
                ...orderSnapshot.data()
            };

            const currentStatus = normalizedStatus(latestOrder.status);

            if (currentStatus !== "order_sent") {
                throw new Error("This order has already been reviewed.");
            }

            // New orders already had their stock reserved at checkout.
            // Legacy pending orders did not, so reserve their stock once here.
            if (!latestOrder.stockReserved) {
                const latestItems = getOrderItems(latestOrder);
                const productReads = [];

                for (const item of latestItems) {
                    if (!item.productId) {
                        throw new Error("An ordered product ID is missing.");
                    }

                    const productRef = doc(
                        db,
                        "users",
                        seller.uid,
                        "shopProducts",
                        item.productId
                    );

                    const productSnapshot = await transaction.get(productRef);

                    productReads.push({
                        item,
                        productRef,
                        productSnapshot
                    });
                }

                for (const { item, productRef, productSnapshot } of productReads) {
                    if (!productSnapshot.exists()) {
                        throw new Error(
                            `${item.productName || "A product"} no longer exists.`
                        );
                    }

                    const product = productSnapshot.data();
                    const stock = Number(product.stock || 0);
                    const quantity = Number(item.quantity || 0);

                    if (
                        !Number.isInteger(quantity) ||
                        quantity < 1 ||
                        stock < quantity
                    ) {
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
                reviewedBy: seller.uid,
                updatedAt: serverTimestamp()
            });
        });

        message.textContent = "Order marked as completed.";
        await loadOrders();
    } catch (error) {
        console.error("Could not complete order:", error);
        alert(error.message || "Could not complete this order.");
        completeButton.disabled = false;
        rejectButton.disabled = false;
        message.textContent = "";
    }
}

async function rejectOrder(order, rejectButton, completeButton) {
    const reason = prompt(
        `Reason for rejecting “${order.productName || "this order"}” (optional):`,
        ""
    );

    if (reason === null) return;

    rejectButton.disabled = true;
    completeButton.disabled = true;
    message.textContent = "Rejecting order and restoring stock…";

    try {
        const orderRef = doc(db, "users", seller.uid, "orders", order.id);

        await runTransaction(db, async transaction => {
            const orderSnapshot = await transaction.get(orderRef);

            if (!orderSnapshot.exists()) {
                throw new Error("This order no longer exists.");
            }

            const latestOrder = {
                id: orderSnapshot.id,
                ...orderSnapshot.data()
            };

            if (normalizedStatus(latestOrder.status) !== "order_sent") {
                throw new Error("This order has already been reviewed.");
            }

            const latestItems = getOrderItems(latestOrder);
            const productReads = [];

            // Only new orders have already reserved stock.
            if (latestOrder.stockReserved === true) {
                for (const item of latestItems) {
                    if (!item.productId) {
                        throw new Error("An ordered product ID is missing.");
                    }

                    const productRef = doc(
                        db,
                        "users",
                        seller.uid,
                        "shopProducts",
                        item.productId
                    );

                    const productSnapshot = await transaction.get(productRef);

                    const reservationId =
                        item.reservationId || `${latestOrder.id}_${item.productId}`;

                    const reservationRef = doc(
                        db,
                        "users",
                        seller.uid,
                        "stockReservations",
                        reservationId
                    );

                    const reservationSnapshot = await transaction.get(reservationRef);

                    productReads.push({
                        item,
                        productRef,
                        productSnapshot,
                        reservationRef,
                        reservationSnapshot
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
                        throw new Error(
                            `${item.productName || "A product"} no longer exists.`
                        );
                    }

                    const currentStock = Number(productSnapshot.data().stock || 0);
                    const quantity = Number(item.quantity || 0);

                    if (!Number.isInteger(quantity) || quantity < 1) {
                        throw new Error("An ordered quantity is invalid.");
                    }

                    // Restore only reservations that have not already been released.
                    if (
                        !reservationSnapshot.exists() ||
                        reservationSnapshot.data().status === "reserved"
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
                rejectionReason: reason.trim().slice(0, 300),
                stockRestored: latestOrder.stockReserved === true,
                reviewedAt: serverTimestamp(),
                reviewedBy: seller.uid,
                updatedAt: serverTimestamp()
            });
        });

        message.textContent = "Order rejected. Reserved stock was restored.";
        await loadOrders();
    } catch (error) {
        console.error("Could not reject order:", error);
        alert(error.message || "Could not reject this order.");
        rejectButton.disabled = false;
        completeButton.disabled = false;
        message.textContent = "";
    }
}

const pendingLabel = pendingCount?.parentElement?.querySelector("span");
const approvedLabel = approvedCount?.parentElement?.querySelector("span");
if (pendingLabel) pendingLabel.textContent = "Order Sent";
if (approvedLabel) approvedLabel.textContent = "Completed";

filters.forEach(button => {
    if (button.dataset.filter === "pending_verification") {
        button.dataset.filter = "order_sent";
        button.textContent = "Order Sent";
    } else if (button.dataset.filter === "approved") {
        button.dataset.filter = "completed";
        button.textContent = "Completed";
    }

    button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        filters.forEach(item => item.classList.toggle("active", item === button));
        renderOrders();
    });
});
refreshButton.addEventListener("click", loadOrders);
closeProofButton.addEventListener("click", closeProof);
proofModal.querySelector("[data-close-proof]").addEventListener("click", closeProof);
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !proofModal.hidden) closeProof();
});

(async function initializeOrders() {
    try {
        seller = await authReady;
        if (!seller || seller.isAnonymous) throw new Error("Sign in with your seller account to view orders.");
        backToProfile.href = `profile.html?id=${encodeURIComponent(seller.uid)}`;
        await loadOrders();
        loading.hidden = true;
        workspace.hidden = false;
    } catch (error) {
        console.error("Could not open orders:", error);
        loading.hidden = true;
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Could not open customer orders.";
    }
})();
