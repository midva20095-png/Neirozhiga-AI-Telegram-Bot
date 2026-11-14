const { AsyncLocalStorage } = require('async_hooks');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const db = require('./db');
const bridge = require('./bridge');
const catalog = require('./catalog');
const gen = require('./generate');
const auth = require('./auth');
const activity = require('./activity');
const audit = require('./vk-audit');
const club = require('./vk-club');
const donut = require('./vk-donut');

const API = 'https://api.vk.com/method';
const VERSION = '5.199';
const communityContext = new AsyncLocalStorage();

function currentGroup() {
    const store = communityContext.getStore();
    return String((store && store.groupId) || '').replace(/\D/g, '');
}

function accountId(vkUserId) {
    const id = Number(vkUserId);
    if (!Number.isInteger(id) || id <= 0 || id > Number.MAX_SAFE_INTEGER) return null;
    return -id;
}

function parsePayload(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (e) { return null; }
}

function linkedText(message) {
    const text = String((message && message.text) || '').trim();
    const found = [];
    const buckets = [message && message.attachments];
    if (message && message.reply_message) buckets.push(message.reply_message.attachments);
    const forwarded = message && message.fwd_messages;
    if (Array.isArray(forwarded)) forwarded.forEach(item => buckets.push(item && item.attachments));
    buckets.forEach(list => {
        if (!Array.isArray(list)) return;
        list.forEach(item => {
            if (!item) return;
            if (item.type === 'link' && item.link && item.link.url) found.push(String(item.link.url));
            const owner = Number(item.wall && (item.wall.owner_id || item.wall.to_id));
            if (Number.isInteger(owner) && owner < 0) found.push(`https://vk.com/club${-owner}`);
        });
    });
    const extra = found.filter(link => link && !text.includes(link));
    return [text, ...extra].filter(Boolean).join('\n');
}

function readIncoming(update) {
    if (!update || update.type !== 'message_new') return null;
    const message = update.object && (update.object.message || update.object);
    if (!message || message.out) return null;
    const fromId = Number(message.from_id);
    const peerId = Number(message.peer_id || fromId);
    if (!Number.isInteger(fromId) || fromId <= 0 || !Number.isInteger(peerId) || peerId <= 0) return null;
    return {
        fromId,
        peerId,
        text: linkedText(message),
        payload: parsePayload(message.payload)
    };
}

function readEvent(update) {
    if (!update || update.type !== 'message_event') return null;
    const obj = update.object || {};
    const userId = Number(obj.user_id);
    const peerId = Number(obj.peer_id || userId);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(peerId) || peerId <= 0) return null;
    return {
        userId,
        peerId,
        eventId: obj.event_id,
        payload: parsePayload(obj.payload) || {}
    };
}

function connectHint(error) {
    const code = Number(error && error.code);
    const msg = String((error && error.message) || '');
    if (/longpoll for this group is not enabled/i.test(msg)) {
        return 'В сообществе выключен Long Poll API.';
    }
    if (code === 5) return 'Ключ сообщества не принят. Создайте новый, с правом «Управление».';
    if (code === 15) return 'У ключа сообщества нет права «Управление».';
    if (code === 27 || code === 28) return 'Это не ключ сообщества. Нужен ключ доступа сообщества, не пользовательский и не сервисный.';
    if (code === 100) return 'Проверьте номер сообщества и включённый Long Poll API.';
    return 'Проверьте ключ сообщества и Long Poll API.';
}

function isGreeting(text) {
    return menuAction(text) === 'hello' || menuAction(text) === 'balance';
}

function menuAction(text, payload) {
    if (payload && payload.a) return String(payload.a);
    if (payload && payload.q) return 'quality';
    if (payload && payload.d != null && payload.d !== '') return 'duration';
    if (payload && payload.s) return 'size';
    if (payload && payload.g) return 'group';
    if (payload && payload.m) return 'model';
    if (payload && payload.p) return 'pack';
    if (payload && payload.command === 'start') return 'hello';
    const value = String(text || '').trim().toLowerCase();
    if (value === 'начать' || value === 'start' || value === '/start') return 'hello';
    if (value === 'баланс') return 'balance';
    if (value === 'модели' || value === 'модель') return 'models';
    if (value === 'пополнить') return 'pay';
    if (value === 'перенос') return 'move';
    if (value === 'справка/рейтинг' || value === 'справка / рейтинг') return 'more';
    if (value === 'справка' || value === 'помощь') return 'help';
    if (value === 'рейтинг') return 'rate';
    if (value === 'аудит') return 'audit';
    if (value === 'клуб') return 'club';
    if (value === 'бот ии') return 'models';
    if (value === 'назад') return 'pay_back';
    if (value === 'отмена') return 'opt_cancel';
    if (value === 'меню') return 'hello';
    if (value === 'к разделам') return 'models';
    return '';
}

function fitLabel(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length <= 40 ? value : value.slice(0, 39) + '…';
}

function siteLink() {
    return catalog.getGeneral().site_url || 'https://babayagaland.ru';
}

function appBase() {
    return String(process.env.WEBAPP_URL || '').replace(/\/$/, '');
}

function cabinetLink(account, pkgId, groupId) {
    const base = appBase();
    if (!base || account == null) return siteLink();
    const tk = auth.signUserId(account);
    const pkg = pkgId ? `&pkg=${encodeURIComponent(pkgId)}` : '';
    const group = String(groupId || currentGroup() || '').replace(/\D/g, '');
    const groupQuery = group ? `&vk_group_id=${encodeURIComponent(group)}` : '';
    return `${base}/vk.html?tk=${encodeURIComponent(tk)}${pkg}${groupQuery}`;
}

function linkButton(label, link) {
    const safe = String(link || '').trim();
    if (!/^https:\/\/\S+$/i.test(safe) || safe.length > 400) return null;
    return { action: { type: 'open_link', label: fitLabel(label), link: safe, payload: '{}' } };
}

function textRows() {
    return [
        [textButton('Баланс', { a: 'balance' }, 'primary'), textButton('Модели', { a: 'models' }, 'primary')],
        [textButton('Пополнить', { a: 'pay' }, 'positive'), textButton('Перенос', { a: 'move' }, 'primary')],
        [textButton('Справка/Рейтинг', { a: 'more' }, 'secondary')]
    ];
}

function textOnlyMenu() {
    return JSON.stringify({ one_time: false, buttons: textRows() });
}

function auditHere(groupId) {
    const current = String(groupId || currentGroup() || '').replace(/\D/g, '');
    const primary = String(process.env.VK_GROUP_ID || '').replace(/\D/g, '');
    if (!current || current === primary) return false;
    return communityList().some(item => item.id === current);
}

function keepsQuiet(groupId, peerId) {
    return Number(peerId) >= 2000000000 && auditHere(groupId);
}

function mainMenu(peerId, groupId) {
    const rows = [];
    const account = accountId(peerId);
    const cabinet = linkButton('Кабинет', account ? cabinetLink(account, '', groupId) : siteLink());
    if (cabinet) rows.push([cabinet]);
    rows.push(...textRows());
    if (auditHere(groupId)) {
        rows.push([
            textButton('Аудит', { a: 'audit' }, 'secondary'),
            textButton('Клуб', { a: 'club' }, 'secondary')
        ]);
    }
    return JSON.stringify({ one_time: false, buttons: rows });
}

const pendingPay = new Map();
const pendingMove = new Map();
const pendingJob = new Map();
const pendingAudit = new Set();
const pendingClub = new Set();
const runningAudit = new Set();
let tellTelegram = async () => {};

function setTelegramNotify(fn) {
    if (typeof fn === 'function') tellTelegram = fn;
}

function emailOk(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function moreKeyboard() {
    return asBoard([
        [textButton('Справка', { a: 'help' }, 'primary'), textButton('Рейтинг', { a: 'rate' }, 'secondary')],
        [textButton('Назад', { a: 'pay_back' }, 'secondary')]
    ]);
}

function payLockKeyboard() {
    return asBoard([[textButton('Назад', { a: 'pay_back' }, 'secondary')]]);
}

function moveConfirmKeyboard() {
    return asBoard([
        [textButton('Перенести', { a: 'move_yes' }, 'positive')],
        [textButton('Назад', { a: 'pay_back' }, 'secondary')]
    ]);
}

function payLinkKeyboard(url) {
    return JSON.stringify({
        one_time: false,
        inline: false,
        buttons: [
            [{ action: { type: 'open_link', label: 'Оплатить', link: url, payload: '{}' } }],
            [textButton('Назад', { a: 'pay_back' }, 'secondary')]
        ]
    });
}

function chatReturnUrl() {
    const groupId = String(process.env.VK_GROUP_ID || '').replace(/\D/g, '');
    if (groupId) return `https://vk.com/im?sel=-${groupId}`;
    return siteLink();
}

function textButton(label, payload, color) {
    return {
        action: { type: 'text', label: fitLabel(label), payload: JSON.stringify(payload) },
        color: color || 'secondary'
    };
}

function asBoard(rows) {
    return JSON.stringify({ one_time: false, inline: false, buttons: rows.slice(0, 10) });
}

function sectionKeyboard() {
    const groups = Object.keys(catalog.GROUPS).filter(group => catalog.modelsByGroup(group, 'vk').length > 0);
    const rows = [];
    for (let i = 0; i < groups.length; i += 2) {
        const row = [textButton(catalog.GROUPS[groups[i]], { g: groups[i] })];
        if (groups[i + 1]) row.push(textButton(catalog.GROUPS[groups[i + 1]], { g: groups[i + 1] }));
        rows.push(row);
    }
    rows.push([textButton('Назад', { a: 'pay_back' }, 'secondary')]);
    return asBoard(rows);
}

function modelKeyboard(group) {
    const rows = catalog.modelsByGroup(group, 'vk').slice(0, 9).map(model => [
        textButton(`${model.short} · ${catalog.priceLabel(model)}`, { m: model.key })
    ]);
    rows.push([textButton('К разделам', { a: 'models' }, 'secondary')]);
    return asBoard(rows);
}

function chunk(items, size) {
    const rows = [];
    for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
    return rows;
}

function modelNeedsChoice(model) {
    if (!model) return false;
    return (model.qualities || []).length > 1 || (model.durations || []).length > 1 || (model.ratio && !model.noAspect);
}

function nextChoice(model, job) {
    if (!model || !job) return null;
    const qualities = model.qualities || [];
    if (qualities.length > 1 && !job.quality) {
        return {
            text: `Режим · ${model.name}. Выберите цену.`,
            rows: qualities.slice(0, 8).map(item => {
                const price = item.perSec
                    ? `${catalog.applyPrice(model, item.cost)} кр/сек`
                    : `${catalog.quote(model, { quality: item.id })} кр`;
                return [{ label: `${item.name} · ${price}`, payload: { q: item.id } }];
            })
        };
    }
    if ((model.durations || []).length > 1 && !job.duration) {
        return {
            text: `Длина · ${model.name}.`,
            rows: chunk(model.durations.slice(0, 8).map(seconds => {
                const price = catalog.quote(model, { duration: seconds, quality: job.quality || model.quality });
                return { label: `${seconds} сек · ${price} кр`, payload: { d: seconds } };
            }), 2)
        };
    }
    if (model.ratio && !model.noAspect && !job.aspect) {
        const aspects = (model.aspects && model.aspects.length) ? model.aspects : catalog.RATIOS.filter(item => item !== 'auto');
        const buttons = aspects.slice(0, 24).map(item => ({ label: item, payload: { s: item } }));
        if (!model.aspects) buttons.push({ label: 'Авто', payload: { s: 'auto' } });
        return { text: `Размер · ${model.name}.`, rows: chunk(buttons, 3) };
    }
    return null;
}

function choiceKeyboard(model, job) {
    const step = nextChoice(model, job);
    if (!step) return null;
    const rows = step.rows.map(row => row.map(item => textButton(item.label, item.payload)));
    rows.push([textButton('Назад', { a: 'pay_back' }, 'secondary')]);
    return { text: step.text, keyboard: asBoard(rows) };
}

function payKeyboard() {
    const rows = catalog.listPackages().slice(0, 9).map(pkg => [
        textButton(`${pkg.title} · ${pkg.price} ₽`, { p: pkg.id }, 'positive')
    ]);
    rows.push([textButton('Назад', { a: 'pay_back' }, 'secondary')]);
    return asBoard(rows);
}

async function call(token, method, params) {
    const body = new URLSearchParams({ ...params, access_token: token, v: VERSION });
    const res = await axios.post(`${API}/${method}`, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
    });
    const data = res.data || {};
    if (data.error) {
        const err = new Error(data.error.error_msg || 'vk');
        err.code = data.error.error_code;
        throw err;
    }
    return data.response;
}

let keyboardNoted = false;

function noteKeyboard(error) {
    if (keyboardNoted) return;
    keyboardNoted = true;
    if (Number(error && error.code) === 912) {
        console.error('ВК не показывает кнопки. Сообщения → Настройки для бота → Возможности ботов → Включены.');
        return;
    }
    const detail = String(error && error.message || '').replace(/\s+/g, ' ').slice(0, 160);
    console.error(`ВК не принял клавиатуру${detail ? `: ${detail}` : ''}. Ставлю меню без ссылок.`);
}

function spareKeyboard(failed) {
    const plain = textOnlyMenu();
    if (failed !== plain) return plain;
    const clear = JSON.stringify({ buttons: [] });
    if (failed !== clear) return clear;
    return '';
}

async function sendPlain(token, params) {
    const plain = { ...params, random_id: String(Math.floor(Math.random() * 2e9)) };
    delete plain.keyboard;
    await call(token, 'messages.send', plain);
}

async function sendMessage(token, params) {
    try {
        await call(token, 'messages.send', params);
    } catch (error) {
        const code = Number(error && error.code);
        if (params.keyboard && (code === 912 || code === 911)) {
            noteKeyboard(error);
            const next = spareKeyboard(params.keyboard);
            if (next) {
                try {
                    await call(token, 'messages.send', {
                        ...params,
                        random_id: String(Math.floor(Math.random() * 2e9)),
                        keyboard: next
                    });
                    return;
                } catch (again) {
                    const againCode = Number(again && again.code);
                    if (againCode !== 912 && againCode !== 911 && !params.attachment) throw again;
                }
            }
            await sendPlain(token, params);
            return;
        }
        if (!params.attachment) throw error;
        await sendPlain(token, params);
    }
}

async function sendText(token, peerId, message, keyboard) {
    await sendMessage(token, {
        peer_id: String(peerId),
        random_id: String(Math.floor(Math.random() * 2e9)),
        message: String(message || '').slice(0, 3500),
        keyboard: keyboard || mainMenu(peerId)
    });
}

async function enableButtons(token, groupId) {
    try {
        await call(token, 'groups.setSettings', {
            group_id: groupId,
            messages: '1',
            bots_capabilities: '1',
            bots_start_button: '1',
            bots_add_to_chat: auditHere(groupId) ? '0' : '1'
        });
        console.log(`ВК ${groupId}: сообщения и кнопка «Начать» включены.`);
    } catch (error) {
        try {
            await call(token, 'groups.edit', { group_id: groupId, messages: '1' });
        } catch (e) {}
        console.error(`ВК ${groupId} не включил кнопку чата. Сообщения → Сообщения сообщества → Включены. Настройки для бота → Возможности ботов.`);
    }
}

async function enableActivity(token, groupId) {
    const params = {
        group_id: groupId,
        enabled: '1',
        api_version: VERSION,
        message_new: '1',
        message_event: '1',
        like_add: '1',
        like_remove: '1',
        wall_reply_new: '1',
        wall_reply_delete: '1',
        wall_reply_restore: '1',
        wall_repost: '1',
        wall_post_new: '1'
    };
    try {
        await call(token, 'groups.setLongPollSettings', params);
    } catch (error) {
        const code = Number(error && error.code);
        console.error(`ВК ${groupId}: события стены не включились целиком${code ? ` (${code})` : ''}.`);
        try {
            const slim = Object.assign({}, params);
            delete slim.like_add;
            delete slim.like_remove;
            delete slim.message_event;
            delete slim.wall_post_new;
            await call(token, 'groups.setLongPollSettings', slim);
        } catch (e) {}
    }
    try {
        const settings = await call(token, 'groups.getLongPollSettings', { group_id: groupId });
        const events = (settings && settings.events) || {};
        const on = ['like_add', 'wall_reply_new', 'wall_repost', 'wall_post_new'].filter(name => Number(events[name]) === 1);
        const shown = on.join(', ') || 'по стене';
        markCommunity(groupId, true, '', { events: shown });
        console.log(`ВК ${groupId}: события рейтинга ${shown}.`);
    } catch (e) {}
    try {
        const perm = await call(token, 'groups.getTokenPermissions', {});
        const names = ((perm && perm.permissions) || []).map(item => String(item.name || '')).filter(Boolean);
        if (names.length && !names.includes('wall')) {
            console.error(`ВК ${groupId}: у ключа нет права «Стена». Комментарии от имени сообщества ВК не примет. Сейчас у ключа: ${names.join(', ')}.`);
        }
    } catch (e) {}
    if (!auditHere(groupId)) return;
    try {
        await call(token, 'groups.setLongPollSettings', Object.assign({}, params, {
            donut_subscription_create: '1',
            donut_subscription_prolonged: '1',
            donut_subscription_cancelled: '1',
            donut_subscription_expired: '1'
        }));
        console.log(`ВК ${groupId}: события доната подписка, продление, отписка, окончание.`);
    } catch (error) {
        const code = Number(error && error.code);
        console.error(`ВК ${groupId}: событие доната не включилось${code ? ` (${code})` : ''}.`);
    }
}

const reactionSeen = new Map();
const reactionScanning = new Set();

function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function awardReaction(groupId, kind, objectKey, vkId) {
    const account = accountId(vkId);
    if (!account) return;
    try {
        await db.ensureUser(account, `vk:${vkId}`);
        await db.recordActivity(account, kind, objectKey, activity.POINTS[kind] || 0, groupId);
    } catch (e) {}
}

async function scanCommunityActivity(token, groupId) {
    const owner = -Number(String(groupId || '').replace(/\D/g, ''));
    if (!owner) return;
    let wall;
    try {
        wall = await call(token, 'wall.get', { owner_id: String(owner), count: '15', filter: 'owner' });
    } catch (error) {
        if (Number(error && error.code) !== 100) return;
        try {
            wall = await call(token, 'wall.get', { owner_id: String(owner), count: '15' });
        } catch (e) { return; }
    }
    const posts = (wall && wall.items) || [];
    const started = scanCommunityActivity.started || (scanCommunityActivity.started = Math.floor(Date.now() / 1000) - 30);
    for (const post of posts) {
        await pause(280);
        let likers = [];
        try {
            const likes = await call(token, 'likes.getList', {
                type: 'post', owner_id: String(owner), item_id: String(post.id), count: '100', filter: 'likes'
            });
            likers = (likes && likes.items) || [];
        } catch (e) {}
        const likeKey = `${groupId}:like:${post.id}`;
        const likePick = activity.freshIds(reactionSeen.get(likeKey), likers);
        reactionSeen.set(likeKey, likePick.seen);
        for (const id of likePick.fresh) await awardReaction(groupId, 'like', `post:${post.id}`, id);

        await pause(280);
        let comments = [];
        try {
            const thread = await call(token, 'wall.getComments', {
                owner_id: String(owner), post_id: String(post.id), count: '40', thread_items_count: '5'
            });
            comments = (thread && thread.items) || [];
        } catch (e) {}
        const flat = [];
        comments.forEach(comment => {
            flat.push(comment);
            ((comment.thread && comment.thread.items) || []).forEach(reply => flat.push(reply));
        });
        for (const comment of flat) {
            const fromId = Number(comment && comment.from_id);
            if (!Number.isInteger(fromId) || fromId <= 0 || !comment.id) continue;
            if (Number(comment.date) < started) continue;
            await awardReaction(groupId, 'comment', `comment:${post.id}:${comment.id}`, fromId);
        }

        await pause(280);
        let copies = [];
        try {
            const reposts = await call(token, 'likes.getList', {
                type: 'post', owner_id: String(owner), item_id: String(post.id), count: '100', filter: 'copies'
            });
            copies = (reposts && reposts.items) || [];
        } catch (e) {}
        const copyKey = `${groupId}:repost:${post.id}`;
        const copyPick = activity.freshIds(reactionSeen.get(copyKey), copies);
        reactionSeen.set(copyKey, copyPick.seen);
        for (const id of copyPick.fresh) await awardReaction(groupId, 'repost', `repost:${post.id}:${id}`, id);
    }
}

function watchCommunityActivity(token, groupId) {
    if (reactionScanning.has(groupId)) return;
    reactionScanning.add(groupId);
    const tick = async () => {
        try { await scanCommunityActivity(token, groupId); } catch (e) {}
        setTimeout(tick, 3 * 60 * 1000);
    };
    tick();
}

function imageKind(buffer) {
    if (!buffer || buffer.length < 12) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return { ext: 'png', type: 'image/png' };
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return { ext: 'jpg', type: 'image/jpeg' };
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return { ext: 'gif', type: 'image/gif' };
    return null;
}

async function fileForVk(buffer) {
    const kind = imageKind(buffer);
    if (kind && buffer.length <= 20 * 1024 * 1024) {
        try {
            const meta = await sharp(buffer, { failOn: 'none' }).metadata();
            const width = meta.width || 0;
            const height = meta.height || 0;
            const ratio = width && height ? Math.max(width, height) / Math.min(width, height) : 1;
            if (width && height && width + height <= 14000 && ratio <= 20) {
                return { buffer, filename: `neuroyaga.${kind.ext}`, type: kind.type };
            }
        } catch (error) {}
    }
    const jpeg = await sharp(buffer, { failOn: 'none', limitInputPixels: false }).rotate().resize({
        width: 1920,
        height: 1920,
        fit: 'inside',
        withoutEnlargement: true
    }).flatten({ background: '#ffffff' }).jpeg({ quality: 85, progressive: false }).toBuffer();
    return { buffer: jpeg, filename: 'neuroyaga.jpg', type: 'image/jpeg' };
}

function photoAttachment(photo) {
    if (!photo || photo.id == null || photo.owner_id == null) return '';
    const base = `photo${photo.owner_id}_${photo.id}`;
    return photo.access_key ? `${base}_${photo.access_key}` : base;
}

function readUpload(data) {
    let body = data;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    if (!body || typeof body !== 'object') throw new Error('ВК не принял файл');
    if (body.error) throw new Error(typeof body.error === 'string' ? body.error : 'ВК не принял файл');
    return body;
}

async function postFile(url, field, file) {
    const form = new FormData();
    form.append(field, file.buffer, { filename: file.filename, contentType: file.type });
    const res = await axios.post(url, form, {
        headers: form.getHeaders({ 'User-Agent': 'Mozilla/5.0' }),
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });
    return readUpload(res.data);
}

async function deliverFile(token, peerId, caption, attachment) {
    const params = {
        peer_id: String(peerId),
        random_id: String(Math.floor(Math.random() * 2e9)),
        attachment,
        keyboard: mainMenu(peerId)
    };
    if (caption) params.message = String(caption).slice(0, 3500);
    await sendMessage(token, params);
}

async function sendPhoto(token, peerId, file, caption) {
    const server = await call(token, 'photos.getMessagesUploadServer', { peer_id: String(peerId) });
    const uploaded = await postFile(server.upload_url, 'photo', file);
    const saved = await call(token, 'photos.saveMessagesPhoto', {
        photo: uploaded.photo,
        server: String(uploaded.server),
        hash: uploaded.hash
    });
    const list = Array.isArray(saved) ? saved : [saved];
    const attachment = photoAttachment(list[0]);
    if (!attachment) throw new Error('vk photo');
    await deliverFile(token, peerId, caption, attachment);
}

async function sendDoc(token, peerId, file, caption) {
    const server = await call(token, 'docs.getMessagesUploadServer', { peer_id: String(peerId), type: 'doc' });
    const uploaded = await postFile(server.upload_url, 'file', file);
    const saved = await call(token, 'docs.save', { file: uploaded.file, title: 'Картинка' });
    const doc = saved && (saved.doc || saved);
    if (!doc || doc.id == null || doc.owner_id == null) throw new Error('vk doc');
    await deliverFile(token, peerId, caption, `doc${doc.owner_id}_${doc.id}`);
}

async function sendImage(token, peerId, buffer, caption) {
    const file = await fileForVk(buffer);
    try {
        await sendPhoto(token, peerId, file, caption);
    } catch (error) {
        console.error(`ВК не вставил фото (${error.code || ''} ${error.message || ''}). Отправляю файлом.`);
        await sendDoc(token, peerId, file, caption);
    }
}

async function createPayment(amount, description, email, metadata, returnUrl) {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;
    if (!shopId || !secretKey) return null;
    const response = await axios.post('https://api.yookassa.ru/v3/payments', {
        amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: returnUrl || siteLink() },
        capture: true,
        description,
        metadata,
        receipt: {
            customer: { email },
            items: [{
                description,
                quantity: '1.00',
                amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
                vat_code: Number(process.env.YOOKASSA_VAT_CODE || '1')
            }]
        }
    }, {
        auth: { username: shopId, password: secretKey },
        headers: { 'Idempotence-Key': `${Date.now()}-${Math.random()}` },
        timeout: 30000
    });
    return response.data && response.data.confirmation && response.data.confirmation.confirmation_url;
}

async function sendStatus(token, peerId, account) {
    const balance = await db.getUserBalance(account);
    const model = catalog.getModel((await db.getCurrentModel(account)) || catalog.defaultModelKey('vk'), { audience: 'vk' });
    const empty = Number(balance) > 0 ? '' : '\n\nСейчас 0 кредитов. Нажмите «Пополнить». После оплаты они придут в этот чат.';
    await sendText(token, peerId,
        `НейроЯга во ВКонтакте.\n\nБаланс: ${balance} кр.\nМодель: ${model ? model.name : 'текст'}.${empty}\n\n«Модели» — выбрать, что генерировать. «Пополнить» — оплата. «Кабинет» — шаблоны, история и перенос в Telegram. Подробности — кнопка «Справка».`
    );
}

const USER_HELP = [
    'Как пользоваться',
    '1. Нажмите «Модели» и выберите раздел: текст, картинки, видео или музыка.',
    '2. Напишите запрос своими словами. Если у модели несколько цен или размеров, выберите их кнопками внизу. Если модель просит фото, прикрепите его к сообщению.',
    '3. Ответ придёт в этот чат. Картинки также лежат в кабинете, вкладка «История».',
    `${activity.rulesText()} Кнопка «Рейтинг». Кредиты по этому списку начисляет администратор.`,
    '',
    'Как пополнить',
    '1. Нажмите «Пополнить» внизу или на вкладке «Баланс» в кабинете.',
    '2. Выберите пакет. Останутся только пакеты и «Назад».',
    '3. Напишите почту для чека одним сообщением.',
    '4. Нажмите «Оплатить». Если ВК спросит, подтвердите переход: откроется страница банка.',
    '5. После оплаты кредиты придут в этот чат. «Назад» возвращает меню.',
    '',
    'Баланс ВК и Telegram разные. Кнопка «Перенос» внизу отправляет кредиты в Telegram. Чтобы получить кредиты из Telegram, там нажмите «Во ВК» и впишите номер, который бот покажет после «Перенос».'
].join('\n');

async function sendHelp(token, peerId) {
    await sendText(token, peerId, USER_HELP);
}

async function openMenu(token, peerId, account, action, groupId) {
    if (action === 'hello' || action === 'balance') return sendStatus(token, peerId, account);
    if (action === 'more') return sendText(token, peerId, 'Справка или рейтинг.', moreKeyboard());
    if (action === 'help') return sendHelp(token, peerId);
    if (action === 'rate') return sendRating(token, peerId, account, groupId);
    if (action === 'models') {
        const board = JSON.parse(sectionKeyboard());
        if (board.buttons.length < 2) return sendText(token, peerId, 'Сейчас нет доступных моделей.');
        return sendText(token, peerId, 'Выберите раздел. Кнопки внизу, под полем ввода.', sectionKeyboard());
    }
    if (action === 'pay') {
        const board = JSON.parse(payKeyboard());
        if (board.buttons.length < 2) return sendText(token, peerId, `Пополнение в чате сейчас недоступно. Откройте кабинет: ${siteLink()}`);
        return sendText(token, peerId, 'Выберите пакет внизу. Другие кнопки скрыты. «Назад» возвращает меню.', payKeyboard());
    }
}

async function answerEvent(token, event, snackbar) {
    const params = {
        event_id: String(event.eventId || ''),
        user_id: String(event.userId),
        peer_id: String(event.peerId)
    };
    if (snackbar) params.event_data = JSON.stringify({ type: 'show_snackbar', text: String(snackbar).slice(0, 90) });
    await call(token, 'messages.sendMessageEventAnswer', params);
}

async function chooseModel(token, peerId, account, key) {
    const model = catalog.getModel(key, { audience: 'vk' });
    if (!model) return sendText(token, peerId, 'Модель недоступна.');
    await db.setCurrentModel(account, model.key);
    const choice = modelNeedsChoice(model) ? ' После запроса внизу будут цена и размер, как в Telegram.' : '';
    return sendText(token, peerId, `${model.name}. ${catalog.priceLabel(model)}. Напишите запрос.${choice}`);
}

async function askOrRun(token, peerId, account, job) {
    const model = catalog.getModel(job.modelKey, { audience: 'vk' });
    const step = model && choiceKeyboard(model, job);
    if (step) {
        pendingJob.set(String(account), job);
        return sendText(token, peerId, step.text, step.keyboard);
    }
    pendingJob.delete(String(account));
    runJob(token, peerId, account, job).catch(() => {
        console.error('ВК: генерация не завершилась.');
    });
}

const runningJob = new Set();

async function runJob(token, peerId, account, job) {
    const key = String(account);
    if (runningJob.has(key) || gen.isBusy(account)) {
        await sendText(token, peerId, 'Дождитесь завершения предыдущей генерации.', payLockKeyboard());
        return;
    }
    runningJob.add(key);
    try {
        const prepared = await gen.prepare({
            userId: account,
            modelKey: job.modelKey,
            hasImage: false,
            hasText: !!(job.prompt && String(job.prompt).trim()),
            audience: 'vk',
            quality: job.quality || null,
            duration: job.duration || null
        });
        await sendText(token, peerId, 'Делаю ответ…', payLockKeyboard());
        const result = await gen.run({
            userId: account,
            prompt: job.prompt,
            model: prepared.model,
            plugin: prepared.plugin,
            aspectRatio: job.aspect && job.aspect !== 'auto' ? job.aspect : null,
            duration: job.duration || null,
            quality: job.quality || null,
            reason: `ВК · ${prepared.model.name}`,
            groupId: job.groupId || ''
        });
        const done = `Готово. Списано ${result.cost} кр. Осталось ${result.balance}.`;
        try {
            if (result.buffer && result.type === 'image') {
                const pictures = [result.buffer].concat(result.extra || []).filter(Boolean);
                let sent = 0;
                let lastError = null;
                for (const picture of pictures) {
                    try {
                        await sendImage(token, peerId, picture, sent === 0 ? done : '');
                        sent += 1;
                    } catch (pictureError) {
                        lastError = pictureError;
                    }
                }
                if (!sent) throw lastError || new Error('vk photo');
            } else {
                const answer = String(result.text || 'Готово').slice(0, 3200);
                await sendText(token, peerId, `${answer}\n\n${done}`);
            }
        } catch (sendError) {
            await sendText(token, peerId, `${done} В чат картинка не вставилась, она лежит в кабинете на вкладке «История».`);
        }
        return;
    } catch (error) {
        if (error && error.code === 'no_credits') {
            await sendText(token, peerId, `${error.message}\n\nНажмите «Пополнить» внизу.`);
            return;
        }
        await sendText(token, peerId, gen.userMessage(error), payLockKeyboard());
    } finally {
        runningJob.delete(key);
    }
}

async function holdPayment(token, peerId, account, text, action) {
    const key = String(account);
    const pending = pendingPay.get(key);
    if (!pending) return false;
    if (pending.stage === 'link') {
        await sendText(token, peerId, 'Оплата ещё открыта. Нажмите «Оплатить» или «Назад».', payLinkKeyboard(pending.url));
        return true;
    }
    if (action) {
        await sendText(token, peerId, 'Сейчас нужна почта для чека или кнопка «Назад».', payLockKeyboard());
        return true;
    }
    const email = String(text || '').trim();
    if (!emailOk(email)) {
        await sendText(token, peerId, 'Это не почта. Напишите адрес для чека или нажмите «Назад».', payLockKeyboard());
        return true;
    }
    const pkg = catalog.getPackage(pending.pkgId);
    if (!pkg) {
        pendingPay.delete(key);
        await sendText(token, peerId, 'Пакет больше недоступен. Нажмите «Пополнить».', mainMenu(peerId));
        return true;
    }
    let url = null;
    try {
        url = await createPayment(
            pkg.price,
            `Покупка ${pkg.title}`,
            email,
            { userId: key, credits: String(pkg.credits) },
            chatReturnUrl()
        );
    } catch (e) {
        url = null;
    }
    if (!url) {
        await sendText(token, peerId, 'Оплата не открылась. Напишите почту ещё раз или нажмите «Назад».', payLockKeyboard());
        return true;
    }
    pendingPay.set(key, { stage: 'link', pkgId: pkg.id, url });
    await sendText(
        token,
        peerId,
        'Почта принята. Нажмите «Оплатить» — откроется страница банка.\n\nЕсли ВК спросит, подтвердите переход: это оплата. После оплаты кредиты придут в этот чат. «Назад» возвращает меню.',
        payLinkKeyboard(url)
    );
    return true;
}

async function holdMove(token, peerId, account, text, action) {
    const key = String(account);
    const pending = pendingMove.get(key);
    if (!pending) return false;
    if (action === 'move_yes') {
        if (pending.stage !== 'confirm' || !pending.to || !(pending.amount > 0)) {
            await sendText(token, peerId, 'Сначала напишите номер Telegram.', payLockKeyboard());
            return true;
        }
        const moved = await bridge.moveCredits(db, {
            fromId: key,
            toId: pending.to,
            amount: pending.amount,
            takeReason: `Перенос в Telegram ${pending.to}`,
            giveReason: 'Перенос из ВК'
        });
        pendingMove.delete(key);
        if (!moved.ok) {
            await sendText(token, peerId, `${moved.error}\n\nВы в меню.`, mainMenu(peerId));
            return true;
        }
        await sendText(token, peerId, `Перенесли ${pending.amount} кр. в Telegram. Здесь осталось ${moved.balance} кр.`, mainMenu(peerId));
        try { await tellTelegram(pending.to, `Из ВК перенесли ${pending.amount} кр. Они уже на балансе Telegram.`); } catch (e) {}
        return true;
    }
    const board = pending.stage === 'confirm' ? moveConfirmKeyboard() : payLockKeyboard();
    if (action) {
        await sendText(token, peerId, 'Сейчас перенос. Напишите данные или нажмите «Назад».', board);
        return true;
    }
    if (pending.stage === 'who') {
        const raw = String(text || '').trim();
        let to = /^\d{5,15}$/.test(raw) ? raw : '';
        if (!to) {
            const found = await db.findTelegramUser(raw);
            if (found && found.ambiguous) {
                await sendText(token, peerId, 'Таких имён несколько. Напишите номер из Telegram.', payLockKeyboard());
                return true;
            }
            if (found) to = String(found.user_id);
        }
        if (!to || Number(to) <= 0) {
            await sendText(token, peerId, 'Это не номер Telegram. Напишите число или @имя, либо нажмите «Назад».', payLockKeyboard());
            return true;
        }
        pending.to = to;
        pending.stage = 'amount';
        const balance = await db.getUserBalance(account);
        await sendText(token, peerId, `Номер Telegram: ${to}\nНа балансе ${balance} кр.\nНапишите, сколько перенести.`, payLockKeyboard());
        return true;
    }
    const amount = bridge.amountOf(text);
    const balance = await db.getUserBalance(account);
    if (!amount) {
        await sendText(token, peerId, 'Напишите целое число кредитов или нажмите «Назад».', payLockKeyboard());
        return true;
    }
    if (amount > balance) {
        await sendText(token, peerId, `На балансе ${balance} кр. — больше перенести нельзя.`, payLockKeyboard());
        return true;
    }
    pending.amount = amount;
    pending.stage = 'confirm';
    await sendText(token, peerId, `Перенести ${amount} кр. в Telegram ${pending.to}?`, moveConfirmKeyboard());
    return true;
}

async function goBack(token, peerId, account) {
    const key = String(account);
    if (runningJob.has(key) || gen.isBusy(account)) {
        return sendText(token, peerId, 'Ответ ещё готовится.', payLockKeyboard());
    }
    const job = pendingJob.get(key);
    if (job && (job.aspect || job.duration || job.quality)) {
        if (job.aspect) job.aspect = '';
        else if (job.duration) job.duration = 0;
        else job.quality = '';
        return askOrRun(token, peerId, account, job);
    }
    pendingJob.delete(key);
    const pay = pendingPay.get(key);
    if (pay && (pay.stage === 'email' || pay.stage === 'link')) {
        pendingPay.delete(key);
        return sendText(token, peerId, 'Выберите пакет внизу. «Назад» возвращает меню.', payKeyboard());
    }
    pendingPay.delete(key);
    const move = pendingMove.get(key);
    if (move && move.stage === 'confirm') {
        move.stage = 'amount';
        move.amount = 0;
        return sendText(token, peerId, 'Напишите, сколько кредитов перенести. «Назад» — к номеру Telegram.', payLockKeyboard());
    }
    if (move && move.stage === 'amount') {
        move.stage = 'who';
        return sendText(token, peerId, 'Напишите номер или @имя в Telegram. «Назад» возвращает меню.', payLockKeyboard());
    }
    pendingMove.delete(key);
    if (pendingAudit.has(key) || pendingClub.has(key)) {
        pendingAudit.delete(key);
        pendingClub.delete(key);
        return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId));
    }
    return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId));
}

function messageParts(text) {
    const size = 3500;
    const src = String(text || '');
    const out = [];
    let rest = src;
    while (rest.length > size) {
        let cut = rest.lastIndexOf('\n', size);
        if (cut < size * 0.4) cut = size;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n+/, '');
    }
    if (rest) out.push(rest);
    return out.length ? out : [''];
}

async function sendParts(token, peerId, text, keyboard) {
    const parts = messageParts(text);
    for (let i = 0; i < parts.length; i++) {
        await sendText(token, peerId, parts[i], i === parts.length - 1 ? keyboard : payLockKeyboard());
    }
}

async function holdAudit(token, peerId, account, text, action, groupId) {
    const key = String(account);
    if (!pendingAudit.has(key)) return false;
    if (action) {
        pendingAudit.delete(key);
        return false;
    }
    if (!auditHere(groupId)) {
        pendingAudit.delete(key);
        return false;
    }
    const raw = String(text || '').trim();
    if (!raw) {
        await sendText(token, peerId, 'Пришлите ссылку на сообщество: vk.com/название.', payLockKeyboard());
        return true;
    }
    if (runningAudit.has(key)) {
        await sendText(token, peerId, 'Отчёт уже готовится. Дождитесь его в этом чате.', payLockKeyboard());
        return true;
    }
    runningAudit.add(key);
    await sendText(token, peerId, 'Смотрю сообщество. Отчёт придёт в этот чат.', payLockKeyboard());
    audit.run(raw, token).then(async report => {
        await sendParts(token, peerId, report, payLockKeyboard());
        await sendText(token, peerId, 'Можно прислать ещё одну ссылку. «Назад» возвращает меню.', payLockKeyboard());
    }).catch(async error => {
        const shown = error && error.audit
            ? error.message
            : 'Не получилось разобрать это сообщество. Проверьте, что оно открытое и ссылка верная.';
        try { await sendText(token, peerId, shown, payLockKeyboard()); } catch (e) {}
    }).finally(() => runningAudit.delete(key));
    return true;
}

async function holdClub(token, peerId, account, text, action, groupId) {
    const key = String(account);
    if (!pendingClub.has(key)) return false;
    if (action) {
        pendingClub.delete(key);
        return false;
    }
    if (!auditHere(groupId)) {
        pendingClub.delete(key);
        return false;
    }
    const raw = String(text || '').trim();
    if (!raw) {
        await sendText(token, peerId, club.overview(), payLockKeyboard());
        return true;
    }
    let posts = [];
    try { posts = await club.searchPosts(raw); } catch (error) {}
    await sendText(token, peerId, club.reply(raw, posts), payLockKeyboard());
    return true;
}

async function reply(token, peerId, account, text, payload, groupId) {
    let action = menuAction(text, payload);
    if (action === 'audit' && !auditHere(groupId) && !(payload && payload.a === 'audit')) action = '';
    if (action === 'opt_cancel') {
        pendingPay.delete(String(account));
        pendingMove.delete(String(account));
        pendingJob.delete(String(account));
        pendingAudit.delete(String(account));
        pendingClub.delete(String(account));
        try { await db.clearDonutSurvey(account, groupId); } catch (error) {}
        return sendText(token, peerId, 'Запрос отменён.', mainMenu(peerId));
    }
    if (action === 'pay_back') {
        try { await db.clearDonutSurvey(account, groupId); } catch (error) {}
        return goBack(token, peerId, account);
    }
    if (await holdDonutSurvey(token, peerId, account, text, action, payload, groupId)) return;
    if (action === 'quality' || action === 'duration' || action === 'size') {
        const job = pendingJob.get(String(account));
        if (!job) return sendText(token, peerId, 'Запрос устарел. Напишите его ещё раз.', mainMenu(peerId));
        if (action === 'quality') job.quality = payload.q;
        if (action === 'duration') job.duration = Number(payload.d);
        if (action === 'size') job.aspect = payload.s;
        return askOrRun(token, peerId, account, job);
    }
    if (action === 'pack') {
        pendingJob.delete(String(account));
        pendingAudit.delete(String(account));
        pendingClub.delete(String(account));
        const pkg = catalog.getPackage(payload && payload.p);
        if (!pkg) return sendText(token, peerId, 'Пакет недоступен.');
        pendingMove.delete(String(account));
        pendingPay.set(String(account), { stage: 'email', pkgId: pkg.id });
        return sendText(
            token,
            peerId,
            `Пакет «${pkg.title}» — ${pkg.price} ₽, ${pkg.credits} кредитов.\n\nНапишите почту для чека. Другие кнопки скрыты: можно отправить почту или нажать «Назад».`,
            payLockKeyboard()
        );
    }
    if (action === 'move') {
        pendingJob.delete(String(account));
        pendingPay.delete(String(account));
        pendingAudit.delete(String(account));
        pendingClub.delete(String(account));
        pendingMove.set(String(account), { stage: 'who' });
        const shown = String(account).replace(/^-/, '');
        return sendText(
            token,
            peerId,
            `Перенос в Telegram.\n\nВаш номер ВК: ${shown}. В Telegram нажмите «Во ВК» и впишите этот номер, чтобы прислать кредиты сюда.\n\nЧтобы отправить кредиты в Telegram, напишите номер или @имя. Другие кнопки скрыты. «Назад» возвращает меню.`,
            payLockKeyboard()
        );
    }
    if (await holdPayment(token, peerId, account, text, action)) return;
    if (await holdMove(token, peerId, account, text, action)) return;
    if (action === 'audit') {
        pendingJob.delete(String(account));
        pendingPay.delete(String(account));
        pendingMove.delete(String(account));
        if (!auditHere(groupId)) return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId));
        pendingAudit.add(String(account));
        pendingClub.delete(String(account));
        return sendText(
            token,
            peerId,
            'Аудит сообщества.\n\nПришлите ссылку: vk.com/название или vk.ru/название. Разберу последние записи и пришлю отчёт. Кредиты не списываются.\n\n«Назад» возвращает меню.',
            payLockKeyboard()
        );
    }
    if (await holdAudit(token, peerId, account, text, action, groupId)) return;
    if (action === 'club') {
        pendingJob.delete(String(account));
        pendingPay.delete(String(account));
        pendingMove.delete(String(account));
        pendingAudit.delete(String(account));
        if (!auditHere(groupId)) return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId));
        pendingClub.add(String(account));
        return sendText(token, peerId, club.overview(), payLockKeyboard());
    }
    if (await holdClub(token, peerId, account, text, action, groupId)) return;
    if (action) {
        pendingAudit.delete(String(account));
        pendingClub.delete(String(account));
    }
    if (action === 'group') {
        pendingJob.delete(String(account));
        if (!payload || !catalog.GROUPS[payload.g]) return sendText(token, peerId, 'Раздел недоступен.');
        return sendText(token, peerId, `${catalog.GROUPS[payload.g]}. Выберите модель внизу.`, modelKeyboard(payload.g));
    }
    if (action === 'model') {
        pendingJob.delete(String(account));
        return chooseModel(token, peerId, account, payload && payload.m);
    }
    if (action) {
        pendingJob.delete(String(account));
        return openMenu(token, peerId, account, action, groupId);
    }
    if (!text) {
        await sendText(token, peerId, 'Напишите запрос или нажмите кнопку внизу.');
        return;
    }
    const modelKey = (await db.getCurrentModel(account)) || catalog.defaultModelKey('vk');
    return askOrRun(token, peerId, account, { prompt: text, modelKey, quality: '', duration: 0, aspect: '', groupId: groupId || '' });
}

async function handleEvent(token, event, groupId) {
    const account = accountId(event.userId);
    if (!account) return;
    const payload = event.payload || {};
    let snackbar = '';
    if (payload.m) {
        const model = catalog.getModel(payload.m, { audience: 'vk' });
        if (model) {
            await db.setCurrentModel(account, model.key);
            snackbar = `Выбрано: ${model.short}`;
        }
    } else if (payload.p) {
        snackbar = 'Напишите почту для чека';
    }
    try { await answerEvent(token, event, snackbar); } catch (e) {}
    await db.ensureUser(account, `vk:${event.userId}`);
    return reply(token, event.peerId, account, '', payload, groupId);
}

async function noteActivity(update, groupId) {
    const hit = activity.parseCommunityActivity(update, groupId);
    if (!hit) return;
    const account = accountId(hit.vkId);
    if (!account) return;
    if (hit.remove) {
        await db.removeActivity(account, hit.kind, hit.objectKey, groupId);
        return;
    }
    const saved = await db.recordActivity(account, hit.kind, hit.objectKey, activity.POINTS[hit.kind] || 0, groupId);
    if (saved) await db.getUser(account);
}

async function attachFaces(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const accounts = [...new Set(list.map(row => String(row.user_id)))];
    const faces = new Map();
    let cached = [];
    try { cached = await db.listVkProfiles(accounts); } catch (error) { cached = []; }
    const freshUntil = Date.now() - 12 * 60 * 60 * 1000;
    const need = [];
    for (const account of accounts) {
        const hit = cached.find(item => String(item.user_id) === account);
        if (hit && new Date(hit.updated_at).getTime() > freshUntil) {
            faces.set(account, { name: hit.name, photo: hit.photo || '' });
        } else {
            const vkId = account.replace(/^-/, '');
            if (/^\d+$/.test(vkId)) need.push(vkId);
        }
    }
    const token = String(process.env.VK_GROUP_TOKEN || '').trim();
    if (need.length && token) {
        try {
            const users = await call(token, 'users.get', {
                user_ids: need.slice(0, 100).join(','),
                fields: 'photo_100,photo_200',
                lang: '0'
            });
            const save = [];
            for (const user of (Array.isArray(users) ? users : [])) {
                const face = activity.faceOf(user);
                if (!face) continue;
                faces.set(face.userId, face);
                save.push(face);
            }
            if (save.length) await db.saveVkProfiles(save);
        } catch (error) {}
    }
    return list.map(row => activity.present(row, faces.get(String(row.user_id))));
}

async function sendRating(token, peerId, account, groupId) {
    const range = activity.weekRange(new Date());
    let rows = [];
    try {
        rows = await attachFaces(await db.listWeekActivity(range.start, groupId));
    } catch (error) {}
    await sendText(token, peerId, activity.formatRating(rows, account, range));
}

const wallDone = new Set();
const wallPending = new Set();
const ratingWarned = new Set();
let ratingTimer = null;

async function wallMarked(key) {
    if (wallDone.has(key)) return true;
    try {
        const saved = await db.getSettings([key]);
        if (saved && saved[key]) {
            wallDone.add(key);
            return true;
        }
    } catch (error) {}
    return false;
}

async function wallFinish(key) {
    wallDone.add(key);
    try { await db.setSetting(key, { at: new Date().toISOString() }); } catch (error) {}
}

function communityCommentAttempts(groupId, fields) {
    const id = String(groupId || '').replace(/\D/g, '');
    const base = {
        owner_id: String(-Number(id)),
        post_id: String(fields.postId),
        message: String(fields.message || '').slice(0, 1500),
        guid: String(fields.guid || `c${id}`).slice(0, 32)
    };
    const modes = fields.replyTo ? [['1', true], ['1', false], [id, true]] : [['1', false], [id, false]];
    return modes.filter(mode => mode[0]).map(mode => {
        const item = Object.assign({ from_group: mode[0] }, base);
        if (mode[1]) item.reply_to_comment = String(fields.replyTo);
        return item;
    });
}

const wallAccessHint = new Set();

async function commentAsCommunity(token, groupId, fields) {
    const attempts = communityCommentAttempts(groupId, fields);
    let last = null;
    for (const params of attempts) {
        try {
            return await call(token, 'wall.createComment', params);
        } catch (error) {
            last = error;
            if (Number(error && error.code) !== 15) break;
        }
    }
    throw last;
}

function wallAccessLine(groupId, code) {
    if (code !== 15 || wallAccessHint.has(String(groupId))) return '';
    wallAccessHint.add(String(groupId));
    return ' В ключе сообщества нужно право «Стена», а в настройках сообщества — комментарии от имени сообщества.';
}

async function handleCommunityWall(token, update, groupId) {
    if (!auditHere(groupId)) return;
    const post = activity.readWallPost(update, groupId);
    if (post && club.looksLikeLesson(post.text)) {
        const key = `vk_lesson_${groupId}_${post.postId}`;
        if (wallPending.has(key) || await wallMarked(key)) return;
        wallPending.add(key);
        try {
            await commentAsCommunity(token, groupId, {
                postId: post.postId,
                message: club.lessonNote(),
                guid: `lesson-${groupId}-${post.postId}`
            });
            await wallFinish(key);
        } catch (error) {
            const code = Number(error && error.code);
            console.error(`ВК ${groupId}: комментарий к уроку не отправился${code ? ` (${code})` : ''}.${wallAccessLine(groupId, code)}`);
        } finally {
            wallPending.delete(key);
        }
        return;
    }
    const comment = activity.readWallComment(update, groupId);
    if (!comment || comment.text.startsWith('Навигация по урокам')) return;
    const answer = club.commentAnswer(comment.text);
    if (!answer) return;
    const key = `vk_creply_${groupId}_${comment.commentId}`;
    if (wallPending.has(key) || await wallMarked(key)) return;
    wallPending.add(key);
    try {
        await commentAsCommunity(token, groupId, {
            postId: comment.postId,
            replyTo: comment.commentId,
            message: answer.text,
            guid: `reply-${groupId}-${comment.commentId}`
        });
        await wallFinish(key);
    } catch (error) {
        const code = Number(error && error.code);
        console.error(`ВК ${groupId}: ответ на комментарий не отправился${code ? ` (${code})` : ''}.${wallAccessLine(groupId, code)}`);
    } finally {
        wallPending.delete(key);
    }
}

async function publishWeeklyRatings(now) {
    const moment = now instanceof Date ? now : new Date();
    if (!activity.shouldPublishWeek(moment)) return;
    const prev = activity.previousWeek(moment);
    const day = prev.start.toISOString().slice(0, 10);
    for (const item of communityList()) {
        const key = `vk_week_${item.id}_${day}`;
        if (wallDone.has(key)) continue;
        try {
            const saved = await db.getSettings([key]);
            if (saved && saved[key]) {
                wallDone.add(key);
                continue;
            }
            const rows = await attachFaces(await db.listWeekActivity(prev.start, item.id, prev.end));
            await call(item.token, 'wall.post', {
                owner_id: String(-Number(item.id)),
                from_group: '1',
                message: activity.wallSummary(rows, prev)
            });
            await wallFinish(key);
            db.note('sys', `ВК ${item.id}: итог недели на стене`).catch(() => {});
        } catch (error) {
            if (ratingWarned.has(key)) continue;
            ratingWarned.add(key);
            const code = Number(error && error.code);
            console.error(`ВК ${item.id}: итог недели не опубликован${code ? ` (${code})` : ''}.`);
        }
    }
}

function watchWeeklyRating() {
    if (ratingTimer) return;
    const tick = () => {
        publishWeeklyRatings(new Date()).catch(() => {});
    };
    ratingTimer = setInterval(tick, 30 * 60 * 1000);
    if (ratingTimer.unref) ratingTimer.unref();
    tick();
}

function surveyKeyboard() {
    return JSON.stringify({
        one_time: false,
        buttons: [
            [textButton('Да', { a: 'survey', y: 1 }, 'positive'), textButton('Нет', { a: 'survey', y: 0 }, 'secondary')],
            [textButton('Назад', { a: 'pay_back' }, 'secondary')]
        ]
    });
}

async function holdDonutSurvey(token, peerId, account, text, action, payload, groupId) {
    if (!auditHere(groupId)) return false;
    let survey = null;
    try { survey = await db.getDonutSurvey(account, groupId); } catch (error) { return false; }
    if (!survey) return false;
    if (action && action !== 'survey' && action !== 'hello') return false;
    pendingJob.delete(String(account));
    pendingAudit.delete(String(account));
    pendingClub.delete(String(account));
    const answer = donut.parseAnswer(text, payload);
    if (!answer) {
        try {
            if (survey.step === 0) await sendText(token, peerId, donut.welcomeText(), surveyKeyboard());
            await sendText(token, peerId, donut.prompt(survey.step), surveyKeyboard());
        } catch (error) {}
        return true;
    }
    const gaps = survey.gaps.slice();
    if (answer === 'no') gaps.push(survey.step);
    const next = survey.step + 1;
    try {
        if (next >= donut.QUESTIONS.length) {
            await db.clearDonutSurvey(account, groupId);
            await sendParts(token, peerId, donut.resultText(gaps), mainMenu(peerId, groupId));
            return true;
        }
        await db.saveDonutSurvey(account, groupId, next, gaps);
    } catch (error) {
        await sendText(token, peerId, 'Не сохранила ответ. Нажмите «Да» или «Нет» ещё раз.', surveyKeyboard());
        return true;
    }
    await sendText(token, peerId, donut.prompt(next), surveyKeyboard());
    return true;
}

async function handleDonutJoin(token, update, groupId) {
    if (!auditHere(groupId)) return;
    const hit = donut.readDonutEvent(update);
    if (!hit) return;
    try { await db.recordDonut(groupId, hit.userId, hit.kind, hit.amount); } catch (error) {}
    if (hit.kind !== 'create') return;
    const account = accountId(hit.userId);
    if (!account) return;
    let existing = null;
    try { existing = await db.getDonutSurvey(account, groupId); } catch (error) { return; }
    if (existing) return;
    try {
        await db.ensureUser(account, `vk:${hit.userId}`);
        await db.saveDonutSurvey(account, groupId, 0, []);
        await sendText(token, hit.userId, donut.welcomeText(), surveyKeyboard());
        await sendText(token, hit.userId, donut.prompt(0), surveyKeyboard());
    } catch (error) {
        const code = Number(error && error.code);
        console.error(`ВК ${groupId}: опрос доната не доставлен${code ? ` (${code})` : ''}.`);
    }
}

function memberFace(item) {
    if (!item || typeof item !== 'object') return null;
    const id = Number(item.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const name = [item.first_name, item.last_name].map(part => String(part || '').trim()).filter(Boolean).join(' ');
    const photo = String(item.photo_100 || item.photo_200 || '');
    return { id, name: name || `ВК ${id}`, photo: /^https:\/\//i.test(photo) ? photo : '' };
}

async function collectDonors(token, groupId) {
    const items = [];
    let total = 0;
    let offset = 0;
    for (let page = 0; page < 3; page++) {
        const pack = await call(token, 'groups.getMembers', {
            group_id: String(groupId),
            filter: 'donut',
            fields: 'photo_100',
            count: '1000',
            offset: String(offset)
        });
        total = Number(pack && pack.count) || total;
        const chunk = Array.isArray(pack && pack.items) ? pack.items : [];
        chunk.forEach(item => {
            if (typeof item === 'number') items.push({ id: item, name: `ВК ${item}`, photo: '' });
            else {
                const face = memberFace(item);
                if (face) items.push(face);
            }
        });
        offset += chunk.length;
        if (!chunk.length || offset >= total) break;
    }
    return { total: total || items.length, items };
}

async function communityDonut(groupId) {
    const id = String(groupId || '').replace(/\D/g, '');
    const item = communityList().find(entry => entry.id === id);
    const status = communityStatus().find(entry => entry.id === id) || null;
    if (!item) return { id, name: '', members: 0, donors: [], donorTotal: 0, donorError: 'Сообщество не подключено.', status };
    let name = item.name || (status && status.name) || '';
    let members = 0;
    try {
        const info = await call(item.token, 'groups.getById', { group_id: id, fields: 'members_count' });
        const group = info && (info.groups ? info.groups[0] : (Array.isArray(info) ? info[0] : null));
        if (group) {
            name = String(group.name || name);
            members = Number(group.members_count) || 0;
        }
    } catch (error) {}
    let donors = [];
    let donorTotal = 0;
    let donorError = '';
    try {
        const pack = await collectDonors(item.token, id);
        donors = pack.items;
        donorTotal = pack.total;
    } catch (error) {
        donorError = 'Список донов сейчас не открылся.';
    }
    const range = activity.weekRange(new Date());
    let weekPeople = 0;
    let weekPoints = 0;
    try {
        const rows = await db.listWeekActivity(range.start, id);
        weekPeople = rows.length;
        weekPoints = rows.reduce((sum, row) => sum + (Number(row.points) || 0), 0);
    } catch (error) {}
    return {
        id, name, members, donors, donorTotal, donorError, status,
        week: range.label, weekPeople, weekPoints
    };
}

async function handleUpdate(token, update, groupId) {
    try { await noteActivity(update, groupId); } catch (error) {}
    try { await handleCommunityWall(token, update, groupId); } catch (error) {}
    try { await handleDonutJoin(token, update, groupId); } catch (error) {}
    const event = readEvent(update);
    if (event) {
        if (keepsQuiet(groupId, event.peerId)) return;
        return handleEvent(token, event, groupId);
    }
    const incoming = readIncoming(update);
    if (!incoming || keepsQuiet(groupId, incoming.peerId)) return;
    const account = accountId(incoming.fromId);
    if (!account) return;
    const { isNew } = await db.ensureUser(account, `vk:${incoming.fromId}`);
    const bonus = catalog.getGeneral().start_bonus;
    if (isNew && bonus > 0) await db.updateBalance(account, bonus, 'Приветственный бонус');
    await reply(token, incoming.peerId, account, incoming.text, incoming.payload, groupId);
}

async function sendToUser(accountIdValue, buffer, mime, caption) {
    const id = Number(accountIdValue);
    if (!Number.isInteger(id) || id >= 0 || !buffer) return false;
    const peerId = -id;
    for (const item of communityList()) {
        try {
            if (String(mime || '').startsWith('image/')) {
                await sendImage(item.token, peerId, buffer, caption || 'Файл из кабинета.');
            } else {
                await sendText(item.token, peerId, caption || 'Файл готов в кабинете.');
            }
            return true;
        } catch (e) {}
    }
    return false;
}

async function askTopup(accountIdValue) {
    const id = Number(accountIdValue);
    if (!Number.isInteger(id) || id >= 0) return null;
    for (const item of communityList()) {
        try {
            await sendText(item.token, -id, 'Выберите пакет внизу. Другие кнопки скрыты. «Назад» возвращает меню.', payKeyboard());
            return chatReturnUrl();
        } catch (e) {}
    }
    return null;
}

async function notify(accountIdValue, message) {
    const id = Number(accountIdValue);
    if (!Number.isInteger(id) || id >= 0) return false;
    for (const item of communityList()) {
        try {
            await sendText(item.token, -id, message);
            return true;
        } catch (e) {}
    }
    return false;
}

async function tokenNote(token) {
    const parts = [];
    try {
        const perm = await call(token, 'groups.getTokenPermissions', {});
        const names = ((perm && perm.permissions) || []).filter(item => item.setting).map(item => item.name);
        if (names.length) parts.push(names.join(', '));
    } catch (e) {}
    try {
        const info = await call(token, 'groups.getById', {});
        const group = info && (info.groups ? info.groups[0] : (Array.isArray(info) ? info[0] : null));
        if (group && group.id) parts.push(`ключ от сообщества ${group.id}${group.name ? ` «${group.name}»` : ''}`);
    } catch (e) {}
    return parts.join('. ');
}

const linkState = new Map();

function markCommunity(groupId, online, hint, extra) {
    const id = String(groupId);
    const prev = linkState.get(id) || {};
    linkState.set(id, Object.assign({}, prev, extra || {}, {
        online: !!online,
        hint: hint == null ? String(prev.hint || '') : String(hint || '')
    }));
}

function communityStatus() {
    const primary = String(process.env.VK_GROUP_ID || '').replace(/\D/g, '');
    return communityList().map(item => {
        const state = linkState.get(item.id) || { online: false, hint: 'Подключаюсь.' };
        const extra = item.id !== primary;
        return {
            id: item.id,
            name: item.name || '',
            online: !!state.online,
            hint: state.hint || '',
            events: state.events || '',
            audit: extra,
            club: extra
        };
    });
}

async function poll(token, groupId) {
    let online = false;
    let failLogged = false;
    for (;;) {
        try {
            let server = await call(token, 'groups.getLongPollServer', { group_id: groupId });
            if (!online) {
                online = true;
                markCommunity(groupId, true, '');
                console.log(`ВК ${groupId} подключён, жду сообщения сообщества.`);
                db.note('sys', `ВК ${groupId} подключён`).catch(() => {});
                await enableButtons(token, groupId);
                await enableActivity(token, groupId);
                watchCommunityActivity(token, groupId);
            }
            for (;;) {
                let res;
                try {
                    res = await axios.get(server.server, {
                        params: { act: 'a_check', key: server.key, ts: server.ts, wait: 25 },
                        timeout: 35000
                    });
                } catch (error) {
                    await new Promise(r => setTimeout(r, 3000));
                    break;
                }
                const data = res.data || {};
                if (data.failed === 1 && data.ts) {
                    server.ts = data.ts;
                    continue;
                }
                if (data.failed) break;
                if (data.ts) server.ts = data.ts;
                const updates = Array.isArray(data.updates) ? data.updates : [];
                for (const update of updates) {
                    try {
                        await communityContext.run({ groupId }, () => handleUpdate(token, update, groupId));
                    } catch (error) {
                        const code = Number(error && error.code);
                        console.error(`ВК: сообщение не обработано${code ? ` (${code})` : ''}.`);
                    }
                }
            }
        } catch (error) {
            online = false;
            const code = Number(error && error.code);
            const hint = connectHint(error);
            markCommunity(groupId, false, hint);
            if (!failLogged) {
                failLogged = true;
                const about = await tokenNote(token);
                const full = about ? `${hint} На сервере сейчас: ${about}.` : hint;
                markCommunity(groupId, false, full);
                console.error(`ВК ${groupId} не подключился${code ? ` (${code})` : ''}. ${full} Telegram работает как прежде.`);
                db.note('sys', `ВК ${groupId} не подключился. ${full}`).catch(() => {});
            }
            await new Promise(r => setTimeout(r, 15000));
        }
    }
}

let resolvedCommunities = null;

function communitiesFromEnv() {
    const out = [];
    const seen = new Set();
    function add(idRaw, tokenRaw) {
        const id = String(idRaw || '').replace(/\D/g, '');
        const token = String(tokenRaw || '').trim();
        if (!id || !token || seen.has(id)) return;
        seen.add(id);
        out.push({ id, token });
    }
    add(process.env.VK_GROUP_ID, process.env.VK_GROUP_TOKEN);
    add(process.env.VK_GROUP_ID_2, process.env.VK_GROUP_TOKEN_2);
    return out;
}

function communityList() {
    return resolvedCommunities || communitiesFromEnv();
}

async function communityFromToken(token, fallbackId) {
    try {
        const info = await call(token, 'groups.getById', {});
        const group = info && (info.groups ? info.groups[0] : (Array.isArray(info) ? info[0] : null));
        const id = group && String(group.id || '').replace(/\D/g, '');
        if (id) return { id, name: String(group.name || '').trim() };
    } catch (e) {}
    return { id: String(fallbackId || '').replace(/\D/g, ''), name: '' };
}

function communityId(value) {
    const id = String(value || '').replace(/\D/g, '');
    if (id) return id;
    const list = communityList();
    return list[0] ? list[0].id : '';
}

async function startVk() {
    const raw = communitiesFromEnv();
    const next = [];
    const seen = new Set();
    for (const item of raw) {
        const found = await communityFromToken(item.token, item.id);
        const id = found && found.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        next.push({ id, token: item.token, name: found.name || '' });
    }
    resolvedCommunities = next;
    const names = next.map(item => item.id).join(', ');
    db.note('sys', names ? `ВК сообщества: ${names}` : 'ВК сообщества не заданы').catch(() => {});
    watchWeeklyRating();
    for (const item of next) {
        poll(item.token, item.id).catch(() => {});
    }
}

module.exports = {
    accountId, readIncoming, readEvent, isGreeting, menuAction, mainMenu, cabinetLink, payKeyboard, payLockKeyboard, payLinkKeyboard, emailOk, createPayment, sectionKeyboard, modelKeyboard, nextChoice, modelNeedsChoice, connectHint, keepsQuiet, startVk, notify, sendToUser, askTopup, setTelegramNotify, attachFaces, fileForVk, photoAttachment, communityList, communityId, communityStatus, communityDonut, communityCommentAttempts, USER_HELP
};
