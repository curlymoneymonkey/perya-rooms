import { authReady, db } from "./firebase.js";

import {
    collectionGroup,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const ordersList = document.getElementById("ordersList");
const ordersMessage = document.getElementById("ordersMessage");
const refreshOrdersButton = document.getElementById("refreshOrdersButton");
const filters = [...document.querySelectorAll("[data-filter]")];
const pendingCount = document.getElementById("pendingCount");
const completedCount = document.getElementById("completedCount");
const rejectedCount = document.getElementById("rejectedCount");
const allCount = document.getElementById("allCount");

let orders = [];
let activeFilter = "order_sent";

const STATUS_DETAILS = {
    order_sent: {
        label: "Order Sent",
        className: "statusPending",
        icon: "📦"
    },
    completed: {
        label: "Completed",
        className: "statusCompleted",
        icon: "✓"
    },
    rejected: {
        label: "Rejected",
        className: "statusRejected",
        icon: "✕"
    }
};

function normalizeStatus(status) {
    if (!status || status === "pending_verification") return "order_sent";
    if (status === "approved") return "completed";
    return String(status);
}

function formatMoney(value) {
    return `₱${Number(value || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function formatDate(timestamp) {
    if (!timestamp?.toDate) return "Date unavailable";

    return timestamp.toDate().toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function getStatusDetails(status) {
    return STATUS_DETAILS[normalizeStatus(status)] || STATUS_DETAILS.order_sent;
}

function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}

function createDetail(label, value) {
    const detail = document.createElement("div");
    detail.className = "orderDetail";

    detail.append(
        createTextElement("span", "orderDetailLabel", label),
        createTextElement("strong", "orderDetailValue", value)
    );

    return detail;
}

function getItems(order) {
    if (Array.isArray(order.items) && order.items.length) {
        return order.items;
    }

    return [{
        productName: order.productName || "Marketplace product",
        quantity: Number(order.quantity || 0),
        price: Number(order.price || 0),
        subtotal: Number(order.totalAmount || 0),
        imageUrl: order.imageUrl || ""
    }];
}

function createOrderItems(order) {
    const itemsContainer = document.createElement("div");
    itemsContainer.className = "orderItems";

    getItems(order).forEach(item => {
        const row = document.createElement("div");
        row.className = "orderItemRow myOrderItemRow";

        const itemMain = document.createElement("div");
        itemMain.className = "myOrderItemMain";

        if (item.imageUrl) {
            const image = document.createElement("img");
            image.className = "myOrderItemImage";
            image.src = item.imageUrl;
            image.alt = item.productName || "Product";
            image.loading = "lazy";
            image.decoding = "async";
            image.fetchPriority = "low";
            itemMain.appendChild(image);
        }

        const itemText = document.createElement("div");
        itemText.className = "myOrderItemText";
        itemText.append(
            createTextElement("strong", "orderItemName", item.productName || "Product"),
            createTextElement(
                "span",
                "myOrderItemMeta",
                `${Number(item.quantity || 0)} × ${formatMoney(item.price)}`
            )
        );

        itemMain.appendChild(itemText);

        const subtotal = item.subtotal ??
            Number(item.price || 0) * Number(item.quantity || 0);

        row.append(
            itemMain,
            createTextElement("strong", "myOrderItemSubtotal", formatMoney(subtotal))
        );

        itemsContainer.appendChild(row);
    });

    return itemsContainer;
}

function createOrderNote(title, value, type = "") {
    const note = document.createElement("div");
    note.className = `orderNote${type ? ` ${type}` : ""}`;

    note.append(
        createTextElement("strong", "orderNoteTitle", title),
        createTextElement("p", "orderNoteText", value)
    );

    return note;
}

function createOrderCard(order) {
    const card = document.createElement("article");
    card.className = "orderCard myOrderCard";

    const header = document.createElement("div");
    header.className = "orderCardHeader myOrderCardHeader";

    const titleGroup = document.createElement("div");
    titleGroup.className = "orderTitleGroup";

    const orderTitle = order.displayOrderId
        ? `Order ${order.displayOrderId}`
        : `Order #${String(order.id || "").slice(0, 8).toUpperCase()}`;

    titleGroup.append(
        createTextElement("h2", "orderTitle", orderTitle),
        createTextElement("time", "orderDate", formatDate(order.createdAt))
    );

    const statusDetails = getStatusDetails(order.status);
    const status = createTextElement(
        "span",
        `orderStatus ${normalizeStatus(order.status)} ${statusDetails.className}`,
        `${statusDetails.icon} ${statusDetails.label}`
    );

    header.append(titleGroup, status);

    const body = document.createElement("div");
    body.className = "orderCardBody myOrderCardBody";

    const details = document.createElement("div");
    details.className = "orderDetailsGrid";
    details.append(
        createDetail("Total", formatMoney(order.totalAmount)),
        createDetail("In-Game Name", order.buyerUsername || "Not provided"),
        createDetail("Payment", String(order.paymentMethod || "Not provided").toUpperCase()),
        createDetail("Reference", order.paymentReferenceNumber || "Not provided")
    );

    body.append(createOrderItems(order), details);
    card.append(header, body);

    if (order.deliveryProofUrl) {
        const proofLink = document.createElement("a");
        proofLink.className = "ordersButton myOrdersProofLink";
        proofLink.href = order.deliveryProofUrl;
        proofLink.target = "_blank";
        proofLink.rel = "noopener noreferrer";
        proofLink.textContent = "↗ View Delivery Proof";
        const footer = document.createElement("div");
        footer.className = "myOrderCardFooter";
        footer.appendChild(proofLink);
        card.appendChild(footer);
    }

    if (order.deliveryNotes) {
        card.appendChild(
            createOrderNote("Delivery Notes", order.deliveryNotes)
        );
    }

    if (normalizeStatus(order.status) === "rejected" && order.rejectionReason) {
        card.appendChild(
            createOrderNote(
                "Rejection Reason",
                order.rejectionReason,
                "orderNoteRejected"
            )
        );
    }

    return card;
}

function updateCounts() {
    pendingCount.textContent = String(orders.filter(order => normalizeStatus(order.status) === "order_sent").length);
    completedCount.textContent = String(orders.filter(order => normalizeStatus(order.status) === "completed").length);
    rejectedCount.textContent = String(orders.filter(order => normalizeStatus(order.status) === "rejected").length);
    allCount.textContent = String(orders.length);
}

function renderOrders() {
    const visibleOrders = activeFilter === "all"
        ? orders
        : orders.filter(order => normalizeStatus(order.status) === activeFilter);

    if (!visibleOrders.length) {
        const emptyState = document.createElement("div");
        emptyState.className = "ordersEmpty myOrdersState";

        const emptyTitle = orders.length ? `No ${activeFilter.replace("_", " ")} orders` : "No orders yet";
        const emptyText = orders.length
            ? "Choose another status to view your other purchases."
            : "Your purchases will appear here after you send an order to a seller.";

        emptyState.append(
            createTextElement("div", "ordersEmptyIcon", orders.length ? "📭" : "🛍️"),
            createTextElement("h2", "ordersEmptyTitle", emptyTitle),
            createTextElement("p", "ordersEmptyText", emptyText)
        );

        if (!orders.length) {
            const link = createTextElement("a", "myOrdersStateButton", "Return to Dashboard");
            link.href = "dashboard.html";
            emptyState.appendChild(link);
        }

        ordersList.replaceChildren(emptyState);
        return;
    }

    const fragment = document.createDocumentFragment();
    visibleOrders.forEach(order => fragment.appendChild(createOrderCard(order)));
    ordersList.replaceChildren(fragment);
}

function readableOrderError(error) {
    const message = String(error?.message || "");
    const code = String(error?.code || "");

    if (
        code === "failed-precondition" ||
        message.includes("index is not ready yet") ||
        message.includes("requires a COLLECTION_GROUP")
    ) {
        return {
            title: "Orders are being prepared",
            message:
                "The order database index is still building. This is temporary. Try again in a few minutes.",
            retry: true
        };
    }

    if (code === "permission-denied") {
        return {
            title: "Orders are unavailable",
            message:
                "Your account does not currently have permission to read these orders.",
            retry: true
        };
    }

    return {
        title: "Unable to load orders",
        message: "Please check your connection and try again.",
        retry: true
    };
}

function renderErrorState(error) {
    const details = readableOrderError(error);
    const errorState = document.createElement("div");
    errorState.className = "ordersEmpty ordersError myOrdersState";

    errorState.append(
        createTextElement("div", "ordersEmptyIcon", "⚠️"),
        createTextElement("h2", "ordersEmptyTitle", details.title),
        createTextElement("p", "ordersEmptyText", details.message)
    );

    if (details.retry) {
        const retryButton = createTextElement(
            "button",
            "myOrdersStateButton",
            "Try Again"
        );
        retryButton.type = "button";
        retryButton.addEventListener("click", loadOrders);
        errorState.appendChild(retryButton);
    }

    ordersList.replaceChildren(errorState);
}

async function loadOrders() {
    ordersList.setAttribute("aria-busy", "true");
    refreshOrdersButton.disabled = true;
    ordersMessage.textContent = "Loading your orders…";

    try {
        const user = await authReady;

        if (!user || user.isAnonymous) {
            throw new Error("Sign in with Google to view your orders.");
        }

        const ordersQuery = query(
            collectionGroup(db, "orders"),
            where("buyerUid", "==", user.uid)
        );

        const snapshot = await getDocs(ordersQuery);

        orders = snapshot.docs
            .map(documentSnapshot => ({
                id: documentSnapshot.id,
                ...documentSnapshot.data()
            }))
            .sort((first, second) => (
                (second.createdAt?.toMillis?.() || 0)
                - (first.createdAt?.toMillis?.() || 0)
            ));

        updateCounts();
        renderOrders();
        ordersMessage.textContent = `${orders.length} order${orders.length === 1 ? "" : "s"}`;
    } catch (error) {
        console.error("Could not load orders:", error);
        const details = readableOrderError(error);
        ordersMessage.textContent = details.title;
        renderErrorState(error);
    } finally {
        ordersList.setAttribute("aria-busy", "false");
        refreshOrdersButton.disabled = false;
    }
}

filters.forEach(button => {
    button.addEventListener("click", () => {
        activeFilter = button.dataset.filter || "all";
        filters.forEach(filter => filter.classList.toggle("active", filter === button));
        renderOrders();
    });
});

refreshOrdersButton?.addEventListener("click", loadOrders);
loadOrders();
