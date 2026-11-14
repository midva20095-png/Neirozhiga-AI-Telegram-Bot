const express = require('express');
const path = require('path');
const db = require('../core/db');
const catalog = require('../core/catalog');
const gen = require('../core/generate');
const auth = require('../core/auth');
const templatesSrc = require('../core/templates');
const transfer = require('../core/transfer');
const channel = require('../core/channel');
const share = require('../core/share');
const vk = require('../core/vk');
const widget = require('../core/vk-widget');
const bridge = require('../core/bridge');
const activity = require('../core/activity');

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

function vkPageOrigin(origin) {
    return /^https:\/\/([a-z0-9-]+\.)*(vk\.com|vk\.ru|vk-apps\.com|vk-apps\.ru|vkuser\.net|userapi\.com)$/i.test(String(origin || ''));
}

function startWebApp() {
    const app = express();
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (vkPageOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });
    app.use(express.json({ limit: '12mb' }));
    app.use(express.urlencoded({ extended: true }));

    const publicPath = path.join(__dirname, '../public');
    app.use(express.static(publicPath));
    app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
    app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));

    // ---- Публичная конфигурация витрины ----
    function vkAccount(req) {
        const body = req.body || {};
        const query = Object.assign({}, req.query || {});
        const tk = query.tk || body.tk;
        const id = tk ? auth.verifyUserToken(tk) : null;
        if (id && String(id).startsWith('-')) return String(id);
        return auth.verifyVkLaunch(query) || auth.verifyVkLaunch(body.launch || {}) || null;
    }

    app.get('/api/vk/session', (req, res) => {
        const account = auth.verifyVkLaunch(req.query || {});
        if (!account) {
            return res.status(401).json({ error: 'Откройте кабинет из бота или из сообщества.' });
        }
        const group = String((req.query && req.query.vk_group_id) || '').replace(/\D/g, '');
        res.json({ tk: auth.signUserId(account), group });
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

    app.get('/api/vk/me', async (req, res) => {
        try {
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
        try {
            const account = vkAccount(req);
            if (!account) return res.status(401).json({ error: 'Откройте кабинет кнопкой из чата ВК.' });
            const pkg = catalog.getPackage(req.body && req.body.packageId);
            const email = String((req.body && req.body.email) || '').trim();
            if (!pkg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ error: 'Выберите пакет и укажите почту для чека.' });
            }
            await db.ensureUser(account, `vk:${String(account).replace(/^-/, '')}`);
            const tk = auth.signUserId(account);
            const base = String(process.env.WEBAPP_URL || '').replace(/\/$/, '');
            const back = `${base}/vk.html?tk=${encodeURIComponent(tk)}&paid=1`;
            const url = await vk.createPayment(
                pkg.price,
                `Покупка ${pkg.title}`,
                email,
                { userId: String(account), credits: String(pkg.credits) },
                back
            );
            if (!url) return res.status(502).json({ error: 'Оплата сейчас не открылась. Попробуйте ещё раз.' });
            res.json({ url });
        } catch (e) {
            res.status(502).json({ error: 'Оплата сейчас не открылась. Попробуйте ещё раз.' });
        }
    });

    app.post('/api/vk/topup', async (req, res) => {
        try {
            const account = vkAccount(req);
            if (!account) return res.status(401).json({ error: 'Откройте кабинет кнопкой из чата ВК.' });
            const url = await vk.askTopup(account);
            if (!url) return res.status(502).json({ error: 'Чат не открылся. Нажмите «Пополнить» в диалоге ВК.' });
            res.json({ url });
        } catch (e) {
            res.status(502).json({ error: 'Чат не открылся. Нажмите «Пополнить» в диалоге ВК.' });
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
            try { await vk.notify(req.userId, text); } catch (e) {}
            res.json({ ok: true, mail: on });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось сохранить подписку.' });
        }
    });

    app.post('/api/vk/transfer', async (req, res) => {
        try {
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
            try { await vk.notify(account, `Перенесли ${amount} кр. в Telegram. Здесь осталось ${moved.balance} кр.`); } catch (e) {}
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
    app.get('/api/rating', requireUser, async (req, res) => {
        try {
            const range = activity.weekRange(new Date());
            if (Number(req.userId) >= 0) return res.json({ vk: false, week: range.label, rows: [], mine: null });
            const rows = await vk.attachFaces(await db.listWeekActivity(range.start, vk.communityId(req.query.group)));
            const place = rows.findIndex(row => String(row.userId) === String(req.userId));
            res.json({
                vk: true,
                week: range.label,
                rules: activity.POINTS,
                rows: rows.slice(0, 20),
                mine: place >= 0 ? Object.assign({ place: place + 1 }, rows[place]) : null
            });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть рейтинг.' });
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
            if (req.query.dl) res.set('Content-Disposition', `attachment; filename="neuroyaga.${ext}"`);
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
                const sent = await vk.sendToUser(req.userId, row.bytes, mime, 'Файл из кабинета.');
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

    app.get('/api/templates/:id/link', requireUser, async (req, res) => {
        try {
            const tpl = await templatesSrc.getFull(req.params.id);
            if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
            const url = share.templateLink(botUsername(), tpl.id);
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
                const url = tpl ? share.templateLink(botUsername(), tpl.id) : `https://t.me/${botUsername()}`;
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
            res.json({ templates: await templatesSrc.listPublic(audience) });
        } catch (e) {
            res.status(500).json({ error: e.message, templates: [] });
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
            const audience = String(req.userId).startsWith('-') ? 'vk' : 'tg';
            if (body.templateId) {
                tpl = await templatesSrc.getFull(body.templateId, audience);
                if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
                prompt = tpl.prompt || prompt;
                if (!prompt) prompt = 'Сделай изображение по прикреплённому фото';
                modelKey = tpl.model;
                charge = tpl.cost;
                reason = `Шаблон · ${tpl.title}`;
                templateTitle = tpl.title || '';
                keepModel = true;
                strict = true;
                const allowed = tpl.formats || [];
                aspect = allowed.includes(String(aspect || '')) ? String(aspect) : (allowed[0] || null);
                quality = tpl.quality || null;
                duration = tpl.duration || null;
                if (tpl.photo && !body.image) return res.status(400).json({ error: 'Прикрепите фото' });
            }
            if (!prompt && !body.image) return res.status(400).json({ error: 'Введите промпт' });
            const liveModel = catalog.getModel(modelKey, { audience });
            if (!liveModel) return res.status(400).json({ error: 'Эта модель сейчас выключена.' });
            const pickedModel = catalog.getModel(modelKey, { includeDisabled: true, audience });
            const allowPhoto = !pickedModel || (pickedModel.image !== 'forbidden' && pickedModel.image !== 'no');
            const file = body.image && allowPhoto ? decodeImage(body.image) : null;
            const fields = {
                userId: req.userId,
                prompt,
                modelKey,
                fileBuffer: file && file.buffer,
                mimeType: file && file.mime,
                aspectRatio: aspect,
                duration,
                quality,
                charge,
                reason,
                keepModel,
                strict,
                audience,
                groupId: vk.communityId(body.group)
            };
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

    app.get('/api/admin/vk/rating', requireAdmin, async (req, res) => {
        try {
            const range = activity.weekRange(new Date());
            const rows = await vk.attachFaces(await db.listWeekActivity(range.start, vk.communityId(req.query.group)));
            res.json({ week: range.label, rules: activity.rulesText(), points: activity.POINTS, rows });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось открыть рейтинг.' });
        }
    });

    app.get('/api/admin/stats', requireAdmin, async (req, res) => {
        try { res.json({ stats: await db.getStats(adminPlatform(req.query.platform) || undefined) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/users', requireAdmin, async (req, res) => {
        try {
            const q = (req.query.q || '').toString();
            const platform = adminPlatform(req.query.platform);
            const gate = platform === 'vk' ? 'AND user_id < 0' : platform === 'tg' ? 'AND user_id > 0' : '';
            const result = await db.pool.query(
                `SELECT user_id, username, balance, current_model, blocked, gens, spent, created_at, last_seen
                 FROM users
                 WHERE (user_id::text ILIKE $1 OR COALESCE(username,'') ILIKE $1) ${gate}
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
            if (newBalance !== null && Number(delta) !== 0) {
                const sign = Number(delta) > 0 ? `Начислено ${delta}` : `Списано ${Math.abs(delta)}`;
                try { await tellClient(userId, `${sign} кредитов.\nБаланс: ${newBalance} кр.`); } catch (e) {}
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
            res.json({ templates: await db.listTemplates(true, audience) });
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
            const url = share.templateLink(botUsername(), tpl.id);
            res.json({ ok: true, url, title: tpl.title });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/admin/templates/channel', requireAdmin, async (req, res) => {
        try {
            const tpl = await templatesSrc.getFull(req.body && req.body.id);
            if (!tpl) return res.status(404).json({ error: 'Шаблон скрыт или не найден. Сначала включите показ в кабинете.' });
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
        try { res.json({ tickets: await db.listTickets(req.query.status || 'open', adminPlatform(req.query.platform) || undefined) }); }
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

module.exports = { startWebApp, vkPageOrigin };
