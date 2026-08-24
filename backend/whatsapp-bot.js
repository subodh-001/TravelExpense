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
    const allFiles = fs.readdirSync(AUTH_DIR).filter(f => f.endsWith('.json'));
    
    // Only back up essential auth files (creds, sessions, app-state, sender-keys, top 20 prekeys)
    // This keeps the backup size <50KB and prevents Firestore 1MB limit errors
    const essentialFiles = allFiles.filter(f => {
      if (f === 'creds.json') return true;
      if (f.startsWith('session-') || f.startsWith('sender-key-') || f.startsWith('app-state-') || f.startsWith('tctoken-')) return true;
      if (f.startsWith('pre-key-')) {
        const num = parseInt(f.replace('pre-key-', '').replace('.json', ''), 10);
        return !isNaN(num) && num <= 20;
      }
      return false;
    });

    const authData = {};
    for (const file of essentialFiles) {
      try { authData[file] = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, file), 'utf8')); } catch (_) {}
    }
    if (!authData['creds.json']) return;

    await db.collection('_system').doc('whatsapp_auth').set({
      files: JSON.stringify(authData),
      updatedAt: new Date().toISOString()
    });
    console.log(`☁️ WhatsApp essential auth backed up to Firebase (${Object.keys(authData).length} files)`);
  } catch (err) {
    console.warn('⚠️ Auth backup to Firebase warning:', err.message);
  }
}

async function restoreAuthFromFirebase(db) {
  if (!db) return false;
  try {
    const doc = await db.collection('_system').doc('whatsapp_auth').get();
    if (!doc.exists || !doc.data().files) {
      console.log('ℹ️ No WhatsApp auth backup found in Firebase.');
      return false;
    }
    const authData = JSON.parse(doc.data().files);
    if (!authData['creds.json']) return false;

    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    for (const [file, content] of Object.entries(authData)) {
      fs.writeFileSync(path.join(AUTH_DIR, file), JSON.stringify(content));
    }
    console.log(`✅ WhatsApp auth restored from Firebase (${Object.keys(authData).length} files)`);
    return true;
  } catch (err) {
    console.warn('⚠️ Auth restore from Firebase warning:', err.message);
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

function extractDateFromText(text) {
  const now = new Date();
  const currentYear = now.getFullYear();

  // 1. YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return { dateStr: `${y}-${m}-${d}`, matchStr: ymdMatch[0] };
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2}|\d{2})\b/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    let y = dmyMatch[3];
    if (y.length === 2) y = '20' + y;
    return { dateStr: `${y}-${m}-${d}`, matchStr: dmyMatch[0] };
  }

  // 3. DD/MM or DD-MM without year (assumes current year)
  const dmMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])\b/);
  if (dmMatch) {
    const d = dmMatch[1].padStart(2, '0');
    const m = dmMatch[2].padStart(2, '0');
    return { dateStr: `${currentYear}-${m}-${d}`, matchStr: dmMatch[0] };
  }

  // 4. DD Month (e.g. 20 Aug, 20 August, 15 Aug 2026)
  const monthNames = {
    jan: '01', january: '01', feb: '02', february: '02',
    mar: '03', march: '03', apr: '04', april: '04',
    may: '05', jun: '06', june: '06', jul: '07', july: '07',
    aug: '08', august: '08', sep: '09', sept: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12'
  };

  const monthRegex = /\b(0?[1-9]|[12]\d|3[01])\s*([a-zA-Z]{3,9})(?:\s*(20\d{2}))?\b/i;
  const monthMatch = text.match(monthRegex);
  if (monthMatch) {
    const monthKey = monthMatch[2].toLowerCase();
    if (monthNames[monthKey]) {
      const d = monthMatch[1].padStart(2, '0');
      const m = monthNames[monthKey];
      const y = monthMatch[3] || currentYear;
      return { dateStr: `${y}-${m}-${d}`, matchStr: monthMatch[0] };
    }
  }

  // 5. Keyword: yesterday / kal
  const kwMatch = text.match(/\b(yesterday|kal)\b/i);
  if (kwMatch) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    return { dateStr: `${y}-${m}-${d}`, matchStr: kwMatch[0] };
  }

  // Default: today
  const todayStr = now.toISOString().slice(0, 10);
  return { dateStr: todayStr, matchStr: null };
}

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

  // Extract custom date if specified
  const { dateStr, matchStr } = extractDateFromText(clean);

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

  // Extract comment/notes (remove amount, custom date, and category keyword from raw text)
  let comment = clean;
  comment = comment.replace(amountMatch[0], ' ');
  if (matchStr) {
    comment = comment.replace(matchStr, ' ');
  }
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
    dateStr,
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

    // Ignore any bot-generated template responses, confirmation messages, or system notifications immediately
    const textOnly = textContent && textContent.trim();
    if (!textOnly && !isImage) return;

    const isBotTemplate = textOnly.startsWith('✅') || 
                          textOnly.startsWith('🤖') || 
                          textOnly.startsWith('👋') || 
                          textOnly.startsWith('📊') || 
                          textOnly.startsWith('📜') || 
                          textOnly.startsWith('⚠️') || 
                          textOnly.startsWith('🔐') || 
                          textOnly.startsWith('📎') || 
                          textOnly.startsWith('📌') ||
                          textOnly.includes('Logged Successfully') || 
                          textOnly.includes('Receipt Photo Attached') || 
                          textOnly.includes('View on Dashboard') ||
                          textOnly.includes('Verification Code') ||
                          textOnly.includes('Your OTP');

    if (isBotTemplate) return;

    const parsed = parseExpenseMessage(textOnly);

    if (msg.key.fromMe) {
      if (!parsed && !isImage) return;
    }

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
      const expenseDate = parsed.dateStr || new Date().toISOString().slice(0, 10);
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
        date: expenseDate,
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

📅 *Date:* ${expenseDate}
${categoryEmoji} *Category:* ${parsed.category}
💰 *Amount:* ₹${parsed.amount.toLocaleString('en-IN')}
📝 *Notes:* ${parsed.comment}${photoTag}

🌐 *View on Dashboard:* ${DASHBOARD_URL}`;

      await waSock.sendMessage(remoteJid, { text: confirmText });
      return;
    }

    // Default auto-reply for incoming messages to the Bot number (lets senders know this is a bot and not Subodh personally)
    if (!msg.key.fromMe) {
      const botGreeting = 
`🤖 *FGTech Travel Expense Bot* ✈️

Main ek automated travel expense assistant hu. System me travel expense log karne ke liye aap mujhe message bhej sakte hain!

📝 *Kaise Log Karein:*
• \`Metro 150\`
• \`Uber 280 Andheri\`
• \`Food 120 Lunch\`
• Receipt ticket photo 📸

👤 *Note:* Subodh se personal baat karne ke liye unke personal WhatsApp number par message karein!`;

      await waSock.sendMessage(remoteJid, { text: botGreeting });
    }
  } catch (err) {
    console.error('Error handling WhatsApp message:', err);
  }
}

// ========== Meta WhatsApp Cloud API Integration ==========
async function sendMetaWhatsAppMessage(phoneNumberId, accessToken, toPhone, text) {
  if (!phoneNumberId || !accessToken) {
    console.warn('⚠️ Meta WhatsApp API keys missing (phoneNumberId or accessToken)');
    return false;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone,
        type: 'text',
        text: { body: text }
      })
    });
    const data = await res.json();
    return res.ok;
  } catch (err) {
    console.error('❌ Meta WhatsApp send error:', err.message);
    return false;
  }
}

// ========== CallMeBot Integration (100% Free Outbound Messages) ==========
async function sendCallMeBotMessage(toPhone, text, apiKey) {
  const key = apiKey || process.env.CALLMEBOT_API_KEY;
  if (!key) return false;
  try {
    const cleanPhone = toPhone.replace(/[^0-9]/g, '');
    const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(text)}&apikey=${key}`;
    const res = await fetch(url);
    return res.ok;
  } catch (err) {
    console.error('❌ CallMeBot send error:', err.message);
    return false;
  }
}

// ========== UltraMsg Integration (Free 100 msgs/day) ==========
async function sendUltraMsgMessage(toPhone, text, instanceId, token) {
  const instId = instanceId || process.env.ULTRAMSG_INSTANCE_ID;
  const tk = token || process.env.ULTRAMSG_TOKEN;
  if (!instId || !tk) return false;
  try {
    const cleanPhone = toPhone.replace(/[^0-9]/g, '');
    const res = await fetch(`https://api.ultramsg.com/${instId}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: tk,
        to: cleanPhone,
        body: text,
        priority: '1'
      })
    });
    return res.ok;
  } catch (err) {
    console.error('❌ UltraMsg send error:', err.message);
    return false;
  }
}

async function handleMetaWhatsAppMessage(msg, contacts, callbacks) {
  try {
    const fromPhone = msg.from; // e.g. "919076314255"
    if (!fromPhone) return;

    let textContent = '';
    let isImage = false;
    let receiptUrl = null;

    if (msg.type === 'text' && msg.text && msg.text.body) {
      textContent = msg.text.body;
    } else if (msg.type === 'image') {
      isImage = true;
      if (msg.image && msg.image.caption) textContent = msg.image.caption;
    }

    const textOnly = textContent && textContent.trim();
    if (!textOnly && !isImage) return;

    const parsed = parseExpenseMessage(textOnly);
    const usersObj = callbacks.getUsers ? callbacks.getUsers() : {};
    
    let matchedUser = Object.values(usersObj).find(u => {
      if (!u) return false;
      const uPhone = (u.phone || u.whatsapp || u.mobile || '').replace(/[^0-9]/g, '');
      if (!uPhone) return false;
      return uPhone === fromPhone || uPhone.slice(-10) === fromPhone.slice(-10);
    });

    if (!matchedUser) {
      matchedUser = Object.values(usersObj).find(u => u && u.email && u.email.toLowerCase() === 'subodhram3350@gmail.com') || {
        id: 'google_subodhram3350_gmail_com',
        name: 'Subodh Ram',
        email: 'subodhram3350@gmail.com'
      };
    }

    const userId = matchedUser.id || `google_${matchedUser.email.replace(/[^a-zA-Z0-9]/g, '_')}`;

    if (parsed && parsed.isCommand) {
      if (parsed.command === 'help') {
        const replyMenu = 
`👋 *Welcome to FGTech Travel Expense Bot!* ✈️

Main aapka automated travel expense assistant hu. System me travel entry log karne ke liye seedhe mujhe message bhej sakte hain!

📝 *Kaise Log Karein:*
• \`Metro 150\`
• \`Uber 280 Andheri to BKC\`
• \`Food 120 Lunch at station\`
• Ticket / Bill photo caption me \`Local 40\`

📊 *Commands:*
• \`summary\` - Monthly balance check karein
• \`history\` - Recent 5 entries dekhein

Try karein! Type: *Metro 150* 🚀`;
        await sendMetaWhatsAppMessage(callbacks.phoneNumberId, callbacks.accessToken, fromPhone, replyMenu);
        return;
      }
    }

    if (parsed && !parsed.isCommand) {
      const expenseDate = parsed.dateStr || new Date().toISOString().slice(0, 10);
      const expenseId = `exp_meta_${Date.now().toString(36)}`;

      const newExpense = {
        id: expenseId,
        userId: userId,
        date: expenseDate,
        location: parsed.category,
        notes: parsed.comment || parsed.category,
        paymentStatus: 'pending',
        entries: [{ type: parsed.category, amount: parsed.amount }],
        total: parsed.amount,
        receipts: receiptUrl ? [receiptUrl] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (callbacks.saveExpenseToDb) {
        callbacks.saveExpenseToDb(newExpense);
      }

      const confirmText = 
`✅ *Travel Expense Logged Successfully!*

📅 *Date:* ${expenseDate}
📌 *Category:* ${parsed.category}
💰 *Amount:* ₹${parsed.amount.toLocaleString('en-IN')}
📝 *Notes:* ${parsed.comment}

🌐 *View on Dashboard:* ${DASHBOARD_URL}`;

      await sendMetaWhatsAppMessage(callbacks.phoneNumberId, callbacks.accessToken, fromPhone, confirmText);
    }
  } catch (err) {
    console.error('Error handling Meta WhatsApp Message:', err.message);
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
        console.log(`⚠️ WhatsApp Bot connection closed (statusCode: ${statusCode}). Reconnecting in 3s...`);
        setTimeout(() => startWhatsAppBot(callbacks), 3000);
      } else if (connection === 'open') {
        isConnected = true;
        qrCodeDataUrl = null;
        const rawJid = waSock.user?.id || waSock.user?.jid || '';
        connectedUserJid = rawJid.split('@')[0].split(':')[0];
        console.log('🤖 WhatsApp Travel Expense Bot CONNECTED & ONLINE! (Phone: +' + connectedUserJid + ')');
        // Persist valid active session to Firebase
        backupAuthToFirebase(dbFn);
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

  let sent = false;

  // Try 1: Send via Baileys if connected
  if (waSock && isConnected) {
    try {
      await waSock.sendMessage(jid, { text: msgText });
      sent = true;
      console.log(`✅ OTP WhatsApp message sent via Baileys to ${jid}`);
    } catch (sendErr) {
      console.warn(`⚠️ Baileys OTP send note:`, sendErr.message);
    }
  }

  // Try 2: Send via CallMeBot if API key is present
  if (!sent && process.env.CALLMEBOT_API_KEY) {
    try {
      sent = await sendCallMeBotMessage(cleanPhone, msgText);
      if (sent) console.log(`✅ OTP WhatsApp message sent via CallMeBot to +${cleanPhone}`);
    } catch (cmbErr) {
      console.warn(`⚠️ CallMeBot OTP send note:`, cmbErr.message);
    }
  }

  // Try 3: Send via UltraMsg if credentials present
  if (!sent && process.env.ULTRAMSG_INSTANCE_ID && process.env.ULTRAMSG_TOKEN) {
    try {
      sent = await sendUltraMsgMessage(cleanPhone, msgText);
      if (sent) console.log(`✅ OTP WhatsApp message sent via UltraMsg to +${cleanPhone}`);
    } catch (umErr) {
      console.warn(`⚠️ UltraMsg OTP send note:`, umErr.message);
    }
  }

  // Try 4: Send via Meta Cloud API if credentials present
  const metaPhoneId = process.env.META_WA_PHONE_NUMBER_ID;
  const metaToken = process.env.META_WA_ACCESS_TOKEN;

  if (!sent && metaPhoneId && metaToken) {
    try {
      sent = await sendMetaWhatsAppMessage(metaPhoneId, metaToken, cleanPhone, msgText);
      if (sent) console.log(`✅ OTP WhatsApp message sent via Meta Cloud API to +${cleanPhone}`);
    } catch (metaErr) {
      console.warn(`⚠️ Meta API OTP send note:`, metaErr.message);
    }
  }

  return { success: true, phone: cleanPhone, message: `OTP sent to +${cleanPhone}!` };
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

async function disconnectWhatsAppBot() {
  try {
    if (waSock) {
      try { await waSock.logout(); } catch (_) {}
      try { waSock.end(undefined); } catch (_) {}
      waSock = null;
    }
    isConnected = false;
    connectedUserJid = null;
    qrCodeDataUrl = null;

    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    if (dbFn) {
      await dbFn.collection('_system').doc('whatsapp_auth').delete().catch(() => {});
    }
    console.log('🔌 WhatsApp Bot disconnected manually & session reset.');

    return { success: true, message: 'Bot disconnected & session cleared. Ready for new QR code scan!' };
  } catch (err) {
    console.error('Error disconnecting bot:', err.message);
    throw err;
  }
}

async function handleUltraMsgMessage(data, callbacks = {}) {
  try {
    if (!data || data.fromMe) return; // Skip outbound messages sent from me
    const rawFrom = data.from || '';
    const fromPhone = rawFrom.replace(/[^0-9]/g, ''); // e.g. "919076314255"
    const textOnly = (data.body || '').trim();

    if (!fromPhone || !textOnly) return;

    // Parse expense from text
    const parsed = parseExpenseMessage(textOnly);
    if (!parsed || !parsed.amount || parsed.amount <= 0) return;

    const getUsers = callbacks.getUsers || (callbacks.getLocalUsers ? callbacks.getLocalUsers : null);
    const users = getUsers ? getUsers() : {};

    let matchedUserId = 'wa_' + fromPhone;
    let userEmail = '';

    const foundUser = Object.values(users).find(u => {
      const uPhone = (u.phone || u.whatsapp || u.mobile || '').replace(/[^0-9]/g, '');
      return uPhone && (uPhone === fromPhone || fromPhone.endsWith(uPhone) || uPhone.endsWith(fromPhone));
    });

    if (foundUser) {
      matchedUserId = foundUser.id || foundUser.uid || foundUser.email;
      userEmail = foundUser.email;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const newExpense = {
      id: 'wa_um_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      userId: matchedUserId,
      date: dateStr,
      location: parsed.location || parsed.category || 'Travel',
      notes: parsed.notes || textOnly,
      total: parsed.amount,
      paymentStatus: 'pending',
      paymentBillUrl: data.media || null,
      settledAt: null,
      createdAt: new Date().toISOString(),
      source: 'WhatsApp UltraMsg'
    };

    if (callbacks.saveExpenseToDb) {
      await callbacks.saveExpenseToDb(newExpense);
    } else if (saveExpensesFn) {
      const exps = getExpensesFn ? getExpensesFn() : [];
      exps.unshift(newExpense);
      saveExpensesFn(exps, true);
    }

    // Send reply back via UltraMsg
    const replyText =
`✅ *Expense Logged via WhatsApp!*

• *Amount:* ₹${parsed.amount}
• *Location/Type:* ${newExpense.location}
• *Notes:* ${newExpense.notes}
• *Date:* ${newExpense.date}
${userEmail ? `• *Account:* Linked to ${userEmail}` : '• *Account:* WhatsApp'}`;

    await sendUltraMsgMessage(fromPhone, replyText);
  } catch (err) {
    console.error('Error handling UltraMsg message:', err.message);
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
  disconnectWhatsAppBot,
  getWhatsAppStatus,
  parseExpenseMessage,
  requestWhatsAppPairingCode,
  sendWhatsAppOTP,
  verifyWhatsAppOTP,
  handleMetaWhatsAppMessage,
  handleUltraMsgMessage,
  sendCallMeBotMessage,
  sendUltraMsgMessage
};

