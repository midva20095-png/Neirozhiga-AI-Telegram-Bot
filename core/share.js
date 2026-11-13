const channel = require('./channel');

const BUTTON = 'Сделать так же';
const OPEN_BOT = 'Открыть бота';

function numericId(id) {
    const n = String(id || '').replace(/^local:/, '');
    return /^\d+$/.test(n) ? n : '';
}

function templateLink(username, id) {
    const name = String(username || '').replace(/^@/, '').trim();
    const n = numericId(id);
    if (!name || !n) return '';
    return `https://t.me/${name}?start=tpl_${n}`;
}

function parseStart(payload) {
    const match = String(payload || '').trim().match(/^tpl_(\d{1,12})$/);
    return match ? match[1] : '';
}

function workCaption(templateTitle) {
    const title = String(templateTitle || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return 'Работа в НейроЯге';
    return `Шаблон «${title}»\nСделано в НейроЯге`;
}

function templateCaption(tpl) {
    const title = String((tpl && tpl.title) || 'Шаблон').replace(/\s+/g, ' ').trim().slice(0, 120);
    const lines = [`Шаблон «${title}»`];
    const desc = String((tpl && (tpl.desc || tpl.description)) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (desc) lines.push(desc);
    const cost = Math.max(0, Math.round(Number(tpl && tpl.cost) || 0));
    lines.push(`${cost} кр. в боте`);
    lines.push('Откройте шаблон и сделайте свою картинку.');
    return lines.join('\n').slice(0, 1000);
}

function channelFailText(err) {
    const msg = String((err && err.message) || '');
    if (/not enough rights|CHAT_WRITE_FORBIDDEN|have no rights|need administrator/i.test(msg)) {
        return 'Бот не может писать в канал. В правах администратора включите публикацию сообщений.';
    }
    return 'Не удалось отправить в канал. Попробуйте ещё раз.';
}

function imagePayload(image) {
    const value = String(image || '').trim();
    if (/^https:\/\//i.test(value)) return { photoUrl: value.slice(0, 2000) };
    const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/i.exec(value);
    if (!match) return {};
    let mime = match[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return {};
    return { bytes, mime };
}

function markup(text, url) {
    if (!url) return undefined;
    return { inline_keyboard: [[{ text: String(text || OPEN_BOT).slice(0, 64), url }]] };
}

async function sendChannel(telegram, message) {
    const extra = {
        caption: String(message.caption || '').slice(0, 1024),
        reply_markup: markup(message.button, message.url)
    };
    const chat = channel.CHANNEL;
    try {
        if (message.bytes && /^image\/(jpeg|png)$/.test(message.mime || '')) {
            await telegram.sendPhoto(chat, { source: message.bytes, filename: 'neuroyaga.jpg' }, extra);
        } else if (message.bytes && message.mime === 'video/mp4') {
            await telegram.sendVideo(chat, { source: message.bytes, filename: 'neuroyaga.mp4' }, extra);
        } else if (message.bytes && message.mime === 'audio/mpeg') {
            await telegram.sendAudio(chat, { source: message.bytes, filename: 'neuroyaga.mp3' }, extra);
        } else if (message.bytes) {
            await telegram.sendDocument(chat, { source: message.bytes, filename: 'neuroyaga.bin' }, extra);
        } else if (message.photoUrl && /^https:\/\//i.test(message.photoUrl)) {
            await telegram.sendPhoto(chat, message.photoUrl, extra);
        } else {
            await telegram.sendMessage(chat, extra.caption || 'НейроЯга', { reply_markup: extra.reply_markup });
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: channelFailText(err) };
    }
}

module.exports = {
    BUTTON,
    OPEN_BOT,
    numericId,
    templateLink,
    parseStart,
    workCaption,
    templateCaption,
    channelFailText,
    imagePayload,
    sendChannel
};
