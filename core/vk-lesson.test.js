const test = require('node:test');
const assert = require('node:assert/strict');
const club = require('./vk-club');
const lesson = require('./vk-lesson');

test('свой урок пишется только если в клубе нет подходящей ссылки', () => {
    const known = lesson.lessonRoute('как сделать обложку сообщества');
    assert.equal(known.kind, 'link');
    assert.match(known.text, /https:\/\/vk\.com\/@neuroyaga-/);
    const fresh = lesson.lessonRoute('как сварить борщ в казане');
    assert.equal(fresh.kind, 'write');
    assert.equal(lesson.lessonRoute('спасибо большое').kind, 'skip');
    assert.equal(lesson.lessonRoute('ок').kind, 'skip');
    assert.equal(lesson.lessonRoute('привет').kind, 'write');
    assert.equal(lesson.lessonRoute('обложка').kind, 'link');
    assert.equal(lesson.questionText('# как сделать обложку'), 'как сделать обложку');
    assert.equal(lesson.questionText('как сделать обложку'), 'как сделать обложку');
    assert.equal(lesson.questionText('дай совет по обложке'), 'дай совет по обложке');
    assert.equal(lesson.lessonRoute(lesson.questionText('#борщ в казане')).kind, 'write');
});

test('запрос своего урока не содержит текстов и ссылок клуба', () => {
    const prompt = lesson.lessonPrompt('как сварить борщ в казане', [
        { role: 'user', body: 'Хочу простой рецепт' },
        { role: 'bot', body: 'Начните с мяса и лука.' }
    ]);
    club.LESSONS.forEach(item => {
        assert.equal(prompt.includes(item[0]), false);
        assert.equal(prompt.includes(item[1]), false);
    });
    assert.doesNotMatch(prompt, /@neuroyaga|нейросет/i);
    assert.match(prompt, /борщ/);
    assert.match(prompt, /мяса и лука/);
});

test('ответ очищается от значков и чужих ссылок на уроки', () => {
    const clean = lesson.plain('**Урок**\n• шаг один\nhttps://vk.com/@neuroyaga-sekretny-urok\n😊 готово');
    assert.doesNotMatch(clean, /[*•😊]|@neuroyaga/);
    assert.match(clean, /шаг один/);
    assert.match(clean, /готово/);
});

test('текст новой записи хранит ссылку на прежний закреп', () => {
    const text = lesson.postText('https://vk.com/wall-214554778_15');
    assert.match(text, /Спросите про урок в комментариях/);
    assert.match(text, /https:\/\/vk\.com\/wall-214554778_15/);
    assert.equal(lesson.isClub('214554778'), true);
    assert.equal(lesson.isClub('230706467'), false);
    assert.equal(lesson.isOwnPost(text), true);
});

test('ответы идут в уже закреплённую запись', () => {
    assert.equal(lesson.lessonPostId({}), 16047);
    assert.equal(lesson.lessonPostId({ oldPostId: 16047 }), 16047);
    assert.equal(lesson.lessonPostId({ postId: 20, oldPostId: 16047 }), 20);
    assert.equal(lesson.postUrl('214554778', 16047), 'https://vk.com/wall-214554778_16047');
});

test('из стены берётся только закреплённая запись', () => {
    const pinned = lesson.pinnedItem([
        { id: 4, is_pinned: 0, text: 'свежая' },
        { id: 9, is_pinned: 1, text: 'старая' }
    ]);
    assert.equal(pinned.id, 9);
    assert.equal(lesson.pinnedItem([{ id: 4 }]), null);
});

test('обложка уроков собирается в картинку', async () => {
    const cover = await lesson.paintCover();
    assert.ok(cover.length > 1000);
    assert.equal(cover[0], 0xff);
    assert.equal(cover[1], 0xd8);
});
