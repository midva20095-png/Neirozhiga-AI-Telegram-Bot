const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const widget = require('./vk-widget');

test('код обложек содержит картинки и не содержит служебных подписей', () => {
    const code = widget.coverWidgetCode('230706467', { chat: '1_2', rate: '3_4', site: '5_6' });
    assert.match(code, /^return \{.*\};$/);
    assert.match(code, /"cover_id":"1_2"/);
    assert.match(code, /Написать/);
    assert.match(code, /vk\.me\/tochki_linii/);
    assert.match(code, /#rate/);
    assert.doesNotMatch(code, /descr/);
    assert.throws(() => widget.coverWidgetCode('1', { chat: 'bad' }));
});

test('ответ загрузки картинки готовится для сохранения', () => {
    const fields = widget.uploadFields('{"hash":"abc","server":"1"}');
    assert.equal(fields.hash, 'abc');
    assert.equal(Buffer.from(fields.image, 'base64').toString(), '{"hash":"abc","server":"1"}');
});

test('обложка для телефона держит короткое слово по центру', async () => {
    for (const name of ['chat', 'rate', 'site']) {
        const svg = widget.coverSvg(name);
        assert.match(svg, /font-size="92"/);
        assert.match(svg, /text-anchor="middle"/);
        const cover = await widget.paintCover(name);
        const meta = await sharp(cover).metadata();
        assert.equal(meta.width, 1530);
        assert.equal(meta.height, 384);
    }
});

test('картинка обрезается под обложку ВК', async () => {
    const source = await sharp({
        create: { width: 40, height: 40, channels: 3, background: { r: 20, g: 10, b: 40 } }
    }).png().toBuffer();
    const cover = await widget.fitCover(source);
    const meta = await sharp(cover).metadata();
    assert.equal(meta.width, 1530);
    assert.equal(meta.height, 384);
    assert.equal(meta.format, 'jpeg');
});
