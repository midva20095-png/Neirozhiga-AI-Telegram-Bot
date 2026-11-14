// Баллы активности ВК. Неделя считается по Москве, с понедельника.
// Лайк, комментарий и репост — только на стене сообщества. Запрос — удачная генерация бота.

const POINTS = { like: 3, comment: 6, repost: 10, bot: 1 };

function rulesText() {
    return `Лайк — ${POINTS.like}. Комментарий — ${POINTS.comment}. Репост — ${POINTS.repost}. Запрос боту — ${POINTS.bot}.`;
}
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

function previousWeek(now) {
    const current = weekRange(now);
    return weekRange(new Date(current.start.getTime() - 60 * 60 * 1000));
}

function shouldPublishWeek(now) {
    const date = now instanceof Date ? now : new Date();
    const moscow = new Date(date.getTime() + MOSCOW);
    return moscow.getUTCDay() === 1 && moscow.getUTCHours() >= 9;
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
        const comment = obj.comment || obj;
        const owner = Number(comment.owner_id || comment.post_owner_id || obj.post_owner_id || 0);
        if (owner && group && owner !== group) return null;
        const vkId = person(comment.from_id || obj.from_id);
        const commentId = comment.id || obj.id;
        if (!vkId || !commentId) return null;
        return {
            vkId,
            kind: 'comment',
            objectKey: `comment:${comment.post_id || obj.post_id || 0}:${commentId}`,
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

function readWallComment(update, groupId) {
    if (!update || update.type !== 'wall_reply_new') return null;
    const obj = update.object || {};
    const comment = obj.comment && typeof obj.comment === 'object' ? obj.comment : obj;
    const fromId = Number(comment.from_id || obj.from_id);
    if (!Number.isInteger(fromId) || fromId <= 0) return null;
    const group = communityId(groupId);
    const owner = Number(comment.post_owner_id || comment.owner_id || obj.post_owner_id || obj.owner_id || 0);
    if (owner && group && owner !== group) return null;
    const postId = Number(comment.post_id || obj.post_id);
    const commentId = Number(comment.id || obj.id);
    if (!postId || !commentId) return null;
    return {
        fromId,
        postId,
        commentId,
        text: String(comment.text || obj.text || '').trim()
    };
}

function readWallPost(update, groupId) {
    if (!update || update.type !== 'wall_post_new') return null;
    const obj = update.object || {};
    const post = obj.post && typeof obj.post === 'object' ? obj.post : obj;
    const group = communityId(groupId);
    const owner = Number(post.owner_id || obj.owner_id || 0);
    const fromId = Number(post.from_id || obj.from_id || 0);
    if (group && owner && owner !== group) return null;
    if (fromId && group && fromId !== group) return null;
    const postId = Number(post.id || obj.id || post.post_id);
    if (!postId) return null;
    return { postId, text: String(post.text || '').trim() };
}

function faceOf(user) {
    const id = Number(user && user.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const name = [user.first_name, user.last_name].map(part => String(part || '').trim()).filter(Boolean).join(' ');
    let photo = String(user.photo_200 || user.photo_100 || '').trim();
    if (!/^https:\/\/([a-z0-9-]+\.)?(userapi\.com|vk\.com|vkuser\.net)\//i.test(photo) || /camera_|deactivated|\/images\//i.test(photo)) photo = '';
    return { userId: String(-id), name: name || `ВК ${id}`, photo };
}

function present(row, face) {
    const id = String(row.user_id);
    const num = id.replace(/^-/, '');
    const raw = String(row.username || '').trim();
    const stored = raw && raw !== `vk:${num}` ? raw.replace(/^@/, '') : '';
    const faceName = face && face.name && face.name !== `ВК ${num}` ? String(face.name).trim() : '';
    const photo = face && face.photo ? String(face.photo) : '';
    return {
        userId: id,
        name: faceName || stored || `ВК ${num}`,
        photo,
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
        rulesText(),
        'Лайк, комментарий и репост приводят людей, поэтому баллов больше, чем за запрос боту.',
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

function wallSummary(rows, range) {
    const lines = [
        `Итог недели · ${range.label}`,
        rulesText(),
        'Кредиты по этому списку начисляет администратор.',
        'Новая неделя уже началась, баллы считаются заново.',
        ''
    ];
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
        lines.push('На прошлой неделе баллов не было.');
    } else {
        list.slice(0, 10).forEach((row, index) => {
            lines.push(`${index + 1}. ${row.name} — ${row.points} б. (лайки ${row.likes}, комментарии ${row.comments}, репосты ${row.reposts}, бот ${row.bot})`);
        });
    }
    return lines.join('\n').slice(0, 3500);
}

function freshIds(seen, ids) {
    const next = seen || new Set();
    const first = !seen;
    const fresh = [];
    for (const item of ids || []) {
        const id = Number(item && item.id ? item.id : item);
        if (!Number.isInteger(id) || id <= 0 || next.has(id)) continue;
        next.add(id);
        if (!first) fresh.push(id);
    }
    return { seen: next, fresh };
}

module.exports = {
    POINTS, rulesText, weekRange, previousWeek, shouldPublishWeek,
    parseCommunityActivity, readWallComment, readWallPost,
    faceOf, present, formatRating, wallSummary, freshIds
};
