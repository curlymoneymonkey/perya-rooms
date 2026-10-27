Scope: ONLY the special “1 to 6 Dice” mode.

Files:
- script.js: preserves the existing white-dice pre-roll fade and multiplication animation. It uses one predetermined queue entry for both the count (the entry length) and the exact colors, rather than consuming a second entry for colors. The existing fixed-count roll branch is unchanged.
- index.js: supports variable-length queued results only when the room flag oneToSixDiceMode is true; fixed-count queues retain fixed-count validation/normalization.
- irothemfkingdogadmin.js: lets the admin edit each future roll's count (1–6 in this mode) and each die's color; queue entries are no longer padded to six.
- irothemfkingdogadmin.html: unchanged.

Important: back up existing files first. This has syntax checks only; it has not been deployed or tested against live Firebase.
