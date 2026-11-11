const axios = require('axios');
const { buildImageBody, promptTooLong } = require('../core/proxyapi_image');

const API = (process.env.PROXYAPI_BASE_URL || 'https://api.proxyapi.ru').replace(/\/$/, '');

function userError(message) {
    const err = new Error(message);
    err.code = 'user';
    return err;
}

function apiKey() {
    return process.env.PROXYAPI_KEY || process.env.PROXYAPI_API_KEY || process.env.PROXY_API_KEY || '';
}

async function accountBalance(key) {
    try {
        const res = await axios.get(`${API}/proxyapi/balance`, {
            headers: { Authorization: `Bearer ${key}` },
            timeout: 15000,
            validateStatus: () => true
        });
        if (res.status === 200 && res.data && Number.isFinite(Number(res.data.balance))) {
            return Number(res.data.balance);
        }
    } catch (e) {}
    return null;
}

function imageFrom(data) {
    const item = data && Array.isArray(data.data) ? data.data[0] : null;
    if (!item) return null;
    if (item.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64') };
    if (typeof item.url === 'string' && item.url.startsWith('http')) return { url: item.url };
    return null;
}

async function processRequest(context) {
    const spec = context.spec || {};
    const key = apiKey();
    if (!key) throw userError('Эта модель пока не подключена.');
    if (!spec.upstream) throw userError('Модель не настроена.');
    if (context.fileBuffer || (Array.isArray(context.fileBuffers) && context.fileBuffers.length)) {
        throw userError('Эта модель рисует только по тексту, без фото. Так цена остаётся дешёвой.');
    }
    const prompt = String(context.prompt || '').trim();
    if (!prompt) throw userError('Опишите картинку текстом.');
    if (promptTooLong(spec, prompt)) {
        throw userError(`Для этой модели описание не длиннее ${spec.maxChars || 600} символов. Сократите текст — так запрос остаётся в дешёвом режиме.`);
    }

    const need = Number(spec.apiRub) || 0;
    const balance = await accountBalance(key);
    if (balance != null && need > 0 && balance + 1e-9 < need) {
        throw userError('Эта модель сейчас недоступна: на сервисе не хватает запаса под дешёвую картинку. Кредиты не списаны.');
    }

    const body = buildImageBody(spec, prompt);
    let res;
    try {
        res = await axios.post(`${API}/v1/images/generations`, body, {
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            timeout: 180000,
            validateStatus: () => true
        });
    } catch (e) {
        throw new Error('Сервис не ответил. Кредиты не списаны.');
    }
    if (res.status === 402) throw userError('Сервис не принял запрос: не хватает запаса на картинку. Кредиты не списаны.');
    if (res.status >= 400) {
        const detail = res.data && (res.data.detail || (res.data.error && (res.data.error.message || res.data.error)) || res.data.message);
        console.error('[ProxyAPI image]', spec.upstream, res.status, detail || '');
        throw new Error('Картинка не получилась. Кредиты не списаны.');
    }
    const image = imageFrom(res.data);
    if (!image) throw new Error('Пустой ответ. Кредиты не списаны.');
    if (image.buffer && image.buffer.length) return { type: 'image', buffer: image.buffer, text: '' };
    const file = await axios.get(image.url, { responseType: 'arraybuffer', timeout: 120000 });
    const buffer = Buffer.from(file.data);
    if (!buffer.length) throw new Error('Пустая картинка. Кредиты не списаны.');
    return { type: 'image', buffer, text: '' };
}

module.exports = { processRequest };
