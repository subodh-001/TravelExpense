/**
 * Sync Live (Render) data into Firebase Firestore
 * Run: node sync-to-firestore.js
 */
const path  = require('path');
const admin = require(path.join(__dirname, 'backend', 'node_modules', 'firebase-admin'));
const sa    = require('./backend/firebase-admin.json');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const httpFetch = (...args) =>
  import(path.join(__dirname, 'backend', 'node_modules', 'node-fetch', 'src', 'index.js'))
    .then(({ default: fetch }) => fetch(...args));

async function main() {
  console.log('\n🚀 Fetching Live (Render) data...\n');

  const res  = await fetch('https://travelexpense-52gp.onrender.com/api/sync/export');
  const data = await res.json();

  const users    = data.users    || {};
  const expenses = data.expenses || [];

  console.log(`📦 Users to sync:    ${Object.keys(users).length}`);
  console.log(`📦 Expenses to sync: ${expenses.length}\n`);

  // --- Write users ---
  const batch1 = db.batch();
  let uCount = 0;
  for (const [uid, u] of Object.entries(users)) {
    const ref = db.collection('users').doc(uid);
    batch1.set(ref, {
      id:             u.id    || uid,
      name:           u.name  || '',
      email:          u.email || '',
      role:           u.role  || 'user',
      verified:       !!u.verified,
      picture:        u.picture        || '',
      paymentBillUrl: u.paymentBillUrl || '',
      updatedAt:      u.updatedAt      || new Date().toISOString(),
    }, { merge: true });
    uCount++;
  }
  await batch1.commit();
  console.log(`✅ ${uCount} users written to Firestore`);

  // --- Write expenses (in batches of 500) ---
  let eCount = 0;
  for (let i = 0; i < expenses.length; i += 450) {
    const chunk = expenses.slice(i, i + 450);
    const batch  = db.batch();
    chunk.forEach(e => {
      const ref = db.collection('expenses').doc(e.id || `exp_${Date.now()}_${Math.random()}`);
      batch.set(ref, {
        id:             e.id            || '',
        userId:         e.userId        || '',
        date:           e.date          || '',
        location:       e.location      || '',
        notes:          e.notes         || '',
        total:          e.total         || 0,
        paymentStatus:  e.paymentStatus || 'pending',
        paymentBillUrl: e.paymentBillUrl|| '',
        settledAt:      e.settledAt     || '',
        createdAt:      e.createdAt     || new Date().toISOString(),
      }, { merge: true });
      eCount++;
    });
    await batch.commit();
  }
  console.log(`✅ ${eCount} expenses written to Firestore`);

  console.log('\n🎉 Firestore sync complete!\n');
  console.log('Now run:');
  console.log('  node firebase-query.js COLLECTIONS');
  console.log('  node firebase-query.js GET users');
  console.log('  node firebase-query.js GET expenses\n');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
