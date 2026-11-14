const axios = require('axios');
const sharp = require('sharp');
const db = require('./db');
const bridge = require('./bridge');
const catalog = require('./catalog');
const gen = require('./generate');
const auth = require('./auth');
const activity = require('./activity');

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

function cabinetLink(account, pkgId) {
    const base = appBase();
    if (!base || account == null) return siteLink();
    const tk = auth.signUserId(account);
    const pkg = pkgId ? `&pkg=${encodeURIComponent(pkgId)}` : '';
    return `${base}/vk.html?tk=${encodeURIComponent(tk)}${pkg}`;
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

function mainMenu(peerId) {
    const rows = [];
    const account = accountId(peerId);
    const cabinet = linkButton('Кабинет', account ? cabinetLink(account) : siteLink());
    if (cabinet) rows.push([cabinet]);
    rows.push(...textRows());
    return JSON.stringify({ one_time: false, buttons: rows });
}

const pendingPay = new Map();
const pendingMove = new Map();
const pendingJob = new Map();
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

async function sendMessage(token, params) {
    try {
        await call(token, 'messages.send', params);
    } catch (error) {
        const code = Number(error && error.code);
        if (!params.keyboard || (code !== 912 && code !== 911)) throw error;
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
                if (againCode !== 912 && againCode !== 911) throw again;
            }
        }
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
        keyboard: keyboard || mainMenu(peerId)
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

async function enableActivity(token, groupId) {
    try {
        await call(token, 'groups.setLongPollSettings', {
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
            wall_repost: '1'
        });
    } catch (error) {
        console.error('ВК не включил события стены. Сообщения бота работают. Лайки и комментарии появятся в рейтинге после включения этих событий в сообществе.');
    }
}

async function jpegForVk(buffer) {
    if (buffer && buffer[0] === 0xff && buffer[1] === 0xd8) return buffer;
    return sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
}

async function sendImage(token, peerId, buffer, caption) {
    const jpeg = await jpegForVk(buffer);
    const server = await call(token, 'photos.getMessagesUploadServer', { peer_id: String(peerId) });
    const form = new FormData();
    form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'neuroyaga.jpg');
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
        keyboard: mainMenu(peerId)
    });
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

async function openMenu(token, peerId, account, action) {
    if (action === 'hello' || action === 'balance') return sendStatus(token, peerId, account);
    if (action === 'more') return sendText(token, peerId, 'Справка или рейтинг.', moreKeyboard());
    if (action === 'help') return sendHelp(token, peerId);
    if (action === 'rate') return sendRating(token, peerId, account);
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
            reason: `ВК · ${prepared.model.name}`
        });
        const done = `Готово. Списано ${result.cost} кр. Осталось ${result.balance}.`;
        try {
            if (result.buffer && result.type === 'image') {
                await sendImage(token, peerId, result.buffer, done);
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
    return sendText(token, peerId, 'Вы в меню.', mainMenu(peerId));
}

async function reply(token, peerId, account, text, payload) {
    const action = menuAction(text, payload);
    if (action === 'opt_cancel') {
        pendingPay.delete(String(account));
        pendingMove.delete(String(account));
        pendingJob.delete(String(account));
        return sendText(token, peerId, 'Запрос отменён.', mainMenu(peerId));
    }
    if (action === 'pay_back') return goBack(token, peerId, account);
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
        return openMenu(token, peerId, account, action);
    }
    if (!text) {
        await sendText(token, peerId, 'Напишите запрос или нажмите кнопку внизу.');
        return;
    }
    const modelKey = (await db.getCurrentModel(account)) || catalog.defaultModelKey('vk');
    return askOrRun(token, peerId, account, { prompt: text, modelKey, quality: '', duration: 0, aspect: '' });
}

async function handleEvent(token, event) {
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
    return reply(token, event.peerId, account, '', payload);
}

async function noteActivity(update, groupId) {
    const hit = activity.parseCommunityActivity(update, groupId);
    if (!hit) return;
    const account = accountId(hit.vkId);
    if (!account) return;
    if (hit.remove) {
        await db.removeActivity(account, hit.kind, hit.objectKey);
        return;
    }
    const saved = await db.recordActivity(account, hit.kind, hit.objectKey, activity.POINTS[hit.kind] || 0);
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

async function sendRating(token, peerId, account) {
    const range = activity.weekRange(new Date());
    let rows = [];
    try {
        rows = await attachFaces(await db.listWeekActivity(range.start));
    } catch (error) {}
    await sendText(token, peerId, activity.formatRating(rows, account, range));
}

async function handleUpdate(token, update, groupId) {
    try { await noteActivity(update, groupId); } catch (error) {}
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

async function sendToUser(accountIdValue, buffer, mime, caption) {
    const token = String(process.env.VK_GROUP_TOKEN || '').trim();
    const id = Number(accountIdValue);
    if (!token || !Number.isInteger(id) || id >= 0 || !buffer) return false;
    const peerId = -id;
    try {
        if (String(mime || '').startsWith('image/')) {
            await sendImage(token, peerId, buffer, caption || 'Файл из кабинета.');
        } else {
            await sendText(token, peerId, caption || 'Файл готов в кабинете.');
        }
        return true;
    } catch (e) {
        return false;
    }
}

async function askTopup(accountIdValue) {
    const token = String(process.env.VK_GROUP_TOKEN || '').trim();
    const id = Number(accountIdValue);
    if (!token || !Number.isInteger(id) || id >= 0) return null;
    await sendText(token, -id, 'Выберите пакет внизу. Другие кнопки скрыты. «Назад» возвращает меню.', payKeyboard());
    return chatReturnUrl();
}

async function notify(accountIdValue, message) {
    const token = String(process.env.VK_GROUP_TOKEN || '').trim();
    const id = Number(accountIdValue);
    if (!token || !Number.isInteger(id) || id >= 0) return false;
    try {
        await sendText(token, -id, message);
        return true;
    } catch (e) {
        return false;
    }
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
                await enableActivity(token, groupId);
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
                        await handleUpdate(token, update, groupId);
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
    accountId, readIncoming, readEvent, isGreeting, menuAction, mainMenu, cabinetLink, payKeyboard, payLockKeyboard, payLinkKeyboard, emailOk, createPayment, sectionKeyboard, modelKeyboard, nextChoice, modelNeedsChoice, connectHint, startVk, notify, sendToUser, askTopup, setTelegramNotify, attachFaces, jpegForVk, USER_HELP
};
