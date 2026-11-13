const test = require('node:test');
const assert = require('node:assert/strict');
const { userMessage, QUIET_ERROR } = require('./user_message');

test('пользователь не видит текст ошибки сервиса', () => {
    assert.equal(userMessage(new Error('Ошибка API: статус 403 Model not allowed')), QUIET_ERROR);
    assert.equal(userMessage(new Error('BRATUKHA_API_KEY не задан в переменных окружения')), QUIET_ERROR);
    assert.equal(userMessage({ code: 'need_image', message: 'Error: 400 INVALID_ARGUMENT' }), QUIET_ERROR);
    assert.equal(
        userMessage({ code: 'need_image', message: 'Для этой модели нужно прикрепить изображение' }),
        'Для этой модели нужно прикрепить изображение'
    );
    assert.match(userMessage({ code: 'no_credits', message: 'Недостаточно кредитов. На балансе 1, нужно 6. Пополните баланс.' }), /Недостаточно кредитов/);
    assert.equal(userMessage(null), QUIET_ERROR);
});
