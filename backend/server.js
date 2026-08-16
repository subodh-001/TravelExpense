const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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

// ==================== MIDDLEWARE ====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const authenticate = (req, res, next) => {
  const userId = req.headers['user-id'] || req.query.userId || 'user_123';
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
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass
    }
  });
  console.log(`📧 Gmail SMTP Configured for Real OTP Emails (${gmailUser})`);
} catch (smtpErr) {
  console.warn('⚠️ Gmail SMTP setup warning:', smtpErr.message);
}

const crypto = require('crypto');

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
      mailTransporter.sendMail({
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
      }).then(() => {
        console.log(`✉️ Real OTP Email successfully sent to ${email}`);
      }).catch((mailErr) => {
        console.error(`⚠️ Failed to send OTP email to ${email}:`, mailErr.message);
      });
    }

    res.json({
      success: true,
      message: `6-Digit OTP Verification Code sent to ${email}`,
      otp: otp
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
    const { id, name, email, picture } = req.body;
    if (!id) return res.status(400).json({ error: 'User ID is required' });

    const users = getLocalUsers();
    users[id] = {
      id,
      name: name || 'Traveler',
      email: email || 'user@example.com',
      picture: picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || 'Traveler')}`,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);

    console.log(`👤 Updated profile for ${id}: ${name}`);
    res.json({ success: true, user: users[id] });
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

// ---------- CREATE EXPENSE ----------
app.post('/api/expenses', authenticate, async (req, res) => {
  try {
    const { date, location, entries, paymentStatus } = req.body;
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
      entries: cleanEntries,
      total,
      paymentStatus: paymentStatus || 'pending', // 'pending' or 'paid'
      receipts: [],
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
    let userId = req.query.userId || req.query.share;
    
    if (!userId) {
      const authHeader = req.headers['authorization'];
      const customUserId = req.headers['user-id'];
      
      if (customUserId) {
        userId = customUserId;
      } else if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        if (useFirebase) {
          try {
            const decoded = await admin.auth().verifyIdToken(token);
            userId = decoded.uid;
          } catch (e) {
            userId = 'user_123';
          }
        } else {
          userId = token || 'user_123';
        }
      } else {
        userId = 'google_user';
      }
    }

    if (useFirebase) {
      const snapshot = await db.collection('expenses')
        .where('userId', '==', userId)
        .get();

      const expenses = [];
      snapshot.forEach(doc => {
        expenses.push({ id: doc.id, ...doc.data() });
      });

      // Sort by date desc
      expenses.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      return res.json({ success: true, expenses });
    } else {
      const all = getLocalExpenses();
      const userExpenses = all.filter(e => e.userId === userId || !e.userId);
      userExpenses.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

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
