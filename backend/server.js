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

// ---------- USER PROFILE MANAGEMENT ----------
app.post('/api/user/profile', (req, res) => {
  try {
    const { id, name, email, picture } = req.body;
    if (!id) return res.status(400).json({ error: 'User ID is required' });

    const users = getLocalUsers();
    users[id] = {
      id,
      name: name || 'Subodh Kumar',
      email: email || 'subodh.travels@gmail.com',
      picture: picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name || 'Subodh')}`,
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
      name: userId.includes('subodh') ? 'Subodh Kumar' : 'Traveler',
      email: userId.includes('subodh') ? 'subodh.travels@gmail.com' : `${userId}@gmail.com`,
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
        userId = 'google_subodh';
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
      const userExpenses = all.filter(e => e.userId === userId || (!e.userId && userId === 'google_subodh'));
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
