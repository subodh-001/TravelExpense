const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
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

// Helpers & Store References passed from server.js
let getExpensesFn = null;
let saveExpensesFn = null;
let getUsersFn = null;
let uploadCloudinaryFn = null;
let saveExpenseToDbFn = null;

const AUTH_DIR = path.join(__dirname, 'data', 'baileys_auth_info');

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
  if (['help', 'menu', 'start', 'hi', 'hello'].includes(lower)) return { isCommand: true, command: 'help' };
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

async function handleWhatsAppMessage(msg) {
  try {
    if (!msg.message || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.endsWith('@g.us')) return; // Ignore group chats for private expense logging

    const senderNumber = remoteJid.replace(/[^0-9]/g, '');

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

    // Match sender to system user by phone number or default to super_admin/master user
    const usersObj = getUsersFn ? getUsersFn() : {};
    let matchedUser = Object.values(usersObj).find(u => {
      if (!u) return false;
      const uPhone = (u.phone || u.whatsapp || '').replace(/[^0-9]/g, '');
      return uPhone && uPhone === senderNumber;
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

    // Handle receipt image upload if photo attached
    let receiptUrl = null;
    if (isImage && uploadCloudinaryFn) {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        if (buffer) {
          receiptUrl = await uploadCloudinaryFn(buffer, 'image/jpeg', 'whatsapp_receipts');
        }
      } catch (imgErr) {
        console.warn('⚠️ WhatsApp image download warning:', imgErr.message);
      }
    }

    const parsed = parseExpenseMessage(textContent || (isImage ? 'Metro 50' : ''));

    // Handle commands
    if (parsed && parsed.isCommand) {
      if (parsed.command === 'help') {
        const replyMenu = 
`🤖 *FGTech Travel Expense Bot* ✈️

*How to Log Travel Expenses:*
• Type: \`Metro 150\`
• Type: \`Uber 280 Andheri to BKC\`
• Type: \`Food 120 Lunch at station\`
• Send a *Photo of Receipt* with caption \`Local 40\`

*Commands:*
• \`summary\` - View monthly total & pending balance
• \`history\` - View 5 recent travel logs
• \`link <email>\` - Pair your WhatsApp number to account`;
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

    // Process valid expense entry
    if (parsed && !parsed.isCommand) {
      const todayDate = new Date().toISOString().slice(0, 10);
      const expenseId = `exp_wa_${Date.now().toString(36)}`;

      const newExpense = {
        id: expenseId,
        userId: userId,
        date: todayDate,
        location: parsed.category,
        notes: parsed.comment || parsed.category,
        paymentStatus: 'pending',
        entries: [{ type: parsed.category, amount: parsed.amount }],
        total: parsed.amount,
        receipts: receiptUrl ? [receiptUrl] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (getExpensesFn && saveExpensesFn) {
        const expenses = getExpensesFn();
        expenses.unshift(newExpense);
        saveExpensesFn(expenses, true);
      }

      const categoryEmoji = {
        'Metro': '🚇', 'Local': '🚆', 'Auto/Rapido': '🛺',
        'Ola/Uber': '🚗', 'Porter': '📦', 'Courier': '✉️',
        'Food': '🍱', 'Others': '📌'
      }[parsed.category] || '📌';

      const photoTag = receiptUrl ? '\n📎 *Receipt Photo Attached!*' : '';

      const confirmText = 
`✅ *Travel Expense Logged Successfully!*

📅 *Date:* ${todayDate}
${categoryEmoji} *Category:* ${parsed.category}
💰 *Amount:* ₹${parsed.amount.toLocaleString('en-IN')}
📝 *Notes:* ${parsed.comment}${photoTag}

🌐 *View on Dashboard:* http://localhost:3000`;

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

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    waSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['FGTech Travel Engine', 'Chrome', '1.0.0']
    });

    waSock.ev.on('creds.update', saveCreds);

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
        connectedUserJid = waSock.user?.id || waSock.user?.jid;
        console.log('🤖 WhatsApp Travel Expense Bot CONNECTED & ONLINE! (JID:', connectedUserJid + ')');
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
  parseExpenseMessage
};
