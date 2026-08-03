STABLE + OPTIMIZED UPDATE

Critical fixes:
1. Added sounds/ball-drop/drum_roll.mp3 to stop the 404 error.
2. Fixed Firebase finishSecureBallDrop INTERNAL error.
   Cause: Firestore does not support nested arrays.
   Ball Drop history is now stored as comma-separated rows.
3. finishSecureBallDrop retries once after a temporary failure.
4. If both attempts fail, the shared Ball Drop lock is cleared safely.
5. Game and quantity settings unlock when the local round finishes.
6. Stale ballDropRolling state no longer permanently locks the controls.

Resize fix:
- Holder ball coordinates scale proportionally with the mixer width.
- Idle, moving, stopping, and selected positions stay aligned.
- Active falling routes keep their original geometry and the whole canvas
  scales visually until the round finishes.
- The actual board geometry is rebuilt after the round.

Optimizations:
- Cached holder width and ball radius instead of measuring every frame.
- Holder idle animation reduced to about 20 FPS; active movement stays full FPS.
- Board idle rendering reduced to 8 FPS; drops and door animations stay full FPS.
- Falling-ball radial gradient is cached as a reusable canvas sprite.
- Window resize and ResizeObserver now share one requestAnimationFrame scheduler.
- Rendering pauses while the tab is hidden and resumes safely.
- Mobile shadows and canvas filters are reduced without changing layout.
- Existing Firebase probability, secure queue, seeded routes, trap door,
  game settings, 30-Dice limit, and 6-Ball limit remain intact.

Deployment:
- Replace all website/admin files from this package.
- Replace functions/index.js.
- Make sure the included sounds folder is uploaded.
- Deploy:
  firebase deploy --only functions
