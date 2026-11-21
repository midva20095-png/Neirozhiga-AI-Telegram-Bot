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

function cleanReply(input) {
    if (input == null) return { greeting: '', about: '', guide: '', buttons: [] };
    if (typeof input !== 'object' || Array.isArray(input)) return null;
    if (input.greeting != null && typeof input.greeting !== 'string') return null;
    if (input.about != null && typeof input.about !== 'string') return null;
    if (input.guide != null && typeof input.guide !== 'string') return null;
    if (input.buttons != null && !Array.isArray(input.buttons)) return null;
    const greeting = cleanBody(input.greeting, 900, true);
    const about = cleanBody(input.about, 1500, true);
    const guide = cleanBody(input.guide, 900, true);
    if (greeting === null || about === null || guide === null) return null;
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
    return { greeting, about, guide, buttons };
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
    if (/второй бот|секрет|адрес второго/i.test(text)) return 'Помощник ещё не на связи. Данные уже сохранены.';
    return text.slice(0, 180);
}

function publicError(message) {
    const error = new Error(message);
    error.public = true;
    return error;
}

function assistantConfig(env) {
    const source = env || process.env;
    const url = String(source.ASSISTANT_URL || '').trim().replace(/\/$/, '');
    const secret = String(source.ASSISTANT_SECRET || '').trim();
    return {
        url: /^https:\/\/\S+$/i.test(url) ? url : '',
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

async function postAssistant(path, body, fetchImpl, env) {
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
            body: JSON.stringify(body)
        });
    } catch (error) {
        return { ok: false, error: 'Второй бот не ответил.' };
    }
    if (!response || !response.ok) return { ok: false, error: 'Второй бот не принял команду.' };
    return { ok: true, error: '' };
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
    const key = String(token || '').trim();
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
    if (!communityId || key.length < 20 || key.length > 500) {
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
        buttons: reply.buttons
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

async function adminList(fetchImpl) {
    const health = await readHealth(fetchImpl);
    const dons = await db.listAssistantDons();
    const communities = await db.listAssistantCommunities();
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
    disconnectCommunity,
    adminDrop,
    adminList,
    syncLabel
};
