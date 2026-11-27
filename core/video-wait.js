// Оценка только для видео. Модель процент не присылает, поэтому три состояния по времени ожидания.

const QUEUE_MS = 20000;
const BUILD_MS = 90000;

const LINES = [
    'В очереди.',
    'Собираю ролик. Это занимает несколько минут.',
    'Почти готово.'
];

function line(elapsedMs) {
    const elapsed = Number(elapsedMs) || 0;
    if (elapsed < QUEUE_MS) return LINES[0];
    if (elapsed < BUILD_MS) return LINES[1];
    return LINES[2];
}

function isVideo(model) {
    return !!(model && model.kind === 'video');
}

module.exports = { line, isVideo, LINES, QUEUE_MS, BUILD_MS };
