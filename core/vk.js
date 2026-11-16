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
const lesson = require('./vk-lesson');
const maintenance = require('./maintenance');
let gigaPlugin = null;
try { gigaPlugin = require('../ai_plugins/gigachat_plugin'); } catch (e) {}

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
        payload: parsePayload(message.payload),
        photos: messagePhotoUrls(message),
        messageId: Number(message.id) || 0
    };
}

function urlsFromAttachments(list) {
    const urls = [];
    if (!Array.isArray(list)) return urls;
    list.forEach(item => {
        if (!item || item.type !== 'photo' || !item.photo) return;
        const sizes = Array.isArray(item.photo.sizes) ? item.photo.sizes : [];
        let best = null;
        sizes.forEach(size => {
            if (!size || !size.url) return;
            const area = (Number(size.width) || 0) * (Number(size.height) || 0);
            if (!best || area > best.area) best = { url: size.url, area };
        });
        const url = (item.photo.orig_photo && item.photo.orig_photo.url) || (best && best.url) || '';
        if (url && urls.indexOf(url) < 0) urls.push(url);
    });
    return urls;
}

function messagePhotoUrls(message) {
    const own = urlsFromAttachments(message && message.attachments);
    const replied = urlsFromAttachments(message && message.reply_message && message.reply_message.attachments);
    const urls = own.length && replied.length ? replied.concat(own) : own;
    return urls.filter((url, index) => url && urls.indexOf(url) === index).slice(0, 6);
}

const PHOTO_HOLD_MS = 15 * 60 * 1000;
const PHOTO_JOIN_MS = 2 * 60 * 1000;

function keepPhotos(previous, fresh, ageMs) {
    const held = Array.isArray(previous) && ageMs < PHOTO_HOLD_MS ? previous.filter(Boolean) : [];
    const incoming = Array.isArray(fresh) ? fresh.filter(Boolean) : [];
    if (!incoming.length) return held.slice(-6);
    const recent = ageMs < PHOTO_JOIN_MS ? held : [];
    return recent.concat(incoming).slice(-6);
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
    return String(process.env.WEBAPP_URL || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app').replace(/\/$/, '');
}

function appCabinetUrl(account, options) {
    const opts = options || {};
    if (account == null) return siteLink();
    const params = new URLSearchParams();
    params.set('tk', auth.signUserId(account));
    if (opts.pkgId) params.set('pkg', String(opts.pkgId));
    if (opts.paid) params.set('paid', '1');
    const group = String(opts.groupId || '').replace(/\D/g, '');
    if (group) params.set('vk_group_id', group);
    return `${appBase()}/vk.html?${params.toString()}`;
}

function cabinetLink(account, pkgId, groupId) {
    if (account == null) return siteLink();
    return appCabinetUrl(account, { pkgId, groupId: groupId || currentGroup() });
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
        [textButton('Справка', { a: 'help' }, 'secondary'), textButton('Рейтинг', { a: 'rate' }, 'secondary')]
    ];
}

function textOnlyMenu() {
    return JSON.stringify({ one_time: false, buttons: textRows() });
}

function communityTitle(groupId) {
    const id = String(groupId || '').replace(/\D/g, '');
    if (id === '230706467') return 'Точки и Линии';
    if (id === '214554778') return 'НейроЯга';
    if (id && id === clubGroupId()) return 'НейроЯга';
    return 'НейроЯга';
}

function clubGroupId() {
    const primary = String(process.env.VK_GROUP_ID || '').replace(/\D/g, '');
    const configured = String(process.env.VK_GROUP_ID_2 || '').replace(/\D/g, '');
    if (configured && configured !== primary) return configured;
    return '214554778';
}

function auditHere(groupId) {
    const current = String(groupId || currentGroup() || '').replace(/\D/g, '');
    if (!current || current !== clubGroupId()) return false;
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

function chatReturnUrl(groupId) {
    const asked = String(groupId || '').replace(/\D/g, '');
    const group = asked || String(process.env.VK_GROUP_ID || '').replace(/\D/g, '');
    if (asked) return `https://vk.com/im?sel=-${asked}`;
    if (group) return `https://vk.com/im?sel=-${group}`;
    return siteLink();
}

function communitiesForNotice(list, groupId) {
    const id = String(groupId || '').replace(/\D/g, '');
    const items = Array.isArray(list) ? list : [];
    if (!id || id === '0') return items.slice();
    return items.filter(item => String(item.id) === id);
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
    const clear = JSON.stringify({ one_time: false, buttons: [] });
    if (failed === payLockKeyboard()) return clear;
    const plain = textOnlyMenu();
    if (failed !== plain) return plain;
    if (failed !== clear) return clear;
    return '';
}

function modeHolds(mode, action) {
    if (mode !== 'audit' && mode !== 'club') return false;
    return action !== 'pay_back' && action !== 'opt_cancel';
}

function dialogKind(account) {
    const key = String(account);
    if (pendingAudit.has(key)) return 'audit';
    if (pendingClub.has(key)) return 'club';
    return '';
}

async function rememberDialog(account, mode) {
    const key = String(account);
    pendingAudit.delete(key);
    pendingClub.delete(key);
    if (mode === 'audit') pendingAudit.add(key);
    if (mode === 'club') pendingClub.add(key);
    try { await db.setVkMode(account, mode === 'audit' || mode === 'club' ? mode : ''); } catch (error) {}
}

async function restoreDialog(account) {
    const live = dialogKind(account);
    if (live) return live;
    let mode = '';
    try { mode = await db.getVkMode(account); } catch (error) { return ''; }
    const key = String(account);
    if (mode === 'audit') pendingAudit.add(key);
    if (mode === 'club') pendingClub.add(key);
    return dialogKind(account);
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

async function postFile(url, field, file, timeoutMs) {
    const form = new FormData();
    form.append(field, file.buffer, { filename: file.filename, contentType: file.type });
    const res = await axios.post(url, form, {
        headers: form.getHeaders({ 'User-Agent': 'Mozilla/5.0' }),
        timeout: timeoutMs || 60000,
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

async function messagePhoto(file, width) {
    const buf = file && file.buffer;
    const limit = width || 2048;
    const isJpeg = buf && buf[0] === 0xff && buf[1] === 0xd8;
    if (isJpeg && buf.length <= 4 * 1024 * 1024 && limit >= 2048) {
        try {
            const meta = await sharp(buf, { failOn: 'none' }).metadata();
            const w = meta.width || 0;
            const h = meta.height || 0;
            if (w && h && w <= 4096 && h <= 4096 && !meta.isProgressive) {
                return { buffer: file.buffer, filename: file.filename, type: file.type, width: w, height: h };
            }
        } catch (error) {}
    }
    const jpeg = await sharp(buf, { failOn: 'none', limitInputPixels: false }).rotate().resize({
        width: limit,
        height: limit,
        fit: 'inside',
        withoutEnlargement: true
    }).flatten({ background: '#ffffff' }).jpeg({ quality: limit >= 2048 ? 85 : 75, progressive: false }).toBuffer();
    const meta = await sharp(jpeg, { failOn: 'none' }).metadata();
    return { buffer: jpeg, filename: 'neuroyaga.jpg', type: 'image/jpeg', width: meta.width || 0, height: meta.height || 0 };
}

function uploadPhotoField(photo) {
    if (typeof photo === 'string') {
        const value = photo.trim();
        if (!value || value === '[]' || value === '{}') return '';
        return value;
    }
    if (!photo || typeof photo !== 'object') return '';
    const value = JSON.stringify(photo);
    if (!value || value === '[]' || value === '{}' || value === 'null') return '';
    return value;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postUpload(url, field, file) {
    const form = new FormData();
    form.append(field, file.buffer, { filename: file.filename, contentType: file.type });
    const res = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
    });
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data == null ? '' : res.data);
    let body = res.data;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); }
        catch (error) { throw new Error('upload HTTP ' + res.status + ': ' + raw.slice(0, 150)); }
    }
    if (!body || typeof body !== 'object' || body.error) {
        throw new Error('upload HTTP ' + res.status + ': ' + raw.slice(0, 150));
    }
    return body;
}

async function uploadMessagePhoto(token, peerId, file) {
    const server = await call(token, 'photos.getMessagesUploadServer', { peer_id: String(peerId) });
    const uploaded = await postUpload(server.upload_url, 'photo', {
        buffer: file.buffer,
        filename: 'photo_' + Date.now() + '.jpg',
        type: 'image/jpeg'
    });
    const field = uploadPhotoField(uploaded && uploaded.photo);
    if (!field) throw new Error('photo empty: ' + JSON.stringify(uploaded).slice(0, 200));
    const saved = await call(token, 'photos.saveMessagesPhoto', {
        photo: field,
        server: String(uploaded.server),
        hash: uploaded.hash
    });
    const list = Array.isArray(saved) ? saved : [saved];
    const attachment = photoAttachment(list[0]);
    if (!attachment) throw new Error('vk photo');
    const remote = largestPhotoUrl(list[0]);
    if (remote) {
        try {
            const got = await axios.get(remote, { responseType: 'arraybuffer', timeout: 30000, maxRedirects: 3 });
            if (!(await samePicture(file.buffer, Buffer.from(got.data)))) throw new Error('photo mismatch');
        } catch (error) {
            if (String(error && error.message || '') === 'photo mismatch') throw error;
        }
    }
    return attachment;
}

function largestPhotoUrl(photo) {
    const sizes = photo && Array.isArray(photo.sizes) ? photo.sizes : [];
    let best = '';
    let area = -1;
    sizes.forEach(item => {
        if (!item || !item.url) return;
        const next = (Number(item.width) || 0) * (Number(item.height) || 0);
        if (next >= area) {
            area = next;
            best = item.url;
        }
    });
    const orig = photo && photo.orig_photo && photo.orig_photo.url;
    return orig || best;
}

async function samePicture(left, right) {
    const sample = buf => sharp(buf, { failOn: 'none' }).resize(16, 16, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const a = await sample(left);
    const b = await sample(right);
    if (!a.length || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    return diff / a.length < 35;
}

async function sendPhoto(token, peerId, file, caption) {
    let blob = await messagePhoto(file, 2048);
    let shrunk = false;
    if (blob.buffer.length > 1.5 * 1024 * 1024) {
        blob = await messagePhoto(blob, 1600);
        shrunk = true;
    }
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const attachment = await uploadMessagePhoto(token, peerId, blob);
            await deliverFile(token, peerId, caption, attachment);
            return;
        } catch (error) {
            lastError = error;
            const message = String(error && error.message || '');
            if (!shrunk && (blob.buffer.length > 800 * 1024 || /photo empty|photo mismatch|upload HTTP [45]/.test(message))) {
                blob = await messagePhoto(blob, 1280);
                shrunk = true;
            }
            if (attempt < 3) await sleep(attempt * 3000);
        }
    }
    throw lastError || new Error('vk photo');
}

function mediaFile(kind, buffer) {
    if (!buffer) return null;
    if (kind === 'video') return { buffer, filename: 'neuroyaga.mp4', type: 'video/mp4', title: 'Видео.mp4' };
    if (kind === 'audio') {
        const head = buffer.slice(0, 12).toString('ascii');
        if (head.startsWith('OggS')) return { buffer, filename: 'neuroyaga.ogg', type: 'audio/ogg', title: 'Аудио.ogg' };
        if (head.startsWith('RIFF')) return { buffer, filename: 'neuroyaga.wav', type: 'audio/wav', title: 'Аудио.wav' };
        return { buffer, filename: 'neuroyaga.mp3', type: 'audio/mpeg', title: 'Аудио.mp3' };
    }
    return null;
}

async function uploadMessageVideo(token, file) {
    const group = (typeof communityList === 'function' ? communityList() : []).find(item => item && item.token === token);
    const params = { name: 'НейроЯга', is_private: 1, wallpost: 0 };
    if (group && group.id) params.group_id = String(group.id);
    const saved = await call(token, 'video.save', params);
    if (!saved || !saved.upload_url || saved.video_id == null || saved.owner_id == null) throw new Error('vk video');
    await postFile(saved.upload_url, 'video_file', file, 180000);
    const key = saved.access_key ? `_${saved.access_key}` : '';
    return `video${saved.owner_id}_${saved.video_id}${key}`;
}

async function sendDoc(token, peerId, file, caption, title) {
    const server = await call(token, 'docs.getMessagesUploadServer', { peer_id: String(peerId), type: 'doc' });
    const wait = String(file && file.type || '').startsWith('video/') ? 180000 : 60000;
    const uploaded = await postFile(server.upload_url, 'file', file, wait);
    const saved = await call(token, 'docs.save', { file: uploaded.file, title: title || file.title || 'Картинка' });
    const doc = saved && (saved.doc || saved);
    if (!doc || doc.id == null || doc.owner_id == null) throw new Error('vk doc');
    await deliverFile(token, peerId, caption, `doc${doc.owner_id}_${doc.id}`);
}

async function sendMedia(token, peerId, buffer, kind, caption) {
    const file = mediaFile(kind, buffer);
    if (!file) throw new Error('vk file');
    if (kind === 'video') {
        try {
            const attachment = await uploadMessageVideo(token, file);
            await deliverFile(token, peerId, caption, attachment);
            console.log('ВК: в чат ушло видео этой генерации.');
            return;
        } catch (error) {
            console.error(`ВК не вставил видео (${error.message || ''}). Отправляю файлом.`);
        }
    }
    await sendDoc(token, peerId, file, caption, file.title);
    console.log(kind === 'video' ? 'ВК: в чат ушло видео этой генерации.' : 'ВК: в чат ушло аудио этой генерации.');
}

async function sendImage(token, peerId, buffer, caption) {
    const file = await fileForVk(buffer);
    try {
        await sendPhoto(token, peerId, file, caption);
        console.log('ВК: в чат ушло фото этой генерации.');
    } catch (error) {
        const mismatch = /photo mismatch/.test(String(error && error.message || ''));
        console.error(mismatch
            ? 'ВК сохранил другую картинку. Отправляю файл с изображением этой генерации.'
            : `ВК не вставил фото (${error.message || ''}). Отправляю файлом.`);
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

async function sendStatus(token, peerId, account, groupId) {
    const balance = await db.getUserBalance(account);
    const model = catalog.getModel((await db.getCurrentModel(account)) || catalog.defaultModelKey('vk'), { audience: 'vk' });
    const empty = Number(balance) > 0 ? '' : '\n\nСейчас 0 кредитов. Нажмите «Пополнить» или откройте «Баланс» в кабинете. После оплаты они придут в этот чат.';
    await sendText(token, peerId,
        `${communityTitle(groupId)}.\n\nБаланс: ${balance} кр.\nМодель: ${model ? model.name : 'текст'}.${empty}\n\n«Модели» — что генерировать. «Пополнить» — оплата в этот чат. «Кабинет» — шаблоны, история и баланс. «Справка» и «Рейтинг» — отдельные кнопки внизу.`
    );
}

async function sendHelp(token, peerId, groupId) {
    await sendParts(token, peerId, catalog.clientHelp('vk'), mainMenu(peerId, groupId));
}

async function openMenu(token, peerId, account, action, groupId) {
    if (action === 'hello' || action === 'balance') return sendStatus(token, peerId, account, groupId);
    if (action === 'more') return sendText(token, peerId, 'Справка или рейтинг.', moreKeyboard());
    if (action === 'help') return sendHelp(token, peerId, groupId);
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
const heldPhotos = new Map();

async function loadPhotoBuffers(urls) {
    const buffers = [];
    for (const url of (urls || []).slice(0, 6)) {
        if (!/^https:\/\//i.test(String(url || ''))) continue;
        try {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxRedirects: 3 });
            const buf = Buffer.from(res.data);
            if (buf.length > 32) buffers.push(buf);
        } catch (error) {}
    }
    return buffers;
}

function takeReferencePhotos(account, fresh) {
    const key = String(account);
    const held = heldPhotos.get(key);
    heldPhotos.delete(key);
    const age = held ? Date.now() - held.at : PHOTO_HOLD_MS;
    return keepPhotos(held && held.buffers, fresh, age);
}

function stashPhotos(account, fresh) {
    const key = String(account);
    const held = heldPhotos.get(key);
    const age = held ? Date.now() - held.at : PHOTO_HOLD_MS;
    const older = held && age < PHOTO_HOLD_MS ? held.buffers : [];
    const buffers = older.concat(fresh || []).filter(Boolean).slice(-6);
    heldPhotos.set(key, { buffers, at: Date.now() });
    return buffers;
}

async function completePhotos(token, incoming) {
    const urls = Array.isArray(incoming.photos) ? incoming.photos : [];
    if (urls.length !== 1 || !incoming.messageId) return urls.slice(0, 6);
    try {
        const res = await call(token, 'messages.getById', { message_ids: String(incoming.messageId) });
        const message = res && Array.isArray(res.items) ? res.items[0] : null;
        const full = messagePhotoUrls(message);
        if (full.length > urls.length) return full.slice(0, 6);
    } catch (error) {}
    return urls.slice(0, 6);
}

async function runJob(token, peerId, account, job) {
    const key = String(account);
    if (runningJob.has(key) || gen.isBusy(account)) {
        await sendText(token, peerId, 'Дождитесь завершения предыдущей генерации.', payLockKeyboard());
        return;
    }
    runningJob.add(key);
    try {
        const picked = catalog.getModel(job.modelKey, { audience: 'vk' });
        const photos = picked && picked.image === 'forbidden' ? [] : (Array.isArray(job.photos) ? job.photos.filter(Boolean) : []);
        const prepared = await gen.prepare({
            userId: account,
            modelKey: job.modelKey,
            hasImage: photos.length > 0,
            hasText: !!(job.prompt && String(job.prompt).trim()),
            audience: 'vk',
            quality: job.quality || null,
            duration: job.duration || null
        });
        const waiting = prepared.model.kind === 'video'
            ? 'Собираю видео. Обычно это несколько минут, готовый ролик придёт в этот чат.'
            : prepared.model.kind === 'audio'
                ? 'Собираю аудио. Готовый файл придёт в этот чат.'
                : 'Делаю ответ…';
        await sendText(token, peerId, waiting, payLockKeyboard());
        const result = await gen.run({
            userId: account,
            prompt: job.prompt,
            model: prepared.model,
            plugin: prepared.plugin,
            fileBuffer: photos.length === 1 ? photos[0] : null,
            fileBuffers: photos.length > 1 ? photos : undefined,
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
            } else if (result.buffer && (result.type === 'video' || result.type === 'audio')) {
                const files = [result.buffer].concat(result.extra || []).filter(Boolean);
                for (let i = 0; i < files.length; i++) {
                    await sendMedia(token, peerId, files[i], result.type, i === 0 ? done : '');
                }
            } else {
                const answer = String(result.text || 'Готово').slice(0, 3200);
                await sendText(token, peerId, `${answer}\n\n${done}`);
            }
        } catch (sendError) {
            const kept = result.type === 'video' ? 'Видео' : result.type === 'audio' ? 'Аудио' : 'Картинка';
            await sendText(token, peerId, `${done} ${kept} в чат не вставилось, оно лежит в кабинете на вкладке «История».`);
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

async function holdPayment(token, peerId, account, text, action, groupId) {
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
        const home = String(pending.groupId || groupId || '').replace(/\D/g, '');
        url = await createPayment(
            pkg.price,
            `Покупка ${pkg.title}`,
            email,
            { userId: key, credits: String(pkg.credits), vkGroup: home },
            chatReturnUrl(home)
        );
    } catch (e) {
        url = null;
    }
    if (!url) {
        await sendText(token, peerId, 'Оплата не открылась. Напишите почту ещё раз или нажмите «Назад».', payLockKeyboard());
        return true;
    }
    pendingPay.set(key, { stage: 'link', pkgId: pkg.id, url, groupId: String(pending.groupId || groupId || '').replace(/\D/g, '') });
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

async function goBack(token, peerId, account, groupId) {
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
    await rememberDialog(account, '');
    return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId, groupId));
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
    if (action) return false;
    const raw = String(text || '').trim();
    if (!raw) {
        await sendText(token, peerId, audit.guide(), payLockKeyboard());
        return true;
    }
    if (runningAudit.has(key)) {
        await sendText(token, peerId, 'Отчёт уже готовится. Дождитесь его в этом чате. «Назад» выходит из аудита.', payLockKeyboard());
        return true;
    }
    runningAudit.add(key);
    await sendText(token, peerId, 'Смотрю сообщество. Отчёт придёт в этот чат. После него можно сразу прислать следующую ссылку.', payLockKeyboard());
    audit.run(raw, token).then(async report => {
        const still = dialogKind(account) === 'audit';
        const board = still ? payLockKeyboard() : mainMenu(peerId, groupId);
        await sendParts(token, peerId, report, board);
        if (!still) return;
        await sendText(token, peerId, 'Аудит всё ещё открыт. Следующую ссылку пришлите сюда же, без кнопок моделей. «Назад» возвращает меню.', payLockKeyboard());
    }).catch(async error => {
        const shown = error && error.audit
            ? error.message
            : 'Не получилось разобрать это сообщество. Проверьте, что оно открытое и ссылка верная.';
        const board = dialogKind(account) === 'audit' ? payLockKeyboard() : mainMenu(peerId, groupId);
        try { await sendText(token, peerId, shown, board); } catch (e) {}
    }).finally(() => runningAudit.delete(key));
    return true;
}

async function holdDialog(token, peerId, account, text, action, groupId, mode) {
    if (mode === 'club') {
        if (action && action !== 'club') {
            return sendText(token, peerId, 'Сейчас открыт клуб. Напишите вопрос или нажмите «Назад».', payLockKeyboard());
        }
        if (action === 'club') return sendText(token, peerId, club.overview(), payLockKeyboard());
        if (await holdClub(token, peerId, account, text, '', groupId)) return;
        return sendText(token, peerId, club.overview(), payLockKeyboard());
    }
    if (action && action !== 'audit') {
        return sendText(token, peerId, 'Сейчас открыт аудит. Пришлите ссылку на сообщество в это поле. Модели и остальные кнопки включатся после «Назад».', payLockKeyboard());
    }
    if (action === 'audit') return sendText(token, peerId, audit.guide(), payLockKeyboard());
    if (await holdAudit(token, peerId, account, text, '', groupId)) return;
    return sendText(token, peerId, audit.guide(), payLockKeyboard());
}

async function holdClub(token, peerId, account, text, action, groupId) {
    const key = String(account);
    if (!pendingClub.has(key)) return false;
    if (action) return false;
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

async function reply(token, peerId, account, text, payload, groupId, photoUrls) {
    let action = menuAction(text, payload);
    if (action === 'audit' && !auditHere(groupId) && !(payload && payload.a === 'audit')) action = '';
    if (action === 'opt_cancel') {
        pendingPay.delete(String(account));
        pendingMove.delete(String(account));
        pendingJob.delete(String(account));
        await rememberDialog(account, '');
        try { await db.clearDonutSurvey(account, groupId); } catch (error) {}
        return sendText(token, peerId, 'Запрос отменён.', mainMenu(peerId, groupId));
    }
    if (action === 'pay_back') {
        try { await db.clearDonutSurvey(account, groupId); } catch (error) {}
        return goBack(token, peerId, account, groupId);
    }
    const mode = await restoreDialog(account);
    if (modeHolds(mode, action) && auditHere(groupId)) return holdDialog(token, peerId, account, text, action, groupId, mode);
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
        pendingPay.set(String(account), { stage: 'email', pkgId: pkg.id, groupId: String(groupId || '').replace(/\D/g, '') });
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
    if (await holdPayment(token, peerId, account, text, action, groupId)) return;
    if (await holdMove(token, peerId, account, text, action)) return;
    if (action === 'audit') {
        pendingJob.delete(String(account));
        pendingPay.delete(String(account));
        pendingMove.delete(String(account));
        if (!auditHere(groupId)) return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId, groupId));
        await rememberDialog(account, 'audit');
        return sendText(
            token,
            peerId,
            audit.guide(),
            payLockKeyboard()
        );
    }
    if (await holdAudit(token, peerId, account, text, action, groupId)) return;
    if (action === 'club') {
        pendingJob.delete(String(account));
        pendingPay.delete(String(account));
        pendingMove.delete(String(account));
        if (!auditHere(groupId)) return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId, groupId));
        await rememberDialog(account, 'club');
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
    const fresh = await loadPhotoBuffers(photoUrls);
    if (!text) {
        if (fresh.length) {
            const saved = stashPhotos(account, fresh);
            const line = saved.length > 1
                ? `Фото получил: ${saved.length}. Напишите, что сделать с этими кадрами.`
                : 'Фото получил. Напишите, что сделать с этим человеком или кадром.';
            await sendText(token, peerId, line);
            return;
        }
        await sendText(token, peerId, 'Напишите запрос или нажмите кнопку внизу.');
        return;
    }
    const photos = takeReferencePhotos(account, fresh);
    if (photos.length) console.log(`ВК: в запрос взято фото, ${photos.length} шт.`);
    const modelKey = (await db.getCurrentModel(account)) || catalog.defaultModelKey('vk');
    return askOrRun(token, peerId, account, { prompt: text, modelKey, quality: '', duration: 0, aspect: '', groupId: groupId || '', photos });
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
        }
    }
    throw last;
}

function wallAccessLine(groupId, code) {
    if (code !== 15 || wallAccessHint.has(String(groupId))) return '';
    wallAccessHint.add(String(groupId));
    return ' В ключе сообщества нужно право «Стена», а в настройках сообщества — комментарии от имени сообщества.';
}

async function lessonPin(groupId) {
    if (!lesson.isClub(groupId)) return null;
    try {
        const pack = await db.getSettings([lesson.pinKey(groupId)]);
        const saved = pack[lesson.pinKey(groupId)];
        if (saved && saved.postId) return saved;
    } catch (error) {}
    return null;
}

let lessonChain = Promise.resolve();

function queueLesson(job) {
    lessonChain = lessonChain.then(job, job);
}

function lessonWriters(groupToken) {
    const list = [];
    const add = value => {
        const token = String(value || '').trim();
        if (token && !list.includes(token)) list.push(token);
    };
    add(groupToken);
    const user = String(process.env.VK_AUDIT_TOKEN || '').trim();
    if (user && !user.startsWith('vk1.')) add(user);
    return list;
}

async function callLesson(tokens, method, params) {
    let last = null;
    for (const token of tokens) {
        try { return await call(token, method, params); }
        catch (error) {
            last = error;
            const code = Number(error && error.code);
            if (code !== 27 && code !== 15 && code !== 1051) throw error;
        }
    }
    throw last || new Error(method);
}

async function uploadWallPhoto(tokens, groupId, buffer) {
    let last = null;
    for (const token of tokens) {
        try {
            const server = await call(token, 'photos.getWallUploadServer', { group_id: String(groupId) });
            const uploaded = await postFile(server.upload_url, 'photo', {
                buffer,
                filename: 'lesson-cover.jpg',
                type: 'image/jpeg'
            });
            const saved = await call(token, 'photos.saveWallPhoto', {
                group_id: String(groupId),
                photo: uploaded.photo,
                server: String(uploaded.server),
                hash: uploaded.hash
            });
            const list = Array.isArray(saved) ? saved : [saved];
            const attachment = photoAttachment(list[0]);
            if (!attachment) throw new Error('vk wall photo');
            return attachment;
        } catch (error) {
            last = error;
            const code = Number(error && error.code);
            if (code !== 27 && code !== 15 && code !== 1051) throw error;
        }
    }
    throw last || new Error('vk wall photo');
}

async function readLessonPost(groupId, postId) {
    const posts = `-${String(groupId).replace(/\D/g, '')}_${postId}`;
    const tokens = lessonWriters('').concat([audit.readerToken()]).filter(Boolean);
    for (const token of tokens) {
        try {
            const pack = await call(token, 'wall.getById', { posts });
            const list = Array.isArray(pack) ? pack : ((pack && pack.items) || []);
            if (list[0]) return list[0];
        } catch (error) {}
    }
    return null;
}

function postHasPicture(post) {
    return ((post && post.attachments) || []).some(item => item && (item.type === 'photo' || item.type === 'doc'));
}

async function findLessonPost(token, groupId) {
    const owner = String(-Number(groupId));
    let wall;
    try {
        wall = await call(token, 'wall.get', { owner_id: owner, count: '15', filter: 'owner' });
    } catch (error) {
        wall = await call(token, 'wall.get', { owner_id: owner, count: '15' });
    }
    const items = (wall && wall.items) || [];
    return items.find(item => lesson.isOwnPost(item && item.text)) || null;
}

async function ensureLessonPin(token, groupId) {
    if (!lesson.isClub(groupId) || !token) return;
    const key = lesson.pinKey(groupId);
    let saved = {};
    try {
        const pack = await db.getSettings([key]);
        saved = pack[key] && typeof pack[key] === 'object' ? pack[key] : {};
    } catch (error) {
        saved = {};
    }
    const oldUrl = saved.oldUrl || lesson.postUrl(groupId, lesson.PIN_POST_ID);
    const writers = lessonWriters(token);
    let postId = saved.published ? Number(saved.postId) : 0;
    if (!postId) {
        try {
            const existing = await findLessonPost(token, groupId);
            if (existing && existing.id) postId = Number(existing.id);
        } catch (error) {}
    }
    if (!postId) {
        try {
            let attachment = '';
            try {
                attachment = await uploadWallPhoto(writers, groupId, await lesson.paintCover());
            } catch (error) {
                const code = Number(error && error.code);
                console.error(`ВК ${groupId}: обложка не загрузилась${code ? ` (${code})` : ''}. Запись выйдет без картинки.`);
            }
            const params = {
                owner_id: String(-Number(groupId)),
                from_group: '1',
                close_comments: '0',
                message: lesson.postText(oldUrl)
            };
            if (attachment) params.attachments = attachment;
            const posted = await call(token, 'wall.post', params);
            postId = Number(posted && (posted.post_id || posted.postId));
        } catch (error) {
            const code = Number(error && error.code);
            console.error(`ВК ${groupId}: новый закреп не опубликован${code ? ` (${code})` : ''}.${wallAccessLine(groupId, code)}`);
            return;
        }
    }
    if (!postId) {
        console.error(`ВК ${groupId}: новый закреп не опубликован.`);
        return;
    }
    const url = lesson.postUrl(groupId, postId);
    const view = await readLessonPost(groupId, postId);
    if (!view || !postHasPicture(view)) {
        try {
            const attachment = await uploadWallPhoto(writers, groupId, await lesson.paintCover());
            await callLesson(writers, 'wall.edit', {
                owner_id: String(-Number(groupId)),
                post_id: String(postId),
                message: String((view && view.text) || lesson.postText(oldUrl)),
                attachments: attachment
            });
            console.log(`ВК ${groupId}: обложка добавлена к записи ${url}`);
        } catch (error) {
            const code = Number(error && error.code);
            console.error(`ВК ${groupId}: обложку ключ сообщества поставить не может${code ? ` (${code})` : ''}. Откройте ${url} и добавьте картинку через «Редактировать».`);
        }
    }
    let pinned = Number(view && view.is_pinned) === 1;
    if (!pinned) {
        try {
            await callLesson(writers, 'wall.pin', { owner_id: String(-Number(groupId)), post_id: String(postId) });
            pinned = true;
        } catch (error) {
            const code = Number(error && error.code);
            console.error(`ВК ${groupId}: запись не закрепилась${code ? ` (${code})` : ''}. Откройте ${url} и нажмите «Закрепить».`);
        }
    }
    try {
        await db.setSetting(key, {
            postId,
            url,
            published: true,
            oldPostId: Number(saved.oldPostId) || lesson.PIN_POST_ID,
            oldUrl,
            oldText: saved.oldText || ''
        });
    } catch (error) {}
    const line = pinned
        ? `ВК ${groupId}: пост уроков закреплён ${url}`
        : `ВК ${groupId}: пост уроков опубликован ${url}. Закрепите его вручную.`;
    db.note('sys', line).catch(() => {});
    console.log(line);
    watchLessonPin(token, groupId);
}

async function readPostComments(token, groupId, postId) {
    const params = {
        owner_id: String(-Number(groupId)),
        post_id: String(postId),
        count: '30',
        sort: 'desc',
        thread_items_count: '10'
    };
    const tokens = [token];
    const reader = audit.readerToken();
    if (reader && reader !== token) tokens.push(reader);
    let last = null;
    for (const item of tokens) {
        try { return await call(item, 'wall.getComments', params); }
        catch (error) { last = error; }
    }
    throw last || new Error('comments');
}

async function answerFreshLessonComments(token, groupId, postId) {
    const pack = await readPostComments(token, groupId, postId);
    const items = (pack && pack.items) || [];
    const flat = [];
    items.forEach(comment => {
        flat.push(comment);
        ((comment.thread && comment.thread.items) || []).forEach(reply => flat.push(reply));
    });
    const since = Math.floor(Date.now() / 1000) - 3 * 60 * 60;
    const fresh = flat.filter(comment => {
        const fromId = Number(comment && comment.from_id);
        const text = String(comment && comment.text || '').trim();
        const replyTo = Number(comment && comment.reply_to_comment || 0);
        if (!comment.id || !text || Number(comment.date || 0) < since) return false;
        if (fromId > 0) return true;
        return fromId < 0 && !(replyTo > 0);
    }).sort((a, b) => Number(a.date) - Number(b.date)).slice(-8);
    for (const comment of fresh) {
        const replyTo = Number(comment.reply_to_comment || 0);
        await answerLessonPost(token, groupId, {
            fromId: Number(comment.from_id),
            postId: Number(comment.post_id) || Number(postId),
            commentId: Number(comment.id),
            replyTo: replyTo > 0 ? replyTo : 0,
            text: String(comment.text || '').trim()
        });
    }
}

const lessonWatch = new Set();
let lessonReadFail = 0;

function watchLessonPin(token, groupId) {
    const id = String(groupId);
    if (!lesson.isClub(id) || lessonWatch.has(id)) return;
    lessonWatch.add(id);
    const tick = async () => {
        try {
            const pin = await lessonPin(id);
            if (pin && pin.postId) await answerFreshLessonComments(token, id, pin.postId);
        } catch (error) {
            const now = Date.now();
            if (now - lessonReadFail > 5 * 60 * 1000) {
                lessonReadFail = now;
                const code = Number(error && error.code);
                console.error(`ВК ${id}: закреп не прочитался${code ? ` (${code})` : ''}.`);
            }
        }
        setTimeout(tick, 20000);
    };
    setTimeout(tick, 8000);
}

const lessonSent = [];

function rememberLessonSent(groupId, text) {
    lessonSent.push(`${groupId}\n${String(text || '').trim()}`);
    if (lessonSent.length > 40) lessonSent.shift();
}

function wasLessonSent(groupId, text) {
    return lessonSent.includes(`${groupId}\n${String(text || '').trim()}`);
}

function ownLessonReply(groupId, comment) {
    if (Number(comment && comment.fromId) >= 0) return false;
    const text = String(comment && comment.text || '');
    if (Number(comment && comment.replyTo) > 0) return true;
    if (wasLessonSent(groupId, text)) return true;
    if (/https?:\/\/vk\.(?:com|ru)\/@neuroyaga-/i.test(text)) return true;
    if (text.startsWith('Навигация по урокам') || text.startsWith('Сейчас не получилось разобрать')) return true;
    return lesson.isOwnPost(text);
}

async function sendLessonComment(token, groupId, comment, message) {
    rememberLessonSent(groupId, message);
    await commentAsCommunity(token, groupId, {
        postId: comment.postId,
        replyTo: comment.commentId,
        message,
        guid: `lreply-${groupId}-${comment.commentId}`
    });
}

async function writeLessonComment(token, groupId, comment, key) {
    const question = lesson.questionText(comment.text);
    try {
        let memory = [];
        try { memory = await db.listLessonMemory(groupId, comment.postId, comment.fromId); } catch (error) { memory = []; }
        let text = '';
        if (gigaPlugin) {
            try {
                const result = await gigaPlugin.processRequest({
                    prompt: lesson.lessonPrompt(question, memory),
                    modelKey: 'giga-pro'
                });
                text = lesson.plain(result && result.text);
            } catch (error) {
                console.error(`ВК ${groupId}: свой урок в комментарии не собрался.`);
            }
        }
        if (!text) text = lesson.fallbackText();
        await sendLessonComment(token, groupId, comment, lesson.withLessons(text));
        try {
            await db.rememberLesson(groupId, comment.postId, comment.fromId, 'user', question);
            await db.rememberLesson(groupId, comment.postId, comment.fromId, 'bot', text);
        } catch (error) {}
        await wallFinish(key);
    } catch (error) {
        const code = Number(error && error.code);
        console.error(`ВК ${groupId}: ответ на закреп уроков не отправился${code ? ` (${code})` : ''}.${wallAccessLine(groupId, code)}`);
    } finally {
        wallPending.delete(key);
    }
}

async function answerLessonPost(token, groupId, comment) {
    const key = `vk_creply_${groupId}_${comment.commentId}`;
    if (wallPending.has(key) || await wallMarked(key)) return;
    if (ownLessonReply(groupId, comment)) return;
    const question = lesson.questionText(comment.text);
    const route = question ? lesson.lessonRoute(question) : { kind: 'skip' };
    if (!question || route.kind === 'skip') {
        console.log(`ВК ${groupId}: комментарий ${comment.commentId} пропущен.`);
        await wallFinish(key);
        return;
    }
    console.log(`ВК ${groupId}: комментарий ${comment.commentId} — ответ нейросети.`);
    wallPending.add(key);
    queueLesson(() => writeLessonComment(token, groupId, comment, key));
}

async function handleCommunityWall(token, update, groupId) {
    if (!auditHere(groupId)) return;
    const post = activity.readWallPost(update, groupId);
    if (post && lesson.isOwnPost(post.text)) return;
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
    if (update && update.type === 'wall_reply_new' && !comment) {
        const reason = activity.wallCommentIssue(update, groupId) || 'неизвестный вид';
        console.log(`ВК ${groupId}: комментарий пришёл, но разобрать его не удалось (${reason}).`);
    }
    if (!comment || comment.text.startsWith('Навигация по урокам')) return;
    if (lesson.isClub(groupId)) {
        const pin = await lessonPin(groupId);
        if (pin && String(comment.postId) === String(pin.postId)) {
            console.log(`ВК ${groupId}: комментарий ${comment.commentId} пришёл в закреп.`);
            await answerLessonPost(token, groupId, comment);
            return;
        }
    }
    if (comment.fromId < 0) return;
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

function surveyHolds(action, busy) {
    const state = busy || {};
    if (state.audit || state.club || state.pay || state.move) return false;
    if (action && action !== 'survey' && action !== 'hello') return false;
    return true;
}

async function holdDonutSurvey(token, peerId, account, text, action, payload, groupId) {
    if (!auditHere(groupId)) return false;
    const key = String(account);
    if (!surveyHolds(action, {
        audit: pendingAudit.has(key),
        club: pendingClub.has(key),
        pay: pendingPay.has(key),
        move: pendingMove.has(key)
    })) return false;
    let survey = null;
    try { survey = await db.getDonutSurvey(account, groupId); } catch (error) { return false; }
    if (!survey) return false;
    const answer = donut.parseAnswer(text, payload);
    if (!answer) {
        try {
            if (survey.step === 0) await sendText(token, peerId, donut.welcomeText(), surveyKeyboard());
            await sendText(token, peerId, donut.prompt(survey.step), surveyKeyboard());
        } catch (error) {}
        return true;
    }
    pendingJob.delete(key);
    pendingAudit.delete(key);
    pendingClub.delete(key);
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
        await db.rememberCommunity(account, groupId);
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
        if (await maintenance.isOn()) {
            await sendText(token, event.peerId, maintenance.NOTICE, mainMenu(event.peerId, groupId));
            return;
        }
        return handleEvent(token, event, groupId);
    }
    const incoming = readIncoming(update);
    if (!incoming || keepsQuiet(groupId, incoming.peerId)) return;
    if (await maintenance.isOn()) {
        await sendText(token, incoming.peerId, maintenance.NOTICE, mainMenu(incoming.peerId, groupId));
        return;
    }
    const account = accountId(incoming.fromId);
    if (!account) return;
    const { isNew } = await db.ensureUser(account, `vk:${incoming.fromId}`);
    try { await db.rememberCommunity(account, groupId); } catch (error) {}
    const bonus = catalog.getGeneral().start_bonus;
    if (isNew && bonus > 0) await db.updateBalance(account, bonus, 'Приветственный бонус');
    const photos = await completePhotos(token, incoming);
    await reply(token, incoming.peerId, account, incoming.text, incoming.payload, groupId, photos);
}

async function noticeGroup(accountIdValue, groupId) {
    const explicit = String(groupId || '').replace(/\D/g, '');
    if (explicit && explicit !== '0') return explicit;
    try {
        return await db.communityOf(accountIdValue);
    } catch (e) {
        return '';
    }
}

async function sendToUser(accountIdValue, buffer, mime, caption, groupId) {
    const id = Number(accountIdValue);
    if (!Number.isInteger(id) || id >= 0 || !buffer) return false;
    const peerId = -id;
    const home = await noticeGroup(id, groupId);
    const targets = communitiesForNotice(communityList(), home);
    for (const item of targets) {
        try {
            const kind = String(mime || '');
            if (kind.startsWith('image/')) {
                await sendImage(item.token, peerId, buffer, caption || 'Файл из кабинета.');
            } else if (kind.startsWith('video/')) {
                await sendMedia(item.token, peerId, buffer, 'video', caption || 'Видео из кабинета.');
            } else if (kind.startsWith('audio/')) {
                await sendMedia(item.token, peerId, buffer, 'audio', caption || 'Аудио из кабинета.');
            } else {
                await sendText(item.token, peerId, caption || 'Файл готов в кабинете.', mainMenu(peerId, item.id));
            }
            return true;
        } catch (e) {
            console.error(`ВК ${item.id}: файл в чат не ушёл.`);
            if (home) return false;
        }
    }
    return false;
}

async function askTopup(accountIdValue, groupId) {
    const id = Number(accountIdValue);
    if (!Number.isInteger(id) || id >= 0) return null;
    const home = await noticeGroup(id, groupId);
    const targets = communitiesForNotice(communityList(), home);
    for (const item of targets) {
        try {
            await sendText(item.token, -id, 'Выберите пакет внизу. Другие кнопки скрыты. «Назад» возвращает меню.', payKeyboard());
            return chatReturnUrl(item.id);
        } catch (e) {
            console.error(`ВК ${item.id}: пополнение в чат не ушло.`);
            if (home) return null;
        }
    }
    return null;
}

async function notify(accountIdValue, message, groupId) {
    const id = Number(accountIdValue);
    if (!Number.isInteger(id) || id >= 0) return false;
    const home = await noticeGroup(id, groupId);
    const targets = communitiesForNotice(communityList(), home);
    if (home && !targets.length) {
        console.error(`ВК ${home}: уведомление не отправлено, это сообщество не подключено.`);
        return false;
    }
    for (const item of targets) {
        try {
            await sendText(item.token, -id, message, mainMenu(-id, item.id));
            return true;
        } catch (e) {
            console.error(`ВК ${item.id}: уведомление не ушло.`);
            if (home) return false;
        }
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

function adminHomes() {
    const configuredHome = String(process.env.VK_GROUP_ID || '').replace(/\D/g, '');
    const configuredClub = String(process.env.VK_GROUP_ID_2 || '').replace(/\D/g, '');
    const linesId = configuredHome && configuredHome !== '214554778' ? configuredHome : '230706467';
    let clubId = configuredClub && configuredClub !== linesId ? configuredClub : '214554778';
    if (clubId === linesId) clubId = '214554778';
    const live = new Map(communityStatus().map(item => [item.id, item]));
    const homes = [
        { id: linesId, title: 'Точки и Линии' },
        { id: clubId, title: 'НейроЯга' }
    ];
    const seen = new Set();
    return homes.filter(home => {
        if (!home.id || seen.has(home.id)) return false;
        seen.add(home.id);
        return true;
    }).map(home => {
        const state = live.get(home.id) || {};
        const clubHome = home.title === 'НейроЯга';
        return {
            id: home.id,
            title: home.title,
            name: state.name || home.title,
            online: !!state.online,
            hint: state.hint || (state.online ? '' : 'Нет связи. Проверьте ключ этого сообщества.'),
            events: state.events || '',
            audit: clubHome,
            club: clubHome
        };
    });
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
        ensureLessonPin(item.token, item.id).catch(() => {
            console.error(`ВК ${item.id}: закреп уроков не подготовлен.`);
        });
        ensureCommunityWidget(item.id).catch(() => {});
    }
}

function widgetSettingKey(groupId) {
    return `vk_widget_${String(groupId || '').replace(/\D/g, '')}`;
}

async function ensureCommunityWidget(groupId) {
    const id = String(groupId || '').replace(/\D/g, '');
    if (!id) return;
    try {
        const widget = require('./vk-widget');
        const saved = await db.getSettings([widgetSettingKey(id)]);
        const packed = saved[widgetSettingKey(id)];
        const token = packed && typeof packed === 'object' ? String(packed.token || '') : '';
        if (token.length < 20) {
            console.log(`ВК ${id}: кнопки страницы ставит разрешение из приложения. Откройте приложение на компьютере: «Настройки» → «Поставить на страницу».`);
            return;
        }
        const ids = {};
        for (const name of ['chat', 'rate', 'site']) {
            ids[name] = await widget.uploadCover(token, await widget.defaultCover(name));
        }
        await widget.publishCover(token, widget.coverWidgetCode(id, ids));
        console.log(`ВК ${id}: кнопки сообщества обновлены.`);
    } catch (error) {
        const code = Number(error && error.vkCode);
        if (code === 15 || code === 27 || code === 28) {
            await db.setSetting(widgetSettingKey(id), { token: '' }).catch(() => {});
        }
        const mark = code ? ` Код ${code}.` : '';
        console.error(`ВК ${id}: кнопки сообщества не обновлены.${mark} ${error && error.message ? error.message : ''}`.trim());
    }
}

module.exports = {
    accountId, readIncoming, readEvent, isGreeting, menuAction, mainMenu, cabinetLink, appCabinetUrl, payKeyboard, payLockKeyboard, payLinkKeyboard, emailOk, createPayment, sectionKeyboard, modelKeyboard, nextChoice, modelNeedsChoice, connectHint, keepsQuiet, startVk, notify, sendToUser, askTopup, setTelegramNotify, attachFaces, fileForVk, mediaFile, messagePhoto, uploadPhotoField, samePicture, photoAttachment, communityList, communityId, communityStatus, adminHomes, communityDonut, communityCommentAttempts, communitiesForNotice, surveyHolds, modeHolds, spareKeyboard, keepPhotos
};
