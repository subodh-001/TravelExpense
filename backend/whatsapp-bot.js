const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

let waSock = null;
let qrCodeDataUrl = null;
let isConnected = false;
let connectedUserJid = null;

// User Context Store for 3-minute sequential message combining (Text <-> Photo)
const userContextStore = new Map(); // userId -> { pendingReceiptUrl, lastExpenseObj, timestamp }

async function downloadWhatsAppImageBuffer(msg) {
  try {
    const imgMsg = msg.message?.imageMessage ||
                   msg.message?.ephemeralMessage?.message?.imageMessage ||
                   msg.message?.viewOnceMessage?.message?.imageMessage ||
                   msg.message?.viewOnceMessageV2?.message?.imageMessage;
    if (!imgMsg) return null;

    const stream = await downloadContentFromMessage(imgMsg, 'image');
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    console.log(`📸 WhatsApp image downloaded: ${buffer.length} bytes`);
    return buffer;
  } catch (err) {
    console.warn('⚠️ WhatsApp image download warning:', err.message);
    return null;
  }
}

// Helpers & Store References passed from server.js
let getExpensesFn = null;
let saveExpensesFn = null;
let getUsersFn = null;
let uploadCloudinaryFn = null;
let saveExpenseToDbFn = null;
let dbFn = null; // Firebase Firestore db reference for cloud auth persistence

const AUTH_DIR = path.join(__dirname, 'data', 'baileys_auth_info');
const DASHBOARD_URL = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

// ========== Firebase Auth Persistence for Cloud Deployments ==========
async function backupAuthToFirebase(db) {
  if (!db) return;
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const files = fs.readdirSync(AUTH_DIR).filter(f => f.endsWith('.json'));
    const authData = {};
    for (const file of files) {
      try { authData[file] = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, file), 'utf8')); } catch (_) {}
    }
    if (Object.keys(authData).length === 0) return;
    await db.collection('_system').doc('whatsapp_auth').set({
      files: JSON.stringify(authData),
      updatedAt: new Date().toISOString()
    });
    console.log('\u2601\ufe0f WhatsApp auth backed up to Firebase (' + Object.keys(authData).length + ' files)');
  } catch (err) {
    console.warn('\u26a0\ufe0f Auth backup to Firebase warning:', err.message);
  }
}

async function restoreAuthFromFirebase(db) {
  if (!db) return false;
  try {
    const doc = await db.collection('_system').doc('whatsapp_auth').get();
    if (!doc.exists || !doc.data().files) {
      console.log('\u2139\ufe0f No WhatsApp auth backup found in Firebase.');
      return false;
    }
    const authData = JSON.parse(doc.data().files);
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    for (const [file, content] of Object.entries(authData)) {
      fs.writeFileSync(path.join(AUTH_DIR, file), JSON.stringify(content));
    }
    console.log('\u2705 WhatsApp auth restored from Firebase (' + Object.keys(authData).length + ' files)');
    return true;
  } catch (err) {
    console.warn('\u26a0\ufe0f Auth restore from Firebase warning:', err.message);
    return false;
  }
}

// Category mapping helper
const CATEGORY_MAP = [
  { category: 'Metro', keywords: ['metro', 'subway', 'underground'] },
  { category: 'Local', keywords: ['local', 'train', 'local train', 'railway', 'station'] },
  { category: 'Auto/Rapido', keywords: ['auto', 'rapido', 'rickshaw', 'autorickshaw'] },
  { category: 'Ola/Uber', keywords: ['ola', 'uber', 'cab', 'taxi', 'indrive', 'blusmart'] },
  { category: 'Porter', keywords: ['porter', 'coolie', 'luggage'] },
  { category: 'Courier', keywords: ['courier', 'parcel', 'speedpost', 'post'] },
  { category: 'Food', keywords: ['food', 'lunch', 'dinner', 'breakfast', 'snacks', 'chai', 'tea', 'coffee', 'hotel'] },
  { category: 'Others', keywords: ['other', 'others', 'misc', 'toll', 'parking', 'ticket'] }
];

function parseExpenseMessage(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();
  if (!clean) return null;

  // Check for commands first
  const lower = clean.toLowerCase();
  if (['help', 'menu', 'start', 'hi', 'hello', 'hey', 'hii', 'hie', 'helo', 'namaste', 'wup'].includes(lower)) return { isCommand: true, command: 'help' };
  if (['summary', 'total', 'balance', 'stats'].includes(lower)) return { isCommand: true, command: 'summary' };
  if (['history', 'recent', 'list', 'entries'].includes(lower)) return { isCommand: true, command: 'history' };
  if (lower.startsWith('link ')) return { isCommand: true, command: 'link', arg: clean.substring(5).trim() };

  // Regex to extract amount (e.g. 150, rs 150, ₹150, 150rs, 150.50)
  const amountMatch = clean.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d{1,2})?)\s*(?:rs\.?|rupees)?/i);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1]);
  if (isNaN(amount) || amount <= 0) return null;

  // Determine category
  let matchedCategory = 'Others';
  for (const item of CATEGORY_MAP) {
    for (const kw of item.keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(clean)) {
        matchedCategory = item.category;
        break;
      }
    }
    if (matchedCategory !== 'Others') break;
  }

  // Extract comment/notes (remove amount and category keyword from raw text)
  let comment = clean;
  comment = comment.replace(amountMatch[0], ' ');
  for (const item of CATEGORY_MAP) {
    for (const kw of item.keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      comment = comment.replace(regex, ' ');
    }
  }
  comment = comment.replace(/\s+/g, ' ').replace(/^[-:,.\s]+|[-:,.\s]+$/g, '').trim();
  if (!comment) comment = matchedCategory;

  return {
    isCommand: false,
    category: matchedCategory,
    amount,
    comment,
    rawText: clean
  };
}

const processedMsgIds = new Set();

async function handleWhatsAppMessage(msg) {
  try {
    if (!msg.message) return;

    // Message-level deduplication check
    const msgId = msg.key.id;
    if (msgId) {
      if (processedMsgIds.has(msgId)) return;
      processedMsgIds.add(msgId);
      if (processedMsgIds.size > 500) {
        const first = processedMsgIds.values().next().value;
        processedMsgIds.delete(first);
      }
    }

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.endsWith('@g.us')) return; // Ignore group chats for private expense logging

    // Extract text content or caption
    let textContent = '';
    const isImage = !!msg.message.imageMessage;
    
    if (msg.message.conversation) {
      textContent = msg.message.conversation;
    } else if (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) {
      textContent = msg.message.extendedTextMessage.text;
    } else if (isImage && msg.message.imageMessage.caption) {
      textContent = msg.message.imageMessage.caption;
    }

    // Ignore bot's own outgoing auto-replies to prevent loops
    if (msg.key.fromMe && (textContent.startsWith('👋') || textContent.startsWith('🤖') || textContent.startsWith('✅') || textContent.startsWith('📊') || textContent.startsWith('📜') || textContent.startsWith('⚠️'))) {
      return;
    }

    const senderNumber = remoteJid.replace(/[^0-9]/g, '');

    // Match sender to system user by phone number (10-digit suffix matching for +91 / local formats)
    const usersObj = getUsersFn ? getUsersFn() : {};
    let matchedUser = Object.values(usersObj).find(u => {
      if (!u) return false;
      const uPhone = (u.phone || u.whatsapp || u.mobile || '').replace(/[^0-9]/g, '');
      if (!uPhone) return false;
      return uPhone === senderNumber || 
             uPhone.slice(-10) === senderNumber.slice(-10);
    });

    // Fallback: master user subodhram3350@gmail.com
    if (!matchedUser) {
      matchedUser = Object.values(usersObj).find(u => u && u.email && u.email.toLowerCase() === 'subodhram3350@gmail.com') || {
        id: `google_subodhram3350_gmail_com`,
        name: 'Subodh Ram',
        email: 'subodhram3350@gmail.com'
      };
    }

    const userId = matchedUser.id || `google_${matchedUser.email.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Handle receipt image download if photo attached
    let receiptUrl = null;
    if (isImage) {
      try {
        const buffer = await downloadWhatsAppImageBuffer(msg);
        if (buffer && buffer.length > 0) {
          if (uploadCloudinaryFn) {
            try {
              receiptUrl = await uploadCloudinaryFn(buffer, 'image/jpeg', 'whatsapp_receipts');
              console.log(`☁️ WhatsApp receipt uploaded to Cloudinary: ${receiptUrl}`);
            } catch (cloudErr) {
              console.warn('⚠️ Cloudinary upload failed, saving locally:', cloudErr.message);
            }
          }
          // Fallback: encode as base64 data URL (works on Render, no filesystem needed)
          if (!receiptUrl) {
            try {
              receiptUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
              console.log(`📦 WhatsApp receipt saved as base64 data URL (${Math.round(buffer.length / 1024)}KB)`);
            } catch (b64Err) {
              console.warn('⚠️ Base64 encoding failed:', b64Err.message);
            }
          }
        }
      } catch (imgErr) {
        console.warn('⚠️ WhatsApp image handling warning:', imgErr.message);
      }
    }

    const textOnly = textContent && textContent.trim();
    const parsed = parseExpenseMessage(textOnly);
    const now = Date.now();
    const userContext = userContextStore.get(userId);

    // CASE 1: Photo sent WITHOUT expense text (e.g. user just sends receipt photo)
    if (isImage && receiptUrl) {
      if (!parsed) {
        // Sub-case 1A: User logged a text expense entry in the last 3 minutes
        if (userContext && userContext.lastExpenseObj && (now - userContext.timestamp < 180000)) {
          const targetExp = userContext.lastExpenseObj;
          if (!targetExp.receipts) targetExp.receipts = [];
          targetExp.receipts.push(receiptUrl);

          // Use update-specific fn if available, else direct save
          if (saveExpenseToDbFn) {
            const expenses = getExpensesFn ? getExpensesFn() : [];
            const idx = expenses.findIndex(e => e.id === targetExp.id);
            if (idx !== -1) {
              expenses[idx] = targetExp;
              if (saveExpensesFn) saveExpensesFn(expenses, true);
            } else {
              saveExpenseToDbFn(targetExp);
            }
          }

          userContextStore.delete(userId);

          const attachText = 
`📎 *Receipt Photo Attached to Recent Entry!*

📅 *Date:* ${targetExp.date}
📌 *Category:* ${targetExp.location}
💰 *Amount:* ₹${targetExp.total.toLocaleString('en-IN')}
📝 *Notes:* ${targetExp.notes}`;

          await waSock.sendMessage(remoteJid, { text: attachText });
          return;
        } else {
          // Sub-case 1B: Store pending photo for next text message
          userContextStore.set(userId, { pendingReceiptUrl: receiptUrl, timestamp: now });

          const promptText = 
`📸 *Receipt Photo Received!*

💬 Ab travel details bhejein (e.g. *Metro 40 Andheri to Saki Naka*) to log this entry with the receipt.`;

          await waSock.sendMessage(remoteJid, { text: promptText });
          return;
        }
      }
    } else if (isImage && !receiptUrl) {
      console.warn('⚠️ Image received from WhatsApp but could not be saved.');
    }

    // Handle commands
    if (parsed && parsed.isCommand) {
      if (parsed.command === 'help') {
        const replyMenu = 
`👋 *Welcome to FGTech Travel Expense Bot!* ✈️

Main aapka automated travel expense assistant hu. System me travel entry log karne ke liye seedhe mujhe message bhej sakte hain!

📝 *Kaise Log Karein:*
• Send: \`Metro 150\`
• Send: \`Uber 280 Andheri to BKC\`
• Send: \`Food 120 Lunch at station\`
• Ticket / Bill ki *Photo* caption me \`Local 40\` likh kar bhejein

📊 *Other Commands:*
• \`summary\` - Monthly balance & total check karein
• \`history\` - Recent 5 entries dekhein
• \`link <email>\` - Apna WhatsApp number email account se link karein

Try karein! Abhi type karein: *Metro 150* 🚀`;
        await waSock.sendMessage(remoteJid, { text: replyMenu });
        return;
      }

      if (parsed.command === 'summary') {
        const allExpenses = getExpensesFn ? getExpensesFn() : [];
        const userExpenses = allExpenses.filter(e => e && e.userId === userId);

        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const monthExpenses = userExpenses.filter(e => e.date && e.date.startsWith(currentMonth));

        const totalLogged = monthExpenses.reduce((s, e) => s + (e.total || 0), 0);
        const paidTotal = monthExpenses.filter(e => e.paymentStatus === 'paid').reduce((s, e) => s + (e.total || 0), 0);
        const pendingTotal = monthExpenses.filter(e => e.paymentStatus !== 'paid').reduce((s, e) => s + (e.total || 0), 0);

        const replySummary = 
`📊 *Monthly Travel Summary (${currentMonth})*
👤 User: *${matchedUser.name || 'User'}*

💰 *Total Logged:* ₹${totalLogged.toLocaleString('en-IN')}
✅ *Paid/Settled:* ₹${paidTotal.toLocaleString('en-IN')}
⏳ *Pending Balance:* ₹${pendingTotal.toLocaleString('en-IN')}
🧾 *Total Entries:* ${monthExpenses.length} entries`;

        await waSock.sendMessage(remoteJid, { text: replySummary });
        return;
      }

      if (parsed.command === 'history') {
        const allExpenses = getExpensesFn ? getExpensesFn() : [];
        const userExpenses = allExpenses.filter(e => e && e.userId === userId).slice(0, 5);

        if (userExpenses.length === 0) {
          await waSock.sendMessage(remoteJid, { text: '📂 No travel entries logged yet.' });
          return;
        }

        let historyText = `📜 *Your Recent 5 Travel Entries:*\n\n`;
        userExpenses.forEach((exp, idx) => {
          const cat = exp.entries && exp.entries[0] ? exp.entries[0].type : exp.location;
          const status = exp.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Pending';
          historyText += `${idx + 1}. *${exp.date}* — ${cat}\n   💰 ₹${exp.total} (${status})\n   📝 ${exp.notes || 'No comment'}\n\n`;
        });

        await waSock.sendMessage(remoteJid, { text: historyText.trim() });
        return;
      }

      if (parsed.command === 'link') {
        const targetEmail = parsed.arg.toLowerCase();
        if (!targetEmail.includes('@')) {
          await waSock.sendMessage(remoteJid, { text: '⚠️ Please provide a valid email address. Example: `link user@example.com`' });
          return;
        }

        const users = getUsersFn ? getUsersFn() : {};
        let foundKey = Object.keys(users).find(k => users[k] && users[k].email && users[k].email.toLowerCase() === targetEmail);

        if (foundKey && saveExpensesFn) {
          users[foundKey].phone = senderNumber;
          users[foundKey].whatsapp = senderNumber;
          users[foundKey].updatedAt = new Date().toISOString();
          saveExpensesFn([], false); // triggers backup
          await waSock.sendMessage(remoteJid, { text: `✅ Success! WhatsApp number *+${senderNumber}* linked to account *${targetEmail}*.` });
        } else {
          await waSock.sendMessage(remoteJid, { text: `⚠️ User account *${targetEmail}* not found in system.` });
        }
        return;
      }
    }

    // CASE 2: Process valid expense entry (Text or Photo with caption)
    if (parsed && !parsed.isCommand) {
      const todayDate = new Date().toISOString().slice(0, 10);
      const expenseId = `exp_wa_${Date.now().toString(36)}`;

      // Check if user uploaded a photo in the last 3 minutes
      let finalReceipts = receiptUrl ? [receiptUrl] : [];
      if (!receiptUrl && userContext && userContext.pendingReceiptUrl && (now - userContext.timestamp < 180000)) {
        finalReceipts.push(userContext.pendingReceiptUrl);
        userContextStore.delete(userId);
      }

      const newExpense = {
        id: expenseId,
        userId: userId,
        date: todayDate,
        location: parsed.category,
        notes: parsed.comment || parsed.category,
        paymentStatus: 'pending',
        entries: [{ type: parsed.category, amount: parsed.amount }],
        total: parsed.amount,
        receipts: finalReceipts,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (saveExpenseToDbFn) {
        saveExpenseToDbFn(newExpense);
      } else if (getExpensesFn && saveExpensesFn) {
        const expenses = getExpensesFn();
        expenses.unshift(newExpense);
        saveExpensesFn(expenses, true);
      }

      // Save to context for potential follow-up photo in the next 3 minutes
      userContextStore.set(userId, { lastExpenseObj: newExpense, timestamp: now });

      const categoryEmoji = {
        'Metro': '🚇', 'Local': '🚆', 'Auto/Rapido': '🛺',
        'Ola/Uber': '🚗', 'Porter': '📦', 'Courier': '✉️',
        'Food': '🍱', 'Others': '📌'
      }[parsed.category] || '📌';

      const photoTag = finalReceipts.length > 0 ? '\n📎 *Receipt Photo Attached!*' : '';

      const confirmText = 
`✅ *Travel Expense Logged Successfully!*

📅 *Date:* ${todayDate}
${categoryEmoji} *Category:* ${parsed.category}
💰 *Amount:* ₹${parsed.amount.toLocaleString('en-IN')}
📝 *Notes:* ${parsed.comment}${photoTag}

🌐 *View on Dashboard:* ${DASHBOARD_URL}`;

      await waSock.sendMessage(remoteJid, { text: confirmText });
      return;
    }

    // Default response for unparsed text
    await waSock.sendMessage(remoteJid, {
      text: `🤖 Hi! Send an expense like \`Metro 150\` or \`Uber 250 Andheri\` to log it, or type \`help\` for options.`
    });

  } catch (err) {
    console.error('Error handling WhatsApp message:', err);
  }
}

async function startWhatsAppBot(callbacks = {}) {
  getExpensesFn = callbacks.getLocalExpenses;
  saveExpensesFn = callbacks.saveLocalExpenses;
  getUsersFn = callbacks.getLocalUsers;
  uploadCloudinaryFn = callbacks.uploadToCloudinary;
  saveExpenseToDbFn = callbacks.saveExpenseToDb;
  dbFn = callbacks.db || null;

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    // On cloud (Render), restore auth from Firebase before starting
    await restoreAuthFromFirebase(dbFn);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    waSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['FGTech Travel Engine', 'Chrome', '1.0.0']
    });

    // Save credentials locally AND backup to Firebase for cloud persistence
    waSock.ev.on('creds.update', async () => {
      await saveCreds();
      await backupAuthToFirebase(dbFn);
    });

    waSock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        QRCode.toDataURL(qr, (err, url) => {
          if (!err && url) qrCodeDataUrl = url;
        });
        isConnected = false;
        console.log('\n====================================================');
        console.log('📲 WHATSAPP BOT PAIRING QR CODE:');
        qrcode.generate(qr, { small: true });
        console.log('====================================================\n');
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`⚠️ WhatsApp Bot connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(() => startWhatsAppBot(callbacks), 5000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        qrCodeDataUrl = null;
        const rawJid = waSock.user?.id || waSock.user?.jid || '';
        connectedUserJid = rawJid.split('@')[0].split(':')[0];
        console.log('🤖 WhatsApp Travel Expense Bot CONNECTED & ONLINE! (Phone: +' + connectedUserJid + ')');
      }
    });

    waSock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          await handleWhatsAppMessage(msg);
        }
      }
    });

  } catch (err) {
    console.warn('⚠️ WhatsApp Bot init warning:', err.message);
  }
}

async function requestWhatsAppPairingCode(phone) {
  if (!waSock) throw new Error('WhatsApp Bot engine is initializing. Please try again in a few seconds.');
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error('Please enter a valid phone number with country code (e.g. 919876543210)');
  }
  const code = await waSock.requestPairingCode(cleanPhone);
  return code;
}

// OTP store: { phone -> { otp, userId, expiresAt } }
const otpStore = new Map();

async function sendWhatsAppOTP(phone, userId) {
  if (!waSock || !isConnected) throw new Error('WhatsApp Bot is not connected yet. Please try again in a few seconds.');

  let cleanPhone = phone.replace(/[^0-9]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error('Please enter a valid WhatsApp number (e.g. 919876543210 or 9876543210)');
  }

  // Auto-add India country code if only 10 digits entered
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  // Store with the full number (with country code) as key
  otpStore.set(cleanPhone, { otp, userId, expiresAt });
  console.log(`📲 OTP generated for +${cleanPhone}: ${otp} (userId: ${userId})`);

  const jid = `${cleanPhone}@s.whatsapp.net`;
  const msgText =
`🔐 *FGTech Travel Expense — Verification Code*

Your OTP to link your WhatsApp number is:

*${otp}*

⏰ This code expires in *5 minutes*.
Do NOT share this code with anyone.

Once verified, all expenses you send to this bot will be auto-logged under your account!`;

  try {
    await waSock.sendMessage(jid, { text: msgText });
    console.log(`✅ OTP WhatsApp message sent to ${jid}`);
  } catch (sendErr) {
    console.error(`❌ Failed to send OTP WhatsApp message to ${jid}:`, sendErr.message);
    throw new Error(`Could not send OTP to +${cleanPhone}. Make sure the number is on WhatsApp.`);
  }

  return { success: true, phone: cleanPhone, message: `OTP sent to +${cleanPhone} on WhatsApp!` };
}

function verifyWhatsAppOTP(phone, otp) {
  let cleanPhone = phone.replace(/[^0-9]/g, '');
  // Auto-add country code if 10 digits (same normalization as send)
  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

  const stored = otpStore.get(cleanPhone);
  console.log(`🔍 Verifying OTP for +${cleanPhone}, stored:`, stored ? `${stored.otp} (expires in ${Math.round((stored.expiresAt - Date.now()) / 1000)}s)` : 'NOT FOUND');

  if (!stored) {
    return { success: false, error: 'No OTP found for this number. Please request a new one.' };
  }
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(cleanPhone);
    return { success: false, error: 'OTP expired. Please request a new one.' };
  }
  if (stored.otp !== otp.trim()) {
    return { success: false, error: 'Incorrect OTP. Please try again.' };
  }

  otpStore.delete(cleanPhone);
  return { success: true, userId: stored.userId, phone: cleanPhone };
}

function getWhatsAppStatus() {
  return {
    connected: isConnected,
    qr: qrCodeDataUrl,
    userJid: connectedUserJid,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  startWhatsAppBot,
  getWhatsAppStatus,
  parseExpenseMessage,
  requestWhatsAppPairingCode,
  sendWhatsAppOTP,
  verifyWhatsAppOTP
};
