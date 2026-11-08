const express = require('express');
const path = require('path');
const db = require('../core/db');

function startWebApp() {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Статика мини-приложения
    app.use(express.static(path.join(__dirname, '../public')));

    // Явно отдаём index.html на корне
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    });

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

    // Админка
    app.get('/api/admin/users', async (req, res) => {
        try {
            const q = req.query.q || '';
            const result = await db.pool.query(
                `SELECT user_id, balance, current_model, created_at 
                 FROM users 
                 WHERE user_id::text ILIKE $1 
                 ORDER BY created_at DESC 
                 LIMIT 100`,
                [`%${q}%`]
            );
            res.json({ users: result.rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/balance', async (req, res) => {
        try {
            const { userId, delta, reason } = req.body;
            if (!userId || delta === undefined) return res.status(400).json({ error: 'userId and delta required' });
            const newBalance = await db.updateBalance(userId, delta);
            res.json({ ok: true, balance: newBalance, reason });
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
