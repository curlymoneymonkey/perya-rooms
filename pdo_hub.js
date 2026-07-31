import { db, realtimeDb } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { onValue, ref } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const onlineTotal = document.getElementById('onlineTotal');
const activeRooms = document.getElementById('activeRooms');
const staffOnline = document.getElementById('staffOnline');
const vipOnline = document.getElementById('vipOnline');
const onlineRows = document.getElementById('onlineRows');
const onlineSearch = document.getElementById('onlineSearch');
const roleFilter = document.getElementById('onlineRoleFilter');
const locationRows = document.getElementById('locationRows');
const mapCanvas = document.getElementById('liveMapCanvas');
const liveUpdated = document.getElementById('liveUpdated');
const monkeyOnlineCount = document.getElementById('monkeyOnlineCount');
const monkeyOnlineRows = document.getElementById('monkeyOnlineRows');

let sessions = [];
let profileCache = new Map();

function roleLabel(role) {
  return ({
    'head-admin': 'Head Admin',
    admin: 'Admin',
    moderator: 'Moderator',
    vip: 'VIP',
    user: 'User'
  })[role] || 'User';
}

function roleRank(role) {
  return ({ 'head-admin': 5, admin: 4, moderator: 3, vip: 2, user: 1 })[role] || 0;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function timeAgo(timestamp) {
  const ms = Number(timestamp || 0);
  if (!ms) return 'Active now';
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 15) return 'Active now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function flattenPresence(value) {
  const rows = [];
  Object.entries(value || {}).forEach(([uid, userSessions]) => {
    Object.entries(userSessions || {}).forEach(([sessionId, data]) => {
      if (!data || data.online === false) return;
      rows.push({ uid, sessionId, ...data });
    });
  });
  return rows;
}

async function enrichUnknownUsers(rows) {
  const unique = [...new Set(rows.map((row) => row.uid).filter(Boolean))];
  await Promise.all(unique.map(async (uid) => {
    if (profileCache.has(uid)) return;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      profileCache.set(uid, snap.exists() ? snap.data() : {});
    } catch (_) {
      profileCache.set(uid, {});
    }
  }));

  return rows.map((row) => {
    const profile = profileCache.get(row.uid) || {};
    return {
      ...row,
      username: row.username || profile.username || profile.displayName || 'User',
      photoURL: row.photoURL || profile.photoURL || '',
      country: row.country && row.country !== 'Unknown' ? row.country : (profile.country || profile.locationCountry || 'Unknown'),
      region: row.region || profile.region || profile.locationRegion || '',
      city: row.city || profile.city || profile.locationCity || ''
    };
  });
}

function dedupeUsers(rows) {
  const byUid = new Map();
  rows.forEach((row) => {
    const existing = byUid.get(row.uid);
    if (!existing || Number(row.lastSeen || 0) > Number(existing.lastSeen || 0)) {
      byUid.set(row.uid, row);
    }
  });
  return [...byUid.values()];
}

function renderStats(users) {
  const rooms = new Set(users.map((u) => u.roomId).filter(Boolean));
  const staff = users.filter((u) => ['head-admin', 'admin', 'moderator'].includes(u.role)).length;
  const vips = users.filter((u) => u.role === 'vip').length;
  onlineTotal.textContent = users.length.toLocaleString();
  activeRooms.textContent = rooms.size.toLocaleString();
  staffOnline.textContent = staff.toLocaleString();
  vipOnline.textContent = vips.toLocaleString();
}

function isMonkeyMoneyPage(page = '') {
  const normalized = String(page)
    .trim()
    .toLowerCase()
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/+|\/+$/g, '');

  return normalized === 'imamonkeyandilovemoney.html'
    || normalized.endsWith('/imamonkeyandilovemoney.html')
    || normalized === 'imamonkeyandilovemoney';
}

function createOnlineUserRow(user) {
  const location = [user.city, user.region, user.country].filter(Boolean).join(', ');
  const avatar = user.photoURL
    ? `<img src="${escapeHtml(user.photoURL)}" alt="">`
    : `<span>${escapeHtml((user.username || 'U').slice(0, 1).toUpperCase())}</span>`;

  return `<article class="online-user-row">
    <div class="online-user-main">
      <div class="online-avatar">${avatar}<i></i></div>
      <div><strong>${escapeHtml(user.username)}</strong><span>${escapeHtml(user.uid)}</span></div>
    </div>
    <span class="online-role role-${escapeHtml(user.role)}">${escapeHtml(roleLabel(user.role))}</span>
    <div class="online-meta"><strong>${escapeHtml(user.page || 'Unknown page')}</strong><span>${user.roomId ? `Room ${escapeHtml(user.roomId)}` : 'No room'}</span></div>
    <div class="online-meta"><strong>${escapeHtml(location || 'Location unavailable')}</strong><span>${escapeHtml(user.device || 'unknown')} · ${escapeHtml(timeAgo(user.lastSeen))}</span></div>
  </article>`;
}

function renderOnlineUsers(users) {
  const query = onlineSearch.value.trim().toLowerCase();
  const role = roleFilter.value;
  const filtered = users
    .filter((user) => role === 'all' || user.role === role)
    .filter((user) => {
      if (!query) return true;
      return [user.username, user.uid, user.page, user.roomId, user.country, user.region, user.city]
        .some((value) => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => roleRank(b.role) - roleRank(a.role) || String(a.username).localeCompare(String(b.username)));

  if (!filtered.length) {
    onlineRows.innerHTML = '<div class="pdo-empty"><span class="pdo-empty-icon">○</span>No matching online users.</div>';
    return;
  }

  onlineRows.innerHTML = filtered.slice(0, 100).map(createOnlineUserRow).join('');
}

function renderMonkeyOnlineUsers(users) {
  if (!monkeyOnlineRows || !monkeyOnlineCount) return;

  monkeyOnlineCount.textContent = users.length.toLocaleString();

  if (!users.length) {
    monkeyOnlineRows.innerHTML = '<div class="pdo-empty"><span class="pdo-empty-icon">○</span>No active monkey </div>';
    return;
  }

  const sorted = [...users].sort(
    (a, b) => roleRank(b.role) - roleRank(a.role)
      || String(a.username).localeCompare(String(b.username))
  );

  monkeyOnlineRows.innerHTML = sorted.slice(0, 100).map(createOnlineUserRow).join('');
}

function renderMap(users) {
  const countries = new Map();
  users.forEach((user) => {
    const country = (user.country || 'Unknown').trim() || 'Unknown';
    countries.set(country, (countries.get(country) || 0) + 1);
  });

  const sorted = [...countries.entries()].sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;

  locationRows.innerHTML = sorted.slice(0, 10).map(([country, count]) => `
    <div class="location-row"><span>${escapeHtml(country)}</span><div><i style="width:${Math.max(8, (count / max) * 100)}%"></i></div><strong>${count}</strong></div>
  `).join('') || '<div class="pdo-empty">No location data yet.</div>';

  mapCanvas.innerHTML = sorted.slice(0, 16).map(([country, count], index) => {
    const x = 8 + ((index * 37) % 84);
    const y = 12 + ((index * 53) % 72);
    const size = Math.min(42, 14 + Math.sqrt(count) * 7);
    return `<button class="map-marker" type="button" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px" title="${escapeHtml(country)}: ${count} online"><span>${count}</span></button>`;
  }).join('');
}

function render() {
  const users = dedupeUsers(sessions);
  const monkeyUsers = users.filter((user) => isMonkeyMoneyPage(user.page));
  const generalUsers = users.filter((user) => !isMonkeyMoneyPage(user.page));

  renderStats(users);
  renderOnlineUsers(generalUsers);
  renderMonkeyOnlineUsers(monkeyUsers);
  renderMap(users);
  liveUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

onValue(ref(realtimeDb, 'presenceSessions'), async (snapshot) => {
  sessions = await enrichUnknownUsers(flattenPresence(snapshot.val()));
  render();
}, (error) => {
  console.error('Unable to load presence:', error);
  onlineRows.innerHTML = '<div class="pdo-empty"><span class="pdo-empty-icon">!</span>Presence access was denied. Check Realtime Database rules.</div>';
  if (monkeyOnlineRows) {
    monkeyOnlineRows.innerHTML = '<div class="pdo-empty"><span class="pdo-empty-icon">!</span>Presence access was denied.</div>';
  }
});

onlineSearch.addEventListener('input', render);
roleFilter.addEventListener('change', render);
