const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const cutter = require('./cutter');

test('карусель стоит 10 кредитов и не режется без них', () => {
    assert.equal(cutter.CUT_COST, 10);
    assert.deepEqual(cutter.cutQuote(10), { ok: true, cost: 10 });
    assert.deepEqual(cutter.cutQuote(9), { ok: false, error: 'Недостаточно кредитов. На балансе 9, нужно 10.' });
    assert.match(cutter.cutQuote(undefined).error, /На балансе 0, нужно 10/);
});

test('резак делит фото на равные вертикальные кадры слева направо', async () => {
    const width = 30;
    const height = 8;
    const strips = cutter.stripLayout(width, height, 3);
    assert.equal(strips.length, 3);
    assert.deepEqual(strips.map(item => item.x), [0, 10, 20]);
    assert.ok(strips.every(item => item.width === 10 && item.height === height));

    const raw = Buffer.alloc(width * height * 3);
    for (let x = 0; x < width; x++) {
        const color = x < 10 ? [255, 0, 0] : x < 20 ? [0, 255, 0] : [0, 0, 255];
        for (let y = 0; y < height; y++) {
            const at = (y * width + x) * 3;
            raw[at] = color[0];
            raw[at + 1] = color[1];
            raw[at + 2] = color[2];
        }
    }
    const image = sharp(raw, { raw: { width, height, channels: 3 } });
    const colors = [];
    for (const strip of strips) {
        const piece = await image.clone().extract({ left: strip.x, top: 0, width: strip.width, height: strip.height }).raw().toBuffer();
        colors.push([piece[0], piece[1], piece[2]]);
    }
    assert.deepEqual(colors, [[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    assert.equal(cutter.stripLayout(width, height, 1).length, 2);
    assert.equal(cutter.stripLayout(width, height, 99).length, 10);
});
