// Сохранённые результаты генерации для кабинета. В базу попадает только готовый файл,
// не исходное фото пользователя. Слишком большой файл не сохраняем: ответ пользователю при этом остаётся.

const KEEP = 30;
const LIMITS = {
    image: 8 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 8 * 1024 * 1024
};

function sniffMime(kind, buffer) {
    if (buffer.length >= 12 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
    if (kind === 'audio') return 'audio/mpeg';
    if (kind === 'video') return 'video/mp4';
    return 'image/png';
}

function prepareWork(input) {
    const src = input || {};
    const kind = String(src.kind || '');
    const buffer = src.buffer;
    const max = LIMITS[kind];
    if (!max || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > max) return null;
    return {
        kind,
        model: String(src.model || '').trim().slice(0, 80),
        prompt: String(src.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 280),
        mime: sniffMime(kind, buffer),
        buffer
    };
}

module.exports = { KEEP, LIMITS, sniffMime, prepareWork };
