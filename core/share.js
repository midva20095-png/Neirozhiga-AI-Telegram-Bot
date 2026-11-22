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
    if (!/^[A-Za-z0-9_]{5,32}$/.test(name) || !n) return '';
    return `https://t.me/${name}?start=tpl_${n}`;
}

function vkTemplateLink(id, groupId) {
    const n = numericId(id);
    if (!n) return '';
    const group = String(groupId || '').replace(/\D/g, '') || '214554778';
    return `https://vk.com/app54901511_-${group}#t${n}`;
}

function vkTemplateId(value) {
    const text = String(value || '');
    const query = text.indexOf('?') >= 0 ? text.slice(text.indexOf('?') + 1) : text;
    const mark = query.lastIndexOf('hash=');
    let carried = '';
    if (mark >= 0 && (mark === 0 || query.charAt(mark - 1) === '&')) {
        carried = query.slice(mark + 5);
        try { carried = decodeURIComponent(carried.replace(/\+/g, ' ')); } catch (e) {}
        carried = carried.replace(/^#/, '');
    }
    const chunks = carried ? [carried, text] : [text];
    for (const chunk of chunks) {
        const direct = chunk.match(/tpl=(?:local:)?(\d{1,12})(?!\d)/);
        if (direct) return direct[1];
        const ref = chunk.match(/(?:^|[?&#]|vk_ref=|ref=)tpl_?(\d{1,12})(?!\d)/);
        if (ref) return ref[1];
        const short = chunk.match(/(?:^|[#?&])t(\d{1,12})(?!\d)/);
        if (short) return short[1];
    }
    return '';
}

function vkTemplateText(tpl, url) {
    const title = String((tpl && tpl.title) || 'Шаблон').replace(/\s+/g, ' ').trim().slice(0, 120);
    const lines = [`Шаблон «${title}»`];
    const desc = String((tpl && (tpl.desc || tpl.description)) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (desc) lines.push(desc);
    const cost = Math.max(0, Math.round(Number(tpl && tpl.cost) || 0));
    lines.push(`${cost} кр. в приложении`);
    lines.push('Откройте шаблон и сделайте свою картинку:');
    if (url) lines.push(url);
    return lines.join('\n').slice(0, 1500);
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function templateCard(tpl, coverUrl, openUrl) {
    const title = escapeHtml(String((tpl && tpl.title) || 'Шаблон').replace(/\s+/g, ' ').trim().slice(0, 120));
    const desc = escapeHtml(String((tpl && (tpl.desc || tpl.description)) || 'Шаблон НейроЯги').replace(/\s+/g, ' ').trim().slice(0, 300));
    const cover = escapeHtml(coverUrl);
    const open = escapeHtml(openUrl);
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>`
        + `<meta property="og:title" content="${title}">`
        + `<meta property="og:description" content="${desc}">`
        + `<meta property="og:image" content="${cover}">`
        + `<meta property="og:url" content="${open}">`
        + `<meta http-equiv="refresh" content="0;url=${open}">`
        + `</head><body><p><a href="${open}">Открыть шаблон</a></p></body></html>`;
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
    vkTemplateLink,
    vkTemplateId,
    vkTemplateText,
    templateCard,
    parseStart,
    workCaption,
    templateCaption,
    channelFailText,
    imagePayload,
    sendChannel
};
