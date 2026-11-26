const express = require('express');
const path = require('path');
const db = require('../core/db');
const catalog = require('../core/catalog');
const gen = require('../core/generate');
const auth = require('../core/auth');
const templatesSrc = require('../core/templates');
const templateFields = require('../core/template_fields');
const transfer = require('../core/transfer');
const channel = require('../core/channel');
const share = require('../core/share');
const vk = require('../core/vk');
const widget = require('../core/vk-widget');
const bridge = require('../core/bridge');
const activity = require('../core/activity');
const shop = require('../core/shop');
const assistant = require('../core/assistant');
const communityGoods = require('../core/community-goods');
const promo = require('../core/promo');
const maintenance = require('../core/maintenance');
const saveWork = require('../public/save-work');
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

async function requireUser(req, res, next) {
    try {
        const userId = resolveUserId(req);
        if (!userId) return res.status(401).json({ error: 'auth_required' });
        if (await maintenance.isOn()) return res.status(503).json({ maintenance: true, error: maintenance.NOTICE });
        req.userId = userId;
        next();
    } catch (error) {
        next(error);
    }
}

async function refuseUpdate(res) {
    if (!(await maintenance.isOn())) return false;
    res.status(503).json({ maintenance: true, error: maintenance.NOTICE });
    return true;
}

function requireAdmin(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (auth.verifyAdminToken(token)) return next();
    return res.status(401).json({ error: 'admin_auth_required' });
}

function publicModels(audience) {
    return catalog.listModels({ audience: audience === 'vk' ? 'vk' : 'tg' }).map(m => ({
        key: m.key, name: m.name, short: m.short, desc: m.desc,
        group: m.group, kind: m.kind || '',
        cost: m.cost, from: catalog.fromPrice(m), label: catalog.priceLabel(m),
        image: m.image, ratio: !!m.ratio && !m.noAspect,
        aspects: m.aspects || null,
        qualities: (m.qualities || []).map(q => ({
            id: q.id, name: q.name, desc: q.desc || '',
            cost: q.perSec ? Number(q.cost) * catalog.priceScale(m) : catalog.applyPrice(m, q.cost),
            perSec: !!q.perSec
        })),
        quality: m.quality || null,
        durations: m.durations || null,
        durationPrices: m.durationPrices
            ? Object.fromEntries(Object.entries(m.durationPrices).map(([k, v]) => [k, catalog.applyPrice(m, v)]))
            : null,
        perSec: !!m.perSec,
        rate: m.rate == null ? null : Number(m.rate) * catalog.priceScale(m),
        unit: m.unit || null,
        audio: !!m.audio,
        limit: m.limit,
        free: !(Number(m.cost) > 0)
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

function decodeAudio(input) {
    const raw = String(input || '');
    const match = /^data:(audio\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(raw);
    if (!match) {
        const error = new Error('Некорректное голосовое');
        error.code = 'audio';
        throw error;
    }
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
        const error = new Error('Голосовое слишком длинное. Запишите короче.');
        error.code = 'audio';
        throw error;
    }
    return { buffer, mime: match[1] };
}

function vkPageOrigin(origin) {
    return /^https:\/\/([a-z0-9-]+\.)*(vk\.com|vk\.ru|vk-apps\.com|vk-apps\.ru|vkuser\.net|userapi\.com)$/i.test(String(origin || ''));
}

const vkCorsHeaders = 'Content-Type, Authorization, X-User-Token, X-Telegram-Init-Data';

function vkRequestToken(req) {
    const body = (req && req.body) || {};
    const query = (req && req.query) || {};
    const headers = (req && req.headers) || {};
    return String(headers['x-user-token'] || query.tk || body.tk || '');
}

function startWebApp() {
    const app = express();
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (vkPageOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', vkCorsHeaders);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });
    app.use(express.json({ limit: '12mb' }));
    app.use(express.urlencoded({ extended: true }));

    const publicPath = path.join(__dirname, '../public');
    app.use(express.static(publicPath, {
        setHeaders(res, filePath) {
            if (filePath.endsWith('.html') || filePath.endsWith(`${path.sep}trades.js`)) res.setHeader('Cache-Control', 'no-cache');
        }
    }));
    app.get('/', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(publicPath, 'index.html'));
    });
    app.get('/admin', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(publicPath, 'admin.html'));
    });

    // ---- Публичная конфигурация витрины ----
    function vkAccount(req) {
        const body = req.body || {};
        const query = Object.assign({}, req.query || {});
        const tk = vkRequestToken(req);
        const id = tk ? auth.verifyUserToken(tk) : null;
        if (id && String(id).startsWith('-')) return String(id);
        return auth.verifyVkLaunch(query) || auth.verifyVkLaunch(body.launch || {}) || null;
    }

    app.get('/api/vk/bot', (req, res) => {
        res.json({ communities: vk.communityStatus() });
    });

    function launchGroup(source) {
        const direct = source && source.vk_group_id;
        if (direct) return String(direct).replace(/\D/g, '');
        const raw = source && typeof source.launch === 'string' ? source.launch : '';
        const match = /(?:^|&)vk_group_id=([^&]*)/.exec(raw);
        if (!match) return '';
        try { return decodeURIComponent(match[1]).replace(/\D/g, ''); }
        catch (e) { return String(match[1]).replace(/\D/g, ''); }
    }

    async function sendVkSession(res, source) {
        const account = auth.verifyVkLaunch(source || {});
        if (!account) {
            return res.status(401).json({ error: 'Откройте кабинет из бота или из сообщества.' });
        }
        const group = launchGroup(source);
        if (group) {
            try { await db.ensureUser(account, `vk:${String(account).replace(/^-/, '')}`); } catch (e) {}
            try { await db.rememberCommunity(account, group); } catch (e) {}
        }
        res.json({ tk: auth.signUserId(account), group });
    }

    app.get('/api/vk/session', (req, res) => sendVkSession(res, req.query));
    app.post('/api/vk/session', (req, res) => sendVkSession(res, req.body));

    app.post('/api/vk/user-token', async (req, res) => {
        const access = String((req.body && req.body.access_token) || '').trim();
        if (!/^[A-Za-z0-9._-]{20,500}$/.test(access)) {
            return res.status(400).json({ error: 'ВК не подтвердил вход.' });
        }
        try {
            const account = await auth.vkUserForAppToken(access);
            if (!account) return res.status(401).json({ error: 'ВК не подтвердил вход.' });
            res.json({ tk: auth.signUserId(account) });
        } catch (e) {
            res.status(500).json({ error: 'Вход не выполнился.' });
        }
    });

    app.post('/api/vk/widget-image', async (req, res) => {
        try {
            const name = String((req.body && req.body.name) || '');
            const token = String((req.body && req.body.token) || '');
            const image = String((req.body && req.body.image) || '');
            let buffer;
            if (image) {
                const match = image.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([a-z0-9+/=\s]+)$/i);
                if (!match) return res.status(400).json({ error: 'Нужна картинка JPEG, PNG или WebP.' });
                buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
                if (buffer.length < 32 || buffer.length > 6 * 1024 * 1024) {
                    return res.status(400).json({ error: 'Картинка слишком большая.' });
                }
            } else {
                buffer = await widget.defaultCover(name);
            }
            const jpeg = await widget.fitCover(buffer);
            const id = await widget.uploadCover(token, jpeg);
            res.json({ ok: true, id });
        } catch (e) {
            res.status(400).json({ error: e.message || 'Не удалось загрузить картинку.' });
        }
    });

    app.post('/api/vk/widget', async (req, res) => {
        try {
            const token = String((req.body && req.body.token) || '');
            const ids = (req.body && req.body.ids) || {};
            const groupId = String((req.body && req.body.group_id) || '').replace(/\D/g, '');
            if (!groupId) return res.status(400).json({ error: 'Откройте кабинет из сообщества.' });
            const code = widget.coverWidgetCode(groupId, ids);
            await widget.publishCover(token, code);
            if (vk.communityList().some(item => item.id === groupId)) {
                await db.setSetting(`vk_widget_${groupId}`, { token });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ error: e.message || 'ВК не поставил кнопки.' });
        }
    });

    app.get('/api/vk/me', async (req, res) => {
        try {
            if (await refuseUpdate(res)) return;
            const account = vkAccount(req);
            if (!account) return res.status(401).json({ error: 'Откройте кабинет кнопкой из чата ВК.' });
            const user = await db.getUser(account);
            const model = catalog.getModel(user.current_model) || catalog.getModel(catalog.defaultModelKey());
            res.json({
                balance: Number(user.balance) || 0,
                model: model ? model.name : '',
                packages: catalog.listPackages(),
                tk: auth.signUserId(account)
            });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть баланс.' });
        }
    });

    app.post('/api/vk/pay', async (req, res) => {
        let promoId = 0;
        let account = '';
        try {
            if (await refuseUpdate(res)) return;
            account = vkAccount(req);
            if (!account) return res.status(401).json({ error: 'Откройте кабинет кнопкой из чата ВК.' });
            const pkg = catalog.getPackage(req.body && req.body.packageId);
            const email = String((req.body && req.body.email) || '').trim();
            if (!pkg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: 'Выберите пакет и укажите почту для чека.' });
            }
            await db.ensureUser(account, `vk:${String(account).replace(/^-/, '')}`);
            const groupId = String((req.body && req.body.group) || '').replace(/\D/g, '');
            if (groupId) {
                try { await db.rememberCommunity(account, groupId); } catch (e) {}
            }
            const back = vk.appCabinetUrl(account, {
                groupId,
                paid: true
            });
            const code = promo.normalizeCode(req.body && req.body.code);
            let amount = pkg.price;
            if (code) {
                const deal = await promo.take(code, account, pkg.id);
                if (!deal.ok) return res.status(400).json({ error: deal.error });
                amount = deal.pay;
                promoId = deal.id;
            }
            const url = await vk.createPayment(
                amount,
                `Покупка ${pkg.title}`,
                email,
                { userId: String(account), credits: String(pkg.credits), vkGroup: groupId, promo: promoId ? String(promoId) : '' },
                back
            );
            if (!url) {
                if (promoId) await promo.giveBack(promoId, account);
                promoId = 0;
                return res.status(502).json({ error: 'Оплата сейчас не открылась. Попробуйте ещё раз.' });
            }
            res.json({ url, pay: amount, price: pkg.price });
        } catch (e) {
            if (promoId) await promo.giveBack(promoId, account);
            res.status(502).json({ error: 'Оплата сейчас не открылась. Попробуйте ещё раз.' });
        }
    });

    app.post('/api/vk/topup', async (req, res) => {
        try {
            if (await refuseUpdate(res)) return;
            const account = vkAccount(req);
            if (!account) return res.status(401).json({ error: 'Откройте кабинет кнопкой из чата ВК.' });
            const url = await vk.askTopup(account, req.body && req.body.group);
            if (!url) return res.status(502).json({ error: 'Чат не открылся. Нажмите «Пополнить» в диалоге ВК.' });
            res.json({ url });
        } catch (e) {
            res.status(502).json({ error: 'Чат не открылся. Нажмите «Пополнить» в диалоге ВК.' });
        }
    });

    function communityClosed() {
        return catalog.getGeneral().community_closed === true;
    }

    function refuseCommunity(res) {
        if (!communityClosed()) return false;
        res.status(403).json({ ok: false, closed: true, error: 'Закрыто на разработку.' });
        return true;
    }

    async function donorView(userId) {
        let view = await assistant.cabinet(userId);
        if (!view.don) {
            const pack = await vk.communityDonut(vk.clubGroupId());
            if (pack.donorError) return { check: false, view };
            const found = (pack.donors || []).find(item => Number(item.id) === userId);
            if (found) {
                await assistant.applyEvent('create', userId, found.name || '');
                view = await assistant.cabinet(userId);
            }
        }
        return { check: true, view };
    }

    async function courseDonor(req, res) {
        if (communityClosed()) {
            res.status(403).json({ closed: true, error: 'Кафедра сейчас закрыта.' });
            return '';
        }
        const userId = assistant.vkId(req.userId);
        if (!userId) {
            res.status(403).json({ error: 'Кафедра открыта донам НейроЯги.', join: assistant.JOIN_URL });
            return '';
        }
        const gate = await donorView(userId);
        if (!gate.check) {
            res.status(503).json({ error: 'Не удалось сверить донат.' });
            return '';
        }
        if (!gate.view.don || !gate.view.active) {
            res.status(403).json({ error: 'Кафедра открыта донам НейроЯги.', join: gate.view.join || assistant.JOIN_URL });
            return '';
        }
        if (gate.view.course === false) {
            const join = gate.view.join || assistant.JOIN_URL;
            res.status(403).json({
                error: 'Кафедра для этого номера закрыта. Повысить уровень можно кнопкой ниже.',
                join,
                upgrade: true
            });
            return '';
        }
        return String(req.userId);
    }

    app.get('/api/vk/course', requireUser, async (req, res) => {
        try {
            const account = await courseDonor(req, res);
            if (!account) return;
            const course = await assistant.courseList();
            if (!course.ok) return res.status(502).json({ error: course.error || 'Материалы не открылись.' });
            res.json({
                shelves: course.shelves || [],
                sections: course.sections || [],
                lessons: course.lessons || [],
                door: /^https:\/\/vk\.com\/[A-Za-z0-9_.]{2,64}$/.test(course.door || '') ? course.door : '',
                community: typeof course.community === 'string' ? course.community.slice(0, 200) : ''
            });
        } catch (e) {
            res.status(500).json({ error: 'Кафедра не открылась.' });
        }
    });

    app.get('/api/vk/course/thread', requireUser, async (req, res) => {
        try {
            const account = await courseDonor(req, res);
            if (!account) return;
            res.json({ messages: await db.listCourseChat(account), marks: await db.listCourseMarks(account) });
        } catch (e) {
            res.status(500).json({ error: 'Диалог не открылся.' });
        }
    });

    app.post('/api/vk/course/thread/clear', requireUser, async (req, res) => {
        try {
            const account = await courseDonor(req, res);
            if (!account) return;
            await db.clearCourseChat(account);
            res.json({ ok: true, messages: [] });
        } catch (e) {
            res.status(500).json({ error: 'Диалог не очистился.' });
        }
    });

    app.post('/api/vk/course/mark', requireUser, async (req, res) => {
        try {
            const account = await courseDonor(req, res);
            if (!account) return;
            const title = req.body && typeof req.body.title === 'string' ? req.body.title : '';
            const body = req.body && typeof req.body.body === 'string' ? req.body.body : '';
            const saved = await db.addCourseMark(account, title, body);
            if (!saved) return res.status(400).json({ error: 'Нечего сохранять.' });
            res.json({ ok: true, marks: await db.listCourseMarks(account) });
        } catch (e) {
            res.status(500).json({ error: 'Закладка не сохранилась.' });
        }
    });

    app.post('/api/vk/course/mark/remove', requireUser, async (req, res) => {
        try {
            const account = await courseDonor(req, res);
            if (!account) return;
            await db.removeCourseMark(account, req.body && req.body.id);
            res.json({ ok: true, marks: await db.listCourseMarks(account) });
        } catch (e) {
            res.status(500).json({ error: 'Закладка не удалилась.' });
        }
    });

    app.post('/api/vk/course/ask', requireUser, async (req, res) => {
        try {
            const account = await courseDonor(req, res);
            if (!account) return;
            const text = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
            if (!text) return res.status(400).json({ error: 'Напишите вопрос.' });
            const prior = (await db.listCourseChat(account)).slice(-6).map(item => ({
                role: item.role === 'user' ? 'user' : 'assistant',
                text: item.body
            }));
            const course = await assistant.courseAsk(text.slice(0, 500), prior, assistant.vkId(account));
            if (!course.ok) return res.status(502).json({ error: course.error || 'Ответ не собрался.' });
            await db.addCourseChat(account, 'user', text.slice(0, 500));
            await db.addCourseChat(account, 'ai', course.answer || '');
            res.json({ ok: true, answer: course.answer || '', messages: await db.listCourseChat(account) });
        } catch (e) {
            res.status(500).json({ error: 'Ответ не собрался.' });
        }
    });

    app.get('/api/vk/assistant', requireUser, async (req, res) => {
        try {
            if (communityClosed()) return res.json({ closed: true, don: false, active: false, community: null });
            const userId = assistant.vkId(req.userId);
            if (!userId) return res.json({ don: false, active: false, join: assistant.JOIN_URL, community: null });
            let view = await assistant.cabinet(userId);
            if (!view.don) {
                const pack = await vk.communityDonut(vk.clubGroupId());
                if (pack.donorError) return res.json(Object.assign({ check: false }, view));
                const found = (pack.donors || []).find(item => Number(item.id) === userId);
                if (found) {
                    await assistant.applyEvent('create', userId, found.name || '');
                    view = await assistant.cabinet(userId);
                }
            }
            if (view.active && view.community) {
                await assistant.pushSaved(userId);
                view = await assistant.cabinet(userId);
                const problem = await assistant.loadListen(userId);
                if (problem) view.community.error = problem;
                view.clients = await assistant.loadClients(userId);
                view.orders = await assistant.loadOrders(userId);
                view.bookings = await assistant.loadBookings(userId);
            }
            res.json(view);
        } catch (e) {
            res.status(500).json({ error: 'Раздел сообщества не открылся.' });
        }
    });

    app.post('/api/assistant/goods', async (req, res) => {
        const cfg = assistant.assistantConfig();
        const secret = String(req.headers['x-donut-secret'] || '');
        if (!cfg.secret || secret !== cfg.secret) return res.status(401).json({ ok: false });
        const groupId = Number(req.body && req.body.groupId);
        try {
            const rows = await db.listAssistantCommunities();
            const known = rows.some(row => Number(row.group_id) === groupId);
            if (!known) return res.status(404).json({ ok: false });
            const goods = await communityGoods.communityGoods(groupId);
            return res.json({ ok: true, goods });
        } catch (error) {
            return res.status(200).json({ ok: true, goods: '' });
        }
    });

    app.post('/api/vk/assistant/community', requireUser, async (req, res) => {
        try {
            if (refuseCommunity(res)) return;
            const userId = assistant.vkId(req.userId);
            const body = req.body || {};
            const checked = await vk.checkCommunityToken(body.token, body.groupId);
            const saved = await assistant.connectCommunity(userId, checked.id, body.token, checked.name);
            res.json(saved);
        } catch (e) {
            const message = e && e.public ? e.message : 'Сообщество не подключилось.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.post('/api/vk/assistant/reply', requireUser, async (req, res) => {
        try {
            if (refuseCommunity(res)) return;
            const saved = await assistant.saveDesk(req.userId, req.body || {});
            res.json(saved);
        } catch (e) {
            const message = e && e.public ? e.message : 'Ответы не сохранились.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.post('/api/vk/assistant/broadcast', requireUser, async (req, res) => {
        try {
            if (refuseCommunity(res)) return;
            const body = req.body || {};
            const result = await assistant.sendBroadcast(req.userId, body.text, body.offset);
            res.json(result);
        } catch (e) {
            const message = e && e.public ? e.message : 'Рассылка не ушла.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.post('/api/vk/assistant/setup', requireUser, async (req, res) => {
        try {
            if (refuseCommunity(res)) return;
            await assistant.askSetup(req.userId, req.body || {});
            res.json({ ok: true });
        } catch (e) {
            const message = e && e.public ? e.message : 'Заявка не отправилась.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.post('/api/vk/assistant/setup/message', requireUser, async (req, res) => {
        try {
            if (refuseCommunity(res)) return;
            await assistant.addSetupTalk(req.userId, req.body && req.body.text, 'don');
            res.json({ ok: true });
        } catch (e) {
            const message = e && e.public ? e.message : 'Сообщение не отправилось.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.post('/api/vk/assistant/community/remove', requireUser, async (req, res) => {
        try {
            if (refuseCommunity(res)) return;
            const userId = assistant.vkId(req.userId);
            const result = await assistant.disconnectCommunity(userId, req.body && req.body.groupId);
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Сообщество не отключилось.' });
        }
    });

    app.post('/api/vk/subscribe', requireUser, async (req, res) => {
        try {
            if (Number(req.userId) >= 0) return res.status(400).json({ error: 'Кнопка подписки работает во ВКонтакте.' });
            const on = !(req.body && req.body.on === false);
            await db.getUser(req.userId);
            await db.setMail(req.userId, on);
            const text = on
                ? 'Вы подписались на рассылку сообщества. Новые сообщения придут в этот чат.'
                : 'Вы отписались от рассылки сообщества.';
            try { await vk.notify(req.userId, text, req.body && req.body.group); } catch (e) {}
            res.json({ ok: true, mail: on });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось сохранить подписку.' });
        }
    });

    app.post('/api/vk/transfer', async (req, res) => {
        try {
            if (await refuseUpdate(res)) return;
            const account = vkAccount(req);
            if (!account) return res.status(401).json({ error: 'Откройте кабинет кнопкой из чата ВК.' });
            const amount = bridge.amountOf(req.body && req.body.amount);
            const raw = String((req.body && req.body.telegram) || '').trim();
            if (!amount) return res.status(400).json({ error: 'Укажите, сколько кредитов перенести.' });
            let to = /^\d{5,15}$/.test(raw) ? raw : '';
            if (!to) {
                const found = await db.findTelegramUser(raw);
                if (found && found.ambiguous) return res.status(400).json({ error: 'Таких имён несколько. Впишите номер из Telegram.' });
                if (found) to = String(found.user_id);
            }
            if (!to || Number(to) <= 0) return res.status(400).json({ error: 'Впишите номер Telegram. Он показан в боте: «Перенос».' });
            const moved = await bridge.moveCredits(db, {
                fromId: account,
                toId: to,
                amount,
                takeReason: `Перенос в Telegram ${to}`,
                giveReason: 'Перенос из ВК'
            });
            if (!moved.ok) return res.status(400).json({ error: moved.error });
            const bot = app.locals.bot;
            if (bot) {
                try { await bot.telegram.sendMessage(to, `Из ВК перенесли ${amount} кр. Они уже на балансе Telegram.`); } catch (e) {}
            }
            try { await vk.notify(account, `Перенесли ${amount} кр. в Telegram. Здесь осталось ${moved.balance} кр.`, req.body && req.body.group); } catch (e) {}
            res.json({ ok: true, balance: moved.balance });
        } catch (e) {
            res.status(500).json({ error: 'Перенос не выполнился. Кредиты остались на месте.' });
        }
    });

    app.get('/api/config', (req, res) => {
        const g = catalog.getGeneral();
        const audience = req.query.audience === 'vk' ? 'vk' : 'tg';
        res.json({
            groups: catalog.GROUPS,
            models: publicModels(audience),
            packages: catalog.listPackages(),
            site_url: g.site_url,
            support_enabled: !!g.support_enabled,
            default_model: catalog.defaultModelKey()
        });
    });

    async function requireChannel(req, res) {
        if (String(req.userId).startsWith('-')) return true;
        const gateBot = app.locals.bot;
        if (!gateBot) return true;
        const gate = await channel.subscribed(gateBot.telegram, req.userId);
        if (gate.ok) return true;
        res.status(403).json({
            error: 'Подпишитесь на канал https://t.me/neuroyaga_AI и нажмите «Я подписался» в боте.',
            channel: channel.CHANNEL_URL
        });
        return false;
    }

    // ---- Пользовательские эндпоинты ----
    app.get('/api/rating', async (req, res) => {
        try {
            const userId = resolveUserId(req);
            const asked = String(req.query.group || '').replace(/\D/g, '');
            const known = asked && vk.communityList().some(item => item.id === asked) ? asked : '';
            const group = known || vk.communityId('');
            if (!userId && !group) return res.status(401).json({ error: 'auth_required' });
            const range = activity.monthRange(new Date());
            if (userId && Number(userId) >= 0) return res.json({ vk: false, week: range.label, rows: [], mine: null });
            const pack = await vk.monthActivity(group, range, 50, { sync: true });
            const rows = await vk.attachFaces(pack.rows);
            const place = userId ? rows.findIndex(row => String(row.userId) === String(userId)) : -1;
            res.json({
                vk: true,
                guest: !userId,
                week: range.label,
                rules: activity.POINTS,
                rows: rows.slice(0, 20),
                mine: place >= 0 ? Object.assign({ place: place + 1 }, rows[place]) : null
            });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть рейтинг.' });
        }
    });

    function knownGroup(value) {
        const asked = String(value || '').replace(/\D/g, '');
        if (asked && vk.communityList().some(item => item.id === asked)) return asked;
        const fallback = vk.communityId('');
        return vk.communityList().some(item => item.id === fallback) ? fallback : '';
    }

    app.get('/api/shop', requireUser, async (req, res) => {
        try {
            if (Number(req.userId) >= 0) return res.json({ vk: false, bonuses: 0, items: [], honor: [] });
            const group = knownGroup(req.query.group);
            if (!group) return res.status(400).json({ error: 'Нет сообщества' });
            const current = activity.monthRange(new Date());
            const [bonuses, items, honor, promos] = await Promise.all([
                shop.bonusBalance(req.userId, group, current.start),
                shop.listItems(group, true),
                shop.listHonor(group),
                promo.shopView(req.userId, group)
            ]);
            res.json({ vk: true, bonuses, rate: activity.CREDIT_RATE, items, honor, promos });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть магазин.' });
        }
    });

    app.post('/api/shop/buy', requireUser, async (req, res) => {
        try {
            if (Number(req.userId) >= 0) return res.status(400).json({ ok: false, error: 'Магазин открыт во ВКонтакте.' });
            const body = req.body || {};
            const group = knownGroup(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            res.json(await shop.buyItem(req.userId, group, body.itemId));
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Заказ не оформился.' });
        }
    });

    app.post('/api/shop/credits', requireUser, async (req, res) => {
        try {
            if (Number(req.userId) >= 0) return res.status(400).json({ ok: false, error: 'Магазин открыт во ВКонтакте.' });
            const body = req.body || {};
            const group = knownGroup(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            res.json(await shop.askCredits(req.userId, group, body.bonuses));
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Заявка не оформилась.' });
        }
    });

    app.post('/api/shop/promo', requireUser, async (req, res) => {
        try {
            if (Number(req.userId) >= 0) return res.status(400).json({ ok: false, error: 'Магазин открыт во ВКонтакте.' });
            const body = req.body || {};
            const group = knownGroup(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            res.json(await promo.buyPersonal(req.userId, group, body.packageId));
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Промокод не оформился.' });
        }
    });

    app.post('/api/shop/promo-buy', requireUser, async (req, res) => {
        try {
            if (Number(req.userId) >= 0) return res.status(400).json({ ok: false, error: 'Магазин открыт во ВКонтакте.' });
            const body = req.body || {};
            const group = knownGroup(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            res.json(await promo.buyListed(req.userId, group, body.id));
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Промокод не оформился.' });
        }
    });

    app.get('/api/me', requireUser, async (req, res) => {
        try {
            if (!(await requireChannel(req, res))) return;
            const user = await db.getUser(req.userId);
            const history = await db.listHistory(req.userId, 40);
            let current = user.current_model || catalog.defaultModelKey();
            if (!catalog.getModel(current)) current = catalog.defaultModelKey();
            res.json({
                user_id: user.user_id,
                balance: user.balance,
                current_model: current,
                blocked: !!user.blocked,
                mail: !!user.mail_ok,
                history
            });
        } catch (e) {
            console.error('API /api/me:', e.message);
            res.status(500).json({ error: 'Internal error' });
        }
    });

    app.get('/api/works', requireUser, async (req, res) => {
        try {
            const rows = await db.listWorks(req.userId, 30);
            res.json({
                works: rows.map(w => ({
                    id: w.id,
                    kind: w.kind,
                    model: w.model || '',
                    prompt: w.prompt || '',
                    template_id: w.template_id || null,
                    shared: !!w.shared_at,
                    created_at: w.created_at
                }))
            });
        } catch (e) {
            console.error('API /api/works:', e.message);
            res.status(500).json({ error: 'Internal error', works: [] });
        }
    });

    app.get('/api/works/:id', requireUser, async (req, res) => {
        try {
            const row = await db.getWork(req.userId, req.params.id);
            if (!row || !row.bytes) return res.status(404).end();
            const allowed = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg'];
            const mime = allowed.includes(row.mime) ? row.mime : 'application/octet-stream';
            const ext = mime === 'video/mp4' ? 'mp4' : mime === 'audio/mpeg' ? 'mp3' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
            res.set('Content-Type', mime);
            res.set('Cache-Control', 'private, max-age=86400');
            res.set('X-Content-Type-Options', 'nosniff');
            if (req.query.dl) res.set('Content-Disposition', `attachment; filename="${saveWork.attachmentName(req.query.name, ext)}"`);
            res.send(row.bytes);
        } catch (e) {
            console.error('API /api/works/:id:', e.message);
            res.status(500).end();
        }
    });

    app.post('/api/works/:id/send', requireUser, async (req, res) => {
        try {
            const row = await db.getWork(req.userId, req.params.id);
            if (!row || !row.bytes) return res.status(404).json({ error: 'Файл не найден' });
            const mime = row.mime || 'image/png';
            if (String(req.userId).startsWith('-')) {
                const sent = await vk.sendToUser(req.userId, row.bytes, mime, 'Файл из кабинета.', req.body && req.body.group);
                if (!sent) return res.status(503).json({ error: 'Не удалось отправить файл в чат ВК. Сохраните его из кабинета.' });
                return res.json({ ok: true });
            }
            const bot = app.locals.bot;
            if (!bot) return res.status(503).json({ error: 'Бот сейчас недоступен' });
            const ext = mime === 'video/mp4' ? 'mp4' : mime === 'audio/mpeg' ? 'mp3' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
            const file = { source: row.bytes, filename: `neuroyaga.${ext}` };
            if (mime.startsWith('image/') && mime !== 'image/webp' && row.bytes.length <= 9 * 1024 * 1024) {
                await bot.telegram.sendPhoto(req.userId, file);
            } else if (mime === 'video/mp4') {
                await bot.telegram.sendVideo(req.userId, file);
            } else if (mime === 'audio/mpeg') {
                await bot.telegram.sendAudio(req.userId, file);
            } else {
                await bot.telegram.sendDocument(req.userId, file);
            }
            res.json({ ok: true });
        } catch (e) {
            console.error('API /api/works/:id/send:', e.message);
            res.status(500).json({ error: 'Не удалось отправить файл в чат' });
        }
    });

    function botUsername() {
        return app.locals.botUsername || 'NeyroYaga_ai_bot';
    }

    app.get('/api/templates/:id/cover.jpg', async (req, res) => {
        try {
            const tpl = await templatesSrc.getFull(req.params.id, 'vk');
            const file = tpl && await vk.templateCoverFile(tpl.image);
            if (!file) return res.status(404).end();
            res.setHeader('Content-Type', file.type || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=300');
            res.send(file.buffer);
        } catch (e) {
            res.status(404).end();
        }
    });

    app.get('/api/templates/:id/card', async (req, res) => {
        try {
            const tpl = await templatesSrc.getFull(req.params.id, 'vk');
            if (!tpl || !tpl.image) return res.status(404).end();
            const base = String(process.env.WEBAPP_URL || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app').replace(/\/$/, '');
            const id = share.numericId(tpl.id);
            const cover = `${base}/api/templates/${id}/cover.jpg`;
            const open = share.vkTemplateLink(tpl.id);
            const html = share.templateCard(tpl, cover, open);
            if (String(tpl.prompt || '') && html.includes(tpl.prompt)) return res.status(404).end();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=300');
            res.send(html);
        } catch (e) {
            res.status(404).end();
        }
    });

    app.get('/api/templates/:id/link', requireUser, async (req, res) => {
        try {
            const tpl = await templatesSrc.getFull(req.params.id);
            if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
            const place = String(req.userId).startsWith('-') ? 'vk' : 'tg';
            const url = templatesSrc.templateShareLink(tpl, botUsername(), place);
            if (!url) return res.status(404).json({ error: 'Шаблон не найден' });
            res.json({ url, title: tpl.title });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось собрать ссылку' });
        }
    });

    app.post('/api/works/:id/channel', requireUser, async (req, res) => {
        try {
            if (!(await requireChannel(req, res))) return;
            const row = await db.getWork(req.userId, req.params.id);
            if (!row || !row.bytes) return res.status(404).json({ error: 'Файл не найден' });
            if (row.shared_at) return res.status(400).json({ error: 'Эта работа уже в канале.' });
            if (await db.recentShare(req.userId)) {
                return res.status(429).json({ error: 'Следующую работу можно отправить в канал через несколько минут.' });
            }
            const gateBot = app.locals.bot;
            if (!gateBot) return res.status(503).json({ error: 'Бот сейчас недоступен' });
            const claimed = await db.claimShare(req.userId, row.id);
            if (!claimed) return res.status(400).json({ error: 'Эта работа уже в канале.' });
            try {
                const tpl = row.template_id ? await templatesSrc.getFull(row.template_id) : null;
                const place = String(req.userId).startsWith('-') ? 'vk' : 'tg';
                const url = tpl ? templatesSrc.templateShareLink(tpl, botUsername(), place) : (place === 'vk' ? 'https://vk.com/app54901511' : `https://t.me/${botUsername()}`);
                const posted = await share.sendChannel(gateBot.telegram, {
                    bytes: row.bytes,
                    mime: row.mime,
                    caption: share.workCaption(tpl && tpl.title),
                    button: tpl ? share.BUTTON : share.OPEN_BOT,
                    url
                });
                if (!posted.ok) {
                    await db.releaseShare(req.userId, row.id);
                    return res.status(502).json({ error: posted.error });
                }
                db.note('tpl', `в канал работа ${row.id}`).catch(() => {});
                res.json({ ok: true });
            } catch (err) {
                await db.releaseShare(req.userId, row.id);
                throw err;
            }
        } catch (e) {
            console.error('API /api/works/:id/channel:', e.message);
            res.status(500).json({ error: 'Не удалось отправить в канал' });
        }
    });

    app.get('/api/templates', async (req, res) => {
        try {
            const audience = req.query.audience === 'vk' ? 'vk' : 'tg';
            const name = botUsername();
            const templates = (await templatesSrc.listPublic(audience)).map(item => templatesSrc.attachChannelLink(item, name, audience));
            res.json({ templates });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть шаблоны', templates: [] });
        }
    });

    app.post('/api/set-model', requireUser, async (req, res) => {
        try {
            const { model } = req.body || {};
            const audience = String(req.userId).startsWith('-') ? 'vk' : 'tg';
            if (!model || !catalog.getModel(model, { audience })) return res.status(400).json({ error: 'model required' });
            const user = await db.getUser(req.userId);
            if (user.blocked) return res.status(403).json({ error: 'blocked' });
            await db.setCurrentModel(req.userId, model);
            res.json({ success: true, model });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/generate', requireUser, async (req, res) => {
        const body = req.body || {};
        let modelKey = body.model;
        try {
            if (!(await requireChannel(req, res))) return;
            let prompt = body.prompt ? String(body.prompt).trim() : '';
            let charge;
            let reason;
            let aspect = body.format || null;
            let quality = body.quality || null;
            let duration = body.duration || null;
            let keepModel = false;
            let strict = false;
            let templateTitle = '';
            let tpl = null;
            let exactPrompt = false;
            let photos = [];
            const audience = String(req.userId).startsWith('-') ? 'vk' : 'tg';
            const listedPhotos = Array.isArray(body.photos) ? body.photos.filter(Boolean).slice(0, templateFields.MAX_PHOTOS) : [];
            if (body.templateId) {
                tpl = await templatesSrc.getFull(body.templateId, audience);
                if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
                modelKey = tpl.model;
                charge = tpl.cost;
                reason = `Шаблон · ${tpl.title}`;
                templateTitle = tpl.title || '';
                keepModel = true;
                strict = true;
                exactPrompt = true;
                const allowed = tpl.formats || [];
                aspect = allowed.includes(String(aspect || '')) ? String(aspect) : (allowed[0] || null);
                quality = tpl.quality || null;
                duration = tpl.duration || null;
                const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
                const listed = Array.isArray(body.photos) ? body.photos.filter(Boolean) : [];
                if (tpl.fields && tpl.fields.length) {
                    photos = (listed.length ? listed : (body.image ? [body.image] : [])).slice(0, templateFields.MAX_PHOTOS);
                    const gap = templateFields.missing(tpl.fields, answers, photos.length);
                    if (gap) return res.status(400).json({ error: gap });
                    prompt = templateFields.buildPrompt(tpl.prompt, tpl.fields, answers);
                } else {
                    prompt = tpl.prompt || prompt;
                    if (tpl.photo && !body.image) return res.status(400).json({ error: 'Прикрепите фото' });
                    if (body.image) photos = [body.image];
                }
                if (!prompt) prompt = 'Сделай изображение по прикреплённому фото';
                const templateKind = (catalog.getModel(modelKey, { includeDisabled: true, audience }) || {}).kind;
                if (templateKind !== 'video' && templateKind !== 'audio') prompt = templateFields.withAspect(prompt, aspect);
            } else {
                photos = listedPhotos.slice();
                if (body.image && photos.indexOf(body.image) < 0) photos.unshift(body.image);
                photos = photos.slice(0, templateFields.MAX_PHOTOS);
            }
            if (!prompt && !body.image && !photos.length && !body.audio) return res.status(400).json({ error: 'Введите промпт' });
            const liveModel = catalog.getModel(modelKey, { audience });
            if (!liveModel) return res.status(400).json({ error: 'Эта модель сейчас выключена.' });
            const pickedModel = catalog.getModel(modelKey, { includeDisabled: true, audience });
            const allowPhoto = !pickedModel || (pickedModel.image !== 'forbidden' && pickedModel.image !== 'no');
            const incoming = photos.length ? photos : (body.image ? [body.image] : []);
            const files = allowPhoto ? incoming.slice(0, templateFields.MAX_PHOTOS).filter(Boolean).map(decodeImage) : [];
            const file = files[0] || null;
            const askedGroup = String((body && body.group) || '').replace(/\D/g, '');
            if (askedGroup && String(req.userId).startsWith('-')) {
                try { await db.rememberCommunity(req.userId, askedGroup); } catch (e) {}
            }
            const fields = {
                userId: req.userId,
                prompt,
                modelKey,
                fileBuffer: files.length === 1 ? file.buffer : null,
                fileBuffers: files.length > 1 ? files.map(item => item.buffer) : undefined,
                mimeType: file && file.mime,
                mimeTypes: files.map(item => item.mime),
                exactPrompt,
                aspectRatio: aspect,
                duration,
                quality,
                charge,
                reason,
                keepModel,
                strict,
                audience,
                groupId: askedGroup
            };
            if (body.audio) {
                const audio = decodeAudio(body.audio);
                const seconds = Math.round(Number(body.audioSeconds));
                if (!(seconds > 0) || seconds > 120) return res.status(400).json({ error: 'Голосовое должно быть от 1 до 120 секунд' });
                fields.audioBuffer = audio.buffer;
                fields.audioMime = audio.mime;
                fields.audioSeconds = seconds;
            }
            const photoKb = file && file.buffer ? Math.max(1, Math.round(file.buffer.length / 1024)) : 0;
            if (templateTitle) {
                const service = pickedModel ? (catalog.PROVIDERS[pickedModel.provider] || pickedModel.provider) : 'модель не найдена';
                const remote = (pickedModel && (file ? pickedModel.kieEdit : pickedModel.kieModel)) || (pickedModel && pickedModel.tool) || modelKey;
                const mode = pickedModel && (pickedModel.qualities || []).find(item => item.id === quality);
                const modeText = [mode && mode.name, duration ? duration + ' сек' : ''].filter(Boolean).join(', ');
                fields.workLabel = templateTitle;
                fields.templateId = tpl && tpl.id;
                db.note('tpl', `старт «${templateTitle}» · ${service} · ${modelKey} · ${remote}${modeText ? ' · ' + modeText : ''} · фото ${photoKb ? photoKb + ' КБ' : 'нет'}`).catch(() => {});
            }
            const result = await gen.generateForWeb(fields);
            if (templateTitle) db.note('tpl', `готово «${templateTitle}» · ${modelKey}`).catch(() => {});
            res.json(result);
        } catch (e) {
            const shown = gen.userMessage(e);
            if (body.templateId) db.note('tpl', `сбой · ${modelKey || 'модель'} · ${e.message}`).catch(() => {});
            else if (shown === gen.QUIET_ERROR) db.note('gen', `кабинет: ${e.message}`).catch(() => {});
            const code = e.code === 'busy' ? 429 : 400;
            res.status(code).json({ error: shown });
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
    app.get('/api/maintenance', async (req, res) => {
        res.json({ on: await maintenance.isOn(), message: maintenance.NOTICE });
    });

    app.get('/api/admin/maintenance', requireAdmin, async (req, res) => {
        res.json({ on: await maintenance.isOn() });
    });

    app.post('/api/admin/maintenance', requireAdmin, async (req, res) => {
        const on = await maintenance.setOn(req.body && req.body.on);
        res.json({ ok: true, on });
    });

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

    app.get('/api/admin/vk', requireAdmin, async (req, res) => {
        try {
            res.json({
                stats: await db.getStats('vk'),
                models: catalog.listModels({ includeDisabled: true }),
                groups: catalog.GROUPS,
                templates: await db.listTemplates(true)
            });
        } catch (e) {
            res.status(500).json({ error: 'Раздел ВК не открылся.' });
        }
    });

    app.post('/api/admin/vk/models', requireAdmin, async (req, res) => {
        try { res.json({ ok: true, models: await catalog.saveVkModels(db, req.body.models || {}) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    function adminPlatform(value) {
        return value === 'vk' ? 'vk' : value === 'tg' ? 'tg' : '';
    }

    async function tellClient(userId, text, markdown) {
        const id = String(userId);
        if (Number(id) < 0) return vk.notify(id, text);
        const bot = app.locals.bot;
        if (!bot) return false;
        await bot.telegram.sendMessage(id, text, markdown ? { parse_mode: 'Markdown' } : undefined);
        return true;
    }

    app.get('/api/admin/vk/communities', requireAdmin, (req, res) => {
        res.json({ communities: vk.adminHomes() });
    });

    app.get('/api/admin/vk/course-drops', requireAdmin, async (req, res) => {
        try {
            res.json({ people: await assistant.listCourseDrops() });
        } catch (e) {
            res.status(500).json({ error: 'Список на исключение не открылся.' });
        }
    });

    app.post('/api/admin/vk/course-drops/clear', requireAdmin, async (req, res) => {
        try {
            const id = Number(req.body && req.body.id);
            await assistant.clearCourseDrop(id);
            res.json({ ok: true, people: await assistant.listCourseDrops() });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Отметку не сохранили.' });
        }
    });

    app.get('/api/admin/vk/course', requireAdmin, async (req, res) => {
        try {
            const course = await assistant.courseList();
            if (!course.ok) return res.status(502).json({ error: course.error || 'Уроки второго бота не открылись.' });
            res.json({
                shelves: course.shelves || [],
                sections: course.sections || [],
                lessons: course.lessons || []
            });
        } catch (e) {
            res.status(500).json({ error: 'Уроки второго бота не открылись.' });
        }
    });

    app.post('/api/admin/vk/course/save', requireAdmin, async (req, res) => {
        try {
            const course = await assistant.courseSave(req.body || {});
            if (!course.ok) return res.status(400).json({ ok: false, error: course.error || 'Урок не сохранился.' });
            res.json({ ok: true, lesson: course.lesson || null });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Урок не сохранился.' });
        }
    });

    app.post('/api/admin/vk/course/section', requireAdmin, async (req, res) => {
        try {
            const course = await assistant.courseSection(req.body || {});
            if (!course.ok) return res.status(400).json({ ok: false, error: course.error || 'Раздел не сохранился.' });
            res.json({ ok: true, section: course.section || null });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Раздел не сохранился.' });
        }
    });

    app.post('/api/admin/vk/course/section/remove', requireAdmin, async (req, res) => {
        try {
            const course = await assistant.courseSectionRemove(req.body || {});
            if (!course.ok) return res.status(400).json({ ok: false, error: course.error || 'Раздел не удалился.' });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Раздел не удалился.' });
        }
    });

    app.post('/api/admin/vk/course/remove', requireAdmin, async (req, res) => {
        try {
            const id = req.body && typeof req.body.id === 'string' ? req.body.id : '';
            const course = await assistant.courseRemove(id);
            if (!course.ok) return res.status(400).json({ ok: false, error: course.error || 'Урок не снялся.' });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Урок не снялся.' });
        }
    });

    app.get('/api/admin/vk/assistant', requireAdmin, async (req, res) => {
        try {
            const pack = await assistant.adminList();
            pack.closed = communityClosed();
            res.json(pack);
        } catch (e) {
            res.status(500).json({ error: 'Помощник доната не открылся.' });
        }
    });

    app.post('/api/admin/vk/assistant/gate', requireAdmin, async (req, res) => {
        try {
            const closed = !!(req.body && req.body.closed);
            const general = await catalog.saveGeneral(db, { community_closed: closed });
            res.json({ ok: true, closed: general.community_closed === true });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Вход не переключился.' });
        }
    });

    app.post('/api/admin/vk/assistant/sync', requireAdmin, async (req, res) => {
        try {
            const pack = await vk.communityDonut(vk.clubGroupId());
            if (pack.donorError) return res.status(502).json({ ok: false, error: pack.donorError });
            const result = await assistant.registerLive(pack.donors || []);
            res.json({ ok: true, on: result.on, off: result.off });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Список донов не обновился.' });
        }
    });

    app.post('/api/admin/vk/assistant/course', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const userId = assistant.vkId(body.userId);
            if (!userId || typeof body.open !== 'boolean') return res.status(400).json({ ok: false, error: 'Нужен номер ВК.' });
            const result = await assistant.setCourse(userId, body.open);
            if (!result) return res.status(404).json({ ok: false, error: 'Этот дон ещё не записан.' });
            res.json({ ok: true, course: result.course });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Доступ к кафедре не изменился.' });
        }
    });

    app.post('/api/admin/vk/assistant/active', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const userId = assistant.vkId(body.userId);
            if (!userId) return res.status(400).json({ ok: false, error: 'Нужен номер ВК.' });
            await assistant.applyEvent(body.active ? 'prolong' : 'expire', userId, '');
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Статус дона не изменился.' });
        }
    });

    app.post('/api/admin/vk/assistant/demo/stop', requireAdmin, async (req, res) => {
        try {
            res.json(await assistant.stopDemo());
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Демонстрация не отключилась.' });
        }
    });

    app.post('/api/admin/vk/assistant/demo', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const checked = await vk.checkCommunityToken(body.token, body.groupId);
            const saved = await assistant.installDemo(checked.id, body.token, checked.name || 'Демонстрация');
            res.json(saved);
        } catch (e) {
            const message = e && e.public ? e.message : 'Демонстрация не подключилась.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.post('/api/admin/vk/assistant/desk', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const saved = await assistant.saveDesk(body.userId, body);
            res.json(saved);
        } catch (e) {
            const message = e && e.public ? e.message : 'Карточка не сохранилась.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.get('/api/admin/vk/assistant/ping', requireAdmin, async (req, res) => {
        try {
            res.json(await assistant.setupAlert());
        } catch (e) {
            res.status(500).json({ open: 0 });
        }
    });

    app.post('/api/admin/vk/assistant/setup/message', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const saved = await assistant.addSetupTalk(body.userId, body.text, 'dev');
            res.json(saved);
        } catch (e) {
            const message = e && e.public ? e.message : 'Сообщение не отправилось.';
            res.status(400).json({ ok: false, error: message });
        }
    });

    app.post('/api/admin/vk/assistant/setup/close', requireAdmin, async (req, res) => {
        try {
            const result = await assistant.finishSetup(req.body && req.body.userId);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Заявка не закрылась.' });
        }
    });

    app.post('/api/admin/vk/assistant/wipe', requireAdmin, async (req, res) => {
        try {
            const result = await assistant.wipeCommunity(req.body && req.body.groupId);
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Данные сообщества не удалились.' });
        }
    });

    app.post('/api/admin/vk/assistant/drop', requireAdmin, async (req, res) => {
        try {
            const result = await assistant.adminDrop(req.body && req.body.groupId);
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Сообщество не отключилось.' });
        }
    });

    app.get('/api/admin/vk/donut', requireAdmin, async (req, res) => {
        try {
            const groupId = vk.communityId(req.query.group);
            const report = await vk.communityDonut(groupId);
            const rows = await db.listDonutLog(report.id, 200);
            const faces = await vk.attachFaces(rows.map(row => ({ user_id: String(-Number(row.user_id)) })));
            const named = new Map(faces.map(row => [String(row.userId), row]));
            const events = rows.map(row => {
                const face = named.get(String(-Number(row.user_id))) || {};
                return {
                    userId: Number(row.user_id),
                    name: face.name || `ВК ${row.user_id}`,
                    photo: face.photo || '',
                    kind: row.kind,
                    amount: Number(row.amount) || 0,
                    at: row.created_at
                };
            });
            res.json({ report, events });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть донаты.' });
        }
    });

    app.get('/api/admin/vk/rating', requireAdmin, async (req, res) => {
        try {
            const now = new Date();
            const range = req.query.period === 'previous' ? activity.previousMonth(now) : activity.monthRange(now);
            const group = vk.communityId(req.query.group);
            const pack = await vk.monthActivity(group, range, 200, { sync: req.query.period !== 'previous' });
            const rows = await vk.attachFaces(pack.rows);
            const hidden = await vk.attachFaces((pack.hidden || []).map(id => ({ user_id: id })));
            const key = `vk_rate_bonus_${group}_${range.start.toISOString().slice(0, 10)}`;
            const saved = await db.getSettings([key]);
            res.json({
                week: range.label,
                period: req.query.period === 'previous' ? 'previous' : 'current',
                rules: activity.rulesText(),
                points: activity.POINTS,
                posts: pack.posts.length,
                rows,
                hidden,
                paid: saved[key] || null
            });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть рейтинг.' });
        }
    });

    app.post('/api/admin/vk/rating-hide', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const group = vk.communityId(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            const ids = await vk.setRatingHidden(group, body.userId, !!body.hide);
            res.json({ ok: true, hidden: ids });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Не удалось изменить список рейтинга.' });
        }
    });

    app.post('/api/admin/vk/rating-bonus', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const group = vk.communityId(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            const now = new Date();
            const range = body.period === 'current' ? activity.monthRange(now) : activity.previousMonth(now);
            const key = `vk_rate_bonus_${group}_${range.start.toISOString().slice(0, 10)}`;
            const saved = await db.getSettings([key]);
            if (saved[key] && !body.again) {
                return res.json({
                    ok: false,
                    already: true,
                    paid: saved[key],
                    error: 'За этот месяц бонус уже начислен.'
                });
            }
            const rows = await vk.attachFaces((await vk.monthActivity(group, range, 200)).rows);
            const places = (Array.isArray(body.places) ? body.places : []).slice(0, 3);
            const grants = activity.bonusGrants(rows, places, 0).filter(grant => grant.place <= 3);
            if (!grants.length) return res.json({ ok: false, error: 'Укажите сумму для первых трёх мест.' });
            let count = 0;
            let total = 0;
            const winners = [];
            for (const grant of grants) {
                const balance = await db.updateBalance(grant.userId, grant.amount, `Рейтинг · ${range.label} · место ${grant.place}`);
                if (balance === null) continue;
                count += 1;
                total += grant.amount;
                const row = rows.find(item => String(item.userId) === String(grant.userId));
                winners.push({ name: row && row.name || 'Ученик', points: row && row.points || 0, amount: grant.amount });
                try {
                    await tellClient(grant.userId, `Приз рейтинга: ${grant.amount} кредитов.\n${range.label}, место ${grant.place}.\nБаланс: ${balance} кр.`);
                } catch (e) {}
            }
            const paid = { at: new Date().toISOString(), count, total, label: range.label };
            await db.setSetting(key, paid);
            let posted = false;
            try { posted = await vk.publishPrize(group, range, winners); } catch (e) { posted = false; }
            res.json({ ok: count > 0, count, total, label: range.label, posted, error: count ? '' : 'Не получилось начислить' });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Не удалось начислить бонус.' });
        }
    });

    app.get('/api/admin/vk/shop', requireAdmin, async (req, res) => {
        try {
            const group = vk.communityId(req.query.group);
            if (!group) return res.status(400).json({ error: 'Нет сообщества' });
            const items = await shop.listItems(group, false);
            const orders = await shop.listOrders(group);
            const faces = await vk.attachFaces(orders.map(row => ({ user_id: row.userId })));
            const named = new Map(faces.map(row => [String(row.userId), row]));
            const promos = await promo.listAdmin(group);
            res.json({
                packages: catalog.listPackages().map(item => ({ id: item.id, title: item.title, price: item.price, credits: item.credits })),
                promos,
                items,
                orders: orders.map(row => {
                    const face = named.get(String(row.userId)) || {};
                    return Object.assign({}, row, { name: face.name || row.userId, photo: face.photo || '' });
                }),
                fresh: orders.filter(row => row.status === 'new').length
            });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть магазин.' });
        }
    });

    app.post('/api/admin/vk/shop-item', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const group = vk.communityId(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            const saved = await shop.saveItem(group, body);
            res.json(saved);
        } catch (e) {
            res.status(400).json({ ok: false, error: e && e.code === 'photo' ? e.message : 'Не удалось сохранить товар.' });
        }
    });

    app.post('/api/admin/vk/shop-order', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const group = vk.communityId(body.group);
            const action = String(body.action || '');
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            if (action === 'cancel') return res.json(await shop.cancelOrder(group, body.id));
            if (action === 'done') {
                const result = await shop.finishOrder(group, body.id);
                if (result.ok) {
                    try { await tellClient(result.order.user_id, `Заказ магазина выполнен: ${result.order.title}.`); } catch (e) {}
                }
                return res.json(result);
            }
            if (action === 'credit') {
                const taken = await shop.takeCreditOrder(group, body.id);
                if (!taken.ok) return res.json(taken);
                const balance = await db.updateBalance(taken.order.userId, taken.order.credits, `Магазин · ${taken.order.credits} кр. за ${taken.order.bonuses} б.`);
                if (balance === null) {
                    await shop.reopenOrder(taken.order.id);
                    return res.json({ ok: false, error: 'Кредиты не начислились, заявка осталась открытой.' });
                }
                try {
                    await tellClient(taken.order.userId, `Обмен бонусов: ${taken.order.credits} кредитов.\nБаланс: ${balance} кр.`);
                } catch (e) {}
                return res.json({ ok: true, credits: taken.order.credits, balance });
            }
            res.json({ ok: false, error: 'Неизвестное действие.' });
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Не удалось обработать заявку.' });
        }
    });

    app.post('/api/admin/vk/promo', requireAdmin, async (req, res) => {
        try {
            const body = req.body || {};
            const group = vk.communityId(body.group);
            if (!group) return res.status(400).json({ ok: false, error: 'Нет сообщества' });
            if (body.action === 'off') return res.json(await promo.closeAdmin(group, body.id));
            res.json(await promo.addAdmin(group, body));
        } catch (e) {
            res.status(500).json({ ok: false, error: 'Код не сохранился.' });
        }
    });

    app.get('/api/admin/stats', requireAdmin, async (req, res) => {
        try { res.json({ stats: await db.getStats(adminPlatform(req.query.platform) || undefined, req.query.group) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/users', requireAdmin, async (req, res) => {
        try {
            const q = (req.query.q || '').toString().trim();
            const platform = adminPlatform(req.query.platform);
            const group = String(req.query.group || '').replace(/\D/g, '');
            const digits = q.replace(/\D/g, '');
            const gate = platform === 'vk' ? 'AND user_id < 0' : platform === 'tg' ? 'AND user_id > 0' : '';
            const params = [`%${q}%`];
            let search = `(user_id::text ILIKE $1 OR COALESCE(username,'') ILIKE $1)`;
            if (digits) {
                params.push(`%${digits}`);
                search = `(${search} OR user_id::text LIKE $${params.length})`;
            }
            let groupSql = '';
            if (group) {
                params.push(group);
                groupSql = ` AND user_id IN (SELECT user_id FROM vk_member WHERE group_id = $${params.length})`;
            }
            const result = await db.pool.query(
                `SELECT user_id::text AS user_id, username, balance, current_model, blocked, gens, spent, created_at, last_seen, vk_group::text AS vk_group,
                        COALESCE((SELECT string_agg(m.group_id::text, ',' ORDER BY m.seen_at DESC) FROM vk_member m WHERE m.user_id = users.user_id), '') AS groups
                 FROM users
                 WHERE ${search} ${gate}${groupSql}
                 ORDER BY last_seen DESC NULLS LAST LIMIT 100`,
                params
            );
            res.json({ users: result.rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/admin/user', requireAdmin, async (req, res) => {
        try {
            const found = await db.adminClient(req.query.userId);
            if (!found) return res.status(404).json({ ok: false, error: 'Клиент не найден' });
            res.json({ ok: true, user: found.user, history: found.history });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/admin/balance', requireAdmin, async (req, res) => {
        try {
            const { userId, delta, reason } = req.body || {};
            if (!userId || delta === undefined) return res.status(400).json({ error: 'userId and delta required' });
            const newBalance = await db.updateBalance(userId, Number(delta), reason || 'Админ');
            if (newBalance !== null && Number(delta) !== 0) {
                const sign = Number(delta) > 0 ? `Начислено ${delta}` : `Списано ${Math.abs(delta)}`;
                try { await tellClient(userId, `${sign} кредитов.\nБаланс: ${newBalance} кр.`); } catch (e) {}
            }
            res.json({ ok: newBalance !== null, balance: newBalance, error: newBalance === null ? 'Не получилось изменить баланс' : '' });
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
            const vkUser = Number(userId) < 0;
            if (!vkUser && !app.locals.bot) return res.status(503).json({ error: 'bot offline' });
            const sent = await tellClient(userId, String(text), !vkUser);
            if (!sent) return res.status(503).json({ error: vkUser ? 'Сообщение во ВК не ушло' : 'Сообщение не ушло' });
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
        try {
            const text = String((req.body && req.body.text) || '').trim();
            if (!text) return res.status(400).json({ error: 'text required' });
            const platform = adminPlatform(req.body && req.body.platform) || 'tg';
            if (platform === 'tg' && !app.locals.bot) return res.status(503).json({ error: 'bot offline' });
            const onlyMail = platform === 'vk' && req.body && req.body.subscribers === true;
            const ids = await db.listUserIds(platform, { mail: onlyMail });
            let sent = 0, failed = 0;
            for (const id of ids) {
                try {
                    const ok = await tellClient(id, text, platform !== 'vk');
                    if (ok) sent++; else failed++;
                } catch (e) { failed++; }
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
            const audience = req.query.audience === 'vk' ? 'vk' : req.query.audience === 'tg' ? 'tg' : undefined;
            const every = req.query.all === '1';
            const place = req.query.audience === 'vk' ? 'vk' : 'tg';
            const group = String(req.query.group || '').replace(/\D/g, '');
            const name = botUsername();
            const templates = (await db.listTemplates(true, every ? undefined : audience)).map(row => templatesSrc.attachChannelLink(row, name, place, group));
            res.json({ templates });
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

    app.post('/api/admin/templates/link', requireAdmin, async (req, res) => {
        try {
            const tpl = await templatesSrc.getFull(req.body && req.body.id);
            if (!tpl) return res.status(404).json({ error: 'Шаблон скрыт или не найден. Сначала включите показ в кабинете.' });
            const place = req.body && req.body.audience === 'vk' ? 'vk' : 'tg';
            const url = templatesSrc.templateShareLink(tpl, botUsername(), place);
            res.json({ ok: true, url, title: tpl.title });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/templates/channel', requireAdmin, async (req, res) => {
        try {
            const tpl = await templatesSrc.getFull(req.body && req.body.id);
            if (!tpl) return res.status(404).json({ error: 'Шаблон скрыт или не найден. Сначала включите показ в кабинете.' });
            if (tpl.audience === 'vk') {
                return res.status(400).json({ error: 'Этот шаблон только во ВК. Скопируйте ссылку приложения и вставьте её в пост.' });
            }
            const gateBot = app.locals.bot;
            if (!gateBot) return res.status(503).json({ error: 'Бот сейчас недоступен' });
            const url = share.templateLink(botUsername(), tpl.id);
            const posted = await share.sendChannel(gateBot.telegram, {
                ...share.imagePayload(tpl.image),
                caption: share.templateCaption(tpl),
                button: share.BUTTON,
                url
            });
            if (!posted.ok) return res.status(502).json({ error: posted.error });
            db.note('tpl', `в канал шаблон «${tpl.title}»`).catch(() => {});
            res.json({ ok: true, url });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось отправить шаблон в канал' });
        }
    });

    app.post('/api/admin/templates/delete', requireAdmin, async (req, res) => {
        try { await db.deleteTemplate(req.body.id); res.json({ ok: true }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Админка: модели / пакеты / общие настройки ----
    app.get('/api/admin/models', requireAdmin, (req, res) => {
        res.json({
            models: catalog.listModels({ includeDisabled: true }),
            groups: catalog.GROUPS,
            providers: catalog.PROVIDERS,
            kie: !!String(process.env.KIE_API_KEY || '').trim()
        });
    });

    app.get('/api/admin/journal', requireAdmin, async (req, res) => {
        try {
            res.json({ items: await db.listJournal(200) });
        } catch (e) {
            res.status(500).json({ error: 'Журнал недоступен' });
        }
    });

    app.post('/api/admin/models', requireAdmin, async (req, res) => {
        try {
            const save = req.body && req.body.pricesOnly ? catalog.saveModelPrices : catalog.saveModels;
            res.json({ ok: true, models: await save(db, req.body.models || {}) });
        }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/packages', requireAdmin, (req, res) => res.json({ packages: catalog.listPackages() }));

    app.post('/api/admin/packages', requireAdmin, async (req, res) => {
        try { res.json({ ok: true, packages: await catalog.savePackages(db, req.body.packages || []) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/general', requireAdmin, (req, res) => {
        const audience = req.query.platform === 'vk' ? 'vk' : 'tg';
        res.json({ general: catalog.getGeneral(), models: publicModels(audience) });
    });

    app.post('/api/admin/general', requireAdmin, async (req, res) => {
        try { res.json({ ok: true, general: await catalog.saveGeneral(db, req.body.general || {}) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Админка: поддержка ----
    app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
        try { res.json({ tickets: await db.listTickets(req.query.status || 'open', adminPlatform(req.query.platform) || undefined, req.query.group) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/tickets/answer', requireAdmin, async (req, res) => {
        try {
            const { id, answer } = req.body || {};
            if (!id || !answer) return res.status(400).json({ error: 'id and answer required' });
            const ticket = await db.answerTicket(id, answer);
            if (ticket) {
                const vkUser = Number(ticket.user_id) < 0;
                const text = vkUser ? `Ответ поддержки:\n\n${answer}` : `💬 *Ответ поддержки:*\n\n${answer}`;
                try { await tellClient(ticket.user_id, text, !vkUser); } catch (e) {}
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

module.exports = { startWebApp, vkPageOrigin, vkCorsHeaders, vkRequestToken };
