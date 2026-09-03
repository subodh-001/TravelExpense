/**
 * Sync Local / Live Server Data into Supabase PostgreSQL Database
 * Run: node sync-to-supabase.js
 */
const path = require('path');
const fs = require('fs');
require(path.join(__dirname, 'backend', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, 'backend', '.env') });
const { createClient } = require(path.join(__dirname, 'backend', 'node_modules', '@supabase', 'supabase-js'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in backend/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('\n🚀 Starting Local Data Sync into Supabase...\n');

  const USERS_PATH = path.join(__dirname, 'backend', 'data', 'users.json');
  const EXPENSES_PATH = path.join(__dirname, 'backend', 'data', 'expenses.json');

  if (fs.existsSync(USERS_PATH)) {
    const usersObj = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8') || '{}');
    const userRows = Object.entries(usersObj).map(([uid, u]) => ({
      id: u.id || uid,
      name: u.name || 'User',
      email: u.email || '',
      role: u.role || 'user',
      verified: u.verified !== false,
      picture: u.picture || '',
      password_hash: u.passwordHash || '',
      last_active: u.lastActive || null,
      whatsapp: u.whatsapp || '',
      whatsapp_verified: Boolean(u.whatsappVerified),
      phone: u.phone || '',
      telegram_chat_id: u.telegramChatId || '',
      telegram_username: u.telegramUsername || '',
      telegram_verified: Boolean(u.telegramVerified),
      payment_bill_url: u.paymentBillUrl || '',
      updated_at: u.updatedAt || new Date().toISOString()
    }));

    if (userRows.length > 0) {
      const { error } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
      if (error) console.error('  ❌ Users Sync Error:', error.message);
      else console.log(`  ✅ Synced ${userRows.length} users to Supabase`);
    }
  }

  if (fs.existsSync(EXPENSES_PATH)) {
    const expList = JSON.parse(fs.readFileSync(EXPENSES_PATH, 'utf8') || '[]');
    const expenseRows = expList.map(e => ({
      id: e.id,
      user_id: e.userId,
      date: e.date || new Date().toISOString().split('T')[0],
      location: e.location || '',
      notes: e.notes || '',
      total: Number(e.total || 0),
      entries: Array.isArray(e.entries) ? e.entries : [],
      receipts: Array.isArray(e.receipts) ? e.receipts : [],
      payment_status: e.paymentStatus || 'pending',
      payment_bill_url: e.paymentBillUrl || '',
      settled_at: e.settledAt || null,
      source: e.source || '',
      created_at: e.createdAt || new Date().toISOString(),
      updated_at: e.updatedAt || new Date().toISOString()
    }));

    if (expenseRows.length > 0) {
      const { error } = await supabase.from('expenses').upsert(expenseRows, { onConflict: 'id' });
      if (error) console.error('  ❌ Expenses Sync Error:', error.message);
      else console.log(`  ✅ Synced ${expenseRows.length} expenses to Supabase`);
    }
  }

  console.log('\n🎉 Supabase sync complete!\n');
  console.log('Now run:');
  console.log('  node supabase-query.js TABLES');
  console.log('  node supabase-query.js GET users');
  console.log('  node supabase-query.js GET expenses\n');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
