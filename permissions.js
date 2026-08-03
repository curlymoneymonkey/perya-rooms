import { db } from "./firebase.js";
import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

function hasActiveVip(userData) {
    if (userData?.vip !== true) return false;

    const expiresAt = userData.vipExpiresAt;
    if (!expiresAt) return true;

    const expirationMilliseconds = expiresAt?.toMillis?.()
        ?? expiresAt?.toDate?.().getTime?.()
        ?? new Date(expiresAt).getTime();

    return Number.isFinite(expirationMilliseconds)
        && expirationMilliseconds > Date.now();
}

export async function isEnabledAdmin(user) {
    if (!user || user.isAnonymous) return false;
    const snapshot = await getDoc(doc(db, "admins", user.uid));
    return snapshot.exists() && snapshot.data().enabled === true;
}

export async function isEnabledModerator(user) {
    if (!user || user.isAnonymous) return false;
    const snapshot = await getDoc(doc(db, "moderators", user.uid));
    return snapshot.exists() && snapshot.data().enabled === true;
}

export async function getUserRole(uid) {
    if (!uid) {
        return {
            role: "user",
            label: "User",
            isAdmin: false,
            isHeadAdmin: false,
            isModerator: false,
            isVip: false
        };
    }

    const [adminSnapshot, moderatorSnapshot, userSnapshot] = await Promise.all([
        getDoc(doc(db, "admins", uid)),
        getDoc(doc(db, "moderators", uid)),
        getDoc(doc(db, "users", uid))
    ]);

    const isAdmin = adminSnapshot.exists()
        && adminSnapshot.data().enabled === true;
    const isModerator = moderatorSnapshot.exists()
        && moderatorSnapshot.data().enabled === true;
    const isVip = hasActiveVip(userSnapshot.exists() ? userSnapshot.data() : null);

    if (isAdmin) {
        const isHeadAdmin = adminSnapshot.data().role === "head-admin";
        return {
            role: isHeadAdmin ? "head-admin" : "admin",
            label: isHeadAdmin ? "Head Administrator" : "Administrator",
            isAdmin,
            isHeadAdmin,
            isModerator,
            isVip: true
        };
    }

    if (isModerator) {
        return { role: "moderator", label: "Moderator", isAdmin, isModerator, isVip: true };
    }

    if (isVip) {
        return { role: "vip", label: "VIP", isAdmin, isModerator, isVip };
    }

    return { role: "user", label: "User", isAdmin, isModerator, isVip: false };
}

export async function getStaffAccess(user) {
    if (!user || user.isAnonymous) {
        return {
            role: "user",
            isAdmin: false,
            isHeadAdmin: false,
            isModerator: false,
            isVip: false,
            canModerateReviews: false
        };
    }

    const access = await getUserRole(user.uid);
    return {
        role: access.role,
        isAdmin: access.isAdmin,
        isHeadAdmin: access.isHeadAdmin === true,
        isModerator: access.isModerator,
        isVip: access.isVip,
        canModerateReviews: access.isAdmin || access.isModerator
    };
}
