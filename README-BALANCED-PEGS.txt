BALANCED PEG BOARD + NATURAL ROUTES

Fairness:
- Firebase still selects each of the six colors independently.
- Every color remains 1 out of 6 (16.6667%) when the secure queue is random.
- Peg physics does not choose or change the result.
- The board is a visual replay of the already-secure result.

Peg layout:
- Perfectly mirrored around the board center.
- Peg spacing is exactly half one result-slot width.
- Equal peg density above all six result slots.
- 15 rows on desktop.
- 12 rows on mobile.
- Alternating staggered rows.
- Smaller, denser pegs for more natural deflections.

Route planner:
- Uses only nearby pegs; no large invisible jumps.
- Uses constrained beam search instead of greedy late steering.
- Gradually approaches the selected result from the first row onward.
- Adds a small seeded wave so routes do not look straight or identical.
- Penalizes rapid left/right reversals.
- Prevents overly long one-direction sweeps.
- Checks the final lower-row approach before choosing a route.
- Uses the same Firebase animation seed for host and viewers.

Smoothness:
- More route samples per segment.
- Softer curves around peg contacts.
- Peg contact occurs slightly above center.
- Four-stage funnel approach removes last-moment snapping.
- Entrance curve is nearly straight and gravity-like.

Existing secure probability, 30-Dice limit, 6-Ball limit, session resets,
trap door, resize fix, and performance optimizations remain unchanged.

Deployment:
- Replace all included website/admin files.
- Replace functions/index.js only if you have not deployed the prior stable fix.
- Upload the included sounds folder.
- Deploy functions when needed:
  firebase deploy --only functions
