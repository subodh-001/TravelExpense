const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
require('dotenv').config();

if (dns.setDefaultResultOrder) {
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch (e) {
    // default DNS fallback
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ensure local directories exist for fallback storage
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'expenses.json');
const USERS_DB_FILE = path.join(DATA_DIR, 'users.json');
const INVITES_DB_FILE = path.join(DATA_DIR, 'invites.json');
const DELETED_USERS_FILE = path.join(DATA_DIR, 'deleted_users.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(LOCAL_DB_FILE)) fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify([]));
if (!fs.existsSync(USERS_DB_FILE)) fs.writeFileSync(USERS_DB_FILE, JSON.stringify({}));
if (!fs.existsSync(INVITES_DB_FILE)) fs.writeFileSync(INVITES_DB_FILE, JSON.stringify({}));
if (!fs.existsSync(DELETED_USERS_FILE)) fs.writeFileSync(DELETED_USERS_FILE, JSON.stringify([]));

// Helpers for persistent user deletion blacklist
const getDeletedUsers = () => {
  try {
    const raw = fs.readFileSync(DELETED_USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

const addDeletedUser = (userOrId) => {
  try {
    const deleted = getDeletedUsers();
    const addIfNew = (str) => {
      if (!str) return;
      const clean = str.toLowerCase().trim();
      if (!deleted.includes(clean)) deleted.push(clean);
      const cleanGoogle = `google_${clean.replace(/[^a-zA-Z0-9]/g, '_')}`;
      if (!deleted.includes(cleanGoogle)) deleted.push(cleanGoogle);
    };

    if (typeof userOrId === 'string') {
      addIfNew(userOrId);
    } else if (userOrId && typeof userOrId === 'object') {
      addIfNew(userOrId.id);
      addIfNew(userOrId.email);
    }
    fs.writeFileSync(DELETED_USERS_FILE, JSON.stringify(deleted, null, 2));
  } catch (e) {
    console.error('Error recording deleted user:', e);
  }
};

const isUserDeleted = (userIdOrEmail) => {
  if (!userIdOrEmail) return false;
  const deleted = getDeletedUsers();
  const clean = userIdOrEmail.toLowerCase().trim();
  const cleanGoogle = `google_${clean.replace(/[^a-zA-Z0-9]/g, '_')}`;
  return deleted.includes(clean) || deleted.includes(cleanGoogle);
};

// Daily automated snapshot backup function
const createDataBackup = () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const expBackupPath = path.join(BACKUP_DIR, `expenses_${today}.json`);
    const usersBackupPath = path.join(BACKUP_DIR, `users_${today}.json`);

    if (fs.existsSync(LOCAL_DB_FILE)) {
      const data = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
      if (data && data.trim().length > 2) {
        fs.writeFileSync(expBackupPath, data);
      }
    }
    if (fs.existsSync(USERS_DB_FILE)) {
      const data = fs.readFileSync(USERS_DB_FILE, 'utf8');
      if (data && data.trim().length > 2) {
        fs.writeFileSync(usersBackupPath, data);
      }
    }
  } catch (err) {
    console.warn('⚠️ Data backup note:', err.message);
  }
};
createDataBackup();

// Serve local uploads statically
app.use('/uploads', express.static(UPLOADS_DIR));

// Explicit route for APK download
app.get('/app-release.apk', (req, res) => {
  const apkPath = path.join(__dirname, '../web/app-release.apk');
  if (fs.existsSync(apkPath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    return res.download(apkPath, 'TravelExpense.apk');
  } else {
    return res.status(404).send('APK file not found');
  }
});

// Serve static web app if accessed directly
app.use(express.static(path.join(__dirname, '../web')));

// ==================== FIREBASE INIT / FALLBACK ====================
let useFirebase = false;
let db = null;
let bucket = null;

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT || path.join(__dirname, 'firebase-admin.json');

try {
  let serviceAccount = null;
  // Try multiple paths: local backend/, parent dir, then env var
  const possiblePaths = [
    serviceAccountPath,
    path.join(__dirname, '../backend/firebase-admin.json'),
    path.join(__dirname, 'firebase-admin.json'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) { serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8')); break; }
  }
  if (!serviceAccount && process.env.FIREBASE_CONFIG) {
    try {
      serviceAccount = typeof process.env.FIREBASE_CONFIG === 'string' 
        ? JSON.parse(process.env.FIREBASE_CONFIG) 
        : process.env.FIREBASE_CONFIG;
    } catch (parseErr) {
      console.warn('⚠️ FIREBASE_CONFIG JSON parse warning:', parseErr.message);
    }
  }

  if (serviceAccount) {
    const certConfig = {
      projectId: serviceAccount.project_id || serviceAccount.projectId || 'nothing-5c8b8',
      clientEmail: serviceAccount.client_email || serviceAccount.clientEmail,
      privateKey: (serviceAccount.private_key || serviceAccount.privateKey || '').replace(/\\n/g, '\n')
    };

    admin.initializeApp({
      credential: admin.credential.cert(certConfig),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${certConfig.projectId}.appspot.com`
    });

    db = admin.firestore();
    bucket = admin.storage().bucket();
    useFirebase = true;
    console.log('🔥 Connected to Firebase Firestore & Storage (Project:', certConfig.projectId + ')');
  }
} catch (err) {
  console.warn('⚠️ Firebase init warning, falling back to Local Storage mode:', err.message);
}

// Server-Sent Events (SSE) Real-Time Sync Subscribers Store
let sseClients = [];

const broadcastEvent = (eventType, data = {}) => {
  const payload = JSON.stringify({ event: eventType, data, timestamp: new Date().toISOString() });
  sseClients.forEach(client => {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      // client disconnected
    }
  });
};

// Local JSON helper functions with atomic write support & backup recovery
const getLocalExpenses = () => {
  try {
    const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('⚠️ Error reading LOCAL_DB_FILE, checking auto-backups:', e.message);
    try {
      if (fs.existsSync(BACKUP_DIR)) {
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('expenses_')).sort().reverse();
        if (files.length > 0) {
          const backupPath = path.join(BACKUP_DIR, files[0]);
          const backupRaw = fs.readFileSync(backupPath, 'utf8');
          const recovered = JSON.parse(backupRaw);
          if (Array.isArray(recovered)) {
            console.log(`🛡️ Recovered ${recovered.length} expenses from backup (${files[0]})`);
            return recovered;
          }
        }
      }
    } catch (recErr) {
      console.error('❌ Backup recovery note:', recErr.message);
    }
    return [];
  }
};

const saveLocalExpenses = (expenses, triggerBroadcast = true) => {
  try {
    const tempPath = `${LOCAL_DB_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(expenses, null, 2));
    fs.renameSync(tempPath, LOCAL_DB_FILE);
    createDataBackup();
    if (triggerBroadcast) {
      broadcastEvent('EXPENSES_UPDATED');
    }
  } catch (err) {
    console.error('Error writing LOCAL_DB_FILE:', err);
  }
};

const getLocalUsers = () => {
  let users = {};
  try {
    const raw = fs.readFileSync(USERS_DB_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    users = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    console.error('⚠️ Error reading USERS_DB_FILE, checking auto-backups:', e.message);
    try {
      if (fs.existsSync(BACKUP_DIR)) {
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('users_')).sort().reverse();
        if (files.length > 0) {
          const backupPath = path.join(BACKUP_DIR, files[0]);
          const backupRaw = fs.readFileSync(backupPath, 'utf8');
          const recovered = JSON.parse(backupRaw);
          if (recovered && typeof recovered === 'object') {
            console.log(`🛡️ Recovered users from backup (${files[0]})`);
            users = recovered;
          }
        }
      }
    } catch (recErr) {
      console.error('❌ User backup recovery note:', recErr.message);
    }
  }

  // Filter out any blacklisted deleted users
  const deleted = getDeletedUsers();
  if (deleted.length > 0) {
    Object.keys(users).forEach(key => {
      const u = users[key];
      const kClean = key.toLowerCase().trim();
      const eClean = (u && u.email) ? u.email.toLowerCase().trim() : '';
      const idClean = (u && u.id) ? u.id.toLowerCase().trim() : '';
      if (deleted.includes(kClean) || deleted.includes(eClean) || deleted.includes(idClean)) {
        delete users[key];
      }
    });
  }

  return users;
};

const saveLocalUsers = (users, triggerBroadcast = true) => {
  try {
    const tempPath = `${USERS_DB_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(users, null, 2));
    fs.renameSync(tempPath, USERS_DB_FILE);
    createDataBackup();
    if (triggerBroadcast) {
      broadcastEvent('USERS_UPDATED');
    }
    // 🔥 Auto-sync to Firestore in background
    if (useFirebase && db && users && typeof users === 'object') {
      setImmediate(async () => {
        try {
          const batch = db.batch();
          Object.entries(users).forEach(([uid, u]) => {
            if (!uid) return;
            batch.set(db.collection('users').doc(uid), {
              id: u.id || uid, name: u.name || '', email: u.email || '',
              role: u.role || 'user', verified: !!u.verified,
              picture: u.picture || '', paymentBillUrl: u.paymentBillUrl || '',
              phone: u.phone || u.whatsapp || '',
              whatsapp: u.whatsapp || u.phone || '',
              whatsappVerified: !!u.whatsappVerified,
              updatedAt: u.updatedAt || new Date().toISOString()
            }, { merge: true });
          });
          await batch.commit();
        } catch (fbErr) { /* silent — Firestore is secondary storage */ }
      });
    }
  } catch (err) {
    console.error('Error writing USERS_DB_FILE:', err);
  }
};

const getLocalInvites = () => {
  try {
    const raw = fs.readFileSync(INVITES_DB_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
};

const saveLocalInvites = (invites) => {
  try {
    const tempPath = `${INVITES_DB_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(invites, null, 2));
    fs.renameSync(tempPath, INVITES_DB_FILE);
  } catch (err) {
    console.error('Error writing INVITES_DB_FILE:', err);
  }
};

// Seed Master Super Admin Account (subodhram3350@gmail.com / nothing05)
const seedMasterSuperAdmin = () => {
  try {
    const users = getLocalUsers();
    const masterEmail = 'subodhram3350@gmail.com';
    const masterUserId = `google_${masterEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const passwordHash = crypto.createHash('sha256').update('nothing05').digest('hex');

    users[masterUserId] = {
      ...(users[masterUserId] || {}),
      id: masterUserId,
      name: 'Subodh Ram',
      email: masterEmail,
      passwordHash,
      role: 'super_admin',
      verified: true,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);
    console.log(`👑 Admin account initialized: ${masterEmail}`);
  } catch (err) {
    console.warn('Failed to seed master super admin:', err.message);
  }
};
seedMasterSuperAdmin();


// Automatic Bi-directional Sync between Local Machine and Render Cloud Host
const triggerCloudSync = async () => {
  try {
    const isRender = !!process.env.RENDER;
    const remoteTarget = isRender ? 'http://localhost:3000' : 'https://travelexpense-52gp.onrender.com';
    
    const localPayload = {
      users: getLocalUsers(),
      expenses: getLocalExpenses(),
      deletedUsers: getDeletedUsers()
    };

    const httpFetch = globalThis.fetch || (async (...args) => {
      const { default: fetch } = await import('node-fetch');
      return fetch(...args);
    });

    // 1. Push local changes to remote host
    await httpFetch(`${remoteTarget}/api/sync/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localPayload)
    }).catch(() => {});

    // 2. Fetch remote changes to merge into local host
    const res = await httpFetch(`${remoteTarget}/api/sync/export`).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      if (data) {
        let lUsers = getLocalUsers();
        let lExpenses = getLocalExpenses();
        let usersChanged = false;
        let expensesChanged = false;

        // ✅ FIX: Apply deletedUsers from remote — purge locally if deleted on Live
        if (Array.isArray(data.deletedUsers) && data.deletedUsers.length > 0) {
          data.deletedUsers.forEach(delId => {
            addDeletedUser(delId);
            const clean = (delId || '').toLowerCase().trim();
            Object.keys(lUsers).forEach(k => {
              const u = lUsers[k];
              if (
                k.toLowerCase() === clean ||
                (u && u.id && u.id.toLowerCase() === clean) ||
                (u && u.email && u.email.toLowerCase() === clean)
              ) {
                delete lUsers[k];
                usersChanged = true;
              }
            });
            const before = lExpenses.length;
            lExpenses = lExpenses.filter(e => (e.userId || '').toLowerCase().trim() !== clean);
            if (lExpenses.length !== before) expensesChanged = true;
          });
        }

        const activeBlacklist = getDeletedUsers();

        // Merge new users (excluding blacklisted)
        if (data.users && typeof data.users === 'object') {
          Object.keys(data.users).forEach(uid => {
            const u = data.users[uid];
            const kClean = uid.toLowerCase().trim();
            const eClean = (u && u.email) ? u.email.toLowerCase().trim() : '';
            if (!activeBlacklist.includes(kClean) && !activeBlacklist.includes(eClean)) {
              if (!lUsers[uid]) {
                lUsers[uid] = data.users[uid];
                usersChanged = true;
              }
            }
          });
        }

        // Merge new expenses (excluding blacklisted)
        if (Array.isArray(data.expenses)) {
          const existingIds = new Set(lExpenses.map(e => e.id));
          data.expenses.forEach(exp => {
            const eUid = (exp.userId || '').toLowerCase().trim();
            if (!activeBlacklist.includes(eUid) && !existingIds.has(exp.id)) {
              lExpenses.unshift(exp);
              expensesChanged = true;
            }
          });
        }

        if (usersChanged) saveLocalUsers(lUsers, false);
        if (expensesChanged) saveLocalExpenses(lExpenses, false);
      }
    }
  } catch (e) {
    // Silent background sync
  }
};

// Cloud sync disabled — Local DB and Live (Render) operate independently
// setInterval(triggerCloudSync, 15000);
// setTimeout(triggerCloudSync, 2000);



// ==================== MIDDLEWARE ====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ☁️ Cloudinary Upload Helper (same account as Web)
const CLOUDINARY_CLOUD_NAME = 'vrxb6o67';
const CLOUDINARY_UPLOAD_PRESET = 'expense_receipts'; // unsigned preset

const uploadToCloudinary = async (fileBuffer, mimeType, folder = 'payment_bills') => {
  const https = require('https');
  return new Promise((resolve, reject) => {
    // Build multipart/form-data manually (compatible with Node.js built-in https)
    const boundary = `----FormBoundary${Date.now()}`;
    const nl = '\r\n';

    const buildPart = (name, value) =>
      `--${boundary}${nl}Content-Disposition: form-data; name="${name}"${nl}${nl}${value}${nl}`;

    const ext = mimeType.split('/')[1] || 'png';
    const fileName = `upload_${Date.now()}.${ext}`;

    let body = '';
    body += buildPart('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    body += buildPart('folder', folder);
    body += `--${boundary}${nl}`;
    body += `Content-Disposition: form-data; name="file"; filename="${fileName}"${nl}`;
    body += `Content-Type: ${mimeType}${nl}${nl}`;

    const bodyStart = Buffer.from(body, 'utf8');
    const bodyEnd   = Buffer.from(`${nl}--${boundary}--${nl}`, 'utf8');
    const fullBody  = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.secure_url) resolve(json.secure_url);
          else reject(new Error(json.error?.message || 'Cloudinary upload failed'));
        } catch (e) { reject(new Error('Cloudinary response parse error')); }
      });
    });
    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
};

const authenticate = (req, res, next) => {
  let userId = req.headers['user-id'] || req.query.userId;
  if (!userId || userId === 'user_123' || userId === 'google_user') {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid user-id header' });
  }
  if (isUserDeleted(userId)) {
    return res.status(401).json({ error: 'Unauthorized: Account deleted by Administrator' });
  }
  req.userId = userId;
  next();
};

// ==================== BI-DIRECTIONAL SYNC ENDPOINTS ====================
app.get('/api/sync/export', (req, res) => {
  try {
    res.json({
      success: true,
      users: getLocalUsers(),
      expenses: getLocalExpenses(),
      deletedUsers: getDeletedUsers(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/import', (req, res) => {
  try {
    const { users, expenses, deletedUsers } = req.body;
    let lUsers = getLocalUsers();
    let lExpenses = getLocalExpenses();

    let usersChanged = false;
    let expensesChanged = false;

    // 1. Process and record deleted users blacklist
    if (Array.isArray(deletedUsers) && deletedUsers.length > 0) {
      deletedUsers.forEach(delId => {
        addDeletedUser(delId);
        const clean = (delId || '').toLowerCase().trim();
        Object.keys(lUsers).forEach(k => {
          const u = lUsers[k];
          if (
            k.toLowerCase() === clean ||
            (u && u.id && u.id.toLowerCase() === clean) ||
            (u && u.email && u.email.toLowerCase() === clean)
          ) {
            delete lUsers[k];
            usersChanged = true;
          }
        });

        const initialLength = lExpenses.length;
        lExpenses = lExpenses.filter(e => {
          const eUid = (e.userId || '').toLowerCase().trim();
          return eUid !== clean;
        });
        if (lExpenses.length !== initialLength) expensesChanged = true;
      });
    }

    const activeBlacklist = getDeletedUsers();

    // 2. Merge active users (excluding blacklisted ones)
    if (users && typeof users === 'object') {
      Object.keys(users).forEach(uid => {
        const u = users[uid];
        const kClean = uid.toLowerCase().trim();
        const eClean = (u && u.email) ? u.email.toLowerCase().trim() : '';
        if (!activeBlacklist.includes(kClean) && !activeBlacklist.includes(eClean)) {
          if (!lUsers[uid]) {
            lUsers[uid] = users[uid];
            usersChanged = true;
          }
        }
      });
    }

    // 3. Merge active expenses (excluding blacklisted ones)
    if (Array.isArray(expenses)) {
      const existingIds = new Set(lExpenses.map(e => e.id));
      expenses.forEach(exp => {
        const eUid = (exp.userId || '').toLowerCase().trim();
        if (!activeBlacklist.includes(eUid) && !existingIds.has(exp.id)) {
          lExpenses.unshift(exp);
          expensesChanged = true;
        }
      });
    }

    if (usersChanged) saveLocalUsers(lUsers, true);
    if (expensesChanged) saveLocalExpenses(lExpenses, true);

    res.json({ success: true, usersChanged, expensesChanged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== API ENDPOINTS ====================

// ---------- HEALTH CHECK ----------
app.get('/api/health', (req, res) => {
  const users = getLocalUsers();
  res.json({
    status:        'online',
    mode:          useFirebase ? 'Firebase + Local Storage' : 'Local Storage',
    firebase:      useFirebase,
    userCount:     Object.keys(users).length,
    activeClients: sseClients.length,
    timestamp:     new Date().toISOString()
  });
});

// ---------- REAL-TIME SSE STREAM ENDPOINT ----------
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (res.flushHeaders) res.flushHeaders();

  const clientId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial ping to confirm connection
  res.write(`data: ${JSON.stringify({ event: 'CONNECTED', clientId, timestamp: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

const nodemailer = require('nodemailer');

// Setup Gmail SMTP Transporter for OTP Emails (Forcing IPv4 & Dual-Port Fallback for Render Cloud Containers)
const GMAIL_DEFAULT_USER = 'subodhram3350@gmail.com';
const GMAIL_DEFAULT_PASS = 'ozytospihwnjhmbk';

function getGmailCredentials() {
  const gUser = (process.env.GMAIL_USER || GMAIL_DEFAULT_USER).trim();
  const rawPass = (process.env.GMAIL_APP_PASS || process.env.GMAIL_APP_PASSWORD || GMAIL_DEFAULT_PASS).replace(/\s+/g, '');
  const gPass = rawPass || GMAIL_DEFAULT_PASS;
  return { user: gUser, pass: gPass };
}

function createMailTransporter(port = 465, customUser = null, customPass = null) {
  const { user: defaultUser, pass: defaultPass } = getGmailCredentials();
  const user = customUser || defaultUser;
  const pass = customPass || defaultPass;

  return nodemailer.createTransport({
    pool: true,
    maxConnections: 5,
    host: 'smtp.gmail.com',
    port: port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    family: 4, // Force IPv4 to prevent IPv6 timeout on cloud hosts (Render/AWS)
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000
  });
}

// Pre-create pooled primary transporter for instant email sending
let primaryTransporter = createMailTransporter(465);

const DEFAULT_USER_AVATAR = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2U1ZTdlYiIvPjxjaXJjbGUgY3g9IjEwMCIgY3k9Ijc1IiByPSI0MiIgZmlsbD0iIzljYTNiZiIvPjxwYXRoIGQ9Ik0gMjAgMTg1IEMgMjAgMTMwIDUwIDEyMCAxMDAgMTIwIEMgMTUwIDEyMCAxODAgMTMwIDE4MCAxODUgWiIgZmlsbD0iIzljYTNiZiIvPjwvc3ZnPg==`;

const DEFAULT_GMAIL_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxE4NPu_khaxKDdEkrleAcCbYH4WszPYV8QoIyJLjPXL2VXZBoIrICMTt2j4mvQuP86/exec';

async function sendEmailNotification({ to, subject, html, fromName = 'FGTech Security' }) {
  if (!to) return { success: false, error: 'Recipient email address missing' };
  
  const { user: gUser } = getGmailCredentials();
  const webhookUrl = process.env.GMAIL_HTTP_WEBHOOK_URL || DEFAULT_GMAIL_WEBHOOK;

  // Attempt 1: Google Apps Script HTTPS Webhook (Sends directly from subodhram3350@gmail.com to ALL recipients, bypasses cloud firewall)
  if (webhookUrl) {
    try {
      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, html, fromName }),
        redirect: 'follow'
      });
      const webhookData = await webhookRes.json();
      if (webhookRes.ok && webhookData.success) {
        console.log(`✉️ Email successfully sent to ${to} from subodhram3350@gmail.com via Google Webhook`);
        return { success: true, messageId: 'GOOGLE_WEBHOOK_OK' };
      } else {
        console.warn(`⚠️ Google Webhook response: ${JSON.stringify(webhookData)}`);
      }
    } catch (whErr) {
      console.warn(`⚠️ Google Webhook attempt failed (${whErr.message}). Retrying via alternate methods...`);
    }
  }

  // Attempt 2: Resend HTTPS API (if RESEND_API_KEY set)
  if (process.env.RESEND_API_KEY) {
    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `FGTech Security <onboarding@resend.dev>`,
          to: [to],
          subject,
          html
        })
      });
      const resendData = await resendRes.json();
      if (resendRes.ok && resendData.id) {
        console.log(`✉️ Email successfully sent to ${to} via Resend HTTP API: ${resendData.id}`);
        return { success: true, messageId: resendData.id };
      } else {
        console.warn(`⚠️ Resend HTTP API response: ${JSON.stringify(resendData)}`);
      }
    } catch (resendErr) {
      console.warn(`⚠️ Resend HTTP API attempt failed: ${resendErr.message}`);
    }
  }

  // Attempt 3: Brevo HTTPS API (if BREVO_API_KEY set)
  if (process.env.BREVO_API_KEY) {
    try {
      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: fromName, email: gUser },
          to: [{ email: to }],
          subject,
          htmlContent: html
        })
      });
      if (brevoRes.ok) {
        const brevoData = await brevoRes.json();
        console.log(`✉️ Email successfully sent to ${to} via Brevo HTTP API: ${brevoData.messageId || 'OK'}`);
        return { success: true, messageId: brevoData.messageId };
      }
    } catch (brevoErr) {
      console.warn(`⚠️ Brevo HTTP API attempt failed: ${brevoErr.message}`);
    }
  }

  // Attempt 4: Primary Pooled Gmail SMTP (Port 465 SSL IPv4)
  try {
    const info = await primaryTransporter.sendMail({
      from: `"${fromName}" <${gUser}>`,
      to,
      subject,
      html
    });
    console.log(`✉️ Email successfully sent to ${to} via Primary Gmail Port 465: ${info.messageId || 'OK'}`);
    return { success: true, messageId: info.messageId };
  } catch (err1) {
    console.warn(`⚠️ Primary Gmail 465 attempt failed (${err1.message}). Retrying with direct fallback credentials on Port 465...`);
  }

  // Attempt 5: Direct Port 465 (SSL) with Master Credentials
  try {
    const fallbackTransporter465 = createMailTransporter(465, GMAIL_DEFAULT_USER, GMAIL_DEFAULT_PASS);
    const info465 = await fallbackTransporter465.sendMail({
      from: `"${fromName}" <${GMAIL_DEFAULT_USER}>`,
      to,
      subject,
      html
    });
    console.log(`✉️ Email successfully sent to ${to} via Fallback Port 465: ${info465.messageId || 'OK'}`);
    return { success: true, messageId: info465.messageId };
  } catch (err2) {
    console.warn(`⚠️ Fallback Port 465 attempt failed (${err2.message}). Retrying via Port 587 (TLS)...`);
  }

  // Attempt 6: Direct Port 587 (TLS) with Master Credentials
  try {
    const fallbackTransporter587 = createMailTransporter(587, GMAIL_DEFAULT_USER, GMAIL_DEFAULT_PASS);
    const info587 = await fallbackTransporter587.sendMail({
      from: `"${fromName}" <${GMAIL_DEFAULT_USER}>`,
      to,
      subject,
      html
    });
    console.log(`✉️ Email successfully sent to ${to} via Fallback Port 587: ${info587.messageId || 'OK'}`);
    return { success: true, messageId: info587.messageId };
  } catch (err3) {
    console.error(`❌ All Nodemailer SMTP attempts failed for ${to}:`, err3.message);
  }

  return { success: false, error: 'SMTP/Email delivery unavailable on cloud network host' };
}

// ---------- USER AUTHENTICATION & PROFILE MANAGEMENT ----------
const otpStore = new Map();

// Helper to check user by email
const findUserByEmail = (email) => {
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();
  const userId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const users = getLocalUsers();
  if (users[userId]) return users[userId];
  for (const key in users) {
    if (users[key] && users[key].email && users[key].email.toLowerCase().trim() === cleanEmail) {
      return users[key];
    }
  }
  return null;
};

// Check if email already registered
app.post('/api/auth/check-email', (req, res) => {
  try {
    const { email } = req.body;
    const user = findUserByEmail(email);
    res.json({ exists: !!user, hasPassword: !!(user && user.passwordHash) });
  } catch (err) {
    res.json({ exists: false, hasPassword: false });
  }
});

app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const userId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const existingUser = findUserByEmail(cleanEmail);

    if (existingUser && existingUser.passwordHash) {
      return res.status(400).json({ error: 'An account with this email already exists. Please Sign In.' });
    }

    const cleanName = (name || cleanEmail.split('@')[0]).replace(/[\._]/g, ' ');
    const capitalizedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const users = getLocalUsers();
    const picture = (existingUser && existingUser.picture) || users[userId]?.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(capitalizedName)}`;

    users[userId] = {
      ...(existingUser || {}),
      id: userId,
      name: capitalizedName,
      email: cleanEmail,
      passwordHash,
      picture,
      verified: true,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);

    const safeUser = { ...users[userId] };
    delete safeUser.passwordHash;

    console.log(`👤 Registered new user account: ${cleanEmail}`);
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Password Login Route
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = findUserByEmail(cleanEmail);

    if (!user) {
      return res.status(401).json({ error: 'No account found with this email address. Please Sign Up.' });
    }

    // If account exists but passwordHash was not set yet (e.g. Google OTP account), set it on first password login
    if (!user.passwordHash) {
      if (password && password.length >= 6) {
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        const users = getLocalUsers();
        const userId = user.id || `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
        users[userId] = {
          ...user,
          passwordHash,
          updatedAt: new Date().toISOString()
        };
        saveLocalUsers(users);

        const safeUser = { ...users[userId] };
        delete safeUser.passwordHash;
        console.log(`🔑 Set & Saved Password for account: ${cleanEmail}`);
        return res.json({ success: true, user: safeUser });
      } else {
        return res.status(401).json({ error: 'Password must be at least 6 characters long.' });
      }
    }

    const inputHash = crypto.createHash('sha256').update(password).digest('hex');
    if (user.passwordHash !== inputHash) {
      return res.status(401).json({ error: 'Incorrect password. Please check your password and try again.' });
    }

    const safeUser = { ...user };
    delete safeUser.passwordHash;

    console.log(`🔑 Password Login successful for: ${cleanEmail}`);
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change User Password Endpoint
app.post('/api/auth/change-password', (req, res) => {
  try {
    const { userId, email, oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long' });
    }

    const users = getLocalUsers();
    let targetKey = null;

    if (userId && users[userId]) {
      targetKey = userId;
    } else if (email) {
      const cleanEmail = email.toLowerCase().trim();
      targetKey = Object.keys(users).find(key => users[key].email && users[key].email.toLowerCase() === cleanEmail);
    }

    if (!targetKey || !users[targetKey]) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const user = users[targetKey];
    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    
    if (oldPassword && user.passwordHash) {
      const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
      if (user.passwordHash !== oldHash) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }

    user.passwordHash = newHash;
    user.password = newPassword;
    user.updatedAt = new Date().toISOString();
    users[targetKey] = user;
    saveLocalUsers(users);

    return res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Server error while changing password' });
  }
});

// Send 6-Digit OTP Verification Code
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid Google Email Address is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(email.toLowerCase(), { otp, expiresAt, name });
    console.log(`🔑 Generated 6-Digit OTP for ${email}: [ ${otp} ]`);

    // Trigger Real Email via Nodemailer Gmail SMTP (Fast Promise Race so HTTP response returns instantly)
    const emailPromise = sendEmailNotification({
      to: email,
      subject: `🔑 ${otp} is your TravelExpense Verification Code`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e5ea; border-radius: 20px; background: #ffffff;">
          <h2 style="color: #000000; font-size: 20px; font-weight: 800; margin-bottom: 8px;">TravelExpense</h2>
          <p style="color: #6e6e73; font-size: 14px; margin-bottom: 20px;">Your 6-digit verification code to log in to TravelExpense is:</p>
          <div style="background: #F4F4F7; padding: 20px; border-radius: 14px; text-align: center; margin-bottom: 20px; border: 1px solid #e5e5ea;">
            <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #000000;">${otp}</span>
          </div>
          <p style="color: #8e8e93; font-size: 12px; line-height: 1.5; margin: 0;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
        </div>
      `
    });

    // Wait max 1.5 seconds for email to complete. If SMTP is super fast (pooled), emailSent is true.
    // If SMTP takes slightly longer, finish email in background while returning HTTP response instantly.
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 1500));
    const result = await Promise.race([emailPromise, timeoutPromise]);

    let emailSent = true;
    if (result && result.success === false) {
      emailSent = false;
      console.warn(`⚠️ Email delivery returned error for ${email}: ${result.error}`);
    }

    res.json({
      success: true,
      emailSent: emailSent,
      message: `6-Digit OTP Verification Code sent to ${email}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Strict Verify 6-Digit OTP Code (NO DEMO BYPASS)
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { email, name, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and 6-Digit OTP Code are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const record = otpStore.get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'No active OTP requested for this email. Please click Send OTP.' });
    }

    if (record.expiresAt < Date.now()) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'OTP Code has expired. Please request a new code.' });
    }

    if (record.otp !== otp.toString().trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit OTP Code. Please check your Gmail inbox.' });
    }

    const cleanName = (name || record.name || cleanEmail.split('@')[0]).replace(/[\._]/g, ' ');
    const capitalizedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    const userId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;

    const users = getLocalUsers();
    const existing = users[userId] || {};

    users[userId] = {
      ...existing,
      id: userId,
      name: existing.name || capitalizedName,
      email: cleanEmail,
      picture: existing.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(capitalizedName)}`,
      verified: true,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);
    otpStore.delete(cleanEmail);

    const safeUser = { ...users[userId] };
    delete safeUser.passwordHash;

    const hasPassword = !!existing.passwordHash;
    console.log(`✅ Real OTP Verified for ${cleanEmail}: ${capitalizedName} (hasPassword: ${hasPassword})`);
    res.json({ success: true, user: safeUser, hasPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset Password with OTP Endpoint
app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP Code, and New Password are required' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters long' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const record = otpStore.get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'No active OTP requested for this email. Please click Send OTP.' });
    }

    if (record.expiresAt < Date.now()) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'OTP Code has expired. Please request a new code.' });
    }

    if (record.otp !== otp.toString().trim()) {
      return res.status(400).json({ error: 'Invalid 6-digit OTP Code. Please check your Gmail inbox.' });
    }

    const users = getLocalUsers();
    const userId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;

    if (!users[userId]) {
      return res.status(404).json({ error: 'No account found for this email address.' });
    }

    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    users[userId].passwordHash = newHash;
    users[userId].password = newPassword;
    users[userId].updatedAt = new Date().toISOString();
    saveLocalUsers(users);

    otpStore.delete(cleanEmail);

    console.log(`🔐 Reset password successfully for ${cleanEmail}`);
    return res.json({ success: true, message: 'Password reset successful! You can now sign in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/profile', async (req, res) => {
  try {
    const { id, name, email, picture, password, role, phone, whatsapp } = req.body;
    if (!id) return res.status(400).json({ error: 'User ID is required' });

    const users = getLocalUsers();
    const existingUser = users[id] || {};
    let passwordHash = existingUser.passwordHash || '';

    if (password && password.length >= 6) {
      passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    }

    const cleanPhone = (phone || whatsapp || existingUser.phone || existingUser.whatsapp || '').replace(/[^0-9]/g, '');

    const userData = {
      ...existingUser,
      id,
      name: name || existingUser.name || 'Traveler',
      email: email || existingUser.email || 'user@example.com',
      picture: (picture && !picture.includes('alt=') && !picture.includes('dicebear') && !picture.includes('ui-avatars')) ? picture : (existingUser.picture || DEFAULT_USER_AVATAR),
      role: role || existingUser.role || 'user',
      phone: cleanPhone || existingUser.phone || '',
      whatsapp: cleanPhone || existingUser.whatsapp || '',
      passwordHash,
      updatedAt: new Date().toISOString()
    };

    users[id] = userData;
    saveLocalUsers(users);

    if (useFirebase) {
      try {
        await db.collection('users').doc(id).set(userData, { merge: true });
      } catch (fbErr) {
        console.warn('Firebase profile sync note:', fbErr.message);
      }
    }

    const safeUser = { ...userData };
    delete safeUser.passwordHash;

    console.log(`👤 Updated profile for ${id}: ${name} (Password updated: ${!!password})`);
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (useFirebase) {
      try {
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists) {
          const uData = doc.data();
          delete uData.passwordHash;
          return res.json({ success: true, user: uData });
        }
      } catch (fbErr) {
        console.warn('Firebase profile fetch note:', fbErr.message);
      }
    }

    const users = getLocalUsers();
    let user = users[userId];

    if (!user) {
      for (const key in users) {
        if (users[key] && (key.toLowerCase() === userId.toLowerCase() || (users[key].email && users[key].email.toLowerCase() === userId.toLowerCase()))) {
          user = users[key];
          break;
        }
      }
    }

    if (!user) {
      const cleanEmail = userId.includes('@') ? userId : `${userId.replace('google_', '')}@gmail.com`;
      const cleanName = userId.replace('google_', '').split('_')[0];
      const capName = cleanName ? (cleanName.charAt(0).toUpperCase() + cleanName.slice(1)) : 'Traveler';
      user = {
        id: userId,
        name: capName,
        email: cleanEmail,
        picture: DEFAULT_USER_AVATAR
      };
    }

    const safeUser = { ...user };
    delete safeUser.passwordHash;

    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// General File Upload Endpoint (for receipts and bills fallback)
app.post('/api/upload',
  upload.single('file'),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileExt = path.extname(file.originalname);
      const safeFileName = `${Date.now()}_${uuidv4().substring(0, 6)}${fileExt}`;
      const relativePath = `uploads/temp/${safeFileName}`;
      const localPath = path.join(UPLOADS_DIR, 'temp', safeFileName);

      // Ensure temp dir exists
      const tempDir = path.join(UPLOADS_DIR, 'temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      fs.writeFileSync(localPath, file.buffer);

      const protocol = req.protocol;
      const host = req.get('host');
      const fileUrl = `${protocol}://${host}/uploads/temp/${safeFileName}`;

      res.json({
        success: true,
        fileUrl: fileUrl,
        fileName: safeFileName
      });
    } catch (err) {
      console.error('File upload error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ---------- SUPER ADMIN ENDPOINTS ----------
const adminInviteStore = new Map();

// Send Super Admin Invitation Link via Email
app.post('/api/admin/invite-admin', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const token = uuidv4();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    adminInviteStore.set(token, { email: cleanEmail, expiresAt });
    console.log(`👑 Created Super Admin Invitation Token for ${cleanEmail}: ${token}`);

    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const approvalLink = `${protocol}://${host}/api/admin/accept-invite?token=${token}`;

    try {
      await sendEmailNotification({
        to: cleanEmail,
        fromName: 'FreeG Wifi Admin Security',
        subject: `👑 Invitation: Become a Super Admin on FreeG Wifi`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 20px; background: #ffffff;">
            <div style="width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
              <span style="font-size: 24px; color: #ffffff;">👑</span>
            </div>
            <h2 style="color: #0f172a; font-size: 22px; font-weight: 800; margin-bottom: 8px;">FreeG Wifi — Super Admin Invitation</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
              You have been invited to become a <strong>Super Admin</strong> for FreeG Wifi. Accepting this invitation grants you full administrative privileges to view all system users and expense amounts.
            </p>
            <div style="text-align: center; margin-bottom: 28px;">
              <a href="${approvalLink}" style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 800; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px rgba(79,70,229,0.35);">
                ✓ Accept Super Admin Role
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
              If you did not expect this invitation, please ignore this email. Link expires in 24 hours.<br/>
              Approval Link: <span style="font-family: monospace;">${approvalLink}</span>
            </p>
          </div>
        `
      });
      console.log(`✉️ Super Admin invitation email sent to ${cleanEmail}`);
    } catch (mailErr) {
      console.error(`⚠️ Failed to send admin invite email to ${cleanEmail}:`, mailErr.message);
    }

    res.json({
      success: true,
      message: `Super Admin Invitation Link sent to ${cleanEmail}`,
      approvalLink
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept Super Admin Invitation
app.get('/api/admin/accept-invite', (req, res) => {
  try {
    const { token } = req.query;
    if (!token || !adminInviteStore.has(token)) {
      return res.status(400).send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ef4444;">⚠️ Invalid or Expired Invitation Token</h2>
          <p style="color: #64748b;">This Super Admin invitation link is invalid or has expired.</p>
          <a href="/" style="background: #000; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Go to Login</a>
        </div>
      `);
    }

    const invite = adminInviteStore.get(token);
    if (invite.expiresAt < Date.now()) {
      adminInviteStore.delete(token);
      return res.status(400).send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ef4444;">⚠️ Invitation Expired</h2>
          <p style="color: #64748b;">Please ask the Master Super Admin to send a new invitation link.</p>
          <a href="/" style="background: #000; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Go to Login</a>
        </div>
      `);
    }

    const cleanEmail = invite.email;
    const userId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const users = getLocalUsers();
    const existing = users[userId] || {};

    users[userId] = {
      ...existing,
      id: userId,
      name: existing.name || cleanEmail.split('@')[0],
      email: cleanEmail,
      role: 'super_admin',
      verified: true,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);
    adminInviteStore.delete(token);

    console.log(`👑 Super Admin Role Granted to ${cleanEmail}`);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Super Admin Role Accepted - FreeG Wifi</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
        <style>
          body { font-family: 'Inter', sans-serif; background: #0f172a; color: #ffffff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          .card { background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 40px; text-align: center; max-width: 440px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
          .badge { width: 64px; height: 64px; border-radius: 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto; font-size: 32px; box-shadow: 0 8px 24px rgba(16,185,129,0.3); }
          h1 { font-size: 1.5rem; font-weight: 800; margin-bottom: 8px; color: #ffffff; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 28px; }
          .btn { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; border: none; padding: 14px 28px; border-radius: 14px; font-weight: 700; font-size: 1rem; text-decoration: none; display: inline-block; width: 100%; box-sizing: border-box; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge"><i class="fa-solid fa-crown"></i></div>
          <h1>Super Admin Role Approved!</h1>
          <p>Your account (<strong>${cleanEmail}</strong>) is now registered as a Super Admin on FreeG Wifi.</p>
          <a href="/#auth" class="btn">Proceed to Login →</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error accepting admin invitation: ' + err.message);
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const { month } = req.query; // e.g., '2026-08' or 'all'
    const usersObj = getLocalUsers();
    let allExpenses = getLocalExpenses();

    if (month && month !== 'all') {
      allExpenses = allExpenses.filter(e => e.date && e.date.startsWith(month));
    }

    let totalSystemPending = 0;
    let totalSystemPaid = 0;

    const usersList = Object.values(usersObj).map(user => {
      const userCleanId = user.email ? `google_${user.email.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
      const userExpenses = allExpenses.filter(e => {
        if (!e || !e.userId) return false;
        const eUid = e.userId.toLowerCase().trim();
        return (
          eUid === (user.id || '').toLowerCase().trim() ||
          eUid === (user.email || '').toLowerCase().trim() ||
          (userCleanId && eUid === userCleanId.toLowerCase())
        );
      });
      
      const pendingAmount = userExpenses
        .filter(e => e.paymentStatus === 'pending' || !e.paymentStatus)
        .reduce((sum, e) => sum + (e.total || 0), 0);

      const paidAmount = userExpenses
        .filter(e => e.paymentStatus === 'paid')
        .reduce((sum, e) => sum + (e.total || 0), 0);

      const lifetimeAmount = userExpenses.reduce((sum, e) => sum + (e.total || 0), 0);

      totalSystemPending += pendingAmount;
      totalSystemPaid += paidAmount;

      const receiptCount = userExpenses.reduce((sum, e) => sum + ((e.receipts && e.receipts.length) || 0), 0);
      const role = user.role || ((user.email && (user.email.toLowerCase().includes('admin') || user.email.toLowerCase().includes('superadmin') || user.email.toLowerCase() === 'subodhram3350@gmail.com')) ? 'super_admin' : 'user');

      const paidExpWithBill = userExpenses.find(e => e.paymentBillUrl);
      const paymentBillUrl = paidExpWithBill ? paidExpWithBill.paymentBillUrl : '';

      return {
        id: user.id,
        name: user.name || 'User',
        email: user.email,
        picture: user.picture,
        verified: !!user.verified,
        role,
        totalAmount: pendingAmount, // Active outstanding balance: becomes 0 when settled/paid!
        pendingAmount,
        paidAmount,
        lifetimeAmount,
        expenseCount: userExpenses.length,
        receiptCount,
        paymentBillUrl,
        updatedAt: user.updatedAt || new Date().toISOString()
      };
    });

    res.json({
      success: true,
      selectedMonth: month || 'all',
      users: usersList,
      totalSystemUsers: usersList.length,
      totalSystemAmount: totalSystemPending, // Active outstanding total across system
      totalSystemPendingAmount: totalSystemPending,
      totalSystemPaidAmount: totalSystemPaid,
      totalSystemLifetimeAmount: totalSystemPending + totalSystemPaid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/admin/add-member', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    const cleanEmail = email.toLowerCase().trim();
    const userId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const users = getLocalUsers();

    if (users[userId]) {
      return res.status(400).json({ error: 'Member with this email already exists' });
    }

    users[userId] = {
      id: userId,
      name: name || cleanEmail.split('@')[0],
      email: cleanEmail,
      picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || cleanEmail)}`,
      verified: true,
      role: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);

    res.json({ success: true, user: users[userId] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/edit-member', async (req, res) => {
  try {
    const { userId, name, email } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    const users = getLocalUsers();
    if (!users[userId]) return res.status(404).json({ error: 'Member not found' });

    if (name) users[userId].name = name.trim();
    if (email && email.includes('@')) users[userId].email = email.toLowerCase().trim();
    users[userId].updatedAt = new Date().toISOString();

    saveLocalUsers(users);
    res.json({ success: true, user: users[userId] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/update-settlement-bill', upload.single('paymentProof'), async (req, res) => {
  try {
    const { userId, month, action } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });

    let allExpenses = getLocalExpenses();
    let paymentBillUrl = '';

    if (action === 'update' && req.file) {
      try {
        paymentBillUrl = await uploadToCloudinary(req.file.buffer, req.file.mimetype, 'payment_bills');
      } catch (cloudErr) {
        // Fallback to local disk if Cloudinary fails
        const ext = path.extname(req.file.originalname) || '.png';
        const fileName = `bill_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(filePath, req.file.buffer);
        const protocol = req.protocol || 'https';
        const host = req.get('host') || 'travelexpense-52gp.onrender.com';
        paymentBillUrl = `${protocol}://${host}/uploads/${fileName}`;
        console.warn('Cloudinary fallback to local:', cloudErr.message);
      }
    }

    let modifiedCount = 0;

    allExpenses = allExpenses.map(e => {
      const isTargetUser = (e.userId === userId);
      const isTargetMonth = (!month || month === 'all' || (e.date && e.date.startsWith(month)));

      if (isTargetUser && isTargetMonth) {
        modifiedCount++;
        if (action === 'delete') {
          return {
            ...e,
            paymentStatus: 'pending',
            paymentBillUrl: '',
            settledAt: null,
            settlementNotes: ''
          };
        } else if (action === 'update' && paymentBillUrl) {
          return {
            ...e,
            paymentBillUrl: paymentBillUrl
          };
        }
      }
      return e;
    });

    const users = getLocalUsers();
    const targetUser = users[userId];
    if (targetUser) {
      if (action === 'delete') {
        targetUser.paymentBillUrl = '';
      } else if (action === 'update' && paymentBillUrl) {
        targetUser.paymentBillUrl = paymentBillUrl;
      }
      targetUser.updatedAt = new Date().toISOString();
      saveLocalUsers(users);
    }

    saveLocalExpenses(allExpenses);

    // Send email notification to user on bill update
    if (action === 'update' && targetUser && targetUser.email && paymentBillUrl) {
      await sendEmailNotification({
        to: targetUser.email,
        fromName: 'FreeG TravelExpense Admin',
        subject: `⚡ Updated Reimbursement Payment Proof Bill - FreeG TravelExpense`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #0f172a; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #059669; margin-top: 0;">Updated Payment Bill Proof Uploaded</h2>
            <p>Hello <strong>${targetUser.name || 'Member'}</strong>,</p>
            <p>Your Super Admin has uploaded an <strong>updated payment proof bill</strong> for your travel expense reimbursements (${month || 'Current Month'}).</p>
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
              <p style="margin-bottom: 8px; font-weight: bold; color: #334155;">Updated Bill Proof Photo:</p>
              <a href="${paymentBillUrl}" target="_blank" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold;">
                🖼️ View Updated Bill Photo
              </a>
            </div>
            <p style="color: #64748b; font-size: 0.85rem;">You can also view this updated bill inside your app under <strong>Account → Expense History</strong>.</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 0.8rem; color: #94a3b8; margin: 0;">FreeG Wifi Travel Expense Management System</p>
          </div>
        `
      });
    }

    res.json({
      success: true,
      message: action === 'delete' ? 'Payment bill deleted and status reset to Pending' : 'Payment bill updated successfully',
      paymentBillUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/settle-payment', upload.single('paymentProof'), async (req, res) => {
  try {
    const { userId, month, notes } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const users = getLocalUsers();
    const targetUser = users[userId];
    if (!targetUser) {
      return res.status(404).json({ error: 'Member not found' });
    }

    let paymentBillUrl = '';
    if (req.file) {
      try {
        paymentBillUrl = await uploadToCloudinary(req.file.buffer, req.file.mimetype, 'payment_bills');
      } catch (cloudErr) {
        // Fallback to local disk if Cloudinary fails
        const ext = path.extname(req.file.originalname) || '.png';
        const fileName = `bill_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(filePath, req.file.buffer);
        const protocol = req.protocol || 'https';
        const host = req.get('host') || 'travelexpense-52gp.onrender.com';
        paymentBillUrl = `${protocol}://${host}/uploads/${fileName}`;
        console.warn('Cloudinary fallback to local:', cloudErr.message);
      }
    }

    const userCleanId = targetUser.email ? `google_${targetUser.email.replace(/[^a-zA-Z0-9]/g, '_')}` : '';

    let allExpenses = getLocalExpenses();
    let settledCount = 0;
    let settledTotal = 0;

    allExpenses = allExpenses.map(e => {
      const eUid = (e.userId || '').toLowerCase().trim();
      const isTargetUser = (
        eUid === (userId || '').toLowerCase().trim() ||
        eUid === (targetUser.id || '').toLowerCase().trim() ||
        eUid === (targetUser.email || '').toLowerCase().trim() ||
        (userCleanId && eUid === userCleanId.toLowerCase())
      );
      const isTargetMonth = (!month || month === 'all' || (e.date && e.date.startsWith(month)));

      if (isTargetUser && isTargetMonth) {
        if (e.paymentStatus !== 'paid') {
          settledCount++;
          settledTotal += (e.total || 0);
        }
        const updatedExp = {
          ...e,
          paymentStatus: 'paid',
          settledAt: new Date().toISOString(),
          paymentBillUrl: paymentBillUrl || e.paymentBillUrl || '',
          settlementNotes: notes || e.settlementNotes || 'Paid by Super Admin'
        };

        if (useFirebase && e.id) {
          db.collection('expenses').doc(e.id).update({
            paymentStatus: 'paid',
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentBillUrl: updatedExp.paymentBillUrl,
            settlementNotes: updatedExp.settlementNotes
          }).catch(fbErr => console.warn('Firebase settlement update note:', fbErr.message));
        }

        return updatedExp;
      }
      return e;
    });

    if (paymentBillUrl) {
      targetUser.paymentBillUrl = paymentBillUrl;
      targetUser.updatedAt = new Date().toISOString();
      saveLocalUsers(users);
    }

    saveLocalExpenses(allExpenses);

    // Send Reimbursement Confirmation Email to User
    if (targetUser && targetUser.email) {
      const monthLabel = month && month !== 'all' ? month : 'current month';
      await sendEmailNotification({
        to: targetUser.email,
        fromName: 'FreeG Wifi Accounts',
        subject: `✅ Reimbursement Paid: ₹${settledTotal.toLocaleString('en-IN')} for ${targetUser.name}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 20px; background: #ffffff;">
            <div style="width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
              <span style="font-size: 24px; color: #ffffff;">💳</span>
            </div>
            <h2 style="color: #0f172a; font-size: 22px; font-weight: 800; margin-bottom: 8px;">Reimbursement Payment Successful!</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">
              Hello <strong>${targetUser.name}</strong>,<br/>
              Your travel expense reimbursement of <strong style="color: #059669; font-size: 18px;">₹${settledTotal.toLocaleString('en-IN')}</strong> for <strong>${monthLabel}</strong> has been successfully settled and paid by Super Admin.
            </p>
            ${paymentBillUrl ? `
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 14px; padding: 16px; margin-bottom: 20px; text-align: center;">
                <span style="font-size: 14px; font-weight: 700; color: #334155; display: block; margin-bottom: 8px;">📑 Uploaded Payment Proof / Receipt:</span>
                <a href="${paymentBillUrl}" target="_blank" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 10px; font-weight: 700; font-size: 14px; display: inline-block;">
                  View Uploaded Payment Bill
                </a>
              </div>
            ` : ''}
            <p style="color: #94a3b8; font-size: 13px; margin: 0;">FreeG Wifi Expense Management System</p>
          </div>
        `
      });
    }

    res.json({
      success: true,
      message: `Successfully settled ₹${settledTotal} for ${targetUser.name}`,
      settledCount,
      settledTotal,
      paymentBillUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/delete-settlement', async (req, res) => {
  try {
    const { userId, month, action } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const users = getLocalUsers();
    const targetUser = users[userId];

    if (action === 'delete_user') {
      const matchedTarget = users[userId] || Object.values(users).find(u => u.id === userId || u.email === userId);
      const userCleanId = (matchedTarget && matchedTarget.email) ? `google_${matchedTarget.email.replace(/[^a-zA-Z0-9]/g, '_')}` : '';

      // 1. Add to permanent deletion blacklist
      addDeletedUser(userId);
      if (matchedTarget) addDeletedUser(matchedTarget);
      if (userCleanId) addDeletedUser(userCleanId);

      // 2. Delete ALL matching user keys from users.json
      Object.keys(users).forEach(key => {
        const u = users[key];
        const isMatch = (
          key.toLowerCase() === (userId || '').toLowerCase().trim() ||
          (matchedTarget && (key.toLowerCase() === (matchedTarget.id || '').toLowerCase().trim() || (u && u.email && u.email.toLowerCase().trim() === (matchedTarget.email || '').toLowerCase().trim()))) ||
          (userCleanId && key.toLowerCase() === userCleanId.toLowerCase())
        );
        if (isMatch) delete users[key];
      });
      saveLocalUsers(users);

      // 3. Delete ALL expenses of this user from expenses.json
      let allExpenses = getLocalExpenses();
      allExpenses = allExpenses.filter(e => {
        const eUid = (e.userId || '').toLowerCase().trim();
        const isTargetUser = (
          eUid === (userId || '').toLowerCase().trim() ||
          (matchedTarget && (eUid === (matchedTarget.id || '').toLowerCase().trim() || eUid === (matchedTarget.email || '').toLowerCase().trim())) ||
          (userCleanId && eUid === userCleanId.toLowerCase())
        );
        return !isTargetUser;
      });
      saveLocalExpenses(allExpenses);

      // 4. Purge deleted user from existing backup files in BACKUP_DIR
      try {
        if (fs.existsSync(BACKUP_DIR)) {
          const files = fs.readdirSync(BACKUP_DIR);
          files.forEach(f => {
            const fPath = path.join(BACKUP_DIR, f);
            if (f.startsWith('users_')) {
              try {
                const bUsers = JSON.parse(fs.readFileSync(fPath, 'utf8'));
                if (bUsers && typeof bUsers === 'object') {
                  Object.keys(bUsers).forEach(k => {
                    const u = bUsers[k];
                    const isMatch = (
                      k.toLowerCase() === (userId || '').toLowerCase().trim() ||
                      (matchedTarget && (k.toLowerCase() === (matchedTarget.id || '').toLowerCase().trim() || (u && u.email && u.email.toLowerCase().trim() === (matchedTarget.email || '').toLowerCase().trim()))) ||
                      (userCleanId && k.toLowerCase() === userCleanId.toLowerCase())
                    );
                    if (isMatch) delete bUsers[k];
                  });
                  fs.writeFileSync(fPath, JSON.stringify(bUsers, null, 2));
                }
              } catch (e) {}
            } else if (f.startsWith('expenses_')) {
              try {
                let bExp = JSON.parse(fs.readFileSync(fPath, 'utf8'));
                if (Array.isArray(bExp)) {
                  bExp = bExp.filter(e => {
                    const eUid = (e.userId || '').toLowerCase().trim();
                    const isTargetUser = (
                      eUid === (userId || '').toLowerCase().trim() ||
                      (matchedTarget && (eUid === (matchedTarget.id || '').toLowerCase().trim() || eUid === (matchedTarget.email || '').toLowerCase().trim())) ||
                      (userCleanId && eUid === userCleanId.toLowerCase())
                    );
                    return !isTargetUser;
                  });
                  fs.writeFileSync(fPath, JSON.stringify(bExp, null, 2));
                }
              } catch (e) {}
            }
          });
        }
      } catch (bkErr) {
        console.warn('Backup purge note:', bkErr.message);
      }

      // 5. Delete from Firebase Firestore + write to deleted_users archive
      if (useFirebase) {
        try {
          // Fetch user's expenses from Firestore before deleting (for archive)
          const expSnap1 = await db.collection('expenses').where('userId', '==', userId).get().catch(() => ({ docs: [] }));
          const expSnap2 = userCleanId ? await db.collection('expenses').where('userId', '==', userCleanId).get().catch(() => ({ docs: [] })) : { docs: [] };
          const archivedExpenses = [...expSnap1.docs, ...expSnap2.docs].map(d => d.data());

          // Write permanent archive to deleted_users collection in Firestore
          const archiveId = `deleted_${Date.now()}_${(matchedTarget?.email || userId).replace(/[^a-zA-Z0-9]/g, '_')}`;
          await db.collection('deleted_users').doc(archiveId).set({
            originalId:    userId,
            cleanId:       userCleanId || '',
            name:          matchedTarget?.name  || '',
            email:         matchedTarget?.email || '',
            role:          matchedTarget?.role  || 'user',
            picture:       matchedTarget?.picture || '',
            verified:      !!matchedTarget?.verified,
            joinedAt:      matchedTarget?.updatedAt || '',
            deletedAt:     new Date().toISOString(),
            deletedBy:     'admin',
            totalExpenses: archivedExpenses.length,
            lifetimeAmount: archivedExpenses.reduce((s, e) => s + (e.total || 0), 0),
            expenseHistory: archivedExpenses,   // full expense log preserved
            note: 'Permanently deleted by admin. This record is for audit purposes only.'
          });

          // Now delete from Firestore users collection
          if (userId)           db.collection('users').doc(userId).delete().catch(() => {});
          if (userCleanId)      db.collection('users').doc(userCleanId).delete().catch(() => {});
          if (matchedTarget?.id) db.collection('users').doc(matchedTarget.id).delete().catch(() => {});

          // Delete all expenses from Firestore
          const deleteBatch = db.batch();
          [...expSnap1.docs, ...expSnap2.docs].forEach(d => deleteBatch.delete(d.ref));
          await deleteBatch.commit();

          console.log(`🗃️ Firestore archive written: deleted_users/${archiveId}`);
        } catch (fbErr) {
          console.warn('Firebase user deletion note:', fbErr.message);
        }
      }

      console.log(`🗑️ Permanently deleted member account: ${userId} (${matchedTarget?.email || ''})`);
      
      // ✅ AUTO-SYNC: Immediately broadcast deletion to Render Live Host
      triggerCloudSync().catch(() => {});
      
      return res.json({ success: true, message: 'Member deleted permanently' });

    }

    // Reset payment status back to pending
    let allExpenses = getLocalExpenses();
    const userCleanId = (targetUser && targetUser.email) ? `google_${targetUser.email.replace(/[^a-zA-Z0-9]/g, '_')}` : '';

    allExpenses = allExpenses.map(e => {
      const eUid = (e.userId || '').toLowerCase().trim();
      const isTargetUser = (
        eUid === (userId || '').toLowerCase().trim() ||
        (targetUser && eUid === (targetUser.id || '').toLowerCase().trim()) ||
        (targetUser && eUid === (targetUser.email || '').toLowerCase().trim()) ||
        (userCleanId && eUid === userCleanId.toLowerCase())
      );
      const isTargetMonth = (!month || month === 'all' || (e.date && e.date.startsWith(month)));

      if (isTargetUser && isTargetMonth) {
        return {
          ...e,
          paymentStatus: 'pending',
          settledAt: null,
          paymentBillUrl: null
        };
      }
      return e;
    });
    saveLocalExpenses(allExpenses);

    if (targetUser) {
      targetUser.paymentBillUrl = '';
      targetUser.updatedAt = new Date().toISOString();
      saveLocalUsers(users);
    }

    res.json({ success: true, message: 'Settlement reset back to Pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/all-expenses', async (req, res) => {
  try {
    let allExpenses = getLocalExpenses();
    if (useFirebase && db) {
      try {
        const snapshot = await db.collection('expenses').get();
        const fbExpenses = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          let createdAtStr = data.createdAt;
          if (data.createdAt && typeof data.createdAt.toDate === 'function') {
            createdAtStr = data.createdAt.toDate().toISOString();
          } else if (data.createdAt && data.createdAt._seconds) {
            createdAtStr = new Date(data.createdAt._seconds * 1000).toISOString();
          }
          fbExpenses.push({ id: doc.id, ...data, createdAt: createdAtStr });
        });
        if (fbExpenses.length > 0) {
          allExpenses = fbExpenses;
        }
      } catch (e) {
        console.warn('Firebase admin expenses fetch warning:', e.message);
      }
    }

    const usersObj = getLocalUsers();
    const expensesWithUser = allExpenses.map(exp => ({
      ...exp,
      userName: usersObj[exp.userId]?.name || 'User',
      userEmail: usersObj[exp.userId]?.email || exp.userId
    }));

    res.json({ success: true, expenses: expensesWithUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---------- CREATE EXPENSE ----------
app.post('/api/expenses', authenticate, async (req, res) => {
  try {
    const { date, location, entries, paymentStatus, receipts, notes } = req.body;
    const userId = req.userId;

    if (!date || !location) {
      return res.status(400).json({ error: 'Date and location are required' });
    }

    const cleanEntries = (entries || []).map(e => ({
      type: e.type || 'Other',
      amount: parseFloat(e.amount) || 0
    }));

    const total = cleanEntries.reduce((sum, e) => sum + e.amount, 0);
    const nowIso = new Date().toISOString();

    const expenseData = {
      userId,
      date,
      location,
      notes: notes || location,
      entries: cleanEntries,
      total,
      paymentStatus: paymentStatus || 'pending', // 'pending' or 'paid'
      receipts: receipts || [],
      createdAt: nowIso,
      updatedAt: nowIso
    };

    if (useFirebase) {
      const docRef = await db.collection('expenses').add({
        ...expenseData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      const newExpense = { id: docRef.id, ...expenseData };
      const expenses = getLocalExpenses();
      expenses.unshift(newExpense);
      saveLocalExpenses(expenses);

      broadcastEvent('EXPENSES_UPDATED', { expenseId: docRef.id, userId });
      return res.status(201).json({
        success: true,
        expenseId: docRef.id,
        data: newExpense
      });
    } else {
      const expenseId = `exp_${uuidv4().substring(0, 8)}`;
      const newExpense = { id: expenseId, ...expenseData };
      const expenses = getLocalExpenses();
      expenses.unshift(newExpense);
      saveLocalExpenses(expenses);

      return res.status(201).json({
        success: true,
        expenseId: expenseId,
        data: newExpense
      });
    }
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------- UPDATE / EDIT EXPENSE ----------
app.put('/api/expenses/:expenseId', authenticate, async (req, res) => {
  try {
    const { expenseId } = req.params;
    const { date, location, entries, paymentStatus, receipts, notes } = req.body;
    const userId = req.userId;

    const cleanEntries = (entries || []).map(e => ({
      type: e.type || 'Other',
      amount: parseFloat(e.amount) || 0
    }));

    const total = cleanEntries.reduce((sum, e) => sum + e.amount, 0);

    if (useFirebase) {
      const updateData = {
        date,
        location,
        entries: cleanEntries,
        total,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (paymentStatus) updateData.paymentStatus = paymentStatus;
      if (receipts !== undefined) updateData.receipts = receipts;
      if (notes !== undefined) updateData.notes = notes;

      await db.collection('expenses').doc(expenseId).update(updateData);
      broadcastEvent('EXPENSES_UPDATED', { expenseId, userId });
      return res.json({ success: true, message: 'Expense updated successfully' });
    } else {
      const expenses = getLocalExpenses();
      const idx = expenses.findIndex(e => e.id === expenseId);

      if (idx === -1) {
        return res.status(404).json({ error: 'Expense entry not found' });
      }

      expenses[idx] = {
        ...expenses[idx],
        date: date || expenses[idx].date,
        location: location || expenses[idx].location,
        notes: notes !== undefined ? notes : (expenses[idx].notes || location),
        receipts: receipts !== undefined ? receipts : (expenses[idx].receipts || []),
        entries: cleanEntries,
        total,
        paymentStatus: paymentStatus || expenses[idx].paymentStatus || 'pending',
        updatedAt: new Date().toISOString()
      };

      saveLocalExpenses(expenses);
      return res.json({ success: true, message: 'Expense updated successfully', data: expenses[idx] });
    }
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------- QUICK TOGGLE PAYMENT STATUS ----------
app.patch('/api/expenses/:expenseId/payment-status', authenticate, async (req, res) => {
  try {
    const { expenseId } = req.params;
    const { paymentStatus } = req.body; // 'pending' or 'paid'

    if (!paymentStatus || !['pending', 'paid'].includes(paymentStatus)) {
      return res.status(400).json({ error: 'Invalid paymentStatus' });
    }

    if (useFirebase) {
      await db.collection('expenses').doc(expenseId).update({
        paymentStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      broadcastEvent('EXPENSES_UPDATED', { expenseId, paymentStatus });
      return res.json({ success: true, message: `Status updated to ${paymentStatus}` });
    } else {
      const expenses = getLocalExpenses();
      const idx = expenses.findIndex(e => e.id === expenseId);

      if (idx === -1) {
        return res.status(404).json({ error: 'Expense entry not found' });
      }

      expenses[idx].paymentStatus = paymentStatus;
      expenses[idx].updatedAt = new Date().toISOString();

      saveLocalExpenses(expenses);
      return res.json({ success: true, message: `Status updated to ${paymentStatus}`, data: expenses[idx] });
    }
  } catch (error) {
    console.error('Error updating payment status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------- GET ALL EXPENSES (By User or Shared Link) ----------
app.get('/api/expenses', async (req, res) => {
  try {
    // For shared view: allow userId from query param
    let userId = req.query.userId || req.query.share;

    // Otherwise, require user-id header (authenticated user)
    if (!userId) {
      userId = req.headers['user-id'];
    }

    if (!userId || userId === 'user_123' || userId === 'google_user') {
      return res.status(401).json({ error: 'Unauthorized: user-id required' });
    }

    // Collect all valid user ID aliases (Google sub ID, email slug ID, master admin ID)
    const validUserIds = new Set([userId]);
    const users = getLocalUsers();
    const currentUser = users[userId] || Object.values(users).find(u => u && (u.id === userId || u.email === userId));

    if (currentUser) {
      if (currentUser.id) validUserIds.add(currentUser.id);
      if (currentUser.email) {
        validUserIds.add(`google_${currentUser.email.replace(/[^a-zA-Z0-9]/g, '_')}`);
      }
    }
    if (userId.includes('subodh') || (currentUser && currentUser.email && currentUser.email.includes('subodh'))) {
      validUserIds.add('google_subodhram3350_gmail_com');
    }

    if (useFirebase) {
      const expensesMap = new Map();
      for (const uid of validUserIds) {
        try {
          const snapshot = await db.collection('expenses')
            .where('userId', '==', uid)
            .get();

          snapshot.forEach(doc => {
            const data = doc.data();
            let createdAtStr = data.createdAt;
            if (data.createdAt && typeof data.createdAt.toDate === 'function') {
              createdAtStr = data.createdAt.toDate().toISOString();
            } else if (data.createdAt && data.createdAt._seconds) {
              createdAtStr = new Date(data.createdAt._seconds * 1000).toISOString();
            }
            let updatedAtStr = data.updatedAt;
            if (data.updatedAt && typeof data.updatedAt.toDate === 'function') {
              updatedAtStr = data.updatedAt.toDate().toISOString();
            } else if (data.updatedAt && data.updatedAt._seconds) {
              updatedAtStr = new Date(data.updatedAt._seconds * 1000).toISOString();
            }
            expensesMap.set(doc.id, { id: doc.id, ...data, createdAt: createdAtStr, updatedAt: updatedAtStr });
          });
        } catch (qErr) {}
      }

      const expenses = Array.from(expensesMap.values());
      expenses.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
      return res.json({ success: true, expenses });
    } else {
      const all = getLocalExpenses();
      let userExpenses = all.filter(e => validUserIds.has(e.userId));
      userExpenses.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));

      return res.json({ success: true, expenses: userExpenses });
    }
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------- GET EXPENSES BY DATE ----------
app.get('/api/expenses/date/:date', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { date } = req.params;

    if (useFirebase) {
      const snapshot = await db.collection('expenses')
        .where('userId', '==', userId)
        .where('date', '==', date)
        .get();

      const expenses = [];
      snapshot.forEach(doc => {
        expenses.push({ id: doc.id, ...doc.data() });
      });

      return res.json({ success: true, expenses });
    } else {
      const all = getLocalExpenses();
      const filtered = all.filter(e => e.userId === userId && e.date === date);
      return res.json({ success: true, expenses: filtered });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- UPLOAD RECEIPT (Cloudinary Direct or Server Upload) ----------
app.post('/api/expenses/:expenseId/receipts',
  authenticate,
  (req, res, next) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
      return upload.single('receipt')(req, res, next);
    }
    next();
  },
  async (req, res) => {
    try {
      const { expenseId } = req.params;
      const userId = req.userId;
      const file = req.file;

      // Handle Direct Cloudinary URL payload from client
      if (req.body && req.body.fileUrl) {
        const receiptData = {
          fileName: req.body.fileName || `cloud_${Date.now()}`,
          originalName: req.body.originalName || 'Cloudinary Receipt',
          fileUrl: req.body.fileUrl,
          publicId: req.body.publicId || '',
          provider: 'Cloudinary',
          uploadedAt: new Date().toISOString()
        };

        if (useFirebase) {
          await db.collection('expenses').doc(expenseId).update({
            receipts: admin.firestore.FieldValue.arrayUnion(receiptData),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          const expenses = getLocalExpenses();
          const expIndex = expenses.findIndex(e => e.id === expenseId);
          if (expIndex === -1) {
            return res.status(404).json({ error: 'Expense not found' });
          }
          if (!expenses[expIndex].receipts) expenses[expIndex].receipts = [];
          expenses[expIndex].receipts.push(receiptData);
          expenses[expIndex].updatedAt = new Date().toISOString();
          saveLocalExpenses(expenses);
        }

        return res.json({
          success: true,
          receipt: receiptData,
          message: 'Cloudinary receipt attached successfully!'
        });
      }

      if (!file) {
        return res.status(400).json({ error: 'No file or fileUrl uploaded' });
      }

      const fileExt = path.extname(file.originalname);
      const safeFileName = `${Date.now()}_${uuidv4().substring(0, 6)}${fileExt}`;

      let fileUrl = '';

      if (useFirebase) {
        const storagePath = `receipts/${userId}/${expenseId}/${safeFileName}`;
        const fileRef = bucket.file(storagePath);

        await fileRef.save(file.buffer, {
          metadata: { contentType: file.mimetype }
        });

        const [url] = await fileRef.getSignedUrl({
          action: 'read',
          expires: '03-01-2027'
        });
        fileUrl = url;

        const receiptData = {
          fileName: safeFileName,
          originalName: file.originalname,
          fileUrl: url,
          uploadedAt: new Date().toISOString()
        };

        await db.collection('expenses').doc(expenseId).update({
          receipts: admin.firestore.FieldValue.arrayUnion(receiptData),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({
          success: true,
          receipt: receiptData,
          message: 'Receipt uploaded to Firebase Storage!'
        });
      } else {
        // Cloudinary upload fallback (when Firebase Storage not connected)
        try {
          fileUrl = await uploadToCloudinary(
            file.buffer, file.mimetype,
            `receipts/${userId}/${expenseId}`
          );
        } catch (cloudErr) {
          // Last resort: local disk
          const userFolder = path.join(UPLOADS_DIR, userId, expenseId);
          if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });
          fs.writeFileSync(path.join(userFolder, safeFileName), file.buffer);
          const protocol = req.protocol;
          const host = req.get('host');
          fileUrl = `${protocol}://${host}/uploads/${userId}/${expenseId}/${safeFileName}`;
          console.warn('Cloudinary receipt fallback to local:', cloudErr.message);
        }

        const receiptData = {
          fileName: safeFileName,
          originalName: file.originalname,
          fileUrl: fileUrl,
          provider: 'Cloudinary',
          uploadedAt: new Date().toISOString()
        };

        const expenses = getLocalExpenses();
        const expIndex = expenses.findIndex(e => e.id === expenseId);

        if (expIndex === -1) {
          return res.status(404).json({ error: 'Expense not found' });
        }

        if (!expenses[expIndex].receipts) expenses[expIndex].receipts = [];
        expenses[expIndex].receipts.push(receiptData);
        expenses[expIndex].updatedAt = new Date().toISOString();

        saveLocalExpenses(expenses);

        return res.json({
          success: true,
          receipt: receiptData,
          message: 'Receipt uploaded to Cloudinary!'
        });
      }
    } catch (error) {
      console.error('Error uploading receipt:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ---------- DELETE RECEIPT BY INDEX ----------
app.delete('/api/expenses/:expenseId/receipts/index/:index', authenticate, async (req, res) => {
  try {
    const { expenseId, index } = req.params;
    const idx = parseInt(index, 10);
    const userId = req.userId;

    if (useFirebase) {
      const docRef = db.collection('expenses').doc(expenseId);
      const doc = await docRef.get();
      if (!doc.exists) return res.status(404).json({ error: 'Expense not found' });
      const data = doc.data();
      const receipts = data.receipts || [];
      if (isNaN(idx) || idx < 0 || idx >= receipts.length) return res.status(400).json({ error: 'Invalid receipt index' });

      const deleted = receipts.splice(idx, 1)[0];
      await docRef.update({
        receipts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.json({ success: true, message: 'Receipt deleted!', deleted });
    } else {
      const expenses = getLocalExpenses();
      const expIndex = expenses.findIndex(e => e.id === expenseId);
      if (expIndex === -1) return res.status(404).json({ error: 'Expense not found' });

      const receipts = expenses[expIndex].receipts || [];
      if (isNaN(idx) || idx < 0 || idx >= receipts.length) return res.status(400).json({ error: 'Invalid receipt index' });

      const [deleted] = receipts.splice(idx, 1);
      expenses[expIndex].receipts = receipts;
      expenses[expIndex].updatedAt = new Date().toISOString();
      saveLocalExpenses(expenses);
      return res.json({ success: true, message: 'Receipt deleted!', deleted });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- DELETE RECEIPT BY FILENAME ----------
app.delete('/api/expenses/:expenseId/receipts/:fileName', authenticate, async (req, res) => {
  try {
    const { expenseId, fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const userId = req.userId;

    if (useFirebase) {
      const docRef = db.collection('expenses').doc(expenseId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({ error: 'Expense not found' });
      }

      const data = doc.data();
      const updatedReceipts = (data.receipts || []).filter(r => 
        r.fileName !== decodedFileName && r.publicId !== decodedFileName && r.fileName !== fileName
      );

      await docRef.update({
        receipts: updatedReceipts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ success: true, message: 'Receipt deleted!' });
    } else {
      const expenses = getLocalExpenses();
      const expIndex = expenses.findIndex(e => e.id === expenseId);

      if (expIndex === -1) {
        return res.status(404).json({ error: 'Expense not found' });
      }

      expenses[expIndex].receipts = (expenses[expIndex].receipts || []).filter(r => 
        r.fileName !== decodedFileName && r.publicId !== decodedFileName && r.fileName !== fileName
      );
      expenses[expIndex].updatedAt = new Date().toISOString();
      saveLocalExpenses(expenses);

      return res.json({ success: true, message: 'Receipt deleted!' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- DELETE EXPENSE ----------
app.delete('/api/expenses/:expenseId', authenticate, async (req, res) => {
  try {
    const { expenseId } = req.params;
    const userId = req.userId;

    // Collect all valid user ID aliases (Google sub ID, email slug ID, master admin ID)
    const validUserIds = new Set([userId]);
    const users = getLocalUsers();
    const currentUser = users[userId] || Object.values(users).find(u => u && (u.id === userId || u.email === userId));

    if (currentUser) {
      if (currentUser.id) validUserIds.add(currentUser.id);
      if (currentUser.email) {
        validUserIds.add(`google_${currentUser.email.replace(/[^a-zA-Z0-9]/g, '_')}`);
      }
    }
    if (userId.includes('subodh') || (currentUser && currentUser.email && currentUser.email.includes('subodh'))) {
      validUserIds.add('google_subodhram3350_gmail_com');
    }
    const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin');

    // 1. Delete from Local JSON storage
    const expenses = getLocalExpenses();
    const expIndex = expenses.findIndex(e => e.id === expenseId);

    if (expIndex !== -1) {
      if (!isAdmin && !validUserIds.has(expenses[expIndex].userId)) {
        return res.status(403).json({ error: 'Unauthorized: Cannot delete expense of another user' });
      }
      expenses.splice(expIndex, 1);
      // Write updated list to local file without background batch write
      const tempPath = `${LOCAL_DB_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(expenses, null, 2));
      fs.renameSync(tempPath, LOCAL_DB_FILE);
      broadcastEvent('EXPENSES_UPDATED');
    }

    // 2. Delete from Firebase Firestore if connected
    if (useFirebase && db) {
      try {
        const docRef = db.collection('expenses').doc(expenseId);
        const doc = await docRef.get();
        if (doc.exists) {
          const data = doc.data();
          if (!isAdmin && !validUserIds.has(data.userId)) {
            return res.status(403).json({ error: 'Unauthorized: Cannot delete expense of another user' });
          }
          // Delete receipt files from bucket if any
          for (const receipt of data.receipts || []) {
            try {
              if (receipt.fileName && bucket) {
                const filePath = `receipts/${userId}/${expenseId}/${receipt.fileName}`;
                await bucket.file(filePath).delete();
              }
            } catch (e) {}
          }
          await docRef.delete();
          console.log(`🔥 Expense ${expenseId} deleted from Firebase Firestore`);
        }
      } catch (fbErr) {
        console.warn('⚠️ Firebase expense delete note:', fbErr.message);
      }
    }

    // 3. Delete local uploads folder if exists
    const userFolder = path.join(UPLOADS_DIR, userId, expenseId);
    if (fs.existsSync(userFolder)) {
      fs.rmSync(userFolder, { recursive: true, force: true });
    }

    return res.json({ success: true, message: 'Expense deleted successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- ADMIN INVITE & VERIFICATION ROUTES ----------
app.post('/api/admin/invite-member', async (req, res) => {
  try {
    const { name, email, role } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const token = crypto.randomBytes(24).toString('hex');
    const roleToSet = role === 'admin' ? 'admin' : 'user';

    const invites = getLocalInvites();
    invites[token] = {
      token,
      email: cleanEmail,
      name: name || cleanEmail.split('@')[0],
      role: roleToSet,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    saveLocalInvites(invites);

    const reqOrigin = req.get('origin') || req.get('referer') || `${req.protocol}://${req.get('host')}`;
    const cleanOrigin = reqOrigin.replace(/\/$/, '');
    const verifyLink = `${cleanOrigin}/?inviteToken=${token}`;

    const roleTitle = roleToSet === 'admin' ? 'Admin Portal Access' : 'Member Access';

    const mailResult = await sendEmailNotification({
      to: cleanEmail,
      subject: `✉️ Complete FGTech ${roleTitle} Setup for ${name || cleanEmail}`,
      fromName: 'FGTech Admin',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #0f172a; font-size: 24px; font-weight: 900; margin: 0;">FGTECH</h2>
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Account Invitation & Verification</p>
          </div>
          
          <p style="color: #334155; font-size: 15px; line-height: 1.6;">Hello <strong>${name || cleanEmail}</strong>,</p>
          <p style="color: #334155; font-size: 15px; line-height: 1.6;">You have been invited by Admin to join FGTech with <strong>${roleTitle}</strong>.</p>
          <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-bottom: 28px;">Please click the button below to verify your email and set up your account password:</p>

          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${verifyLink}" target="_blank" style="background: #0047ff; color: #ffffff; padding: 14px 32px; border-radius: 12px; font-weight: 800; font-size: 16px; text-decoration: none; display: inline-block; box-shadow: 0 4px 14px rgba(0,71,255,0.35);">
              Verify & Set Password →
            </a>
          </div>

          <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; text-align: center;">Or copy & paste this link into your browser:<br/><a href="${verifyLink}" style="color: #2563eb;">${verifyLink}</a></p>
        </div>
      `
    });

    res.json({
      success: true,
      emailSent: mailResult.success,
      message: mailResult.success
        ? `Invitation email sent successfully to ${cleanEmail}!`
        : `Invitation created for ${cleanEmail}! Verification link ready below.`,
      verifyLink,
      error: mailResult.error || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/invite/:token', (req, res) => {
  try {
    const { token } = req.params;
    const invites = getLocalInvites();
    const inv = invites[token];

    if (!inv) {
      return res.status(404).json({ error: 'Invalid or expired invitation link' });
    }

    if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
      return res.status(410).json({ error: 'Invitation link has expired. Please ask Admin to resend.' });
    }

    res.json({ success: true, invite: inv });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/complete-invite', (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const invites = getLocalInvites();
    const inv = invites[token];

    if (!inv) {
      return res.status(404).json({ error: 'Invalid or expired invitation link' });
    }

    const cleanEmail = inv.email.toLowerCase().trim();
    const userId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const users = getLocalUsers();
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    const newUser = {
      id: userId,
      name: inv.name || cleanEmail.split('@')[0],
      email: cleanEmail,
      role: inv.role || 'user',
      picture: DEFAULT_USER_AVATAR,
      passwordHash,
      verified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    users[userId] = newUser;
    saveLocalUsers(users);

    delete invites[token];
    saveLocalInvites(invites);

    const safeUser = { ...newUser };
    delete safeUser.passwordHash;

    console.log(`🎉 Account verified & activated for ${cleanEmail} (Role: ${safeUser.role})`);
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- STATS & METRICS ----------
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    let userExpenses = [];

    if (useFirebase) {
      const snapshot = await db.collection('expenses').where('userId', '==', userId).get();
      snapshot.forEach(doc => userExpenses.push(doc.data()));
    } else {
      userExpenses = getLocalExpenses().filter(e => e.userId === userId);
    }

    const totalExpense = userExpenses.reduce((sum, e) => sum + (e.total || 0), 0);
    const totalReceipts = userExpenses.reduce((sum, e) => sum + ((e.receipts && e.receipts.length) || 0), 0);
    
    // Calculate breakdown by entry type
    const breakdown = { Metro: 0, Local: 0, 'Auto/Rapido': 0, Others: 0 };
    userExpenses.forEach(exp => {
      (exp.entries || []).forEach(entry => {
        const type = entry.type || 'Others';
        breakdown[type] = (breakdown[type] || 0) + (entry.amount || 0);
      });
    });

    res.json({
      success: true,
      stats: {
        totalExpense,
        totalExpensesCount: userExpenses.length,
        totalReceipts,
        breakdown
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- WHATSAPP BOT ENDPOINTS ----------
const { startWhatsAppBot, disconnectWhatsAppBot, getWhatsAppStatus, parseExpenseMessage, requestWhatsAppPairingCode, sendWhatsAppOTP, verifyWhatsAppOTP } = require('./whatsapp-bot');

app.get('/api/whatsapp/status', (req, res) => {
  res.json(getWhatsAppStatus());
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    const result = await disconnectWhatsAppBot();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/parse', (req, res) => {
  const { text } = req.body;
  const parsed = parseExpenseMessage(text || '');
  res.json({ success: true, parsed });
});

app.post('/api/whatsapp/pairing-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Mobile phone number with country code is required (e.g. 919876543210)' });
    const code = await requestWhatsAppPairingCode(phone);
    res.json({ success: true, code });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Send OTP via WhatsApp to verify user's phone number
app.post('/api/whatsapp/send-otp', async (req, res) => {
  try {
    const { phone, userId } = req.body;
    if (!phone || !userId) return res.status(400).json({ error: 'phone and userId are required' });
    const result = await sendWhatsAppOTP(phone, userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Verify OTP and link phone number to user account
app.post('/api/whatsapp/verify-otp', async (req, res) => {
  try {
    const { phone, otp, userId } = req.body;
    if (!phone || !otp || !userId) return res.status(400).json({ error: 'phone, otp and userId are required' });

    const result = verifyWhatsAppOTP(phone, otp);
    if (!result.success) return res.status(400).json({ error: result.error });

    // Link phone to user in DB
    const users = getLocalUsers();
    const user = users[userId] || {};
    const cleanPhone = result.phone;
    user.phone = cleanPhone;
    user.whatsapp = cleanPhone;
    user.whatsappVerified = true;
    user.updatedAt = new Date().toISOString();
    users[userId] = user;
    saveLocalUsers(users);

    if (useFirebase) {
      try {
        await db.collection('users').doc(userId).set({ phone: cleanPhone, whatsapp: cleanPhone, whatsappVerified: true, updatedAt: user.updatedAt }, { merge: true });
      } catch (fbErr) {
        console.warn('Firebase phone sync note:', fbErr.message);
      }
    }

    console.log(`✅ WhatsApp number +${cleanPhone} verified and linked to user ${userId}`);
    res.json({ success: true, phone: cleanPhone, message: `✅ Number +${cleanPhone} verified and linked to your account!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== META OFFICIAL WHATSAPP CLOUD API WEBHOOKS ====================
const { handleMetaWhatsAppMessage } = require('./whatsapp-bot');
const META_VERIFY_TOKEN = process.env.META_WA_VERIFY_TOKEN || 'fgtech_travel_secret_2026';
const META_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID || '';
const META_ACCESS_TOKEN = process.env.META_WA_ACCESS_TOKEN || '';

// Webhook Verification (Challenge from Meta)
app.get('/api/meta-whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('✅ Meta WhatsApp Webhook Verified successfully!');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook Event Receiver (Incoming Messages from Meta)
app.post('/api/meta-whatsapp/webhook', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      body.entry?.forEach(entry => {
        entry.changes?.forEach(change => {
          const value = change.value;
          if (value && value.messages) {
            value.messages.forEach(async (msg) => {
              await handleMetaWhatsAppMessage(msg, value.contacts, {
                phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID || META_PHONE_NUMBER_ID,
                accessToken: process.env.META_WA_ACCESS_TOKEN || META_ACCESS_TOKEN,
                saveExpenseToDb: (exp) => {
                  if (useFirebase && db) db.collection('expenses').doc(exp.id).set(exp);
                  const exps = getLocalExpenses();
                  exps.unshift(exp);
                  saveLocalExpenses(exps);
                },
                getUsers: getLocalUsers,
                getExpenses: getLocalExpenses,
                saveExpenses: saveLocalExpenses
              });
            });
          }
        });
      });
    }
  } catch (err) {
    console.error('Error in Meta WhatsApp Webhook:', err.message);
  }
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Mode: ${useFirebase ? 'Firebase Firestore + Storage' : 'Local File Storage'}`);
  console.log(`🌐 Web Client: http://localhost:${PORT}`);
  console.log(`====================================================`);

  // Helper to persist WhatsApp expenses to Firestore & Local DB
  const saveExpenseToDb = async (newExpense) => {
    try {
      const expenses = getLocalExpenses();
      if (expenses.some(e => e.id === newExpense.id)) {
        return; // Already processed/saved
      }
      expenses.unshift(newExpense);
      saveLocalExpenses(expenses, true);

      if (useFirebase) {
        await db.collection('expenses').doc(newExpense.id).set({
          ...newExpense,
          date: newExpense.date,
          createdAt: newExpense.createdAt
        });
      }
    } catch (err) {
      console.warn('⚠️ Error writing WhatsApp expense to Firestore/DB:', err.message);
    }
  };

  // Launch WhatsApp Bot Engine
  startWhatsAppBot({
    getLocalExpenses,
    saveLocalExpenses,
    getLocalUsers,
    uploadToCloudinary,
    saveExpenseToDb,
    db: useFirebase ? db : null  // Pass Firebase db for cloud auth persistence
  });
});
