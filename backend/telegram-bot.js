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
    if (ctx && ctx.api && ctx.api.getFile) {
      const fileInfo = await ctx.api.getFile(fileId);
      if (fileInfo && fileInfo.file_path) filePath = fileInfo.file_path;
    } else if (bot && bot.api && bot.api.getFile) {
      const fileInfo = await bot.api.getFile(fileId);
      if (fileInfo && fileInfo.file_path) filePath = fileInfo.file_path;
    }

    if (!filePath) return null;

    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    const fileLink = `https://api.telegram.org/file/bot${token}/${filePath}`;

    const httpFetch = globalThis.fetch || (async (...args) => {
      const { default: fetch } = await import('node-fetch');
      return fetch(...args);
    });

    const photoRes = await httpFetch(fileLink);
    if (!photoRes.ok) return fileLink;

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

    bot.catch((err) => {
      const msg = err && (err.message || String(err));
      if (msg.includes('409') || msg.includes('Conflict') || msg.includes('getUpdates')) {
        console.warn('⚠️ Telegram bot polling note: Dual container deployment conflict handled gracefully.');
        return;
      }
      console.warn('⚠️ Telegram bot note:', msg);
    });

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
`⚠️ *Telegram Account Not Linked!*

Hello *${fromUser}*, your Telegram account is not linked to any Web Profile yet.

*How to Link Your Account:*
1️⃣ Open Web App -> Go to *Profile Settings*.
2️⃣ Under *Verify Telegram Account*, enter *${fromUser}*.
3️⃣ Click *Send OTP* & enter the 6-digit OTP code sent here by this bot!

_Once verified, all your travel expenses logged on Telegram will automatically update under your account!_`;

        return ctx.reply(unlinkedWarning, { parse_mode: 'Markdown' }).catch(() => {});
      }

      let receiptUrl = null;
      if (isPhoto) {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        receiptUrl = await handlePhotoUpload(largestPhoto.file_id, ctx);
      }

      const now = Date.now();
      const userContext = userContextStore.get(matchedUserId) || userContextStore.get(chatIdStr) || userContextStore.get(`telegram_${chatIdStr}`);
      const parsed = textOnly ? parseExpenseMessage(textOnly) : null;

      // ══════════════════════════════════════════════════
      // CASE A: Photo Message (Attach to recent expense or draft)
      // ══════════════════════════════════════════════════
      if (isPhoto && receiptUrl && (!parsed || parsed.isCommand)) {
        // 1. Check in-memory userContextStore
        let targetExp = userContext ? (userContext.lastExpenseObj || null) : null;

        // 2. Fallback: Search DB for user's most recent expense created in last 10 minutes
        if (!targetExp && getExpensesFn) {
          const allExps = getExpensesFn();
          const tenMinsAgo = now - 600000;
          targetExp = allExps.find(e =>
            e &&
            (e.userId === matchedUserId || e.userId === `telegram_${chatIdStr}` || e.userId === chatIdStr) &&
            (new Date(e.createdAt || e.updatedAt || 0).getTime() > tenMinsAgo)
          ) || null;
        }

        if (targetExp) {
          if (!targetExp.receipts) targetExp.receipts = [];
          if (!targetExp.receipts.includes(receiptUrl)) {
            targetExp.receipts.push(receiptUrl);
          }
          targetExp.paymentBillUrl = receiptUrl;
          targetExp.updatedAt = new Date().toISOString();

          await persistExpense(targetExp);
          userContextStore.delete(matchedUserId);
          userContextStore.delete(chatIdStr);
          userContextStore.delete(`telegram_${chatIdStr}`);

          const confirmMsg =
`📎 *Receipt Photo Attached!*

📅 *Date:* ${targetExp.date}
${CATEGORY_EMOJIS[targetExp.location] || '📌'} *Category:* ${targetExp.location}
💰 *Amount:* ₹${(targetExp.total || 0).toLocaleString('en-IN')}
📝 *Notes:* ${targetExp.notes || targetExp.location}
✅ *Photo linked to entry in Database!*`;

          return ctx.reply(confirmMsg, { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD })
            .catch(err => console.warn('Telegram reply error:', err.message));
        } else if (userContext && userContext.draftCategory && (now - userContext.timestamp < 600000)) {
          const ctxData = { ...userContext, pendingReceiptUrl: receiptUrl, timestamp: now };
          userContextStore.set(matchedUserId, ctxData);
          userContextStore.set(chatIdStr, ctxData);
          return ctx.reply('📸 *Receipt photo saved!* Ab amount bhejein (e.g. `280`) to complete the entry.', { parse_mode: 'Markdown' })
            .catch(err => console.warn('Telegram reply error:', err.message));
        } else {
          const ctxData = { pendingReceiptUrl: receiptUrl, timestamp: now };
          userContextStore.set(matchedUserId, ctxData);
          userContextStore.set(chatIdStr, ctxData);
          return ctx.reply('📸 *Receipt photo received!* Ab travel details aur amount bhejein (e.g. `Metro 150`) to log the expense.', { parse_mode: 'Markdown' })
            .catch(err => console.warn('Telegram reply error:', err.message));
        }
      }

      // ══════════════════════════════════════════════════
      // CASE B: Command in message text (e.g. "hii", "hello", "help", "summary")
      // ══════════════════════════════════════════════════
      if (parsed && parsed.isCommand) {
        if (parsed.command === 'help') return sendGreetingMenuCtx(ctx, userName);
        if (parsed.command === 'summary') return sendMonthlySummaryCtx(ctx, matchedUserId);
        if (parsed.command === 'history') return sendHistoryExpensesCtx(ctx, matchedUserId);
        if (parsed.command === 'link') return handleLinkEmailCtx(ctx, chatId, parsed.arg, ctx.from || msg.from);
      }

      // ══════════════════════════════════════════════════
      // CASE C: Partial text (location without amount)
      // ══════════════════════════════════════════════════
      if (parsed && !parsed.isCommand && parsed.isPartial) {
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
        return ctx.reply(
          `📍 *Location recorded:* ${parsed.comment}\n${emoji} *Category:* ${parsed.category}\n\n💬 Ab amount bhejein (e.g. \`280\`) to complete this entry!`,
          { parse_mode: 'Markdown' }
        ).catch(err => console.warn('Telegram reply error:', err.message));
      }

      // ══════════════════════════════════════════════════
      // CASE D: Full expense entry (has amount)
      // ══════════════════════════════════════════════════
      if (parsed && !parsed.isCommand && parsed.amount > 0) {
        let finalCategory = parsed.category;
        let finalNotes = parsed.comment || parsed.category;
        let finalReceipts = receiptUrl ? [receiptUrl] : [];

        if (userContext && (now - userContext.timestamp < 600000)) {
          if (userContext.draftCategory && userContext.draftCategory !== 'Others') {
            finalCategory = userContext.draftCategory;
          }
          if (userContext.draftNotes && userContext.draftNotes !== finalNotes) {
            finalNotes = `${userContext.draftNotes} — ${finalNotes}`;
          }
          if (!receiptUrl && userContext.pendingReceiptUrl) {
            finalReceipts.push(userContext.pendingReceiptUrl);
          }
          userContextStore.delete(matchedUserId);
          userContextStore.delete(chatIdStr);
        }

        const expenseDate = parsed.dateStr || new Date().toISOString().slice(0, 10);
        const expenseId = `exp_tg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

        const newExpense = {
          id: expenseId,
          userId: matchedUserId,
          date: expenseDate,
          location: finalCategory,
          notes: finalNotes,
          paymentStatus: 'pending',
          entries: [{ type: finalCategory, amount: parsed.amount }],
          total: parsed.amount,
          receipts: finalReceipts,
          paymentBillUrl: finalReceipts[0] || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'Telegram Bot'
        };

        await persistExpense(newExpense);

        // Store in userContextStore under all possible user identifiers
        const ctxData = { lastExpenseObj: newExpense, timestamp: now };
        userContextStore.set(matchedUserId, ctxData);
        userContextStore.set(chatIdStr, ctxData);
        userContextStore.set(`telegram_${chatIdStr}`, ctxData);

        const emoji = CATEGORY_EMOJIS[finalCategory] || '📌';
        const photoTag = finalReceipts.length > 0 ? '\n📎 *Receipt attached!*' : '\n💡 _Bill/ticket photo hai toh abhi bhej sakte ho!_';

        const confirmText =
`✅ *Travel Expense Logged & Saved to Database!*

📅 *Date:* ${expenseDate}
${emoji} *Category:* ${finalCategory}
💰 *Amount:* ₹${parsed.amount.toLocaleString('en-IN')}
📝 *Notes:* ${finalNotes}${photoTag}
👤 *Account:* ${userName} (${userEmail || 'Telegram'})`;

        return ctx.reply(confirmText, {
          parse_mode: 'Markdown',
          reply_markup: MAIN_KEYBOARD
        }).catch(err => console.warn('Telegram reply error:', err.message));
      }

      // ══════════════════════════════════════════════════
      // CASE E: Unknown text -> show greeting
      // ══════════════════════════════════════════════════
      if (textOnly) {
        return sendGreetingMenuCtx(ctx, userName);
      }
    });

    try {
      await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    } catch (_) {}

    bot.startPolling({
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query']
    }).catch(pollErr => {
      const msg = pollErr && (pollErr.message || String(pollErr));
      if (msg.includes('409') || msg.includes('Conflict')) {
        console.warn('⚠️ Telegram Bot 409 Conflict Note: Dual container deployment on Render detected. Handled gracefully.');
      } else {
        console.warn('⚠️ Telegram Bot Polling Note:', msg);
      }
    });

    return bot;
  } catch (err) {
    console.error('❌ Error starting Telegram Bot:', err.message);
    return null;
  }
}

module.exports = { startTelegramBot, sendTelegramOtpMessage };
