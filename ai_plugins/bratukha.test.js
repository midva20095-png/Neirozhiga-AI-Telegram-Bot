const test = require('node:test');
const assert = require('node:assert/strict');
const { operationOutcome, isMedia } = require('./bratukha_plugin');

test('статус Братухи «выполняется» значит ждать, а не ошибку', () => {
    assert.equal(operationOutcome('processing'), 'wait');
    assert.equal(operationOutcome('queued'), 'wait');
    assert.equal(operationOutcome(''), 'wait');
    assert.equal(operationOutcome('completed'), 'ready');
    assert.equal(operationOutcome('succeeded'), 'ready');
    assert.equal(operationOutcome('failed'), 'failed');
    assert.equal(operationOutcome('cancelled'), 'failed');
});

test('готовый ролик mp4 и webm принимается как файл', () => {
    const mp4 = Buffer.alloc(64);
    mp4.write('ftyp', 4, 'ascii');
    assert.equal(isMedia(mp4), true);
    const webm = Buffer.alloc(32);
    webm[0] = 0x1a;
    webm[1] = 0x45;
    webm[2] = 0xdf;
    webm[3] = 0xa3;
    assert.equal(isMedia(webm), true);
    assert.equal(isMedia(Buffer.alloc(64), 'video/mp4'), true);
    assert.equal(isMedia(Buffer.from('не файл'.padEnd(40, '.')), 'text/html'), false);
});
