// ui_modules/api_routes.js
const express = require('express');
const router = express.Router();
const { getBalanceFromSheets, changeBalanceInSheets } = require('../core/sheets');

// Промежуточный обработчик (middleware) авторизации/получения ID пользователя
const authMiddleware = (req, res, next) => {
    // Извлекаем userId из заголовка x-user-id, query-параметров или тела запроса
    const userId = req.headers['x-user-id'] || req.query.userId || req.body?.userId;

    if (!userId) {
        return res.status(401).json({ error: 'Необходим userId' });
    }

    req.telegramUser = { id: userId };
    next();
};

// 1. Получение профиля и баланса из Google Таблицы
router.get('/profile', authMiddleware, async (req, res) => {
    const userId = req.telegramUser.id;
    
    try {
        const currentBalance = await getBalanceFromSheets(userId);

        res.json({
            user: req.telegramUser,
            balance: Number(currentBalance) || 0
        });
    } catch (err) {
        console.error('Ошибка чтения Google Sheets:', err);
        res.status(500).json({ error: 'Не удалось получить баланс из таблицы' });
    }
});

// 2. Запуск генерации со списанием баланса
router.post('/generate', authMiddleware, async (req, res) => {
    const userId = req.telegramUser.id;
    const { modelId, prompt, aspectRatio, imageBase64 } = req.body;

    try {
        const balance = await getBalanceFromSheets(userId);

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

        // Списываем кредиты в Google Таблице (передаем отрицательную дельту)
        const updated = await changeBalanceInSheets(userId, -cost);
        if (!updated) {
            return res.status(500).json({ error: 'Не удалось списать кредиты с баланса' });
        }

        const newBalance = balance - cost;

        let resultUrl = null;
        if (modelId.startsWith('gemini')) {
            resultUrl = await googlePlugin.generateTextOrImage(prompt, modelId);
        } else {
            resultUrl = await bratukhaPlugin.processRequest({
                modelKey: modelId,
                prompt,
                aspectRatio: aspectRatio || '1:1',
                fileBuffer: imageBase64 ? Buffer.from(imageBase64, 'base64') : null
            });
        }

        res.json({
            success: true,
            newBalance: newBalance,
            resultUrl: resultUrl?.text || resultUrl || 'Генерация завершена!'
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка: ' + err.message });
    }
});

module.exports = router;