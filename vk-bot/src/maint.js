const MINUTES = 30;
let until = 0;
let alertedAt = 0;

const TEXT = 'Сейчас идёт обновление приложения и чат-бота. Попробуйте, пожалуйста, через час. Деньги не списаны.';

function on() {
  return until > Date.now();
}

function note(code, text, alert) {
  const body = typeof text === 'string' ? text : JSON.stringify(text || '');
  if (/"id"\s*:/.test(body) && Number(code) < 400) return;
  if (Number(code) === 402 || /insufficient|not.?enough|недостаточно средств|нет средств|payment required|funds/i.test(body)) {
    until = Date.now() + MINUTES * 60000;
    if (Date.now() - alertedAt > 3600000) {
      alertedAt = Date.now();
      if (alert) alert(body.slice(0, 200));
    }
  }
}

module.exports = { on, note, TEXT };
