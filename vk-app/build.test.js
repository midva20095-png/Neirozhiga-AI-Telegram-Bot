const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

test('приложение ВК содержит кабинет и не вставляет чужой адрес рамкой', () => {
    require('./build.js');
    const html = fs.readFileSync(path.join(__dirname, 'build/index.html'), 'utf8');
    assert.equal(html.includes('<iframe'), false);
    assert.equal(html.includes('Открываю кабинет'), false);
    assert.equal(html.includes('fonts.googleapis.com'), false);
    assert.equal(html.includes('telegram.org'), false);
    assert.equal(html.includes('window.__nyHost'), true);
    assert.equal(html.includes('function nyPost('), true);
    assert.equal(html.includes('function modelPicker'), true);
    assert.equal(html.includes("getElementById('genmodel')"), true);
    assert.equal(html.includes('https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app'), true);
    for (const name of ['chat', 'rate', 'site']) {
        assert.equal(fs.existsSync(path.join(__dirname, 'build/widget', name + '.jpg')), true);
    }
    const parts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(item => item[1]);
    assert.equal(parts.length >= 2, true);
    for (const part of parts) new Function(part);
});
