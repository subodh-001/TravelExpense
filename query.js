#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const usersFile = path.join(__dirname, 'backend', 'data', 'users.json');
const expensesFile = path.join(__dirname, 'backend', 'data', 'expenses.json');

const sqlQuery = (process.argv[2] || 'SELECT * FROM users;').trim();

console.log(`\n🔍 Executing SQL Query: \x1b[36m${sqlQuery}\x1b[0m\n`);

try {
  let users = {};
  let expenses = [];

  if (fs.existsSync(usersFile)) {
    users = JSON.parse(fs.readFileSync(usersFile, 'utf8') || '{}');
  }
  if (fs.existsSync(expensesFile)) {
    expenses = JSON.parse(fs.readFileSync(expensesFile, 'utf8') || '[]');
  }

  // Pure JS SQL Parser
  const upperQuery = sqlQuery.toUpperCase();
  
  if (upperQuery.startsWith('SELECT')) {
    let tableName = 'users';
    if (upperQuery.includes('FROM EXPENSES')) {
      tableName = 'expenses';
    } else if (upperQuery.includes('FROM USERS')) {
      tableName = 'users';
    }

    let records = [];
    if (tableName === 'users') {
      records = Object.values(users).map(u => ({
        id: u.id,
        name: u.name || 'User',
        email: u.email || '',
        role: u.role || 'user',
        verified: u.verified ? true : false,
        updatedAt: u.updatedAt || ''
      }));
    } else {
      records = expenses.map(e => ({
        id: e.id,
        userId: e.userId,
        date: e.date,
        location: e.location,
        total: e.total,
        paymentStatus: e.paymentStatus || 'pending',
        createdAt: e.createdAt
      }));
    }

    // WHERE clause parsing
    if (upperQuery.includes('WHERE')) {
      const wherePart = sqlQuery.substring(upperQuery.indexOf('WHERE') + 5).split('ORDER')[0].split('LIMIT')[0].trim();
      if (wherePart.includes('=')) {
        const [field, rawVal] = wherePart.split('=').map(s => s.trim().replace(/['"]/g, ''));
        records = records.filter(r => {
          const val = r[field] !== undefined ? r[field] : (r[field.toLowerCase()] !== undefined ? r[field.toLowerCase()] : '');
          return String(val).toLowerCase() === rawVal.toLowerCase();
        });
      }
    }

    // Projection (Specific Columns vs *)
    const selectColsPart = sqlQuery.substring(6, upperQuery.indexOf('FROM')).trim();
    if (selectColsPart !== '*') {
      const cols = selectColsPart.split(',').map(c => c.trim());
      records = records.map(r => {
        const filteredObj = {};
        cols.forEach(c => {
          if (r[c] !== undefined) filteredObj[c] = r[c];
        });
        return filteredObj;
      });
    }

    if (records.length === 0) {
      console.log('ℹ️ No matching records found.');
    } else {
      console.table(records);
      console.log(`\x1b[32m✅ Successfully returned ${records.length} records from table '${tableName}'.\x1b[0m\n`);
    }
  } else {
    console.log('⚠️ Only SELECT queries are supported in quick CLI mode.');
  }
} catch (err) {
  console.error(`\x1b[31m❌ Query Error: ${err.message}\x1b[0m\n`);
}
