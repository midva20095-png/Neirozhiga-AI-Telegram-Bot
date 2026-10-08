const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Пути к данным
const DB_PATH = path.join(__dirname, '../db.json');
const TEMPLATES_PATH = path.join(__dirname, '../templates.json');

// Импорт плагинов ИИ из папки ai_plugins
const geminiPlugin = require('../ai_plugins/google_gemini_plugin');
const bratukhaPlugin = require('../ai_plugins/bratukha_plugin');

// Проверка подлинности Telegram WebApp InitData
function verifyTelegramWebAppData(telegramInitData, botToken) {
    if (!telegramInitData) return null;
    try {
        const urlParams = new URLSearchParams(telegramInitData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const paramsSym = Array.from(urlParams.entries())
            .map(([key, val]) => `${key}=${val}`)
            .sort()
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(paramsSym).digest('hex');

        if (calculatedHash === hash) {
            const userStr = urlParams.get('user');
            return userStr ? JSON.parse(userStr) : null;
        }
    } catch (err) {
        console.error('Ошибка валидации initData:', err);
    }
    return null;
}

// Middleware аутентификации
function authMiddleware(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];
    const botToken = process.env.BOT_TOKEN;

    const user = verifyTelegramWebAppData(initData, botToken);
    if (!user) {
        return res.status(401).json({ error: 'Неавторизованный запрос' });
    }
    req.telegramUser = user;
    next();
}

// 1. Получение профиля и баланса
router.get('/profile', authMiddleware, (req, res) => {
    const userId = req.telegramUser.id;
    let db = {};
    if (fs.existsSync(DB_PATH)) {
        db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
    res.json({
        user: req.telegramUser,
        balance: db[userId] !== undefined ? db[userId] : 0
    });
});

// 2. Каталог доступных моделей
router.get('/models', (req, res) => {
    res.json([
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', category: 'text', cost: 1, desc: 'Быстрые ответы и обработка текста' },
        { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', category: 'text', cost: 3, desc: 'Сложный анализ и логика' },
        { id: 'recraft-v4', name: 'Recraft V4', category: 'image', cost: 10, desc: 'Дизайн, векторная графика, текст на фото' },
        { id: 'seedream-4.5', name: 'Seedream 4.5', category: 'image', cost: 12, desc: 'Ультрареалистичные фото' },
        { id: 'veo-3.1', name: 'Google Veo 3.1', category: 'video', cost: 400, desc: 'Генерация кинематографичных видео' },
        { id: 'sora-2.0', name: 'Sora 2.0', category: 'video', cost: 350, desc: 'Реалистичные видеоролики' },
        { id: 'sam-3d', name: 'SAM 3D', category: '3d', cost: 50, desc: 'Преобразование фото в 3D' },
        { id: 'qwen3-tts', name: 'Qwen3 TTS', category: 'audio', cost: 5, desc: 'Озвучка текста' }
    ]);
});

// 3. Получить список шаблонов
router.get('/templates', authMiddleware, (req, res) => {
    let templates = [];
    if (fs.existsSync(TEMPLATES_PATH)) {
        templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    }
    const userTemplates = templates.filter(t => t.isPublic || String(t.userId) === String(req.telegramUser.id));
    res.json(userTemplates);
});

// 4. Создать свой шаблон
router.post('/templates', authMiddleware, (req, res) => {
    const { title, promptPattern, variables } = req.body;
    if (!title || !promptPattern) return res.status(400).json({ error: 'Заполните поля' });

    let templates = [];
    if (fs.existsSync(TEMPLATES_PATH)) {
        templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    }

    const newTpl = {
        id: 'tpl_' + Date.now(),
        userId: req.telegramUser.id,
        title,
        promptPattern,
        variables: variables || [],
        isPublic: false,
        createdAt: new Date().toISOString()
    };

    templates.push(newTpl);
    fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
    res.json({ success: true, template: newTpl });
});

// 5. Запуск генерации из Mini App
router.post('/generate', authMiddleware, async (req, res) => {
    const userId = req.telegramUser.id;
    const { modelId, prompt, aspectRatio, imageBase64 } = req.body;

    let db = {};
    if (fs.existsSync(DB_PATH)) {
        db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
    const balance = db[userId] || 0;

    const costs = {
        'gemini-2.5-flash': 1, 'gemini-3.1-pro': 3,
        'recraft-v4': 10, 'seedream-4.5': 12,
        'veo-3.1': 400, 'sora-2.0': 350,
        'sam-3d': 50, 'qwen3-tts': 5
    };
    const cost = costs[modelId] || 10;

    if (balance < cost) {
        return res.status(400).json({ error: `Недостаточно кредитов. Нужно: ${cost}, Баланс: ${balance}` });
    }

    try {
        // Списываем кредиты
        db[userId] = balance - cost;
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

        let resultUrl = null;
        if (modelId.startsWith('gemini')) {
            resultUrl = await geminiPlugin.generateTextOrImage(prompt, modelId);
        } else {
            resultUrl = await bratukhaPlugin.generateContent({
                model: modelId,
                prompt,
                aspectRatio: aspectRatio || '1:1',
                image: imageBase64
            });
        }

        res.json({
            success: true,
            newBalance: db[userId],
            resultUrl: resultUrl || 'Генерация завершена!'
        });
    } catch (err) {
        // Откат баланса в случае ошибки
        db[userId] = balance;
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
        res.status(500).json({ error: 'Ошибка генерации: ' + err.message });
    }
});

module.exports = router;