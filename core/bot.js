require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const db = require('./db');

// Подключаем плагины
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

// Роутер выбора плагина
function getAiPlugin(modelKey) {
    if (['flash', 'flash_25', 'pro', 'nanobanana', 'nanobanana_pro'].includes(modelKey)) {
        return googlePlugin;
    }
    return bratukhaPlugin;
}

const bot = new Telegraf(process.env.BOT_TOKEN, {
    handlerTimeout: 300000
});

const userActiveMode = new Map();
const userAwaitingEmail = new Map();
const userAwaitingSupport = new Map();
const userProcessing = new Set();
const mediaGroupBuffers = new Map();

// Хранилище отложенных запросов Братухи, ожидающих выбор размера
const userPendingBratukhaRequests = new Map();

// Модели Братухи, для которых запрашивается выбор соотношения сторон (размера)
const BRATUKHA_RATIO_MODELS = [
    'qwen-image-2-1', 'qwen-image-3-0', 'recraft-v4', 'recraft-v4-1', 
    'runway-gen4-image', 'seedream-4-0', 'seedream-4-5',
    'sora-2', 'seedance-1-0', 'seedance-1-5-pro', 'seedance-2-0-apimart', 'pruna-ai-p-video-2-pro'
];

const ADMIN_ID = '5943987954';

// 🛑 Модели, СТРОГО ТРЕБУЮЩИЕ наличия исходного изображения (Апскейлеры, 3D и Все Видео кроме Veo)
const REQUIRES_IMAGE_MODELS = [
    // 🔍 Апскейлеры и улучшение
    'phota-enhance', 'p-image-upscale', 'recraft-creative-upscale', 'recraft-crisp-upscale',
    
    // 🧊 3D-моделирование
    'sam-3d',

    // 🎬 Видео-модели (Все, кроме Veo — требуют картинку-ориентир + промпт)
    'sora-2', 
    'seedance-1-0', 
    'seedance-1-5-pro', 
    'seedance-2-0-apimart', 
    'pruna-ai-p-video-2-pro',
    'pixverse-6-0', 'pixverse-5-5', 'pixverse-5-6', 'pixverse-lipsync', 
    'omnihuman-1-0', 'omnihuman-1-5', 'p-video-avatar', 
    'pruna-ai-p-video-animate', 'pruna-ai-p-video-edit'
];

// 📝 Модели, СТРОГО ТРЕБУЮЩИЕ наличия текстового описания (Промпта)
const REQUIRES_TEXT_MODELS = [
    'flash', 'flash_25', 'pro',
    'qwen3-tts', 'qwen3-tts-flash',
    'qwen-image-2-1', 'qwen-image-3-0', 'recraft-v4', 'recraft-v4-1', 
    'runway-gen4-image', 'seedream-4-0', 'seedream-4-5'
];

bot.catch((err, ctx) => {
    console.error(`⚠️ Ошибка в Telegraf для ${ctx?.updateType || 'неизвестного события'}:`, err.message);
});

bot.use(async (ctx, next) => {
    console.log(`🔔 ПОЛУЧЕН ЗАПРОС: ID: ${ctx.from?.id}, Сообщение: ${ctx.message?.text || ctx.callbackQuery?.data || 'медиа/действие'}`);
    return next();
});

// 💰 Стоимость моделей в кредитах. 1 кредит = 1 ₽, как на сайте.
// Google-модели — те же цифры, что в CREDIT_COSTS сайта.
// Остальные модели на сайте не продаются: цифра умножена на 5,
// потому что раньше 1 кредит бота стоил 5 ₽, и цена в рублях не должна упасть.
const MODEL_COSTS = {
    'flash': 4,
    'flash_25': 4,
    'pro': 15,
    'nanobanana': 20,
    'nanobanana_pro': 50,

    'qwen3-tts': 100,
    'qwen3-tts-flash': 100,

    'phota-enhance': 220,
    'p-image-upscale': 10,
    'qwen-image-2-1': 40,
    'qwen-image-3-0': 45,
    'recraft-creative-upscale': 400,
    'recraft-crisp-upscale': 10,
    'recraft-v4': 15,
    'recraft-v4-1': 20,
    'runway-gen4-image': 80,
    'sam-3d': 40,
    'seedream-4-0': 15,
    'seedream-4-5': 20,

    'sora-2': 150,
    'seedance-1-0': 100,
    'seedance-1-5-pro': 120,
    'seedance-2-0-apimart': 100,
    'pruna-ai-p-video-2-pro': 70
};

// 🏷 Названия моделей с емким описанием
const MODEL_NAMES = {
    // 🟢 Текстовые
    'flash': 'Gemini 3.8 Flash ⚡️ (Текст/код) 📝',
    'flash_25': 'Gemini 2.5 Flash 🚀 (Быстрый текст) 📝',
    'pro': 'Gemini 3.1 Pro 🧠 (Аналитика/код) 📝',

    // 🎵 Аудио
    'qwen3-tts': 'Qwen3 TTS 🗣 (Озвучка текста) 📝',
    'qwen3-tts-flash': 'Qwen3 TTS Flash ⚡️ (Быстрая озвучка) 📝',

    // 🖼 Картинки, 3D и Апскейл
    'nanobanana': 'Nano Banana 2 🎨 (Генерация/арт) 📝/📷',
    'nanobanana_pro': 'Nano Banana Pro 💎 (Про-фото) 📝/📷',
    'phota-enhance': 'Phota Enhance 🪄 (Улучшение) 📷!',
    'p-image-upscale': 'Pruna Upscale 🔍 (Резкость фото) 📷!',
    'qwen-image-2-1': 'Qwen Image 2.1 🎨 (Арт/фото) 📝/📷',
    'qwen-image-3-0': 'Qwen Image 3.0 🎨 (Арт/фото) 📝/📷',
    'recraft-creative-upscale': 'Recraft Creative 🖼 (Креатив апскейл) 📷!',
    'recraft-crisp-upscale': 'Recraft Crisp 🔍 (Четкий апскейл) 📷!',
    'recraft-v4': 'Recraft V4 🎨 (Вектор/растр) 📝/📷',
    'recraft-v4-1': 'Recraft V4.1 🎨 (Улучшенный V4) 📝/📷',
    'runway-gen4-image': 'Runway Gen4 🖼 (Реализм фото) 📝/📷',
    'sam-3d': 'SAM 3D 🧊 (Фото в 3D) 📷!',
    'seedream-4-0': 'Seedream 4.0 🌈 (Генерация фото) 📝/📷',
    'seedream-4-5': 'Seedream 4.5 🌈 (Продвинутый арт) 📝/📷',

    // 🎬 Видео и Анимация
    'sora-2': 'Sora 2.0 🌟 (Анимация фото) 📷!',
    'seedance-1-0': 'Seedance 1.0 💃 (Анимация тела) 📷!',
    'seedance-1-5-pro': 'Seedance 1.5 Pro 💃 (Видео из фото) 📷!',
    'seedance-2-0-apimart': 'Seedance 2.0 💃 (Быстрое видео) 📷!',
    'pruna-ai-p-video-2-pro': 'Pruna Video 2 Pro ⚡ (Генерация видео) 📷!'
};

const CREDIT_PACKAGES = {
    'pack_100': { credits: 100, price: 100, title: '100 кредитов' },
    'pack_500': { credits: 500, price: 500, title: '500 кредитов' },
    'pack_1000': { credits: 1000, price: 1000, title: '1000 кредитов' },
    'pack_2500': { credits: 2500, price: 2500, title: '2500 кредитов' }
};

const WEBAPP_URL = (process.env.WEBAPP_URL || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app').replace(/\/$/, '') + '?v=6';

const mainKeyboard = Markup.keyboard([
    [Markup.button.webApp('📱 Кабинет', WEBAPP_URL)],
    ['🤖 Модель', '💳 Баланс'],
    ['💰 Пополнить', '💬 Поддержка'],
    ['ℹ Справка']
]).resize();

async function getUserBalance(userId) {
    try {
        return await db.getUserBalance(userId);
    } catch (error) {
        console.error('❌ Ошибка чтения баланса:', error.message);
        return 0;
    }
}

async function deductUserBalance(userId, cost) {
    try {
        const newBalance = await db.updateBalance(userId, -cost);
        return newBalance !== null;
    } catch (error) {
        console.error('❌ Ошибка списания:', error.message);
        return false;
    }
}

async function addUserBalance(userId, amount) {
    try {
        const newBalance = await db.updateBalance(userId, amount);
        return newBalance !== null;
    } catch (error) {
        console.error('❌ Ошибка начисления:', error.message);
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

const MODEL_GROUPS = {
    text: ['flash', 'flash_25', 'pro'],
    audio: ['qwen3-tts', 'qwen3-tts-flash'],
    image: [
        'nanobanana', 'nanobanana_pro', 'qwen-image-2-1', 'qwen-image-3-0',
        'recraft-v4', 'recraft-v4-1', 'runway-gen4-image', 'seedream-4-0', 'seedream-4-5'
    ],
    fix: [
        'phota-enhance', 'p-image-upscale', 'recraft-creative-upscale',
        'recraft-crisp-upscale', 'sam-3d'
    ],
    video: [
        'sora-2', 'seedance-1-0', 'seedance-1-5-pro',
        'seedance-2-0-apimart', 'pruna-ai-p-video-2-pro'
    ]
};

const MODEL_SHORT = {
    flash: 'Flash', flash_25: 'Flash 2.5', pro: 'Pro',
    'qwen3-tts': 'Озвучка', 'qwen3-tts-flash': 'Озвучка быстрая',
    nanobanana: 'Nano Banana', nanobanana_pro: 'Nano Pro',
    'qwen-image-2-1': 'Qwen 2.1', 'qwen-image-3-0': 'Qwen 3.0',
    'recraft-v4': 'Recraft 4', 'recraft-v4-1': 'Recraft 4.1',
    'runway-gen4-image': 'Runway', 'seedream-4-0': 'Seedream 4', 'seedream-4-5': 'Seedream 4.5',
    'phota-enhance': 'Улучшить фото', 'p-image-upscale': 'Резкость',
    'recraft-creative-upscale': 'Апскейл креатив', 'recraft-crisp-upscale': 'Апскейл чёткий',
    'sam-3d': 'Фото в 3D',
    'sora-2': 'Sora 2', 'seedance-1-0': 'Seedance 1', 'seedance-1-5-pro': 'Seedance 1.5',
    'seedance-2-0-apimart': 'Seedance 2', 'pruna-ai-p-video-2-pro': 'Pruna Video'
};

function modelButton(key, currentMode) {
    const mark = key === currentMode ? '✅ ' : '';
    const cost = MODEL_COSTS[key];
    const title = MODEL_SHORT[key] || key;
    return Markup.button.callback(`${mark}${cost} кр · ${title}`, `set_model_${key}`);
}

function rowsOf(keys, currentMode) {
    const rows = [];
    for (let i = 0; i < keys.length; i += 2) {
        const row = [modelButton(keys[i], currentMode)];
        if (keys[i + 1]) row.push(modelButton(keys[i + 1], currentMode));
        rows.push(row);
    }
    return rows;
}

function getModelSelectionKeyboard(currentMode) {
    const now = MODEL_SHORT[currentMode] || currentMode;
    const cost = MODEL_COSTS[currentMode] || '';
    return Markup.inlineKeyboard([
        [Markup.button.callback('💬 Текст', 'models_text'), Markup.button.callback('🎵 Голос', 'models_audio')],
        [Markup.button.callback('🎨 Картинки', 'models_image'), Markup.button.callback('✨ Улучшить', 'models_fix')],
        [Markup.button.callback('🎬 Видео', 'models_video')],
        [Markup.button.callback(`Сейчас: ${now} · ${cost} кр`, 'noop_current')]
    ]);
}

function getGroupKeyboard(group, currentMode) {
    const rows = rowsOf(MODEL_GROUPS[group] || [], currentMode);
    rows.push([Markup.button.callback('← Разделы', 'models_home')]);
    return Markup.inlineKeyboard(rows);
}

const GROUP_TITLES = {
    text: '💬 Текст',
    audio: '🎵 Голос',
    image: '🎨 Картинки',
    fix: '✨ Улучшить фото',
    video: '🎬 Видео'
};

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
        await db.initDB();
        console.log('✅ База данных PostgreSQL инициализирована');
    } catch (e) {
        console.error('❌ Критическая ошибка инициализации БД:', e.message);
        // Можно продолжить работу, но балансы будут 0
    }

    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        console.log('🧹 Старый вебхук сброшен, запущен Long Polling.');
    } catch (e) {
        console.log('ℹ️ Вебхук:', e.message);
    }

    if (app) {
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
        userPendingBratukhaRequests.delete(ctx.from.id);
        if (await db.isBlocked(ctx.from.id)) {
            await ctx.reply('Доступ к боту ограничен. Напишите в поддержку, если это ошибка.');
            return;
        }
        const savedModel = await db.getCurrentModel(ctx.from.id);
        userActiveMode.set(ctx.from.id, savedModel || 'flash');
        const currentMode = userActiveMode.get(ctx.from.id);
        const balance = await getUserBalance(ctx.from.id);

        await ctx.reply(
            `🤖 *Главное меню бота*\n\n` +
            `💳 Ваш баланс: *${balance} кредитов*\n` +
            `🎯 Текущая модель: *${MODEL_NAMES[currentMode] || currentMode}*\n\n` +
            `Кабинет открывается кнопкой под этим сообщением или кнопкой «Кабинет» слева от поля ввода.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('📱 Открыть кабинет', WEBAPP_URL)]
                ])
            }
        );
        await ctx.reply('Меню:', mainKeyboard);
        try {
            await ctx.telegram.setChatMenuButton({
                chat_id: ctx.chat.id,
                menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: WEBAPP_URL } }
            });
        } catch (e) {}
    });

    bot.hears(['💳 Баланс', '💳 Мой баланс', '💳 Баланс'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        const balance = await getUserBalance(ctx.from.id);
        const currentMode = userActiveMode.get(ctx.from.id) || 'flash';
        await ctx.reply(
            `💳 *Баланс:* ${balance} кр.\nМодель: ${MODEL_NAMES[currentMode] || currentMode}`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💰 Пополнить баланс', 'action_buy_credits')]
                ])
            }
        );
    });

    bot.hears(['🤖 Модель', '🤖 Выбрать модель ИИ', '🤖 Модели'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        const currentMode = userActiveMode.get(ctx.from.id) || 'flash';
        await ctx.reply('Выберите раздел, потом модель.', getModelSelectionKeyboard(currentMode));
    });

    bot.action(/^models_(text|audio|image|fix|video|home)$/, async (ctx) => {
        const group = ctx.match[1];
        const currentMode = userActiveMode.get(ctx.from.id) || 'flash';
        await ctx.answerCbQuery();
        const title = group === 'home' ? 'Выберите раздел, потом модель.' : (GROUP_TITLES[group] || 'Модели');
        const kb = group === 'home' ? getModelSelectionKeyboard(currentMode) : getGroupKeyboard(group, currentMode);
        try {
            await ctx.editMessageText(title, kb);
        } catch (e) {}
    });

    bot.hears(['💰 Пополнить', '💰 Пополнить баланс'], async (ctx) => {
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

    bot.action(/^noop_.+$/, async (ctx) => {
        await ctx.answerCbQuery('Это название раздела, выберите модель ниже 👇');
    });

    bot.hears(['ℹ Справка', 'ℹ️ Справка'], async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        userAwaitingSupport.delete(ctx.from.id);
        await ctx.reply(
            `Здравствуйте! Я — универсальный ИИ-помощник.\n\n` +
            `Вот чем я могу вам помочь:\n` +
            `• Генерация текста, кодинг и аналитика\n` +
            `• Создание изображений, апскейл и 3D-моделирование\n` +
            `• Создание и анимация видеоклипов\n` +
            `• Озвучка текста и генерация музыки\n\n` +
            `Просто выберите нужную модель и отправьте текстовый запрос или файл!`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.action('action_choose_ai', async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        await ctx.answerCbQuery();
        const currentMode = userActiveMode.get(ctx.from.id) || 'flash';
        await ctx.reply('Выберите раздел, потом модель.', getModelSelectionKeyboard(currentMode));
    });

    bot.action(/^set_model_(.+)$/, async (ctx) => {
        userAwaitingEmail.delete(ctx.from.id);
        const selectedModel = ctx.match[1];

        if (MODEL_NAMES[selectedModel]) {
            userActiveMode.set(ctx.from.id, selectedModel);
            await ctx.answerCbQuery(`Выбрано: ${MODEL_SHORT[selectedModel] || selectedModel}`);
            const done = `Выбрано: ${MODEL_SHORT[selectedModel] || selectedModel} · ${MODEL_COSTS[selectedModel]} кр. Можно писать запрос.`;
            try {
                await ctx.editMessageText(done, getModelSelectionKeyboard(selectedModel));
            } catch (e) {
                await ctx.reply(done);
            }
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

    // 📐 Обработчик кнопок выбора соотношения сторон (размера) для Братухи
    bot.action(/^brat_ratio_(.+)$/, async (ctx) => {
        const userId = ctx.from.id;
        const ratio = ctx.match[1];

        if (ratio === 'cancel') {
            userPendingBratukhaRequests.delete(userId);
            await ctx.answerCbQuery('Отменено');
            await ctx.editMessageText('❌ Генерация отменена.');
            return;
        }

        const pending = userPendingBratukhaRequests.get(userId);
        if (!pending) {
            await ctx.answerCbQuery('⚠️ Запрос не найден или устарел.');
            await ctx.editMessageText('⚠️ Время ожидания запроса истекло. Отправьте запрос заново.');
            return;
        }

        userPendingBratukhaRequests.delete(userId);
        await ctx.answerCbQuery(`Выбран размер: ${ratio}`);
        try {
            await ctx.deleteMessage();
        } catch (e) {}

        const { prompt, fileBuffers, currentMode, cost } = pending;
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

        userProcessing.add(userId);
        const waitMessage = await ctx.reply(
            `⏳ *Генерирую ответ (формат: ${ratio})...* (Видео/сложные генерации могут занять 1–3 минуты)`, 
            { parse_mode: 'Markdown' }
        );

        try {
            const aiResult = await bratukhaPlugin.processRequest({
                prompt,
                fileBuffer: fileBuffers.length === 1 ? fileBuffers[0] : null,
                fileBuffers: fileBuffers.length > 1 ? fileBuffers : undefined,
                mimeType: 'image/jpeg',
                modelKey: currentMode,
                aspectRatio: ratio
            });

            await deductUserBalance(userId, cost);
            const remainingBalance = await getUserBalance(userId);

            try { await ctx.deleteMessage(waitMessage.message_id); } catch(e){}

            if (aiResult.type === 'image' && aiResult.buffer) {
                await ctx.replyWithPhoto(
                    { source: aiResult.buffer }, 
                    { caption: `${aiResult.text || ''}\n\n📐 Размер: ${ratio} | 💳 Списано: ${cost} кр. | Остаток: ${remainingBalance} кр.` }
                );
            } else if (aiResult.type === 'video' && aiResult.buffer) {
                await ctx.replyWithVideo(
                    { source: aiResult.buffer },
                    { caption: `${aiResult.text || ''}\n\n📐 Размер: ${ratio} | 💳 Списано: ${cost} кр. | Остаток: ${remainingBalance} кр.` }
                );
            } else if (aiResult.type === 'audio' && aiResult.buffer) {
                await ctx.replyWithAudio(
                    { source: aiResult.buffer },
                    { caption: `${aiResult.text || ''}\n\n📐 Размер: ${ratio} | 💳 Списано: ${cost} кр. | Остаток: ${remainingBalance} кр.` }
                );
            } else {
                const fullText = `${aiResult.text}\n\n───────────────\n📐 *Размер:* ${ratio} | 💳 *Списано:* ${cost} кр. | *Остаток:* ${remainingBalance} кр.`;
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
    });

    const handleAiRequest = async (ctx) => {
        const text = ctx.message?.text || '';
        if (['🤖 Модель', '🤖 Выбрать модель ИИ', '💳 Мой баланс', '💳 Баланс', '💰 Пополнить', '💰 Пополнить баланс', '💬 Поддержка', 'ℹ Справка', 'ℹ️ Справка', '🤖 Модели'].includes(text)) {
            return;
        }

        const userId = ctx.from.id;
        const stringUserId = String(userId);

        if (await db.isBlocked(userId)) {
            await ctx.reply('Доступ ограничен. Генерации для этого аккаунта выключены.');
            return;
        }

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
                await ctx.reply('⚠ Не удалось отправить сообщение в поддержку. Попробуйте позже.');
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

        let currentMode = await db.getCurrentModel(userId) || userActiveMode.get(userId) || 'flash';
        userActiveMode.set(userId, currentMode);
        if (currentMode === 'veo' || !MODEL_NAMES[currentMode]) {
            currentMode = 'flash';
            userActiveMode.set(userId, 'flash');
            await db.setCurrentModel(userId, 'flash');
        }

        let fileBuffers = [];
        let mimeType = 'image/jpeg';

        if (ctx.message?.photo && ctx.message.photo.length > 0) {
            const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
            const buf = await getTelegramFileBuffer(ctx, largestPhoto.file_id);
            if (buf) fileBuffers.push(buf);
        }

        if (REQUIRES_IMAGE_MODELS.includes(currentMode) && fileBuffers.length === 0) {
            return ctx.reply(
                '⚠️ *Ошибка:* Выбранная модель требует обязательного наличия *изображения*.\n\n' +
                '📸 Пожалуйста, прикрепите фото и напишите текстовое описание (промпт) в подписи к нему.', 
                { parse_mode: 'Markdown' }
            );
        }

        if (REQUIRES_TEXT_MODELS.includes(currentMode) && !prompt.trim()) {
            return ctx.reply('⚠️ *Ошибка:* Для выбранной модели требуется текстовое описание.');
        }

        if (!prompt.trim() && fileBuffers.length === 0) {
            return ctx.reply('⚠️ *Ошибка:* Пожалуйста, отправьте текстовое описание или прикрепите фото.');
        }

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

        // 📐 Если модель Братухи поддерживает соотношение сторон — запрашиваем размер кнопками
        if (activePlugin === bratukhaPlugin && BRATUKHA_RATIO_MODELS.includes(currentMode)) {
            userPendingBratukhaRequests.set(userId, { prompt, fileBuffers, currentMode, cost });

            const ratioKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('1:1', 'brat_ratio_1:1'), Markup.button.callback('16:9', 'brat_ratio_16:9'), Markup.button.callback('9:16', 'brat_ratio_9:16')],
                [Markup.button.callback('4:3', 'brat_ratio_4:3'), Markup.button.callback('3:4', 'brat_ratio_3:4'), Markup.button.callback('3:2', 'brat_ratio_3:2')],
                [Markup.button.callback('2:3', 'brat_ratio_2:3'), Markup.button.callback('21:9', 'brat_ratio_21:9'), Markup.button.callback('9:21', 'brat_ratio_9:21')],
                [Markup.button.callback('🤖 Auto (По умолчанию)', 'brat_ratio_auto')],
                [Markup.button.callback('❌ Отмена', 'brat_ratio_cancel')]
            ]);

            return ctx.reply(
                `📐 *Выберите соотношение сторон (размер) для модели ${MODEL_NAMES[currentMode] || currentMode}:*`,
                { parse_mode: 'Markdown', ...ratioKeyboard }
            );
        }

        // Обычная логика выполнения (для Google, аудио, апскейлеров и 3D)
        userProcessing.add(userId);
        const waitMessage = await ctx.reply(
            `⏳ *Генерирую ответ...*`, 
            { parse_mode: 'Markdown' }
        );

        try {
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
            } else if (aiResult.type === 'audio' && aiResult.buffer) {
                await ctx.replyWithAudio(
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
        if (await db.isBlocked(userId)) {
            return firstCtx.reply('Доступ ограничен. Генерации для этого аккаунта выключены.');
        }

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

        let currentMode = await db.getCurrentModel(userId) || userActiveMode.get(userId) || 'flash';
        userActiveMode.set(userId, currentMode);
        if (currentMode === 'veo' || !MODEL_NAMES[currentMode]) {
            currentMode = 'flash';
            userActiveMode.set(userId, 'flash');
            await db.setCurrentModel(userId, 'flash');
        }

        let fileBuffers = [];
        let mimeType = 'image/jpeg';

        for (const c of contexts) {
            if (c.message?.photo && c.message.photo.length > 0) {
                const largestPhoto = c.message.photo[c.message.photo.length - 1];
                const buf = await getTelegramFileBuffer(firstCtx, largestPhoto.file_id);
                if (buf) fileBuffers.push(buf);
            }
        }

        if (REQUIRES_IMAGE_MODELS.includes(currentMode) && fileBuffers.length === 0) {
            return firstCtx.reply(
                '⚠️ *Ошибка:* Выбранная модель требует обязательного наличия *изображения*.\n\n' +
                '📸 Пожалуйста, прикрепите фото и напишите текстовое описание (промпт) в подписи к нему.', 
                { parse_mode: 'Markdown' }
            );
        }

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

        // 📐 Если модель Братухи поддерживает соотношение сторон — запрашиваем размер кнопками для альбомов
        if (activePlugin === bratukhaPlugin && BRATUKHA_RATIO_MODELS.includes(currentMode)) {
            userPendingBratukhaRequests.set(userId, { prompt, fileBuffers, currentMode, cost });

            const ratioKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('1:1', 'brat_ratio_1:1'), Markup.button.callback('16:9', 'brat_ratio_16:9'), Markup.button.callback('9:16', 'brat_ratio_9:16')],
                [Markup.button.callback('4:3', 'brat_ratio_4:3'), Markup.button.callback('3:4', 'brat_ratio_3:4'), Markup.button.callback('3:2', 'brat_ratio_3:2')],
                [Markup.button.callback('2:3', 'brat_ratio_2:3'), Markup.button.callback('21:9', 'brat_ratio_21:9'), Markup.button.callback('9:21', 'brat_ratio_9:21')],
                [Markup.button.callback('🤖 Auto (По умолчанию)', 'brat_ratio_auto')],
                [Markup.button.callback('❌ Отмена', 'brat_ratio_cancel')]
            ]);

            return firstCtx.reply(
                `📐 *Выберите соотношение сторон (размер) для модели ${MODEL_NAMES[currentMode] || currentMode}:*`,
                { parse_mode: 'Markdown', ...ratioKeyboard }
            );
        }

        userProcessing.add(userId);
        const waitMessage = await firstCtx.reply(`⏳ *Генерирую ответ...*`, { parse_mode: 'Markdown' });

        try {
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

    bot.on('message', async (ctx, next) => {
        const raw = ctx.message?.web_app_data?.data;
        if (!raw) return next();
        let payload = null;
        try { payload = JSON.parse(raw); } catch (e) { payload = { action: 'buy_credits' }; }
        if (await db.isBlocked(ctx.from.id)) {
            await ctx.reply('Доступ ограничен.');
            return;
        }
        if (payload.action === 'run_template' && payload.prompt) {
            const model = payload.model || 'flash';
            userActiveMode.set(ctx.from.id, model);
            await db.setCurrentModel(ctx.from.id, model);
            ctx.message.text = payload.prompt;
            await ctx.reply(`Запускаю шаблон «${payload.title || 'шаблон'}».`);
            return handleAiRequest(ctx);
        }
        await ctx.reply('Выберите пакет кредитов:', Markup.inlineKeyboard(
            Object.keys(CREDIT_PACKAGES).map(pkgKey => {
                const pkg = CREDIT_PACKAGES[pkgKey];
                return [Markup.button.callback(`💳 ${pkg.title} — ${pkg.price} ₽`, `buy_pkg_${pkgKey}`)];
            })
        ));
    });

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
                    }, 1000)
                });
            } else {
                mediaGroupBuffers.get(mediaGroupId).contexts.push(ctx);
            }
        } else {
            return handleAiRequest(ctx);
        }
    });

    bot.launch().then(async () => {
        console.log('🤖 Бот успешно запущен!');
        try {
            await bot.telegram.setChatMenuButton({
                menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: WEBAPP_URL } }
            });
            console.log('✅ Кнопка меню Mini App установлена:', WEBAPP_URL);
        } catch (e) {
            console.error('❌ Не удалось поставить кнопку меню:', e.message);
        }
    }).catch(err => {
        console.error('❌ Ошибка запуска бота:', err);
    });
}

module.exports = { startBot };