require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Подключаем оба плагина
let googlePlugin = null;
try {
    googlePlugin = require('../ai_plugins/google_gemini_plugin');
    console.log('✅ Плагин Google Gemini успешно подключен к ядру');
} catch (e) {
    console.warn('⚠ Внимание: Плагин Google Gemini не найден!', e.message);
}

let bratukhaPlugin = null;
try {
    bratukhaPlugin = require('../ai_plugins/bratukha_plugin');
    console.log('✅ Плагин Братуха успешно подключен к ядру');
} catch (e) {
    console.warn('⚠ Внимание: Плагин Братуха не найден!', e.message);
}

// Роутер для выбора нужного плагина в зависимости от модели
function getAiPlugin(modelKey) {
    if (['flash', 'flash_25', 'pro', 'nanobanana', 'nanobanana_pro', 'veo'].includes(modelKey)) {
        return googlePlugin;
    }
    return bratukhaPlugin;
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const userActiveMode = new Map();
const userAwaitingEmail = new Map();
const userAwaitingSupport = new Map();
const userProcessing = new Set();
const mediaGroupBuffers = new Map();

const ADMIN_ID = '5943987954';

bot.catch((err, ctx) => {
    console.error(`⚠️ Ошибка в Telegraf для ${ctx?.updateType || 'неизвестного события'}:`, err.message);
});

bot.use(async (ctx, next) => {
    console.log(`🔔 ПОЛУЧЕН ЗАПРОС: ID: ${ctx.from?.id}, Сообщение: ${ctx.message?.text || ctx.callbackQuery?.data || 'медиа/действие'}`);
    return next();
});

const MODEL_COSTS = {
    // Гугловские (не трогаем)
    'flash': 1,
    'flash_25': 1,
    'pro': 3,
    'nanobanana': 4,
    'nanobanana_pro': 10,
    'veo': 400,

    // Новые модели от Братухи (с учетом коэффициента x2.5)
    'gpt-image-2-5': 2,
    'deepseek-v3.2': 3,
    'qwen3.5-9b': 10
};

const MODEL_NAMES = {
    // Гугловские (не трогаем)
    'flash': 'Gemini 3.8 Flash ⚡️',
    'flash_25': 'Gemini 2.5 Flash 🚀',
    'pro': 'Gemini 3.1 Pro 🧠',
    'nanobanana': 'Nano Banana 2 (Картинки) 🎨',
    'nanobanana_pro': 'Nano Banana Pro (HQ) 💎',
    'veo': 'Veo 3.1 Видео (VIP) 🎬',

    // Новые модели от Братухи
    'gpt-image-2-5': 'GPT Image 2.5 🎨',
    'deepseek-v3.2': 'DeepSeek V3.2 🤖',
    'qwen3.5-9b': 'Qwen 3.5 9B 💬'
};

const CREDIT_PACKAGES = {
    'pack_50': { credits: 50, price: 250, title: '50 кредитов' },
    'pack_150': { credits: 150, price: 750, title: '150 кредитов' },
    'pack_500': { credits: 500, price: 2500, title: '500 кредитов' }
};

const mainKeyboard = Markup.keyboard([
    ['🤖 Выбрать модель ИИ', '💳 Мой баланс'],
    ['💰 Пополнить баланс', '💬 Поддержка'],
    ['ℹ Справка']
]).resize();

async function getUserBalance(userId) {
    try {
        const response = await axios.get(`${process.env.GOOGLE_SCRIPT_URL}?action=get&userId=${userId}`);
        return response.data && response.data.balance !== undefined ? parseInt(response.data.balance) : 0;
    } catch (error) {
        console.error("❌ Ошибка чтения баланса:", error.message);
        return 0;
    }
}

async function deductUserBalance(userId, cost) {
    try {
        const response = await axios.post(process.env.GOOGLE_SCRIPT_URL, {
            action: 'update', userId: userId, amount: -cost
        });
        return response.data && response.data.balance !== undefined;
    } catch (error) {
        console.error("❌ Ошибка списания:", error.message);
        return false;
    }
}

async function addUserBalance(userId, amount) {
    try {
        const response = await axios.post(process.env.GOOGLE_SCRIPT_URL, {
            action: 'update', userId: userId, amount: amount
        });
        return response.data && response.data.balance !== undefined;
    } catch (error) {
        console.error("❌ Ошибка начисления:", error.message);
        return false;
    }
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

function getModelSelectionKeyboard(currentMode) {
    const textModels = ['flash', 'flash_25', 'pro', 'deepseek-v3.2', 'qwen3.5-9b'];
    const imageModels = ['nanobanana', 'nanobanana_pro', 'gpt-image-2-5'];
    const videoModels = ['veo'];

    const buttons = [];

    // Текстовые модели
    buttons.push([Markup.button.callback('💬 ─── ТЕКСТОВЫЕ МОДЕЛИ ───', 'noop_text')]);
    textModels.forEach(key => {
        const isSelected = key === currentMode ? '✅ ' : '';
        buttons.push([Markup.button.callback(`${isSelected}${MODEL_NAMES[key]} (${MODEL_COSTS[key]} кр.)`, `set_model_${key}`)]);
    });

    // Генерация картинок
    buttons.push([Markup.button.callback('🎨 ─── ГЕНЕРАЦИЯ КАРТИНОК ───', 'noop_image')]);
    imageModels.forEach(key => {
        const isSelected = key === currentMode ? '✅ ' : '';
        buttons.push([Markup.button.callback(`${isSelected}${MODEL_NAMES[key]} (${MODEL_COSTS[key]} кр.)`, `set_model_${key}`)]);
    });

    // Видео
    buttons.push([Markup.button.callback('🎬 ─── ВИДЕО ───', 'noop_video')]);
    videoModels.forEach(key => {
        const isSelected = key === currentMode ? '✅ ' : '';
        buttons.push([Markup.button.callback(`${isSelected}${MODEL_NAMES[key]} (${MODEL_COSTS[key]} кр.)`, `set_model_${key}`)]);
    });

    return Markup.inlineKeyboard(buttons);
}

async function createYookassaPayment(amount, description, email, metadata) {
    try {
        const shopId = process.env.YOOKASSA_SHOP_ID;
        const secretKey = process.env.YOOKASSA_SECRET_KEY;

        if (!shopId || !secretKey) {
            return process.env.YOOKASSA_PAYMENT_URL || null;
        }

        const response = await axios.post('https://api.yookassa.ru/v3/payments', {
            amount: { value: amount.toFixed(2), currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: process.env.YOOKASSA_RETURN_URL || 'https://t.me/' },
            capture: true,
            description: description,
            metadata: metadata,
            receipt: {
                customer: { email: email },
                items: [{
                    description: description,
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

async function startBot(app) {
    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        console.log('🧹 Старый вебхук сброшен, запущен Long Polling.');
    } catch (e) {
        console.log('ℹ️ Вебхук:', e.message);
    }

    if (app) {
        app.get('/', (req, res) => {
            res.status(200).send('🤖 Telegram AI Bot is running and healthy!');
        });
        app.get('/health', (req, res) => {
            res.status(200).send('OK');
        });

        app.post('/yookassa-webhook', async (req, res) => {
            try {
                const event = req.body;
                if (event.event === 'payment.succeeded') {
                    const metadata = event.object?.metadata;
                    if (metadata && metadata.userId && metadata.credits) {
                        const userId = parseInt(metadata.userId);
                        const creditsToAdd = parseInt(metadata.credits);
                        await addUserBalance(userId, creditsToAdd);
                        const newBalance = await getUserBalance(userId);
                        await bot.telegram.sendMessage(
                            userId,
                            `🎉 *Оплата успешно получена!*\n\n➕ Начислено: *${creditsToAdd} кредитов*\n💳 Ваш текущий баланс: *${newBalance} кредитов*`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                }
                res.status(200).send('OK');
            } catch (error) {
                console.error('❌ Ошибка при обработке вебхука:', error.message);
                res.status(500).send('Internal Server Error');
            }
        });
    }

    bot.start(async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        userProcessing.delete(ctx.from.id);
        if (!userActiveMode.has(ctx.from.id)) {
            userActiveMode.set(ctx.from.id, 'flash');
        }
        const currentMode = userActiveMode.get(ctx.from.id);
        const balance = await getUserBalance(ctx.from.id);

        await ctx.reply(
            `🤖 *Главное меню бота*\n\n` +
            `💳 Ваш баланс: *${balance} кредитов*\n` +
            `🎯 Текущая модель: *${MODEL_NAMES[currentMode]}*\n\n` +
            `Отправьте текстовый запрос или фото:`,
            { parse_mode: 'Markdown', ...mainKeyboard }
        );
    });

    bot.hears(['💳 Мой баланс', '💳 Баланс'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        const balance = await getUserBalance(ctx.from.id);
        const currentMode = userActiveMode.get(ctx.from.id) || 'flash';
        await ctx.reply(
            `💳 *Баланс:* ${balance} кр.\nМодель: ${MODEL_NAMES[currentMode]}`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💰 Пополнить баланс', 'action_buy_credits')]
                ])
            }
        );
    });

    bot.hears(['🤖 Выбрать модель ИИ', '🤖 Модели'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        const currentMode = userActiveMode.get(ctx.from.id) || 'flash';
        await ctx.reply(`🤖 *Выберите модель:*`, { parse_mode: 'Markdown', ...getModelSelectionKeyboard(currentMode) });
    });

    bot.hears('💰 Пополнить баланс', async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        const keyboard = Object.keys(CREDIT_PACKAGES).map(pkgKey => {
            const pkg = CREDIT_PACKAGES[pkgKey];
            return [Markup.button.callback(`💳 ${pkg.title} — ${pkg.price} ₽`, `buy_pkg_${pkgKey}`)];
        });
        await ctx.reply(`💳 *Выберите пакет пополнения:*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
    });

    bot.hears('💬 Поддержка', async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.set(ctx.from.id, true);
        await ctx.reply(
            `💬 *Служба поддержки*\n\n` +
            `Опишите вашу проблему или задайте вопрос одним сообщением. Администратор ответит вам в ближайшее время:`,
            { 
                parse_mode: 'Markdown', 
                ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_support')]]) 
            }
        );
    });

    bot.action('cancel_support', async (ctx) => {
        userAwaitingSupport.delete(ctx.from.id);
        await ctx.answerCbQuery('Отменено');
        await ctx.editMessageText('❌ Обращение в поддержку отменено.');
    });

    // Обработка кликов по неактивным заголовкам разделов в меню моделей
    bot.action(/^noop_.+$/, async (ctx) => {
        await ctx.answerCbQuery('Это название раздела, выберите модель ниже 👇');
    });

    bot.hears(['ℹ Справка', 'ℹ️ Справка'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        await ctx.reply(
            `Здравствуйте! Я — универсальный ИИ-помощник.\n\n` +
            `Вот чем я могу вам помочь:\n` +
            `• Работа с текстом и языками\n` +
            `• Поиск информации и обучение\n` +
            `• Программирование и отладка кода\n` +
            `• Генерация идей и планирование\n\n` +
            `Просто отправьте мне текстовый вопрос или фото!`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.action('action_choose_ai', async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        await ctx.answerCbQuery();
        const currentMode = userActiveMode.get(ctx.from.id) || 'flash';
        await ctx.reply(`🤖 *Выберите ИИ-модель:*`, { parse_mode: 'Markdown', ...getModelSelectionKeyboard(currentMode) });
    });

    bot.action(/^set_model_(.+)$/, async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        let selectedModel = ctx.match[1];
        if (selectedModel === 'qwen-3-5-9b') selectedModel = 'qwen3.5-9b';
        if (selectedModel === 'deepseek-v3-2') selectedModel = 'deepseek-v3.2';

        if (MODEL_NAMES[selectedModel]) {
            userActiveMode.set(ctx.from.id, selectedModel);
            await ctx.answerCbQuery(`Выбрано: ${MODEL_NAMES[selectedModel]}`);
            await ctx.reply(`✅ Модель изменена на *${MODEL_NAMES[selectedModel]}*`, { parse_mode: 'Markdown' });
        }
    });

    const showPackages = async (ctx) => {
        const keyboard = Object.keys(CREDIT_PACKAGES).map(pkgKey => {
            const pkg = CREDIT_PACKAGES[pkgKey];
            return [Markup.button.callback(`💳 ${pkg.title} — ${pkg.price} ₽`, `buy_pkg_${pkgKey}`)];
        });
        await ctx.reply(`💳 *Выберите пакет пополнения:*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
    };

    bot.action('action_buy_credits', async (ctx) => {
        await ctx.answerCbQuery();
        await showPackages(ctx);
    });

    bot.action(/^buy_pkg_(.+)$/, async (ctx) => {
        const pkgKey = ctx.match[1];
        const pkg = CREDIT_PACKAGES[pkgKey];
        if (!pkg) return ctx.answerCbQuery('⚠️ Пакет не найден');

        await ctx.answerCbQuery();
        userAwaitingEmail.set(ctx.from.id, pkgKey);

        await ctx.reply(
            `✉ Вы выбрали: *${pkg.title}* (${pkg.price} ₽).\n\n` +
            `Пожалуйста, введите ваш *Email* в ответном сообщении. На него будет отправлен электронный чек после оплаты:`,
            { parse_mode: 'Markdown' }
        );
    });

    const handleAiRequest = async (ctx) => {
        const text = ctx.message?.text || '';
        if (['🤖 Выбрать модель ИИ', '💳 Мой баланс', '💰 Пополнить баланс', '💬 Поддержка', 'ℹ Справка', 'ℹ️ Справка', '🤖 Модели', '💳 Баланс'].includes(text)) {
            return;
        }

        const userId = ctx.from.id;
        const stringUserId = String(userId);

        if (stringUserId === ADMIN_ID && ctx.message.reply_to_message) {
            const repliedText = ctx.message.reply_to_message.text || '';
            const match = repliedText.match(/ID:\s*`?(\d+)`?/);
            if (match && match[1]) {
                const targetUserId = match[1];
                try {
                    await bot.telegram.sendMessage(
                        targetUserId,
                        `💬 *Ответ от службы поддержки:*\n\n${text}`,
                        { parse_mode: 'Markdown' }
                    );
                    await ctx.reply('✅ Ответ успешно доставлен пользователю!');
                } catch (err) {
                    await ctx.reply(`❌ Не удалось отправить ответ: ${err.message}`);
                }
                return;
            }
        }

        if (userAwaitingSupport.has(userId)) {
            userAwaitingSupport.delete(userId);
            const supportMsg = 
                `🚨 *Новое обращение в поддержку!*\n\n` +
                `👤 От: ${ctx.from.first_name || 'Пользователь'} (ID: \`${userId}\`)\n` +
                `💬 Текст:\n${text}`;

            try {
                await bot.telegram.sendMessage(ADMIN_ID, supportMsg, { parse_mode: 'Markdown' });
                await ctx.reply('✅ Ваше сообщение отправлено в службу поддержки! Администратор ответит вам в ближайшее время.', { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Ошибка отправки в поддержку:', err);
                await ctx.reply('⚠️ Не удалось отправить сообщение в поддержку. Попробуйте позже.');
            }
            return;
        }

        if (userProcessing.has(userId)) {
            return ctx.reply('⏳ *Подождите...* Нейросеть еще отвечает на ваш предыдущий запрос. Пожалуйста, дождитесь завершения генерации.', { parse_mode: 'Markdown' });
        }

        if (userAwaitingEmail.has(userId)) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(text)) {
                const pkgKey = userAwaitingEmail.get(userId);
                userAwaitingEmail.delete(userId);
                const pkg = CREDIT_PACKAGES[pkgKey];

                await ctx.reply(`⏳ Генерирую ссылку на оплату для ${text}...`);
                const paymentUrl = await createYookassaPayment(
                    pkg.price, 
                    `Покупка ${pkg.title} в боте`, 
                    text, 
                    { userId: String(userId), credits: String(pkg.credits) }
                );

                if (paymentUrl) {
                    return ctx.reply(
                        `💳 Ссылка на оплату сформирована успешно!\n\n` +
                        `Электронный чек будет автоматически отправлен на адрес: *${text}*\n\n` +
                        `Нажмите кнопку ниже для перехода к оплате:`,
                        {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard([
                                [Markup.button.url('🔗 Оплатить в ЮKassa', paymentUrl)]
                            ])
                        }
                    );
                } else {
                    return ctx.reply('⚠️ Не удалось сформировать ссылку на оплату. Попробуйте позже.');
                }
            } else {
                userAwaitingEmail.delete(userId);
            }
        }

        let prompt = text || ctx.message?.caption || '';

        const MAX_PROMPT_LENGTH = 3500;
        if (prompt.length > MAX_PROMPT_LENGTH) {
            return ctx.reply(
                `⚠️ *Слишком длинный запрос!*\n\n` +
                `Ваш текст содержит ${prompt.length} символов. Максимальный лимит — ${MAX_PROMPT_LENGTH} символов.\n` +
                `Пожалуйста, разделите ваш текст на несколько частей.`
            );
        }

        let currentMode = userActiveMode.get(userId) || 'flash';
        if (currentMode === 'qwen-3-5-9b') currentMode = 'qwen3.5-9b';
        if (currentMode === 'deepseek-v3-2') currentMode = 'deepseek-v3.2';

        const cost = MODEL_COSTS[currentMode] || 1;

        const balance = await getUserBalance(userId);
        if (balance < cost) {
            return ctx.reply(
                `❌ *Недостаточно кредитов!*\nВаш баланс: ${balance} кр. Требуется: ${cost} кр.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback('💰 Пополнить баланс', 'action_buy_credits')]])
                }
            );
        }

        const activePlugin = getAiPlugin(currentMode);
        if (!activePlugin) return ctx.reply('⚠️ Сервис временно недоступен. Попробуйте позже.');

        userProcessing.add(userId);
        const waitMessage = await ctx.reply(`⏳ *Генерирую ответ...* ${currentMode === 'veo' ? '(Видео создается около 1–2 минут, пожалуйста, подождите)' : ''}`, { parse_mode: 'Markdown' });

        try {
            let fileBuffers = [];
            let mimeType = 'image/jpeg';

            if (ctx.message?.photo && ctx.message.photo.length > 0) {
                const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
                const buf = await getTelegramFileBuffer(ctx, largestPhoto.file_id);
                if (buf) fileBuffers.push(buf);
            }

            const aiResult = await activePlugin.processRequest({
                prompt, 
                fileBuffer: fileBuffers.length === 1 ? fileBuffers[0] : null,
                fileBuffers: fileBuffers.length > 1 ? fileBuffers : undefined,
                mimeType, 
                modelKey: currentMode
            });

            await deductUserBalance(userId, cost);
            const remainingBalance = await getUserBalance(userId);

            try { await ctx.deleteMessage(waitMessage.message_id); } catch(e){}

            if (aiResult.type === 'image' && aiResult.buffer) {
                await ctx.replyWithPhoto(
                    { source: aiResult.buffer }, 
                    { caption: `${aiResult.text || ''}\n\n💳 Списано: ${cost} кр. | Остаток: ${remainingBalance} кр.` }
                );
            } else if (aiResult.type === 'video' && aiResult.buffer) {
                await ctx.replyWithVideo(
                    { source: aiResult.buffer },
                    { caption: `${aiResult.text || ''}\n\n💳 Списано: ${cost} кр. | Остаток: ${remainingBalance} кр.` }
                );
            } else {
                const fullText = `${aiResult.text}\n\n───────────────\n💳 *Списано:* ${cost} кр. | *Остаток:* ${remainingBalance} кр.`;
                try {
                    await ctx.reply(fullText, { parse_mode: 'Markdown' });
                } catch (mdErr) {
                    await ctx.reply(fullText);
                }
            }
        } catch (error) {
            console.error('❌ Ошибка генерации (скрыта от пользователя):', error.message || error);
            try { await ctx.deleteMessage(waitMessage.message_id); } catch(e){}
            await ctx.reply(`⚠️ Не удалось получить ответ от нейросети. Ваши кредиты не были списаны.`);
        } finally {
            userProcessing.delete(userId);
        }
    };

    const handleAlbumRequest = async (contexts) => {
        const firstCtx = contexts[0];
        const userId = firstCtx.from.id;

        if (userProcessing.has(userId)) {
            return firstCtx.reply('⏳ *Подождите...* Нейросеть еще отвечает на ваш предыдущий запрос. Пожалуйста, дождитесь завершения генерации.', { parse_mode: 'Markdown' });
        }

        let prompt = '';
        for (const c of contexts) {
            if (c.message?.caption) {
                prompt = c.message.caption;
                break;
            }
        }

        let currentMode = userActiveMode.get(userId) || 'flash';
        if (currentMode === 'qwen-3-5-9b') currentMode = 'qwen3.5-9b';
        if (currentMode === 'deepseek-v3-2') currentMode = 'deepseek-v3.2';

        const cost = MODEL_COSTS[currentMode] || 1;

        const balance = await getUserBalance(userId);
        if (balance < cost) {
            return firstCtx.reply(
                `❌ *Недостаточно кредитов!*\nВаш баланс: ${balance} кр. Требуется: ${cost} кр.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([[Markup.button.callback('💰 Пополнить баланс', 'action_buy_credits')]])
                }
            );
        }

        const activePlugin = getAiPlugin(currentMode);
        if (!activePlugin) return firstCtx.reply('⚠️ Сервис временно недоступен. Попробуйте позже.');

        userProcessing.add(userId);
        const waitMessage = await firstCtx.reply(`⏳ *Генерирую ответ...*`, { parse_mode: 'Markdown' });

        try {
            let fileBuffers = [];
            let mimeType = 'image/jpeg';

            for (const c of contexts) {
                if (c.message?.photo && c.message.photo.length > 0) {
                    const largestPhoto = c.message.photo[c.message.photo.length - 1];
                    const buf = await getTelegramFileBuffer(firstCtx, largestPhoto.file_id);
                    if (buf) fileBuffers.push(buf);
                }
            }

            const aiResult = await activePlugin.processRequest({
                prompt, 
                fileBuffer: fileBuffers.length === 1 ? fileBuffers[0] : null,
                fileBuffers: fileBuffers.length > 1 ? fileBuffers : undefined,
                mimeType, 
                modelKey: currentMode
            });

            await deductUserBalance(userId, cost);
            const remainingBalance = await getUserBalance(userId);

            try { await firstCtx.deleteMessage(waitMessage.message_id); } catch(e){}

            if (aiResult.type === 'image' && aiResult.buffer) {
                await firstCtx.replyWithPhoto(
                    { source: aiResult.buffer }, 
                    { caption: `${aiResult.text || ''}\n\n💳 Списано: ${cost} кр. | Остаток: ${remainingBalance} кр.` }
                );
            } else if (aiResult.type === 'video' && aiResult.buffer) {
                await firstCtx.replyWithVideo(
                    { source: aiResult.buffer },
                    { caption: `${aiResult.text || ''}\n\n💳 Списано: ${cost} кр. | Остаток: ${remainingBalance} кр.` }
                );
            } else {
                const fullText = `${aiResult.text}\n\n───────────────\n💳 *Списано:* ${cost} кр. | *Остаток:* ${remainingBalance} кр.`;
                try {
                    await firstCtx.reply(fullText, { parse_mode: 'Markdown' });
                } catch (mdErr) {
                    await firstCtx.reply(fullText);
                }
            }
        } catch (error) {
            console.error('❌ Ошибка генерации (скрыта от пользователя):', error.message || error);
            try { await firstCtx.deleteMessage(waitMessage.message_id); } catch(e){}
            await firstCtx.reply(`⚠ Не удалось получить ответ от нейросети. Ваши кредиты не были списаны.`);
        } finally {
            userProcessing.delete(userId);
        }
    };

    bot.on('text', handleAiRequest);
    
    bot.on('photo', async (ctx) => {
        const mediaGroupId = ctx.message?.media_group_id;
        if (mediaGroupId) {
            if (!mediaGroupBuffers.has(mediaGroupId)) {
                mediaGroupBuffers.set(mediaGroupId, {
                    contexts: [ctx],
                    timer: setTimeout(async () => {
                        const group = mediaGroupBuffers.get(mediaGroupId);
                        mediaGroupBuffers.delete(mediaGroupId);
                        if (group && group.contexts.length > 0) {
                            await handleAlbumRequest(group.contexts);
                        }
                    }, 400)
                });
            } else {
                mediaGroupBuffers.get(mediaGroupId).contexts.push(ctx);
            }
            return;
        }
        return handleAiRequest(ctx);
    });

    bot.launch().then(() => {
        console.log('🤖 Ядро бота успешно запущено!');
    }).catch((err) => {
        console.error('⚠ Ошибка при запуске Telegram polling:', err.message);
    });
}

module.exports = { startBot };