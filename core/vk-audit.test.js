const test = require('node:test');
const assert = require('node:assert/strict');
const audit = require('./vk-audit');
const vk = require('./vk');

test('ссылка на сообщество приводится к короткому имени', () => {
    assert.equal(audit.extractScreenName('https://vk.com/club123?w=wall'), 'club123');
    assert.equal(audit.extractScreenName('https://vk.ru/babki_target'), 'babki_target');
    assert.equal(audit.extractScreenName('@public55'), 'public55');
    assert.throws(() => audit.extractScreenName('просто текст'), /Не понял ссылку/);
});

test('отчёт аудита ведёт в клуб и не содержит ключей', () => {
    const report = audit.formatReport({
        name: 'Пример', nameLen: 6, nameHasKeyword: true, link: 'https://vk.com/primer',
        screenName: 'primer', screenIsDigits: false, screenLatin: true, members: 1200, activity: 'Обучение',
        cover: true, descLen: 180, avatar: true, status: true, site: true, contacts: true, address: false,
        market: true, menu: true, messagesOpen: true, pinned: 1, pinHasContact: true, pinHasPrice: false,
        topics: 1, hasReviewsTopic: true, albums: 2, clips: 4, isDonut: false, donutPosts: 0, lastDonut: null,
        n: 20, period: 30, perWeek: 4, sinceLast: 1, maxGap: 3, tags: 4, maxTagsInPost: 2, video: 6, photo: 18,
        textOnly: 0, polls: 2, links: 1, cta: 10, longText: 0, shortPosts: 1, avgLen: 700, repostsOfOthers: 0,
        buyWordsFirstLine: 0, adsMarked: 0, avgLikes: 12, avgReposts: 1, avgComments: 3, avgViews: 400,
        er: 1.2, erv: 2, vr: 33, maxEng: 40, minEng: 8, nightPosts: 0, bestHour: '12', replyRate: 60,
        repliesChecked: 10, errs: 0, errExamples: '', topWords: 'маникюр', topTags: '#прайс'
    });
    assert.match(report, /ИТОГОВАЯ ОЦЕНКА: \d+\/100/);
    assert.match(report, /Бабки таргетолога/);
    assert.match(report, /vk\.com\/primer/);
    assert.doesNotMatch(report, /access_token|vk1\.a\./);
});

test('кнопка аудита есть только во втором сообществе', () => {
    const saved = {
        VK_GROUP_ID: process.env.VK_GROUP_ID,
        VK_GROUP_TOKEN: process.env.VK_GROUP_TOKEN,
        VK_GROUP_ID_2: process.env.VK_GROUP_ID_2,
        VK_GROUP_TOKEN_2: process.env.VK_GROUP_TOKEN_2
    };
    process.env.VK_GROUP_ID = '230706467';
    process.env.VK_GROUP_TOKEN = 'secret-token-value';
    process.env.VK_GROUP_ID_2 = '555';
    process.env.VK_GROUP_TOKEN_2 = 'secret-two';
    process.env.WEBAPP_URL = process.env.WEBAPP_URL || 'https://bot.example';
    const second = JSON.parse(vk.mainMenu(10, '555'));
    const first = JSON.parse(vk.mainMenu(10, '230706467'));
    assert.equal(second.buttons.flat().some(button => button.action.label === 'Аудит'), true);
    assert.equal(first.buttons.flat().some(button => button.action.label === 'Аудит'), false);
    assert.equal(vk.menuAction('Аудит'), 'audit');
    assert.equal(vk.keepsQuiet('555', 2000000001), true);
    assert.equal(vk.keepsQuiet('555', 10), false);
    assert.equal(vk.keepsQuiet('230706467', 2000000001), false);
    const shown = JSON.stringify(vk.communityStatus());
    assert.equal(shown.includes('secret'), false);
    assert.deepEqual(vk.communityStatus().map(item => item.id), ['230706467', '555']);
    for (const key of Object.keys(saved)) {
        if (saved[key] == null) delete process.env[key];
        else process.env[key] = saved[key];
    }
});
