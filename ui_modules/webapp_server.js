const express = require('express');
const path = require('path');
const db = require('../core/db');
const catalog = require('../core/catalog');
const gen = require('../core/generate');
const auth = require('../core/auth');
const templatesSrc = require('../core/templates');
const transfer = require('../core/transfer');

// Определяет пользователя из initData Telegram или из подписанной ссылки.
function resolveUserId(req) {
    const initData = req.headers['x-telegram-init-data'] || (req.body && req.body.initData);
    if (initData) {
        const user = auth.validateInitData(initData);
        if (user) return String(user.id);
    }
    const token = req.headers['x-user-token'] || req.query.tk || (req.body && req.body.tk);
    if (token) {
        const id = auth.verifyUserToken(token);
        if (id) return id;
    }
    return null;
}

function requireUser(req, res, next) {
    const userId = resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'auth_required' });
    req.userId = userId;
    next();
}

function requireAdmin(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (auth.verifyAdminToken(token)) return next();
    return res.status(401).json({ error: 'admin_auth_required' });
}

function publicModels() {
    return catalog.listModels().map(m => ({
        key: m.key, name: m.name, short: m.short, desc: m.desc,
        group: m.group, kind: m.kind || '',
        cost: m.cost, from: catalog.fromPrice(m), label: catalog.priceLabel(m),
        image: m.image, ratio: !!m.ratio && !m.noAspect,
        aspects: m.aspects || null,
        qualities: (m.qualities || []).map(q => ({ id: q.id, name: q.name, desc: q.desc || '', cost: q.cost, perSec: !!q.perSec })),
        quality: m.quality || null,
        durations: m.durations || null,
        durationPrices: m.durationPrices || null,
        perSec: !!m.perSec,
        rate: m.rate || null,
        unit: m.unit || null,
        audio: !!m.audio,
        limit: m.limit,
        free: m.provider === 'giga' || m.cost === 0
    }));
}

function decodeImage(input) {
    const raw = String(input || '');
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(raw);
    const mime = match ? match[1] : 'image/jpeg';
    const b64 = (match ? match[2] : raw).replace(/\s/g, '');
    if (!/^[a-zA-Z0-9+/=]+$/.test(b64)) {
        const error = new Error('Некорректное фото');
        error.code = 'image';
        throw error;
    }
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length || buffer.length > 7 * 1024 * 1024) {
        const error = new Error('Фото слишком большое. Выберите снимок поменьше.');
        error.code = 'image';
        throw error;
    }
    return { buffer, mime };
}

function startWebApp() {
    const app = express();
    app.use(express.json({ limit: '12mb' }));
    app.use(express.urlencoded({ extended: true }));

    const publicPath = path.join(__dirname, '../public');
    app.use(express.static(publicPath));
    app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
    app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));

    // ---- Публичная конфигурация витрины ----
    app.get('/api/config', (req, res) => {
        const g = catalog.getGeneral();
        res.json({
            groups: catalog.GROUPS,
            models: publicModels(),
            packages: catalog.listPackages(),
            site_url: g.site_url,
            support_enabled: !!g.support_enabled,
            default_model: catalog.defaultModelKey()
        });
    });

    // ---- Пользовательские эндпоинты ----
    app.get('/api/me', requireUser, async (req, res) => {
        try {
            const user = await db.getUser(req.userId);
            const history = await db.listHistory(req.userId, 40);
            res.json({
                user_id: user.user_id,
                balance: user.balance,
                current_model: user.current_model || catalog.defaultModelKey(),
                blocked: !!user.blocked,
                history
            });
        } catch (e) {
            console.error('API /api/me:', e.message);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    app.get('/api/templates', async (req, res) => {
        try {
            res.json({ templates: await templatesSrc.listPublic() });
        } catch (e) {
            res.status(500).json({ error: e.message, templates: [] });
        }
    });

    app.post('/api/set-model', requireUser, async (req, res) => {
        try {
            const { model } = req.body || {};
            if (!model || !catalog.getModel(model)) return res.status(400).json({ error: 'model required' });
            const user = await db.getUser(req.userId);
            if (user.blocked) return res.status(403).json({ error: 'blocked' });
            await db.setCurrentModel(req.userId, model);
            res.json({ success: true, model });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/generate', requireUser, async (req, res) => {
        try {
            const body = req.body || {};
            let prompt = body.prompt ? String(body.prompt).trim() : '';
            let modelKey = body.model;
            let charge;
            let reason;
            let aspect = body.format || null;
            let keepModel = false;
            let strict = false;
            if (body.templateId) {
                const tpl = await templatesSrc.getFull(body.templateId);
                if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
                prompt = tpl.prompt || prompt;
                if (!prompt) prompt = 'Сделай изображение по прикреплённому фото';
                modelKey = tpl.model;
                charge = tpl.cost;
                reason = `Шаблон · ${tpl.title}`;
                keepModel = true;
                strict = true;
                if (!aspect && tpl.formats && tpl.formats.length === 1) aspect = tpl.formats[0];
                if (tpl.photo && !body.image) return res.status(400).json({ error: 'Прикрепите фото' });
            }
            if (!prompt && !body.image) return res.status(400).json({ error: 'Введите промпт' });
            const file = body.image ? decodeImage(body.image) : null;
            const result = await gen.generateForWeb({
                userId: req.userId,
                prompt,
                modelKey,
                fileBuffer: file && file.buffer,
                mimeType: file && file.mime,
                aspectRatio: aspect,
                duration: body.duration,
                quality: body.quality,
                charge,
                reason,
                keepModel,
                strict
            });
            res.json(result);
        } catch (e) {
            console.error('API /api/generate:', e.message);
            const code = e.code === 'busy' ? 429 : 400;
            res.status(code).json({ error: e.message || 'Ошибка генерации' });
        }
    });

    app.post('/api/support', requireUser, async (req, res) => {
        try {
            if (!catalog.getGeneral().support_enabled) return res.status(403).json({ error: 'disabled' });
            const message = String((req.body && req.body.message) || '').trim();
            if (!message) return res.status(400).json({ error: 'Введите сообщение' });
            const user = await db.getUser(req.userId);
            const ticket = await db.createTicket(req.userId, user.username, message, 'webapp');
            const bot = app.locals.bot;
            if (bot) {
                const text = `🚨 *Обращение из кабинета*\n\n👤 ID: \`${req.userId}\`\n💬 ${message}`;
                for (const adminId of auth.adminIds()) {
                    try { await bot.telegram.sendMessage(adminId, text, { parse_mode: 'Markdown' }); } catch (e) {}
                }
            }
            res.json({ ok: true, ticket_id: ticket.id });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/transfer', requireUser, async (req, res) => {
        try {
            const user = await db.getUser(req.userId);
            if (user.blocked) return res.status(403).json({ error: 'Аккаунт в чёрном списке' });
            const body = req.body || {};
            const result = await transfer.transfer({
                userId: req.userId,
                email: body.email,
                credits: body.credits
            });
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (e) {
            console.error('API /api/transfer:', e.message);
            res.status(500).json({ error: 'Не удалось перенести кредиты' });
        }
    });

    // Сайт списывает кредиты у вошедшего клиента и просит бота начислить их.
    // Ключ остаётся на серверах, в страницу Тильды его класть нельзя.
    app.post('/api/internal/credit', async (req, res) => {
        if (!transfer.acceptKey(req.headers['x-transfer-key'])) {
            return res.status(403).json({ ok: false, error: 'Перенос не настроен' });
        }
        const body = req.body || {};
        const credits = Math.round(Number(body.credits));
        const transferId = String(body.transferId || '').trim().slice(0, 80);
        const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
        const telegram = String(body.telegram || body.telegramUserId || '').trim().slice(0, 40);
        if (!(credits > 0) || credits > 1000000 || transferId.length < 8 || !email.includes('@') || !telegram) {
            return res.status(400).json({ ok: false, error: 'Некорректные данные перевода' });
        }
        try {
            const user = await db.findTelegramUser(telegram);
            if (!user) {
                return res.status(400).json({ ok: false, error: 'Такого аккаунта в боте нет. Откройте бота, нажмите /start и укажите @username.' });
            }
            if (user.ambiguous) {
                return res.status(400).json({ ok: false, error: 'Укажите числовой id Telegram: такой @username найден у нескольких людей.' });
            }
            if (user.blocked) return res.status(400).json({ ok: false, error: 'Аккаунт в боте заблокирован' });
            const done = await db.creditIncoming({ id: transferId, userId: user.user_id, email, credits });
            if (!done.ok) return res.status(400).json(done);
            return res.json({ ok: true, balance: done.balance, duplicate: !!done.duplicate, telegram: String(user.user_id) });
        } catch (e) {
            console.error('API /api/internal/credit:', e.message);
            return res.status(500).json({ ok: false, error: 'Не удалось начислить кредиты в бот' });
        }
    });

    app.post('/api/transfer-in', requireUser, async (req, res) => {
        try {
            const user = await db.getUser(req.userId);
            if (user.blocked) return res.status(403).json({ error: 'Аккаунт в чёрном списке' });
            const body = req.body || {};
            const result = await transfer.transferFromSite({
                userId: req.userId,
                email: body.email,
                password: body.password,
                credits: body.credits
            });
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (e) {
            console.error('API /api/transfer-in:', e.message);
            res.status(500).json({ error: 'Не удалось перенести кредиты' });
        }
    });

    // ---- Админка: вход ----
    app.post('/api/admin/login', (req, res) => {
        const { password, initData } = req.body || {};
        if (initData) {
            const user = auth.validateInitData(initData);
            if (user && auth.isAdminId(user.id)) return res.json({ token: auth.issueAdminToken(user.id) });
        }
        if (password && auth.checkAdminPassword(password)) {
            return res.json({ token: auth.issueAdminToken('password') });
        }
        return res.status(401).json({ error: 'Неверный пароль' });
    });

    app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

    app.get('/api/admin/stats', requireAdmin, async (req, res) => {
        try { res.json({ stats: await db.getStats() }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/users', requireAdmin, async (req, res) => {
        try {
            const q = (req.query.q || '').toString();
            const result = await db.pool.query(
                `SELECT user_id, username, balance, current_model, blocked, gens, spent, created_at, last_seen
                 FROM users
                 WHERE user_id::text ILIKE $1 OR COALESCE(username,'') ILIKE $1
                 ORDER BY last_seen DESC NULLS LAST LIMIT 100`,
                [`%${q}%`]
            );
            res.json({ users: result.rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/balance', requireAdmin, async (req, res) => {
        try {
            const { userId, delta, reason } = req.body || {};
            if (!userId || delta === undefined) return res.status(400).json({ error: 'userId and delta required' });
            const newBalance = await db.updateBalance(userId, Number(delta), reason || 'Админ');
            const bot = app.locals.bot;
            if (bot && newBalance !== null && Number(delta) !== 0) {
                const sign = Number(delta) > 0 ? `➕ Начислено ${delta}` : `➖ Списано ${Math.abs(delta)}`;
                try { await bot.telegram.sendMessage(userId, `💳 ${sign} кредитов.\nБаланс: ${newBalance} кр.`); } catch (e) {}
            }
            res.json({ ok: newBalance !== null, balance: newBalance });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/block', requireAdmin, async (req, res) => {
        try {
            const { userId, blocked } = req.body || {};
            if (!userId) return res.status(400).json({ error: 'userId required' });
            let next = blocked;
            if (typeof next !== 'boolean') next = !(await db.getUser(userId)).blocked;
            await db.setBlocked(userId, next);
            res.json({ ok: true, blocked: next });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/message', requireAdmin, async (req, res) => {
        try {
            const { userId, text } = req.body || {};
            if (!userId || !text) return res.status(400).json({ error: 'userId and text required' });
            const bot = app.locals.bot;
            if (!bot) return res.status(503).json({ error: 'bot offline' });
            await bot.telegram.sendMessage(userId, String(text), { parse_mode: 'Markdown' });
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
        try {
            const text = String((req.body && req.body.text) || '').trim();
            if (!text) return res.status(400).json({ error: 'text required' });
            const bot = app.locals.bot;
            if (!bot) return res.status(503).json({ error: 'bot offline' });
            const ids = await db.listUserIds();
            let sent = 0, failed = 0;
            for (const id of ids) {
                try { await bot.telegram.sendMessage(id, text, { parse_mode: 'Markdown' }); sent++; }
                catch (e) { failed++; }
                await new Promise(r => setTimeout(r, 40));
            }
            res.json({ ok: true, sent, failed, total: ids.length });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ---- Админка: шаблоны ----
    app.get('/api/admin/templates', requireAdmin, async (req, res) => {
        try {
            res.json({ templates: await db.listTemplates(true) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/templates', requireAdmin, async (req, res) => {
        try {
            const { title, prompt } = req.body || {};
            if (!title || !prompt) return res.status(400).json({ error: 'title and prompt required' });
            res.json({ ok: true, template: await db.saveTemplate(req.body) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/templates/delete', requireAdmin, async (req, res) => {
        try { await db.deleteTemplate(req.body.id); res.json({ ok: true }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Админка: модели / пакеты / общие настройки ----
    app.get('/api/admin/models', requireAdmin, (req, res) => {
        res.json({ models: catalog.listModels({ includeDisabled: true }), groups: catalog.GROUPS });
    });

    app.post('/api/admin/models', requireAdmin, async (req, res) => {
        try { res.json({ ok: true, models: await catalog.saveModels(db, req.body.models || {}) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/packages', requireAdmin, (req, res) => res.json({ packages: catalog.listPackages() }));

    app.post('/api/admin/packages', requireAdmin, async (req, res) => {
        try { res.json({ ok: true, packages: await catalog.savePackages(db, req.body.packages || []) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/general', requireAdmin, (req, res) => {
        res.json({ general: catalog.getGeneral(), models: publicModels() });
    });

    app.post('/api/admin/general', requireAdmin, async (req, res) => {
        try { res.json({ ok: true, general: await catalog.saveGeneral(db, req.body.general || {}) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Админка: поддержка ----
    app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
        try { res.json({ tickets: await db.listTickets(req.query.status || 'open') }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/tickets/answer', requireAdmin, async (req, res) => {
        try {
            const { id, answer } = req.body || {};
            if (!id || !answer) return res.status(400).json({ error: 'id and answer required' });
            const ticket = await db.answerTicket(id, answer);
            const bot = app.locals.bot;
            if (bot && ticket) {
                try { await bot.telegram.sendMessage(ticket.user_id, `💬 *Ответ поддержки:*\n\n${answer}`, { parse_mode: 'Markdown' }); } catch (e) {}
            }
            res.json({ ok: true, ticket });
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
