const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ensure local directories exist for fallback storage
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'expenses.json');
const USERS_DB_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOCAL_DB_FILE)) fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify([]));
if (!fs.existsSync(USERS_DB_FILE)) fs.writeFileSync(USERS_DB_FILE, JSON.stringify({}));

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

if (fs.existsSync(serviceAccountPath) || process.env.FIREBASE_CONFIG) {
  try {
    const serviceAccount = fs.existsSync(serviceAccountPath) 
      ? require(serviceAccountPath) 
      : JSON.parse(process.env.FIREBASE_CONFIG);
      
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
    });

    db = admin.firestore();
    bucket = admin.storage().bucket();
    useFirebase = true;
    console.log('🔥 Connected to Firebase Firestore & Storage');
  } catch (err) {
    console.warn('⚠️ Firebase init failed, falling back to Local Storage mode:', err.message);
  }
} else {
  console.log('ℹ️ No Firebase service account found. Running in LOCAL STORAGE mode.');
}

// Local JSON helper functions
const getLocalExpenses = () => {
  try {
    const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
};

const saveLocalExpenses = (expenses) => {
  fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(expenses, null, 2));
};

const getLocalUsers = () => {
  try {
    const raw = fs.readFileSync(USERS_DB_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
};

const saveLocalUsers = (users) => {
  fs.writeFileSync(USERS_DB_FILE, JSON.stringify(users, null, 2));
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
      name: 'Subodh Ram (Master Admin)',
      email: masterEmail,
      passwordHash,
      role: 'super_admin',
      verified: true,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);
    console.log(`👑 Master Super Admin account initialized: ${masterEmail}`);
  } catch (err) {
    console.warn('Failed to seed master super admin:', err.message);
  }
};
seedMasterSuperAdmin();


// ==================== MIDDLEWARE ====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const authenticate = (req, res, next) => {
  let userId = req.headers['user-id'] || req.query.userId;
  if (!userId || userId === 'user_123' || userId === 'google_user') {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid user-id header' });
  }
  req.userId = userId;
  next();
};

// ==================== API ENDPOINTS ====================

// ---------- HEALTH CHECK ----------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    mode: useFirebase ? 'Firebase' : 'Local Storage',
    timestamp: new Date().toISOString()
  });
});

const nodemailer = require('nodemailer');

// Setup Gmail SMTP Transporter for OTP Emails
let mailTransporter = null;
const gmailUser = (process.env.GMAIL_USER || 'subodhram3350@gmail.com').trim();
const gmailPass = (process.env.GMAIL_APP_PASS || process.env.GMAIL_APP_PASSWORD || 'ozytospihwnjhmbk').replace(/\s+/g, '');

try {
  mailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailPass
    }
  });
  console.log(`📧 Gmail SMTP Configured for Real OTP Emails (${gmailUser})`);
} catch (smtpErr) {
  console.warn('⚠️ Gmail SMTP setup warning:', smtpErr.message);
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

    // Send Real Email via Nodemailer Gmail SMTP
    if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: `"TravelExpense Security" <${gmailUser}>`,
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
        console.log(`✉️ Real OTP Email successfully sent to ${email}`);
      } catch (mailErr) {
        console.error(`⚠️ Failed to send OTP email to ${email}:`, mailErr.message);
      }
    }

    res.json({
      success: true,
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

app.post('/api/user/profile', (req, res) => {
  try {
    const { id, name, email, picture, password } = req.body;
    if (!id) return res.status(400).json({ error: 'User ID is required' });

    const users = getLocalUsers();
    const existingUser = users[id] || {};
    let passwordHash = existingUser.passwordHash || '';

    if (password && password.length >= 6) {
      passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    }

    users[id] = {
      ...existingUser,
      id,
      name: name || 'Traveler',
      email: email || 'user@example.com',
      picture: picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || 'Traveler')}`,
      passwordHash,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);

    const safeUser = { ...users[id] };
    delete safeUser.passwordHash;

    console.log(`👤 Updated profile for ${id}: ${name} (Password updated: ${!!password})`);
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/profile/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const users = getLocalUsers();
    const user = users[userId] || {
      id: userId,
      name: 'Traveler',
      email: `${userId}@gmail.com`,
      picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(userId)}`
    };
    res.json({ success: true, user });
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

    if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: `"FreeG Wifi Admin Security" <${gmailUser}>`,
          to: cleanEmail,
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
      const userExpenses = allExpenses.filter(e => e.userId === user.id);
      
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
      const ext = path.extname(req.file.originalname) || '.png';
      const fileName = `bill_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(filePath, req.file.buffer);
      const protocol = req.protocol || 'http';
      const host = req.get('host') || 'localhost:3000';
      paymentBillUrl = `${protocol}://${host}/uploads/${fileName}`;
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
    if (users[userId]) {
      if (action === 'delete') {
        users[userId].paymentBillUrl = '';
      } else if (action === 'update' && paymentBillUrl) {
        users[userId].paymentBillUrl = paymentBillUrl;
      }
      users[userId].updatedAt = new Date().toISOString();
      saveLocalUsers(users);
    }

    saveLocalExpenses(allExpenses);
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
      const ext = path.extname(req.file.originalname) || '.png';
      const fileName = `bill_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(filePath, req.file.buffer);
      const protocol = req.protocol || 'http';
      const host = req.get('host') || 'localhost:3000';
      paymentBillUrl = `${protocol}://${host}/uploads/${fileName}`;
    }

    if (paymentBillUrl) {
      targetUser.paymentBillUrl = paymentBillUrl;
      targetUser.updatedAt = new Date().toISOString();
      saveLocalUsers(users);
    }

    let allExpenses = getLocalExpenses();
    let settledCount = 0;
    let settledTotal = 0;

    allExpenses = allExpenses.map(e => {
      const isTargetUser = (e.userId === userId);
      const isTargetMonth = (!month || month === 'all' || (e.date && e.date.startsWith(month)));

      if (isTargetUser && isTargetMonth) {
        if (e.paymentStatus !== 'paid') {
          settledCount++;
          settledTotal += (e.total || 0);
        }
        return {
          ...e,
          paymentStatus: 'paid',
          settledAt: new Date().toISOString(),
          paymentBillUrl: paymentBillUrl || e.paymentBillUrl || '',
          settlementNotes: notes || e.settlementNotes || 'Paid by Super Admin'
        };
      }
      return e;
    });

    saveLocalExpenses(allExpenses);

    // Send Reimbursement Confirmation Email to User via Nodemailer
    if (mailTransporter && targetUser.email) {
      try {
        const monthLabel = month && month !== 'all' ? month : 'current month';
        await mailTransporter.sendMail({
          from: `"FreeG Wifi Accounts" <${gmailUser}>`,
          to: targetUser.email,
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
        console.log(`📧 Reimbursement payment email sent to ${targetUser.email}`);
      } catch (mailErr) {
        console.warn('Reimbursement email failed:', mailErr.message);
      }
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
    if (action === 'delete_user') {
      delete users[userId];
      saveLocalUsers(users);
      let allExpenses = getLocalExpenses();
      allExpenses = allExpenses.filter(e => e.userId !== userId);
      saveLocalExpenses(allExpenses);
      return res.json({ success: true, message: 'Member deleted' });
    }

    // Reset payment status back to pending
    let allExpenses = getLocalExpenses();
    allExpenses = allExpenses.map(e => {
      if (e.userId === userId && (!month || month === 'all' || (e.date && e.date.startsWith(month)))) {
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

    res.json({ success: true, message: 'Settlement reset back to Pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/all-expenses', async (req, res) => {
  try {
    const allExpenses = getLocalExpenses();
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

    const expenseData = {
      userId,
      date,
      location,
      notes: notes || location,
      entries: cleanEntries,
      total,
      paymentStatus: paymentStatus || 'pending', // 'pending' or 'paid'
      receipts: receipts || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (useFirebase) {
      const docRef = await db.collection('expenses').add({
        ...expenseData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(201).json({
        success: true,
        expenseId: docRef.id,
        data: { id: docRef.id, ...expenseData }
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
    const { date, location, entries, paymentStatus } = req.body;
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

      await db.collection('expenses').doc(expenseId).update(updateData);
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

    if (useFirebase) {
      const snapshot = await db.collection('expenses')
        .where('userId', '==', userId)
        .get();

      const expenses = [];
      snapshot.forEach(doc => {
        expenses.push({ id: doc.id, ...doc.data() });
      });

      expenses.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      return res.json({ success: true, expenses });
    } else {
      const all = getLocalExpenses();
      // Strictly filter by userId - each user sees ONLY their own expenses
      let userExpenses = all.filter(e => e.userId === userId);
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
        // Local upload
        const userFolder = path.join(UPLOADS_DIR, userId, expenseId);
        if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });

        const localPath = path.join(userFolder, safeFileName);
        fs.writeFileSync(localPath, file.buffer);

        const protocol = req.protocol;
        const host = req.get('host');
        fileUrl = `${protocol}://${host}/uploads/${userId}/${expenseId}/${safeFileName}`;

        const receiptData = {
          fileName: safeFileName,
          originalName: file.originalname,
          fileUrl: fileUrl,
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
          message: 'Receipt uploaded to local storage!'
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

    if (useFirebase) {
      const docRef = db.collection('expenses').doc(expenseId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({ error: 'Expense not found' });
      }

      const data = doc.data();
      if (data.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Delete receipts
      for (const receipt of data.receipts || []) {
        try {
          const filePath = `receipts/${userId}/${expenseId}/${receipt.fileName}`;
          await bucket.file(filePath).delete();
        } catch (e) {
          console.warn('Receipt file delete warning:', e.message);
        }
      }

      await docRef.delete();
      return res.json({ success: true, message: 'Expense deleted!' });
    } else {
      const expenses = getLocalExpenses();
      const expIndex = expenses.findIndex(e => e.id === expenseId);

      if (expIndex === -1) {
        return res.status(404).json({ error: 'Expense not found' });
      }

      if (expenses[expIndex].userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const [removed] = expenses.splice(expIndex, 1);
      saveLocalExpenses(expenses);

      // Delete uploads folder if exists
      const userFolder = path.join(UPLOADS_DIR, userId, expenseId);
      if (fs.existsSync(userFolder)) {
        fs.rmSync(userFolder, { recursive: true, force: true });
      }

      return res.json({ success: true, message: 'Expense deleted!' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
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

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Mode: ${useFirebase ? 'Firebase Firestore + Storage' : 'Local File Storage'}`);
  console.log(`🌐 Web Client: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
