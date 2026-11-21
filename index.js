require('dotenv').config();
const { startBot } = require('./core/bot');
const { startWebApp } = require('./ui_modules/webapp_server');

console.log('🚀 Запуск системы...');

let app = null;

try {
    app = startWebApp(); // 👈 Сохраняем запущенный сервер
} catch (e) {
    console.error('⚠️ Ошибка запуска WebApp:', e.message);
}

try {
    startBot(app); // 👈 Передаём сервер в бота
} catch (e) {
    console.error('⚠️ Ошибка запуска ядра бота:', e.message);
}

try {
    require('./core/vk').startVk();
} catch (e) {
    console.error('⚠️ ВК не запущен:', e.message);
}

const assistant = require('./core/assistant');
function restoreAssistant() {
    assistant.replayKnown().then(result => {
        if (result && result.ok) console.log(`Помощник доната восстановлен, команд: ${result.sent}`);
    }).catch(error => {
        console.error('Помощник доната не восстановлен:', error && error.message ? error.message : 'ошибка');
    });
}
setTimeout(restoreAssistant, 8000);
const assistantTimer = setInterval(restoreAssistant, 60 * 1000);
if (assistantTimer.unref) assistantTimer.unref();