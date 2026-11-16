const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

test('приложение ВК сразу открывает кабинет с сервера бота', () => {
    require('./build.js');
    const html = fs.readFileSync(path.join(__dirname, 'build/index.html'), 'utf8');
    assert.equal(html.includes('<iframe'), false);
    assert.equal(html.includes('https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app/'), true);
    assert.equal(html.includes('location.search + location.hash'), true);
    assert.equal(html.includes('VKWebAppInit'), true);
    const parts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(item => item[1]);
    assert.equal(parts.length, 1);
    new Function(parts[0]);
});
