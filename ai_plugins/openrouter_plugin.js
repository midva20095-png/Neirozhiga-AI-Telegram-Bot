const IMAGES = 'https://openrouter.ai/api/v1/images';
const TIERS = new Set(['512', '768', '1K', '1.5K', '2K', '4K']);

function resolutionOf(spec, quality) {
    if (quality && TIERS.has(String(quality))) return String(quality);
    return spec && spec.resolution ? spec.resolution : undefined;
}

function expectedUsd(spec, quality) {
    const list = (spec && spec.qualities) || [];
    const q = list.find(item => item.id === quality) || list.find(item => item.id === spec.quality);
    if (q && Number(q.usd) > 0) return Number(q.usd);
    return Number(spec && spec.usd) || 0;
}

function buildImageRequest({ spec, prompt, aspectRatio, quality, dataUrl }) {
    const aspects = (spec && spec.aspects) || [];
    const aspect = aspects.includes(aspectRatio) ? aspectRatio : aspects[0];
    const body = {
        model: spec.orModel,
        prompt: String(prompt || '').slice(0, 4000),
        n: 1,
        provider: { only: [spec.orProvider], allow_fallbacks: false }
    };
    if (aspect) body.aspect_ratio = aspect;
    const resolution = resolutionOf(spec, quality);
    if (resolution) body.resolution = resolution;
    if (spec.outputFormat) body.output_format = spec.outputFormat;
    if (dataUrl) {
        body.input_references = [{ type: 'image_url', image_url: { url: dataUrl } }];
    }
    return body;
}

async function processRequest(context) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('Сервис картинок не подключён');
    const spec = context.spec || {};
    let dataUrl = null;
    if (context.fileBuffer && context.fileBuffer.length) {
        const mime = context.mimeType || 'image/jpeg';
        dataUrl = `data:${mime};base64,${context.fileBuffer.toString('base64')}`;
    }
    const body = buildImageRequest({
        spec,
        prompt: context.prompt,
        aspectRatio: context.aspectRatio,
        quality: context.quality,
        dataUrl
    });
    let res;
    try {
        const axios = require('axios');
        res = await axios.post(IMAGES, body, {
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://babayagaland.ru',
                'X-OpenRouter-Title': 'НейроЯга'
            },
            timeout: 120000,
            maxBodyLength: 20 * 1024 * 1024,
            maxContentLength: 30 * 1024 * 1024
        });
    } catch (err) {
        const status = err.response && err.response.status;
        console.error('OpenRouter:', status || err.message);
        throw new Error(status === 401 || status === 402 || status === 403
            ? 'Сервис картинок сейчас недоступен'
            : 'Нейросеть не приняла запрос');
    }
    const item = res.data && Array.isArray(res.data.data) ? res.data.data[0] : null;
    if (!item || !item.b64_json) throw new Error('Нейросеть не вернула картинку');
    const cost = res.data.usage && Number(res.data.usage.cost);
    const expected = expectedUsd(spec, context.quality);
    if (Number.isFinite(cost) && expected && cost > expected * 1.5 + 0.002) {
        console.error(`OpenRouter ${spec.orModel}: счёт $${cost} выше фиксированных $${expected}`);
        throw new Error('Цена модели изменилась');
    }
    return { type: 'image', buffer: Buffer.from(item.b64_json, 'base64'), text: '' };
}

module.exports = { processRequest, buildImageRequest, expectedUsd };
