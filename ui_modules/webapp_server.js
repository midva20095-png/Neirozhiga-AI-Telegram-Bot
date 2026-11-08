const express = require('express');
const path = require('path');
const db = require('../core/db');

function startWebApp() {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const publicPath = path.join(__dirname, '../public');

    // Статика
    app.use(express.static(publicPath));

    // Главная страница — мини-приложение
    app.get('/', (req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });

    // Админка
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(publicPath, 'admin.html'));
    });
    app.get('/admin.html', (req, res) => {
        res.sendFile(path.join(publicPath, 'admin.html'));
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

    // Админка API
    app.get('/api/admin/users', async (req, res) => {
        try {
            const q = (req.query.q || '').toString();
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
            const { userId, delta } = req.body;
            if (!userId || delta === undefined) return res.status(400).json({ error: 'userId and delta required' });
            const newBalance = await db.updateBalance(userId, Number(delta));
            res.json({ ok: true, balance: newBalance });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/block', async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId required' });
            // Простая блокировка через поле blocked (нужно добавить колонку)
            await db.pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false`);
            const cur = await db.pool.query(`SELECT blocked FROM users WHERE user_id = $1`, [userId]);
            const newBlocked = !(cur.rows[0]?.blocked);
            await db.pool.query(`UPDATE users SET blocked = $1 WHERE user_id = $2`, [newBlocked, userId]);
            res.json({ ok: true, blocked: newBlocked });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    const PORT = process.env.PORT || 10000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`📱 Интерфейс и Мини-приложение запущены на порту ${PORT}`);
    });

    return app;
}

module.exports = { startWebApp };
