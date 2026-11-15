const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const club = require('./vk-club');

const CLUB_ID = '214554778';
const PIN_POST_ID = 16047;
const OPENING = 'Спросите про урок в комментариях.';

function isClub(groupId) {
    return String(groupId || '').replace(/\D/g, '') === CLUB_ID;
}

function pinKey(groupId) {
    return `vk_lesson_pin_${String(groupId || CLUB_ID).replace(/\D/g, '')}`;
}

function postUrl(groupId, postId) {
    return `https://vk.com/wall-${String(groupId).replace(/\D/g, '')}_${postId}`;
}

function postText(oldUrl) {
    const lines = [
        OPENING,
        '',
        'Бот коротко отвечает на вопрос.',
        'В конце ответа есть ссылка на уроки клуба.',
        '',
        'Кредиты за это не списываются.'
    ];
    if (oldUrl) lines.push('', 'Прежняя запись сообщества:', String(oldUrl));
    return lines.join('\n');
}

function isOwnPost(text) {
    return String(text || '').trim().startsWith(OPENING);
}

function pinnedItem(items) {
    const list = Array.isArray(items) ? items : [];
    return list.find(item => Number(item && item.is_pinned) === 1) || null;
}

function lessonPostId(saved) {
    const current = Number(saved && saved.postId) || 0;
    if (current) return current;
    const known = Number(saved && saved.oldPostId) || 0;
    return known || PIN_POST_ID;
}

function questionText(text) {
    const raw = String(text || '').trim();
    const mark = raw.match(/^[＃#]+\s*([\s\S]*)$/);
    return (mark ? mark[1] : raw).trim();
}

const LESSON_LINKS = [
    'Уроки клуба:',
    'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po',
    'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa'
].join('\n');

function lessonRoute(text) {
    const raw = String(text || '').trim();
    if (!raw || club.isThanks(raw) || isOwnPost(raw) || raw.startsWith('Навигация по урокам')) return { kind: 'skip' };
    if (raw.startsWith('Сейчас не получилось разобрать') || raw.startsWith('Уроки клуба:')) return { kind: 'skip' };
    const letters = (raw.match(/[a-zа-я0-9]/gi) || []).length;
    if (letters < 2) return { kind: 'skip' };
    return { kind: 'write' };
}

function withLessons(text) {
    const body = String(text || '').trim();
    const room = 1500 - LESSON_LINKS.length - 2;
    return `${body.slice(0, Math.max(room, 0))}\n\n${LESSON_LINKS}`.trim();
}

function lessonPrompt(question, memory) {
    const past = (Array.isArray(memory) ? memory : []).map(item => {
        const who = item && item.role === 'bot' ? 'Бот' : 'Человек';
        return `${who}: ${String(item && item.body || item && item.text || '').trim()}`;
    }).filter(line => line.length > 3).join('\n');
    return [
        'Пиши по-русски, коротко и простыми фразами, как ответ в комментарии сообщества.',
        'Без звёздочек, решёток, списков, скобок и значков.',
        'Не вставляй ссылки. Не упоминай чужие статьи и чужие уроки.',
        'Отвечай именно на заданный вопрос и не подменяй его другой темой.',
        'Дай свой короткий разбор: от четырёх до семи предложений.',
        past ? `Прошлая переписка:\n${past}` : '',
        `Вопрос: ${String(question || '').trim()}`
    ].filter(Boolean).join('\n\n');
}

function plain(text) {
    let value = String(text || '');
    value = value.replace(/```[\s\S]*?```/g, ' ');
    value = value.replace(/https?:\/\/vk\.(?:com|ru)\/@neuroyaga-\S+/gi, '');
    value = value.replace(/https?:\/\/vk\.(?:com|ru)\/neuroyaga\S*/gi, '');
    value = value.replace(/[`*_#>~|[\]\\]/g, '');
    value = value.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');
    value = value.replace(/^\s*[•\-–—]\s+/gm, '');
    value = value.replace(/как (?:языковая модель|нейросеть|искусственный интеллект)[^.!\n]*/gi, '');
    value = value.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return value.slice(0, 1400);
}

function fallbackText() {
    return `Сейчас не получилось разобрать тему. Напишите вопрос ещё раз или в личные сообщения: ${club.ASK_URL}`;
}

function coverSvg() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14081f"/>
      <stop offset="0.55" stop-color="#5a2d86"/>
      <stop offset="1" stop-color="#c43b78"/>
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="30%" r="45%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>
  <circle cx="180" cy="140" r="90" fill="#ffffff" fill-opacity="0.06"/>
  <circle cx="1080" cy="560" r="140" fill="#ffffff" fill-opacity="0.07"/>
  <text x="80" y="300" font-family="DejaVu Sans, sans-serif" font-size="78" font-weight="700" fill="#ffffff">Уроки клуба</text>
  <text x="80" y="390" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="36" fill="#f6e9ff">Напишите вопрос в комментариях</text>
  <text x="80" y="620" font-family="DejaVu Sans, sans-serif" font-size="28" fill="#ffffff" fill-opacity="0.85">НейроЯга</text>
</svg>`;
}

async function paintCover() {
    try {
        return await fs.promises.readFile(path.join(__dirname, '../public/lesson-cover.jpg'));
    } catch (error) {
        return sharp(Buffer.from(coverSvg())).jpeg({ quality: 88 }).toBuffer();
    }
}

module.exports = {
    CLUB_ID, PIN_POST_ID, OPENING, isClub, pinKey, postUrl, postText, isOwnPost, pinnedItem, lessonPostId, questionText, lessonRoute, withLessons, lessonPrompt, plain, fallbackText, paintCover
};
