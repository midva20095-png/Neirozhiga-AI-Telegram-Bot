const axios = require('axios');
const { buildChatBody, promptTooLong } = require('../core/proxyapi_price');

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

async function postChat(key, body) {
    const send = (payload) => axios.post(`${API}/v1/chat/completions`, payload, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 120000,
        validateStatus: () => true
    });
    let res = await send(body);
    const detail = JSON.stringify(res.data || '');
    if (res.status === 400 && body.max_completion_tokens && /max_completion_tokens/i.test(detail)) {
        const next = { ...body, max_tokens: body.max_completion_tokens };
        delete next.max_completion_tokens;
        res = await send(next);
    }
    return res;
}

function replyText(data) {
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content.map(part => (part && (part.text || part.content)) || '').join('').trim();
    }
    return '';
}

async function processRequest(context) {
    const spec = context.spec || {};
    const key = apiKey();
    if (!key) throw userError('Эта модель пока не подключена.');
    if (!spec.upstream) throw userError('Модель не настроена.');
    const prompt = String(context.prompt || '').trim();
    if (!prompt) throw userError('Введите текст запроса.');
    if (promptTooLong(spec, prompt)) {
        throw userError(`Для этой модели текст не длиннее ${spec.maxChars || 3500} символов. Сократите запрос — цена указана именно для такого размера.`);
    }

    const need = Number(spec.apiRub) || 0;
    const balance = await accountBalance(key);
    if (balance != null && need > 0 && balance + 1e-9 < need) {
        throw userError('Эта модель сейчас недоступна: на сервисе не хватает запаса под ответ такого размера. Кредиты не списаны.');
    }

    let res;
    try {
        res = await postChat(key, buildChatBody(spec, prompt));
    } catch (e) {
        throw new Error('Сервис не ответил. Кредиты не списаны.');
    }
    if (res.status === 402) {
        throw userError('Сервис не принял запрос: не хватает запаса на ответ. Кредиты не списаны.');
    }
    if (res.status >= 400) {
        const detail = res.data && (res.data.detail || res.data.error && (res.data.error.message || res.data.error) || res.data.message);
        console.error('[ProxyAPI]', spec.upstream, res.status, detail || '');
        throw new Error('Не удалось получить ответ. Кредиты не списаны.');
    }
    if (res.data && res.data.usage) console.log('[ProxyAPI]', spec.upstream, JSON.stringify(res.data.usage));
    const text = replyText(res.data);
    if (!text) throw new Error('Пустой ответ. Кредиты не списаны.');
    return { type: 'text', text };
}

module.exports = { processRequest };
