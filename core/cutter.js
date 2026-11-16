// Резак карусели: одно фото режется на равные вертикальные кадры.
// Списание одно на фото. Смена числа кадров того же фото ничего не стоит.

const CUT_COST = 10;

function stripLayout(width, height, count) {
    const n = Math.max(2, Math.min(10, Number(count) || 3));
    const slice = Math.max(1, Math.floor((Number(width) || 1) / n));
    const tall = Math.max(1, Math.floor(Number(height) || 1));
    const strips = [];
    for (let i = 0; i < n; i++) strips.push({ x: i * slice, width: slice, height: tall });
    return strips;
}

function cutQuote(balance) {
    const have = Number(balance);
    const shown = Number.isFinite(have) ? have : 0;
    if (shown < CUT_COST) {
        return { ok: false, error: 'Недостаточно кредитов. На балансе ' + shown + ', нужно ' + CUT_COST + '.' };
    }
    return { ok: true, cost: CUT_COST };
}

module.exports = { CUT_COST, stripLayout, cutQuote };
