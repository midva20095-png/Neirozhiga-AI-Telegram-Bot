const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

test('приложение ВК остаётся на своём адресе и сразу сообщает о запуске', () => {
    require('./build.js');
    const html = fs.readFileSync(path.join(__dirname, 'build/index.html'), 'utf8');
    assert.equal(html.includes('location.replace'), false);
    assert.equal(html.includes('telegram.org'), false);
    assert.equal(html.includes('VKWebAppInit'), true);
    assert.equal(html.includes('window.__nyApi'), true);
    assert.equal(html.includes('https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app'), true);
    assert.equal(html.includes('nySave'), true);
    assert.equal(fs.existsSync(path.join(__dirname, 'build/widget/chat.jpg')), true);
    const initAt = html.indexOf('VKWebAppInit');
    const appAt = html.indexOf('function downloadWork');
    assert.ok(initAt > 0 && appAt > initAt);
    const parts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(item => item[1]);
    assert.ok(parts.length >= 3);
    parts.forEach(part => { new Function(part); });
});
