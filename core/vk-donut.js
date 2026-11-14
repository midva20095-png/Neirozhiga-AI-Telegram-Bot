const club = require('./vk-club');

const QUESTIONS = [
    { ask: 'Умеете создавать сообщество ВК?', title: 'Создание сообщества', lessons: [10] },
    { ask: 'Умеете оформлять обложки и аватарки?', title: 'Обложки и аватарки', lessons: [0, 1, 11] },
    { ask: 'Умеете оформлять товары и карточки?', title: 'Товары и карточки', lessons: [3, 12, 13] },
    { ask: 'Умеете делать меню и виджеты?', title: 'Меню и виджеты', lessons: [2, 14] },
    { ask: 'Умеете чистить фото, менять фон и текст?', title: 'Фото: фон и текст', lessons: [4] },
    { ask: 'Умеете оживлять фото?', title: 'Оживление фото', lessons: [5] },
    { ask: 'Умеете писать промпты для фото и обложек?', title: 'Промпты', lessons: [6] },
    { ask: 'Умеете собирать прайс?', title: 'Прайс', lessons: [7] },
    { ask: 'Умеете делать клипы?', title: 'Клипы', lessons: [8, 9, 19] },
    { ask: 'Умеете сделать сайт-визитку из сообщества?', title: 'Сайт-визитка', lessons: [15] },
    { ask: 'Умеете вести контент и понимать алгоритмы ВК?', title: 'Контент и алгоритмы', lessons: [16] },
    { ask: 'Умеете проводить игры и конкурсы?', title: 'Игры и конкурсы', lessons: [17] },
    { ask: 'Умеете настраивать ботов и рассылки?', title: 'Боты и рассылки', lessons: [18] },
    { ask: 'Умеете маркировку, таргет и маркет-платформу?', title: 'Маркировка и таргет', lessons: [20] },
    { ask: 'Умеете оформлять в SUPA?', title: 'Оформление в SUPA', lessons: [21] }
];

function welcomeText() {
    return [
        'Подписка VK Донат оформлена. Кредиты за опрос не списываются.',
        '',
        club.lessonNote(),
        '',
        'Дальше короткие вопросы по урокам клуба. «Да» — уже умеете. «Нет» — пришлю уроки по этой теме.'
    ].join('\n');
}

function prompt(step) {
    const item = QUESTIONS[step];
    if (!item) return '';
    return `${step + 1} из ${QUESTIONS.length}. ${item.ask}`;
}

function parseAnswer(text, payload) {
    if (payload && payload.a === 'survey') {
        if (String(payload.y) === '1') return 'yes';
        if (String(payload.y) === '0') return 'no';
    }
    const value = String(text || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[!?.]+$/g, '');
    if (/^(да|умею|yes)$/.test(value)) return 'yes';
    if (/^(нет|не умею|неумею|no)$/.test(value)) return 'no';
    return null;
}

function lessonsFor(steps) {
    const seen = new Set();
    const out = [];
    (Array.isArray(steps) ? steps : []).forEach(step => {
        const item = QUESTIONS[step];
        if (!item) return;
        item.lessons.forEach(index => {
            if (seen.has(index)) return;
            const lesson = clubLessons()[index];
            if (!lesson) return;
            seen.add(index);
            out.push({ title: item.title, name: lesson[0], url: lesson[1] });
        });
    });
    return out;
}

function clubLessons() {
    return club.LESSONS || [];
}

function resultText(steps) {
    const lessons = lessonsFor(steps);
    if (!lessons.length) {
        return 'Вы отметили, что эти темы уже умеете. Ссылки навигации остаются в сообщении выше. Кредиты не списаны.';
    }
    const blocks = [];
    let title = '';
    lessons.forEach(lesson => {
        if (lesson.title !== title) {
            title = lesson.title;
            blocks.push(title);
        }
        blocks.push(`• ${lesson.name}\n${lesson.url}`);
    });
    return `Уроки по темам, где вы ответили «нет»:\n\n${blocks.join('\n')}\n\nКредиты не списаны.`;
}

const DONUT_KINDS = {
    donut_subscription_create: 'create',
    donut_subscription_prolonged: 'prolong',
    donut_subscription_cancelled: 'cancel',
    donut_subscription_expired: 'expire'
};

function readDonutEvent(update) {
    const kind = DONUT_KINDS[update && update.type];
    if (!kind) return null;
    const obj = update.object || {};
    const userId = Number(obj.user_id || obj.userId || obj.from_id);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    const amount = Number(obj.amount);
    return { userId, kind, amount: Number.isFinite(amount) ? Math.round(amount) : 0 };
}

function readSubscription(update) {
    const hit = readDonutEvent(update);
    if (!hit || hit.kind !== 'create') return null;
    return { userId: hit.userId };
}

module.exports = { QUESTIONS, welcomeText, prompt, parseAnswer, lessonsFor, resultText, readSubscription, readDonutEvent };
