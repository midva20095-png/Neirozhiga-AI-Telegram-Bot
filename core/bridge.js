// Перенос кредитов между Telegram и ВК. Списывает только у того, кто запросил перенос.

function vkAccount(raw) {
    const text = String(raw || '').trim();
    const fromLink = text.match(/vk\.(?:com|ru)\/id(\d+)/i);
    const digits = fromLink ? fromLink[1] : text.replace(/^id/i, '').replace(/\D/g, '');
    if (!/^\d{1,12}$/.test(digits)) return null;
    const n = Number(digits);
    if (!Number.isInteger(n) || n <= 0) return null;
    return -n;
}

function amountOf(raw) {
    const n = Math.round(Number(String(raw || '').replace(/\s/g, '')));
    if (!Number.isInteger(n) || n <= 0 || n > 1000000) return null;
    return n;
}

async function moveCredits(db, { fromId, toId, amount, takeReason, giveReason }) {
    const dest = await db.findUser(toId);
    if (!dest) return { ok: false, error: 'Такого аккаунта ещё нет. Пусть человек сначала откроет своего бота и нажмёт «Начать».' };
    if (dest.blocked) return { ok: false, error: 'Этот аккаунт закрыт.' };
    const debit = await db.debitBalance(fromId, amount, takeReason);
    if (!debit.ok) {
        return { ok: false, error: debit.error === 'balance' ? 'Недостаточно кредитов.' : 'Сумма не подошла.' };
    }
    const credited = await db.updateBalance(toId, amount, giveReason);
    if (credited === null) {
        await db.updateBalance(fromId, amount, 'Возврат переноса');
        return { ok: false, error: 'Перенос не завершился. Кредиты остались на месте.' };
    }
    return { ok: true, balance: debit.balance, destBalance: credited };
}

module.exports = { vkAccount, amountOf, moveCredits };
