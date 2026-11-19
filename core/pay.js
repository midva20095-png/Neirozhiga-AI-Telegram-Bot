function acceptedPayment(payment) {
    if (!payment || payment.status !== 'succeeded' || payment.paid !== true) return null;
    const id = String(payment.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const amount = Number(payment.amount && payment.amount.value);
    if (!(amount > 0)) return null;
    const meta = payment.metadata || {};
    const userId = String(meta.userId || '');
    const credits = parseInt(meta.credits, 10);
    if (!/^-?\d{1,18}$/.test(userId) || userId === '0' || userId === '-0') return null;
    if (!Number.isInteger(credits) || credits < 1 || credits > 100000) return null;
    return { id, userId, credits };
}

module.exports = { acceptedPayment };
