/**
 * Telegram Travel Expense Bot Integration
 * 100% Free, Zero Expiry, Instant Polling Engine
 * Uses node-telegram-bot-api (grammY-style ctx API)
 */

const { Bot } = require('node-telegram-bot-api');
const { parseExpenseMessage } = require('./whatsapp-bot');

let bot = null;
let getExpensesFn = null;
let saveExpensesFn = null;
let getUsersFn = null;
let saveDbFn = null;
let uploadCloudinaryFn = null;

// Context store: maps matchedUserId -> { lastExpenseObj, pendingReceiptUrl, draftCategory, draftNotes, timestamp }
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

// ─── Helper: resolve a telegram chatId → { matchedUserId, userEmail, userName }
function resolveUser(chatId, fromUsername) {
  let matchedUserId = 'telegram_' + chatId;
  let userEmail = '';
  let userName = '';

  if (!getUsersFn) return { matchedUserId, userEmail, userName };

  const users = getUsersFn();
  let found = Object.values(users).find(u =>
    u && (
      (u.telegramChatId && u.telegramChatId === chatId.toString()) ||
      (fromUsername && u.telegramUsername && u.telegramUsername === fromUsername)
    )
  );

  if (!found) {
    // Fallback: default admin account (Subodh Ram)
    found = Object.values(users).find(u => u && u.email && u.email.toLowerCase() === 'subodhram3350@gmail.com')
      || { id: 'google_subodhram3350_gmail_com', name: 'Subodh Ram', email: 'subodhram3350@gmail.com' };
  }

  if (found) {
    matchedUserId = found.id || `google_${found.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    userEmail = found.email || '';
    userName = found.name || '';
  }

  return { matchedUserId, userEmail, userName };
}

// ─── Helper: download & upload photo, return permanent URL
async function handlePhotoUpload(fileId, ctx) {
  try {
    const fileInfo = await ctx.api.getFile(fileId);
    if (!fileInfo || !fileInfo.file_path) return null;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const fileLink = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;

    // Try to download buffer
    const photoRes = await fetch(fileLink);
    if (!photoRes.ok) return fileLink;

    const arrayBuf = await photoRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // Try Cloudinary first
    if (uploadCloudinaryFn) {
      try {
        const cloudUrl = await uploadCloudinaryFn(buffer, 'image/jpeg', 'telegram_receipts');
        console.log(`☁️ Telegram receipt uploaded to Cloudinary: ${cloudUrl}`);
        return cloudUrl;
      } catch (cloudErr) {
        console.warn('⚠️ Cloudinary upload warning:', cloudErr.message);
      }
    }

    // Fallback: Base64 (stored in DB, always retrievable)
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
  if (saveDbFn) {
    try {
      await saveDbFn(expense);
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

/**
 * Main Telegram Bot Initialization
 */
function startTelegramBot(callbacks = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  getExpensesFn = callbacks.getLocalExpenses;
  saveExpensesFn = callbacks.saveLocalExpenses;
  getUsersFn = callbacks.getLocalUsers;
  saveDbFn = callbacks.saveExpenseToDb;
  uploadCloudinaryFn = callbacks.uploadToCloudinary;

  if (!token) {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN not set. Telegram bot is idle.');
    return null;
  }

  try {
    bot = new Bot(token);
    console.log('🤖 Telegram Travel Expense Bot CONNECTED & ONLINE! (@FreegTravel_bot) 🚀');

    // ── /start, /help, /menu
    bot.command('start', async (ctx) => handleGreetingCtx(ctx));
    bot.command('help', async (ctx) => handleGreetingCtx(ctx));
    bot.command('menu', async (ctx) => handleGreetingCtx(ctx));

    // ── /summary, /total, /balance
    bot.command(['summary', 'total', 'balance'], async (ctx) => handleMonthlySummaryCtx(ctx));

    // ── /history, /recent, /list
    bot.command(['history', 'recent', 'list'], async (ctx) => handleHistoryCtx(ctx));

    // ── /link <email>
    bot.command('link', async (ctx) => {
      const text = ctx.message ? ctx.message.text : '';
      const parts = text.split(/\s+/);
      const email = (parts[1] || '').trim().toLowerCase();
      await handleLinkCtx(ctx, email);
    });

    // ── Inline keyboard button callbacks
    bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery ? ctx.callbackQuery.data : null;
      try { await ctx.answerCallbackQuery(); } catch (_) {}
      if (data === 'cmd_summary') return handleMonthlySummaryCtx(ctx);
      if (data === 'cmd_history') return handleHistoryCtx(ctx);
      if (data === 'cmd_help') return handleGreetingCtx(ctx);
    });

    // ── All text + photo messages
    bot.on('message', async (ctx) => {
      const msg = ctx.message;
      if (!msg || !msg.chat) return;

      const chatId = msg.chat.id;
      const textOnly = (msg.text || msg.caption || '').trim();
      const isPhoto = !!(msg.photo && msg.photo.length > 0);

      // Skip slash commands (handled above by bot.command)
      if (textOnly && textOnly.startsWith('/')) return;

      const { matchedUserId, userEmail } = resolveUser(chatId, ctx.from && ctx.from.username);

      // ── Photo handling: download & upload permanently
      let receiptUrl = null;
      if (isPhoto) {
        const largestPhoto = msg.photo[msg.photo.length - 1];
        receiptUrl = await handlePhotoUpload(largestPhoto.file_id, ctx);
      }

      const now = Date.now();
      const userContext = userContextStore.get(matchedUserId);

      // ── Parse text content
      const parsed = textOnly ? parseExpenseMessage(textOnly) : null;

      // ══════════════════════════════════════════════════
      // CASE A: Photo-only message (no expense amount in caption)
      // ══════════════════════════════════════════════════
      if (isPhoto && receiptUrl && (!parsed || parsed.isCommand)) {
        if (userContext && userContext.lastExpenseObj && (now - userContext.timestamp < 300000)) {
          // Attach photo to the LAST logged expense (within 5 min)
          const targetExp = userContext.lastExpenseObj;
          if (!targetExp.receipts) targetExp.receipts = [];
          if (!targetExp.receipts.includes(receiptUrl)) {
            targetExp.receipts.push(receiptUrl);
          }
          targetExp.paymentBillUrl = receiptUrl;
          targetExp.updatedAt = new Date().toISOString();

          await persistExpense(targetExp);
          userContextStore.delete(matchedUserId);

          const text =
`📎 *Receipt Photo Attached!*

📅 *Date:* ${targetExp.date}
${CATEGORY_EMOJIS[targetExp.location] || '📌'} *Category:* ${targetExp.location}
💰 *Amount:* ₹${(targetExp.total || 0).toLocaleString('en-IN')}
📝 *Notes:* ${targetExp.notes}
✅ *Entry updated in Dashboard!*`;

          return ctx.reply(text, { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD })
            .catch(err => console.warn('Telegram send error:', err.message));

        } else if (userContext && userContext.draftCategory && (now - userContext.timestamp < 300000)) {
          userContextStore.set(matchedUserId, { ...userContext, pendingReceiptUrl: receiptUrl, timestamp: now });
          return ctx.reply(
            '📸 *Receipt photo saved!* Ab amount bhejein (e.g. `280`) to complete the entry.',
            { parse_mode: 'Markdown' }
          ).catch(err => console.warn('Telegram send error:', err.message));

        } else {
          userContextStore.set(matchedUserId, { pendingReceiptUrl: receiptUrl, timestamp: now });
          return ctx.reply(
            '📸 *Receipt photo received!* Ab travel details aur amount bhejein (e.g. `Metro 150`) to log the expense.',
            { parse_mode: 'Markdown' }
          ).catch(err => console.warn('Telegram send error:', err.message));
        }
      }

      // ══════════════════════════════════════════════════
      // CASE B: Text/caption is a command (help, summary, history)
      // ══════════════════════════════════════════════════
      if (parsed && parsed.isCommand) {
        if (parsed.command === 'help') return handleGreetingCtx(ctx);
        if (parsed.command === 'summary') return handleMonthlySummaryCtx(ctx);
        if (parsed.command === 'history') return handleHistoryCtx(ctx);
        if (parsed.command === 'link') return handleLinkCtx(ctx, parsed.arg);
      }

      // ══════════════════════════════════════════════════
      // CASE C: Partial text — location/category but NO amount yet
      // ══════════════════════════════════════════════════
      if (parsed && !parsed.isCommand && parsed.isPartial) {
        const pendingUrl = receiptUrl || (userContext ? userContext.pendingReceiptUrl : null);
        userContextStore.set(matchedUserId, {
          draftCategory: parsed.category,
          draftNotes: parsed.comment,
          pendingReceiptUrl: pendingUrl,
          timestamp: now
        });
        const emoji = CATEGORY_EMOJIS[parsed.category] || '📌';
        return ctx.reply(
          `📍 *Location recorded:* ${parsed.comment}\n${emoji} *Category:* ${parsed.category}\n\n💬 Ab amount bhejein (e.g. \`280\`) to complete this entry!`,
          { parse_mode: 'Markdown' }
        ).catch(err => console.warn('Telegram send error:', err.message));
      }

      // ══════════════════════════════════════════════════
      // CASE D: Full expense entry — has amount
      // ══════════════════════════════════════════════════
      if (parsed && !parsed.isCommand && parsed.amount > 0) {
        let finalCategory = parsed.category;
        let finalNotes = parsed.comment || parsed.category;
        let finalReceipts = receiptUrl ? [receiptUrl] : [];

        // Merge previous draft context
        if (userContext && (now - userContext.timestamp < 300000)) {
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
        userContextStore.set(matchedUserId, { lastExpenseObj: newExpense, timestamp: now });

        const emoji = CATEGORY_EMOJIS[finalCategory] || '📌';
        const photoTag = finalReceipts.length > 0 ? '\n📎 *Receipt attached!*' : '\n💡 _Bill/ticket photo hai toh abhi bhej sakte ho!_';

        const confirmText =
`✅ *Travel Expense Logged Successfully!*

📅 *Date:* ${expenseDate}
${emoji} *Category:* ${finalCategory}
💰 *Amount:* ₹${parsed.amount.toLocaleString('en-IN')}
📝 *Notes:* ${finalNotes}${photoTag}
👤 *Account:* ${userEmail || 'subodhram3350@gmail.com'}`;

        return ctx.reply(confirmText, {
          parse_mode: 'Markdown',
          reply_markup: MAIN_KEYBOARD
        }).catch(err => console.warn('Telegram send error:', err.message));
      }

      // ══════════════════════════════════════════════════
      // CASE E: Unrecognized / greeting text → show help
      // ══════════════════════════════════════════════════
      if (textOnly) {
        return handleGreetingCtx(ctx);
      }
    });

    bot.catch((err) => {
      console.warn('⚠️ Telegram bot error:', err && (err.message || err));
    });

    bot.startPolling();
    return bot;
  } catch (err) {
    console.error('❌ Error starting Telegram Bot:', err.message);
    return null;
  }
}


// ─── ctx → msg adapter helpers (ctx wraps msg for command handlers)
function ctxToMsg(ctx) {
  return {
    chat: ctx.chat || (ctx.message && ctx.message.chat) || { id: 0 },
    from: ctx.from || (ctx.message && ctx.message.from) || {}
  };
}
async function handleGreetingCtx(ctx) { return handleGreetingMenu(ctxToMsg(ctx), ctx); }
async function handleMonthlySummaryCtx(ctx) { return handleMonthlySummary(ctxToMsg(ctx), ctx); }
async function handleHistoryCtx(ctx) { return handleHistoryExpenses(ctxToMsg(ctx), ctx); }
async function handleLinkCtx(ctx, email) { return handleLinkEmail(ctxToMsg(ctx), email, ctx); }

// ─── Send Greeting Menu
async function handleGreetingMenu(msg, ctx) {
  const firstName = (msg.from && msg.from.first_name) ? msg.from.first_name : 'Traveler';

  const text =
`🤖 *FGTech Travel Expense Bot* ✈️

Namaste *${firstName}*! Main aapka travel expense assistant hun.

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
• \`summary\` — Monthly total & balance
• \`history\` — Recent 5 entries
• \`/link user@email.com\` — Web Dashboard se link karo

🚀 Try karo: *Metro 150*`;

  const opts = { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD };
  if (ctx && ctx.reply) return ctx.reply(text, opts).catch(_ => {});
  return bot.api.sendMessage(msg.chat.id, text, opts).catch(_ => {});
}

// ─── Monthly Summary
async function handleMonthlySummary(msg, ctx) {
  const telegramId = msg.from ? msg.from.id.toString() : '';
  const chatId = msg.chat.id;
  const { matchedUserId } = resolveUser(chatId, msg.from && msg.from.username);

  const currentMonth = new Date().toISOString().substring(0, 7);
  const allExpenses = getExpensesFn ? getExpensesFn() : [];

  const userExpenses = allExpenses.filter(e =>
    e && (e.userId === matchedUserId || e.userId === `telegram_${telegramId}`)
  );

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
  if (ctx && ctx.reply) return ctx.reply(text, opts).catch(_ => {});
  return bot.api.sendMessage(chatId, text, opts).catch(_ => {});
}

// ─── Last 5 Expense Entries
async function handleHistoryExpenses(msg, ctx) {
  const telegramId = msg.from ? msg.from.id.toString() : '';
  const chatId = msg.chat.id;
  const { matchedUserId } = resolveUser(chatId, msg.from && msg.from.username);

  const allExpenses = getExpensesFn ? getExpensesFn() : [];
  const userExpenses = allExpenses
    .filter(e => e && (e.userId === matchedUserId || e.userId === `telegram_${telegramId}`))
    .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0))
    .slice(0, 5);

  const opts = { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD };

  if (userExpenses.length === 0) {
    const emptyMsg = '📂 *Koi entries nahi hain abhi.* Type karo `Metro 150` to start!';
    if (ctx && ctx.reply) return ctx.reply(emptyMsg, opts).catch(_ => {});
    return bot.api.sendMessage(chatId, emptyMsg, opts).catch(_ => {});
  }

  let text = '📜 *Recent 5 Travel Entries:*\n\n';
  userExpenses.forEach((exp, idx) => {
    const emoji = CATEGORY_EMOJIS[exp.location] || '📌';
    const status = exp.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Pending';
    const receipt = (exp.receipts && exp.receipts.length > 0) ? ' 📎' : '';
    text += `${idx + 1}. *${exp.date}* — ${emoji} ${exp.location}${receipt}\n   💰 ₹${exp.total} (${status})\n   📝 ${exp.notes || '—'}\n\n`;
  });

  if (ctx && ctx.reply) return ctx.reply(text.trim(), opts).catch(_ => {});
  return bot.api.sendMessage(chatId, text.trim(), opts).catch(_ => {});
}

// ─── Link Telegram to Web App Email Account
async function handleLinkEmail(msg, emailArg, ctx) {
  const chatId = msg.chat.id;
  const targetEmail = (emailArg || '').trim().toLowerCase();

  const send = (text, opts) => {
    if (ctx && ctx.reply) return ctx.reply(text, opts || {}).catch(_ => {});
    return bot.api.sendMessage(chatId, text, opts || {}).catch(_ => {});
  };

  if (!targetEmail || !targetEmail.includes('@')) {
    return send('⚠️ Valid email chahiye. Example: `/link user@example.com`', { parse_mode: 'Markdown' });
  }

  const telegramId = msg.from ? msg.from.id.toString() : '';
  const users = getUsersFn ? getUsersFn() : {};
  const foundKey = Object.keys(users).find(k => users[k] && users[k].email && users[k].email.toLowerCase() === targetEmail);

  if (foundKey) {
    users[foundKey].telegramChatId = telegramId;
    users[foundKey].telegramUsername = msg.from ? (msg.from.username || '') : '';
    users[foundKey].updatedAt = new Date().toISOString();

    if (saveExpensesFn) {
      const expenses = getExpensesFn ? getExpensesFn() : [];
      saveExpensesFn(expenses, true);
    }

    return send(
      `✅ *Linked!* Telegram account linked to *${targetEmail}*.\n\nAb sab expenses Web Dashboard pe bhi dikhenge!`,
      { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD }
    );
  } else {
    return send(
      `⚠️ Account *${targetEmail}* Web App pe nahi mila. Pehle Web App pe login karo, phir link karo.`,
      { parse_mode: 'Markdown' }
    );
  }
}

module.exports = { startTelegramBot };

