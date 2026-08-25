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

// ─── Helper: resolve/create/update telegram user profile in DB
function ensureUserProfile(chatId, fromObj) {
  const chatIdStr = chatId ? chatId.toString() : '';
  const fromUsername = fromObj ? (fromObj.username || '') : '';
  const firstName = fromObj ? (fromObj.first_name || '') : '';
  const lastName = fromObj ? (fromObj.last_name || '') : '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || fromUsername || `Telegram User (${chatIdStr})`;

  let matchedUserId = 'telegram_' + chatIdStr;
  let userEmail = '';
  let userName = fullName;

  if (!getUsersFn) return { matchedUserId, userEmail, userName };

  const users = getUsersFn();
  
  // 1. Try to find user by telegramChatId or telegramUsername
  let foundKey = Object.keys(users).find(key => {
    const u = users[key];
    return u && (
      (u.telegramChatId && u.telegramChatId === chatIdStr) ||
      (fromUsername && u.telegramUsername && u.telegramUsername.toLowerCase() === fromUsername.toLowerCase())
    );
  });

  if (foundKey) {
    // User exists -> update lastActive, chatId, username
    const existing = users[foundKey];
    existing.telegramChatId = chatIdStr;
    if (fromUsername) existing.telegramUsername = fromUsername;
    existing.lastActive = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    
    if (saveUsersFn) saveUsersFn(users, false);

    matchedUserId = existing.id || foundKey;
    userEmail = existing.email || '';
    userName = existing.name || fullName;
  } else {
    // New Telegram user -> Create User Profile automatically in database
    const newUserObj = {
      id: matchedUserId,
      name: fullName,
      email: fromUsername ? `${fromUsername}@telegram.user` : `telegram_${chatIdStr}@telegram.user`,
      role: 'member',
      telegramChatId: chatIdStr,
      telegramUsername: fromUsername,
      verified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    users[matchedUserId] = newUserObj;
    if (saveUsersFn) saveUsersFn(users, true);

    userEmail = newUserObj.email;
    userName = newUserObj.name;
  }

  return { matchedUserId, userEmail, userName };
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

// ─── Helper Response Functions
function sendGreetingMenuCtx(ctx, userName = 'Traveler') {
  const text =
`🤖 *FGTech Travel Expense Bot* ✈️

Namaste *${userName}*! Main aapka travel expense assistant hun.

📝 *Expense Log Karne ke Tarike:*

*One-line (fastest):*
• \`Metro 150\`
• \`Ola 280 Andheri to Bandra\`
• \`Food 120 Lunch\`

*Step-by-step (multi-message):*
1️⃣ Pehle bhejo: \`Uber Andheri\`
2️⃣ Phir amount: \`280\`
3️⃣ Optional: Bill/ticket ki photo bhejo

📸 *Bill Photo ke saath:*
• Photo + caption: \`Local 40\`
• Ya pehle expense bhejo, phir photo bhejo

📊 *Other Commands:*
• \`/summary\` — Monthly total & balance
• \`/history\` — Recent 5 entries
• \`/link user@email.com\` — Web Dashboard account se link karo

🚀 Try karo: *Metro 150*`;

  const opts = { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD };
  if (ctx && ctx.reply) return ctx.reply(text, opts).catch(err => console.warn('Telegram reply error:', err.message));
  if (ctx && ctx.api && ctx.chat) return ctx.api.sendMessage(ctx.chat.id, text, opts).catch(err => console.warn('Telegram send error:', err.message));
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
`📊 *Monthly Travel Summary — ${currentMonth}*

💰 *Total Logged:* ₹${totalLogged.toLocaleString('en-IN')}
✅ *Paid/Settled:* ₹${paidTotal.toLocaleString('en-IN')}
⏳ *Pending Balance:* ₹${pendingTotal.toLocaleString('en-IN')}
🧾 *Total Entries:* ${monthExpenses.length}`;

  const opts = { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD };
  if (ctx && ctx.reply) return ctx.reply(text, opts).catch(err => console.warn('Telegram reply error:', err.message));
  if (ctx && ctx.api && ctx.chat) return ctx.api.sendMessage(ctx.chat.id, text, opts).catch(err => console.warn('Telegram send error:', err.message));
}

function sendHistoryExpensesCtx(ctx, matchedUserId) {
  const allExpenses = getExpensesFn ? getExpensesFn() : [];
  const userExpenses = allExpenses
    .filter(e => e && e.userId === matchedUserId)
    .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0))
    .slice(0, 5);

  const opts = { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD };

  if (userExpenses.length === 0) {
    const emptyMsg = '📂 *Koi entries nahi hain abhi.* Type karo `Metro 150` to start!';
    if (ctx && ctx.reply) return ctx.reply(emptyMsg, opts).catch(err => console.warn('Telegram reply error:', err.message));
    if (ctx && ctx.api && ctx.chat) return ctx.api.sendMessage(ctx.chat.id, emptyMsg, opts).catch(err => console.warn('Telegram send error:', err.message));
  }

  let text = '📜 *Recent 5 Travel Entries:*\n\n';
  userExpenses.forEach((exp, idx) => {
    const emoji = CATEGORY_EMOJIS[exp.location] || '📌';
    const status = exp.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Pending';
    const receipt = (exp.receipts && exp.receipts.length > 0) ? ' 📎' : '';
    text += `${idx + 1}. *${exp.date}* — ${emoji} ${exp.location}${receipt}\n   💰 ₹${exp.total} (${status})\n   📝 ${exp.notes || '—'}\n\n`;
  });

  if (ctx && ctx.reply) return ctx.reply(text.trim(), opts).catch(err => console.warn('Telegram reply error:', err.message));
  if (ctx && ctx.api && ctx.chat) return ctx.api.sendMessage(ctx.chat.id, text.trim(), opts).catch(err => console.warn('Telegram send error:', err.message));
}

function handleLinkEmailCtx(ctx, chatId, emailArg, fromObj) {
  const targetEmail = (emailArg || '').trim().toLowerCase();

  if (!targetEmail || !targetEmail.includes('@')) {
    const msgText = '⚠️ Valid email address required. Example: `/link user@example.com`';
    if (ctx && ctx.reply) return ctx.reply(msgText, { parse_mode: 'Markdown' });
  }

  const chatIdStr = chatId ? chatId.toString() : '';
  const users = getUsersFn ? getUsersFn() : {};
  const foundKey = Object.keys(users).find(k => users[k] && users[k].email && users[k].email.toLowerCase() === targetEmail);

  if (foundKey) {
    const user = users[foundKey];
    user.telegramChatId = chatIdStr;
    if (fromObj && fromObj.username) user.telegramUsername = fromObj.username;
    user.updatedAt = new Date().toISOString();
    user.lastActive = new Date().toISOString();

    if (saveUsersFn) saveUsersFn(users, true);

    const msgText = `✅ *Account Linked Successfully!*\n\nTelegram account is now linked to *${targetEmail}* (${user.name}). All bot expenses will appear on your Web Dashboard!`;
    const opts = { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD };
    if (ctx && ctx.reply) return ctx.reply(msgText, opts).catch(err => console.warn('Telegram reply error:', err.message));
    if (ctx && ctx.api && ctx.chat) return ctx.api.sendMessage(ctx.chat.id, msgText, opts).catch(err => console.warn('Telegram send error:', err.message));
  } else {
    const msgText = `⚠️ Account *${targetEmail}* Web App pe nahi mila. Pehle Web Dashboard pe registration/login karein, phir \`/link ${targetEmail}\` command chalaayein.`;
    const opts = { parse_mode: 'Markdown' };
    if (ctx && ctx.reply) return ctx.reply(msgText, opts).catch(err => console.warn('Telegram reply error:', err.message));
    if (ctx && ctx.api && ctx.chat) return ctx.api.sendMessage(ctx.chat.id, msgText, opts).catch(err => console.warn('Telegram send error:', err.message));
  }
}

/**
 * Main Telegram Bot Initialization
 */
function startTelegramBot(callbacks = {}) {
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
      console.warn('⚠️ Telegram bot error:', err && (err.message || err));
    });

    // ── Command: /start, /help, /menu
    bot.command(['start', 'help', 'menu'], async (ctx) => {
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      const { userName } = ensureUserProfile(chatId, ctx.from);
      return sendGreetingMenuCtx(ctx, userName);
    });

    // ── Command: /summary, /total, /balance
    bot.command(['summary', 'total', 'balance'], async (ctx) => {
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      const { matchedUserId } = ensureUserProfile(chatId, ctx.from);
      return sendMonthlySummaryCtx(ctx, matchedUserId);
    });

    // ── Command: /history, /recent, /list
    bot.command(['history', 'recent', 'list'], async (ctx) => {
      const chatId = ctx.chat ? ctx.chat.id : (ctx.message ? ctx.message.chat.id : 0);
      const { matchedUserId } = ensureUserProfile(chatId, ctx.from);
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
      const { matchedUserId, userName } = ensureUserProfile(chatId, ctx.from);

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

      // Ensure Profile created/updated
      const { matchedUserId, userEmail, userName } = ensureUserProfile(chatId, ctx.from || msg.from);

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

    bot.startPolling();
    return bot;
  } catch (err) {
    console.error('❌ Error starting Telegram Bot:', err.message);
    return null;
  }
}

module.exports = { startTelegramBot };
