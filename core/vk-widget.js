const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COVERS = {
    chat: { title: 'Чат', button: 'Написать', file: 'chat.jpg', chat: true },
    rate: { title: 'Рейтинг', button: 'Открыть', file: 'rate.jpg', hash: '#rate' },
    site: { title: 'Сайт', button: 'Открыть', file: 'site.jpg', hash: '#site' }
};

function groupNumber(groupId) {
    return String(groupId || '230706467').replace(/\D/g, '') || '230706467';
}

function chatLink(groupId) {
    return `https://vk.ru/write-${groupNumber(groupId)}`;
}

function groupLink(groupId, hash) {
    return `https://vk.ru/app54895627_-${groupNumber(groupId)}${hash || ''}`;
}

function coverWidgetCode(groupId, ids) {
    const rows = Object.keys(COVERS).map(key => {
        const item = COVERS[key];
        const cover = String((ids && ids[key]) || '');
        if (!/^-?\d+_\d+$/.test(cover)) throw new Error('Нет картинки для кнопки.');
        const url = item.chat ? chatLink(groupId) : groupLink(groupId, item.hash);
        return {
            title: item.title,
            title_url: url,
            button: item.button,
            cover_id: cover,
            url,
            button_url: url
        };
    });
    return `return ${JSON.stringify({ title: 'НейроЯга', rows })};`;
}

function uploadFields(raw) {
    let payload = {};
    try { payload = JSON.parse(String(raw || '')); } catch (e) { payload = {}; }
    return {
        hash: String(payload.hash || ''),
        image: payload.image ? String(payload.image) : Buffer.from(String(raw || '')).toString('base64')
    };
}

function vkMessage(error, fallback) {
    const code = Number(error && error.error_code);
    if (code === 15 || code === 27 || code === 28) return 'Разрешите приложению кнопки сообщества.';
    if (code === 129) return 'ВК не принял картинку. Поставьте другую.';
    return fallback;
}

const LOOKS = {
    chat: { word: 'Чат', from: '#7c3aed', via: '#4c1d95', to: '#12081f', mark: 'M21 12.2c0 3.8-3.6 6.8-8.2 6.8-.8 0-1.6-.1-2.3-.2L6 21.2l.7-3.2C5 16.6 3.8 14.5 3.8 12.2 3.8 8.4 7.4 5.4 12 5.4s9 3 9 6.8z' },
    rate: { word: 'Рейтинг', from: '#f59e0b', via: '#b45309', to: '#1c1208', mark: 'M12 2.2l2.7 5.6 6.2.9-4.5 4.3 1.1 6.1L12 16.2 6.5 19.1l1.1-6.1L3.1 8.7l6.2-.9z' },
    site: { word: 'Сайт', from: '#14b8a6', via: '#0f766e', to: '#04201c', mark: 'M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 17.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5zm5.2 13h5.6' }
};

function coverSvg(name) {
    const look = LOOKS[name];
    if (!look) throw new Error('Неизвестная кнопка.');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1530" height="384" viewBox="0 0 1530 384">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${look.from}"/>
      <stop offset="0.48" stop-color="${look.via}"/>
      <stop offset="1" stop-color="${look.to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="38%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1530" height="384" fill="url(#bg)"/>
  <rect width="1530" height="384" fill="url(#glow)"/>
  <g transform="translate(765 132)">
    <circle cx="0" cy="0" r="42" fill="#ffffff" fill-opacity="0.18"/>
    <g transform="translate(-28 -28) scale(2.35)" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="${look.mark}"/>
    </g>
  </g>
  <text x="765" y="268" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-size="92" font-weight="700" fill="#ffffff">${look.word}</text>
</svg>`;
}

async function paintCover(name) {
    return sharp(Buffer.from(coverSvg(name))).jpeg({ quality: 86 }).toBuffer();
}

async function fitCover(buffer) {
    return sharp(buffer).rotate().resize(1530, 384, { fit: 'cover', position: 'centre' }).jpeg({ quality: 86 }).toBuffer();
}

function defaultCover(name) {
    const item = COVERS[name];
    if (!item) throw new Error('Неизвестная кнопка.');
    return fs.promises.readFile(path.join(__dirname, '../public/widget', item.file));
}

async function uploadCover(token, jpeg) {
    const access = String(token || '').trim();
    if (access.length < 20 || access.length > 500) throw new Error('Нет разрешения сообщества.');
    const params = new URLSearchParams({ access_token: access, v: '5.199', image_type: '510x128' });
    const serverRes = await fetch(`https://api.vk.com/method/appWidgets.getGroupImageUploadServer?${params}`);
    const serverJson = await serverRes.json();
    const uploadUrl = serverJson.response && serverJson.response.upload_url;
    if (!uploadUrl) throw new Error(vkMessage(serverJson.error, 'ВК не открыл загрузку картинки.'));
    const form = new FormData();
    form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'cover.jpg');
    const uploaded = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}` },
        body: form
    });
    const raw = await uploaded.text();
    const fields = uploadFields(raw);
    const save = new URLSearchParams({
        access_token: access,
        v: '5.199',
        hash: fields.hash,
        image: fields.image
    });
    const savedRes = await fetch('https://api.vk.com/method/appWidgets.saveGroupImage', { method: 'POST', body: save });
    const saved = await savedRes.json();
    const id = saved.response && saved.response.id;
    if (!id) throw new Error(vkMessage(saved.error, 'ВК не сохранил картинку.'));
    return String(id);
}

module.exports = { COVERS, coverWidgetCode, chatLink, groupLink, uploadFields, fitCover, paintCover, coverSvg, defaultCover, uploadCover };
