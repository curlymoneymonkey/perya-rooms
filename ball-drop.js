import { functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

/*
 * Ball Drop V3
 * Balanced six-outcome arcade board.
 *
 * Design:
 * - Firebase chooses the secure result and animation seed.
 * - Every visible route is generated completely before release.
 * - No live target steering, snapping, or teleport recovery.
 * - Host and viewers generate the same route from the same server seed.
 */

const COLORS = ["Purple", "Yellow", "Red", "Green", "Orange", "Blue"];

const startSecureBallDrop = httpsCallable(functions, "startSecureBallDrop");
const finishSecureBallDrop = httpsCallable(functions, "finishSecureBallDrop");

const game = document.getElementById("ballDropGame");
const mixer = document.getElementById("ballDropMixer");
const board = document.getElementById("ballDropBoard");
const canvas = document.getElementById("ballDropCanvas");
const button = document.getElementById("ballDropButton");
const waiting = document.getElementById("ballDropWaitingText");
const status = document.getElementById("ballDropStatus");
const historyNode = document.getElementById("ballDropHistory");

let holderBalls = [...document.querySelectorAll(".ballDropHolderBall")];
let resultNodes = [...document.querySelectorAll("#ballDropResults > span")];

let ctx = null;
let boardWidth = 0;
let boardHeight = 0;
let deviceRatio = 1;

let currentRoom = null;
let roomRef = null;
let isHost = false;

// Previous Drops is session-only for the host.
// Reloading, leaving, or re-entering starts it from "No drops yet."
let hostSessionHistory = [];
let hostSessionRoomKey = "";
let hostBallDropSessionActive = false;
let sharedSessionResetPending = false;
let viewerRunToken = 0;

let ballCount = 3;
let activeRound = 0;
let animationSeed = 1;
let targetIndexes = [];

let localRunning = false;
let finishPending = false;
let lastViewerRound = null;

let holderState = [];
let holderAnimationFrame = 0;
let holderAreaWidth = 700;
let holderBallRadius = 24;
let lastHolderIdleFrameAt = 0;
let holderFast = false;
let holderChoosing = false;
let holderChoiceStart = 0;
let holderChoiceDuration = 0;
let holderFastTravel = false;
let holderStopStart = 0;
let holderStopDuration = 0;
let holderAccelerationStart = 0;
let holderAccelerationDuration = 700;

let activeBalls = [];
let landedBalls = [];
let visiblePegRows = [];
let lockedPegRows = [];
let lockedPegLayoutKey = "";
let activePegFlash = null;

// Horizontal two-piece trap door.
let trapDoorVisible = true;
let trapDoorState = "closed";
let trapDoorShownAt = 0;
let trapDoorMotionStartedAt = 0;
let trapDoorHideTimer = 0;

const TRAP_DOOR_SHOW_MS = 150;
const TRAP_DOOR_OPEN_MS = 220;
const TRAP_DOOR_CLOSE_MS = 190;

const DEFAULT_FAST_PHASE_MS = 1500;
const DEFAULT_SLOW_PHASE_MS = 2000;

function sleep(milliseconds) {
  return new Promise(resolve =>
    window.setTimeout(resolve, Math.max(0, milliseconds))
  );
}

function validTimelineValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function animationTimelineFrom(source = {}) {
  const now = Date.now();
  const startedAtMs =
    validTimelineValue(source.animationTimelineStartedAtMs) ||
    validTimelineValue(source.ballDropAnimationTimelineStartedAtMs) ||
    now;
  const slowdownAtMs =
    validTimelineValue(source.animationSlowdownAtMs) ||
    validTimelineValue(source.ballDropAnimationSlowdownAtMs) ||
    startedAtMs + DEFAULT_FAST_PHASE_MS;
  const releaseAtMs =
    validTimelineValue(source.animationReleaseAtMs) ||
    validTimelineValue(source.ballDropAnimationReleaseAtMs) ||
    slowdownAtMs + DEFAULT_SLOW_PHASE_MS;

  return { startedAtMs, slowdownAtMs, releaseAtMs };
}

async function waitUntilSharedTime(targetTimeMs, runIsStillValid = null) {
  while (true) {
    if (runIsStillValid && !runIsStillValid()) return false;
    const remaining = Number(targetTimeMs) - Date.now();
    if (remaining <= 0) return true;
    await sleep(Math.min(remaining, 100));
  }
}

let animationFrame = 0;
let resizeTimer = 0;
let resizeFrame = 0;
let lastIdleBoardFrameAt = 0;
let ballSprite = null;
let ballSpriteRadius = 0;
let pageVisible = !document.hidden;

const audio = {
  boost: new Audio("sounds/ball-drop/machine_boost.mp3"),
  drumroll: new Audio("sounds/ball-drop/drum_roll.mp3"),
  release: new Audio("sounds/ball-drop/release_combo.wav"),
  landing: new Audio("sounds/ball-drop/ball_roll.wav"),
  result: new Audio("sounds/ball-drop/result_ding.wav"),
  peg: Array.from(
    { length: 6 },
    (_, index) => new Audio(`sounds/ball-drop/peg_hit_${index + 1}.wav`)
  )
};

audio.boost.volume = 0.5;
audio.drumroll.volume = 0.72;
audio.release.volume = 0.65;
audio.landing.volume = 0.3;
audio.result.volume = 0.52;
audio.peg.forEach(sound => {
  sound.volume = 0.11;
});

function playSound(source, { clone = false, restart = true } = {}) {
  try {
    const sound = clone ? source.cloneNode() : source;
    if (restart) sound.currentTime = 0;
    sound.play()?.catch?.(() => {});
    return sound;
  } catch (_) {
    return null;
  }
}

function stopSound(source) {
  try {
    source.pause();
    source.currentTime = 0;
  } catch (_) {}
}

function playSoundAndWait(source, safetyMs = 15000) {
  return new Promise(resolve => {
    let finished = false;
    let safetyTimer = 0;

    const cleanup = () => {
      source.removeEventListener("ended", finish);
      source.removeEventListener("error", finish);
      clearTimeout(safetyTimer);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve();
    };

    try {
      source.pause();
      source.currentTime = 0;
      source.addEventListener("ended", finish, { once: true });
      source.addEventListener("error", finish, { once: true });

      const playPromise = source.play();
      playPromise?.catch?.(error => {
        console.error("Audio playback failed:", error);
        finish();
      });

      // Emergency protection only. Normal playback always waits for `ended`.
      safetyTimer = window.setTimeout(finish, safetyMs);
    } catch (error) {
      console.error("Audio playback error:", error);
      finish();
    }
  });
}

function playPegSound() {
  const source = audio.peg[Math.floor(Math.random() * audio.peg.length)];
  const sound = source.cloneNode();
  sound.volume = 0.07 + Math.random() * 0.05;
  sound.playbackRate = 0.97 + Math.random() * 0.06;
  playSound(sound);
}

function hashSeed(...values) {
  let hash = 2166136261;

  for (const value of values) {
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }

  return hash >>> 0 || 1;
}

function seededRandom(seed) {
  let state = Number(seed) >>> 0 || 1;

  return (min = 0, max = 1) => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    const normalized =
      ((value ^ (value >>> 14)) >>> 0) / 4294967296;

    return min + normalized * (max - min);
  };
}

function clampBallCount(value) {
  const number = Number(value);
  return Math.min(
    6,
    Math.max(1, Number.isFinite(number) ? Math.round(number) : 3)
  );
}

function normalizeResults(values) {
  if (!Array.isArray(values)) return [];

  const normalized = values.map(Number);
  const valid =
    normalized.length === ballCount &&
    normalized.every(
      value => Number.isInteger(value) && value >= 0 && value < COLORS.length
    );

  return valid ? normalized : [];
}

function colorClass(value) {
  return String(value || "").toLowerCase();
}

function roomIdentity() {
  const collectionName = roomRef?.parent?.id;
  const roomId = roomRef?.id;

  if (!roomId) {
    throw new Error("The current room ID is unavailable.");
  }

  return {
    roomType: collectionName === "games" ? "guest" : "permanent",
    roomId
  };
}

function isVisible() {
  return Boolean(
    game &&
    !game.hidden &&
    getComputedStyle(game).display !== "none"
  );
}

function rebuildUi(nextCount) {
  ballCount = clampBallCount(nextCount);

  if (mixer && holderBalls.length !== ballCount) {
    mixer.innerHTML = "";

    for (let index = 0; index < ballCount; index += 1) {
      const ball = document.createElement("span");
      ball.className = "ballDropHolderBall";
      ball.dataset.holderBall = String(index);
      mixer.appendChild(ball);
    }

    holderBalls = [...mixer.querySelectorAll(".ballDropHolderBall")];
    initHolder();
  }

  const results = document.getElementById("ballDropResults");

  if (results && resultNodes.length !== ballCount) {
    results.innerHTML = "";

    for (let index = 0; index < ballCount; index += 1) {
      const result = document.createElement("span");
      result.className = "waiting";
      result.textContent = "?";
      results.appendChild(result);
    }

    resultNodes = [...results.children];
  }

  game?.style.setProperty("--ball-drop-count", String(ballCount));
  game?.classList.toggle("manyBalls", ballCount >= 7);
}

function measureHolderGeometry({ preservePositions = true } = {}) {
  const nextWidth = Math.max(320, mixer?.clientWidth || holderAreaWidth || 700);
  const nextRadius = (holderBalls[0]?.offsetWidth || holderBallRadius * 2 || 48) / 2;
  const previousWidth = Math.max(1, holderAreaWidth || nextWidth);

  if (
    preservePositions &&
    holderState.length &&
    Math.abs(nextWidth - previousWidth) >= 1
  ) {
    const scale = nextWidth / previousWidth;

    holderState.forEach(item => {
      item.x *= scale;
      item.baseX *= scale;
      item.startX *= scale;
      item.chosenX *= scale;
    });
  }

  holderAreaWidth = nextWidth;
  holderBallRadius = nextRadius;

  return {
    width: holderAreaWidth,
    radius: holderBallRadius
  };
}

function fixedHolderX(index, count, width) {
  return width * ((index + 1) / (count + 1));
}

function initHolder() {
  const { width } = measureHolderGeometry({
    preservePositions: false
  });

  holderState = holderBalls.map((element, index) => ({
    element,
    x: fixedHolderX(index, holderBalls.length, width),
    baseX: fixedHolderX(index, holderBalls.length, width),
    startX: fixedHolderX(index, holderBalls.length, width),
    chosenX: fixedHolderX(index, holderBalls.length, width),
    phase: index * 0.82,
    direction: index % 2 ? -1 : 1,
    speed: 0,
    minimumSpeed: 0,
    active: true
  }));

  restoreHolder();

  if (!holderAnimationFrame) {
    holderAnimationFrame = requestAnimationFrame(animateHolder);
  }
}

function easeOutQuint(value) {
  return 1 - Math.pow(1 - value, 5);
}

function animateHolder(now) {
  const activeMotion = holderFastTravel || holderChoosing;

  // Idle balls only need a subtle low-frequency animation.
  if (
    !activeMotion &&
    now - lastHolderIdleFrameAt < 50
  ) {
    holderAnimationFrame = requestAnimationFrame(animateHolder);
    return;
  }

  if (!activeMotion) {
    lastHolderIdleFrameAt = now;
  }

  const width = holderAreaWidth;
  const radius = holderBallRadius;
  const minimumX = radius + 10;
  const maximumX = width - radius - 10;

  holderState.forEach(item => {
    if (!item.active) return;

    if (holderFastTravel) {
      // Move at full speed immediately while Firebase works in parallel.
      item.x += item.speed * item.direction;

      if (item.x <= minimumX || item.x >= maximumX) {
        item.x = Math.max(minimumX, Math.min(maximumX, item.x));
        item.direction *= -1;
      }
    } else if (holderChoosing) {
      const elapsed = now - holderStopStart;
      const progress = Math.min(1, elapsed / Math.max(1, holderStopDuration));
      const eased = easeOutQuint(progress);

      item.x =
        item.startX +
        (item.chosenX - item.startX) * eased;

      if (progress >= 1) {
        item.x = item.chosenX;
      }
    } else {
      item.x = item.baseX;
    }

    const bobY =
      holderFastTravel
        ? Math.sin(now * 0.028 + item.phase) * 1.4
        : holderChoosing
          ? Math.sin(now * 0.014 + item.phase) * (1 - Math.min(
              1,
              (now - holderStopStart) / Math.max(1, holderStopDuration)
            ))
          : Math.sin(now * 0.002 + item.phase) * 0.55;

    const rotation =
      holderFastTravel
        ? item.x * 2.4 * item.direction
        : holderChoosing
          ? item.x * 0.8 * item.direction
          : Math.sin(now * 0.0017 + item.phase) * 2;

    item.element.style.left = `${item.x - radius}px`;
    item.element.style.transform =
      `translateY(${bobY}px) rotate(${rotation}deg)`;
  });

  holderAnimationFrame = requestAnimationFrame(animateHolder);
}

function startFastHorizontalMovement() {
  const { width } = measureHolderGeometry();

  holderAccelerationStart = performance.now();
  holderAccelerationDuration = 0;

  holderState.forEach((item, index) => {
    const random = seededRandom(
      hashSeed(Date.now(), "machine-start", index)
    );

    item.baseX = fixedHolderX(index, holderState.length, width);
    item.x = item.baseX;
    item.startX = item.x;
    item.direction = random() < 0.5 ? -1 : 1;
    item.minimumSpeed = 0;
    item.speed = random(13, 18);
    item.active = true;
    item.element.style.opacity = "1";
  });

  holderChoosing = false;
  holderFastTravel = true;
  holderFast = true;
}

function chooseAndStopDropPositions() {
  const { width } = measureHolderGeometry();
  const radius = holderBallRadius;
  const minimumX = radius + 14;
  const maximumX = width - radius - 14;

  holderState.forEach((item, index) => {
    const random = seededRandom(
      hashSeed(animationSeed, activeRound, "stop-position", index)
    );

    item.startX = item.x;
    item.chosenX = random(minimumX, maximumX);
  });

  // Exact two-second deceleration: fast → medium → slow → stopped.
  holderStopDuration = 2000;
  holderStopStart = performance.now();
  holderFastTravel = false;
  holderChoosing = true;
}

function finishHorizontalChoices() {
  holderFastTravel = false;
  holderChoosing = false;
  holderFast = false;

  holderState.forEach(item => {
    item.x = item.chosenX;
    item.baseX = item.chosenX;
    item.startX = item.chosenX;
  });
}

function restoreHolder() {
  const { width } = measureHolderGeometry();

  holderFastTravel = false;
  holderChoosing = false;
  holderFast = false;

  holderState.forEach((item, index) => {
    item.active = true;
    item.baseX = fixedHolderX(index, holderState.length, width);
    item.x = item.baseX;
    item.startX = item.baseX;
    item.chosenX = item.baseX;
    item.element.style.opacity = "1";
  });
}

function resetResults() {
  resultNodes.forEach((node, index) => {
    node.className = "waiting emptyResult";
    node.textContent = index === 0
      ? "No results yet."
      : "";
    node.setAttribute("aria-hidden", index === 0 ? "false" : "true");
  });
}

function showResults(values) {
  resultNodes.forEach((node, index) => {
    const value = values?.[index];
    node.removeAttribute("aria-hidden");
    node.className = value ? colorClass(value) : "waiting";
    node.textContent = value || "?";
  });
}

function decodeHistoryRow(row) {
  if (Array.isArray(row)) {
    return row
      .map(value => {
        const number = Number(value);
        return Number.isInteger(number) && COLORS[number]
          ? COLORS[number]
          : String(value || "");
      })
      .filter(value => COLORS.includes(value));
  }

  if (typeof row !== "string") return [];

  return row
    .split(",")
    .map(Number)
    .filter(index => Number.isInteger(index) && COLORS[index])
    .map(index => COLORS[index]);
}

function showHistory(rows) {
  if (!historyNode) return;

  const decoded = Array.isArray(rows)
    ? rows.map(decodeHistoryRow).filter(row => row.length)
    : [];

  if (!decoded.length) {
    historyNode.innerHTML = "<p>No drops yet.</p>";
    return;
  }

  historyNode.innerHTML = decoded
    .slice(-7)
    .reverse()
    .map(values => `
      <div class="ballDropHistoryRow" aria-label="${values.join(", ")}">
        ${values
          .map(value => `<i class="${colorClass(value)}" title="${value}"></i>`)
          .join("")}
      </div>
    `)
    .join("");
}

function currentRoomSessionKey() {
  return String(roomRef?.path || roomRef?.id || "");
}

function resetHostSessionHistory() {
  hostSessionHistory = [];
  showHistory([]);
}

async function resetSharedBallDropSession() {
  if (!isHost || !roomRef || sharedSessionResetPending) return;

  sharedSessionResetPending = true;

  try {
    await updateDoc(roomRef, {
      latestBallDropResult: [],
      ballDropHistory: [],
      pendingBallDropResult: [],
      ballDropRolling: false,
      ballDropAnimationSeed: null,
      ballDropAnimationTimelineStartedAtMs: null,
      ballDropAnimationSlowdownAtMs: null,
      ballDropAnimationReleaseAtMs: null,
      ballDropSessionResetAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    currentRoom = {
      ...(currentRoom || {}),
      latestBallDropResult: [],
      ballDropHistory: [],
      pendingBallDropResult: [],
      ballDropRolling: false,
      ballDropAnimationSeed: null,
      ballDropAnimationTimelineStartedAtMs: null,
      ballDropAnimationSlowdownAtMs: null,
      ballDropAnimationReleaseAtMs: null
    };
  } catch (error) {
    console.error("Could not reset shared Ball Drop session:", error);
  } finally {
    sharedSessionResetPending = false;
  }
}

function resetViewerDropImmediately() {
  viewerRunToken += 1;
  localRunning = false;
  finishPending = false;
  holderFast = false;
  holderFastTravel = false;
  holderChoosing = false;
  targetIndexes = [];
  activeRound = 0;
  animationSeed = 1;
  lastViewerRound = null;

  stopSound(audio.boost);
  stopSound(audio.drumroll);
  stopSound(audio.release);
  stopSound(audio.landing);
  stopSound(audio.result);

  clearAnimation();
  activePegFlash = null;
  resetTrapDoorClosed();
  restoreHolder();
  resetResults();
  showHistory([]);
  game?.removeAttribute("data-dropping");

  status.textContent = isHost
    ? "Ready to drop."
    : "Waiting for the host.";

  if (button) button.disabled = !isHost;
}

function resetBallDropSessionDisplay() {
  hostSessionHistory = [];
  targetIndexes = [];
  activeRound = 0;
  animationSeed = 1;
  localRunning = false;
  finishPending = false;
  holderFast = false;
  holderFastTravel = false;
  holderChoosing = false;

  stopSound(audio.boost);
  stopSound(audio.drumroll);
  stopSound(audio.release);
  clearAnimation();
  resetResults();
  showHistory([]);
  restoreHolder();
  resetTrapDoorClosed();
  game?.removeAttribute("data-dropping");

  if (button) {
    button.disabled = !isHost;
  }

  status.textContent = isHost
    ? "Ready to drop."
    : "Waiting for the host.";
}

function addHostSessionDrop(values) {
  const decoded = decodeHistoryRow(values);

  if (!decoded.length) return;

  hostSessionHistory = [
    ...hostSessionHistory,
    decoded
  ].slice(-7);

  showHistory(hostSessionHistory);
}

function resizeCanvas() {
  if (!canvas || !board || !isVisible()) return false;

  const rect = board.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  if (width < 280 || height < 320) return false;

  measureHolderGeometry();

  // A generated falling route uses the board geometry from its release.
  // During an active fall, scale the whole canvas visually and rebuild the
  // geometry only after the round completes.
  if (activeBalls.length > 0 && boardWidth && boardHeight) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return true;
  }

  if (
    width === boardWidth &&
    height === boardHeight &&
    ctx
  ) {
    return true;
  }

  boardWidth = width;
  boardHeight = height;
  deviceRatio = Math.min(2, window.devicePixelRatio || 1);

  canvas.width = Math.round(width * deviceRatio);
  canvas.height = Math.round(height * deviceRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx = canvas.getContext("2d");
  ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);

  ballSprite = null;
  ballSpriteRadius = 0;
  lockPegLayout({ force: true });
  drawBoard();
  return true;
}

function scheduleResponsiveResize() {
  if (resizeFrame) return;

  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;

    if (isVisible()) {
      resizeCanvas();
    }
  });
}

function slotGeometry() {
  const slotLeft = boardWidth * 0.015;
  const slotRight = boardWidth * 0.985;
  const slotWidth = (slotRight - slotLeft) / 6;
  const slotHeight = boardWidth < 500 ? 80 : 102;
  const slotTop = boardHeight - slotHeight - 6;

  return {
    slotLeft,
    slotRight,
    slotWidth,
    slotHeight,
    slotTop
  };
}

function slotCenterX(index) {
  const { slotLeft, slotWidth } = slotGeometry();

  return slotLeft + slotWidth * (index + 0.5);
}

function sameSlotOrder(ballIndex, targetIndex) {
  return targetIndexes
    .slice(0, ballIndex)
    .filter(index => index === targetIndex)
    .length;
}

function landingX(ballIndex, targetIndex, radius) {
  const { slotLeft, slotWidth } = slotGeometry();
  const center = slotCenterX(targetIndex);
  const order = sameSlotOrder(ballIndex, targetIndex);
  const pattern = [0, -0.22, 0.22, -0.11, 0.11, -0.3, 0.3, 0];

  const minimum =
    slotLeft + targetIndex * slotWidth + radius + 5;

  const maximum =
    slotLeft + (targetIndex + 1) * slotWidth - radius - 5;

  const value =
    center + pattern[order % pattern.length] * slotWidth;

  return Math.max(minimum, Math.min(maximum, value));
}

function gatePositions() {
  const spread = Math.min(
    boardWidth * 0.5,
    boardWidth < 500 ? 190 : 310
  );

  return [
    boardWidth / 2 - spread / 2,
    boardWidth / 2,
    boardWidth / 2 + spread / 2
  ];
}

function createPegRows() {
  const rows = [];
  const mobile = boardWidth < 500;
  const { slotLeft, slotRight, slotWidth, slotTop } = slotGeometry();

  // A denser, mirrored lattice gives every one of the six outcome lanes
  // the same visual coverage. The result itself is still chosen securely
  // by Firebase; this geometry only replays it.
  const rowCount = mobile ? 12 : 15;
  const wideColumns = mobile ? 9 : 13;
  const narrowColumns = wideColumns - 1;

  const topY = mobile ? 70 : 76;
  const bottomY = slotTop - (mobile ? 62 : 72);
  const rowGap = (bottomY - topY) / Math.max(1, rowCount - 1);

  // Peg spacing is exactly half a result-slot width. This keeps the board
  // symmetric around its center and gives all six slots equal peg density.
  const horizontalGap = slotWidth / 2;
  const latticeWidth = horizontalGap * (wideColumns - 1);
  const latticeLeft = (boardWidth - latticeWidth) / 2;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const narrow = rowIndex % 2 === 1;
    const columns = narrow ? narrowColumns : wideColumns;
    const offset = narrow ? horizontalGap / 2 : 0;
    const row = [];

    for (let column = 0; column < columns; column += 1) {
      const x = latticeLeft + offset + column * horizontalGap;

      // Keep the outermost pegs safely inside the visible result area.
      if (
        x < slotLeft + 4 ||
        x > slotRight - 4
      ) {
        continue;
      }

      row.push({
        x,
        y: topY + rowIndex * rowGap,
        radius: mobile ? 5.2 : 6.1,
        rowIndex,
        column: row.length
      });
    }

    rows.push(row);
  }

  return rows;
}

function pegLayoutKey() {
  return `${boardWidth}x${boardHeight}`;
}

function lockPegLayout({ force = false } = {}) {
  const key = pegLayoutKey();

  if (
    force ||
    lockedPegRows.length === 0 ||
    lockedPegLayoutKey !== key
  ) {
    lockedPegRows = createPegRows();
    lockedPegLayoutKey = key;
  }

  visiblePegRows = lockedPegRows;
  return lockedPegRows;
}

function drawPeg(peg) {
  const radius = peg.radius;
  const flashing =
    activePegFlash &&
    activePegFlash.until > performance.now() &&
    Math.abs(activePegFlash.x - peg.x) < 1 &&
    Math.abs(activePegFlash.y - peg.y) < 1;

  if (flashing) {
    const glow = ctx.createRadialGradient(
      peg.x,
      peg.y,
      radius * 0.4,
      peg.x,
      peg.y,
      radius * 2.5
    );

    glow.addColorStop(0, "rgba(255,255,255,.45)");
    glow.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const shadow = ctx.createRadialGradient(
    peg.x + radius * 0.35,
    peg.y + radius * 0.45,
    radius * 0.1,
    peg.x,
    peg.y,
    radius * 1.5
  );

  shadow.addColorStop(0, "rgba(0,0,0,.28)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(
    peg.x + 1.5,
    peg.y + 2.5,
    radius * 1.5,
    0,
    Math.PI * 2
  );
  ctx.fill();

  const metal = ctx.createRadialGradient(
    peg.x - radius * 0.38,
    peg.y - radius * 0.4,
    radius * 0.08,
    peg.x,
    peg.y,
    radius
  );

  metal.addColorStop(0, "#ffffff");
  metal.addColorStop(0.25, "#eef4f7");
  metal.addColorStop(0.58, "#aab8c0");
  metal.addColorStop(0.82, "#71818b");
  metal.addColorStop(1, "#3e4b53");

  ctx.fillStyle = metal;
  ctx.strokeStyle = "rgba(255,255,255,.72)";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.arc(peg.x, peg.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.82)";
  ctx.beginPath();
  ctx.arc(
    peg.x - radius * 0.33,
    peg.y - radius * 0.35,
    Math.max(1.1, radius * 0.19),
    0,
    Math.PI * 2
  );
  ctx.fill();
}

function easeInOutCubic(value) {
  const clamped = Math.max(0, Math.min(1, value));

  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function clearTrapDoorHideTimer() {
  if (!trapDoorHideTimer) return;

  clearTimeout(trapDoorHideTimer);
  trapDoorHideTimer = 0;
}

function resetTrapDoorClosed() {
  clearTrapDoorHideTimer();
  trapDoorVisible = true;
  trapDoorState = "closed";
  trapDoorShownAt = performance.now() - TRAP_DOOR_SHOW_MS;
  trapDoorMotionStartedAt = 0;
}

function showClosedTrapDoor() {
  resetTrapDoorClosed();
}

function openTrapDoor() {
  if (!trapDoorVisible) {
    trapDoorVisible = true;
    trapDoorShownAt = performance.now() - TRAP_DOOR_SHOW_MS;
  }

  trapDoorState = "opening";
  trapDoorMotionStartedAt = performance.now();

  return new Promise(resolve => {
    window.setTimeout(() => {
      if (trapDoorState === "opening") {
        trapDoorState = "open";
      }

      resolve();
    }, TRAP_DOOR_OPEN_MS);
  });
}

function closeTrapDoor() {
  clearTrapDoorHideTimer();

  if (!trapDoorVisible) {
    resetTrapDoorClosed();
    return Promise.resolve();
  }

  if (trapDoorState === "closed") {
    return Promise.resolve();
  }

  trapDoorState = "closing";
  trapDoorMotionStartedAt = performance.now();

  return new Promise(resolve => {
    trapDoorHideTimer = window.setTimeout(() => {
      trapDoorState = "closed";
      trapDoorMotionStartedAt = 0;
      trapDoorHideTimer = 0;
      resolve();
    }, TRAP_DOOR_CLOSE_MS);
  });
}

function trapDoorOpenProgress(now) {
  if (trapDoorState === "open") return 1;
  if (trapDoorState === "closed" || trapDoorState === "showing") return 0;

  if (trapDoorState === "opening") {
    return easeInOutCubic(
      (now - trapDoorMotionStartedAt) / TRAP_DOOR_OPEN_MS
    );
  }

  if (trapDoorState === "closing") {
    return 1 - easeInOutCubic(
      (now - trapDoorMotionStartedAt) / TRAP_DOOR_CLOSE_MS
    );
  }

  return 0;
}

function drawTrapDoorPanel({
  x,
  y,
  width,
  height,
  side
}) {
  if (width <= 0 || height <= 0) return;

  ctx.save();

  const metal = ctx.createLinearGradient(0, y, 0, y + height);
  metal.addColorStop(0, "#d8e1e5");
  metal.addColorStop(0.15, "#8f9da5");
  metal.addColorStop(0.48, "#3f4a51");
  metal.addColorStop(0.72, "#68757d");
  metal.addColorStop(1, "#242b30");

  ctx.fillStyle = metal;
  ctx.strokeStyle = "rgba(235,244,248,.82)";
  ctx.lineWidth = 1.2;
  ctx.shadowColor = "rgba(0,0,0,.58)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;

  ctx.beginPath();
  ctx.roundRect(
    x,
    y,
    width,
    height,
    boardWidth < 500 ? 4 : 6
  );
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = "transparent";

  // Brushed-metal horizontal lines.
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(255,255,255,.42)";
  ctx.lineWidth = 0.7;

  for (let lineY = y + 4; lineY < y + height - 2; lineY += 4) {
    ctx.beginPath();
    ctx.moveTo(x + 5, lineY);
    ctx.lineTo(x + width - 5, lineY);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;

  // Beveled upper edge.
  ctx.strokeStyle = "rgba(255,255,255,.66)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 5, y + 2);
  ctx.lineTo(x + width - 5, y + 2);
  ctx.stroke();

  // Center seam edge.
  const seamX = side === "left" ? x + width : x;

  ctx.strokeStyle = "rgba(5,8,10,.92)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(seamX, y + 2);
  ctx.lineTo(seamX, y + height - 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(
    seamX + (side === "left" ? -2 : 2),
    y + 3
  );
  ctx.lineTo(
    seamX + (side === "left" ? -2 : 2),
    y + height - 3
  );
  ctx.stroke();

  // Rivets.
  const rivetRadius = boardWidth < 500 ? 1.5 : 2;
  const rivetInset = boardWidth < 500 ? 8 : 11;
  const rivetXs = [x + rivetInset, x + width - rivetInset];
  const rivetYs = [y + 5, y + height - 5];

  for (const rivetX of rivetXs) {
    for (const rivetY of rivetYs) {
      const rivet = ctx.createRadialGradient(
        rivetX - 0.5,
        rivetY - 0.5,
        0,
        rivetX,
        rivetY,
        rivetRadius
      );
      rivet.addColorStop(0, "#f8fbfc");
      rivet.addColorStop(0.45, "#9eabb2");
      rivet.addColorStop(1, "#303a40");

      ctx.fillStyle = rivet;
      ctx.beginPath();
      ctx.arc(rivetX, rivetY, rivetRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawGates() {
  if (!trapDoorVisible) return;

  const now = performance.now();
  const mobile = boardWidth < 500;

  const doorHeight = mobile ? 14 : 18;
  const restingY = mobile ? 31 : 35;
  const hiddenOffset = mobile ? 18 : 23;

  const showProgress =
    trapDoorState === "showing"
      ? easeInOutCubic(
          (now - trapDoorShownAt) / TRAP_DOOR_SHOW_MS
        )
      : 1;

  if (
    trapDoorState === "showing" &&
    now - trapDoorShownAt >= TRAP_DOOR_SHOW_MS
  ) {
    trapDoorState = "closed";
  }

  const y =
    restingY +
    (1 - showProgress) * hiddenOffset;

  const assemblyLeft = boardWidth * (mobile ? 0.04 : 0.035);
  const assemblyRight = boardWidth * (mobile ? 0.96 : 0.965);
  const assemblyWidth = assemblyRight - assemblyLeft;
  const halfWidth = assemblyWidth / 2;
  const centerX = boardWidth / 2;

  const openProgress = trapDoorOpenProgress(now);

  // Each panel travels far enough to create one large opening.
  const travel = halfWidth * 0.92 * openProgress;

  const leftX = centerX - halfWidth - travel;
  const rightX = centerX + travel;

  ctx.save();
  ctx.globalAlpha = showProgress;

  // Shadow beneath the complete mechanism.
  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.fillRect(
    assemblyLeft,
    y + doorHeight - 1,
    assemblyWidth,
    mobile ? 5 : 7
  );

  drawTrapDoorPanel({
    x: leftX,
    y,
    width: halfWidth,
    height: doorHeight,
    side: "left"
  });

  drawTrapDoorPanel({
    x: rightX,
    y,
    width: halfWidth,
    height: doorHeight,
    side: "right"
  });

  ctx.restore();
}

function drawSlotFunnels() {
  const { slotLeft, slotWidth, slotTop } = slotGeometry();
  const mobile = boardWidth < 500;
  const funnelHeight = mobile ? 34 : 44;
  const topHalfWidth = slotWidth * (mobile ? 0.34 : 0.38);
  const bottomHalfWidth = slotWidth * 0.13;
  const railWidth = mobile ? 5 : 6;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let index = 0; index < 6; index += 1) {
    const centerX = slotLeft + slotWidth * (index + 0.5);
    const topY = slotTop - funnelHeight;
    const bottomY = slotTop + 2;

    // Soft shadow behind both rails.
    ctx.strokeStyle = "rgba(0,0,0,.5)";
    ctx.lineWidth = railWidth + 4;
    ctx.beginPath();
    ctx.moveTo(centerX - topHalfWidth + 2, topY + 3);
    ctx.lineTo(centerX - bottomHalfWidth + 2, bottomY + 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + topHalfWidth + 2, topY + 3);
    ctx.lineTo(centerX + bottomHalfWidth + 2, bottomY + 3);
    ctx.stroke();

    // Dark metal rail base.
    ctx.strokeStyle = "#3d4a52";
    ctx.lineWidth = railWidth;
    ctx.beginPath();
    ctx.moveTo(centerX - topHalfWidth, topY);
    ctx.lineTo(centerX - bottomHalfWidth, bottomY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + topHalfWidth, topY);
    ctx.lineTo(centerX + bottomHalfWidth, bottomY);
    ctx.stroke();

    // Bright beveled highlight.
    ctx.strokeStyle = "rgba(232,241,246,.88)";
    ctx.lineWidth = Math.max(1.4, railWidth * 0.3);
    ctx.beginPath();
    ctx.moveTo(centerX - topHalfWidth - 1, topY - 1);
    ctx.lineTo(centerX - bottomHalfWidth - 1, bottomY - 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX + topHalfWidth - 1, topY - 1);
    ctx.lineTo(centerX + bottomHalfWidth - 1, bottomY - 1);
    ctx.stroke();

    // Small mounting caps at the top of each funnel rail.
    const capRadius = mobile ? 3.2 : 3.8;
    for (const x of [centerX - topHalfWidth, centerX + topHalfWidth]) {
      const cap = ctx.createRadialGradient(
        x - capRadius * 0.3,
        topY - capRadius * 0.3,
        capRadius * 0.1,
        x,
        topY,
        capRadius
      );
      cap.addColorStop(0, "#ffffff");
      cap.addColorStop(0.45, "#b9c6cd");
      cap.addColorStop(1, "#4d5b63");
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.arc(x, topY, capRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawBoard() {
  if (!ctx || !boardWidth || !boardHeight) return;

  ctx.clearRect(0, 0, boardWidth, boardHeight);
  lockPegLayout();
  drawGates();
  drawSlotFunnels();

  for (const row of visiblePegRows) {
    for (const peg of row) {
      drawPeg(peg);
    }
  }

  const { slotLeft, slotWidth, slotTop } = slotGeometry();

  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.lineWidth = 2;

  for (let index = 0; index <= 6; index += 1) {
    const x = slotLeft + slotWidth * index;
    ctx.beginPath();
    ctx.moveTo(x, slotTop);
    ctx.lineTo(x, boardHeight);
    ctx.stroke();
  }
}

function nearestPeg(row, targetX) {
  return [...row].sort(
    (a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX)
  )[0];
}

function smoothStep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function routeGuideX(
  releaseX,
  targetX,
  progress,
  waveAmplitude,
  wavePhase
) {
  // The slot influence begins immediately but grows gradually. There is no
  // sudden late pull toward the result hole.
  const guidedProgress = smoothStep(progress);
  const base =
    releaseX +
    (targetX - releaseX) * guidedProgress;

  // A low-frequency seeded curve keeps routes from looking like straight,
  // mechanically programmed lines while still ending at the correct slot.
  const wave =
    Math.sin(progress * Math.PI * 1.55 + wavePhase) *
    waveAmplitude *
    Math.sin(progress * Math.PI);

  return base + wave;
}

function choosePegRoute(releaseX, targetX, random) {
  const pegRows = lockPegLayout();

  if (!pegRows.length) return [];

  const firstRowSpacing =
    pegRows[0].length > 1
      ? Math.abs(pegRows[0][1].x - pegRows[0][0].x)
      : boardWidth * 0.08;

  const waveAmplitude = random(
    firstRowSpacing * 0.18,
    firstRowSpacing * 0.55
  );
  const wavePhase = random(-0.8, 0.8);

  // Each state represents one believable route up to the current row.
  // Keeping a small beam provides variation without allowing impossible jumps.
  let states = [{
    peg: null,
    route: [],
    x: releaseX,
    direction: 0,
    directionRun: 0,
    reversals: 0,
    score: 0
  }];

  pegRows.forEach((row, rowIndex) => {
    const progress = (rowIndex + 1) / pegRows.length;
    const guideX = routeGuideX(
      releaseX,
      targetX,
      progress,
      waveAmplitude,
      wavePhase
    );

    const rowSpacing =
      row.length > 1
        ? Math.abs(row[1].x - row[0].x)
        : firstRowSpacing;

    const nextStates = [];

    for (const state of states) {
      const candidates = row.filter(peg => {
        const movement = Math.abs(peg.x - state.x);

        // One nearby lattice step is natural. A slightly larger allowance is
        // permitted only near the first row because release positions can sit
        // between columns.
        const maximumMovement =
          rowIndex === 0
            ? rowSpacing * 1.45
            : rowSpacing * 1.08;

        return movement <= maximumMovement;
      });

      const usableCandidates =
        candidates.length
          ? candidates
          : [nearestPeg(row, state.x)];

      for (const peg of usableCandidates) {
        const movement = peg.x - state.x;
        const direction = Math.sign(movement);
        const changedDirection =
          state.direction &&
          direction &&
          direction !== state.direction;

        const directionRun =
          direction && direction === state.direction
            ? state.directionRun + 1
            : direction
              ? 1
              : state.directionRun;

        const reversals =
          state.reversals + (changedDirection ? 1 : 0);

        const guideError = Math.abs(peg.x - guideX);
        const movementCost = Math.abs(movement) * 0.16;

        // Penalize rapid zig-zagging, but also prevent an unnaturally long
        // uninterrupted sweep in one direction.
        const reversalCost =
          changedDirection
            ? rowSpacing * 0.22
            : 0;

        const longRunCost =
          directionRun > 3
            ? rowSpacing * (directionRun - 3) * 0.12
            : 0;

        // As the ball approaches the lower rows, ending near the selected slot
        // becomes more important, but the increase is smooth rather than sudden.
        const endingCost =
          Math.abs(peg.x - targetX) *
          Math.pow(progress, 2.4) *
          0.22;

        nextStates.push({
          peg,
          route: [...state.route, peg],
          x: peg.x,
          direction: direction || state.direction,
          directionRun,
          reversals,
          score:
            state.score +
            guideError +
            movementCost +
            reversalCost +
            longRunCost +
            endingCost +
            random(0, rowSpacing * 0.08)
        });
      }
    }

    // Preserve a handful of the best natural alternatives.
    states = nextStates
      .sort((a, b) => a.score - b.score)
      .slice(0, 10);
  });

  // Final selection also checks the approach into the target slot so a route
  // cannot finish on the wrong side and then visibly snap into the funnel.
  const best = states
    .map(state => ({
      state,
      finalScore:
        state.score +
        Math.abs(state.x - targetX) * 1.8 +
        state.reversals * firstRowSpacing * 0.025
    }))
    .sort((a, b) => a.finalScore - b.finalScore)[0]?.state;

  return best?.route || [];
}

function buildReplay(ballIndex, releaseX, targetIndex, radius, random) {
  const finalX = landingX(ballIndex, targetIndex, radius);
  const selectedPegs = choosePegRoute(releaseX, finalX, random);
  const nodes = [{ x: releaseX, y: 14, type: "start" }];

  let previousX = releaseX;
  let previousSide = 0;

  selectedPegs.forEach((peg, rowIndex) => {
    const nextX = selectedPegs[rowIndex + 1]?.x ?? finalX;

    let side =
      Math.sign(nextX - peg.x) ||
      Math.sign(peg.x - previousX) ||
      previousSide ||
      (random() < 0.5 ? -1 : 1);

    if (
      previousSide &&
      side !== previousSide &&
      random() < 0.3
    ) {
      side = previousSide;
    }

    const tangentDistance =
      radius + peg.radius + 0.45;

    const contactX = peg.x + side * tangentDistance;

    // Contact slightly above the peg center, then let the curved segment carry
    // the ball naturally around its side.
    const contactY = peg.y - Math.min(1.8, peg.radius * 0.22);

    nodes.push({
      x: contactX,
      y: contactY,
      pegX: peg.x,
      pegY: peg.y,
      pegRadius: peg.radius,
      side,
      rowIndex: peg.rowIndex,
      column: peg.column,
      type: "peg"
    });

    previousX = nodes.at(-1).x;
    previousSide = side;
  });

  const { slotTop } = slotGeometry();
  const lastX = nodes.at(-1)?.x ?? releaseX;

  // Four progressively narrowing approach points remove the old visible
  // last-moment pull into the funnel.
  nodes.push({
    x: lastX + (finalX - lastX) * 0.34,
    y: slotTop - radius * 3.35,
    type: "free"
  });

  nodes.push({
    x: lastX + (finalX - lastX) * 0.62,
    y: slotTop - radius * 2.55,
    type: "free"
  });

  nodes.push({
    x: lastX + (finalX - lastX) * 0.84,
    y: slotTop - radius * 1.75,
    type: "free"
  });

  nodes.push({
    x: finalX,
    y: slotTop - radius * 1.03,
    type: "entrance"
  });

  nodes.push({
    x: finalX,
    y: boardHeight - radius - 14,
    type: "landing"
  });

  const frames = [];

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const frameCount = Math.max(
      18,
      Math.round(distance / 2.15)
    );

    const curve =
      to.type === "peg"
        ? -Number(to.side || 1) * random(2.2, 4.2)
        : to.type === "entrance"
          ? random(-0.18, 0.18)
          : random(-0.38, 0.38);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const raw = frame / frameCount;
      const fallT = raw * raw * (2.06 - 1.06 * raw);
      const arc = Math.sin(raw * Math.PI);

      frames.push({
        x:
          from.x +
          (to.x - from.x) * raw +
          arc * curve,
        y:
          from.y +
          (to.y - from.y) * fallT -
          arc * Math.min(1.45, Math.abs(curve) * 0.27),
        hit: false
      });
    }

    if (to.type === "peg") {
      const matchingVisiblePeg =
        lockedPegRows[to.rowIndex]?.[to.column];

      if (
        matchingVisiblePeg &&
        Math.abs(matchingVisiblePeg.x - to.pegX) < 0.01 &&
        Math.abs(matchingVisiblePeg.y - to.pegY) < 0.01
      ) {
        frames.push({
          x: to.x,
          y: to.y,
          pegX: matchingVisiblePeg.x,
          pegY: matchingVisiblePeg.y,
          hit: true
        });
      }
    }
  }

  return {
    frames,
    finalX,
    finalY: boardHeight - radius - 14
  };
}

function createBall(index, releaseX, targetIndex, delay) {
  const baseRadius = boardWidth < 500 ? 17 : 20;
  const radius =
    ballCount <= 3
      ? baseRadius
      : ballCount <= 6
        ? baseRadius - 2
        : baseRadius - 4;

  const random = seededRandom(
    hashSeed(
      animationSeed,
      activeRound,
      index,
      targetIndex,
      boardWidth,
      boardHeight
    )
  );

  return {
    index,
    targetIndex,
    radius,
    delay,
    startTime: null,
    lastUpdate: null,
    routeElapsed: 0,
    routeDuration: 0,
    lastSampleIndex: 0,
    replay: buildReplay(index, releaseX, targetIndex, radius, random),
    x: releaseX,
    y: 14,
    previousX: releaseX,
    rotation: random(-0.2, 0.2),
    angularVelocity: random(-0.012, 0.012),
    landed: false,
    bounceStart: null,
    bounceHeight: random(3.5, 5.5),
    playedHits: new Set()
  };
}

function processPegHitsBetween(ball, fromIndex, toIndex, now) {
  const start = Math.max(0, Math.floor(fromIndex) + 1);
  const end = Math.min(
    ball.replay.frames.length - 1,
    Math.floor(toIndex)
  );

  for (let index = start; index <= end; index += 1) {
    const frame = ball.replay.frames[index];

    if (!frame?.hit || ball.playedHits.has(index)) continue;

    ball.playedHits.add(index);

    activePegFlash = {
      x: frame.pegX,
      y: frame.pegY,
      until: now + 75
    };

    playPegSound();
  }
}

function sampleReplayPosition(ball, samplePosition) {
  const lastIndex = ball.replay.frames.length - 1;
  const clampedPosition = Math.max(
    0,
    Math.min(lastIndex, samplePosition)
  );

  const lowerIndex = Math.floor(clampedPosition);
  const upperIndex = Math.min(lowerIndex + 1, lastIndex);
  const fraction = clampedPosition - lowerIndex;

  const from = ball.replay.frames[lowerIndex];
  const to = ball.replay.frames[upperIndex] || from;

  if (!from) {
    return {
      x: ball.replay.finalX,
      y: ball.replay.finalY,
      lowerIndex,
      upperIndex
    };
  }

  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    lowerIndex,
    upperIndex
  };
}

function updateBall(ball, now) {
  if (ball.startTime === null) {
    ball.startTime = now + ball.delay;
    ball.lastUpdate = ball.startTime;

    // Preserve the existing intended speed: one generated route frame
    // represents roughly one 60 Hz display frame.
    ball.routeDuration = Math.max(
      320,
      (ball.replay.frames.length - 1) * 16.67
    );
  }

  if (now < ball.startTime || ball.landed) return;

  const rawDelta = Math.max(0, now - ball.lastUpdate);

  // Never allow a tab switch, DevTools pause, resize, or temporary browser
  // stall to skip a large visible section of the route.
  const safeDelta = Math.min(rawDelta, 34);

  ball.lastUpdate = now;
  ball.routeElapsed = Math.min(
    ball.routeDuration,
    ball.routeElapsed + safeDelta
  );

  const routeProgress =
    ball.routeDuration > 0
      ? ball.routeElapsed / ball.routeDuration
      : 1;

  const lastFrameIndex = ball.replay.frames.length - 1;
  const samplePosition = routeProgress * lastFrameIndex;
  const previousSampleIndex = ball.lastSampleIndex;
  const sampled = sampleReplayPosition(ball, samplePosition);

  processPegHitsBetween(
    ball,
    previousSampleIndex,
    samplePosition,
    now
  );

  ball.previousX = ball.x;
  ball.x = sampled.x;
  ball.y = sampled.y;
  ball.lastSampleIndex = samplePosition;

  const horizontalMovement = ball.x - ball.previousX;

  ball.rotation +=
    ball.angularVelocity +
    horizontalMovement * 0.012;

  if (ball.routeElapsed < ball.routeDuration) {
    return;
  }

  if (ball.bounceStart === null) {
    ball.bounceStart = now;
    playSound(audio.landing, { clone: true });
  }

  const bounceDuration = 205;
  const bounceRaw = Math.min(
    1,
    (now - ball.bounceStart) / bounceDuration
  );

  ball.x = ball.replay.finalX;
  ball.y =
    ball.replay.finalY -
    Math.sin(bounceRaw * Math.PI) * ball.bounceHeight;

  if (bounceRaw >= 1) {
    ball.x = ball.replay.finalX;
    ball.y = ball.replay.finalY;
    ball.landed = true;
    landedBalls.push(ball);

    if (landedBalls.length >= ballCount) {
      finishRound();
    }
  }
}

function getBallSprite(radius) {
  const roundedRadius = Math.max(4, Math.round(radius * 10) / 10);

  if (
    ballSprite &&
    Math.abs(ballSpriteRadius - roundedRadius) < 0.1
  ) {
    return ballSprite;
  }

  const padding = 4;
  const size = Math.ceil(roundedRadius * 2 + padding * 2);
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;

  const spriteContext = sprite.getContext("2d");
  const center = size / 2;

  const gradient = spriteContext.createRadialGradient(
    center - roundedRadius * 0.35,
    center - roundedRadius * 0.35,
    roundedRadius * 0.12,
    center,
    center,
    roundedRadius
  );

  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.72, "#f8f8f8");
  gradient.addColorStop(1, "#c9d1d5");

  spriteContext.fillStyle = gradient;
  spriteContext.strokeStyle = "#aeb9bf";
  spriteContext.lineWidth = 1.4;
  spriteContext.beginPath();
  spriteContext.arc(
    center,
    center,
    roundedRadius,
    0,
    Math.PI * 2
  );
  spriteContext.fill();
  spriteContext.stroke();

  ballSprite = sprite;
  ballSpriteRadius = roundedRadius;
  return sprite;
}

function drawBall(ball) {
  if (!ctx || ball.startTime === null) return;

  const sprite = getBallSprite(ball.radius);
  const halfWidth = sprite.width / 2;
  const halfHeight = sprite.height / 2;

  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.rotation);
  ctx.drawImage(
    sprite,
    -halfWidth,
    -halfHeight
  );
  ctx.restore();
}

function drawFrame(now) {
  if (!pageVisible) {
    animationFrame = requestAnimationFrame(drawFrame);
    return;
  }

  if (!ctx) {
    animationFrame = requestAnimationFrame(drawFrame);
    return;
  }

  const trapDoorAnimating =
    trapDoorState === "opening" ||
    trapDoorState === "closing" ||
    trapDoorState === "showing";

  const boardActive =
    activeBalls.length > 0 ||
    trapDoorAnimating ||
    Boolean(activePegFlash?.until > now);

  if (
    !boardActive &&
    now - lastIdleBoardFrameAt < 125
  ) {
    animationFrame = requestAnimationFrame(drawFrame);
    return;
  }

  if (!boardActive) {
    lastIdleBoardFrameAt = now;
  }

  drawBoard();

  for (const ball of activeBalls) {
    updateBall(ball, now);

    if (ball.startTime !== null && now >= ball.startTime) {
      drawBall(ball);
    }
  }

  animationFrame = requestAnimationFrame(drawFrame);
}

function clearAnimation() {
  activeBalls = [];
  landedBalls = [];
}

function releaseBalls() {
  clearAnimation();

  const mixerWidth = Math.max(1, holderAreaWidth || boardWidth);
  let accumulatedDelay = 0;

  holderState.forEach((holder, index) => {
    const targetIndex = targetIndexes[index];
    const random = seededRandom(
      hashSeed(animationSeed, activeRound, "release", index)
    );

    const releaseX = Math.max(
      28,
      Math.min(
        boardWidth - 28,
        (holder.chosenX / mixerWidth) * boardWidth
      )
    );

    if (index > 0) {
      accumulatedDelay += Math.round(random(115, 190));
    }

    holder.active = false;

    window.setTimeout(() => {
      holder.element.style.opacity = "0";
    }, accumulatedDelay);

    activeBalls.push(
      createBall(
        index,
        releaseX,
        targetIndex,
        accumulatedDelay
      )
    );
  });
}

async function finishRound() {
  if (!localRunning || finishPending) return;

  finishPending = true;
  localRunning = false;
  stopSound(audio.drumroll);
  holderFast = false;
  holderFastTravel = false;
  holderChoosing = false;

  const values = targetIndexes.map(index => COLORS[index]);

  showResults(values);
  status.textContent = `Result: ${values.join(" · ")}`;
  restoreHolder();
  playSound(audio.result);

  if (currentRoom) {
    currentRoom = {
      ...currentRoom,
      ballDropRolling: false,
      latestBallDropResult: values
    };
  }

  // The trap door must completely close before the round can be used again.
  status.textContent = "Closing trap door...";
  await closeTrapDoor();

  game?.removeAttribute("data-dropping");

  if (!isHost || !roomRef) {
    status.textContent = `Result: ${values.join(" · ")}`;
    finishPending = false;
    if (button) button.disabled = false;
    return;
  }

  try {
    let response;

    try {
      response = await finishSecureBallDrop({
        ...roomIdentity(),
        round: activeRound
      });
    } catch (firstError) {
      console.warn(
        "First Ball Drop finish attempt failed; retrying once.",
        firstError
      );

      await new Promise(resolve => setTimeout(resolve, 450));

      response = await finishSecureBallDrop({
        ...roomIdentity(),
        round: activeRound
      });
    }

    const saved = Array.isArray(response.data?.result)
      ? response.data.result
      : values;

    showResults(saved);
    addHostSessionDrop(saved);
    status.textContent = `Result: ${saved.join(" · ")}`;
  } catch (error) {
    console.error("Failed to finish Ball Drop:", error);

    // Prevent a failed finish request from leaving the shared room locked.
    await resetSharedBallDropSession();

    addHostSessionDrop(values);
    status.textContent =
      `Result: ${values.join(" · ")} (sync recovered)`;
  } finally {
    if (currentRoom) {
      currentRoom = {
        ...currentRoom,
        ballDropRolling: false,
        pendingBallDropResult: []
      };
    }

    finishPending = false;
    localRunning = false;
    game?.removeAttribute("data-dropping");

    if (button) button.disabled = false;

    window.dispatchEvent(
      new CustomEvent("perya-ball-drop-finished")
    );

    scheduleResponsiveResize();
  }
}

async function startDrop() {
  if (!isHost || localRunning || finishPending || !roomRef) return;

  if (!resizeCanvas()) {
    status.textContent = "Ball Drop board could not initialize.";
    return;
  }

  button.disabled = true;
  localRunning = true;
  game?.setAttribute("data-dropping", "true");
  resetResults();
  restoreHolder();
  resetTrapDoorClosed();

  const secureRequest = startSecureBallDrop(roomIdentity());

  startFastHorizontalMovement();
  status.textContent = "Balls moving at full speed...";
  const boostFinished = playSoundAndWait(audio.boost);

  let response;

  try {
    response = await secureRequest;
  } catch (error) {
    console.error("Failed to start Ball Drop:", error);
    localRunning = false;
    game?.removeAttribute("data-dropping");
    stopSound(audio.boost);
    stopSound(audio.drumroll);
    restoreHolder();
    button.disabled = false;
    status.textContent =
      error?.message || "Could not start Ball Drop.";
    return;
  }

  const secureStart = response.data || {};

  rebuildUi(
    secureStart.ballCount ||
    secureStart.result?.length ||
    ballCount
  );

  targetIndexes = normalizeResults(secureStart.result);
  activeRound = Number(secureStart.round || 0);
  animationSeed = Number(
    secureStart.animationSeed ||
    activeRound ||
    1
  );

  if (targetIndexes.length !== ballCount || !activeRound) {
    localRunning = false;
    game?.removeAttribute("data-dropping");
    stopSound(audio.boost);
    restoreHolder();
    button.disabled = false;
    status.textContent = "The secure Ball Drop result was invalid.";
    return;
  }

  const timeline = animationTimelineFrom(secureStart);

  await waitUntilSharedTime(
    timeline.slowdownAtMs,
    () => localRunning
  );
  if (!localRunning) return;

  lockPegLayout({ force: true });
  chooseAndStopDropPositions();
  status.textContent = "Balls slowing into position...";

  await Promise.all([
    sleep(holderStopDuration),
    waitUntilSharedTime(timeline.releaseAtMs, () => localRunning)
  ]);
  if (!localRunning) return;

  finishHorizontalChoices();
  status.textContent = "Balls locked in position...";

  await boostFinished;

  const pauseRandom = seededRandom(
    hashSeed(animationSeed, activeRound, "gate-pause")
  );
  await sleep(Math.round(pauseRandom(160, 240)));

  playSound(audio.release);
  status.textContent = "Trap door opening...";
  await openTrapDoor();

  status.textContent = "Balls dropping...";
  releaseBalls();
}

async function viewerDrop(
  round,
  pendingResult,
  seed,
  timelineSource = {}
) {
  if (localRunning || round === lastViewerRound) return;

  const runToken = ++viewerRunToken;
  lastViewerRound = round;

  rebuildUi(
    currentRoom?.ballDropBallCount ||
    pendingResult?.length ||
    ballCount
  );

  targetIndexes = normalizeResults(pendingResult);
  activeRound = Number(round || 0);
  animationSeed = Number(seed || activeRound || 1);

  if (targetIndexes.length !== ballCount || !resizeCanvas()) return;

  localRunning = true;
  game?.setAttribute("data-dropping", "true");
  resetResults();
  restoreHolder();
  resetTrapDoorClosed();

  const runIsStillValid = () =>
    runToken === viewerRunToken && localRunning;
  const timeline = animationTimelineFrom(timelineSource);

  startFastHorizontalMovement();
  status.textContent = "Balls moving at full speed...";
  const boostFinished = playSoundAndWait(audio.boost);

  const reachedSlowdown = await waitUntilSharedTime(
    timeline.slowdownAtMs,
    runIsStillValid
  );
  if (!reachedSlowdown || !runIsStillValid()) return;

  lockPegLayout({ force: true });
  chooseAndStopDropPositions();
  status.textContent = "Balls slowing into position...";

  await Promise.all([
    sleep(holderStopDuration),
    waitUntilSharedTime(timeline.releaseAtMs, runIsStillValid)
  ]);
  if (!runIsStillValid()) return;

  finishHorizontalChoices();
  status.textContent = "Balls locked in position...";

  await boostFinished;
  if (!runIsStillValid()) return;

  const pauseRandom = seededRandom(
    hashSeed(animationSeed, activeRound, "gate-pause")
  );
  await sleep(Math.round(pauseRandom(160, 240)));
  if (!runIsStillValid()) return;

  playSound(audio.release);
  status.textContent = "Trap door opening...";
  await openTrapDoor();

  if (!runIsStillValid()) {
    resetTrapDoorClosed();
    return;
  }

  status.textContent = "Balls dropping...";
  releaseBalls();
}

function applyRoom(detail) {
  currentRoom = detail.room;
  isHost = detail.isHost;
  roomRef = detail.roomRef;

  const mode =
    currentRoom?.gameMode === "ballDrop"
      ? "ballDrop"
      : "dice";

  const roomSessionKey = currentRoomSessionKey();

  const sharedViewerReset =
    !isHost &&
    currentRoom?.ballDropRolling !== true &&
    Array.isArray(currentRoom?.latestBallDropResult) &&
    currentRoom.latestBallDropResult.length === 0 &&
    Array.isArray(currentRoom?.ballDropHistory) &&
    currentRoom.ballDropHistory.length === 0 &&
    Array.isArray(currentRoom?.pendingBallDropResult) &&
    currentRoom.pendingBallDropResult.length === 0;

  if (sharedViewerReset) {
    resetViewerDropImmediately();
  }

  rebuildUi(
    currentRoom?.ballDropBallCount ||
    currentRoom?.pendingBallDropResult?.length ||
    3
  );

  game.hidden = mode !== "ballDrop";
  button.hidden = !isHost;
  waiting.hidden = isHost;

  if (mode !== "ballDrop") {
    viewerRunToken += 1;
    if (isHost && hostBallDropSessionActive) {
      resetSharedBallDropSession();
    }

    hostBallDropSessionActive = false;
    hostSessionRoomKey = "";
    resetBallDropSessionDisplay();
    return;
  }

  // Start a fresh Previous Drops list only when the host truly enters
  // or re-enters this Ball Drop room. Normal Firebase snapshots do not reset it.
  if (isHost) {
    const enteredNewSession =
      !hostBallDropSessionActive ||
      hostSessionRoomKey !== roomSessionKey;

    if (enteredNewSession) {
      hostBallDropSessionActive = true;
      hostSessionRoomKey = roomSessionKey;
      resetBallDropSessionDisplay();

      // Clear the shared visible session so all viewers reset too.
      resetSharedBallDropSession();
    }
  } else {
    hostBallDropSessionActive = false;
    hostSessionRoomKey = "";
    hostSessionHistory = [];
  }

  requestAnimationFrame(() =>
    requestAnimationFrame(resizeCanvas)
  );

  if (currentRoom?.ballDropRolling) {
    if (!isHost) {
      viewerDrop(
        Number(currentRoom.ballDropRound || 0),
        currentRoom.pendingBallDropResult,
        currentRoom.ballDropAnimationSeed,
        currentRoom
      );
      return;
    }

    if (localRunning || finishPending) return;
  }

  localRunning = false;
  holderFast = false;
  resetTrapDoorClosed();
  restoreHolder();

  const latest = Array.isArray(currentRoom?.latestBallDropResult)
    ? currentRoom.latestBallDropResult
    : [];

  // The host gets a clean session display after every entry/re-entry.
  // Viewers may continue seeing the room's saved Firebase state.
  if (isHost) {
    if (hostSessionHistory.length === 0) {
      resetResults();
      showHistory([]);
      status.textContent = "Ready to drop.";
    } else {
      showHistory(hostSessionHistory);
    }
  } else {
    if (latest.length) {
      showResults(latest);
    } else {
      resetResults();
    }

    showHistory(currentRoom?.ballDropHistory);
    status.textContent = latest.length
      ? `Result: ${latest.join(" · ")}`
      : "Waiting for the host.";
  }

  if (button) {
    button.disabled = Boolean(
      currentRoom?.rolling ||
      localRunning ||
      finishPending
    );
  }
}

button?.addEventListener("click", startDrop);


function resetSharedSessionOnHostExit() {
  if (!isHost || !roomRef || !hostBallDropSessionActive) return;

  // Firestore writes during pagehide are best-effort. The same reset is also
  // performed on the host's next entry, guaranteeing stale data is cleared.
  resetSharedBallDropSession();
}

window.addEventListener("pagehide", resetSharedSessionOnHostExit);
window.addEventListener("beforeunload", resetSharedSessionOnHostExit);

window.addEventListener(
  "perya-room-render",
  event => applyRoom(event.detail)
);

window.addEventListener("load", () => {
  initHolder();
  resetTrapDoorClosed();

  if (!animationFrame) {
    animationFrame = requestAnimationFrame(drawFrame);
  }

  if (isVisible()) {
    requestAnimationFrame(resizeCanvas);
  }
});

window.addEventListener(
  "resize",
  scheduleResponsiveResize,
  { passive: true }
);

if (window.ResizeObserver && board) {
  const observer = new ResizeObserver(
    scheduleResponsiveResize
  );

  observer.observe(board);
}

document.addEventListener("visibilitychange", () => {
  pageVisible = !document.hidden;

  if (pageVisible) {
    measureHolderGeometry();
    scheduleResponsiveResize();
    lastIdleBoardFrameAt = 0;
    lastHolderIdleFrameAt = 0;
  }
});
