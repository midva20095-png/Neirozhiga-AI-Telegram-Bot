const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('./catalog');
const fields = require('./template_fields');
const business = require('./business-templates');

test('сто бизнес-шаблонов точные и правятся как обычные', () => {
    const rows = business.list();
    assert.equal(rows.length, 100);
    assert.equal(new Set(rows.map(row => row.title)).size, 100);
    const topics = new Set(business.TOPICS);
    rows.forEach(row => {
        assert.ok(row.title.length <= 120, row.title);
        assert.ok(topics.has(row.topics), row.topics);
        assert.equal(/[,;|]/.test(row.topics), false);
        const model = catalog.getModel(row.model, { includeDisabled: true });
        assert.ok(model, row.model);
        const parsed = fields.parseFields(row.fields);
        assert.ok(parsed.length, row.title);
        const known = new Set(parsed.map(field => field.key));
        const tokens = String(row.prompt).match(/\{([^{}]+)\}/g) || [];
        tokens.forEach(token => {
            const key = token.slice(1, -1).trim();
            assert.ok(known.has(key), row.title + ' ' + token);
        });
        parsed.forEach(field => {
            if (field.type === 'фото') return;
            assert.ok(row.prompt.includes('{' + field.key + '}'), row.title + ' ' + field.key);
        });
        const photos = parsed.filter(field => field.type === 'фото');
        if (row.topics === 'Карточка товара' || row.topics === 'Витрина' || row.topics === 'Соцсети') {
            assert.ok(photos.some(field => field.multi > 1), row.title);
        }
        if (row.topics === 'До и после') assert.equal(photos.length, 2);
        const formats = String(row.formats || '').split(',').map(item => item.trim()).filter(Boolean);
        formats.forEach(format => {
            assert.ok((model.aspects || []).includes(format), row.title + ' ' + format);
        });
        assert.equal(row.audience, 'all');
        assert.equal(row.active, true);
    });
});

test('кабинет выбирает категорию списком, а бизнес стоит первым', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    assert.match(html, /id="ttopic"/);
    assert.match(html, /optgroup label="Бизнес"/);
    assert.equal(html.includes('data-ttopic'), false);
    const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    business.TOPICS.forEach(name => assert.ok(admin.includes(name), name));
    assert.match(admin, /template-topics/);
});
