const vk = require('./vk');
const db = require('./db');
const { chatPrompt } = require('./generate');

function commandOf(text, payload) {
  const raw = payload && (payload.cmd || payload.command || payload.a);
  const value = String(raw || text || '').trim().toLowerCase();
  if (['начать', 'start', '/start', 'меню', 'в меню', 'menu'].includes(value)) return 'menu';
  if (value === 'баланс') return 'balance';
  if (value.includes('пополнить')) return 'topup';
  return '';
}

async function onMessage(message) {
  const userId = String(message.from_id || '');
  if (!/^\d+$/.test(userId)) return;
  let payload = null;
  try { payload = message.payload ? JSON.parse(message.payload) : null; } catch (e) { payload = null; }
  const text = String(message.text || '').trim();
  const command = commandOf(text, payload);
  if (command === 'menu') {
    const balance = await db.balance(userId);
    await vk.sendText(userId, `ЯгаГенератор\nБаланс: ${balance} ₽\n\nОткройте приложение сообщества: выберите шаблон, загрузите фото, результат придёт в этот чат.\nИли напишите своими словами, что нарисовать. Сообщение из чата рисуется моделью «стандарт».`, vk.menuKeyboard());
    return;
  }
  if (command === 'balance') {
    const balance = await db.balance(userId);
    await vk.sendText(userId, `Ваш баланс: ${balance} ₽`, vk.menuKeyboard());
    return;
  }
  if (command === 'topup') {
    const link = process.env.PAY_LINK || 'https://vk.me/club236645486';
    await vk.sendText(userId, `Пополнение приходит в этот чат после оплаты.\nЕсли кнопка оплаты ещё на старом сценарии, напишите сумму сообщением в диалоге оплаты.\n${link}`, vk.menuKeyboard());
    return;
  }
  const photos = vk.photoUrls(message);
  if (text.length >= 3 || photos.length) {
    const result = await chatPrompt(userId, text, photos);
    if (!result.ok) await vk.sendText(userId, result.error, vk.menuKeyboard());
  }
}

async function loop() {
  const groupId = process.env.VK_GROUP_ID;
  if (!process.env.VK_GROUP_TOKEN || !groupId) {
    console.log('Long Poll ВК не запущен: нет VK_GROUP_TOKEN или VK_GROUP_ID');
    return;
  }
  let server = await vk.call('groups.getLongPollServer', { group_id: groupId });
  if (server.error) {
    console.error('Long Poll:', JSON.stringify(server.error));
    return;
  }
  let { key, server: url, ts } = server.response;
  console.log('Long Poll ВК подключён');
  for (;;) {
    try {
      const response = await fetch(`${url}?act=a_check&key=${encodeURIComponent(key)}&ts=${encodeURIComponent(ts)}&wait=25`);
      const data = await response.json();
      if (data.failed) {
        server = await vk.call('groups.getLongPollServer', { group_id: groupId });
        if (server.response) { key = server.response.key; url = server.response.server; ts = server.response.ts; }
        continue;
      }
      ts = data.ts;
      for (const update of data.updates || []) {
        if (update.type !== 'message_new') continue;
        const message = update.object && (update.object.message || update.object);
        if (!message || message.out) continue;
        try { await onMessage(message); }
        catch (error) { console.error('Сообщение ВК:', error.message); }
      }
    } catch (error) {
      console.error('Long Poll:', error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

function start() {
  loop().catch(error => console.error(error));
}

module.exports = { start, commandOf };
