const test = require('node:test');
const assert = require('node:assert/strict');
const works = require('./works');

test('в память попадает картинка, слишком большой файл и текст — нет', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const saved = works.prepareWork({ kind: 'image', model: 'Картинка', prompt: '  кот\nна   крыше  ', buffer: png });
    assert.equal(saved.kind, 'image');
    assert.equal(saved.mime, 'image/png');
    assert.equal(saved.prompt, 'кот на крыше');
    assert.equal(works.prepareWork({ kind: 'text', buffer: png }), null);
    assert.equal(works.prepareWork({ kind: 'image', buffer: Buffer.alloc(works.LIMITS.image + 1) }), null);
    assert.equal(works.prepareWork({ kind: 'image', buffer: Buffer.alloc(0) }), null);
});

test('jpeg и mp4 узнаются по началу файла', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    assert.equal(works.prepareWork({ kind: 'image', buffer: jpeg }).mime, 'image/jpeg');
    const mp4 = Buffer.alloc(16);
    mp4.write('ftyp', 4, 'ascii');
    assert.equal(works.prepareWork({ kind: 'video', buffer: mp4 }).mime, 'video/mp4');
});
