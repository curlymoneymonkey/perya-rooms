import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInAnonymously,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    getDatabase
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import {
    getStorage
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

import {
    getFunctions
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyCj53KgeEPfa3q9u_zEKEYZPedK5TVNK0Q",
    authDomain: "peryadice.firebaseapp.com",
    databaseURL: "https://peryadice-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "peryadice",
    storageBucket: "peryadice.firebasestorage.app",
    messagingSenderId: "871819732352",
    appId: "1:871819732352:web:d2c47bbb81839274ff8d65",
    measurementId: "G-KY07J1J3VL"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const realtimeDb = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "asia-southeast1");
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: "select_account" });

export function waitForAuthState() {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
            auth,
            user => {
                unsubscribe();
                resolve(user);
            },
            error => {
                unsubscribe();
                reject(error);
            }
        );
    });
}

export async function ensureGuestUser() {
    const existingUser = auth.currentUser || await waitForAuthState();

    if (existingUser) {
        return existingUser;
    }

    const result = await signInAnonymously(auth);
    return result.user;
}

export async function requireRegisteredUser() {
    const user = auth.currentUser || await waitForAuthState();

    if (!user || user.isAnonymous) {
        throw new Error("Sign in with your Google seller account first.");
    }

    return user;
}

export async function signInWithGoogle() {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
}

export async function logOut() {
    await signOut(auth);
}

// Existing pages can continue importing authReady.
// It resolves to the currently persisted account, or creates a guest only
// when no Firebase account is signed in.
export const authReady = ensureGuestUser();
