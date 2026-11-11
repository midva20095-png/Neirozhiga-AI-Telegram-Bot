const USER_CODES = new Set([
    'blocked', 'no_model', 'no_plugin', 'need_image', 'no_image', 'need_audio',
    'need_text', 'limit', 'no_credits', 'busy', 'image'
]);
const QUIET_ERROR = 'Не получилось. Кредиты не списаны. Попробуйте ещё раз.';

// Подсказки вроде «прикрепите фото» можно показать. Текст ответа модели и сервиса — нет.
function userMessage(error) {
    const code = error && error.code;
    const message = error && typeof error.message === 'string' ? error.message.trim() : '';
    if (USER_CODES.has(code) && message && !/[A-Za-z{\[\]<>]|https?:/.test(message)) {
        return message;
    }
    return QUIET_ERROR;
}

module.exports = { userMessage, QUIET_ERROR };
