# AGENTS.md — TravelExpense Project Rules

## ⚠️ CRITICAL: DATA PROTECTION RULES — READ BEFORE ANY ACTION

These rules are **mandatory** for ALL AI agents working on this project.
**Violating these rules can cause permanent, irreversible data loss.**

---

## 🔒 ABSOLUTE DATA PROTECTION RULES

### NEVER do the following without explicit written user approval:

1. **NEVER delete, wipe, truncate, or overwrite these files:**
   - `backend/data/users.json`
   - `backend/data/expenses.json`
   - `backend/data/invites.json`
   - `backend/data/deleted_users.json`
   - `backend/data/travel_expense.sqlite`

2. **NEVER run commands that bulk-delete data**, such as:
   - `fs.writeFileSync('users.json', '{}')` or `fs.writeFileSync('expenses.json', '[]')`
   - `db.exec('DELETE FROM users')` or `db.exec('DELETE FROM expenses')`
   - Any script that wipes or resets these files

3. **NEVER push data files to git.** These are gitignored by design.
   - `backend/data/*.json` — runtime data, must NEVER be committed
   - `backend/data/*.sqlite` — runtime database, must NEVER be committed

4. **NEVER modify `deleted_users.json` manually** unless the user explicitly says:
   > "delete [specific user] from deleted_users.json"

5. **NEVER reset, overwrite, or re-seed** `users.json` or `expenses.json` as part of a "clean slate" or "fresh start" unless user explicitly says:
   > "wipe all data and start fresh — I understand this is irreversible"

---

## ✅ WHAT YOU CAN DO (Code changes only)

- Edit `backend/server.js` — API logic, endpoints, auth handlers
- Edit `backend/database.js` — SQLite schema and sync logic
- Edit `backend/telegram-bot.js` — Telegram bot handlers
- Edit `web/app.js` — Frontend logic
- Edit `web/index.html` — Frontend UI
- Add new API endpoints, fix bugs, add new features

---

## 📋 DATA ARCHITECTURE (For Reference)

| Storage | Location | Purpose |
|---|---|---|
| Primary | Firebase Firestore | Cloud master database |
| Local fallback | `backend/data/users.json` | Local users cache |
| Local fallback | `backend/data/expenses.json` | Local expenses cache |
| SQLite mirror | `backend/data/travel_expense.sqlite` | Offline SQLite mirror |
| Blacklist | `backend/data/deleted_users.json` | Deleted user IDs |

**Rule**: Firebase is the source of truth. Local JSON files are a fallback cache. SQLite is a mirror. None of these should be reset by code changes.

---

## 👤 Master Admin

- Email: `subodhram3350@gmail.com`
- Role: `super_admin`
- This account must ALWAYS exist in `users.json` and must NEVER appear in `deleted_users.json`

---

## 🔐 Data Change Permission Protocol

If you believe data needs to be changed, you MUST:
1. Tell the user EXACTLY what data will be affected
2. Show the user what will be deleted/changed
3. Wait for explicit written approval with the word **"APPROVED"** before proceeding
4. Never assume "yes" from context — always ask directly

---

*These rules were set by the project owner (subodhram3350@gmail.com) on 2026-08-25.*
*Any agent that ignores these rules risks permanent data loss and loss of user trust.*
