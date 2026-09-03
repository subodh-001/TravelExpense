#!/usr/bin/env node
/**
 * ⚡ Supabase Database Query CLI Tool
 * Usage:
 *   node supabase-query.js GET users
 *   node supabase-query.js GET expenses
 *   node supabase-query.js GET users WHERE role==super_admin
 *   node supabase-query.js GET expenses WHERE payment_status==pending
 *   node supabase-query.js GET users WHERE email==subodhram3350@gmail.com
 *   node supabase-query.js COUNT users
 *   node supabase-query.js COUNT expenses
 *   node supabase-query.js TABLES
 */

const path = require('path');
require(path.join(__dirname, 'backend', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, 'backend', '.env') });
const { createClient } = require(path.join(__dirname, 'backend', 'node_modules', '@supabase', 'supabase-js'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('\n❌ Error: SUPABASE_URL and SUPABASE_KEY are missing in backend/.env');
  console.error('   Add SUPABASE_URL=https://your-project.supabase.co and SUPABASE_KEY=your-key to backend/.env\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const cmd = (args[0] || '').toUpperCase();

async function run() {
  // ── TABLES: List all known public tables ─────────────────────────────────
  if (cmd === 'TABLES' || cmd === 'COLLECTIONS') {
    console.log('\n📂 Listing Supabase Tables...\n');
    const knownTables = ['users', 'expenses', 'invites', 'deleted_users', 'whatsapp_auth'];
    for (let i = 0; i < knownTables.length; i++) {
      const tbl = knownTables[i];
      const { count, error } = await supabase.from(tbl).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`  ${i + 1}. ${tbl} (Error: ${error.message})`);
      } else {
        console.log(`  ${i + 1}. ${tbl} (${count} rows)`);
      }
    }
    console.log('');
    return;
  }

  // ── COUNT ─────────────────────────────────────────────────────────────────
  if (cmd === 'COUNT') {
    const table = args[1];
    if (!table) { console.error('Usage: node supabase-query.js COUNT <table>'); process.exit(1); }
    console.log(`\n🔢 Counting rows in '${table}'...\n`);
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`❌ Error counting rows in '${table}':`, error.message, '\n');
    } else {
      console.log(`  Total rows in '${table}': ${count}\n`);
    }
    return;
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (cmd === 'GET') {
    const table = args[1];
    if (!table) { console.error('Usage: node supabase-query.js GET <table> [WHERE column==value]'); process.exit(1); }

    let query = supabase.from(table).select('*');
    const whereIdx = args.findIndex(a => a.toUpperCase() === 'WHERE');
    if (whereIdx !== -1 && args[whereIdx + 1]) {
      const condition = args[whereIdx + 1];
      const match = condition.match(/^(.+?)(==|!=|>=|<=|>|<)(.+)$/);
      if (!match) {
        console.error(`❌ Invalid WHERE format. Use: WHERE column==value`);
        process.exit(1);
      }
      const [, col, op, rawVal] = match;
      let val = rawVal;
      if (rawVal === 'true') val = true;
      else if (rawVal === 'false') val = false;
      else if (!isNaN(rawVal) && rawVal !== '') val = Number(rawVal);

      if (op === '==') query = query.eq(col, val);
      else if (op === '!=') query = query.neq(col, val);
      else if (op === '>') query = query.gt(col, val);
      else if (op === '>=') query = query.gte(col, val);
      else if (op === '<') query = query.lt(col, val);
      else if (op === '<=') query = query.lte(col, val);

      console.log(`\n🔍 Querying '${table}' WHERE ${col} ${op} ${rawVal}...\n`);
    } else {
      console.log(`\n🔍 Fetching all rows from '${table}'...\n`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('❌ Supabase Query Error:', error.message, '\n');
      return;
    }

    if (!data || data.length === 0) {
      console.log('  (no rows found)\n');
      return;
    }

    // Pretty print table
    console.table(data.map(r => {
      const clean = {};
      Object.keys(r).forEach(k => {
        let v = r[k];
        if (typeof v === 'string' && v.length > 50) v = v.slice(0, 47) + '...';
        if (typeof v === 'object' && v !== null) v = JSON.stringify(v).slice(0, 50);
        clean[k] = v;
      });
      return clean;
    }));
    console.log(`  Total fetched: ${data.length}\n`);
    return;
  }

  // ── HELP / DEFAULT ────────────────────────────────────────────────────────
  console.log(`
⚡ Supabase Database Query CLI Tool

Usage:
  node supabase-query.js TABLES
  node supabase-query.js COUNT <table>
  node supabase-query.js GET <table>
  node supabase-query.js GET <table> WHERE <column>==<value>

Examples:
  node supabase-query.js GET users
  node supabase-query.js GET expenses
  node supabase-query.js COUNT users
  node supabase-query.js TABLES
  node supabase-query.js GET users WHERE role==super_admin
  node supabase-query.js GET expenses WHERE payment_status==pending
  node supabase-query.js GET users WHERE email==subodhram3350@gmail.com
`);
}

run().catch(err => {
  console.error('\n❌ Error executing command:', err.message, '\n');
  process.exit(1);
});
