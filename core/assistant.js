const db = require('./db');

const JOIN_URL = 'https://vk.com/donut/club214554778';

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
    ['about', 1500],
    ['guide', 900],
    ['contacts', 500],
    ['address', 500],
    ['order', 800],
    ['payment', 500],
    ['booking', 800]
];

function emptyReply() {
    const reply = { greeting: '', buttons: [] };
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
    const greeting = cleanBody(input.greeting, 900, true);
    const fields = {};
    for (let i = 0; i < REPLY_FIELDS.length; i += 1) {
        const name = REPLY_FIELDS[i][0];
        const value = cleanBody(input[name], REPLY_FIELDS[i][1], true);
        if (value === null) return null;
        fields[name] = value;
    }
    if (greeting === null) return null;
    const source = Array.isArray(input.buttons) ? input.buttons : [];
    if (source.length > 6) return null;
    const buttons = [];
    const seen = new Set();
    for (const item of source) {
        const button = cleanButton(item);
        if (!button || seen.has(button.label)) return null;
        seen.add(button.label);
        buttons.push(button);
    }
    return Object.assign({
        greeting: greeting,
        buttons: buttons,
        schedule: cleanSchedule(input.schedule),
        scenario: input.scenario === 'info' ? 'info' : 'funnel'
    }, fields);
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
        places: places.length ? places : ['На месте']
    };
}

function clockHour(value, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 23) return fallback;
    return number;
}

function cleanButton(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const label = String(item.label || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 40) return null;
    const hasLink = item.link != null && item.link !== '';
    const hasText = item.text != null && item.text !== '';
    if (hasLink === hasText) return null;
    if (hasLink) {
        const link = httpsLink(item.link);
        if (!link) return null;
        return { label, link };
    }
    const text = cleanBody(item.text, 900, false);
    if (!text) return null;
    return { label, text };
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
        if (row && row.active && id && !live.has(id)) off.push(id);
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
        community: communityCard(communities[0])
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
        for (const item of communities) {
            const pushed = item.token ? await tellCommunity(item, fetchImpl) : sent;
            await db.markAssistantCommunity(item.group_id, pushed.ok ? 'on' : 'fail', pushed.error || '');
        }
    } else if (communities.length) {
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
    const reply = cleanReply(input);
    if (!reply) throw publicError('У кнопки нужна надпись и либо ссылка https, либо текст ответа. Кнопок не больше шести.');
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
        payment: reply.payment,
        booking: reply.booking,
        buttons: reply.buttons,
        schedule: reply.schedule,
        scenario: reply.scenario
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

async function adminDrop(groupId, fetchImpl) {
    const rows = await db.listAssistantCommunities();
    const row = rows.find(item => String(item.group_id) === String(groupId || '').replace(/\D/g, ''));
    if (!row) return { ok: false, error: 'Сообщество не найдено.' };
    return disconnectCommunity(row.owner_id, row.group_id, fetchImpl);
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

async function adminList(fetchImpl) {
    const health = await readHealth(fetchImpl);
    const dons = await db.listAssistantDons();
    const communities = await db.listAssistantCommunities();
    let counts = {};
    const groups = communities.map(item => Number(item.group_id)).filter(id => Number.isInteger(id) && id > 0);
    if (groups.length) {
        const summary = await postAssistant('/summary', { groups }, fetchImpl);
        if (summary.ok && summary.counts && typeof summary.counts === 'object' && !Array.isArray(summary.counts)) {
            counts = summary.counts;
        }
    }
    return {
        health,
        join: JOIN_URL,
        dons: dons.map(row => ({
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
                clients: Number(counts[String(item.group_id)]) || 0,
                error: item.sync_error || '',
                updatedAt: item.updated_at
            }))
        }))
    };
}

module.exports = {
    JOIN_URL,
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
    loadClients,
    pushSaved,
    loadListen,
    sendBroadcast,
    publicPeople,
    disconnectCommunity,
    adminDrop,
    adminList,
    syncLabel
};
