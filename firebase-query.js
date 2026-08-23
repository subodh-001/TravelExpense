#!/usr/bin/env node
/**
 * 🔥 Firebase Firestore Query CLI Tool
 * Usage:
 *   node firebase-query.js GET users
 *   node firebase-query.js GET expenses
 *   node firebase-query.js GET users WHERE role==super_admin
 *   node firebase-query.js GET expenses WHERE paymentStatus==pending
 *   node firebase-query.js GET users WHERE email==subodhram3350@gmail.com
 *   node firebase-query.js COUNT users
 *   node firebase-query.js COUNT expenses
 *   node firebase-query.js COLLECTIONS
 */

// Load firebase-admin from backend/node_modules
const path  = require('path');
const admin = require(path.join(__dirname, 'backend', 'node_modules', 'firebase-admin'));

// ── Init Firebase ─────────────────────────────────────────────────────────────
const serviceAccount = require('./backend/firebase-admin.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = (args[0] || '').toUpperCase();

async function run() {
  // ── COLLECTIONS: list all top-level collections ───────────────────────────
  if (cmd === 'COLLECTIONS') {
    console.log('\n📂 Listing all Firestore Collections...\n');
    const cols = await db.listCollections();
    if (!cols.length) { console.log('(no collections found)'); return; }
    cols.forEach((c, i) => console.log(`  ${i + 1}. ${c.id}`));
    console.log('');
    return;
  }

  // ── COUNT ─────────────────────────────────────────────────────────────────
  if (cmd === 'COUNT') {
    const collection = args[1];
    if (!collection) { console.error('Usage: node firebase-query.js COUNT <collection>'); process.exit(1); }
    console.log(`\n🔢 Counting documents in '${collection}'...\n`);
    const snap = await db.collection(collection).get();
    console.log(`  Total documents: ${snap.size}\n`);
    return;
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (cmd === 'GET') {
    const collection = args[1];
    if (!collection) { console.error('Usage: node firebase-query.js GET <collection> [WHERE field==value]'); process.exit(1); }

    // Parse optional WHERE clause: WHERE field==value
    let query = db.collection(collection);
    const whereIdx = args.findIndex(a => a.toUpperCase() === 'WHERE');
    if (whereIdx !== -1 && args[whereIdx + 1]) {
      const condition = args[whereIdx + 1];
      const match = condition.match(/^(.+?)(==|!=|>=|<=|>|<)(.+)$/);
      if (!match) {
        console.error(`❌ Invalid WHERE format. Use: WHERE field==value`);
        process.exit(1);
      }
      const [, field, op, rawVal] = match;
      // Auto-cast value types
      let val = rawVal;
      if (rawVal === 'true') val = true;
      else if (rawVal === 'false') val = false;
      else if (!isNaN(rawVal) && rawVal !== '') val = Number(rawVal);
      query = query.where(field, op, val);
      console.log(`\n🔍 Querying '${collection}' WHERE ${field} ${op} ${rawVal}...\n`);
    } else {
      console.log(`\n🔍 Fetching all documents from '${collection}'...\n`);
    }

    const snap = await query.get();

    if (snap.empty) {
      console.log('  (no documents found)\n');
      return;
    }

    const rows = [];
    snap.forEach(doc => {
      rows.push({ _id: doc.id, ...doc.data() });
    });

    // Pretty print as table
    console.table(rows.map(r => {
      // Truncate long values for display
      const clean = {};
      Object.keys(r).forEach(k => {
        let v = r[k];
        if (typeof v === 'string' && v.length > 50) v = v.slice(0, 47) + '...';
        if (typeof v === 'object' && v !== null) v = JSON.stringify(v).slice(0, 50);
        clean[k] = v;
      });
      return clean;
    }));

    console.log(`\n✅ ${snap.size} document(s) returned from '${collection}'.\n`);
    return;
  }

  // ── Help / Unknown ────────────────────────────────────────────────────────
  console.log(`
🔥 Firebase Firestore Query CLI Tool
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  COMMANDS:
  ─────────────────────────────────────────────────────
  node firebase-query.js COLLECTIONS
      → List all collections in Firestore

  node firebase-query.js COUNT <collection>
      → Count all documents in a collection

  node firebase-query.js GET <collection>
      → Fetch all documents from a collection

  node firebase-query.js GET <collection> WHERE <field>==<value>
      → Filter documents by a field value

  EXAMPLES:
  ─────────────────────────────────────────────────────
  node firebase-query.js GET users
  node firebase-query.js GET expenses
  node firebase-query.js COUNT users
  node firebase-query.js COLLECTIONS
  node firebase-query.js GET users WHERE role==super_admin
  node firebase-query.js GET expenses WHERE paymentStatus==pending
  node firebase-query.js GET users WHERE email==subodhram3350@gmail.com
`);
}

run().then(() => process.exit(0)).catch(err => {
  console.error('\n❌ Firebase Error:', err.message, '\n');
  process.exit(1);
});
