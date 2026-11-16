// Один процесс держит опрос Telegram и ВК. Второй контейнер ждёт,
// пока первый отпустит блокировку в Postgres, и не вызывает getUpdates.
const RETRY_MS = 15000;

let chain = null;

function telegramConflict(err) {
    const code = err && err.response && err.response.error_code;
    if (Number(code) === 409) return true;
    return String((err && err.message) || '').includes('409');
}

function hold(tryLock, sleep) {
    if (!chain) chain = wait(tryLock, sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))));
    return chain;
}

async function wait(tryLock, sleep) {
    let attempt = 0;
    let errors = 0;
    for (;;) {
        attempt += 1;
        try {
            if (await tryLock()) return;
            errors = 0;
            console.error(`⚠️ Уже работает другой экземпляр (${attempt}). Повтор через 15 секунд.`);
        } catch (err) {
            errors += 1;
            console.error(`Не удалось проверить, свободен ли бот (${errors}/3): ${err && err.message ? err.message : err}`);
            if (errors >= 3) {
                console.error('Запускаю этот экземпляр без блокировки: база не отвечает.');
                return;
            }
        }
        await sleep(RETRY_MS);
    }
}

function resetForTests() {
    chain = null;
}

module.exports = { hold, telegramConflict, resetForTests, RETRY_MS };
