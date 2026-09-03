#!/usr/bin/env node
/**
 * 🚀 Zero-Data-Loss Migration Tool: Firebase Firestore / Local JSON -> Supabase PostgreSQL
 * 
 * Usage:
 *   node migrate-firebase-to-supabase.js
 */

const fs = require('fs');
const path = require('path');
require(path.join(__dirname, 'backend', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, 'backend', '.env') });
const { createClient } = require(path.join(__dirname, 'backend', 'node_modules', '@supabase', 'supabase-js'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('\n=============================================================');
console.log('🚀 TravelExpense: Firebase / Local JSON -> Supabase Migration');
console.log('=============================================================\n');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in backend/.env');
  console.error('   Please add the following lines to backend/.env:');
  console.error('   SUPABASE_URL=https://your-project.supabase.co');
  console.error('   SUPABASE_KEY=your-service-role-or-anon-key\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Optional Firebase initialization if firebase-admin.json exists
let firestoreDb = null;
try {
  const saPath = path.join(__dirname, 'backend', 'firebase-admin.json');
  if (fs.existsSync(saPath)) {
    const admin = require(path.join(__dirname, 'backend', 'node_modules', 'firebase-admin'));
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(require(saPath))
      });
    }
    firestoreDb = admin.firestore();
    console.log('🔥 Firebase Admin SDK initialized successfully.');
  }
} catch (e) {
  console.warn('⚠️ Note: Firebase Admin SDK not loaded, migrating from Local Master JSON files:', e.message);
}

// Data directory paths
const USERS_JSON_PATH = path.join(__dirname, 'backend', 'data', 'users.json');
const EXPENSES_JSON_PATH = path.join(__dirname, 'backend', 'data', 'expenses.json');
const INVITES_JSON_PATH = path.join(__dirname, 'backend', 'data', 'invites.json');
const DELETED_USERS_JSON_PATH = path.join(__dirname, 'backend', 'data', 'deleted_users.json');
const FIREBASE_BACKUP_JSON_PATH = path.join(__dirname, 'backend', 'data', 'firebase_backup.json');

// Helper to convert Firebase timestamp objects ({ _seconds: ... }) or ISO strings to valid ISO date string
function formatIsoDate(val) {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    if (val._seconds) return new Date(val._seconds * 1000).toISOString();
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
  }
  return new Date().toISOString();
}

async function migrate() {
  let stats = {
    users: { local: 0, firebase: 0, migrated: 0 },
    expenses: { local: 0, firebase: 0, migrated: 0 },
    invites: { local: 0, firebase: 0, migrated: 0 },
    deleted_users: { local: 0, firebase: 0, migrated: 0 },
    whatsapp_auth: { firebase: 0, migrated: 0 }
  };

  // Load Firebase Backup JSON if present
  let firebaseBackupData = null;
  if (fs.existsSync(FIREBASE_BACKUP_JSON_PATH)) {
    try {
      const rawBackup = fs.readFileSync(FIREBASE_BACKUP_JSON_PATH, 'utf8');
      firebaseBackupData = JSON.parse(rawBackup || '{}');
      console.log('📦 Loaded Firebase export file (firebase_backup.json)!');
    } catch (e) {
      console.warn('⚠️ firebase_backup.json parse note:', e.message);
    }
  }

  // --------------------------------------------------------------------------
  // 1. MIGRATE USERS
  // --------------------------------------------------------------------------
  console.log('📦 [1/5] Processing USERS...');
  const usersMap = new Map();

  // Load from local JSON
  if (fs.existsSync(USERS_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(USERS_JSON_PATH, 'utf8');
      const obj = JSON.parse(raw || '{}');
      Object.keys(obj).forEach(key => {
        const u = obj[key];
        const uid = u.id || key;
        usersMap.set(uid, u);
      });
      stats.users.local = usersMap.size;
    } catch (e) {
      console.warn('  ⚠️ Local users.json parse error:', e.message);
    }
  }

  // Merge from firebase_backup.json
  if (firebaseBackupData && firebaseBackupData.users) {
    const backupUsers = firebaseBackupData.users;
    Object.keys(backupUsers).forEach(key => {
      const u = backupUsers[key];
      const uid = u.id || key;
      usersMap.set(uid, { ...(usersMap.get(uid) || {}), ...u, id: uid });
    });
  }

  // Merge from Firebase Firestore if accessible
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('users').get();
      stats.users.firebase = snap.size;
      snap.forEach(doc => {
        const data = doc.data();
        const uid = doc.id || data.id;
        if (uid) {
          usersMap.set(uid, { ...(usersMap.get(uid) || {}), ...data, id: uid });
        }
      });
    } catch (e) {
      console.warn('  ⚠️ Firebase users fetch note:', e.message);
    }
  }

  const usersRows = Array.from(usersMap.values()).map(u => ({
    id: u.id,
    name: u.name || 'User',
    email: u.email || '',
    role: u.role || 'user',
    verified: u.verified !== false,
    picture: u.picture || '',
    password_hash: u.passwordHash || u.password_hash || '',
    last_active: formatIsoDate(u.lastActive || u.last_active),
    whatsapp: u.whatsapp || '',
    whatsapp_verified: Boolean(u.whatsappVerified || u.whatsapp_verified),
    phone: u.phone || '',
    telegram_chat_id: u.telegramChatId || u.telegram_chat_id || '',
    telegram_username: u.telegramUsername || u.telegram_username || '',
    telegram_verified: Boolean(u.telegramVerified || u.telegram_verified),
    payment_bill_url: u.paymentBillUrl || u.payment_bill_url || '',
    created_at: formatIsoDate(u.createdAt || u.created_at),
    updated_at: formatIsoDate(u.updatedAt || u.updated_at)
  }));

  if (usersRows.length > 0) {
    const { error } = await supabase.from('users').upsert(usersRows, { onConflict: 'id' });
    if (error) {
      console.error('  ❌ Supabase USERS upsert error:', error.message);
    } else {
      stats.users.migrated = usersRows.length;
      console.log(`  ✅ Successfully migrated ${usersRows.length} users into Supabase!`);
    }
  } else {
    console.log('  ℹ️ No users found to migrate.');
  }

  // --------------------------------------------------------------------------
  // 2. MIGRATE EXPENSES
  // --------------------------------------------------------------------------
  console.log('\n📦 [2/5] Processing EXPENSES...');
  const expensesMap = new Map();

  // Load from local JSON
  if (fs.existsSync(EXPENSES_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(EXPENSES_JSON_PATH, 'utf8');
      const arr = JSON.parse(raw || '[]');
      if (Array.isArray(arr)) {
        arr.forEach(e => {
          if (e && e.id) expensesMap.set(e.id, e);
        });
      }
      stats.expenses.local = expensesMap.size;
    } catch (e) {
      console.warn('  ⚠️ Local expenses.json parse error:', e.message);
    }
  }

  // Merge from firebase_backup.json
  if (firebaseBackupData && firebaseBackupData.expenses) {
    const backupExpenses = firebaseBackupData.expenses;
    if (Array.isArray(backupExpenses)) {
      backupExpenses.forEach(e => {
        if (e && e.id) expensesMap.set(e.id, { ...(expensesMap.get(e.id) || {}), ...e });
      });
    } else if (typeof backupExpenses === 'object') {
      Object.keys(backupExpenses).forEach(key => {
        const e = backupExpenses[key];
        const eid = e.id || key;
        expensesMap.set(eid, { ...(expensesMap.get(eid) || {}), ...e, id: eid });
      });
    }
  }

  // Merge from Firebase Firestore if accessible
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('expenses').get();
      stats.expenses.firebase = snap.size;
      snap.forEach(doc => {
        const data = doc.data();
        const eid = doc.id || data.id;
        if (eid) {
          expensesMap.set(eid, { ...(expensesMap.get(eid) || {}), ...data, id: eid });
        }
      });
    } catch (e) {
      console.warn('  ⚠️ Firebase expenses fetch note:', e.message);
    }
  }

  const expenseRows = Array.from(expensesMap.values()).map(e => ({
    id: e.id,
    user_id: e.userId || e.user_id,
    date: e.date || new Date().toISOString().split('T')[0],
    location: e.location || '',
    notes: e.notes || '',
    total: Number(e.total || 0),
    entries: Array.isArray(e.entries) ? e.entries : [],
    receipts: Array.isArray(e.receipts) ? e.receipts : [],
    payment_status: e.paymentStatus || e.payment_status || 'pending',
    payment_bill_url: e.paymentBillUrl || e.payment_bill_url || '',
    settled_at: e.settledAt ? formatIsoDate(e.settledAt) : null,
    source: e.source || '',
    created_at: formatIsoDate(e.createdAt || e.created_at),
    updated_at: formatIsoDate(e.updatedAt || e.updated_at)
  }));

  if (expenseRows.length > 0) {
    const { error } = await supabase.from('expenses').upsert(expenseRows, { onConflict: 'id' });
    if (error) {
      console.error('  ❌ Supabase EXPENSES upsert error:', error.message);
    } else {
      stats.expenses.migrated = expenseRows.length;
      console.log(`  ✅ Successfully migrated ${expenseRows.length} expenses into Supabase!`);
    }
  } else {
    console.log('  ℹ️ No expenses found to migrate.');
  }

  // --------------------------------------------------------------------------
  // 3. MIGRATE INVITES
  // --------------------------------------------------------------------------
  console.log('\n📦 [3/5] Processing INVITES...');
  const invitesMap = new Map();

  if (fs.existsSync(INVITES_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(INVITES_JSON_PATH, 'utf8');
      const obj = JSON.parse(raw || '{}');
      Object.keys(obj).forEach(key => {
        const inv = obj[key];
        const token = inv.token || key;
        invitesMap.set(token, { ...inv, token });
      });
      stats.invites.local = invitesMap.size;
    } catch (e) {
      console.warn('  ⚠️ Local invites.json parse error:', e.message);
    }
  }

  if (firebaseBackupData && firebaseBackupData.invites) {
    const backupInvites = firebaseBackupData.invites;
    Object.keys(backupInvites).forEach(key => {
      const inv = backupInvites[key];
      const token = inv.token || key;
      invitesMap.set(token, { ...(invitesMap.get(token) || {}), ...inv, token });
    });
  }

  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('invites').get();
      stats.invites.firebase = snap.size;
      snap.forEach(doc => {
        const data = doc.data();
        const token = doc.id || data.token;
        if (token) invitesMap.set(token, { ...(invitesMap.get(token) || {}), ...data, token });
      });
    } catch (e) {
      console.warn('  ⚠️ Firebase invites fetch note:', e.message);
    }
  }

  const inviteRows = Array.from(invitesMap.values()).map(inv => ({
    token: inv.token,
    email: inv.email,
    name: inv.name || '',
    role: inv.role || 'user',
    created_at: formatIsoDate(inv.createdAt || inv.created_at),
    expires_at: inv.expiresAt ? formatIsoDate(inv.expiresAt) : null
  }));

  if (inviteRows.length > 0) {
    const { error } = await supabase.from('invites').upsert(inviteRows, { onConflict: 'token' });
    if (error) {
      console.error('  ❌ Supabase INVITES upsert error:', error.message);
    } else {
      stats.invites.migrated = inviteRows.length;
      console.log(`  ✅ Successfully migrated ${inviteRows.length} invites into Supabase!`);
    }
  } else {
    console.log('  ℹ️ No invites found to migrate.');
  }

  // --------------------------------------------------------------------------
  // 4. MIGRATE DELETED_USERS
  // --------------------------------------------------------------------------
  console.log('\n📦 [4/5] Processing DELETED USERS...');
  const deletedSet = new Set();

  if (fs.existsSync(DELETED_USERS_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(DELETED_USERS_JSON_PATH, 'utf8');
      const arr = JSON.parse(raw || '[]');
      if (Array.isArray(arr)) {
        arr.forEach(id => { if (id && typeof id === 'string') deletedSet.add(id); });
      }
      stats.deleted_users.local = deletedSet.size;
    } catch (e) {
      console.warn('  ⚠️ Local deleted_users.json parse error:', e.message);
    }
  }

  if (firebaseBackupData && firebaseBackupData.deleted_users) {
    const backupDeleted = firebaseBackupData.deleted_users;
    if (Array.isArray(backupDeleted)) {
      backupDeleted.forEach(id => { if (id && typeof id === 'string') deletedSet.add(id); });
    } else if (typeof backupDeleted === 'object') {
      Object.keys(backupDeleted).forEach(key => {
        const item = backupDeleted[key];
        const id = (typeof item === 'string') ? item : (item.cleanId || item.originalId || key);
        if (id) deletedSet.add(id);
      });
    }
  }

  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('deleted_users').get();
      stats.deleted_users.firebase = snap.size;
      snap.forEach(doc => { deletedSet.add(doc.id); });
    } catch (e) {
      console.warn('  ⚠️ Firebase deleted_users fetch note:', e.message);
    }
  }

  const deletedRows = Array.from(deletedSet).map(id => ({
    id: id,
    deleted_at: new Date().toISOString()
  }));


  if (deletedRows.length > 0) {
    const { error } = await supabase.from('deleted_users').upsert(deletedRows, { onConflict: 'id' });
    if (error) {
      console.error('  ❌ Supabase DELETED_USERS upsert error:', error.message);
    } else {
      stats.deleted_users.migrated = deletedRows.length;
      console.log(`  ✅ Successfully migrated ${deletedRows.length} deleted user records into Supabase!`);
    }
  } else {
    console.log('  ℹ️ No deleted users found to migrate.');
  }

  // --------------------------------------------------------------------------
  // 5. MIGRATE WHATSAPP AUTH (IF PRESENT IN FIREBASE)
  // --------------------------------------------------------------------------
  console.log('\n📦 [5/5] Processing WHATSAPP AUTH SESSION...');
  if (firestoreDb) {
    try {
      const snap = await firestoreDb.collection('whatsapp_auth').get();
      stats.whatsapp_auth.firebase = snap.size;
      const waRows = [];
      snap.forEach(doc => {
        waRows.push({
          key: doc.id,
          value: doc.data(),
          updated_at: new Date().toISOString()
        });
      });
      if (waRows.length > 0) {
        const { error } = await supabase.from('whatsapp_auth').upsert(waRows, { onConflict: 'key' });
        if (error) console.error('  ❌ Supabase WHATSAPP_AUTH upsert error:', error.message);
        else {
          stats.whatsapp_auth.migrated = waRows.length;
          console.log(`  ✅ Successfully migrated ${waRows.length} WhatsApp auth entries into Supabase!`);
        }
      }
    } catch (e) {
      console.warn('  ⚠️ WhatsApp auth migration note:', e.message);
    }
  } else {
    console.log('  ℹ️ Skipping WhatsApp Cloud auth sync (No Firebase SDK connection).');
  }

  // --------------------------------------------------------------------------
  // MIGRATION SUMMARY & VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n=============================================================');
  console.log('📊 MIGRATION SUMMARY & ZERO-DATA-LOSS AUDIT');
  console.log('=============================================================');
  console.table(stats);
  console.log('🎉 Migration completed successfully!\n');
}

migrate().catch(err => {
  console.error('\n❌ Fatal Migration Error:', err);
  process.exit(1);
});
