const express = require('express');
const path = require('path');
const db = require('../core/db');
const { generate } = require('../core/generate');

function startWebApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));

    const publicPath = path.join(__dirname, '../public');
    app.use(express.static(publicPath));

    app.get('/', (req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(publicPath, 'admin.html'));
    });

    app.get('/api/me', async (req, res) => {
        try {
            const userId = req.query.userId || req.headers['x-telegram-user-id'];
            if (!userId || !/^\d+$/.test(String(userId))) return res.status(400).json({ error: 'userId required' });
            const user = await db.getUser(userId);
            const history = await db.listHistory(userId, 40);
            res.json({
                user_id: user.user_id,
                balance: user.balance,
                current_model: user.current_model || 'flash',
                blocked: !!user.blocked,
                history
            });
        } catch (e) {
            console.error('API /api/me error:', e.message);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    app.get('/api/templates', async (req, res) => {
        try {
            const templates = await db.listTemplates(false);
            res.json({ templates });
        } catch (e) {
            res.status(500).json({ error: e.message, templates: [] });
        }
    });

    app.post('/api/set-model', async (req, res) => {
        try {
            const { userId, model } = req.body;
            if (!userId || !model) return res.status(400).json({ error: 'userId and model required' });
            const user = await db.getUser(userId);
            if (user.blocked) return res.status(403).json({ error: 'blocked' });
            const ok = await db.setCurrentModel(userId, model);
            res.json({ success: !!ok, model });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/generate', async (req, res) => {
        try {
            const { userId, prompt, model } = req.body || {};
            if (!userId || !/^\d+$/.test(String(userId))) return res.status(400).json({ error: 'userId required' });
            if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Введите промпт' });
            const result = await generate({ userId, prompt: String(prompt).trim(), model });
            res.json(result);
        } catch (e) {
            console.error('API /api/generate error:', e.message);
            res.status(400).json({ error: e.message || 'Ошибка генерации' });
        }
    });

    app.get('/api/admin/users', async (req, res) => {
        try {
            const q = (req.query.q || '').toString();
            const result = await db.pool.query(
                `SELECT user_id, balance, current_model, blocked, created_at
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
            const newBalance = await db.updateBalance(userId, Number(delta), reason || 'Админ');
            res.json({ ok: newBalance !== null, balance: newBalance });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/block', async (req, res) => {
        try {
            const { userId, blocked } = req.body;
            if (!userId || !/^\d+$/.test(String(userId))) return res.status(400).json({ error: 'userId required' });
            let next = blocked;
            if (typeof next !== 'boolean') {
                const user = await db.getUser(userId);
                next = !user.blocked;
            }
            await db.setBlocked(userId, next);
            res.json({ ok: true, blocked: next });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/templates', async (req, res) => {
        try {
            res.json({ templates: await db.listTemplates(true) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/templates', async (req, res) => {
        try {
            const { title, prompt } = req.body || {};
            if (!title || !prompt) return res.status(400).json({ error: 'title and prompt required' });
            const row = await db.saveTemplate(req.body);
            res.json({ ok: true, template: row });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/templates/delete', async (req, res) => {
        try {
            await db.deleteTemplate(req.body.id);
            res.json({ ok: true });
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
