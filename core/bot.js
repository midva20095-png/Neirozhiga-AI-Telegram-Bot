require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const db = require('./db');
const catalog = require('./catalog');
const gen = require('./generate');
const auth = require('./auth');
const transferApi = require('./transfer');

const bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: 300000 });

const userAwaitingEmail = new Map();
const userAwaitingSupport = new Map();
const mediaGroupBuffers = new Map();
const userPendingRatio = new Map();
const userTransfer = new Map();

const MENU_TEXTS = [
    '📱 Кабинет',
    '✨ Модель', '🤖 Модель', '🤖 Выбрать модель ИИ', '🤖 Сменить модель', '🤖 Модели',
    '💳 Мой баланс', '💳 Баланс',
    '💰 Пополнить', '💰 Пополнить баланс', '➕ Пополнить',
    '↗️ На сайт', 'На сайт',
    '💬 Поддержка', 'ℹ Справка', 'ℹ️ Справка', '❓ Справка'
];

bot.catch((err, ctx) => {
    console.error(`⚠️ Ошибка в Telegraf для ${ctx?.updateType || 'события'}:`, err.message);
});

bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) {
        try { await db.touchUser(ctx.from.id, ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name); } catch (e) {}
    }
    return next();
});

function baseWebappUrl() {
    return (process.env.WEBAPP_URL || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app').replace(/\/$/, '');
}

// Кнопка web_app в обычной клавиатуре открывает Mini App с пустым initData,
// поэтому для надёжного определения пользователя подписываем id и кладём в ссылку.
function webappUrlFor(userId) {
    return `${baseWebappUrl()}/?v=10#tk=${auth.signUserId(userId)}`;
}

function mainKeyboard(userId) {
    return Markup.keyboard([
        [Markup.button.webApp('📱 Кабинет', webappUrlFor(userId))],
        ['✨ Модель', '💳 Баланс'],
        ['➕ Пополнить', '↗️ На сайт'],
        ['💬 Поддержка', '❓ Справка']
    ]).resize().persistent().placeholder('Напишите запрос или пришлите фото');
}

function amountKeyboard(balance) {
    const presets = [50, 100, 300, 500, 1000, 2500].filter(n => n < balance);
    const rows = [];
    for (let i = 0; i < presets.length; i += 3) {
        rows.push(presets.slice(i, i + 3).map(n => Markup.button.callback(`${n} кр`, `transfer_amt_${n}`)));
    }
    rows.push([Markup.button.callback(`Весь баланс · ${balance} кр`, 'transfer_amt_all')]);
    rows.push([Markup.button.callback('Отмена', 'transfer_cancel')]);
    return Markup.inlineKeyboard(rows);
}

function confirmKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('✅ Перенести', 'transfer_yes'), Markup.button.callback('Отмена', 'transfer_cancel')]
    ]);
}

async function beginTransfer(ctx) {
    userAwaitingEmail.delete(ctx.from.id);
    userAwaitingSupport.delete(ctx.from.id);
    userPendingRatio.delete(ctx.from.id);
    const balance = await getUserBalance(ctx.from.id);
    userTransfer.set(ctx.from.id, { step: 'email' });
    const site = catalog.getGeneral().site_url || 'сайт';
    await ctx.reply(
        `↗️ Перенос на сайт\n\n` +
        `Кредиты на сайте привязаны к почте, с которой вы входите в кабинет (${site}).\n\n` +
        `В боте сейчас: ${balance} кр.\n\n` +
        `Напишите эту почту:`,
        Markup.inlineKeyboard([[Markup.button.callback('Отмена', 'transfer_cancel')]])
    );
}

async function handleTransferText(ctx, text) {
    const userId = ctx.from.id;
    const state = userTransfer.get(userId);
    if (!state) return;
    if (state.step === 'email') {
        const email = text.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            await ctx.reply('Это не похоже на почту. Напишите адрес, с которым входите на сайте, например name@mail.ru');
            return;
        }
        const balance = await getUserBalance(userId);
        if (balance <= 0) {
            userTransfer.delete(userId);
            await ctx.reply('На балансе 0 кредитов. Сначала пополните его, потом перенесите на сайт.', mainKeyboard(userId));
            return;
        }
        state.email = email;
        state.step = 'amount';
        await ctx.reply(
            `Почта на сайте: ${email}\nВ боте сейчас ${balance} кр.\n\nСколько перенести? Нажмите кнопку или напишите число.`,
            amountKeyboard(balance)
        );
        return;
    }
    const n = parseInt(String(text).replace(/\s/g, ''), 10);
    if (!Number.isFinite(n) || n <= 0) {
        await ctx.reply('Напишите целое число кредитов или нажмите кнопку с суммой.');
        return;
    }
    const balance = await getUserBalance(userId);
    if (n > balance) {
        await ctx.reply(`На балансе ${balance} кр. — больше перенести нельзя.`);
        return;
    }
    state.amount = n;
    state.step = 'confirm';
    await ctx.reply(
        `Перенести ${n} кр. на ${state.email}?\nОни спишутся в боте и появятся на сайте.`,
        confirmKeyboard()
    );
}

async function getUserBalance(userId) {
    try { return await db.getUserBalance(userId); } catch (e) { return 0; }
}

async function getTelegramFileBuffer(ctx, fileId) {
    try {
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    } catch (e) {
        return null;
    }
}

function modelButton(model, currentMode) {
    const mark = model.key === currentMode ? '✅ ' : '';
    const price = model.cost === 0 ? 'бесплатно' : `${model.cost} кр`;
    const cap = model.provider === 'giga' ? (model.limit === null ? ' · без лимита' : ` · ${model.limit}/день`) : '';
    return Markup.button.callback(`${mark}${model.short} · ${price}${cap}`, `set_model_${model.key}`);
}

function getModelSelectionKeyboard(currentMode) {
    const rows = [];
    const groups = Object.keys(catalog.GROUPS).filter(g => catalog.modelsByGroup(g).length > 0);
    for (let i = 0; i < groups.length; i += 2) {
        const row = [Markup.button.callback(catalog.GROUPS[groups[i]], `models_${groups[i]}`)];
        if (groups[i + 1]) row.push(Markup.button.callback(catalog.GROUPS[groups[i + 1]], `models_${groups[i + 1]}`));
        rows.push(row);
    }
    const now = catalog.getModel(currentMode);
    rows.push([Markup.button.callback(`Сейчас: ${now ? now.short : currentMode}`, 'noop_current')]);
    return Markup.inlineKeyboard(rows);
}

function getGroupKeyboard(group, currentMode) {
    const rows = catalog.modelsByGroup(group).map(model => [modelButton(model, currentMode)]);
    rows.push([Markup.button.callback('← К разделам', 'models_home')]);
    return Markup.inlineKeyboard(rows);
}

function packagesKeyboard() {
    return Markup.inlineKeyboard(
        catalog.listPackages().map(p => [Markup.button.callback(`💎 ${p.title} · ${p.price} ₽`, `buy_pkg_${p.id}`)])
    );
}

async function createYookassaPayment(amount, description, email, metadata) {
    try {
        const shopId = process.env.YOOKASSA_SHOP_ID;
        const secretKey = process.env.YOOKASSA_SECRET_KEY;
        if (!shopId || !secretKey) return process.env.YOOKASSA_PAYMENT_URL || null;
        const response = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: { value: amount.toFixed(2), currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: process.env.YOOKASSA_RETURN_URL || 'https://t.me/' },
            capture: true,
            description,
            metadata,
            receipt: {
                customer: { email },
                items: [{
                    description,
                    quantity: '1.00',
                    amount: { value: amount.toFixed(2), currency: 'RUB' },
                    vat_code: Number(process.env.YOOKASSA_VAT_CODE || '1')
                }]
            }
        }, {
            auth: { username: shopId, password: secretKey },
            headers: { 'Idempotence-Key': `${Date.now()}-${Math.random()}` }
        });
        return response.data.confirmation.confirmation_url;
    } catch (error) {
        console.error('❌ Ошибка создания платежа в ЮKassa:', error.response?.data || error.message);
        return null;
    }
}

// Отправка результата генерации в чат.
async function sendResult(ctx, result, extra) {
    const suffix = `${extra || ''}💳 Списано: ${result.cost} кр. | Остаток: ${result.balance} кр.`;
    if (result.buffer && result.type === 'image') {
        await ctx.replyWithPhoto({ source: result.buffer }, { caption: `${result.text || ''}\n\n${suffix}` });
    } else if (result.buffer && result.type === 'video') {
        await ctx.replyWithVideo({ source: result.buffer }, { caption: `${result.text || ''}\n\n${suffix}` });
    } else if (result.buffer && result.type === 'audio') {
        await ctx.replyWithAudio({ source: result.buffer }, { caption: `${result.text || ''}\n\n${suffix}` });
    } else {
        const full = `${result.text || 'Готово'}\n\n───────────────\n${suffix}`;
        try { await ctx.reply(full, { parse_mode: 'Markdown' }); } catch (e) { await ctx.reply(full); }
    }
}

async function notLowBalance(ctx, model) {
    const balance = await getUserBalance(ctx.from.id);
    if (balance < model.cost) {
        await ctx.reply(
            `❌ *Недостаточно кредитов!*\nВаш баланс: ${balance} кр. Требуется: ${model.cost} кр.`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('💰 Пополнить баланс', 'action_buy_credits')]]) }
        );
        return false;
    }
    return true;
}

async function startBot(app) {
    try {
        await db.initDB();
        console.log('✅ База данных PostgreSQL инициализирована');
    } catch (e) {
        console.error('❌ Критическая ошибка инициализации БД:', e.message);
    }
    await catalog.load(db);

    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        console.log('🧹 Старый вебхук сброшен, запущен Long Polling.');
    } catch (e) {
        console.log('ℹ️ Вебхук:', e.message);
    }

    if (app) {
        app.get('/health', (req, res) => res.status(200).send('OK'));
        app.post('/yookassa-webhook', async (req, res) => {
            try {
                const event = req.body;
                if (event.event === 'payment.succeeded') {
                    const metadata = event.object?.metadata;
                    if (metadata && metadata.userId && metadata.credits) {
                        const userId = metadata.userId;
                        const creditsToAdd = parseInt(metadata.credits, 10);
                        const newBalance = await db.updateBalance(userId, creditsToAdd, 'Пополнение ЮKassa');
                        await bot.telegram.sendMessage(
                            userId,
                            `🎉 *Оплата успешно получена!*\n\n➕ Начислено: *${creditsToAdd} кредитов*\n💳 Баланс: *${newBalance} кредитов*`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }
                res.status(200).send('OK');
            } catch (error) {
                console.error('❌ Ошибка вебхука ЮKassa:', error.message);
                res.status(500).send('Internal Server Error');
            }
        });
    }

    // Бот обращается к боту (ответ на обращение из админки, рассылка и т.п.) через app.locals.
    if (app) app.locals.bot = bot;

    bot.use(async (ctx, next) => {
        const text = ctx.message && ctx.message.text;
        if (ctx.from && text && (MENU_TEXTS.includes(text) || text.startsWith('✅ '))) {
            userTransfer.delete(ctx.from.id);
        }
        return next();
    });

    bot.start(async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        userPendingRatio.delete(ctx.from.id);
        userTransfer.delete(ctx.from.id);
        if (await db.isBlocked(ctx.from.id)) {
            await ctx.reply('Доступ к боту ограничен. Напишите в поддержку, если это ошибка.');
            return;
        }
        const username = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name;
        const { isNew } = await db.ensureUser(ctx.from.id, username);
        const bonus = catalog.getGeneral().start_bonus;
        if (isNew && bonus > 0) {
            await db.updateBalance(ctx.from.id, bonus, 'Приветственный бонус');
        }
        const savedModel = (await db.getCurrentModel(ctx.from.id)) || catalog.defaultModelKey();
        const model = catalog.getModel(savedModel) || catalog.getModel(catalog.defaultModelKey());
        const balance = await getUserBalance(ctx.from.id);

        await ctx.reply(
            `🤖 *Главное меню*\n\n` +
            `💳 Баланс: *${balance} кредитов*\n` +
            `🎯 Модель: *${model ? model.name : savedModel}*\n\n` +
            `Весь функционал — в кабинете. Откройте его кнопкой ниже или кнопкой «Кабинет» рядом с полем ввода.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.webApp('📱 Открыть кабинет', webappUrlFor(ctx.from.id))]])
            }
        );
        await ctx.reply('Меню внизу. «На сайт» переносит кредиты на почту кабинета.', mainKeyboard(ctx.from.id));
        try {
            await ctx.telegram.setChatMenuButton({
                chat_id: ctx.chat.id,
                menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: webappUrlFor(ctx.from.id) } }
            });
        } catch (e) {}
    });

    bot.hears(['💳 Баланс', '💳 Мой баланс'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        const balance = await getUserBalance(ctx.from.id);
        const model = catalog.getModel((await db.getCurrentModel(ctx.from.id)) || catalog.defaultModelKey());
        await ctx.reply(
            `💳 *Баланс:* ${balance} кр.\nМодель: ${model ? model.name : ''}\n\nПополнить или перенести на сайт — кнопками внизу.`,
            { parse_mode: 'Markdown', ...mainKeyboard(ctx.from.id) }
        );
    });

    bot.hears(['🤖 Модель', '✨ Модель', '🤖 Выбрать модель ИИ', '🤖 Модели', '🤖 Сменить модель'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        const currentMode = (await db.getCurrentModel(ctx.from.id)) || catalog.defaultModelKey();
        await ctx.reply('Выберите раздел, потом модель.', getModelSelectionKeyboard(currentMode));
    });

    bot.action(/^models_(.+)$/, async (ctx) => {
        const group = ctx.match[1];
        const currentMode = (await db.getCurrentModel(ctx.from.id)) || catalog.defaultModelKey();
        await ctx.answerCbQuery();
        try {
            if (group === 'home') {
                await ctx.editMessageText('Выберите раздел, потом модель.', getModelSelectionKeyboard(currentMode));
            } else if (catalog.GROUPS[group]) {
                await ctx.editMessageText(catalog.GROUPS[group], getGroupKeyboard(group, currentMode));
            }
        } catch (e) {}
    });

    bot.action(/^noop_.+$/, async (ctx) => { await ctx.answerCbQuery('Выберите модель ниже 👇'); });

    bot.hears(['💰 Пополнить', '💰 Пополнить баланс', '➕ Пополнить'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        await ctx.reply(`💳 *Выберите пакет пополнения:*`, { parse_mode: 'Markdown', ...packagesKeyboard() });
    });

    bot.hears(['↗️ На сайт', 'На сайт'], async (ctx) => {
        await beginTransfer(ctx);
    });

    bot.hears('💬 Поддержка', async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        if (!catalog.getGeneral().support_enabled) {
            await ctx.reply('Поддержка временно недоступна. Попробуйте позже.');
            return;
        }
        userAwaitingSupport.set(ctx.from.id, true);
        await ctx.reply(
            `💬 *Служба поддержки*\n\nОпишите вопрос одним сообщением — администратор ответит в ближайшее время:`,
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_support')]]) }
        );
    });

    bot.action('cancel_support', async (ctx) => {
        userAwaitingSupport.delete(ctx.from.id);
        await ctx.answerCbQuery('Отменено');
        try { await ctx.editMessageText('❌ Обращение в поддержку отменено.'); } catch (e) {}
    });

    bot.hears(['ℹ Справка', 'ℹ️ Справка', '❓ Справка'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        await ctx.reply(catalog.getGeneral().help_text, mainKeyboard(ctx.from.id));
    });

    bot.action('transfer_start', async (ctx) => {
        await ctx.answerCbQuery();
        await beginTransfer(ctx);
    });

    bot.action('transfer_cancel', async (ctx) => {
        userTransfer.delete(ctx.from.id);
        await ctx.answerCbQuery('Отменено');
        try { await ctx.editMessageText('Перенос отменён. Кредиты остались в боте.'); } catch (e) {}
    });

    bot.action(/^transfer_amt_(.+)$/, async (ctx) => {
        const state = userTransfer.get(ctx.from.id);
        if (!state || !state.email) {
            await ctx.answerCbQuery('Начните перенос заново');
            return;
        }
        const balance = await getUserBalance(ctx.from.id);
        const raw = ctx.match[1];
        const amount = raw === 'all' ? balance : parseInt(raw, 10);
        if (!(amount > 0) || amount > balance) {
            await ctx.answerCbQuery('Недостаточно кредитов');
            return;
        }
        state.amount = amount;
        state.step = 'confirm';
        await ctx.answerCbQuery();
        try {
            await ctx.editMessageText(
                `Перенести ${amount} кр. на ${state.email}?\nОни спишутся в боте и появятся на сайте.`,
                confirmKeyboard()
            );
        } catch (e) {}
    });

    bot.action('transfer_yes', async (ctx) => {
        const state = userTransfer.get(ctx.from.id);
        if (!state || state.step !== 'confirm' || !state.email || !(state.amount > 0)) {
            await ctx.answerCbQuery('Начните перенос заново');
            return;
        }
        userTransfer.delete(ctx.from.id);
        await ctx.answerCbQuery('Переносим');
        try { await ctx.editMessageText('Переносим кредиты на сайт…'); } catch (e) {}
        const result = await transferApi.transfer({
            userId: ctx.from.id,
            email: state.email,
            credits: state.amount
        });
        const text = result.ok
            ? `Готово.\n\nНа сайте ${result.email}: ${result.siteCredits} кр.\nВ боте осталось: ${result.balance} кр.`
            : result.error;
        try { await ctx.editMessageText(text); } catch (e) { await ctx.reply(text); }
        await ctx.reply('Меню:', mainKeyboard(ctx.from.id));
    });

    bot.action('action_choose_ai', async (ctx) => {
        await ctx.answerCbQuery();
        const currentMode = (await db.getCurrentModel(ctx.from.id)) || catalog.defaultModelKey();
        await ctx.reply('Выберите раздел, потом модель.', getModelSelectionKeyboard(currentMode));
    });

    bot.action(/^set_model_(.+)$/, async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        const key = ctx.match[1];
        const model = catalog.getModel(key);
        if (!model) return ctx.answerCbQuery('Модель недоступна');
        await db.setCurrentModel(ctx.from.id, key);
        await ctx.answerCbQuery(`Выбрано: ${model.short}`);
        const price = model.cost === 0 ? 'бесплатно' : `${model.cost} кр`;
        try { await ctx.editMessageText(`✅ ${model.short} · ${price}. Пишите запрос.`); } catch (e) {}
        await ctx.reply('Меню:', mainKeyboard(ctx.from.id));
    });

    bot.action('action_buy_credits', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply(`💳 *Выберите пакет пополнения:*`, { parse_mode: 'Markdown', ...packagesKeyboard() });
    });

    bot.action(/^buy_pkg_(.+)$/, async (ctx) => {
        const pkg = catalog.getPackage(ctx.match[1]);
        if (!pkg) return ctx.answerCbQuery('⚠️ Пакет не найден');
        await ctx.answerCbQuery();
        userAwaitingEmail.set(ctx.from.id, pkg.id);
        await ctx.reply(
            `✉ Вы выбрали: *${pkg.title}* (${pkg.price} ₽).\n\nВведите *Email* для электронного чека:`,
            { parse_mode: 'Markdown' }
        );
    });

    // Выбор соотношения сторон для моделей, которые это поддерживают.
    bot.action(/^brat_ratio_(.+)$/, async (ctx) => {
        const userId = ctx.from.id;
        const ratio = ctx.match[1];
        if (ratio === 'cancel') {
            userPendingRatio.delete(userId);
            await ctx.answerCbQuery('Отменено');
            try { await ctx.editMessageText('❌ Генерация отменена.'); } catch (e) {}
            return;
        }
        const pending = userPendingRatio.get(userId);
        if (!pending) {
            await ctx.answerCbQuery('⚠️ Запрос устарел.');
            try { await ctx.editMessageText('⚠️ Время ожидания истекло. Отправьте запрос заново.'); } catch (e) {}
            return;
        }
        userPendingRatio.delete(userId);
        await ctx.answerCbQuery(`Размер: ${ratio}`);
        try { await ctx.deleteMessage(); } catch (e) {}
        await executeGeneration(ctx, { ...pending, aspectRatio: ratio });
    });

    // Общий исполнитель: проверка через ядро, замок, отправка результата.
    async function executeGeneration(ctx, { prompt, fileBuffers, modelKey, aspectRatio }) {
        const userId = ctx.from.id;
        let prepared;
        try {
            prepared = await gen.prepare({
                userId,
                modelKey,
                hasImage: fileBuffers.length > 0,
                hasText: !!(prompt && prompt.trim())
            });
        } catch (e) {
            if (e.code === 'no_credits') return notLowBalance(ctx, catalog.getModel(modelKey) || { cost: 0 });
            return ctx.reply(`⚠️ ${e.message}`);
        }
        if (gen.isBusy(userId)) {
            return ctx.reply('⏳ Подождите, нейросеть ещё отвечает на предыдущий запрос.');
        }
        const ratioNote = aspectRatio && aspectRatio !== 'auto' ? `📐 Размер: ${aspectRatio} | ` : '';
        const waitMessage = await ctx.reply('⏳ *Генерирую ответ...*', { parse_mode: 'Markdown' });
        try {
            const result = await gen.run({
                userId,
                prompt,
                model: prepared.model,
                plugin: prepared.plugin,
                fileBuffer: fileBuffers.length === 1 ? fileBuffers[0] : null,
                fileBuffers,
                aspectRatio
            });
            try { await ctx.deleteMessage(waitMessage.message_id); } catch (e) {}
            await sendResult(ctx, result, ratioNote);
        } catch (error) {
            console.error('❌ Ошибка генерации:', error.message || error);
            try { await ctx.deleteMessage(waitMessage.message_id); } catch (e) {}
            if (error.code === 'no_credits') return notLowBalance(ctx, prepared.model);
            if (error.code === 'limit' || error.code === 'need_image' || error.code === 'need_text' || error.code === 'blocked') {
                return ctx.reply(`⚠️ ${error.message}`);
            }
            await ctx.reply('⚠️ Не удалось получить ответ от нейросети. Кредиты не списаны.');
        }
    }

    async function collectAndGenerate(ctx, contexts) {
        const userId = ctx.from.id;
        if (await db.isBlocked(userId)) {
            return ctx.reply('Доступ ограничен. Генерации для этого аккаунта выключены.');
        }
        const list = contexts || [ctx];
        let prompt = '';
        for (const c of list) {
            const t = c.message?.text || c.message?.caption;
            if (t) { prompt = t; break; }
        }
        const MAX = 3500;
        if (prompt.length > MAX) {
            return ctx.reply(`⚠️ Слишком длинный запрос (${prompt.length}). Лимит — ${MAX} символов.`);
        }

        let modelKey = (await db.getCurrentModel(userId)) || catalog.defaultModelKey();
        if (!catalog.getModel(modelKey)) {
            modelKey = catalog.defaultModelKey();
            await db.setCurrentModel(userId, modelKey);
        }
        const model = catalog.getModel(modelKey);

        let fileBuffers = [];
        for (const c of list) {
            if (c.message?.photo && c.message.photo.length > 0) {
                const largest = c.message.photo[c.message.photo.length - 1];
                const buf = await getTelegramFileBuffer(ctx, largest.file_id);
                if (buf) fileBuffers.push(buf);
            }
        }

        if (model.image === 'required' && fileBuffers.length === 0) {
            return ctx.reply('⚠️ Для выбранной модели нужно прикрепить фото (с подписью-промптом).');
        }
        if (model.image !== 'required' && !prompt.trim() && fileBuffers.length === 0) {
            return ctx.reply('⚠️ Отправьте текст запроса или прикрепите фото.');
        }

        if (model.ratio) {
            userPendingRatio.set(userId, { prompt, fileBuffers, modelKey });
            const kb = Markup.inlineKeyboard([
                [Markup.button.callback('1:1', 'brat_ratio_1:1'), Markup.button.callback('16:9', 'brat_ratio_16:9'), Markup.button.callback('9:16', 'brat_ratio_9:16')],
                [Markup.button.callback('4:3', 'brat_ratio_4:3'), Markup.button.callback('3:4', 'brat_ratio_3:4'), Markup.button.callback('3:2', 'brat_ratio_3:2')],
                [Markup.button.callback('2:3', 'brat_ratio_2:3'), Markup.button.callback('21:9', 'brat_ratio_21:9'), Markup.button.callback('9:21', 'brat_ratio_9:21')],
                [Markup.button.callback('🤖 Auto', 'brat_ratio_auto')],
                [Markup.button.callback('❌ Отмена', 'brat_ratio_cancel')]
            ]);
            return ctx.reply(`📐 *Выберите формат для ${model.name}:*`, { parse_mode: 'Markdown', ...kb });
        }

        await executeGeneration(ctx, { prompt, fileBuffers, modelKey });
    }

    const handleTextMessage = async (ctx) => {
        const text = ctx.message?.text || '';
        if (MENU_TEXTS.includes(text) || text.startsWith('✅ ')) return;
        const userId = ctx.from.id;
        if (await db.isBlocked(userId)) {
            return ctx.reply('Доступ ограничен. Генерации для этого аккаунта выключены.');
        }

        // Ответ администратора на обращение через reply в чате бота.
        if (auth.isAdminId(userId) && ctx.message.reply_to_message) {
            const repliedText = ctx.message.reply_to_message.text || '';
            const match = repliedText.match(/ID:\s*`?(\d+)`?/);
            if (match && match[1]) {
                try {
                    await bot.telegram.sendMessage(match[1], `💬 *Ответ поддержки:*\n\n${text}`, { parse_mode: 'Markdown' });
                    await ctx.reply('✅ Ответ доставлен пользователю.');
                } catch (err) {
                    await ctx.reply(`❌ Не удалось отправить: ${err.message}`);
                }
                return;
            }
        }

        if (userTransfer.has(userId)) {
            await handleTransferText(ctx, text);
            return;
        }

        if (userAwaitingSupport.has(userId)) {
            userAwaitingSupport.delete(userId);
            const username = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name;
            try { await db.createTicket(userId, username, text, 'bot'); } catch (e) {}
            const msg = `🚨 *Новое обращение в поддержку!*\n\n👤 ${ctx.from.first_name || 'Пользователь'} (ID: \`${userId}\`)\n💬 ${text}`;
            for (const adminId of auth.adminIds()) {
                try { await bot.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' }); } catch (e) {}
            }
            await ctx.reply('✅ Сообщение отправлено в поддержку. Ответ придёт в этот чат.');
            return;
        }

        if (userAwaitingEmail.has(userId)) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(text)) {
                const pkg = catalog.getPackage(userAwaitingEmail.get(userId));
                userAwaitingEmail.delete(userId);
                if (!pkg) return ctx.reply('⚠️ Пакет не найден, выберите заново.');
                await ctx.reply(`⏳ Генерирую ссылку на оплату для ${text}...`);
                const paymentUrl = await createYookassaPayment(pkg.price, `Покупка ${pkg.title}`, text, { userId: String(userId), credits: String(pkg.credits) });
                if (paymentUrl) {
                    return ctx.reply(
                        `💳 Ссылка на оплату готова!\n\nЧек придёт на *${text}*.\nНажмите кнопку ниже:`,
                        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.url('🔗 Оплатить в ЮKassa', paymentUrl)]]) }
                    );
                }
                return ctx.reply('⚠️ Не удалось сформировать ссылку. Попробуйте позже.');
            }
            userAwaitingEmail.delete(userId);
        }

        await collectAndGenerate(ctx);
    };

    // Данные из Mini App (web_app keyboard button). Основной канал — HTTP API, но шаблоны/оплата приходят сюда.
    bot.on('message', async (ctx, next) => {
        const raw = ctx.message?.web_app_data?.data;
        if (!raw) return next();
        if (await db.isBlocked(ctx.from.id)) return ctx.reply('Доступ ограничен.');
        let payload = null;
        try { payload = JSON.parse(raw); } catch (e) { payload = {}; }
        if (payload.action === 'run_template' && payload.prompt) {
            if (payload.model && catalog.getModel(payload.model)) await db.setCurrentModel(ctx.from.id, payload.model);
            ctx.message.text = payload.prompt;
            await ctx.reply(`Запускаю шаблон «${payload.title || 'шаблон'}».`);
            return collectAndGenerate(ctx);
        }
        if (payload.action === 'buy_credits') {
            return ctx.reply('Выберите пакет кредитов:', packagesKeyboard());
        }
        return next();
    });

    bot.on('text', handleTextMessage);

    bot.on('photo', async (ctx) => {
        const mediaGroupId = ctx.message?.media_group_id;
        if (mediaGroupId) {
            if (!mediaGroupBuffers.has(mediaGroupId)) {
                mediaGroupBuffers.set(mediaGroupId, {
                    contexts: [ctx],
                    timer: setTimeout(async () => {
                        const group = mediaGroupBuffers.get(mediaGroupId);
                        mediaGroupBuffers.delete(mediaGroupId);
                        if (group && group.contexts.length > 0) await collectAndGenerate(group.contexts[0], group.contexts);
                    }, 1000)
                });
            } else {
                mediaGroupBuffers.get(mediaGroupId).contexts.push(ctx);
            }
        } else {
            return collectAndGenerate(ctx);
        }
    });

    try {
        await bot.telegram.setChatMenuButton({
            menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: baseWebappUrl() + '/?v=10' } }
        });
        console.log('✅ Кнопка меню Mini App установлена');
    } catch (e) {
        console.error('❌ Не удалось поставить кнопку меню:', e.message);
    }

    // 409 значит, что старый контейнер ещё опрашивает Telegram. Ждём, пока он отпустит бота,
    // и не роняем веб-сервер: кабинет продолжает работать.
    async function launchBot() {
        for (let attempt = 1; attempt <= 8; attempt++) {
            try {
                console.log('🤖 Подключаюсь к Telegram...');
                await bot.launch();
                console.log('🤖 Бот остановлен');
                return;
            } catch (err) {
                const conflict = String((err && err.message) || '').includes('409');
                console.error(conflict
                    ? `⚠️ Telegram занят другим экземпляром (${attempt}/8). Повтор через 15 секунд.`
                    : '❌ Ошибка запуска бота:', err);
                try { bot.stop('retry'); } catch (e) {}
                if (!conflict || attempt === 8) return;
                await new Promise(r => setTimeout(r, 15000));
            }
        }
    }
    launchBot();

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { startBot };
