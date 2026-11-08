const express = require('express');
const path = require('path');
const db = require('../core/db');

function startWebApp() {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Статика мини-приложения
    app.use(express.static(path.join(__dirname, '../public')));

    // API для мини-приложения
    app.get('/api/me', async (req, res) => {
        try {
            const userId = req.query.userId || req.headers['x-telegram-user-id'];
            if (!userId) return res.status(400).json({ error: 'userId required' });

            const user = await db.getUser(userId);
            res.json({
                user_id: user.user_id,
                balance: user.balance,
                current_model: user.current_model || 'flash'
            });
        } catch (e) {
            console.error('API /api/me error:', e.message);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    app.post('/api/set-model', async (req, res) => {
        try {
            const { userId, model } = req.body;
            if (!userId || !model) return res.status(400).json({ error: 'userId and model required' });

            const ok = await db.setCurrentModel(userId, model);
            if (ok) {
                res.json({ success: true, model });
            } else {
                res.status(500).json({ error: 'Failed to set model' });
            }
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => {
        console.log(`📱 Интерфейс и Мини-приложение запущены на порту ${PORT}`);
    });

    return app;
}

module.exports = { startWebApp };
