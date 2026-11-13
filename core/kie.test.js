const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('./catalog');
const kie = require('./kie');

function model(key) {
    const m = catalog.getModel(key, { includeDisabled: true });
    assert.ok(m, key);
    return m;
}

test('без ключа Kie раздел скрыт, Google и Братуха на месте', () => {
    const prev = process.env.KIE_API_KEY;
    delete process.env.KIE_API_KEY;
    const visible = catalog.listModels();
    assert.equal(visible.some(m => m.provider === 'kie'), false);
    assert.equal(visible.some(m => m.key === 'flash'), true);
    assert.equal(visible.some(m => m.key === 'nano-banana'), true);
    assert.equal(model('flash').provider, 'google');
    assert.equal(model('nano-banana').provider, 'bratukha');
    assert.equal(catalog.quote(model('nano-banana'), { quality: 'cheap' }), 3);
    assert.equal(catalog.quote(model('gpt-image-2'), { quality: 'high' }), 90);
    if (prev) process.env.KIE_API_KEY = prev;
});

test('цены Kie фиксированы и чужой размер не проходит', () => {
    assert.equal(catalog.quote(model('kie-deepseek'), {}), 2);
    assert.equal(catalog.quote(model('kie-haiku'), {}), 2);
    assert.equal(catalog.quote(model('kie-gemini'), {}), 8);
    assert.equal(catalog.quote(model('kie-flux'), { quality: '1K' }), 3);
    assert.equal(catalog.quote(model('kie-flux'), { quality: '2K' }), 4);
    assert.equal(catalog.quote(model('kie-flux'), { quality: '4K' }), 10);
    assert.equal(catalog.quote(model('kie-flux'), { quality: '8K' }), 3);
    assert.equal(catalog.quote(model('kie-seedream'), { quality: '4K' }), 5);
    assert.equal(catalog.quote(model('kie-banana-21'), { quality: '4K' }), 14);
    assert.equal(catalog.quote(model('kie-banana-pro'), { quality: '2K' }), 36);
    assert.equal(catalog.quote(model('kie-banana-pro'), { quality: '4K' }), 27);
    assert.equal(catalog.quote(model('kie-gpt'), { quality: '4K' }), 24);
    assert.equal(catalog.priceLabel(model('kie-flux')), 'от 3 кр');

    const raised = { ...model('kie-flux'), cost: 5 };
    assert.equal(catalog.quote(raised, { quality: '1K' }), 5);
    assert.equal(catalog.quote(raised, { quality: '4K' }), 12);
});

test('запрос картинки Kie берёт только разрешённый режим', () => {
    const flux = kie.buildImageTask(model('kie-flux'), { prompt: 'кот', aspect: '16:9', quality: '2K' });
    assert.equal(flux.model, 'flux-3/klein-text-to-image');
    assert.equal(flux.input.resolution, '2K');
    assert.equal(flux.input.aspect_ratio, '16:9');
    assert.equal(flux.input.num_images, 1);
    assert.equal(flux.input.enhance_prompt, false);

    const forced = kie.buildImageTask(model('kie-banana-pro'), { prompt: 'кот', quality: '4K', aspect: '1:1' });
    assert.equal(forced.model, 'nano-banana-pro');
    assert.equal(forced.input.resolution, '1K');

    const seed = kie.buildImageTask(model('kie-seedream'), { prompt: 'кот', quality: '4K', aspect: '9:16', imageUrls: ['https://cdn.example/a.jpg'] });
    assert.equal(seed.model, 'seedream/5-flash-image-to-image');
    assert.equal(seed.input.size, '1K');
    assert.deepEqual(seed.input.image_urls, ['https://cdn.example/a.jpg']);

    const idea = kie.buildImageTask(model('kie-ideogram'), { prompt: 'кот', aspect: '9:16', quality: 'QUALITY' });
    assert.equal(idea.model, 'ideogram/v3-text-to-image');
    assert.equal(idea.input.rendering_speed, 'TURBO');
    assert.equal(idea.input.image_size, 'portrait_16_9');
    assert.throws(() => kie.buildImageTask(model('kie-ideogram'), { prompt: 'кот', imageUrls: ['https://cdn.example/a.jpg'] }));

    const edited = kie.buildImageTask(model('kie-gpt'), { prompt: 'кот', quality: '2K', imageUrls: ['https://cdn.example/a.jpg', 'http://evil'] });
    assert.equal(edited.model, 'gpt-image-2-image-to-image');
    assert.equal(edited.input.resolution, '2K');
    assert.deepEqual(edited.input.input_urls, ['https://cdn.example/a.jpg']);
});

test('текст Kie ограничен по длине и не включает рассуждение', () => {
    const deep = kie.buildChat(model('kie-deepseek'), 'привет');
    assert.equal(deep.path, '/openai/v1/responses');
    assert.equal(deep.body.model, 'deepseek-v4-1-flash');
    assert.equal(deep.body.stream, false);
    assert.equal(deep.body.max_output_tokens, 800);
    assert.equal(deep.body.reasoning.effort, 'none');
    assert.equal(deep.retry.max_output_tokens, undefined);

    const haiku = kie.buildChat(model('kie-haiku'), 'привет');
    assert.equal(haiku.body.max_tokens, 700);
    assert.equal(haiku.body.model, 'claude-haiku-5-5');

    const gem = kie.buildChat(model('kie-gemini'), 'привет');
    assert.equal(gem.path, '/gemini-3.1-pro/v1/chat/completions');
    assert.equal(gem.body.model, undefined);
    assert.equal(gem.body.reasoning_effort, 'low');
    assert.equal(gem.body.max_tokens, 800);
    assert.equal(kie.promptTooLong(model('kie-gemini'), 'я'.repeat(2501)), true);

    const text = kie.textFromResponse('responses', {
        output: [
            { type: 'reasoning', summary: [{ type: 'summary_text', text: 'скрыто' }] },
            { type: 'message', content: [{ type: 'output_text', text: 'Видно' }] }
        ]
    });
    assert.equal(text, 'Видно');
    assert.equal(kie.textFromResponse('claude', { content: [{ type: 'text', text: 'Да' }] }), 'Да');
    assert.equal(kie.textFromResponse('openai', { choices: [{ message: { content: 'Ок' } }] }), 'Ок');

    const task = kie.taskView({ data: { state: 'success', resultJson: '{"resultUrls":["https://cdn.example/out.jpg"]}' } });
    assert.deepEqual(task.urls, ['https://cdn.example/out.jpg']);
    assert.equal(kie.taskView({ data: { state: 'fail', failMsg: 'плохо' } }).state, 'fail');
});
