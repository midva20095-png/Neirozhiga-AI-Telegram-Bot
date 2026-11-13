const kie = require('../core/kie');
const db = require('../core/db');

const API = 'https://api.kie.ai';
const POLL_MS = 2500;
const POLL_TRIES = 48;

function userError(message) {
    const err = new Error(message);
    err.code = 'user';
    return err;
}

function apiKey() {
    return String(process.env.KIE_API_KEY || '').trim();
}

function note(message) {
    db.note('kie', message).catch(() => {});
}

function headers(key) {
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function errorText(data) {
    if (!data) return '';
    if (typeof data === 'string') return data.slice(0, 300);
    return String(data.msg || data.message || (data.error && (data.error.message || data.error)) || '').slice(0, 300);
}

async function postJson(axios, key, path, body) {
    try {
        return await axios.post(`${API}${path}`, body, {
            headers: headers(key),
            timeout: 90000,
            validateStatus: () => true
        });
    } catch (e) {
        throw new Error('Сервис не ответил. Кредиты не списаны.');
    }
}

function photoKb(buffer) {
    return Math.max(1, Math.round((buffer && buffer.length ? buffer.length : 0) / 1024));
}

function uploadNote(label, text) {
    note(`${label}: ${String(text || '').replace(/https?:\/\/\S+/g, '').slice(0, 220)}`);
}

async function postUpload(axios, key, path, body, contentType) {
    const headers = { Authorization: `Bearer ${key}` };
    if (contentType) headers['Content-Type'] = contentType;
    return axios.post(`${API}${path}`, body, {
        headers,
        timeout: 90000,
        maxBodyLength: 30 * 1024 * 1024,
        maxContentLength: 2 * 1024 * 1024,
        validateStatus: () => true
    });
}

async function uploadImage(axios, key, buffer, mimeType, label) {
    const mime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const fileName = `photo-${Date.now()}.${ext}`;
    const kb = photoKb(buffer);
    const name = label || 'kie';
    let res = await postUpload(axios, key, '/api/file-base64-upload', {
        base64Data: `data:${mime};base64,${buffer.toString('base64')}`,
        uploadPath: 'images/base64',
        fileName
    }, 'application/json');
    let view = kie.uploadView(res.data);
    if (!view.url && typeof FormData === 'function' && typeof Blob === 'function') {
        uploadNote(name, `фото ${kb} КБ не принято, HTTP ${res.status}, код ${view.code || '—'}, ${view.msg || 'без текста'}. Повтор файлом.`);
        try {
            const form = new FormData();
            form.append('uploadPath', 'images/base64');
            form.append('fileName', fileName);
            form.append('file', new Blob([buffer], { type: mime }), fileName);
            res = await postUpload(axios, key, '/api/file-stream-upload', form);
            view = kie.uploadView(res.data);
        } catch (e) {
            uploadNote(name, `повтор файлом не отправился, фото ${kb} КБ`);
        }
    }
    if (!view.url) {
        uploadNote(name, `фото ${kb} КБ не загрузилось, HTTP ${res.status}, код ${view.code || '—'}, ${view.msg || 'без текста'}`);
        throw new Error('Фото не загрузилось. Кредиты не списаны.');
    }
    return view.url;
}

function failureError(text, fallback) {
    const message = kie.explainFailure(text);
    if (message) return userError(message);
    return new Error(fallback);
}

async function chat(axios, key, spec, prompt) {
    const built = kie.buildChat(spec, prompt);
    let res = await postJson(axios, key, built.path, built.body);
    if (res.status === 400 && built.retry && /max_output_tokens|max_tokens/i.test(errorText(res.data))) {
        res = await postJson(axios, key, built.path, built.retry);
    }
    if (res.status >= 500) {
        await wait(1500);
        res = await postJson(axios, key, built.path, built.retry || built.body);
    }
    if (res.status === 401 || res.status === 403) throw userError('Эта модель пока не подключена.');
    if (res.status >= 400) throw failureError(errorText(res.data), 'Ответ не получился. Кредиты не списаны.');
    const text = kie.textFromResponse(spec.kieChat.style, res.data);
    if (!text) throw new Error('Пустой ответ. Кредиты не списаны.');
    return { type: 'text', text };
}

async function pollTask(axios, key, taskId) {
    for (let i = 0; i < POLL_TRIES; i++) {
        await wait(POLL_MS);
        let res;
        try {
            res = await axios.get(`${API}/api/v1/jobs/recordInfo`, {
                params: { taskId },
                headers: headers(key),
                timeout: 20000,
                validateStatus: () => true
            });
        } catch (e) {
            continue;
        }
        if (res.status === 401 || res.status === 403) throw userError('Эта модель пока не подключена.');
        const view = kie.taskView(res.data);
        if (view.state === 'success' && view.urls.length) return view.urls[0];
        if (view.state === 'fail') throw failureError(view.fail, 'Картинка не получилась. Кредиты не списаны.');
    }
    throw new Error('Картинка не успела за две минуты. Кредиты не списаны.');
}

function urlOk(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname !== 'localhost' && !url.hostname.endsWith('.local');
    } catch (e) {
        return false;
    }
}

async function downloadImage(axios, fileUrl) {
    if (!urlOk(fileUrl)) throw new Error('Пустая картинка. Кредиты не списаны.');
    let file;
    try {
        file = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
            maxRedirects: 3,
            maxContentLength: 40 * 1024 * 1024,
            maxBodyLength: 40 * 1024 * 1024
        });
    } catch (e) {
        throw new Error('Картинку не удалось забрать. Кредиты не списаны.');
    }
    const buffer = Buffer.from(file.data || []);
    if (!buffer.length) throw new Error('Пустая картинка. Кредиты не списаны.');
    return buffer;
}

async function processRequest(context) {
    const axios = require('axios');
    const spec = context.spec || {};
    const key = apiKey();
    if (!key) throw userError('Эта модель пока не подключена.');
    const prompt = String(context.prompt || '').trim();
    if (!prompt) throw userError(spec.kind === 'text' ? 'Напишите сообщение.' : 'Опишите картинку текстом.');
    if (kie.promptTooLong(spec, prompt)) {
        throw userError(`Для этой модели сообщение не длиннее ${spec.kieChat.maxChars} символов. Так цена остаётся фиксированной.`);
    }

    const label = spec.key || spec.kieModel || 'kie';
    if (spec.kieChat) {
        const out = await chat(axios, key, spec, prompt);
        note(`${label}: ответ готов`);
        return out;
    }

    const buffers = [];
    if (context.fileBuffer) buffers.push(context.fileBuffer);
    if (Array.isArray(context.fileBuffers)) buffers.push(...context.fileBuffers.filter(Boolean));
    if (buffers.length && spec.image === 'forbidden') {
        throw userError('Эта модель рисует только по тексту, без фото.');
    }

    let imageUrls = [];
    if (buffers.length) {
        imageUrls = [await uploadImage(axios, key, buffers[0], context.mimeType, label)];
    }
    const task = kie.buildImageTask(spec, {
        prompt,
        aspect: context.aspectRatio,
        quality: context.quality,
        imageUrls
    });
    const created = await postJson(axios, key, '/api/v1/jobs/createTask', task);
    if (created.status === 401 || created.status === 403) throw userError('Эта модель пока не подключена.');
    const taskId = created.data && created.data.data && created.data.data.taskId;
    if (created.status >= 400 || !taskId) throw failureError(errorText(created.data), 'Картинка не запустилась. Кредиты не списаны.');
    const fileUrl = await pollTask(axios, key, taskId);
    const buffer = await downloadImage(axios, fileUrl);
    note(`${label}: картинка готова`);
    return { type: 'image', buffer, text: '' };
}

module.exports = { processRequest };
