const test = require('node:test');
const assert = require('node:assert/strict');
const { operationOutcome } = require('./bratukha_plugin');

test('статус Братухи «выполняется» значит ждать, а не ошибку', () => {
    assert.equal(operationOutcome('processing'), 'wait');
    assert.equal(operationOutcome('queued'), 'wait');
    assert.equal(operationOutcome(''), 'wait');
    assert.equal(operationOutcome('completed'), 'ready');
    assert.equal(operationOutcome('succeeded'), 'ready');
    assert.equal(operationOutcome('failed'), 'failed');
    assert.equal(operationOutcome('cancelled'), 'failed');
});
