const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./catalog');
const input = require('./bratukha_input');

function model(key) {
    const m = catalog.getModel(key, { includeDisabled: true });
    assert.ok(m, key);
    return m;
}

const SITE_KEYS = [
    'nano-banana', 'gpt-image-2', 'grok-image', 'seedream-4-5', 'wan-2-7-image', 'suno',
    'veo-3-1-lite', 'veo-3-1-fast', 'veo-3-1-quality',
    'wan-3-0-480', 'wan-3-0-720', 'wan-3-0-prime-480', 'wan-3-0-prime-720',
    'seedance-2-5-480', 'seedance-2-5-720',
    'kling-2-1-standard', 'kling-2-1-pro', 'kling-2-1-master',
    'gemini-omni', 'pika-720', 'pika-1080',
    'grok-video-480', 'grok-video-720',
    'seedance-1-0', 'seedance-2-0-apimart', 'wan-2-2-avatar', 'sora-2', 'pruna-ai-p-video-2-pro'
];

test('модели сайта есть в боте и помечены как запрос с сайта', () => {
    for (const key of SITE_KEYS) {
        const m = model(key);
        assert.equal(m.site, true, key);
        assert.equal(m.provider, 'bratukha', key);
    }
});

test('гугл остаётся на прежних ключах и называется как на сайте', () => {
    assert.equal(model('flash').name, 'Чат Flash');
    assert.equal(model('flash').provider, 'google');
    assert.equal(model('flash').group, 'text');
    assert.equal(model('flash_25').name, 'Чат Flash 2');
    assert.equal(model('pro').name, 'Чат Pro');
    assert.equal(model('pro').group, 'text_pro');
    assert.equal(model('nanobanana').name, 'Картинка');
    assert.equal(model('nanobanana').group, 'image');
    assert.equal(model('nanobanana_pro').name, 'Картинка Pro');
    const sizes = catalog.templateFormats(model('nanobanana'), '');
    assert.ok(sizes.includes('1:1') && sizes.includes('9:16') && sizes.includes('16:9') && sizes.includes('21:9'));
    assert.deepEqual(catalog.templateFormats(model('nanobanana'), '9:16, 1:1'), ['9:16', '1:1']);
    assert.deepEqual(catalog.templateFormats(model('flash'), ''), []);
    assert.equal(catalog.quote(model('flash'), {}), 4);
    assert.equal(catalog.priceLabel(model('flash')), '4 кр');
});

test('цены совпадают с сайтом', () => {
    const nano = model('nano-banana');
    assert.equal(catalog.quote(nano, { quality: 'cheap' }), 3);
    assert.equal(catalog.quote(nano, {}), 6);
    assert.match(catalog.priceLabel(nano), /^от /);

    const grok = model('grok-video-480');
    assert.equal(catalog.quote(grok, { duration: 10 }), 60);
    assert.equal(catalog.fromPrice(grok), 36);

    assert.equal(catalog.quote(model('kling-2-1-standard'), { duration: 10 }), 150);
    assert.equal(catalog.quote(model('sora-2'), { duration: 4 }), 120);
    assert.equal(catalog.quote(model('sora-2'), { duration: 8 }), 240);
    assert.equal(catalog.quote(model('suno'), { quality: 'song' }), 30);
    assert.equal(catalog.priceLabel(model('suno')), '30 кр');
    assert.equal(catalog.quote(model('seedance-2-0-apimart'), {}), 90);
    assert.equal(catalog.quote(model('pruna-ai-p-video-2-pro'), { duration: 5 }), 140);
    assert.equal(catalog.quote(model('seedance-1-0'), {}), 60);
    assert.equal(catalog.quote(model('gpt-image-2'), { quality: 'low' }), 6);
    assert.equal(catalog.quote(model('gpt-image-2'), { quality: 'high' }), 90);
    assert.equal(catalog.quote(model('veo-3-1-quality'), {}), 300);
    assert.equal(catalog.quote(model('wan-2-2-avatar'), { quality: '720p', seconds: 4 }), 120);

    const giga = model('giga-lite');
    assert.equal(catalog.quote(giga, {}), 0);
    assert.equal(catalog.priceLabel(giga), 'бесплатно');
});

test('кнопки моделей укладываются в лимит Telegram', () => {
    for (const m of catalog.listModels({ includeDisabled: true })) {
        const label = `${m.short} · ${catalog.priceLabel(m)}`;
        assert.ok(label.length <= 64, label);
        assert.ok(Buffer.byteLength(`set_model_${m.key}`) <= 64, m.key);
    }
    for (const id of ['text', 'text_pro', 'image', 'video', 'video_mid', 'video_top', 'music', 'free', 'fix']) {
        assert.ok(catalog.GROUPS[id]);
        const list = catalog.listModels({ includeDisabled: true }).filter(m => m.group === id);
        assert.ok(list.length > 0, id);
    }
});

test('видео Veo от Google в каталоге нет, Veo сайта остаётся', () => {
    assert.equal(catalog.getModel('veo', { includeDisabled: true }), null);
    const all = catalog.listModels({ includeDisabled: true });
    const googleVideo = all.filter(m => m.provider === 'google' && m.kind === 'video');
    assert.equal(googleVideo.length, 0);
    assert.equal(all.some(m => m.provider === 'proxyapi' || String(m.key).startsWith('px-')), false);
    assert.equal(model('veo-3-1-lite').provider, 'bratukha');
    assert.equal(model('veo-3-1-quality').cost, 300);
    const plugin = fs.readFileSync(path.join(__dirname, '../ai_plugins/google_gemini_plugin.js'), 'utf8');
    assert.equal(plugin.includes('veo-3.1-generate-preview'), false);
    assert.equal(plugin.includes("modelKey === 'veo'"), false);
});

test('запрос в Братуху собирается как на сайте', () => {
    const veo = model('veo-3-1-lite');
    const veoIn = input.buildSiteInput(veo, { prompt: 'кот', aspect: '9:16' });
    assert.equal(veoIn.input.model, 'veo3.1-lite');
    assert.equal(veoIn.input.image_urls, undefined);

    const kling = model('kling-2-1-standard');
    const klingIn = input.buildSiteInput(kling, { prompt: 'оживи', imageUrl: 'https://img', duration: 10 });
    assert.equal(klingIn.input.image_url, 'https://img');
    assert.equal(klingIn.input.duration, '10');

    const sora = input.buildSiteInput(model('sora-2'), { prompt: 'море', aspect: '9:16', duration: 4 });
    assert.equal(sora.input.size_std, '720*1280');
    assert.equal(sora.tool, 'sora-2');

    const song = input.buildSiteInput(model('suno'), { prompt: 'дождь', quality: 'instrumental' });
    assert.equal(song.input.instrumental, 'true');

    const gpt = model('gpt-image-2');
    assert.deepEqual(input.siteModes(gpt, 'high'), ['cheap', 'normal']);
    assert.deepEqual(input.siteModes(gpt, 'low'), ['normal']);
});

test('цена из админки списывается, в том числе у GigaChat', async () => {
    const saved = {};
    await catalog.saveModels({ setSetting: async (key, value) => { saved[key] = value; } }, {
        'giga-pro': { cost: '15', enabled: true, limit: 10 },
        'giga-max': { cost: 20, enabled: true },
        'giga-ultra': { cost: 30, enabled: true },
        'nano-banana': { cost: 12, enabled: true },
        'sora-2': { cost: 240, enabled: true }
    });
    const pro = model('giga-pro');
    assert.equal(pro.group, 'text_pro');
    assert.equal(pro.cost, 15);
    assert.equal(pro.limit, 10);
    assert.equal(catalog.quote(pro, {}), 15);
    assert.equal(catalog.priceLabel(pro), '15 кр');
    assert.equal(catalog.quote(model('giga-max'), {}), 20);
    assert.equal(catalog.quote(model('giga-ultra'), {}), 30);
    assert.equal(catalog.quote(model('giga-lite'), {}), 0);
    assert.equal(catalog.priceLabel(model('giga-lite')), 'бесплатно');
    assert.equal(catalog.quote(model('nano-banana'), { quality: 'cheap' }), 6);
    assert.equal(catalog.quote(model('nano-banana'), {}), 12);
    assert.equal(catalog.quote(model('sora-2'), { duration: 4 }), 240);
    assert.equal(catalog.quote(model('sora-2'), { duration: 8 }), 480);
    assert.equal(saved.models['giga-pro'].cost, 15);
    assert.equal(saved.models['sora-2'].cost, 240);
});
