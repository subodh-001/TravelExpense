/**
 * Telegram Travel Expense Bot Integration
 * 100% Free, Zero Expiry, Instant Polling Engine
 * Complete Feature Parity with WhatsApp Bot & Multi-Step Conversational State
 */

const { Bot } = require('node-telegram-bot-api');
const { parseExpenseMessage } = require('./whatsapp-bot');

let bot = null;
let getExpensesFn = null;
let saveExpensesFn = null;
let getUsersFn = null;
let saveDbFn = null;
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
    [{ text: '📊 View Summary', callback_data: 'cmd_summary' }, { text: '📜 Recent History', callback_data: 'cmd_history' }],
    [{ text: '❓ Help & Menu', callback_data: 'cmd_help' }]
  ]
};

/**
 * Main Telegram Bot Initialization
 */
function startTelegramBot(callbacks = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  getExpensesFn = callbacks.getLocalExpenses;
  saveExpensesFn = callbacks.saveLocalExpenses;
  getUsersFn = callbacks.getLocalUsers;
  saveDbFn = callbacks.saveExpenseToDb;

  if (!token) {
    console.log('ℹ️ Telegram Bot Token not found in TELEGRAM_BOT_TOKEN environment variable. Telegram bot is currently idle.');
    return null;
  }

  try {
    bot = new Bot(token);
    console.log('🤖 Telegram Travel Expense Bot CONNECTED & ONLINE! (@FreegTravel_bot) 🚀');

    // Command: /start
    bot.command('start', async (ctx) => {
      await sendGreetingMenu(ctx);
    });

    // Command: /help or /menu
    bot.command(['help', 'menu'], async (ctx) => {
      await sendGreetingMenu(ctx);
    });

    // Command: /summary
    bot.command(['summary', 'total', 'balance'], async (ctx) => {
      await sendMonthlySummary(ctx);
    });

    // Command: /history or /recent
    bot.command(['history', 'recent', 'list'], async (ctx) => {
      await sendHistoryExpenses(ctx);
    });

    // Command: /link <email>
    bot.command('link', async (ctx) => {
      const rawText = ctx.message ? ctx.message.text : '';
      const parts = rawText.split(/\s+/);
      const targetEmail = (parts[1] || '').trim().toLowerCase();
      await handleLinkEmail(ctx, targetEmail);
    });

    // Handle Callback Query (Inline Keyboard Buttons)
    bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery ? ctx.callbackQuery.data : null;
      if (data === 'cmd_summary') {
        await sendMonthlySummary(ctx);
      } else if (data === 'cmd_history' || data === 'cmd_recent') {
        await sendHistoryExpenses(ctx);
      } else if (data === 'cmd_help') {
        await sendGreetingMenu(ctx);
      }
      try {
        await ctx.answerCallbackQuery();
      } catch (_) {}
    });

    // Handle All Messages (Text, Greetings, Step-by-Step Multi-Message Entries, Photos)
    bot.on('message', async (ctx) => {
      const msg = ctx.message;
      if (!msg) return;

      const textOnly = (msg.text || msg.caption || '').trim();
      const isPhoto = msg.photo && msg.photo.length > 0;

      // Handle Slash Commands handled by command listeners above
      if (textOnly && textOnly.startsWith('/') && !textOnly.startsWith('/link')) return;

      const telegramUserId = ctx.from ? ctx.from.id.toString() : '';

      // Match linked user by telegramChatId or username
      let matchedUserId = 'telegram_' + telegramUserId;
      let userEmail = '';

      if (getUsersFn) {
        const users = getUsersFn();
        let found = Object.values(users).find(u => u && (
          (u.telegramChatId && u.telegramChatId === telegramUserId) ||
          (ctx.from && ctx.from.username && u.telegramUsername === ctx.from.username)
        ));

        // Default fallback to admin Subodh Ram (subodhram3350@gmail.com)
        if (!found) {
          found = Object.values(users).find(u => u && u.email && u.email.toLowerCase() === 'subodhram3350@gmail.com') || {
            id: 'google_subodhram3350_gmail_com',
            name: 'Subodh Ram',
            email: 'subodhram3350@gmail.com'
          };
        }

        if (found) {
          matchedUserId = found.id || `google_${found.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
          userEmail = found.email;
        }
      }

      // Handle Photo Attachments
      let receiptUrl = null;
      if (isPhoto) {
        try {
          const photoFile = msg.photo[msg.photo.length - 1]; // highest resolution
          if (ctx.api && ctx.api.getFile) {
            const fileInfo = await ctx.api.getFile(photoFile.file_id);
            if (fileInfo && fileInfo.file_path) {
              receiptUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
            }
          }
        } catch (pErr) {
          console.warn('⚠️ Could not fetch Telegram photo file path:', pErr.message);
        }
      }

      const now = Date.now();
      const userContext = userContextStore.get(matchedUserId);

      // Parse text for expense or command
      const parsed = parseExpenseMessage(textOnly);

      // CASE A: Photo sent WITHOUT expense text
      if (isPhoto && receiptUrl && (!parsed || parsed.isCommand)) {
        // Sub-case A1: User logged a text expense entry in the last 3 minutes
        if (userContext && userContext.lastExpenseObj && (now - userContext.timestamp < 180000)) {
          const targetExp = userContext.lastExpenseObj;
          if (!targetExp.receipts) targetExp.receipts = [];
          targetExp.receipts.push(receiptUrl);

          if (saveExpensesFn) {
            const expenses = getExpensesFn ? getExpensesFn() : [];
            const idx = expenses.findIndex(e => e.id === targetExp.id);
            if (idx !== -1) {
              expenses[idx] = targetExp;
              saveExpensesFn(expenses, true);
            }
          }
          userContextStore.delete(matchedUserId);

          const attachText = 
`📎 *Receipt Photo Attached to Recent Entry!*

📅 *Date:* ${targetExp.date}
📌 *Category:* ${targetExp.location}
💰 *Amount:* ₹${targetExp.total.toLocaleString('en-IN')}
📝 *Notes:* ${targetExp.notes}`;

          return ctx.reply(attachText, { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD })
            .catch(err => console.warn('⚠️ Telegram reply error:', err.message));
        } else {
          // Sub-case A2: Store pending photo for next text message
          const draftCat = userContext ? userContext.draftCategory : null;
          const draftNot = userContext ? userContext.draftNotes : null;

          userContextStore.set(matchedUserId, {
            pendingReceiptUrl: receiptUrl,
            draftCategory: draftCat,
            draftNotes: draftNot,
            timestamp: now
          });

          return ctx.reply('📸 *Receipt Photo Received!* Now send travel amount or details (e.g. `Metro 150` or `280`) to complete 1 single entry.', { parse_mode: 'Markdown' })
            .catch(err => console.warn('⚠️ Telegram reply error:', err.message));
        }
      }

      // CASE B: Commands like "hi", "hello", "summary", "history", "link"
      if (parsed && parsed.isCommand) {
        if (parsed.command === 'help') {
          return sendGreetingMenu(ctx);
        }
        if (parsed.command === 'summary') {
          return sendMonthlySummary(ctx);
        }
        if (parsed.command === 'history') {
          return sendHistoryExpenses(ctx);
        }
        if (parsed.command === 'link') {
          return handleLinkEmail(ctx, parsed.arg);
        }
      }

      // CASE C: Partial Text Entry (User sent location/category text like "Uber Andheri" WITHOUT price yet)
      if (parsed && !parsed.isCommand && parsed.isPartial) {
        const pendingUrl = receiptUrl || (userContext ? userContext.pendingReceiptUrl : null);

        userContextStore.set(matchedUserId, {
          draftCategory: parsed.category,
          draftNotes: parsed.comment,
          pendingReceiptUrl: pendingUrl,
          timestamp: now
        });

        const emoji = CATEGORY_EMOJIS[parsed.category] || '📌';
        return ctx.reply(`📍 *Recorded Travel Details:* ${parsed.comment}\n${emoji} *Category:* ${parsed.category}\n\n💬 Ab amount bhejein (e.g. *280*) to complete this single expense entry!`, { parse_mode: 'Markdown' })
          .catch(err => console.warn('⚠️ Telegram reply error:', err.message));
      }

      // CASE D: Complete Valid Expense Entry (e.g. "150", "Metro 150", "Uber 280 Andheri")
      if (parsed && !parsed.isCommand && parsed.amount > 0) {
        let finalCategory = parsed.category;
        let finalNotes = parsed.comment;
        let finalReceipts = receiptUrl ? [receiptUrl] : [];

        // Check if there was a previous draft (location/category or pending photo <5 min old)
        if (userContext && (now - userContext.timestamp < 300000)) {
          if (userContext.draftCategory && userContext.draftCategory !== 'Others') {
            finalCategory = userContext.draftCategory;
          }
          if (userContext.draftNotes && userContext.draftNotes !== parsed.comment) {
            finalNotes = `${userContext.draftNotes} (${parsed.comment})`;
          }
          if (!receiptUrl && userContext.pendingReceiptUrl) {
            finalReceipts.push(userContext.pendingReceiptUrl);
          }
          userContextStore.delete(matchedUserId);
        }

        const expenseDate = parsed.dateStr || new Date().toISOString().slice(0, 10);
        const expenseId = `exp_tg_${Date.now().toString(36)}`;

        const newExpense = {
          id: expenseId,
          userId: matchedUserId,
          date: expenseDate,
          location: finalCategory,
          notes: finalNotes || finalCategory,
          paymentStatus: 'pending',
          entries: [{ type: finalCategory, amount: parsed.amount }],
          total: parsed.amount,
          receipts: finalReceipts,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'Telegram Bot'
        };

        if (saveDbFn) {
          try {
            await saveDbFn(newExpense);
          } catch (dbErr) {
            console.warn('⚠️ Error persisting Telegram expense to Firestore:', dbErr.message);
          }
        } else if (getExpensesFn && saveExpensesFn) {
          const expenses = getExpensesFn();
          expenses.unshift(newExpense);
          saveExpensesFn(expenses, true);
        }

        userContextStore.set(matchedUserId, { lastExpenseObj: newExpense, timestamp: now });

        const emoji = CATEGORY_EMOJIS[finalCategory] || '📌';
        const photoTag = finalReceipts.length > 0 ? '\n📎 *Receipt Photo Attached!*' : '';

        const confirmText = 
`✅ *Travel Expense Logged Successfully!*

📅 *Date:* ${expenseDate}
${emoji} *Category:* ${finalCategory}
💰 *Amount:* ₹${parsed.amount.toLocaleString('en-IN')}
📝 *Notes:* ${finalNotes}${photoTag}
${userEmail ? `👤 *Account:* ${userEmail}` : '👤 *Account:* Telegram (Use `/link email` to sync with Web Dashboard)'}`;

        return ctx.reply(confirmText, {
          parse_mode: 'Markdown',
          reply_markup: MAIN_KEYBOARD
        }).catch(err => console.warn('⚠️ Telegram reply error:', err.message));
      }

      // CASE E: Unrecognized text (Greetings or help)
      if (textOnly && !textOnly.startsWith('/')) {
        await sendGreetingMenu(ctx);
      }
    });

    bot.startPolling();
    return bot;
  } catch (err) {
    console.error('❌ Error starting Telegram Bot:', err.message);
    return null;
  }
}

/**
 * Send Greeting & Help Menu (Triggers on "hi", "hello", "help", /start)
 */
async function sendGreetingMenu(ctx) {
  const firstName = ctx.from ? ctx.from.first_name : 'Traveler';
  const replyMenu = 
`🤖 *FGTech Travel Expense Bot* ✈️

Namaste *${firstName}*! Main aapka automated travel expense assistant hu. System me travel entry log karne ke liye seedhe mujhe message bhej sakte hain!

📝 *Kaise Log Karein:*
• Send: \`Metro 150\`
• Send step-by-step: Send \`Uber Andheri\` first ➔ then send \`280\`
• Send: \`Food 120 Lunch at station\`
• Ticket / Bill ki *Photo* caption me \`Local 40\` likh kar bhejein

📊 *Other Commands:*
• \`summary\` - Monthly balance & total check karein
• \`history\` - Recent 5 entries dekhein
• \`link <email>\` - Telegram ko app email account se link karein

Try karein! Abhi type karein: *Metro 150* 🚀`;

  await ctx.reply(replyMenu, {
    parse_mode: 'Markdown',
    reply_markup: MAIN_KEYBOARD
  }).catch(_ => {});
}

/**
 * Handle Link Email
 */
async function handleLinkEmail(ctx, emailArg) {
  const targetEmail = (emailArg || '').trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes('@')) {
    return ctx.reply('⚠️ Please provide a valid email address. Example: `/link user@example.com`', { parse_mode: 'Markdown' });
  }

  const telegramUserId = ctx.from ? ctx.from.id.toString() : '';
  const users = getUsersFn ? getUsersFn() : {};
  let foundKey = Object.keys(users).find(k => users[k] && users[k].email && users[k].email.toLowerCase() === targetEmail);

  if (foundKey && saveExpensesFn) {
    users[foundKey].telegramChatId = telegramUserId;
    users[foundKey].telegramUsername = ctx.from ? ctx.from.username || '' : '';
    users[foundKey].updatedAt = new Date().toISOString();
    saveExpensesFn([], false); // triggers backup
    await ctx.reply(`✅ Success! Telegram account linked to account *${targetEmail}*. All expenses logged here will reflect on your Web Dashboard!`, { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(`⚠️ User account *${targetEmail}* not found on Web App. Please log in on the Web App first, then link here.`, { parse_mode: 'Markdown' });
  }
}

/**
 * Send Monthly Summary
 */
async function sendMonthlySummary(ctx) {
  const telegramUserId = ctx.from ? ctx.from.id.toString() : '';
  const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
  const allExpenses = getExpensesFn ? getExpensesFn() : [];
  
  const userExpenses = allExpenses.filter(e => e && (
    e.userId === 'telegram_' + telegramUserId ||
    (e.source === 'Telegram Bot')
  ));

  const monthExpenses = userExpenses.filter(e => e.date && e.date.startsWith(currentMonth));
  const totalLogged = monthExpenses.reduce((s, e) => s + (e.total || 0), 0);
  const paidTotal = monthExpenses.filter(e => e.paymentStatus === 'paid').reduce((s, e) => s + (e.total || 0), 0);
  const pendingTotal = monthExpenses.filter(e => e.paymentStatus !== 'paid').reduce((s, e) => s + (e.total || 0), 0);

  const summaryMsg = 
`📊 *Monthly Travel Summary (${currentMonth})*

💰 *Total Logged:* ₹${totalLogged.toLocaleString('en-IN')}
✅ *Paid/Settled:* ₹${paidTotal.toLocaleString('en-IN')}
⏳ *Pending Balance:* ₹${pendingTotal.toLocaleString('en-IN')}
🧾 *Total Entries:* ${monthExpenses.length} entries`;

  await ctx.reply(summaryMsg, { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD }).catch(_ => {});
}

/**
 * Send History Expenses (Last 5 Entries)
 */
async function sendHistoryExpenses(ctx) {
  const telegramUserId = ctx.from ? ctx.from.id.toString() : '';
  const allExpenses = getExpensesFn ? getExpensesFn() : [];
  const userExpenses = allExpenses.filter(e => e && (
    e.userId === 'telegram_' + telegramUserId ||
    (e.source === 'Telegram Bot')
  )).slice(0, 5);

  if (userExpenses.length === 0) {
    return ctx.reply('📂 *No travel entries logged yet.* Try typing `Metro 150`!', { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD }).catch(_ => {});
  }

  let text = '📜 *Your Recent 5 Travel Entries:*\n\n';
  userExpenses.forEach((exp, idx) => {
    const cat = exp.entries && exp.entries[0] ? exp.entries[0].type : exp.location;
    const status = exp.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Pending';
    text += `${idx + 1}. *${exp.date}* — ${cat}\n   💰 ₹${exp.total} (${status})\n   📝 ${exp.notes || 'No comment'}\n\n`;
  });

  await ctx.reply(text.trim(), { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD }).catch(_ => {});
}

module.exports = {
  startTelegramBot
};
