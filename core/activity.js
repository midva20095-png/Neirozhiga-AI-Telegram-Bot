// Баллы активности ВК. Неделя считается по Москве, с понедельника.
// Лайк, комментарий и репост — только на стене сообщества. Запрос — удачная генерация бота.

const POINTS = { like: 1, comment: 2, repost: 3, bot: 5 };
const MOSCOW = 3 * 60 * 60 * 1000;

function weekRange(now) {
    const date = now instanceof Date ? now : new Date();
    const moscow = new Date(date.getTime() + MOSCOW);
    const weekday = moscow.getUTCDay();
    const back = (weekday + 6) % 7;
    const startUtc = Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), moscow.getUTCDate() - back) - MOSCOW;
    const start = new Date(startUtc);
    const end = new Date(startUtc + 7 * 24 * 60 * 60 * 1000);
    const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' });
    const last = new Date(end.getTime() - 1);
    return { start, end, label: `${fmt.format(start)} — ${fmt.format(last)}` };
}

function communityId(groupId) {
    const n = Math.abs(Number(String(groupId || '').replace(/\D/g, '')));
    return n ? -n : 0;
}

function person(id) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? n : 0;
}

function parseCommunityActivity(update, groupId) {
    if (!update || !update.type) return null;
    const group = communityId(groupId);
    const obj = update.object || {};
    if (update.type === 'like_add' || update.type === 'like_remove') {
        const owner = Number(obj.object_owner_id);
        if (!group || owner !== group) return null;
        const vkId = person(obj.liker_id);
        const objectId = obj.object_id || obj.post_id;
        if (!vkId || !objectId) return null;
        return {
            vkId,
            kind: 'like',
            objectKey: `${obj.object_type || 'post'}:${objectId}`,
            remove: update.type === 'like_remove'
        };
    }
    if (update.type === 'wall_reply_new' || update.type === 'wall_reply_delete' || update.type === 'wall_reply_restore') {
        const owner = Number(obj.owner_id || obj.post_owner_id || 0);
        if (owner && group && owner !== group) return null;
        const vkId = person(obj.from_id);
        if (!vkId || !obj.id) return null;
        return {
            vkId,
            kind: 'comment',
            objectKey: `comment:${obj.post_id || 0}:${obj.id}`,
            remove: update.type === 'wall_reply_delete'
        };
    }
    if (update.type === 'wall_repost') {
        const vkId = person(obj.from_id);
        if (!vkId) return null;
        const copy = Array.isArray(obj.copy_history) ? obj.copy_history[0] : null;
        if (copy && group && Number(copy.owner_id) !== group) return null;
        const postId = copy ? copy.id : (obj.id || 0);
        return { vkId, kind: 'repost', objectKey: `repost:${postId}:${vkId}`, remove: false };
    }
    return null;
}

function present(row) {
    const id = String(row.user_id);
    const num = id.replace(/^-/, '');
    const raw = String(row.username || '').trim();
    const name = raw && raw !== `vk:${num}` ? raw.replace(/^@/, '') : `ВК ${num}`;
    return {
        userId: id,
        name,
        points: Number(row.points) || 0,
        likes: Number(row.likes) || 0,
        comments: Number(row.comments) || 0,
        reposts: Number(row.reposts) || 0,
        bot: Number(row.bot) || 0
    };
}

function formatRating(rows, meId, range) {
    const lines = [
        `Рейтинг · ${range.label}`,
        'Лайк — 1 балл. Комментарий — 2. Репост — 3. Запрос боту — 5.',
        'В понедельник баллы начинаются заново. Кредиты по этому списку начисляет администратор.',
        ''
    ];
    if (!rows.length) {
        lines.push('На этой неделе пока тихо. Лайкайте записи сообщества, комментируйте, делайте репосты и пишите боту.');
    } else {
        rows.slice(0, 10).forEach((row, index) => {
            lines.push(`${index + 1}. ${row.name} — ${row.points} б.`);
            lines.push(`лайки ${row.likes} · комментарии ${row.comments} · репосты ${row.reposts} · бот ${row.bot}`);
        });
    }
    const place = rows.findIndex(row => String(row.userId) === String(meId));
    lines.push('');
    lines.push(place >= 0
        ? `Ваши баллы: ${rows[place].points}. Место: ${place + 1}.`
        : 'Вас пока нет в списке этой недели.');
    return lines.join('\n').slice(0, 3500);
}

module.exports = { POINTS, weekRange, parseCommunityActivity, present, formatRating };
