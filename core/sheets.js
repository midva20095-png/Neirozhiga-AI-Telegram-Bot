require('dotenv').config();
const axios = require('axios');

/**
 * Получить баланс пользователя из Google Таблицы через Google Apps Script
 */
async function getBalanceFromSheets(userId) {
    try {
        if (!process.env.GOOGLE_SCRIPT_URL) {
            console.error("❌ Не задан GOOGLE_SCRIPT_URL в .env");
            return 0;
        }
        const response = await axios.get(`${process.env.GOOGLE_SCRIPT_URL}?action=get&userId=${userId}`);
        return response.data && response.data.balance !== undefined ? parseInt(response.data.balance) : 0;
    } catch (error) {
        console.error("❌ Ошибка чтения баланса из Google Sheets:", error.message);
        return 0;
    }
}

/**
 * Изменить баланс пользователя (положительное или отрицательное значение amount)
 */
async function changeBalanceInSheets(userId, amount) {
    try {
        if (!process.env.GOOGLE_SCRIPT_URL) {
            console.error("❌ Не задан GOOGLE_SCRIPT_URL в .env");
            return false;
        }
        const response = await axios.post(process.env.GOOGLE_SCRIPT_URL, {
            action: 'update',
            userId: userId,
            amount: amount
        });
        return response.data && response.data.balance !== undefined;
    } catch (error) {
        console.error("❌ Ошибка обновления баланса в Google Sheets:", error.message);
        return false;
    }
}

module.exports = {
    getBalanceFromSheets,
    changeBalanceInSheets
};