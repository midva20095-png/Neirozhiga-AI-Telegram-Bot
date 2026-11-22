const db = require('./db');
const { cleanProducts, cleanServices, tradeById } = require('../public/trades');

const JOIN_URL = 'https://vk.com/donut/club214554778';
const HOLD_MS = 10 * 24 * 60 * 60 * 1000;
const DEMO_OWNER = 770770770;

function vkId(account) {
    const id = Number(account);
    if (!Number.isInteger(id) || id === 0) return 0;
    const positive = id < 0 ? -id : id;
    if (positive <= 0 || positive > Number.MAX_SAFE_INTEGER) return 0;
    return positive;
}

function accessChange(kind) {
    if (kind === 'create' || kind === 'prolong') return true;
    if (kind === 'expire') return false;
    return null;
}

function maskToken(token) {
    const value = String(token || '').trim();
    if (value.length < 8) return '';
    return `···${value.slice(-4)}`;
}

const REPLY_FIELDS = [
    ['about', 2500],
    ['guide', 2500],
    ['contacts', 1500],
    ['address', 1500],
    ['order', 2500],
    ['choices', 1500],
    ['payment', 1500],
    ['booking', 2500],
    ['pickup', 1500],
    ['delivery', 1500],
    ['deliveryPrice', 400]
];

function emptyReply() {
    const reply = { greeting: '', buttons: [], pickupMap: '' };
    REPLY_FIELDS.forEach(item => {
        reply[item[0]] = '';
    });
    return reply;
}

function cleanReply(input) {
    if (input == null) return emptyReply();
    if (typeof input !== 'object' || Array.isArray(input)) return null;
    if (input.greeting != null && typeof input.greeting !== 'string') return null;
    if (input.buttons != null && !Array.isArray(input.buttons)) return null;
    const greeting = cleanBody(input.greeting, 2500, true);
    const fields = {};
    for (let i = 0; i < REPLY_FIELDS.length; i += 1) {
        const name = REPLY_FIELDS[i][0];
        const value = cleanBody(input[name], REPLY_FIELDS[i][1], true);
        if (value === null) return null;
        fields[name] = value;
    }
    if (greeting === null) return null;
    const source = Array.isArray(input.buttons) ? input.buttons : [];
    if (source.length > 10) return null;
    const buttons = [];
    const seen = new Set();
    for (const item of source) {
        const button = cleanButton(item);
        if (!button || seen.has(button.label)) return null;
        seen.add(button.label);
        buttons.push(button);
    }
    const rawMap = input.pickupMap == null ? '' : input.pickupMap;
    if (typeof rawMap !== 'string') return null;
    const pickupMap = yandexMapLink(rawMap);
    if (rawMap.trim() && !pickupMap) return null;
    const picked = tradeById(input.trade);
    const goodsOn = input.goodsOn == null ? picked.goodsOn : !(input.goodsOn === false || input.goodsOn === 'false');
    const bookingOn = input.scenario === 'info'
        ? false
        : (input.bookingOn == null ? picked.bookingOn : !(input.bookingOn === false || input.bookingOn === 'false'));
    const linkOn = input.linkOn == null
        ? (input.goodsOn == null ? picked.linkOn : goodsOn)
        : !(input.linkOn === false || input.linkOn === 'false');
    const orderOn = input.orderOn == null ? picked.orderOn : !(input.orderOn === false || input.orderOn === 'false');
    return Object.assign({
        greeting: greeting,
        buttons: buttons,
        schedule: cleanSchedule(input.schedule),
        scenario: input.scenario === 'info' ? 'info' : 'funnel',
        handoff: !(input.handoff === false || input.handoff === 'false'),
        pickupOn: input.pickupOn === true || input.pickupOn === 'true',
        deliveryOn: input.deliveryOn === true || input.deliveryOn === 'true',
        goodsOn: goodsOn,
        bookingOn: bookingOn,
        linkOn: linkOn,
        orderOn: orderOn,
        trade: picked.id,
        services: cleanServices(input.services, picked.id),
        products: cleanProducts(input.products),
        pickupMap: pickupMap,
        desk: input.desk === 'simple' || input.desk === 'full' ? input.desk : ''
    }, fields);
}

function yandexMapLink(value) {
    const link = String(value || '').trim();
    if (!link || link.length > 300 || /\s/.test(link)) return '';
    let url;
    try {
        url = new URL(link);
    } catch (error) {
        return '';
    }
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    const yandex = host === 'yandex.ru' || host === 'yandex.com' || host.endsWith('.yandex.ru') || host.endsWith('.yandex.com');
    if (!yandex) return '';
    if (host !== 'maps.yandex.ru' && !/^\/(maps|map-widget|navi)(\/|$)/.test(url.pathname)) return '';
    return url.toString();
}

function cleanSchedule(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const rawDays = Array.isArray(source.days) ? source.days : [1, 2, 3, 4, 5];
    const days = rawDays.map(Number).filter((day, index, list) => day >= 1 && day <= 7 && list.indexOf(day) === index).sort((a, b) => a - b);
    let start = clockHour(source.start, 10);
    let end = clockHour(source.end, 19);
    if (end <= start) end = Math.min(23, start + 1);
    const slot = Number(source.slot) === 30 ? 30 : 60;
    const horizon = [3, 7, 14].indexOf(Number(source.horizon)) >= 0 ? Number(source.horizon) : 7;
    const rawPlaces = Array.isArray(source.places) ? source.places : String(source.places || '').split(',');
    const places = rawPlaces.map(item => String(item || '').replace(/\s+/g, ' ').trim()).filter(item => item && item.length <= 40).slice(0, 4);
    return {
        days: days.length ? days : [1, 2, 3, 4, 5],
        start: start,
        end: end,
        slot: slot,
        horizon: horizon,
        seats: seatsOf(source.seats),
        places: places.length ? places : ['На месте']
    };
}

function seatsOf(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) return 0;
    return Math.min(number, 40);
}

function clockHour(value, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 23) return fallback;
    return number;
}

var NESTED_RESERVED = new Set(['Назад', 'Отменить запись', 'К помощнику', 'Подтвердить', 'Отмена']);

function cleanButton(item, depth) {
    const level = depth || 0;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const label = String(item.label || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 40) return null;
    if (level && NESTED_RESERVED.has(label)) return null;
    if (!level && (item.goods === true || item.goods === 'true')) return stampButton(item, { label: label, goods: true });
    if (!level && item.action === 'contact') return stampButton(item, { label: label, action: 'contact' });
    if (!level && item.action === 'human') return stampButton(item, { label: label, action: 'human' });
    if (!level && item.action === 'book') return stampButton(item, { label: label, action: 'book', text: cleanBody(item.text, 900, true) || 'Открыть свободные дни' });
    const rawItems = Array.isArray(item.items) ? item.items : [];
    if (rawItems.length && level < 2) {
        if (rawItems.length > 8) return null;
        const items = [];
        const seen = new Set();
        for (let i = 0; i < rawItems.length; i += 1) {
            const next = cleanButton(rawItems[i], level + 1);
            if (!next || next.goods) return null;
            if (seen.has(next.label)) return null;
            seen.add(next.label);
            items.push(next);
        }
        if (items.length) return stampButton(item, { label: label, items: items });
    }
    const hasLink = item.link != null && item.link !== '';
    const hasText = item.text != null && item.text !== '';
    if (hasLink === hasText) return null;
    if (hasLink) {
        const link = httpsLink(item.link);
        if (!link) return null;
        return stampButton(item, { label: label, link: link });
    }
    const text = cleanBody(item.text, 900, false);
    if (!text) return null;
    return stampButton(item, { label: label, text: text });
}

function stampButton(item, button) {
    if (!button) return null;
    if (item.hidden === true || item.hidden === 'true') button.hidden = true;
    if (item.color === 'primary' || item.color === 'secondary' || item.color === 'positive' || item.color === 'negative') button.color = item.color;
    return button;
}

function cleanBody(value, limit, allowEmpty) {
    if (value == null || value === '') return allowEmpty ? '' : null;
    if (typeof value !== 'string') return null;
    const text = value.replace(/\r\n/g, '\n').trim();
    if (!text) return allowEmpty ? '' : null;
    if (text.length > limit) return null;
    return text;
}

function httpsLink(value) {
    if (typeof value !== 'string') return '';
    const link = value.trim();
    if (!link || link.length > 300 || /\s/.test(link)) return '';
    let url;
    try {
        url = new URL(link);
    } catch (error) {
        return '';
    }
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return link;
}

function publicSyncError(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/второй бот|секрет|адрес второго/i.test(text)) return 'Ключ сообщества сохранён. Помощник его ещё не принял.';
    return text.slice(0, 180);
}

function publicError(message) {
    const error = new Error(message);
    error.public = true;
    return error;
}

const DEFAULT_ASSISTANT_URL = 'https://vkdonutassistantbot-production.up.railway.app';

function assistantUrl(value) {
    let url = String(value || '').trim().replace(/^['"]+|['"]+$/g, '').replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!/^https:\/\/\S+$/i.test(url)) return '';
    return url;
}

function assistantConfig(env) {
    const source = env || process.env;
    const secret = String(source.ASSISTANT_SECRET || '').trim();
    return {
        url: assistantUrl(source.ASSISTANT_URL) || (env ? '' : DEFAULT_ASSISTANT_URL),
        secret
    };
}

function planLive(rows, donors) {
    const live = new Map();
    (Array.isArray(donors) ? donors : []).forEach(item => {
        const id = vkId(item && item.id);
        if (id) live.set(id, String((item && item.name) || '').trim());
    });
    const on = [];
    live.forEach((name, id) => on.push({ id, name }));
    const off = [];
    (Array.isArray(rows) ? rows : []).forEach(row => {
        const id = vkId(row && row.user_id);
        if (row && row.active && id && id !== DEMO_OWNER && !live.has(id)) off.push(id);
    });
    return { on, off };
}

async function postAssistant(path, body, fetchImpl, env, timeoutMs) {
    const cfg = assistantConfig(env);
    if (!cfg.url || !cfg.secret) return { ok: false, error: 'Второй бот ещё не подключён: нет адреса или секрета.' };
    const send = fetchImpl || fetch;
    let response;
    try {
        response = await send(`${cfg.url}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Donut-Secret': cfg.secret
            },
            body: JSON.stringify(body),
            signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
        });
    } catch (error) {
        return { ok: false, error: 'Второй бот не ответил.' };
    }
    if (!response || !response.ok) return { ok: false, error: 'Второй бот не принял команду.' };
    let data = {};
    if (typeof response.json === 'function') {
        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    return Object.assign({ ok: true, error: '' }, data, { ok: true, error: '' });
}

async function readHealth(fetchImpl, env) {
    const cfg = assistantConfig(env);
    if (!cfg.url) return { configured: false, online: false, error: 'Адрес второго бота не задан.' };
    if (!cfg.secret) return { configured: false, online: false, error: 'Секрет второго бота не задан.' };
    try {
        const response = await (fetchImpl || fetch)(`${cfg.url}/health`);
        if (!response || !response.ok) return { configured: true, online: false, error: 'Второй бот ответил ошибкой.' };
        return { configured: true, online: true, error: '' };
    } catch (error) {
        return { configured: true, online: false, error: 'Второй бот не ответил.' };
    }
}

function communityCard(row) {
    if (!row) return null;
    return {
        groupId: String(row.group_id),
        title: row.title || '',
        key: maskToken(row.token),
        sync: row.sync_state || '',
        error: publicSyncError(row.sync_error),
        reply: cleanReply(row.reply) || { greeting: '', buttons: [] }
    };
}

async function cabinet(account) {
    const userId = vkId(account);
    if (!userId) return { don: false, active: false, join: JOIN_URL, community: null };
    const row = await db.getAssistantDon(userId);
    if (!row) return { don: false, active: false, join: JOIN_URL, community: null };
    const communities = await db.listAssistantCommunities(userId);
    return {
        don: true,
        active: !!row.active,
        join: JOIN_URL,
        name: row.name || '',
        community: communityCard(communities[0]),
        setup: await loadSetup(userId)
    };
}

function replayPlan(dons, communities) {
    const calls = [];
    (Array.isArray(dons) ? dons : []).forEach(don => {
        const id = vkId(don && don.user_id);
        if (!id) return;
        calls.push({ path: '/access', body: { userId: id, active: !!(don && don.active) } });
        if (!don.active) return;
        (Array.isArray(communities) ? communities : []).forEach(item => {
            if (!item || Number(item.owner_id) !== id || !String(item.token || '').trim()) return;
            const reply = cleanReply(item.reply) || { greeting: '', about: '', guide: '', buttons: [] };
            calls.push({
                path: '/community',
                body: {
                    userId: id,
                    groupId: Number(item.group_id),
                    token: item.token,
                    title: item.title || `Сообщество ${item.group_id}`,
                    reply
                }
            });
        });
    });
    return calls;
}

async function replayKnown(fetchImpl) {
    const cfg = assistantConfig();
    if (!cfg.url || !cfg.secret) return { ok: false, sent: 0 };
    await sweepCommunities(fetchImpl);
    const dons = await db.listAssistantDons();
    const communities = await db.listAssistantCommunities();
    const calls = replayPlan(dons, communities);
    let sent = 0;
    for (const call of calls) {
        const result = await postAssistant(call.path, call.body, fetchImpl);
        if (!result.ok) continue;
        sent += 1;
        if (call.path === '/community') {
            await db.markAssistantCommunity(call.body.groupId, 'on', '');
        }
    }
    return { ok: true, sent };
}

async function tellAccess(userId, active, fetchImpl) {
    return postAssistant('/access', { userId: Number(userId), active: !!active }, fetchImpl);
}

async function tellCommunity(row, fetchImpl) {
    const reply = cleanReply(row.reply) || { greeting: '', buttons: [] };
    return postAssistant('/community', {
        userId: Number(row.owner_id),
        groupId: Number(row.group_id),
        token: row.token,
        title: row.title || '',
        reply
    }, fetchImpl);
}

async function applyEvent(kind, userId, name, fetchImpl) {
    const active = accessChange(kind);
    const id = vkId(userId);
    if (active === null || !id) return { changed: false };
    await db.upsertAssistantDon(id, name || '', active);
    const sent = await tellAccess(id, active, fetchImpl);
    const communities = await db.listAssistantCommunities(id);
    if (active) {
        await db.clearAssistantPurge(id);
        for (const item of communities) {
            const pushed = item.token ? await tellCommunity(item, fetchImpl) : sent;
            await db.markAssistantCommunity(item.group_id, pushed.ok ? 'on' : 'fail', pushed.error || '');
        }
    } else if (communities.length) {
        await db.scheduleAssistantPurge(id, new Date(Date.now() + HOLD_MS));
        await db.markAssistantOwner(id, sent.ok ? 'off' : 'fail', sent.error || '');
    }
    return { changed: true, active, sent };
}

async function registerLive(donors, fetchImpl) {
    const rows = await db.listAssistantDons();
    const plan = planLive(rows, donors);
    for (const item of plan.on) {
        await applyEvent('prolong', item.id, item.name, fetchImpl);
    }
    for (const id of plan.off) {
        const row = rows.find(item => vkId(item.user_id) === id);
        await applyEvent('expire', id, row && row.name, fetchImpl);
    }
    return { on: plan.on.length, off: plan.off.length };
}

async function connectCommunity(account, groupId, token, title, fetchImpl) {
    const ownerId = vkId(account);
    const communityId = String(groupId || '').replace(/\D/g, '');
    const key = String(token || '').replace(/\s+/g, '');
    if (!ownerId) {
        const error = new Error('Раздел открыт из ВК.');
        error.public = true;
        throw error;
    }
    const don = await db.getAssistantDon(ownerId);
    if (!don || !don.active) {
        const error = new Error('Подключить сообщество может дон НейроЯги с живой подпиской.');
        error.public = true;
        throw error;
    }
    if (!communityId || key.length < 20 || key.length > 2000) {
        const error = new Error('Нужен номер сообщества и ключ из его настроек.');
        error.public = true;
        throw error;
    }
    const previous = await db.listAssistantCommunities(ownerId);
    const kept = previous.find(item => String(item.group_id) === communityId);
    const reply = cleanReply(kept && kept.reply) || { greeting: '', buttons: [] };
    for (const old of previous) {
        if (String(old.group_id) === communityId) continue;
        await postAssistant('/community/remove', { userId: ownerId, groupId: Number(old.group_id) }, fetchImpl);
        await db.deleteAssistantCommunity(old.group_id);
    }
    const pushed = await postAssistant('/community', {
        userId: ownerId,
        groupId: Number(communityId),
        token: key,
        title: title || '',
        reply
    }, fetchImpl);
    const access = await tellAccess(ownerId, true, fetchImpl);
    const syncError = [pushed.error, access.error].filter(Boolean).join(' ');
    const saved = await db.saveAssistantCommunity({
        groupId: communityId,
        ownerId,
        title,
        token: key,
        syncState: pushed.ok && access.ok ? 'on' : (pushed.ok || access.ok ? 'fail' : 'wait'),
        syncError
    });
    return { ok: true, community: communityCard(Object.assign({}, saved, { sync_state: saved && saved.sync_state, sync_error: saved && saved.sync_error })) };
}

async function saveDesk(account, input, fetchImpl) {
    const ownerId = vkId(account);
    if (!ownerId) throw publicError('Раздел открыт из ВК.');
    const don = await db.getAssistantDon(ownerId);
    if (!don || !don.active) throw publicError('Настроить ответы может дон НейроЯги с живой подпиской.');
    if (String(input && input.pickupMap || '').trim() && !yandexMapLink(input.pickupMap)) {
        throw publicError('Для самовывоза нужна ссылка Яндекс Карт, например https://yandex.ru/maps/.');
    }
    const reply = cleanReply(input);
    if (!reply) throw publicError('У кнопки нужна надпись до 24 знаков и действие: текст, ссылка или кнопки внутри. Своих кнопок не больше восьми, «Записаться» остаётся сама.');
    const rows = await db.listAssistantCommunities(ownerId);
    const row = rows[0];
    if (!row) throw publicError('Сначала подключите сообщество.');
    const pushed = await postAssistant('/community/reply', {
        userId: ownerId,
        groupId: Number(row.group_id),
        greeting: reply.greeting,
        about: reply.about,
        guide: reply.guide,
        contacts: reply.contacts,
        address: reply.address,
        order: reply.order,
        choices: reply.choices,
        payment: reply.payment,
        booking: reply.booking,
        pickup: reply.pickup,
        pickupMap: reply.pickupMap,
        delivery: reply.delivery,
        deliveryPrice: reply.deliveryPrice,
        pickupOn: reply.pickupOn,
        deliveryOn: reply.deliveryOn,
        goodsOn: reply.goodsOn,
        bookingOn: reply.bookingOn,
        linkOn: reply.linkOn,
        orderOn: reply.orderOn,
        trade: reply.trade,
        services: reply.services,
        products: reply.products,
        handoff: reply.handoff,
        buttons: reply.buttons,
        schedule: reply.schedule,
        scenario: reply.scenario,
        desk: reply.desk
    }, fetchImpl);
    const saved = await db.saveAssistantReply(row.group_id, ownerId, reply);
    await db.markAssistantCommunity(row.group_id, pushed.ok ? 'on' : 'fail', pushed.ok ? '' : 'Ответы сохранены и ждут передачи.');
    return {
        ok: true,
        reply,
        pending: !pushed.ok,
        community: communityCard(Object.assign({}, saved || row, { reply, sync_state: pushed.ok ? 'on' : 'fail' }))
    };
}

async function disconnectCommunity(account, groupId, fetchImpl) {
    const ownerId = vkId(account);
    const communityId = String(groupId || '').replace(/\D/g, '');
    const rows = await db.listAssistantCommunities(ownerId);
    const row = rows.find(item => String(item.group_id) === communityId);
    if (!row) return { ok: false, error: 'Это сообщество не подключено.' };
    await postAssistant('/community/remove', { userId: ownerId, groupId: Number(communityId) }, fetchImpl);
    await db.deleteAssistantCommunity(communityId);
    return { ok: true };
}

async function sweepCommunities(fetchImpl) {
    let due = [];
    try {
        due = await db.listDueAssistantCommunities(new Date());
    } catch {
        return;
    }
    for (const row of due) {
        const ownerId = Number(row.owner_id);
        const don = await db.getAssistantDon(ownerId);
        if (don && don.active) {
            await db.clearAssistantPurgeGroup(row.group_id);
            continue;
        }
        try {
            await postAssistant('/community/purge', {
                userId: ownerId,
                groupId: Number(row.group_id)
            }, fetchImpl);
        } catch {
            // Помощник сотрёт ту же базу своим таймером.
        }
        await db.deleteAssistantCommunity(row.group_id);
    }
}

async function wipeCommunity(groupId, fetchImpl) {
    const rows = await db.listAssistantCommunities();
    const row = rows.find(item => String(item.group_id) === String(groupId || '').replace(/\D/g, ''));
    if (!row) return { ok: false, error: 'Сообщество не найдено.' };
    await postAssistant('/community/purge', {
        userId: Number(row.owner_id),
        groupId: Number(row.group_id)
    }, fetchImpl);
    await db.deleteAssistantCommunity(row.group_id);
    return { ok: true };
}

async function adminDrop(groupId, fetchImpl) {
    const rows = await db.listAssistantCommunities();
    const row = rows.find(item => String(item.group_id) === String(groupId || '').replace(/\D/g, ''));
    if (!row) return { ok: false, error: 'Сообщество не найдено.' };
    return disconnectCommunity(row.owner_id, row.group_id, fetchImpl);
}

function setupNote(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function setupPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return `+7${digits.slice(1)}`;
    if (digits.length === 10) return `+7${digits}`;
    return '';
}

function setupCard(input) {
    const source = input && typeof input === 'object' ? input : { task: input };
    const task = setupNote(source.task || source.note);
    if (task.length < 8) throw publicError('Напишите, что именно настроить.');
    const phone = setupPhone(source.phone);
    if (!phone) throw publicError('Напишите телефон, по которому с вами связаться.');
    const address = String(source.address || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (address.length < 4) throw publicError('Напишите адрес.');
    const map = yandexMapLink(source.map || source.pickupMap);
    if (!map) throw publicError('Вставьте ссылку на метку в Яндекс Картах.');
    return { task, phone, address, map, note: task };
}

function setupLine(value) {
    const text = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!text || text.length > 500) return '';
    return text;
}

function publicSetup(row, notes) {
    if (!row) return null;
    const messages = (Array.isArray(notes) ? notes : []).slice(-40).map(item => ({
        role: item && item.role === 'dev' ? 'dev' : 'don',
        text: setupLine(item && item.body) || setupNote(item && item.body),
        at: item && item.created_at || null
    })).filter(item => item.text);
    return {
        open: row.status !== 'done',
        task: setupNote(row.task || row.note),
        phone: setupPhone(row.phone) || String(row.phone || '').replace(/[^\d+]/g, '').slice(0, 16),
        address: String(row.address || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        map: yandexMapLink(row.map),
        messages
    };
}

async function loadSetup(userId) {
    const row = await db.getAssistantSetup(userId);
    if (!row) return null;
    const notes = await db.listAssistantSetupNotes(userId);
    return publicSetup(row, notes);
}

async function askSetup(account, input) {
    const ownerId = vkId(account);
    if (!ownerId) throw publicError('Раздел открыт из ВК.');
    const don = await db.getAssistantDon(ownerId);
    if (!don || !don.active) throw publicError('Попросить настройку может дон с живой подпиской.');
    const card = setupCard(input);
    await db.saveAssistantSetup(ownerId, card);
    await db.addAssistantSetupNote(ownerId, 'don', card.task);
    return { ok: true, userId: ownerId, name: don.name || '', note: card.task, phone: card.phone, address: card.address, map: card.map };
}

async function addSetupTalk(account, text, role) {
    const ownerId = vkId(account);
    if (!ownerId) throw publicError('Раздел открыт из ВК.');
    const line = setupLine(text);
    if (!line) throw publicError('Напишите сообщение, до 500 знаков.');
    const row = await db.getAssistantSetup(ownerId);
    if (!row || row.status === 'done') throw publicError('Сначала отправьте заявку. Ответ придёт в это же окно.');
    if (role !== 'dev') {
        const don = await db.getAssistantDon(ownerId);
        if (!don || !don.active) throw publicError('Написать может дон с живой подпиской.');
    }
    await db.addAssistantSetupNote(ownerId, role === 'dev' ? 'dev' : 'don', line);
    const don = role === 'dev' ? null : await db.getAssistantDon(ownerId);
    return { ok: true, userId: ownerId, name: don && don.name || '', text: line };
}

async function setupAlert() {
    return { open: await db.countOpenAssistantSetups() };
}

async function finishSetup(account) {
    const ownerId = vkId(account);
    if (!ownerId) return { ok: false };
    await db.closeAssistantSetup(ownerId);
    return { ok: true };
}

function deskLabel(reply) {
    const clean = cleanReply(reply) || { greeting: '', buttons: [] };
    const phrase = clean.greeting ? clean.greeting.replace(/\s+/g, ' ').slice(0, 80) : 'фраза по умолчанию';
    const labels = clean.buttons.map(item => item.label).join(', ');
    return `${phrase} · ${labels ? `кнопки: ${labels}` : 'кнопок нет'}`;
}

function syncLabel(state) {
    if (state === 'on') return 'второй бот включён';
    if (state === 'off') return 'выключен вместе с донатом';
    if (state === 'fail') return 'второй бот не принял';
    if (state === 'wait') return 'ждёт адрес второго бота';
    return 'ещё не передавалось';
}

function publicPeople(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 100).map(item => ({
        peerId: Number(item && (item.peerId || item.peer_id)) || 0,
        name: String(item && item.name || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        phone: String(item && item.phone || '').replace(/[^\d+]/g, '').slice(0, 16),
        note: String(item && item.note || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        seen: Math.max(0, Number(item && item.seen) || 0)
    })).filter(item => item.peerId > 0);
}

async function pushSaved(account, fetchImpl) {
    const userId = vkId(account);
    if (!userId) return { ok: false };
    const don = await db.getAssistantDon(userId);
    if (!don || !don.active) return { ok: false };
    const rows = await db.listAssistantCommunities(userId);
    const row = rows[0];
    if (!row || !String(row.token || '').trim()) return { ok: false };
    const access = await tellAccess(userId, true, fetchImpl);
    const pushed = await tellCommunity(row, fetchImpl);
    const ok = !!(pushed.ok && access.ok);
    await db.markAssistantCommunity(
        row.group_id,
        ok ? 'on' : 'fail',
        ok ? '' : 'Ключ сохранён. Помощник его ещё не принял.'
    );
    return { ok };
}

async function loadListen(account, fetchImpl) {
    const userId = vkId(account);
    const rows = userId ? await db.listAssistantCommunities(userId) : [];
    const row = rows[0];
    if (!row) return '';
    const result = await postAssistant('/listen', {
        userId,
        groupId: Number(row.group_id)
    }, fetchImpl, null, 20000);
    if (!result.ok) return '';
    return String(result.problem || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function publicOrders(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 80).map(item => ({
        peerId: Number(item && item.peerId) || 0,
        item: cleanBit(item && item.item, 320),
        phone: cleanBit(item && item.phone, 16),
        way: cleanBit(item && item.way, 40)
    })).filter(item => item.peerId > 0 && item.item);
}

function publicBookings(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 400).map(item => ({
        peerId: Number(item && item.peerId) || 0,
        day: String(item && item.day || '').slice(0, 10),
        when: bookingWhen(item && item.day),
        slot: String(item && item.slot || '').slice(0, 8),
        place: cleanBit(item && item.place, 40),
        way: cleanBit(item && item.way, 40),
        address: cleanBit(item && item.address, 200),
        phone: cleanBit(item && item.phone, 16),
        map: yandexMapLink(item && item.map),
        product: httpsLink(item && item.product),
        service: cleanBit(item && item.service, 40),
        bill: cleanBit(item && item.bill, 300)
    })).filter(item => item.peerId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.day));
}

function bookingWhen(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return `${names[date.getUTCDay()]} ${Number(match[3])}.${match[2]}`;
}

function cleanBit(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

async function loadOrders(account, fetchImpl) {
    const userId = vkId(account);
    const rows = userId ? await db.listAssistantCommunities(userId) : [];
    const row = rows[0];
    if (!row) return { rows: [] };
    const result = await postAssistant('/orders', { userId, groupId: Number(row.group_id) }, fetchImpl);
    if (!result.ok) return { rows: [], pending: true };
    return { rows: publicOrders(result.orders) };
}

async function loadBookings(account, fetchImpl) {
    const userId = vkId(account);
    const rows = userId ? await db.listAssistantCommunities(userId) : [];
    const row = rows[0];
    if (!row) return { rows: [] };
    const result = await postAssistant('/bookings', { userId, groupId: Number(row.group_id) }, fetchImpl);
    if (!result.ok) return { rows: [], pending: true };
    return { rows: publicBookings(result.bookings) };
}

async function loadClients(account, fetchImpl) {
    const userId = vkId(account);
    const rows = userId ? await db.listAssistantCommunities(userId) : [];
    const row = rows[0];
    if (!row) return { total: 0, people: [] };
    const result = await postAssistant('/clients', { userId, groupId: Number(row.group_id) }, fetchImpl);
    if (!result.ok) return { total: 0, people: [], pending: true };
    const people = publicPeople(result.clients);
    return { total: Number(result.total) || people.length, people };
}

async function sendBroadcast(account, text, offset, fetchImpl) {
    const ownerId = vkId(account);
    if (!ownerId) throw publicError('Раздел открыт из ВК.');
    const don = await db.getAssistantDon(ownerId);
    if (!don || !don.active) throw publicError('Рассылку может отправить дон НейроЯги с живой подпиской.');
    const body = cleanBody(text, 900, false);
    if (!body) throw publicError('Напишите текст рассылки, до 900 знаков.');
    const rows = await db.listAssistantCommunities(ownerId);
    const row = rows[0];
    if (!row) throw publicError('Сначала подключите сообщество.');
    const start = Number.isInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    const result = await postAssistant('/broadcast', {
        userId: ownerId,
        groupId: Number(row.group_id),
        text: body,
        offset: start
    }, fetchImpl, null, 40000);
    if (!result.ok) throw publicError('Помощник не отправил рассылку. Попробуйте ещё раз.');
    return {
        ok: true,
        sent: Number(result.sent) || 0,
        failed: Number(result.failed) || 0,
        total: Number(result.total) || 0,
        next: Number(result.next) || 0
    };
}

async function setupRequests(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const notes = await db.listAssistantSetupNotes(list.map(row => row.user_id));
    return list.map(row => {
        const own = notes.filter(item => Number(item.user_id) === Number(row.user_id));
        const card = publicSetup(row, own) || { task: '', phone: '', address: '', map: '', messages: [] };
        return {
            userId: Number(row.user_id),
            note: setupNote(row.note || card.task),
            task: card.task,
            phone: card.phone,
            address: card.address,
            map: card.map,
            messages: card.messages,
            status: row.status || 'open',
            updatedAt: row.updated_at
        };
    });
}

function demoReply(groupId) {
    const id = String(groupId || '').replace(/\D/g, '');
    const page = id ? `https://vk.com/club${id}` : 'https://vk.com/club214554778';
    const market = id ? `https://vk.com/market-${id}` : 'https://vk.com/market-214554778';
    const reviews = id ? `https://vk.com/reviews-${id}` : 'https://vk.com/reviews-214554778';
    const pin = 'https://yandex.ru/maps/213/moscow/?ll=37.736200,55.676400&z=17&pt=37.736200,55.676400';
    return cleanReply({
        scenario: 'funnel',
        trade: 'tire',
        handoff: true,
        bookingOn: true,
        orderOn: true,
        goodsOn: false,
        linkOn: false,
        pickupOn: true,
        deliveryOn: true,
        desk: 'full',
        greeting: 'Здравствуйте, это шиномонтаж ИП Соколова. Напишите, что с колесом, или выберите кнопку.',
        about: 'ИП Соколов Артём Сергеевич. Шиномонтаж легковых и внедорожников, ремонт прокола, балансировка и сезонное хранение. Бокс на Люблинской, выезд по ЮВАО.',
        guide: 'Цены только из карточки. Скидку не обещать. Запись вести кнопкой, диаметр спрашивать из вариантов.',
        contacts: 'Телефон +7 926 415-30-18. Сообщения сообщества отвечают в рабочее время.',
        address: 'Москва, Люблинская улица, 161, бокс 3. Вход со двора, синяя вывеска.',
        order: 'Напишите диаметр и сколько колёс. Оставьте телефон, перезвоним и подтвердим время.',
        choices: 'Диаметр: R15, R16, R17, R18',
        payment: 'Оплата в боксе после работы: наличные или перевод на карту по номеру телефона. Предоплата не нужна. Чек отправим, если попросите. Выезд мастер принимает на месте отдельно от работы. Доставку по ЮВАО считаем 400 рублей, за МКАД от 700 рублей и называем сумму до выезда.',
        booking: 'Приезжайте за 10 минут. Если опоздание больше 15 минут, слот можем отдать следующему.',
        pickup: 'Бокс 3, Люблинская улица, 161. Выдача с 9:00 до 19:00, суббота до 17:00.',
        pickupMap: pin,
        delivery: 'По Юго-Восточному округу в день обращения. За МКАД по договорённости.',
        deliveryPrice: '400 рублей по ЮВАО, за МКАД от 700 рублей.',
        services: [
            { name: 'Шиномонтаж легкового', price: 400, link: page, text: 'Снятие, установка и балансировка одного колеса R15-R16.' },
            { name: 'Шиномонтаж внедорожника', price: 600, link: page, text: 'Одно колесо R17-R20, включая балансировку.' },
            { name: 'Ремонт прокола', price: 500, link: page, text: 'Жгут или грибок, колесо проверяем в воде.' },
            { name: 'Балансировка', price: 300, extra: true, link: page, text: 'Доп к шиномонтажу, если диск снимали отдельно.' },
            { name: 'Сезонная переобувка 4 колес', price: 2200, link: page, text: 'Четыре колеса, балансировка входит. Хранение отдельно.' },
            { name: 'Сезонное хранение', price: 3500, link: market, text: 'Комплект из четырёх колёс до следующего сезона.' }
        ],
        products: [
            { name: 'Колпачки на ниппель', price: 200, section: 'Расходники', link: market, text: 'Комплект из четырёх колпачков, пластик.' },
            { name: 'Вентиль', price: 150, section: 'Расходники', link: market, text: 'Резиновый вентиль под легковой диск.' },
            { name: 'Грузик', price: 50, section: 'Расходники', link: market, text: 'Один грузик для балансировки, ставится в боксе.' },
            { name: 'Чехол для колеса', price: 400, section: 'Хранение', link: market, text: 'Пакет на одно колесо, чтобы не пачкал багажник.' },
            { name: 'Пакет хранения', price: 3500, section: 'Хранение', link: market, text: 'Четыре колеса на складе бокса до следующего сезона.' },
            { name: 'Сумка для дисков', price: 900, section: 'Хранение', link: market, text: 'Сумка на комплект, забираете сами.' }
        ],
        schedule: {
            days: [1, 2, 3, 4, 5, 6],
            start: 9,
            end: 19,
            slot: 30,
            horizon: 14,
            places: ['Бокс', 'Выезд'],
            seats: 4
        },
        buttons: [
            { label: 'Услуги', text: 'Показать услуги' },
            { label: 'Каталог', text: 'Открыть разделы' },
            {
                label: 'Прайс',
                items: [
                    {
                        label: 'Легковые',
                        items: [
                            { label: 'R15-R16', text: 'Шиномонтаж легкового колеса R15-R16 стоит 400 рублей, балансировка входит.' },
                            { label: 'R17-R18', text: 'Шиномонтаж легкового колеса R17-R18 стоит 500 рублей, балансировка входит.' }
                        ]
                    },
                    {
                        label: 'Внедорожник',
                        items: [
                            { label: 'R17-R19', text: 'Шиномонтаж внедорожника R17-R19 стоит 600 рублей за колесо.' },
                            { label: 'R20-R22', text: 'Шиномонтаж внедорожника R20-R22 стоит 800 рублей за колесо.' }
                        ]
                    }
                ]
            },
            { label: 'Как доехать', action: 'contact' },
            { label: 'Оплата', text: 'Показать способ оплаты' },
            { label: 'Отзывы', link: reviews },
            { label: 'Запись онлайн', action: 'book', text: 'Открыть свободные дни' }
        ]
    });
}

async function installDemo(groupId, token, title, fetchImpl) {
    const communityId = String(groupId || '').replace(/\D/g, '');
    const key = String(token || '').replace(/\s+/g, '');
    const name = String(title || '').trim().slice(0, 120) || 'Демонстрация';
    if (!communityId || key.length < 20 || key.length > 2000) {
        throw publicError('Нужен номер сообщества и ключ из его настроек.');
    }
    const reply = demoReply(communityId);
    if (!reply) throw publicError('Карточка демонстрации не собралась.');
    const rows = await db.listAssistantCommunities();
    const taken = rows.find(item => String(item.group_id) === communityId && Number(item.owner_id) !== DEMO_OWNER);
    if (taken) throw publicError('Это сообщество уже подключено к дону. Для демонстрации возьмите отдельное тестовое.');
    for (const old of rows) {
        if (Number(old.owner_id) !== DEMO_OWNER || String(old.group_id) === communityId) continue;
        await postAssistant('/community/remove', { userId: DEMO_OWNER, groupId: Number(old.group_id) }, fetchImpl);
        await db.deleteAssistantCommunity(old.group_id);
    }
    await db.upsertAssistantDon(DEMO_OWNER, 'Демонстрация', true);
    await db.saveAssistantCommunity({
        groupId: communityId,
        ownerId: DEMO_OWNER,
        title: name,
        token: key,
        syncState: 'wait',
        syncError: ''
    });
    await db.saveAssistantReply(communityId, DEMO_OWNER, reply);
    const access = await tellAccess(DEMO_OWNER, true, fetchImpl);
    const pushed = await tellCommunity({
        owner_id: DEMO_OWNER,
        group_id: communityId,
        token: key,
        title: name,
        reply
    }, fetchImpl);
    const ready = !!(pushed.ok && access.ok);
    await db.markAssistantCommunity(communityId, ready ? 'on' : 'fail', ready ? '' : (pushed.error || access.error || ''));
    return {
        ok: true,
        pending: !ready,
        groupId: communityId,
        title: name,
        link: `https://vk.com/write-${communityId}`
    };
}

async function stopDemo(fetchImpl) {
    const rows = await db.listAssistantCommunities(DEMO_OWNER);
    for (const row of rows) {
        await postAssistant('/community/remove', { userId: DEMO_OWNER, groupId: Number(row.group_id) }, fetchImpl);
        await db.deleteAssistantCommunity(row.group_id);
    }
    await db.upsertAssistantDon(DEMO_OWNER, 'Демонстрация', false);
    await tellAccess(DEMO_OWNER, false, fetchImpl);
    return { ok: true, stopped: rows.length };
}

async function adminList(fetchImpl) {
    const health = await readHealth(fetchImpl);
    const dons = await db.listAssistantDons();
    const communities = await db.listAssistantCommunities();
    const requests = await db.listAssistantSetups('open');
    let counts = {};
    const groups = communities.map(item => Number(item.group_id)).filter(id => Number.isInteger(id) && id > 0);
    if (groups.length) {
        const summary = await postAssistant('/summary', { groups }, fetchImpl);
        if (summary.ok && summary.counts && typeof summary.counts === 'object' && !Array.isArray(summary.counts)) {
            counts = summary.counts;
        }
    }
    const demoRow = communities.find(item => Number(item.owner_id) === DEMO_OWNER) || null;
    const demo = demoRow ? {
        groupId: String(demoRow.group_id),
        title: demoRow.title || 'Демонстрация',
        sync: demoRow.sync_state || '',
        syncLabel: syncLabel(demoRow.sync_state),
        error: demoRow.sync_error || '',
        link: `https://vk.com/write-${demoRow.group_id}`
    } : null;
    return {
        health,
        join: JOIN_URL,
        demo,
        dons: dons.filter(row => Number(row.user_id) !== DEMO_OWNER).map(row => ({
            userId: Number(row.user_id),
            name: row.name || `ВК ${row.user_id}`,
            active: !!row.active,
            updatedAt: row.updated_at,
            communities: communities.filter(item => Number(item.owner_id) === Number(row.user_id)).map(item => ({
                groupId: String(item.group_id),
                title: item.title || `Сообщество ${item.group_id}`,
                token: maskToken(item.token),
                sync: item.sync_state || '',
                syncLabel: syncLabel(item.sync_state),
                desk: deskLabel(item.reply),
                reply: cleanReply(item.reply) || { greeting: '', buttons: [] },
                clients: Number(counts[String(item.group_id)]) || 0,
                error: item.sync_error || '',
                purgeAt: item.purge_at || null,
                updatedAt: item.updated_at
            }))
        })),
        requests: await setupRequests(requests)
    };
}

module.exports = {
    JOIN_URL,
    HOLD_MS,
    DEMO_OWNER,
    demoReply,
    installDemo,
    stopDemo,
    vkId,
    accessChange,
    maskToken,
    cleanReply,
    assistantConfig,
    planLive,
    replayPlan,
    replayKnown,
    postAssistant,
    readHealth,
    cabinet,
    applyEvent,
    registerLive,
    connectCommunity,
    saveDesk,
    setupNote,
    setupCard,
    askSetup,
    addSetupTalk,
    setupAlert,
    finishSetup,
    loadClients,
    loadBookings,
    loadOrders,
    publicBookings,
    publicOrders,
    pushSaved,
    loadListen,
    sendBroadcast,
    publicPeople,
    disconnectCommunity,
    adminDrop,
    wipeCommunity,
    adminList,
    syncLabel
};
