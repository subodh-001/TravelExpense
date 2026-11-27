const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baseDir = process.env.BACKUP_BASE_DIR || __dirname;
const dataDir = process.env.DATA_DIR || path.join(baseDir, 'backend', 'data');
const backupDir = process.env.BACKUP_DIR || path.join(baseDir, 'backups');
const diffDir = path.join(backupDir, 'diff_reports');
const snapshotDir = path.join(backupDir, 'latest_snapshot');

// Folders banao agar nahi hain
if (!fs.existsSync(diffDir)) fs.mkdirSync(diffDir, { recursive: true });
if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });

const timeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }).replace(/[/: ]/g, '-');

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || JSON.stringify(fallback));
  } catch (e) {
    return fallback;
  }
}

// Current Data padho
const currentUsers = safeReadJson(path.join(dataDir, 'users.json'), {});
const currentExpenses = safeReadJson(path.join(dataDir, 'expenses.json'), []);
const currentProfilePhotosPath = path.join(dataDir, 'profile_photos.json');
const currentProfilePhotos = safeReadJson(currentProfilePhotosPath, {});

// Pichla (Latest) Snapshot padho
const prevUsersPath = path.join(snapshotDir, 'users.json');
const prevExpensesPath = path.join(snapshotDir, 'expenses.json');
const prevProfilePhotosPath = path.join(snapshotDir, 'profile_photos.json');
const prevUsers = safeReadJson(prevUsersPath, {});
const prevExpenses = safeReadJson(prevExpensesPath, []);
const prevProfilePhotos = safeReadJson(prevProfilePhotosPath, {});

// 🚨 RULE: SAFETY LOCK (Agar data achanak 0 ho jaye toh backup mat lo)
if (Object.keys(prevUsers).length > 0 && Object.keys(currentUsers).length === 0) {
  fs.writeFileSync(
    path.join(backupDir, `CRITICAL_ALERT_${timeStr}.txt`),
    'Users data became 0! Backup aborted to protect history.'
  );
  console.error('🚨 CRITICAL: Users data empty. Backup aborted!');
  process.exit(1);
}

// 🔍 RULE 2: CHANGE LOGS (Kya add/delete/photo change hua)
let diffText = `--- CHANGE REPORT (${timeStr}) ---\n\n`;
let hasChanges = false;

// Users Diff
const addedUsers = [];
const deletedUsers = [];
for (const id in currentUsers) if (!prevUsers[id]) addedUsers.push((currentUsers[id] && currentUsers[id].email) || id);
for (const id in prevUsers) if (!currentUsers[id]) deletedUsers.push((prevUsers[id] && prevUsers[id].email) || id);

if (addedUsers.length > 0 || deletedUsers.length > 0) {
  hasChanges = true;
  diffText += '[USERS CHANGES]\n';
  if (addedUsers.length > 0) diffText += `➕ Added: ${addedUsers.join(', ')}\n`;
  if (deletedUsers.length > 0) diffText += `➖ Deleted: ${deletedUsers.join(', ')}\n\n`;
}

// Profile Photos Diff (from profile_photos.json + users.json picture changes)
const addedPhotos = [];
const updatedPhotos = [];
const removedPhotos = [];

for (const key of Object.keys(currentProfilePhotos)) {
  const curEntry = currentProfilePhotos[key];
  const prevEntry = prevProfilePhotos[key];
  const label = (curEntry && (curEntry.email || curEntry.userId)) || key;
  const curPic = (curEntry && curEntry.picture) || '';
  const prevPic = (prevEntry && prevEntry.picture) || '';
  if (!prevEntry && curPic) {
    addedPhotos.push(`${label} -> ${curPic}`);
  } else if (prevEntry && curPic !== prevPic) {
    updatedPhotos.push(`${label}: ${prevPic || 'none'} -> ${curPic || 'none'}`);
  }
}
for (const key of Object.keys(prevProfilePhotos)) {
  if (!currentProfilePhotos[key]) {
    const prevEntry = prevProfilePhotos[key];
    const label = (prevEntry && (prevEntry.email || prevEntry.userId)) || key;
    removedPhotos.push(label);
  }
}

// Also track users.json picture transitions (e.g. if a real photo changed or got replaced)
const userPicChanges = [];
for (const id of Object.keys(currentUsers)) {
  const curPic = (currentUsers[id] && currentUsers[id].picture) || '';
  const prevPic = (prevUsers[id] && prevUsers[id].picture) || '';
  if (prevUsers[id] && curPic !== prevPic) {
    const label = (currentUsers[id] && currentUsers[id].email) || id;
    userPicChanges.push(`${label}: ${prevPic ? prevPic.slice(0, 80) : 'none'} -> ${curPic ? curPic.slice(0, 80) : 'none'}`);
  }
}

if (addedPhotos.length > 0 || updatedPhotos.length > 0 || removedPhotos.length > 0 || userPicChanges.length > 0) {
  hasChanges = true;
  diffText += '[PROFILE PHOTO CHANGES]\n';
  if (addedPhotos.length > 0) diffText += `🖼️ Added Photos:\n  - ${addedPhotos.join('\n  - ')}\n`;
  if (updatedPhotos.length > 0) diffText += `🔄 Updated Photos:\n  - ${updatedPhotos.join('\n  - ')}\n`;
  if (removedPhotos.length > 0) diffText += `🗑️ Removed Photos:\n  - ${removedPhotos.join('\n  - ')}\n`;
  if (userPicChanges.length > 0) diffText += `👤 users.json Picture Changes:\n  - ${userPicChanges.join('\n  - ')}\n`;
  diffText += '\n';
}

// Expenses Diff
let addedExp = 0;
let deletedExp = 0;
const currentExpMap = new Map((Array.isArray(currentExpenses) ? currentExpenses : []).map(e => [e.id, e]));
const prevExpMap = new Map((Array.isArray(prevExpenses) ? prevExpenses : []).map(e => [e.id, e]));

for (const id of currentExpMap.keys()) if (!prevExpMap.has(id)) addedExp++;
for (const id of prevExpMap.keys()) if (!currentExpMap.has(id)) deletedExp++;

if (addedExp > 0 || deletedExp > 0) {
  hasChanges = true;
  diffText += `[EXPENSES CHANGES]\n➕ Added: ${addedExp} new entries\n➖ Deleted: ${deletedExp} entries\n\n`;
}

// Agar kuch change hua hai toh report save karo
if (hasChanges) {
  fs.writeFileSync(path.join(diffDir, `diff_${timeStr}.txt`), diffText);
  console.log('📝 Change Log saved!');
} else {
  console.log('✅ No changes since last backup.');
}

// Snapshot update karo (Next time comparison ke liye)
if (fs.existsSync(path.join(dataDir, 'users.json'))) {
  fs.copyFileSync(path.join(dataDir, 'users.json'), prevUsersPath);
}
if (fs.existsSync(path.join(dataDir, 'expenses.json'))) {
  fs.copyFileSync(path.join(dataDir, 'expenses.json'), prevExpensesPath);
}
if (fs.existsSync(currentProfilePhotosPath)) {
  fs.copyFileSync(currentProfilePhotosPath, prevProfilePhotosPath);
}

// 🗜️ RULE 1: TIME-BASED BACKUP (Data + Logs + Uploads)
const tarName = `TravelExpense_Backup_${timeStr}.tar.gz`;
try {
  execSync(`tar -czf "${path.join(backupDir, tarName)}" -C "${baseDir}" backend/data backend/logs backend/uploads 2>/dev/null || true`);
  console.log(`✅ Backup Successful: ${tarName}`);
} catch (e) {
  console.error('❌ Backup failed', e);
}

// 🧹 RULE 3: 15-DAY CLEANUP (Purane backup aur logs delete karo)
try {
  execSync(`find "${backupDir}" -name "TravelExpense_Backup_*.tar.gz" -mtime +15 -delete`);
  execSync(`find "${diffDir}" -name "diff_*.txt" -mtime +15 -delete`);
  execSync(`find "${baseDir}/backend/logs" -name "activity_*.log" -mtime +15 -delete`);
  console.log('🧹 Old backups & logs older than 15 days cleaned up.');
} catch (e) {}

