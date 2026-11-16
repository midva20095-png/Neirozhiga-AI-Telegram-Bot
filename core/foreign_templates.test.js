const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('./catalog');
const fields = require('./template_fields');
const imported = require('./foreign_templates');

const SHEET = [
    'Название,Описание,Картинка-превью (ссылка),Режим,Размер,Промпт (скрытый),Вопросы,Показывать,В тренде,Секунд (для видео),Качество (для видео),Промпт видео (для цепочки),Режим картинки (для цепочки),Видео-превью (ссылка),Тема',
    'Зодиак,Карточка,https://drive.google.com/file/d/abc123/view,super,3:4,"Портрет {пол}, знак {знак зодиака}","фото; фото; Ваше фото\nпол; выбор; Ваш пол; Женский\nзнак зодиака; текст; Знак зодиака",да,, ,,,,,"Развлечение, Знаки зодиака"',
    'Скрытый,нет,https://example.com/a.jpg,super,1:1,секрет,"фото; фото; Фото",нет,,,,,,,,',
    'Пустой,нет,,super,1:1,,"фото; фото; Фото",да,,,,,,,,',
    'Новый год,видео,https://example.com/year.jpg,chain,9:16,"Сейчас {возраст}, раньше {возраст-1}","возраст; число; Какой возраст",да,,6,480p,Оживи кадр,super,,Праздник'
].join('\n');

test('из таблицы берутся промпты, скрытые и пустые пропускаются', () => {
    const rows = imported.recordsFromCsv(SHEET);
    assert.deepEqual(rows.map(row => row.title), ['Зодиак', 'Новый год', 'Новый год · видео']);
    const card = rows[0];
    assert.equal(card.model, 'kie-gpt');
    assert.equal(card.quality, '1K');
    assert.equal(card.cost, 9);
    assert.equal(card.formats, '3:4');
    assert.equal(card.topics, 'Развлечение, Знаки зодиака');
    assert.equal(card.image, 'https://drive.google.com/thumbnail?id=abc123&sz=w800');
    const parsed = fields.parseFields(card.fields);
    assert.equal(parsed[0].type, 'фото');
    assert.equal(parsed[1].key, 'пол');
    assert.deepEqual(parsed[1].options, ['Женский']);
    assert.equal(fields.buildPrompt(card.prompt, parsed, { пол: 'Женский', 'знак зодиака': 'Лев' }), 'Портрет Женский, знак Лев');
    const years = fields.parseFields(rows[1].fields);
    assert.equal(fields.buildPrompt(rows[1].prompt, years, { возраст: '30' }), 'Сейчас 30, раньше 29');
    assert.equal(rows[2].category, 'video');
    assert.equal(rows[2].model, 'grok-video-480');
    assert.equal(rows[2].duration, 6);
    assert.equal(rows[2].cost, 36);
});

test('цена шаблона берётся из нашего каталога рядом с ценой чужого бота', () => {
    assert.equal(imported.customerPrice('standard'), 5);
    assert.equal(imported.customerPrice('super'), 9);
    assert.equal(imported.customerPrice('gpt:sunburst:medium:2k:n'), 9);
    assert.equal(imported.customerPrice('gpt:sunburst:high:2k:n'), 27);
    assert.equal(imported.customerPrice('nanopro'), 18);
    const low = imported.imageSpec('standard', '9:16');
    assert.equal(low.model, 'gpt-image-2');
    assert.equal(low.quality, 'low');
    assert.equal(catalog.quote(catalog.getModel(low.model, { includeDisabled: true }), { quality: low.quality }), 6);
    const wide = imported.imageSpec('super', '9:16');
    assert.equal(wide.model, 'gpt-image-2');
    assert.equal(wide.quality, 'low');
    const banana = imported.imageSpec('nano2', '3:4');
    assert.equal(banana.model, 'kie-banana-21');
    assert.equal(banana.quality, '2K');
    const pro = imported.imageSpec('nanopro', '1:1');
    assert.equal(pro.model, 'kie-banana-pro');
    assert.equal(pro.quality, '1K');
    const art = imported.imageSpec('seedream', '3:4');
    assert.equal(art.model, 'seedream-4-5');
    assert.equal(art.quality, '2K');
});

test('повторный запуск не делает вторую карточку с тем же названием', () => {
    const once = imported.recordsFromCsv(SHEET + '\nЗодиак,ещё,,super,1:1,ещё один,,да,,,,,,,,');
    assert.equal(once.filter(row => row.title.toLowerCase() === 'зодиак').length, 1);
    assert.equal(once.some(row => row.title === 'Зодиак 2'), true);
});

test('готовый список целый и цены совпадают с каталогом', () => {
    const rows = imported.list();
    assert.ok(rows.length >= 100);
    const titles = new Set();
    rows.forEach(row => {
        assert.ok(row.title && row.prompt);
        assert.equal(titles.has(row.title.toLowerCase()), false);
        titles.add(row.title.toLowerCase());
        const model = catalog.getModel(row.model, { includeDisabled: true });
        assert.ok(model);
        assert.equal(model.kind === 'video' ? 'video' : 'image', row.category);
        assert.equal(row.cost, catalog.quote(model, { quality: row.quality, duration: row.duration }));
        assert.ok(fields.parseFields(row.fields).every(field => field.key && field.label));
    });
    const zodiac = rows.find(row => row.title === 'Инфографика знака зодиака (Девушки)');
    assert.match(zodiac.prompt, /\{знак зодиака\}/);
    assert.match(zodiac.fields, /дата рождения/);
    const clip = rows.find(row => row.title === 'Новый год жизни · видео');
    assert.equal(clip.category, 'video');
    assert.equal(rows.some(row => row.title === 'Открытка на День Матери 3'), false);
});
