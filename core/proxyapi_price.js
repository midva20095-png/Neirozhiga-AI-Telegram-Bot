// Фиксированная цена запроса в ProxyAPI до отправки.
// Запас: 4500 входных токенов и не больше maxOut выходных.
// Кредиты = эта сумма в рублях × 3, округление вверх, минимум 1.
// 1 кредит пользователя = 1 ₽, поэтому тройка закрывает расход и небольшой перерасход токенов.

const INPUT_TOKENS = 4500;
const OUTPUT_TOKENS = 1200;

function cappedQuote(inPerMillion, outPerMillion, outputTokens = OUTPUT_TOKENS) {
    const rub = (INPUT_TOKENS * Number(inPerMillion) + outputTokens * Number(outPerMillion)) / 1e6;
    const apiRub = Math.ceil(rub * 1000) / 1000;
    const credits = Math.max(1, Math.ceil(rub * 3 - 1e-9));
    return { apiRub, credits, maxOut: outputTokens, maxChars: 3500 };
}

function promptTooLong(spec, prompt) {
    return String(prompt || '').length > (spec.maxChars || 3500);
}

function buildChatBody(spec, prompt) {
    const maxOut = spec.maxOut || OUTPUT_TOKENS;
    return {
        model: spec.upstream,
        max_completion_tokens: maxOut,
        messages: [
            { role: 'system', content: 'Отвечай на языке пользователя, коротко и по делу. Не вызывай инструменты и не ищи в интернете.' },
            { role: 'user', content: String(prompt || '') }
        ]
    };
}

module.exports = { INPUT_TOKENS, OUTPUT_TOKENS, cappedQuote, promptTooLong, buildChatBody };
