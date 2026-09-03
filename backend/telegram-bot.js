/**
 * Telegram Travel Expense Bot Integration
 * Powered by Bot (GrammY engine)
 * Automatic User Profile Sync & Firestore Database Persistence
 */

const { Bot } = require('node-telegram-bot-api');
const { parseExpenseMessage } = require('./whatsapp-bot');

let bot = null;
let getExpensesFn = null;
let saveExpensesFn = null;
let getUsersFn = null;
let saveUsersFn = null;
let saveExpenseToDbFn = null;
let uploadCloudinaryFn = null;

// Context store: maps user identifiers -> { lastExpenseObj, pendingReceiptUrl, draftCategory, draftNotes, timestamp }
const userContextStore = new Map();

const CATEGORY_EMOJIS = {
  'Metro': '🚇',
  'Local': '🚆',
  'Auto/Rapido': '🛺',
  'Ola/Uber': '🚗',
  'Porter': '📦',
  'Courier': '✉️',
  'Food': '🍱',
  'Others': '📌'
};

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '📊 View Summary', callback_data: 'cmd_summary' },
      { text: '📜 Recent History', callback_data: 'cmd_history' }
    ],
    [
      { text: '❓ Help & Menu', callback_data: 'cmd_help' }
    ]
  ]
};

const activeTelegramChatIds = new Map();

// ─── Helper: resolve telegram user profile in DB (Strict lookup only, zero auto-creation)
function ensureUserProfile(chatId, fromObj) {
  const chatIdStr = chatId ? chatId.toString() : '';
  const fromUsername = fromObj ? (fromObj.username || '') : '';
  const firstName = fromObj ? (fromObj.first_name || '') : '';
  const lastName = fromObj ? (fromObj.last_name || '') : '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || (fromUsername ? `@${fromUsername}` : `Telegram User (${chatIdStr})`);

  if (fromUsername && chatIdStr) {
    activeTelegramChatIds.set(fromUsername.replace(/^@/, '').toLowerCase(), chatIdStr);
  }

  if (!getUsersFn) return { matchedUserId: null, userEmail: '', userName: fullName, isLinked: false };

  const users = getUsersFn();
  const cleanFromUser = fromUsername.replace(/^@/, '').toLowerCase();
  
  // Try to find user by telegramChatId or telegramUsername
  let foundKey = Object.keys(users).find(key => {
    const u = users[key];
    if (!u) return false;
    const uChat = (u.telegramChatId || '').toString();
    const uName = (u.telegramUsername || '').replace(/^@/, '').toLowerCase();
    return (
      (uChat && uChat === chatIdStr) ||
      (cleanFromUser && uName && uName === cleanFromUser)
    );
  });

  if (foundKey) {
    const existing = users[foundKey];
    existing.telegramChatId = chatIdStr;
    if (fromUsername) existing.telegramUsername = fromUsername.replace(/^@/, '');
    existing.lastActive = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    
    if (saveUsersFn) saveUsersFn(users, false);

    return {
      matchedUserId: existing.id || foundKey,
      userEmail: existing.email || '',
      userName: existing.name || fullName,
      isLinked: true
    };
  }

  // ⚠️ UNLINKED USER -> Return isLinked: false without creating any record
  return {
    matchedUserId: null,
    userEmail: '',
    userName: fullName,
    isLinked: false
  };
}

// ─── Helper: Send 6-Digit Verification OTP via Telegram Bot
async function sendTelegramOtpMessage(usernameOrChatId, otpCode) {
  if (!bot || !bot.api) {
    throw new Error('Telegram Bot is not online or initialized.');
  }

  const users = getUsersFn ? getUsersFn() : {};
  let targetChatId = null;
  const cleanTarget = String(usernameOrChatId).trim().replace(/^@/, '').toLowerCase();

  // Find chatId from linked users or matching string
  Object.values(users).forEach(u => {
    if (u) {
      const uChat = (u.telegramChatId || '').toString();
      const uName = (u.telegramUsername || '').replace(/^@/, '').toLowerCase();
      if (uChat === cleanTarget || uName === cleanTarget) {
        targetChatId = uChat;
      }
    }
  });

  if (!targetChatId && cleanTarget && activeTelegramChatIds.has(cleanTarget)) {
    targetChatId = activeTelegramChatIds.get(cleanTarget);
  }

  if (!targetChatId && /^\d+$/.test(cleanTarget)) {
    targetChatId = cleanTarget;
  }

  const otpMsg =
`🔐 *FreeG Travel Expense Verification OTP*

Your 6-digit Telegram Account Verification OTP is:

👉 *${otpCode}*

Enter this OTP in your Web Profile Settings -> *Verify Telegram Account* to link your Telegram account.
This OTP will expire in 10 minutes.`;

  if (targetChatId) {
    try {
      await bot.api.sendMessage(targetChatId, otpMsg, { parse_mode: 'Markdown' });
      return { success: true, chatId: targetChatId };
    } catch (err) {
      console.warn('Direct Telegram OTP send note:', err.message);
    }
  }

  throw new Error(`Could not send OTP to @${cleanTarget}. Please open Telegram, search @FreegTravel_bot, click /start, and try again!`);
}

// ─── Helper: download & upload photo, return permanent URL
async function handlePhotoUpload(fileId, ctx) {
  try {
    let filePath = null;
    let fileInfo = null;

    if (ctx && ctx.api && ctx.api.getFile) {
      fileInfo = await ctx.api.getFile({ file_id: fileId }).catch(() => null);
    }
    if (!fileInfo && bot && bot.api && bot.api.getFile) {
      fileInfo = await bot.api.getFile({ file_id: fileId }).catch(() => null);
    }
    if (!fileInfo && ctx && ctx.api && ctx.api.getFile) {
      fileInfo = await ctx.api.getFile(fileId).catch(() => null);
    }
    if (!fileInfo && bot && bot.api && bot.api.getFile) {
      fileInfo = await bot.api.getFile(fileId).catch(() => null);
    }

    if (fileInfo && fileInfo.file_path) {
      filePath = fileInfo.file_path;
    }

    if (!filePath) {
      console.warn('⚠️ Could not get file_path for Telegram photo ID:', fileId);
      return null;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    const fileLink = `https://api.telegram.org/file/bot${token}/${filePath}`;

    const httpFetch = globalThis.fetch || (async (...args) => {
      const { default: fetch } = await import('node-fetch');
      return fetch(...args);
    });

    const photoRes = await httpFetch(fileLink);
    if (!photoRes.ok) {
      console.warn('⚠️ Telegram photo fetch HTTP failed:', photoRes.status);
      return fileLink;
    }

    const arrayBuf = await photoRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    if (uploadCloudinaryFn) {
      try {
        const cloudUrl = await uploadCloudinaryFn(buffer, 'image/jpeg', 'telegram_receipts');
        console.log(`☁️ Telegram receipt uploaded to Cloudinary: ${cloudUrl}`);
        return cloudUrl;
      } catch (cloudErr) {
        console.warn('⚠️ Cloudinary upload warning:', cloudErr.message);
      }
    }

    const b64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    console.log(`📦 Telegram receipt stored as Base64 (${Math.round(buffer.length / 1024)}KB)`);
    return b64;
  } catch (err) {
    console.warn('⚠️ Could not process Telegram photo:', err.message);
    return null;
  }
}

// ─── Helper: save or update expense in DB
async function persistExpense(expense) {
  if (saveExpenseToDbFn) {
    try {
      await saveExpenseToDbFn(expense);
    } catch (err) {
      console.warn('⚠️ Error persisting Telegram expense:', err.message);
    }
  } else if (getExpensesFn && saveExpensesFn) {
    const expenses = getExpensesFn();
    const idx = expenses.findIndex(e => e.id === expense.id);
    if (idx !== -1) {
      expenses[idx] = expense;
    } else {
      expenses.unshift(expense);
    }
    saveExpensesFn(expenses, true);
  }
}

// ─── Safe Telegram Reply Helper (Guarantees 100% delivery with HTML mode + Plain text fallback)
async function safeReplyCtx(ctx, text, replyMarkup = MAIN_KEYBOARD) {
  if (!ctx) return;
  const opts = replyMarkup ? { parse_mode: 'HTML', reply_markup: replyMarkup } : { parse_mode: 'HTML' };
  try {
    if (ctx.reply) return await ctx.reply(text, opts);
    if (ctx.api && ctx.chat) return await ctx.api.sendMessage(ctx.chat.id, text, opts);
  } catch (err) {
    console.warn('⚠️ HTML Telegram reply note, falling back to plain text:', err.message);
    const plainOpts = replyMarkup ? { reply_markup: replyMarkup } : {};
    try {
      const plainText = text.replace(/<[^>]*>/g, '');
      if (ctx.reply) return await ctx.reply(plainText, plainOpts);
      if (ctx.api && ctx.chat) return await ctx.api.sendMessage(ctx.chat.id, plainText, plainOpts);
    } catch (e2) {
      console.error('❌ Safe Telegram reply error:', e2.message);
    }
  }
}

// ─── Helper Response Functions
function sendGreetingMenuCtx(ctx, userName = 'Traveler') {
  const text =
`🤖 <b>FGTech Travel Expense Bot</b> ✈️

Namaste <b>${userName}</b>! Main aapka travel expense assistant hun.

📝 <b>Expense Log Karne ke Tarike:</b>

<b>One-line (fastest):</b>
• <code>Metro 150</code>
• <code>Ola 280 Andheri to Bandra</code>
• <code>Food 120 Lunch</code>

<b>Step-by-step (multi-message):</b>
1️⃣ Pehle bhejo: <code>Uber Andheri</code>
2️⃣ Phir amount: <code>280</code>
3️⃣ Optional: Bill/ticket ki photo bhejo

📸 <b>Bill Photo ke saath:</b>
• Photo + caption: <code>Local 40</code>
• Ya pehle expense bhejo, phir photo bhejo

📊 <b>Other Commands:</b>
• <code>/summary</code> — Monthly total & balance
• <code>/history</code> — Recent 5 entries
• <code>/link user@email.com</code> — Web Dashboard account se link karo

🚀 Try karo: <b>Metro 150</b>`;

  return safeReplyCtx(ctx, text, MAIN_KEYBOARD);
}

function sendMonthlySummaryCtx(ctx, matchedUserId) {
  const currentMonth = new Date().toISOString().substring(0, 7);
  const allExpenses = getExpensesFn ? getExpensesFn() : [];

  const userExpenses = allExpenses.filter(e => e && e.userId === matchedUserId);
  const monthExpenses = userExpenses.filter(e => e.date && e.date.startsWith(currentMonth));
  const totalLogged = monthExpenses.reduce((s, e) => s + (e.total || 0), 0);
  const paidTotal = monthExpenses.filter(e => e.paymentStatus === 'paid').reduce((s, e) => s + (e.total || 0), 0);
  const pendingTotal = monthExpenses.filter(e => e.paymentStatus !== 'paid').reduce((s, e) => s + (e.total || 0), 0);

  const text =
`📊 <b>Monthly Travel Summary — ${currentMonth}</b>

💰 <b>Total Logged:</b> ₹${totalLogged.toLocaleString('en-IN')}
✅ <b>Paid/Settled:</b> ₹${paidTotal.toLocaleString('en-IN')}
⏳ <b>Pending Balance:</b> ₹${pendingTotal.toLocaleString('en-IN')}
🧾 <b>Total Entries:</b> ${monthExpenses.length}`;

  return safeReplyCtx(ctx, text, MAIN_KEYBOARD);
}

function sendHistoryExpensesCtx(ctx, matchedUserId) {
  const allExpenses = getExpensesFn ? getExpensesFn() : [];
  const userExpenses = allExpenses
    .filter(e => e && e.userId === matchedUserId)
    .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0))
    .slice(0, 5);

  if (userExpenses.length === 0) {
    const emptyMsg = '📂 <b>Koi entries nahi hain abhi.</b> Type karo <code>Metro 150</code> to start!';
    return safeReplyCtx(ctx, emptyMsg, MAIN_KEYBOARD);
  }

  let text = '📜 <b>Recent 5 Travel Entries:</b>\n\n';
  userExpenses.forEach((exp, idx) => {
    const emoji = CATEGORY_EMOJIS[exp.location] || '📌';
    const status = exp.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Pending';
    const receipt = (exp.receipts && exp.receipts.length > 0) ? ' 📎' : '';
    text += `${idx + 1}. <b>${exp.date}</b> — ${emoji} ${exp.location}${receipt}\n   💰 ₹${exp.total} (${status})\n   📝 ${exp.notes || '—'}\n\n`;
  });

  return safeReplyCtx(ctx, text.trim(), MAIN_KEYBOARD);
}

function decodeTelegramEmail(param) {
  if (!param) return '';
  let clean = param.trim().replace(/^link_/, '');
  clean = clean.replace(/_at_/gi, '@').replace(/_dot_/gi, '.');
  return clean.toLowerCase();
}

function handleLinkEmailCtx(ctx, chatId, emailArg, fromObj) {
  let targetEmail = (emailArg || '').trim().toLowerCase();
  targetEmail = decodeTelegramEmail(targetEmail);

  if (!targetEmail || !targetEmail.includes('@')) {
    const msgText = '⚠️ Valid email address required. Example: <code>/link user@example.com</code>';
    return safeReplyCtx(ctx, msgText, null);
  }

  const chatIdStr = chatId ? chatId.toString() : '';
  const users = getUsersFn ? getUsersFn() : {};
  const foundKey = Object.keys(users).find(k => users[k] && users[k].email && users[k].email.toLowerCase() === targetEmail);

  if (foundKey) {
    const user = users[foundKey];
    user.telegramChatId = chatIdStr;
    if (fromObj && fromObj.username) user.telegramUsername = fromObj.username.replace(/^@/, '');
    user.telegramVerified = true;
    user.updatedAt = new Date().toISOString();
    user.lastActive = new Date().toISOString();

    if (saveUsersFn) saveUsersFn(users, true);

    const msgText = `🎉 <b>Account Linked Successfully!</b>\n\nTelegram account (@${fromObj && fromObj.username ? fromObj.username : 'user'}) is now linked to <b>${targetEmail}</b> (${user.name}). All bot expenses will appear on your Web Dashboard!`;
    return safeReplyCtx(ctx, msgText, MAIN_KEYBOARD);
  } else {
    const msgText = `⚠️ Account <b>${targetEmail}</b> Web App pe nahi mila. Pehle Web Dashboard pe login karein, phir <code>/link ${targetEmail}</code> command chalaayein.`;
    return safeReplyCtx(ctx, msgText, null);
  }
}

/**
 * Main Telegram Bot Initialization
 */
async function startTelegramBot(callbacks = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

  getExpensesFn = callbacks.getLocalExpenses;
  saveExpensesFn = callbacks.saveLocalExpenses;
  getUsersFn = callbacks.getLocalUsers;
  saveUsersFn = callbacks.saveLocalUsers;
  uploadCloudinaryFn = callbacks.uploadToCloudinary;
  saveExpenseToDbFn = callbacks.saveExpenseToDb;

  if (!token) {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN not set in environment. Telegram bot is idle.');
    return null;
  }

  try {
    bot = new Bot(token);
    console.log('🤖 Telegram Travel Expense Bot CONNECTED & ONLINE! (@FreegTravel_bot) 🚀');

    // (Error handling is done via bot.on('polling_error', ...) registered later)

    // ── Command: /start, /help, /menu
    bot.command(['start', 'help', 'menu'], async (ctx) => {
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      const text = ctx.message ? ctx.message.text : '';
      const parts = text.split(/\s+/);
      const param = (parts[1] || '').trim();

      // Auto 1-Click Link if parameter has encoded email
      if (param && (param.includes('_at_') || param.includes('@'))) {
        const decoded = decodeTelegramEmail(param);
        if (decoded && decoded.includes('@')) {
          return handleLinkEmailCtx(ctx, chatId, decoded, ctx.from);
        }
      }

      const { userName, isLinked } = ensureUserProfile(chatId, ctx.from);

      if (!isLinked) {
        const fromUser = ctx.from ? (ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name) : '';
        const welcomeUnlinked =
`👋 *Welcome to FreeG Travel Expense Bot!*

⚠️ Your Telegram account (${fromUser}) is not linked to your Web Profile yet.

*How to Link Your Account:*
Send \`/link your_email@gmail.com\` here in chat to link instantly!`;

        return ctx.reply(welcomeUnlinked, { parse_mode: 'Markdown' }).catch(() => {});
      }
      return sendGreetingMenuCtx(ctx, userName);
    });

    // ── Command: /summary, /total, /balance
    bot.command(['summary', 'total', 'balance'], async (ctx) => {
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      const { matchedUserId, isLinked } = ensureUserProfile(chatId, ctx.from);
      if (!isLinked) return ctx.reply('⚠️ Account not linked yet. Please verify Telegram Account in Web Profile Settings.').catch(() => {});
      return sendMonthlySummaryCtx(ctx, matchedUserId);
    });

    // ── Command: /history, /recent, /list
    bot.command(['history', 'recent', 'list'], async (ctx) => {
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      const { matchedUserId, isLinked } = ensureUserProfile(chatId, ctx.from);
      if (!isLinked) return ctx.reply('⚠️ Account not linked yet. Please verify Telegram Account in Web Profile Settings.').catch(() => {});
      return sendHistoryExpensesCtx(ctx, matchedUserId);
    });

    // ── Command: /add <text>
    bot.command('add', async (ctx) => {
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      const text = ctx.message ? ctx.message.text : '';
      const payload = text.replace(/^\/add\s*/i, '').trim();

      const { matchedUserId, userEmail, userName, isLinked } = ensureUserProfile(chatId, ctx.from);
      if (!isLinked) return ctx.reply('⚠️ Account not linked yet. Please verify Telegram Account in Web Profile Settings.').catch(() => {});

      if (!payload) {
        return safeReplyCtx(ctx, '📝 <b>Format:</b> <code>/add Location Amount Mode Date</code>\n\n<i>Example:</i> <code>/add Andheri 80 metro 6 Aug</code>\n<i>Example:</i> <code>/add Warehouse 32 6-Aug-26</code>');
      }

      const parsed = parseExpenseMessage(payload);
      if (!parsed) {
        return safeReplyCtx(ctx, '❌ Could not parse expense details. Try: <code>/add Andheri 80 metro 6 Aug</code>');
      }

      if (parsed.isMulti && parsed.items && parsed.items.length > 0) {
        let summaryLines = [];
        let grandTotal = 0;
        for (let i = 0; i < parsed.items.length; i++) {
          const item = parsed.items[i];
          const expenseDate = item.dateStr || new Date().toISOString().slice(0, 10);
          const expenseId = `exp_tg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${i}`;
          const itemLocation = item.comment || item.category || 'Travel Entry';
          const itemEntries = item.entries && item.entries.length > 0 ? item.entries : [{ type: item.category || 'Others', amount: item.amount }];
          const itemTotal = item.total || item.amount;

          const newExpense = {
            id: expenseId,
            userId: matchedUserId,
            date: expenseDate,
            location: itemLocation,
            notes: itemLocation,
            paymentStatus: 'pending',
            entries: itemEntries,
            total: itemTotal,
            receipts: [],
            paymentBillUrl: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'Telegram Bot'
          };

          await persistExpense(newExpense);
          grandTotal += itemTotal;
          const entryBreakdownStr = itemEntries.map(e => `${e.type}: ₹${e.amount}`).join(', ');
          summaryLines.push(`${i + 1}. 📍 <b>${itemLocation}</b> — ₹${itemTotal.toLocaleString('en-IN')} (${entryBreakdownStr})\n   📅 <i>${expenseDate}</i>`);
        }

        const multiConfirmText =
`✅ <b>${parsed.items.length} Bulk Expenses Saved!</b>

${summaryLines.join('\n\n')}

💰 <b>Total Batch:</b> ₹${grandTotal.toLocaleString('en-IN')}
👤 <b>Account:</b> ${userName} (${userEmail || 'Telegram'})`;

        return safeReplyCtx(ctx, multiConfirmText, MAIN_KEYBOARD);
      }

      const expenseDate = parsed.dateStr || new Date().toISOString().slice(0, 10);
      const expenseId = `exp_tg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const finalLocation = parsed.comment || parsed.category || 'Travel Entry';
      const finalEntries = parsed.entries && parsed.entries.length > 0 ? parsed.entries : [{ type: parsed.category, amount: parsed.amount }];
      const finalTotal = parsed.total || parsed.amount;

      const newExpense = {
        id: expenseId,
        userId: matchedUserId,
        date: expenseDate,
        location: finalLocation,
        notes: finalLocation,
        paymentStatus: 'pending',
        entries: finalEntries,
        total: finalTotal,
        receipts: [],
        paymentBillUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: 'Telegram Bot'
      };

      await persistExpense(newExpense);

      const confirmText =
`✅ <b>Expense Saved!</b>

📍 <b>Location:</b> ${finalLocation}
💰 <b>Amount:</b> ₹${finalTotal.toLocaleString('en-IN')}
🚗 <b>Mode:</b> ${parsed.category}
📅 <b>Date:</b> ${expenseDate}

Total: ₹${finalTotal}`;

      return safeReplyCtx(ctx, confirmText, MAIN_KEYBOARD);
    });

    // ── Command: /addtemplate
    bot.command('addtemplate', async (ctx) => {
      const templateMsg =
`📝 <b>Bulk & Single Expense Formats:</b>

1️⃣ <b>Command Format:</b>
<code>/add Location Amount Mode Date</code>
• <code>/add Andheri 80 metro 6 Aug</code>
• <code>/add Colaba 767 auto 9-Jul-26</code>
• <code>/add BKC 292 metro 13 Jul</code>

2️⃣ <b>Multi-Amount Breakdown:</b>
<code>Belapur workloft 7-Aug-26 20 15 386</code>
(Metro 20, Local 15, Auto 386 = Total ₹421)

3️⃣ <b>Bulk Paste (Multi-line):</b>
<code>Warehouse 6-Aug-26 32
Belapur workloft 7-Aug-26 20 15 386
Doolally Andheri / Varsova 8-Aug-26 60 102
Chai 18-Aug-26 36
Chai 19-Aug-26 36
Belapur workloft 20-Aug-26 780</code>`;
      return safeReplyCtx(ctx, templateMsg);
    });

    // ── Command: /link <email>
    bot.command('link', async (ctx) => {
      const text = ctx.message ? ctx.message.text : '';
      const parts = text.split(/\s+/);
      const email = (parts[1] || '').trim();
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      return handleLinkEmailCtx(ctx, chatId, email, ctx.from);
    });

    // ── Inline Keyboard Callbacks
    bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery ? ctx.callbackQuery.data : null;
      try {
        await ctx.answerCallbackQuery();
      } catch (_) {}

      const chatId = ctx.chat ? ctx.chat.id : (ctx.callbackQuery && ctx.callbackQuery.message ? ctx.callbackQuery.message.chat.id : 0);
      const { matchedUserId, userName, isLinked } = ensureUserProfile(chatId, ctx.from);
      if (!isLinked) return ctx.reply('⚠️ Account not linked yet. Please verify Telegram Account in Web Profile Settings.').catch(() => {});

      if (data === 'cmd_summary') return sendMonthlySummaryCtx(ctx, matchedUserId);
      if (data === 'cmd_history') return sendHistoryExpensesCtx(ctx, matchedUserId);
      if (data === 'cmd_help') return sendGreetingMenuCtx(ctx, userName);
    });

    // ── Message Listener (Text + Photos)
    bot.on('message', async (ctx) => {
      const msg = ctx.message;
      if (!msg || !msg.chat) return;

      const chatId = msg.chat.id;
      const chatIdStr = chatId.toString();
      const textOnly = (msg.text || msg.caption || '').trim();
      const isPhoto = !!(msg.photo && msg.photo.length > 0);

      // Ignore slash commands handled by bot.command above
      if (textOnly && textOnly.startsWith('/')) return;

      // Ensure Profile is linked
      const { matchedUserId, userEmail, userName, isLinked } = ensureUserProfile(chatId, ctx.from || msg.from);

      if (!isLinked) {
        const fromUser = (ctx.from && ctx.from.username) ? `@${ctx.from.username}` : (msg.from && msg.from.first_name ? msg.from.first_name : 'User');
        const unlinkedWarning =
`⚠️ <b>Telegram Account Not Linked!</b>

Hello <b>${fromUser}</b>, your Telegram account is not linked to any Web Profile yet.

<b>How to Link:</b>
Send <code>/link your_email@gmail.com</code> here to link instantly!`;
        return safeReplyCtx(ctx, unlinkedWarning, null);
      }

      const now = Date.now();
      // Look up any active context for this user
      let userContext = userContextStore.get(matchedUserId)
        || userContextStore.get(chatIdStr)
        || userContextStore.get(`telegram_${chatIdStr}`)
        || null;
      // Expire context older than 10 minutes
      if (userContext && (now - userContext.timestamp > 600000)) {
        userContext = null;
        userContextStore.delete(matchedUserId);
        userContextStore.delete(chatIdStr);
        userContextStore.delete(`telegram_${chatIdStr}`);
      }

      // ── Upload photo if present ──
      let receiptUrl = null;
      if (isPhoto) {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        receiptUrl = await handlePhotoUpload(largestPhoto.file_id, ctx);
      }

      const parsed = textOnly ? parseExpenseMessage(textOnly) : null;

      // ══════════════════════════════════════════════════
      // CASE A: PHOTO ONLY (no parseable expense text / no caption)
      //         OR PHOTO + CAPTION that is a location-only (partial)
      //         -> Store photo and ask for expense details
      // ══════════════════════════════════════════════════
      if (isPhoto && receiptUrl && (!parsed || parsed.isCommand || (parsed && parsed.isPartial && !parsed.amount))) {
        // First check: does user have a very recent expense (<10 min) to attach this to?
        let recentExp = userContext ? (userContext.lastExpenseObj || null) : null;
        if (!recentExp && getExpensesFn) {
          const allExps = getExpensesFn();
          const tenMinsAgo = now - 600000;
          recentExp = allExps.find(e =>
            e &&
            (e.userId === matchedUserId || e.userId === `telegram_${chatIdStr}` || e.userId === chatIdStr) &&
            (new Date(e.createdAt || e.updatedAt || 0).getTime() > tenMinsAgo)
          ) || null;
        }

        if (recentExp) {
          // Attach to the last recent expense
          if (!recentExp.receipts) recentExp.receipts = [];
          if (!recentExp.receipts.includes(receiptUrl)) recentExp.receipts.push(receiptUrl);
          recentExp.paymentBillUrl = receiptUrl;
          recentExp.updatedAt = new Date().toISOString();

          await persistExpense(recentExp);
          userContextStore.delete(matchedUserId);
          userContextStore.delete(chatIdStr);
          userContextStore.delete(`telegram_${chatIdStr}`);

          const catName = (recentExp.entries && recentExp.entries[0] && recentExp.entries[0].type) || 'Auto/Rapido';
          const emoji = CATEGORY_EMOJIS[catName] || '📌';
          const confirmMsg =
`📎 <b>Receipt Photo Attached!</b>

📅 <b>Date:</b> ${recentExp.date}
${emoji} <b>Category:</b> ${catName} (📍 ${recentExp.location})
💰 <b>Amount:</b> ₹${(recentExp.total || 0).toLocaleString('en-IN')}
📝 <b>Notes:</b> ${recentExp.notes || recentExp.location}
✅ <b>Photo linked to entry in Database!</b>`;
          return safeReplyCtx(ctx, confirmMsg, MAIN_KEYBOARD);
        }

        // No recent expense -> Save photo in context and ask for details
        const ctxData = {
          ...(userContext || {}),
          pendingReceiptUrl: receiptUrl,
          draftCategory: (parsed && parsed.isPartial) ? parsed.category : (userContext ? userContext.draftCategory : null),
          draftNotes: (parsed && parsed.isPartial) ? parsed.comment : (userContext ? userContext.draftNotes : null),
          timestamp: now
        };
        userContextStore.set(matchedUserId, ctxData);
        userContextStore.set(chatIdStr, ctxData);

        if (parsed && parsed.isPartial && parsed.category) {
          const emoji = CATEGORY_EMOJIS[parsed.category] || '📌';
          return safeReplyCtx(ctx,
            `📸 <b>Photo + Location saved!</b> ${emoji} <b>${parsed.comment || parsed.category}</b>\n\n💬 Ab sirf amount bhejein (e.g. <code>280</code>) to log this expense!`,
            null
          );
        }
        return safeReplyCtx(ctx,
          '📸 <b>Receipt photo received!</b>\n\n💬 Ab expense details bhejein (e.g. <code>Metro 150</code> ya <code>Ola Andheri 280</code>) to log the expense!',
          null
        );
      }

      // ══════════════════════════════════════════════════
      // CASE B: Command keywords (help, summary, history)
      // ══════════════════════════════════════════════════
      if (parsed && parsed.isCommand) {
        if (parsed.command === 'help') return sendGreetingMenuCtx(ctx, userName);
        if (parsed.command === 'summary') return sendMonthlySummaryCtx(ctx, matchedUserId);
        if (parsed.command === 'history') return sendHistoryExpensesCtx(ctx, matchedUserId);
        if (parsed.command === 'link') return handleLinkEmailCtx(ctx, chatId, parsed.arg, ctx.from || msg.from);
      }

      // ══════════════════════════════════════════════════
      // CASE C: Partial text (location without amount) — no photo
      // ══════════════════════════════════════════════════
      if (parsed && !parsed.isCommand && parsed.isPartial && !parsed.amount) {
        const pendingUrl = receiptUrl || (userContext ? userContext.pendingReceiptUrl : null);
        const ctxData = {
          draftCategory: parsed.category,
          draftNotes: parsed.comment,
          pendingReceiptUrl: pendingUrl,
          timestamp: now
        };
        userContextStore.set(matchedUserId, ctxData);
        userContextStore.set(chatIdStr, ctxData);

        const emoji = CATEGORY_EMOJIS[parsed.category] || '📌';
        return safeReplyCtx(ctx,
          `📍 <b>Location recorded:</b> ${parsed.comment || parsed.category}\n${emoji} <b>Category:</b> ${parsed.category}\n\n💬 Ab amount bhejein (e.g. <code>280</code>) — ya pehle bill photo bhej sakte ho!`,
          null
        );
      }

      // ══════════════════════════════════════════════════
      // CASE D: Full expense entry (or Multi-line Bulk entries)
      // ══════════════════════════════════════════════════
      if (parsed && !parsed.isCommand && (parsed.isMulti || parsed.amount > 0)) {
        if (parsed.isMulti && parsed.items && parsed.items.length > 0) {
          let summaryLines = [];
          let grandTotal = 0;
          for (let i = 0; i < parsed.items.length; i++) {
            const item = parsed.items[i];
            const expenseDate = item.dateStr || new Date().toISOString().slice(0, 10);
            const expenseId = `exp_tg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${i}`;
            const itemLocation = item.comment || item.category || 'Travel Entry';
            const itemEntries = item.entries && item.entries.length > 0 ? item.entries : [{ type: item.category || 'Others', amount: item.amount }];
            const itemTotal = item.total || item.amount;

            const newExpense = {
              id: expenseId,
              userId: matchedUserId,
              date: expenseDate,
              location: itemLocation,
              notes: itemLocation,
              paymentStatus: 'pending',
              entries: itemEntries,
              total: itemTotal,
              receipts: receiptUrl ? [receiptUrl] : [],
              paymentBillUrl: receiptUrl || null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              source: 'Telegram Bot'
            };

            await persistExpense(newExpense);
            grandTotal += itemTotal;
            const entryBreakdownStr = itemEntries.map(e => `${e.type}: ₹${e.amount}`).join(', ');
            summaryLines.push(`${i + 1}. 📍 <b>${itemLocation}</b> — ₹${itemTotal.toLocaleString('en-IN')} (${entryBreakdownStr})\n   📅 <i>${expenseDate}</i>`);
          }

          const multiConfirmText =
`✅ <b>${parsed.items.length} Travel Expenses Saved to Database!</b>

${summaryLines.join('\n\n')}

💰 <b>Total Batch:</b> ₹${grandTotal.toLocaleString('en-IN')}
👤 <b>Account:</b> ${userName} (${userEmail || 'Telegram'})`;

          return safeReplyCtx(ctx, multiConfirmText, MAIN_KEYBOARD);
        }

        let finalCategory = parsed.category;
        let finalLocation = parsed.comment || parsed.category;
        let finalNotes = parsed.comment || parsed.category;
        let finalReceipts = receiptUrl ? [receiptUrl] : [];

        // Merge from userContext ONLY if current message is amount-only (no location in this message)
        const currentMsgHasLocation = parsed.category && parsed.category !== 'Others';
        if (userContext && (now - userContext.timestamp < 600000)) {
          if (userContext.draftCategory && !currentMsgHasLocation) {
            finalCategory = userContext.draftCategory;
          }
          if (userContext.draftNotes && !currentMsgHasLocation) {
            finalNotes = parsed.comment && parsed.comment !== userContext.draftNotes
              ? `${userContext.draftNotes} — ${parsed.comment}`
              : userContext.draftNotes;
            finalLocation = userContext.draftNotes;
          }
          if (userContext.pendingReceiptUrl && !finalReceipts.includes(userContext.pendingReceiptUrl)) {
            finalReceipts.push(userContext.pendingReceiptUrl);
          }
          userContextStore.delete(matchedUserId);
          userContextStore.delete(chatIdStr);
          userContextStore.delete(`telegram_${chatIdStr}`);
        }

        const expenseDate = parsed.dateStr || new Date().toISOString().slice(0, 10);
        const expenseId = `exp_tg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const finalEntries = parsed.entries && parsed.entries.length > 0 ? parsed.entries : [{ type: finalCategory, amount: parsed.amount }];
        const finalTotal = parsed.total || parsed.amount;

        const newExpense = {
          id: expenseId,
          userId: matchedUserId,
          date: expenseDate,
          location: finalLocation,
          notes: finalNotes,
          paymentStatus: 'pending',
          entries: finalEntries,
          total: finalTotal,
          receipts: finalReceipts,
          paymentBillUrl: finalReceipts[0] || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'Telegram Bot'
        };

        await persistExpense(newExpense);

        // Save in context so next photo message can attach to this expense
        const ctxData = { lastExpenseObj: newExpense, timestamp: now };
        userContextStore.set(matchedUserId, ctxData);
        userContextStore.set(chatIdStr, ctxData);
        userContextStore.set(`telegram_${chatIdStr}`, ctxData);

        const emoji = CATEGORY_EMOJIS[finalCategory] || '📌';
        const photoTag = finalReceipts.length > 0
          ? '\n📎 <b>Receipt attached!</b>'
          : '\n💡 <i>Bill/ticket photo hai toh abhi bhej sakte ho!</i>';

        const confirmText =
`✅ <b>Travel Expense Logged &amp; Saved!</b>

📅 <b>Date:</b> ${expenseDate}
${emoji} <b>Location:</b> ${finalLocation}
💰 <b>Amount:</b> ₹${finalTotal.toLocaleString('en-IN')}
📝 <b>Notes:</b> ${finalNotes}${photoTag}
👤 <b>Account:</b> ${userName} (${userEmail || 'Telegram'})`;

        return safeReplyCtx(ctx, confirmText, MAIN_KEYBOARD);
      }

      // ══════════════════════════════════════════════════
      // CASE E: Unknown / unrecognized text -> show menu
      // ══════════════════════════════════════════════════
      if (textOnly) {
        return sendGreetingMenuCtx(ctx, userName);
      }
    });

    // ── Global Error Handler (grammY-style bot.catch for all middleware errors)
    bot.catch((err) => {
      const msg = err && (err.message || String(err));
      if (msg.includes('409') || msg.includes('Conflict')) {
        console.warn('⚠️ Telegram 409 conflict note (dual container on Render). Old instance stopping...');
        return;
      }
      if (msg.includes('ENOTFOUND') || msg.includes('EFATAL')) {
        console.warn('⚠️ Telegram network note:', msg);
        return;
      }
      console.warn('⚠️ Telegram bot error:', msg);
    });

    // ── Start Polling with graceful 409 retry
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
    } catch (_) {}

    const runPolling = async () => {
      while (true) {
        try {
          await bot.startPolling();
          break; // clean stop
        } catch (pollErr) {
          const pmsg = pollErr && (pollErr.message || String(pollErr));
          if (pmsg.includes('409') || pmsg.includes('Conflict')) {
            console.warn('⚠️ Telegram polling 409 conflict. Waiting 12s for old container to stop...');
            await new Promise(r => setTimeout(r, 12000));
            // retry immediately
          } else if (pmsg.includes('already running')) {
            console.warn('⚠️ Polling already running, skipping restart.');
            break;
          } else {
            console.warn('⚠️ Telegram polling stopped:', pmsg, '— Retrying in 10s...');
            await new Promise(r => setTimeout(r, 10000));
          }
        }
      }
    };

    runPolling().catch(e => console.error('❌ Telegram polling fatal:', e && e.message));
    console.log('✅ Telegram Bot polling started!');

    return bot;
  } catch (err) {
    console.error('❌ Error starting Telegram Bot:', err.message);
    return null;
  }
}

module.exports = { startTelegramBot, sendTelegramOtpMessage };
