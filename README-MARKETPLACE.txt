PERYA DICE MARKETPLACE — UPDATED PACKAGE

Included:
- Profile shop and standalone shop
- Multi-item cart and checkout
- GCash seller information and QR
- Required reference number, payment proof and IGN
- Optional refund name and refund GCash number
- Immediate Firestore stock reservation
- Seller Customer Orders page
- Complete Order with delivery proof and notes
- Reject Order with automatic stock restoration
- Registered buyer My Orders page
- Registered-user 2-minute cooldown and guest 5-minute cooldown
- Seller guest-order setting
- Updated Firestore and Storage rule files

IMPORTANT DEPLOYMENT STEPS
1. Copy these files into the matching locations in your project.
2. Keep your existing images, permissions.js, account-menu.js, dashboard files and other shared files.
3. Run: firebase deploy --only firestore:rules,storage
4. In functions/: run npm install, then firebase deploy --only functions
5. Firestore collection-group queries for My Orders may ask you to create an index for collection group "orders" and field buyerUid. Use the Firebase console link shown in the browser error.
6. Test checkout, rejection stock restoration, delivery proof visibility and guest checkout in a test Firebase project before production use.

Order statuses:
- order_sent
- completed
- rejected
