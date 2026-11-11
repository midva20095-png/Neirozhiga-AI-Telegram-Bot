// Дешёвая картинка ProxyAPI. Размер и качество задаёт только бот.
// Пользователь не выбирает 8K, high и свой формат: иначе цена уходит с ~2 ₽ к десяткам рублей.

const LOCK = { quality: 'low', size: '1024x1024', n: 1 };

function promptTooLong(spec, prompt) {
    return String(prompt || '').length > (spec.maxChars || 600);
}

function buildImageBody(spec, prompt) {
    return {
        model: spec.upstream,
        prompt: String(prompt || ''),
        quality: LOCK.quality,
        size: LOCK.size,
        n: LOCK.n
    };
}

module.exports = { LOCK, promptTooLong, buildImageBody };
