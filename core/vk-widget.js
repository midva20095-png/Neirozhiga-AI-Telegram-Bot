const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COVERS = {
    chat: { title: 'Чат', button: 'Написать', file: 'chat.jpg', link: 'https://vk.me/tochki_linii' },
    rate: { title: 'Рейтинг', button: 'Открыть', file: 'rate.jpg', hash: '#rate' },
    site: { title: 'Сайт', button: 'Открыть', file: 'site.jpg', hash: '#site' }
};

function groupLink(groupId, hash) {
    const id = String(groupId || '230706467').replace(/\D/g, '') || '230706467';
    return `https://vk.com/app54895627_-${id}${hash || ''}`;
}

function coverWidgetCode(groupId, ids) {
    const rows = Object.keys(COVERS).map(key => {
        const item = COVERS[key];
        const cover = String((ids && ids[key]) || '');
        if (!/^-?\d+_\d+$/.test(cover)) throw new Error('Нет картинки для кнопки.');
        const url = item.link || groupLink(groupId, item.hash);
        return {
            title: item.title,
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

module.exports = { COVERS, coverWidgetCode, uploadFields, fitCover, defaultCover, uploadCover };
