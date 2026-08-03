import { auth, db, realtimeDb, waitForAuthState } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {
  ref,
  set,
  update,
  onDisconnect,
  onValue,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const SESSION_KEY = 'pdo_presence_session_id';
const HEARTBEAT_MS = 25000;

function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function getDeviceType() {
  const ua = navigator.userAgent || '';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  if (/mobile|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getPageLabel() {
  const file = location.pathname.split('/').pop() || 'index.html';
  const labels = {
    'index.html': 'Home',
    'dashboard.html': 'Dashboard',
    'room.html': 'Room',
    'pdo_hub.html': 'PDO Hub',
    'pdo_control.html': 'User & Room Control',
    'pdo_workspace.html': 'Moderation Workspace',
    'review_queue.html': 'Review Queue',
    'pdo_console.html': 'Activity Console'
  };
  return labels[file] || file.replace(/\.html$/i, '').replace(/[-_]/g, ' ');
}

function getRoomId() {
  const params = new URLSearchParams(location.search);
  return params.get('roomId') || params.get('id') || params.get('diceId') || '';
}

async function getProfile(user) {
  const fallback = {
    username: user.displayName || user.email?.split('@')[0] || 'User',
    photoURL: user.photoURL || '',
    country: '',
    region: '',
    city: ''
  };

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return fallback;
    const data = snap.data();
    return {
      username: data.username || data.displayName || fallback.username,
      photoURL: data.photoURL || fallback.photoURL,
      country: data.country || data.locationCountry || '',
      region: data.region || data.locationRegion || '',
      city: data.city || data.locationCity || ''
    };
  } catch (error) {
    console.warn('Presence profile lookup failed:', error);
    return fallback;
  }
}

async function getRole(user) {
  try {
    const [adminSnap, moderatorSnap, userSnap] = await Promise.all([
      getDoc(doc(db, 'admins', user.uid)),
      getDoc(doc(db, 'moderators', user.uid)),
      getDoc(doc(db, 'users', user.uid))
    ]);

    if (adminSnap.exists() && adminSnap.data().enabled === true) {
      return adminSnap.data().role === 'head-admin' ? 'head-admin' : 'admin';
    }
    if (moderatorSnap.exists() && moderatorSnap.data().enabled === true) return 'moderator';
    if (userSnap.exists() && userSnap.data().vip === true) return 'vip';
  } catch (error) {
    console.warn('Presence role lookup failed:', error);
  }
  return 'user';
}

export async function startPresence() {
  const user = auth.currentUser || await waitForAuthState();
  if (!user) return null;

  const sessionId = getSessionId();
  const sessionRef = ref(realtimeDb, `presenceSessions/${user.uid}/${sessionId}`);
  const connectedRef = ref(realtimeDb, '.info/connected');
  const [profile, role] = await Promise.all([getProfile(user), getRole(user)]);

  const baseData = {
    uid: user.uid,
    sessionId,
    username: profile.username,
    photoURL: profile.photoURL,
    role,
    page: getPageLabel(),
    path: location.pathname,
    roomId: getRoomId(),
    device: getDeviceType(),
    country: profile.country || 'Unknown',
    region: profile.region || '',
    city: profile.city || '',
    online: true,
    startedAt: serverTimestamp(),
    lastSeen: serverTimestamp()
  };

  let heartbeatId = null;
  const unsubscribe = onValue(connectedRef, async (snapshot) => {
    if (snapshot.val() !== true) return;

    await onDisconnect(sessionRef).remove();
    await set(sessionRef, baseData);

    clearInterval(heartbeatId);
    heartbeatId = setInterval(() => {
      update(sessionRef, {
        page: getPageLabel(),
        path: location.pathname,
        roomId: getRoomId(),
        lastSeen: serverTimestamp(),
        online: true
      }).catch((error) => console.warn('Presence heartbeat failed:', error));
    }, HEARTBEAT_MS);
  });

  const stop = async () => {
    clearInterval(heartbeatId);
    unsubscribe();
    try { await set(sessionRef, null); } catch (_) {}
  };

  window.addEventListener('pagehide', stop, { once: true });
  return { sessionId, stop };
}

startPresence().catch((error) => console.warn('Presence did not start:', error));
