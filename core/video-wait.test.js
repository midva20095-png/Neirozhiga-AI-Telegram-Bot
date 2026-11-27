const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const wait = require('./video-wait');

test('у видео три состояния по времени, без процентов', () => {
    assert.equal(wait.line(0), 'В очереди.');
    assert.equal(wait.line(wait.QUEUE_MS - 1), 'В очереди.');
    assert.equal(wait.line(wait.QUEUE_MS), 'Собираю ролик. Это занимает несколько минут.');
    assert.equal(wait.line(wait.BUILD_MS - 1), 'Собираю ролик. Это занимает несколько минут.');
    assert.equal(wait.line(wait.BUILD_MS), 'Почти готово.');
    assert.equal(wait.LINES.some(item => item.includes('%')), false);
    assert.equal(wait.isVideo({ kind: 'video' }), true);
    assert.equal(wait.isVideo({ kind: 'image' }), false);
    assert.equal(wait.isVideo(null), false);
});

test('кабинет пишет те же три фразы', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    wait.LINES.forEach(item => assert.ok(html.includes(item), item));
});
