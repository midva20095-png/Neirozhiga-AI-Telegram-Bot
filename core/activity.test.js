const test = require('node:test');
const assert = require('node:assert/strict');
const activity = require('./activity');

const GROUP = '230706467';

test('неделя начинается в понедельник по Москве', () => {
    const monday = activity.weekRange(new Date('2026-11-08T21:00:00.000Z'));
    assert.equal(monday.start.toISOString(), '2026-11-08T21:00:00.000Z');
    assert.equal(monday.end.toISOString(), '2026-11-15T21:00:00.000Z');
    const sunday = activity.weekRange(new Date('2026-11-08T20:59:00.000Z'));
    assert.equal(sunday.start.toISOString(), '2026-11-01T21:00:00.000Z');
    assert.match(monday.label, /ноября/);
});

test('лайк, комментарий и репост считаются только на стене сообщества', () => {
    const like = activity.parseCommunityActivity({
        type: 'like_add',
        object: { liker_id: 5, object_type: 'post', object_owner_id: -230706467, object_id: 9 }
    }, GROUP);
    assert.deepEqual(like, { vkId: 5, kind: 'like', objectKey: 'post:9', remove: false });
    assert.equal(activity.parseCommunityActivity({
        type: 'like_add',
        object: { liker_id: 5, object_owner_id: -1, object_id: 9 }
    }, GROUP), null);
    assert.equal(activity.parseCommunityActivity({
        type: 'like_add',
        object: { liker_id: -230706467, object_owner_id: -230706467, object_id: 9 }
    }, GROUP), null);
    const gone = activity.parseCommunityActivity({
        type: 'like_remove',
        object: { liker_id: 5, object_owner_id: -230706467, post_id: 9 }
    }, GROUP);
    assert.equal(gone.remove, true);
    assert.equal(gone.objectKey, 'post:9');
    const comment = activity.parseCommunityActivity({
        type: 'wall_reply_new',
        object: { from_id: 7, id: 3, post_id: 9, owner_id: -230706467 }
    }, GROUP);
    assert.deepEqual(comment, { vkId: 7, kind: 'comment', objectKey: 'comment:9:3', remove: false });
    assert.equal(activity.parseCommunityActivity({
        type: 'wall_reply_delete',
        object: { from_id: -4, id: 3, owner_id: -230706467 }
    }, GROUP), null);
    const repost = activity.parseCommunityActivity({
        type: 'wall_repost',
        object: { from_id: 8, copy_history: [{ owner_id: -230706467, id: 9 }] }
    }, GROUP);
    assert.deepEqual(repost, { vkId: 8, kind: 'repost', objectKey: 'repost:9:8', remove: false });
    assert.equal(activity.parseCommunityActivity({
        type: 'wall_repost',
        object: { from_id: 8, copy_history: [{ owner_id: -1, id: 9 }] }
    }, GROUP), null);
    assert.equal(activity.parseCommunityActivity({ type: 'message_new', object: {} }, GROUP), null);
});

test('рейтинг показывает место и правила без служебных адресов', () => {
    const rows = [
        activity.present({ user_id: '-5', username: 'Аня', points: 8, likes: 1, comments: 1, reposts: 0, bot: 1 }),
        activity.present({ user_id: '-8', username: 'vk:8', points: 3, likes: 0, comments: 0, reposts: 1, bot: 0 })
    ];
    const text = activity.formatRating(rows, '-8', activity.weekRange(new Date('2026-11-14T12:00:00Z')));
    assert.match(text, /1\. Аня — 8 б\./);
    assert.match(text, /Ваши баллы: 3\. Место: 2\./);
    assert.match(text, /Лайк — 1 балл/);
    assert.doesNotMatch(text, /https?:|vk\.com|error/i);
    const empty = activity.formatRating([], '-5', activity.weekRange(new Date('2026-11-14T12:00:00Z')));
    assert.match(empty, /пока тихо/);
    assert.match(empty, /Вас пока нет/);
});
