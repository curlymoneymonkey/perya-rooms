import { authReady, db } from "./firebase.js";
import { getStaffAccess } from "./permissions.js";

import {
    collectionGroup,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    Timestamp,
    updateDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

/* ==================================
   ELEMENTS
================================== */

const accessChecking = document.getElementById("accessChecking");
const accessDenied = document.getElementById("accessDenied");
const reviewQueuePanel = document.getElementById("reviewQueuePanel");

const requestList = document.getElementById("requestList");
const queueSummary = document.getElementById("queueSummary");
const queueMessage = document.getElementById("queueMessage");

const pendingCount = document.getElementById("pendingCount");
const approvedCount = document.getElementById("approvedCount");
const rejectedCount = document.getElementById("rejectedCount");
const totalCount = document.getElementById("totalCount");

const showPendingButton = document.getElementById("showPendingButton");
const showAllButton = document.getElementById("showAllButton");
const refreshQueueButton = document.getElementById("refreshQueueButton");

const decisionModal = document.getElementById("decisionModal");
const closeDecisionModalButton = document.getElementById("closeDecisionModalButton");
const decisionRequestDetails = document.getElementById("decisionRequestDetails");
const moderatorNoteInput = document.getElementById("moderatorNoteInput");
const moderatorNoteCount = document.getElementById("moderatorNoteCount");
const decisionMessage = document.getElementById("decisionMessage");
const rejectRequestButton = document.getElementById("rejectRequestButton");
const approveRemovalButton = document.getElementById("approveRemovalButton");

/* ==================================
   STATE
================================== */

let currentAdmin = null;
let removalRequests = [];
let activeFilter = "pending";
let selectedRequest = null;

const reasonLabels = {
    false_information: "False information",
    harassment: "Harassment or abusive language",
    spam: "Spam or promotional content",
    impersonation: "Impersonation",
    personal_information: "Personal information",
    other: "Other policy violation"
};

/* ==================================
   HELPERS
================================== */

function cleanText(value, fallback = "") {
    const cleaned = String(value ?? "").trim();
    return cleaned || fallback;
}

function formatDate(timestamp) {
    if (!timestamp?.toDate) {
        return "Timestamp unavailable";
    }

    return timestamp.toDate().toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function statusLabel(status) {
    if (status === "approved") return "Approved";
    if (status === "rejected") return "Rejected";
    return "Pending";
}

function statusIcon(status) {
    if (status === "approved") return "✓";
    if (status === "rejected") return "×";
    return "⌛";
}

function setQueueMessage(message, isError = false) {
    queueMessage.textContent = message;
    queueMessage.classList.toggle("errorMessage", isError);
}

function setDecisionMessage(message, isError = false) {
    decisionMessage.textContent = message;
    decisionMessage.classList.toggle("errorMessage", isError);
}

function sortNewestFirst(items) {
    return [...items].sort((first, second) => {
        const firstTime = first.createdAt?.toMillis?.() || 0;
        const secondTime = second.createdAt?.toMillis?.() || 0;
        return secondTime - firstTime;
    });
}

function setDecisionButtonsDisabled(disabled) {
    approveRemovalButton.disabled = disabled;
    rejectRequestButton.disabled = disabled;
}

function createMetaItem(label, value) {
    const item = document.createElement("div");
    item.className = "requestMetaItem";

    const labelElement = document.createElement("span");
    labelElement.className = "requestMetaLabel";
    labelElement.textContent = label;

    const valueElement = document.createElement("strong");
    valueElement.className = "requestMetaValue";
    valueElement.textContent = cleanText(value, "Unavailable");
    valueElement.title = cleanText(value, "Unavailable");

    item.append(labelElement, valueElement);
    return item;
}

function updateStatistics() {
    const pending = removalRequests.filter(request => request.status === "pending").length;
    const approved = removalRequests.filter(request => request.status === "approved").length;
    const rejected = removalRequests.filter(request => request.status === "rejected").length;

    pendingCount.textContent = String(pending);
    approvedCount.textContent = String(approved);
    rejectedCount.textContent = String(rejected);
    totalCount.textContent = String(removalRequests.length);
}

function setActiveFilter(filter) {
    activeFilter = filter;

    const pendingActive = filter === "pending";

    showPendingButton.classList.toggle("active", pendingActive);
    showPendingButton.setAttribute("aria-selected", String(pendingActive));

    showAllButton.classList.toggle("active", !pendingActive);
    showAllButton.setAttribute("aria-selected", String(!pendingActive));

    renderQueue();
}

/* ==================================
   RENDER QUEUE
================================== */

function renderQueue() {
    requestList.innerHTML = "";

    const visibleRequests =
        activeFilter === "pending"
            ? removalRequests.filter(request => request.status === "pending")
            : removalRequests;

    queueSummary.textContent =
        `${visibleRequests.length} ` +
        `${visibleRequests.length === 1 ? "request" : "requests"} shown`;

    if (visibleRequests.length === 0) {
        const emptyNotice = document.createElement("div");
        emptyNotice.className = "reviewQueueNotice queueEmptyState";

        const icon = document.createElement("div");
        icon.className = "queueEmptyIcon";
        icon.textContent = activeFilter === "pending" ? "✓" : "🛡️";

        const title = document.createElement("h2");
        title.textContent =
            activeFilter === "pending"
                ? "Queue is clear"
                : "No requests found";

        const description = document.createElement("p");
        description.textContent =
            activeFilter === "pending"
                ? "There are no pending removal requests."
                : "No vouch removal requests have been submitted yet.";

        emptyNotice.append(icon, title, description);
        requestList.appendChild(emptyNotice);
        return;
    }

    sortNewestFirst(visibleRequests).forEach(request => {
        const requestStatus = request.status || "pending";

        const card = document.createElement("article");
        card.className = `removalRequestCard removalRequestCard-${requestStatus}`;

        const header = document.createElement("div");
        header.className = "removalRequestCardHeader";

        const titleGroup = document.createElement("div");
        titleGroup.className = "requestTitleGroup";

        const eyebrow = document.createElement("span");
        eyebrow.className = "requestCardEyebrow";
        eyebrow.textContent = "REMOVAL REQUEST";

        const heading = document.createElement("h2");
        heading.textContent =
            reasonLabels[request.reason] || "Policy review";

        titleGroup.append(eyebrow, heading);

        const status = document.createElement("span");
        status.className = `requestStatus requestStatus-${requestStatus}`;
        status.textContent = `${statusIcon(requestStatus)} ${statusLabel(requestStatus)}`;

        header.append(titleGroup, status);

        const meta = document.createElement("div");
        meta.className = "requestMetaGrid";
        meta.append(
            createMetaItem("Host UID", request.hostUid),
            createMetaItem("Reviewer UID", request.reviewerUid),
            createMetaItem("Room ID", request.roomId),
            createMetaItem("Submitted", formatDate(request.createdAt))
        );

        const contentGrid = document.createElement("div");
        contentGrid.className = "requestContentGrid";

        const vouchSection = document.createElement("section");
        vouchSection.className = "requestContentPanel";

        const vouchLabel = document.createElement("span");
        vouchLabel.className = "requestSectionLabel";
        vouchLabel.textContent = "Original vouch";

        const originalVouch = document.createElement("blockquote");
        originalVouch.className = "requestVouchPreview";

        const vote =
            request.vouchSnapshot?.recommend === true
                ? "👍 I Vouch"
                : "👎 I Don't Vouch";

        const reviewerName = cleanText(
            request.vouchSnapshot?.username,
            "Player"
        );

        const reviewText = cleanText(
            request.vouchSnapshot?.review,
            "No written comment."
        );

        originalVouch.textContent =
            `${vote}\n${reviewerName}: ${reviewText}`;

        vouchSection.append(vouchLabel, originalVouch);

        const explanationSection = document.createElement("section");
        explanationSection.className = "requestContentPanel";

        const explanationLabel = document.createElement("span");
        explanationLabel.className = "requestSectionLabel";
        explanationLabel.textContent = "Host explanation";

        const explanation = document.createElement("p");
        explanation.className = "requestDetailsText";
        explanation.textContent = cleanText(
            request.details,
            "No additional details were provided."
        );

        explanationSection.append(explanationLabel, explanation);
        contentGrid.append(vouchSection, explanationSection);

        const footer = document.createElement("div");
        footer.className = "requestCardFooter";

        if (requestStatus === "pending") {
            const reviewButton = document.createElement("button");
            reviewButton.type = "button";
            reviewButton.className = "reviewRequestButton";
            reviewButton.textContent = "Review Request";
            reviewButton.addEventListener(
                "click",
                () => openDecisionModal(request)
            );

            footer.appendChild(reviewButton);
        } else {
            const decisionInfo = document.createElement("div");
            decisionInfo.className =
                `moderatorDecisionNote moderatorDecisionNote-${requestStatus}`;

            const decisionTitle = document.createElement("strong");
            decisionTitle.textContent =
                `${statusIcon(requestStatus)} ${statusLabel(requestStatus)}`;

            const note = document.createElement("p");
            note.textContent = cleanText(
                request.moderatorNote,
                "No staff note was provided."
            );

            decisionInfo.append(decisionTitle, note);
            footer.appendChild(decisionInfo);
        }

        card.append(header, meta, contentGrid, footer);
        requestList.appendChild(card);
    });
}

/* ==================================
   LOAD REQUESTS
================================== */

async function loadRequests() {
    refreshQueueButton.disabled = true;
    refreshQueueButton.textContent = "Refreshing…";
    setQueueMessage("Loading removal requests…");

    try {
        const snapshot = await getDocs(
            collectionGroup(db, "vouchRemovalRequests")
        );

        removalRequests = snapshot.docs.map(documentSnapshot => ({
            id: documentSnapshot.id,
            ref: documentSnapshot.ref,
            path: documentSnapshot.ref.path,
            ...documentSnapshot.data()
        }));

        updateStatistics();
        setQueueMessage("");
        renderQueue();
    } catch (error) {
        console.error("Could not load removal requests:", error);

        setQueueMessage(
            "Could not load removal requests. Check your Firestore rules and ensure your admin document has enabled: true.",
            true
        );
    } finally {
        refreshQueueButton.disabled = false;
        refreshQueueButton.textContent = "↻ Refresh";
    }
}

/* ==================================
   DECISION MODAL
================================== */

function openDecisionModal(request) {
    selectedRequest = request;

    moderatorNoteInput.value = "";
    moderatorNoteCount.textContent = "0 / 500";
    setDecisionMessage("");

    decisionRequestDetails.innerHTML = "";

    const summary = document.createElement("div");
    summary.className = "decisionSummary";

    const reasonRow = document.createElement("div");
    reasonRow.className = "decisionSummaryRow";

    const reasonLabel = document.createElement("span");
    reasonLabel.textContent = "Reason";

    const reasonValue = document.createElement("strong");
    reasonValue.textContent =
        reasonLabels[request.reason] ||
        cleanText(request.reason, "Unknown");

    reasonRow.append(reasonLabel, reasonValue);

    const explanationBlock = document.createElement("div");
    explanationBlock.className = "decisionSummaryBlock";

    const explanationLabel = document.createElement("span");
    explanationLabel.textContent = "Host explanation";

    const explanationValue = document.createElement("p");
    explanationValue.textContent = cleanText(
        request.details,
        "No additional details."
    );

    explanationBlock.append(explanationLabel, explanationValue);

    const originalBlock = document.createElement("div");
    originalBlock.className = "decisionSummaryBlock";

    const originalLabel = document.createElement("span");
    originalLabel.textContent = "Original vouch";

    const originalVouch = document.createElement("blockquote");
    originalVouch.className = "requestVouchPreview";

    const vote =
        request.vouchSnapshot?.recommend === true
            ? "👍 I Vouch"
            : "👎 I Don't Vouch";

    originalVouch.textContent =
        `${vote}\n` +
        `${cleanText(request.vouchSnapshot?.username, "Player")}: ` +
        `${cleanText(request.vouchSnapshot?.review, "No written comment.")}`;

    originalBlock.append(originalLabel, originalVouch);
    summary.append(reasonRow, explanationBlock, originalBlock);
    decisionRequestDetails.appendChild(summary);

    decisionModal.hidden = false;
    document.body.classList.add("modalOpen");
}

function closeDecisionModal() {
    decisionModal.hidden = true;
    selectedRequest = null;
    setDecisionMessage("");
    document.body.classList.remove("modalOpen");
}

/* ==================================
   APPROVE OR REJECT
================================== */

async function decideRequest(decision) {
    if (!selectedRequest || selectedRequest.status !== "pending") {
        return;
    }

    const approving = decision === "approved";

    const confirmed = window.confirm(
        approving
            ? "Approve this request and permanently remove the vouch?"
            : "Reject this request and keep the vouch visible?"
    );

    if (!confirmed) {
        return;
    }

    setDecisionButtonsDisabled(true);
    setDecisionMessage(
        approving ? "Removing vouch…" : "Rejecting request…"
    );

    try {
        if (approving) {
            const fallbackPath =
                `users/${selectedRequest.hostUid}/reviews/${selectedRequest.reviewerUid}`;

            const storedPath = cleanText(
                selectedRequest.vouchPath,
                fallbackPath
            );

            const pathParts = storedPath
                .split("/")
                .filter(Boolean);

            if (
                pathParts.length !== 4 ||
                pathParts[0] !== "users" ||
                pathParts[2] !== "reviews"
            ) {
                throw new Error("INVALID_VOUCH_PATH");
            }

            const vouchReference = doc(db, ...pathParts);
            const vouchSnapshot = await getDoc(vouchReference);

            if (!vouchSnapshot.exists()) {
                throw new Error("VOUCH_NOT_FOUND");
            }

            const cooldownReference = doc(
                db,
                "users",
                selectedRequest.hostUid,
                "vouchCooldowns",
                selectedRequest.reviewerUid
            );

            const blockedUntil = Timestamp.fromMillis(
                Date.now() + (7 * 24 * 60 * 60 * 1000)
            );

            const batch = writeBatch(db);

            batch.delete(vouchReference);

            batch.set(cooldownReference, {
                hostUid: selectedRequest.hostUid,
                reviewerUid: selectedRequest.reviewerUid,
                blockedUntil,
                createdAt: serverTimestamp(),
                createdBy: currentAdmin.uid,
                sourceRequestPath: selectedRequest.path || selectedRequest.ref.path
            });

            batch.delete(selectedRequest.ref);

            await batch.commit();
        } else {
            await updateDoc(selectedRequest.ref, {
                status: "rejected",
                moderatorUid: currentAdmin.uid,
                moderatorNote: moderatorNoteInput.value.trim().slice(0, 500),
                reviewedAt: serverTimestamp()
            });
        }

        closeDecisionModal();
        await loadRequests();
    } catch (error) {
        console.error("Could not save moderation decision:", error);

        if (error.message === "VOUCH_NOT_FOUND") {
            setDecisionMessage(
                "The original vouch could not be found. The request was not approved.",
                true
            );
        } else if (error.message === "INVALID_VOUCH_PATH") {
            setDecisionMessage(
                "The saved vouch path is invalid. The request was not approved.",
                true
            );
        } else {
            setDecisionMessage(
                "The decision could not be saved. Check your Firestore rules.",
                true
            );
        }
    } finally {
        setDecisionButtonsDisabled(false);
    }
}

/* ==================================
   INITIALIZE
================================== */

async function initialize() {
    try {
        currentAdmin = await authReady;

        if (!currentAdmin || currentAdmin.isAnonymous) {
            throw new Error("No registered account is signed in.");
        }

        const access = await getStaffAccess(currentAdmin);

        if (!access.canModerateReviews) {
            throw new Error(
                "This account is not enabled as an administrator or moderator."
            );
        }

        accessChecking.hidden = true;
        accessDenied.hidden = true;
        reviewQueuePanel.hidden = false;

        await loadRequests();
    } catch (error) {
        console.error("Staff access denied:", error);

        accessChecking.hidden = true;
        reviewQueuePanel.hidden = true;
        accessDenied.hidden = false;
    }
}

/* ==================================
   EVENTS
================================== */

showPendingButton.addEventListener(
    "click",
    () => setActiveFilter("pending")
);

showAllButton.addEventListener(
    "click",
    () => setActiveFilter("all")
);

refreshQueueButton.addEventListener("click", loadRequests);

closeDecisionModalButton.addEventListener(
    "click",
    closeDecisionModal
);

decisionModal
    .querySelector("[data-close-decision-modal]")
    .addEventListener("click", closeDecisionModal);

moderatorNoteInput.addEventListener("input", () => {
    moderatorNoteInput.value =
        moderatorNoteInput.value.slice(0, 500);

    moderatorNoteCount.textContent =
        `${moderatorNoteInput.value.length} / 500`;
});

rejectRequestButton.addEventListener(
    "click",
    () => decideRequest("rejected")
);

approveRemovalButton.addEventListener(
    "click",
    () => decideRequest("approved")
);

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !decisionModal.hidden) {
        closeDecisionModal();
    }
});

initialize();
