const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'travel_expense.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for high performance
db.pragma('journal_mode = WAL');

// Initialize SQL Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT DEFAULT 'user',
    picture TEXT,
    verified INTEGER DEFAULT 1,
    payment_bill_url TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT,
    notes TEXT,
    total REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'pending',
    payment_bill_url TEXT,
    settled_at TEXT,
    created_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Function to sync JSON data into SQLite tables
function syncJSONToSQLite() {
  try {
    const usersPath = path.join(__dirname, 'data', 'users.json');
    const expensesPath = path.join(__dirname, 'data', 'expenses.json');

    if (fs.existsSync(usersPath)) {
      const usersObj = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '{}');
      const insertUser = db.prepare(`
        INSERT OR REPLACE INTO users (id, name, email, role, picture, verified, payment_bill_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertManyUsers = db.transaction((usersMap) => {
        for (const uid in usersMap) {
          const u = usersMap[uid];
          insertUser.run(
            u.id || uid,
            u.name || 'User',
            u.email || '',
            u.role || 'user',
            u.picture || '',
            u.verified ? 1 : 0,
            u.paymentBillUrl || '',
            u.updatedAt || new Date().toISOString()
          );
        }
      });
      insertManyUsers(usersObj);
    }

    if (fs.existsSync(expensesPath)) {
      const expArray = JSON.parse(fs.readFileSync(expensesPath, 'utf8') || '[]');
      const insertExp = db.prepare(`
        INSERT OR REPLACE INTO expenses (id, user_id, date, location, notes, total, payment_status, payment_bill_url, settled_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertManyExp = db.transaction((expList) => {
        for (const e of expList) {
          insertExp.run(
            e.id,
            e.userId || '',
            e.date || '',
            e.location || '',
            e.notes || '',
            e.total || 0,
            e.paymentStatus || 'pending',
            e.paymentBillUrl || '',
            e.settledAt || '',
            e.createdAt || new Date().toISOString()
          );
        }
      });
      insertManyExp(expArray);
    }
  } catch (err) {
    console.error('⚠️ SQLite Sync Error:', err.message);
  }
}

// Run initial sync
syncJSONToSQLite();

module.exports = { db, syncJSONToSQLite };
