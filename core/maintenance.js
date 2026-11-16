const db = require('./db');

const NOTICE = 'Идёт обновление. Зайдите чуть позже: сейчас вход закрыт.';

function isClosed(saved) {
    return !!(saved && saved.maintenance && saved.maintenance.on);
}

async function isOn() {
    try {
        const saved = await db.getSettings(['maintenance']);
        return isClosed(saved);
    } catch (error) {
        return false;
    }
}

async function setOn(on) {
    const next = !!on;
    await db.setSetting('maintenance', { on: next });
    return next;
}

module.exports = { NOTICE, isClosed, isOn, setOn };
