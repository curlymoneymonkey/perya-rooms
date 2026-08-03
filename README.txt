COMPLETE REWRITE

Website files updated:
- room.html
- room.js
- ball-drop.css
- ball-drop.js
- index.html
- firebase.js
- roll-settings.js

Admin files updated:
- irothemfkingdogadmin.html
- irothemfkingdogadmin.js
- imamonkeyandilovemoney.html
- imamonkeyandilovemoney.css

Firebase Functions:
- functions/index.js

Changes:
- Formal centered Game Settings card.
- Positioned above PERYA-ROOMS.COM / Dice Skin.
- Game selector: Color Dice or Ball Drop.
- Color Dice quantity: 1–30 Dice.
- Ball Drop quantity: 1–6 Balls.
- Frontend Dice clamp changed to 30.
- Firebase MAX_DICE changed to 30.
- Secure queue generation and validation now use MAX_DICE = 30.
- Secure future-roll decoding accepts up to 30 dice.
- Admin future-roll rows scroll horizontally for large 30-dice results.
- Ball Drop remains securely limited to 6 balls.
- Existing Dice and Ball Drop session-reset behavior is preserved.

Important:
The ZIP did not contain script.js, which index.html loads for guest rooms.
The permanent-room implementation is fully updated.
If guest rooms also need a visible 1–30 selector, upload script.js so its frontend clamp and options can be updated too.

Deployment:
1. Replace the website/admin files.
2. Replace functions/index.js.
3. Run:
   firebase deploy --only functions
