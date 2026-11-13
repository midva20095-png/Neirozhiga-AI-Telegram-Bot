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

function parsePayload(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (e) { return null; }
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
        text: String(message.text || '').trim(),
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
    if (code === 15 || code === 27 || code === 28) return 'Нужен ключ сообщества с правом «Управление», не сервисный ключ.';
    if (code === 100) return 'Проверьте номер сообщества и включённый Long Poll API.';
    return 'Проверьте ключ сообщества и Long Poll API.';
}

function isGreeting(text) {
    return menuAction(text) === 'hello' || menuAction(text) === 'balance';
}

function menuAction(text, payload) {
    if (payload && payload.a) return String(payload.a);
    if (payload && payload.g) return 'group';
    if (payload && payload.m) return 'model';
    if (payload && payload.p) return 'pack';
    if (payload && payload.command === 'start') return 'hello';
    const value = String(text || '').trim().toLowerCase();
    if (value === 'начать' || value === 'start' || value === '/start' || value === 'привет') return 'hello';
    if (value === 'баланс') return 'balance';
    if (value === 'модели' || value === 'модель') return 'models';
    if (value === 'пополнить') return 'pay';
    if (value === 'справка' || value === 'помощь') return 'help';
    return '';
}

function fitLabel(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length <= 40 ? value : value.slice(0, 39) + '…';
}

function siteLink() {
    return catalog.getGeneral().site_url || 'https://babayagaland.ru';
}

function mainMenu() {
    return JSON.stringify({
        one_time: false,
        buttons: [
            [
                { action: { type: 'text', label: 'Баланс', payload: '{"a":"balance"}' }, color: 'primary' },
                { action: { type: 'text', label: 'Модели', payload: '{"a":"models"}' }, color: 'primary' }
            ],
            [
                { action: { type: 'text', label: 'Пополнить', payload: '{"a":"pay"}' }, color: 'positive' },
                { action: { type: 'open_link', label: 'Кабинет', link: siteLink(), payload: '{}' } }
            ],
            [
                { action: { type: 'text', label: 'Справка', payload: '{"a":"help"}' }, color: 'secondary' }
            ]
        ]
    });
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
    const groups = Object.keys(catalog.GROUPS).filter(group => catalog.modelsByGroup(group).length > 0);
    const rows = [];
    for (let i = 0; i < groups.length; i += 2) {
        const row = [textButton(catalog.GROUPS[groups[i]], { g: groups[i] })];
        if (groups[i + 1]) row.push(textButton(catalog.GROUPS[groups[i + 1]], { g: groups[i + 1] }));
        rows.push(row);
    }
    rows.push([textButton('Меню', { a: 'hello' }, 'primary')]);
    return asBoard(rows);
}

function modelKeyboard(group) {
    const rows = catalog.modelsByGroup(group).slice(0, 9).map(model => [
        textButton(`${model.short} · ${catalog.priceLabel(model)}`, { m: model.key })
    ]);
    rows.push([textButton('К разделам', { a: 'models' }, 'primary')]);
    return asBoard(rows);
}

function payKeyboard() {
    const rows = catalog.listPackages().slice(0, 9).map(pkg => [
        textButton(`${pkg.title} · ${pkg.price} ₽`, { p: pkg.id }, 'positive')
    ]);
    rows.push([textButton('Меню', { a: 'hello' }, 'secondary')]);
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
    console.error('ВК не принял клавиатуру. Ответ ушёл без кнопок.');
}

async function sendMessage(token, params) {
    try {
        await call(token, 'messages.send', params);
    } catch (error) {
        const code = Number(error && error.code);
        if (!params.keyboard || (code !== 912 && code !== 911)) throw error;
        noteKeyboard(error);
        const plain = { ...params, random_id: String(Math.floor(Math.random() * 2e9)) };
        delete plain.keyboard;
        await call(token, 'messages.send', plain);
    }
}

async function sendText(token, peerId, message, keyboard) {
    await sendMessage(token, {
        peer_id: String(peerId),
        random_id: String(Math.floor(Math.random() * 2e9)),
        message: String(message || '').slice(0, 3500),
        keyboard: keyboard || mainMenu()
    });
}

async function enableButtons(token, groupId) {
    try {
        await call(token, 'groups.setSettings', {
            group_id: groupId,
            messages: '1',
            bots_capabilities: '1',
            bots_start_button: '1'
        });
        console.log('ВК: возможности ботов включены, кнопки доступны.');
    } catch (error) {
        console.error('ВК не смог сам включить кнопки. Сообщения → Настройки для бота → Возможности ботов → Включены.');
    }
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
    await sendMessage(token, {
        peer_id: String(peerId),
        random_id: String(Math.floor(Math.random() * 2e9)),
        message: String(caption || '').slice(0, 3500),
        attachment: `photo${photo.owner_id}_${photo.id}`,
        keyboard: mainMenu()
    });
}

const awaitingEmail = new Map();

async function createPayment(amount, description, email, metadata) {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;
    if (!shopId || !secretKey) return null;
    const response = await axios.post('https://api.yookassa.ru/v3/payments', {
        amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: siteLink() },
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
    const model = catalog.getModel((await db.getCurrentModel(account)) || catalog.defaultModelKey());
    const empty = Number(balance) > 0 ? '' : '\n\nСейчас 0 кредитов. Нажмите «Пополнить». После оплаты они придут в этот чат.';
    await sendText(token, peerId,
        `НейроЯга во ВКонтакте.\n\nБаланс: ${balance} кр. Этот счёт только для ВК.\nМодель: ${model ? model.name : 'текст'}.${empty}\n\nКнопки внизу: Баланс, Модели, Пополнить. «Кабинет» открывает сайт. Дальше напишите запрос своими словами.`
    );
}

async function sendHelp(token, peerId) {
    await sendText(token, peerId,
        'Кнопки под сообщением.\n\n«Баланс» — кредиты этого чата ВК. Они не общие с Telegram и сайтом.\n«Модели» — текст, картинки, видео или музыка.\n«Пополнить» — оплата, кредиты вернутся сюда.\n«Кабинет» — сайт с кабинетом.\n\nПосле выбора модели напишите запрос. Если модель просит фото, прикрепите его к тексту.'
    );
}

async function openMenu(token, peerId, account, action) {
    awaitingEmail.delete(account);
    if (action === 'hello' || action === 'balance') return sendStatus(token, peerId, account);
    if (action === 'help') return sendHelp(token, peerId);
    if (action === 'models') {
        const board = JSON.parse(sectionKeyboard());
        if (board.buttons.length < 2) return sendText(token, peerId, 'Сейчас нет доступных моделей.');
        return sendText(token, peerId, 'Выберите раздел. Кнопки внизу, под полем ввода.', sectionKeyboard());
    }
    if (action === 'pay') {
        const board = JSON.parse(payKeyboard());
        if (board.buttons.length < 2) return sendText(token, peerId, `Пополнение в чате сейчас недоступно. Откройте кабинет: ${siteLink()}`);
        return sendText(token, peerId, 'Выберите пакет внизу. Кредиты придут в этот чат ВК.', payKeyboard());
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
    const model = catalog.getModel(key);
    if (!model) return sendText(token, peerId, 'Модель недоступна.');
    await db.setCurrentModel(account, model.key);
    return sendText(token, peerId, `${model.name}. ${catalog.priceLabel(model)}. Напишите запрос.`);
}

async function reply(token, peerId, account, text, payload) {
    const action = menuAction(text, payload);
    if (action === 'group') {
        awaitingEmail.delete(account);
        if (!payload || !catalog.GROUPS[payload.g]) return sendText(token, peerId, 'Раздел недоступен.');
        return sendText(token, peerId, `${catalog.GROUPS[payload.g]}. Выберите модель внизу.`, modelKeyboard(payload.g));
    }
    if (action === 'model') {
        awaitingEmail.delete(account);
        return chooseModel(token, peerId, account, payload && payload.m);
    }
    if (action === 'pack') {
        const pkg = catalog.getPackage(payload && payload.p);
        if (!pkg) return sendText(token, peerId, 'Пакет недоступен.');
        awaitingEmail.set(account, pkg.id);
        return sendText(token, peerId, `Пакет «${pkg.title}», ${pkg.price} ₽. Напишите почту для чека.`);
    }
    if (action) return openMenu(token, peerId, account, action);
    if (awaitingEmail.has(account)) {
        const email = String(text || '').trim();
        const pkg = catalog.getPackage(awaitingEmail.get(account));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !pkg) {
            await sendText(token, peerId, 'Для чека напишите почту одним сообщением. Или нажмите «Баланс», чтобы отменить.');
            return;
        }
        awaitingEmail.delete(account);
        let url = null;
        try {
            url = await createPayment(pkg.price, `Покупка ${pkg.title}`, email, { userId: String(account), credits: String(pkg.credits) });
        } catch (error) {
            url = null;
        }
        if (!url) {
            await sendText(token, peerId, `Оплата из чата сейчас не открылась. Кабинет на сайте: ${siteLink()}`);
            return;
        }
        await sendText(token, peerId, `Оплата ${pkg.title}. Кредиты придут в этот чат после платежа.\n${url}`);
        return;
    }
    if (!text) {
        await sendText(token, peerId, 'Напишите запрос или нажмите кнопку внизу.');
        return;
    }
    try {
        const modelKey = (await db.getCurrentModel(account)) || catalog.defaultModelKey();
        const prepared = await gen.prepare({
            userId: account,
            modelKey,
            hasImage: false,
            hasText: true
        });
        await sendText(token, peerId, 'Делаю ответ…');
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
        if (error && error.code === 'no_credits') {
            await sendText(token, peerId, `${error.message}\n\nНажмите «Пополнить» внизу. Кредиты этого чата не берутся из Telegram.`);
            return;
        }
        await sendText(token, peerId, gen.userMessage(error));
    }
}

async function handleEvent(token, event) {
    const account = accountId(event.userId);
    if (!account) return;
    const payload = event.payload || {};
    let snackbar = '';
    if (payload.m) {
        const model = catalog.getModel(payload.m);
        if (model) {
            await db.setCurrentModel(account, model.key);
            snackbar = `Выбрано: ${model.short}`;
        }
    } else if (payload.p) {
        snackbar = 'Напишите почту для чека';
    }
    try { await answerEvent(token, event, snackbar); } catch (e) {}
    await db.ensureUser(account, `vk:${event.userId}`);
    return reply(token, event.peerId, account, '', payload);
}

async function handleUpdate(token, update) {
    const event = readEvent(update);
    if (event) return handleEvent(token, event);
    const incoming = readIncoming(update);
    if (!incoming) return;
    const account = accountId(incoming.fromId);
    if (!account) return;
    const { isNew } = await db.ensureUser(account, `vk:${incoming.fromId}`);
    const bonus = catalog.getGeneral().start_bonus;
    if (isNew && bonus > 0) await db.updateBalance(account, bonus, 'Приветственный бонус');
    await reply(token, incoming.peerId, account, incoming.text, incoming.payload);
}

async function notify(accountIdValue, message) {
    const token = String(process.env.VK_GROUP_TOKEN || '').trim();
    const id = Number(accountIdValue);
    if (!token || !Number.isInteger(id) || id >= 0) return;
    try {
        await sendText(token, -id, message);
    } catch (e) {}
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
                await enableButtons(token, groupId);
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
                        const code = Number(error && error.code);
                        console.error(`ВК: сообщение не обработано${code ? ` (${code})` : ''}.`);
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

module.exports = {
    accountId, readIncoming, readEvent, isGreeting, menuAction, mainMenu, sectionKeyboard, modelKeyboard, connectHint, startVk, notify
};
