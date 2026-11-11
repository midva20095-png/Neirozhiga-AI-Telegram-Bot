const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SITE_TRANSFER_KEY = 'test-key';
process.env.SITE_API_URL = 'https://site.example';

const axios = require('axios');
const db = require('./db');
const transfer = require('./transfer');

function stubPullDb() {
    db.listPendingPulls = async () => [];
    db.insertSitePull = async () => ({ ok: true });
    db.markSitePull = async () => true;
    db.creditSitePull = async () => ({ ok: true, balance: 140 });
}

test.after(async () => {
    await db.pool.end();
});

test('перенос на сайт по-прежнему возвращает кредиты, если сайт не принял', async () => {
    const calls = [];
    db.debitBalance = async () => ({ ok: true, balance: 40 });
    db.updateBalance = async () => 50;
    axios.post = async (url, body) => {
        calls.push({ url, body });
        return { status: 503, data: {} };
    };
    const result = await transfer.transfer({ userId: 7, email: 'a@b.co', credits: 10 });
    assert.equal(result.ok, false);
    assert.equal(result.balance, 50);
    assert.ok(calls.length >= 1);
    assert.ok(calls.every(c => c.url === 'https://site.example/api/telegram/transfer'));
    assert.equal(calls[0].body.email, 'a@b.co');
    assert.equal(calls[0].body.credits, 10);
    assert.equal('password' in calls[0].body, false);
});

test('перенос на сайт не трогает баланс бота повторно, когда сайт подтвердил', async () => {
    let refunds = 0;
    db.debitBalance = async () => ({ ok: true, balance: 40 });
    db.updateBalance = async () => { refunds += 1; return 50; };
    axios.post = async (url) => {
        assert.equal(url, 'https://site.example/api/telegram/transfer');
        return { status: 200, data: { ok: true, credits: 80 } };
    };
    const result = await transfer.transfer({ userId: 7, email: 'a@b.co', credits: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.balance, 40);
    assert.equal(result.siteCredits, 80);
    assert.equal(refunds, 0);
});

test('перенос с сайта не начисляет в бот, если сайт отклонил пароль', async () => {
    stubPullDb();
    const marks = [];
    let credited = 0;
    db.markSitePull = async (id, status) => { marks.push(status); return true; };
    db.creditSitePull = async () => { credited += 1; return { ok: true, balance: 1 }; };
    axios.post = async (url, body) => {
        assert.equal(url, 'https://site.example/api/telegram/pull');
        assert.equal(body.password, 'secret');
        return { status: 200, data: { ok: false, error: 'Неверный пароль от кабинета на сайте' } };
    };
    const result = await transfer.transferFromSite({ userId: 7, email: 'a@b.co', password: 'secret', credits: 25 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Неверный пароль от кабинета на сайте');
    assert.deepEqual(marks, ['failed']);
    assert.equal(credited, 0);
});

test('перенос с сайта начисляет один раз и не зовёт старый адрес', async () => {
    stubPullDb();
    const calls = [];
    axios.post = async (url, body) => {
        calls.push(url);
        assert.equal(body.credits, 25);
        return { status: 200, data: { ok: true, credits: 70 } };
    };
    const result = await transfer.transferFromSite({ userId: 7, email: 'A@B.co', password: 'secret', credits: 25 });
    assert.equal(result.ok, true);
    assert.equal(result.balance, 140);
    assert.equal(result.siteCredits, 70);
    assert.equal(result.email, 'a@b.co');
    assert.deepEqual(calls, ['https://site.example/api/telegram/pull']);
});

test('если бот не начислил, сайт получает возврат', async () => {
    stubPullDb();
    const marks = [];
    const calls = [];
    db.creditSitePull = async () => ({ ok: false });
    db.markSitePull = async (id, status) => { marks.push(status); return true; };
    axios.post = async (url) => {
        calls.push(url);
        return { status: 200, data: { ok: true, credits: 90 } };
    };
    const result = await transfer.transferFromSite({ userId: 7, email: 'a@b.co', password: 'secret', credits: 25 });
    assert.equal(result.ok, false);
    assert.match(result.error, /возвращена на сайт/);
    assert.deepEqual(marks, ['refunding', 'refunded']);
    assert.deepEqual(calls, [
        'https://site.example/api/telegram/pull',
        'https://site.example/api/telegram/pull/refund'
    ]);
});

test('незавершённый перевод доначисляется без второго списания и без пароля', async () => {
    let inserted = 0;
    db.listPendingPulls = async () => [{
        id: '11111111-1111-1111-1111-111111111111',
        user_id: 7,
        email: 'a@b.co',
        credits: 15,
        created_at: new Date(Date.now() - 10000)
    }];
    db.insertSitePull = async () => { inserted += 1; return { ok: true }; };
    db.creditSitePull = async () => ({ ok: true, balance: 115 });
    db.markSitePull = async () => true;
    let sawPassword = false;
    axios.post = async (url, body) => {
        if (body && body.password) sawPassword = true;
        assert.equal(url, 'https://site.example/api/telegram/pull');
        assert.equal(body.transferId, '11111111-1111-1111-1111-111111111111');
        return { status: 200, data: { ok: true, credits: 40, duplicate: true, amount: 15 } };
    };
    const result = await transfer.transferFromSite({ userId: 7, email: 'a@b.co', password: 'secret', credits: 99 });
    assert.equal(result.ok, true);
    assert.equal(result.credits, 15);
    assert.equal(result.balance, 115);
    assert.equal(inserted, 0);
    assert.equal(sawPassword, false);
});

test('свежий перевод, которого сайт не видел, не даёт начать второй сразу', async () => {
    let inserted = 0;
    db.listPendingPulls = async () => [{
        id: '22222222-2222-2222-2222-222222222222',
        user_id: 7,
        email: 'a@b.co',
        credits: 15,
        created_at: new Date()
    }];
    db.insertSitePull = async () => { inserted += 1; return { ok: true }; };
    db.markSitePull = async () => { throw new Error('нельзя закрывать свежий перевод'); };
    axios.post = async () => ({ status: 200, data: { ok: false, missing: true, error: 'Введите пароль от кабинета на сайте' } });
    const result = await transfer.transferFromSite({ userId: 7, email: 'a@b.co', password: 'secret', credits: 15 });
    assert.equal(result.ok, false);
    assert.match(result.error, /ещё подтверждается/);
    assert.equal(inserted, 0);
});
