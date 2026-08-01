// =========================================================
// ROLL TIMING SETTINGS
// =========================================================

// Time between the sound starting and the colored dice appearing.
// 0 = reveal immediately when the sound starts.
// 150 = recommended.
export const RESULT_REVEAL_AFTER_SOUND_MS = 2000;

// =========================================================
// PREPARING DICE WOBBLE SETTINGS
// =========================================================

// Lower number = faster wobble.
// Examples: 1800 = slow, 1200 = moderate, 900 = lively, 650 = fast.
export const PREPARING_WOBBLE_DURATION_MS = 2000;

// Higher number = stronger left/right rotation.
// Recommended range: 2 to 5 degrees.
export const PREPARING_WOBBLE_ROTATION_DEG = 7;

// Higher number = bigger upward bounce in pixels.
// Recommended range: 1 to 5 pixels.
export const PREPARING_WOBBLE_BOUNCE_PX = 5;
