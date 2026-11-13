const axios = require('axios');
const db = require('./db');
const catalog = require('./catalog');
const gen = require('./generate');

const API = 'https://api.vk.com/method';
const VERSION = '5.199';

function accountId(vkUserId) {
    const id = Number(vkUserId);
    if (!Number.isInteger(id) || id <= 0 || id > Number.MAX_SAFE_INTEGER) return null;
    return -id;
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
        text: String(message.text || '').trim()
    };
}

function connectHint(error) {
    const code = Number(error && error.code);
    const msg = String((error && error.message) || '');
    if (/longpoll for this group is not enabled/i.test(msg)) {
        return 'В сообществе выключен Long Poll API.';
    }
    if (code === 5) return 'Ключ сообщества не принят. Создайте новый, с правом «Управление».';
    if (code === 15 || code === 27 || code === 28) return 'Нужен ключ сообщества с правом «Управление», не сервисный ключ.';
    if (code === 100) return 'Проверьте номер сообщества и включённый Long Poll API.';
    return 'Проверьте ключ сообщества и Long Poll API.';
}

function isGreeting(text) {
    const value = String(text || '').trim().toLowerCase();
    return value === 'начать' || value === 'start' || value === '/start' || value === 'привет' || value === 'баланс';
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

async function sendText(token, peerId, message) {
    await call(token, 'messages.send', {
        peer_id: String(peerId),
        random_id: String(Math.floor(Math.random() * 2e9)),
        message: String(message || '').slice(0, 3500)
    });
}

async function sendImage(token, peerId, buffer, caption) {
    const server = await call(token, 'photos.getMessagesUploadServer', { peer_id: String(peerId) });
    const form = new FormData();
    form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'neuroyaga.jpg');
    const uploaded = await axios.post(server.upload_url, form, { timeout: 60000 });
    const saved = await call(token, 'photos.saveMessagesPhoto', {
        photo: uploaded.data.photo,
        server: String(uploaded.data.server),
        hash: uploaded.data.hash
    });
    const photo = Array.isArray(saved) ? saved[0] : null;
    if (!photo) throw new Error('vk photo');
    await call(token, 'messages.send', {
        peer_id: String(peerId),
        random_id: String(Math.floor(Math.random() * 2e9)),
        message: String(caption || '').slice(0, 3500),
        attachment: `photo${photo.owner_id}_${photo.id}`
    });
}

async function reply(token, peerId, account, text) {
    if (isGreeting(text)) {
        const balance = await db.getUserBalance(account);
        const model = catalog.getModel((await db.getCurrentModel(account)) || catalog.defaultModelKey());
        await sendText(token, peerId,
            `НейроЯга во ВКонтакте.\n\nБаланс: ${balance} кр. Это отдельный счёт, не из Telegram.\nМодель: ${model ? model.name : 'текст'}.\n\nНапишите запрос своими словами.`
        );
        return;
    }
    if (!text) return;
    await sendText(token, peerId, 'Делаю ответ…');
    try {
        const modelKey = (await db.getCurrentModel(account)) || catalog.defaultModelKey();
        const prepared = await gen.prepare({
            userId: account,
            modelKey,
            hasImage: false,
            hasText: true
        });
        const result = await gen.run({
            userId: account,
            prompt: text,
            model: prepared.model,
            plugin: prepared.plugin,
            reason: `ВК · ${prepared.model.name}`
        });
        if (result.buffer && result.type === 'image') {
            await sendImage(token, peerId, result.buffer, `Готово. Списано ${result.cost} кр. Осталось ${result.balance}.`);
            return;
        }
        const answer = String(result.text || 'Готово').slice(0, 3200);
        await sendText(token, peerId, `${answer}\n\nСписано ${result.cost} кр. Осталось ${result.balance}.`);
    } catch (error) {
        await sendText(token, peerId, gen.userMessage(error));
    }
}

async function handleUpdate(token, update) {
    const incoming = readIncoming(update);
    if (!incoming) return;
    const account = accountId(incoming.fromId);
    if (!account) return;
    const { isNew } = await db.ensureUser(account, `vk:${incoming.fromId}`);
    const bonus = catalog.getGeneral().start_bonus;
    if (isNew && bonus > 0) await db.updateBalance(account, bonus, 'Приветственный бонус');
    await reply(token, incoming.peerId, account, incoming.text);
}

async function poll(token, groupId) {
    let online = false;
    let failLogged = false;
    for (;;) {
        try {
            let server = await call(token, 'groups.getLongPollServer', { group_id: groupId });
            if (!online) {
                online = true;
                console.log('ВК подключён, жду сообщения сообщества.');
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
                        await handleUpdate(token, update);
                    } catch (error) {
                        console.error('ВК: сообщение не обработано');
                    }
                }
            }
        } catch (error) {
            online = false;
            if (!failLogged) {
                failLogged = true;
                const code = Number(error && error.code);
                console.error(`ВК не подключился${code ? ` (${code})` : ''}. ${connectHint(error)} Telegram работает как прежде.`);
            }
            await new Promise(r => setTimeout(r, 15000));
        }
    }
}

function startVk() {
    const token = String(process.env.VK_GROUP_TOKEN || '').trim();
    const groupId = String(process.env.VK_GROUP_ID || '').replace(/\D/g, '');
    if (!token || !groupId) return;
    poll(token, groupId).catch(() => {});
}

module.exports = { accountId, readIncoming, isGreeting, connectHint, startVk };
