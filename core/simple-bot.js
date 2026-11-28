const GOODS_LIMIT = 40;

function shopCommunity(reply) {
  return !!(reply && reply.level === 1 && reply.home !== true);
}

function shopPack(input) {
  if (!input || (input.level !== 1 && input.level !== '1')) return {};
  return {
    level: 1,
    shopCatalog: on(input.shopCatalog),
    shopContacts: on(input.shopContacts),
    shopOrder: on(input.shopOrder),
    shopAdmin: on(input.shopAdmin),
    goods: cleanGoods(input.goods),
  };
}

function shopFields(previous, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  if (body.level === 0 || body.level === '0') return { level: 0 };
  if (body.level === 1 || body.level === '1') return shopPack(body);
  const reply = previous && previous.reply;
  if (!reply || reply.level !== 1) return {};
  return shopPack(reply);
}

function cleanGoods(value) {
  if (!Array.isArray(value)) return [];
  const goods = [];
  const seen = new Set();
  for (const item of value) {
    const row = cleanGood(item);
    if (!row) continue;
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    goods.push(row);
    if (goods.length >= GOODS_LIMIT) break;
  }
  return goods;
}

function parseSheet(text, groupId) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  if (/<offer\b/i.test(source)) return parseOffers(source, groupId);
  const goods = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^https:\/\//i.test(line) && /назван|name/i.test(line) && /ссыл|url/i.test(line)) continue;
    const row = cleanGood(partsOf(line));
    if (!row) {
      skipped += 1;
      continue;
    }
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    goods.push(row);
    if (goods.length >= GOODS_LIMIT) break;
  }
  return { goods, skipped };
}

function planShop(update, community, turn) {
  const reply = community && community.reply;
  if (!shopCommunity(reply)) return null;
  if (!update || update.type !== 'message_new') return null;
  const peerId = speaker(update);
  if (peerId === null) return null;
  const text = spoken(update).trim();
  const state = {
    mode: turn && turn.mode ? String(turn.mode) : '',
    product: turn && turn.product ? String(turn.product) : '',
  };
  const goods = cleanGoods(reply.goods);
  if (isStart(update, text) || isGreeting(text) || text === 'К помощнику') {
    return say(peerId, welcome(reply), menuKeyboard(reply), { mode: '', product: '' });
  }
  if (state.mode === 'admin') return { silent: true, peerId, turn: state };
  if (text === 'В меню') {
    return say(peerId, welcome(reply), menuKeyboard(reply), { mode: '', product: '' });
  }
  if (text === 'Каталог' && reply.shopCatalog) {
    return say(peerId, catalogText(goods), catalogKeyboard(goods, reply), { mode: '', product: '' });
  }
  if (text === 'Контакты' && reply.shopContacts) {
    const body = String(reply.contacts || '').trim();
    return say(peerId, body || 'Контакты ещё не заполнены.', menuKeyboard(reply), { mode: '', product: '' });
  }
  if (text === 'Заявка' && reply.shopOrder) {
    if (!goods.length) {
      return say(peerId, 'Список товаров ещё пуст.', menuKeyboard(reply), { mode: '', product: '' });
    }
    return say(
      peerId,
      `${catalogText(goods)}\nНапишите номер или название, затем телефон.`,
      catalogKeyboard(goods, reply),
      { mode: 'pick', product: '' },
    );
  }
  if (text === 'Администратор' && reply.shopAdmin) {
    return say(
      peerId,
      'Передал администратору. Он ответит в этом чате. Пока он на связи, бот молчит. Меню вернёт кнопка «К помощнику».',
      adminKeyboard(),
      { mode: 'admin', product: '' },
      notice(community, peerId, 'Клиент ждёт ответа в сообщениях сообщества.'),
    );
  }
  if (state.mode === 'phone') {
    const phone = phoneOf(text);
    if (!phone) {
      return say(peerId, 'Нужен телефон, чтобы с вами связались.', menuKeyboard(reply), state);
    }
    const item = goods.find((good) => good.name === state.product);
    const title = item ? item.name : state.product;
    const price = item ? priceLabel(item.price) : '';
    return say(
      peerId,
      'Заявка передана.',
      menuKeyboard(reply),
      { mode: '', product: '' },
      notice(community, peerId, `Заявка: ${title}${price ? `, ${price}` : ''}. Телефон: ${phone}.`),
    );
  }
  if (state.mode === 'pick') {
    const item = findGood(goods, text);
    if (!item) {
      return say(peerId, 'В списке нет такого товара. Напишите номер или название.', catalogKeyboard(goods, reply), state);
    }
    return say(peerId, `${goodText(item)}\n\nНапишите телефон.`, menuKeyboard(reply), { mode: 'phone', product: item.name });
  }
  if (reply.shopCatalog) {
    const item = findGood(goods, text);
    if (item) return say(peerId, goodText(item), menuKeyboard(reply), { mode: '', product: '' });
  }
  return say(peerId, 'Выберите кнопку или номер из списка.', menuKeyboard(reply), { mode: '', product: '' });
}

function createShopBook(pool) {
  const rows = new Map();

  function key(groupId, peerId) {
    return `${groupId}:${peerId}`;
  }

  async function load() {
    if (!pool) return;
    const result = await pool.query('SELECT group_id, peer_id, mode, product FROM don_shop_turn');
    for (const row of result.rows || []) {
      rows.set(key(row.group_id, row.peer_id), { mode: row.mode || '', product: row.product || '' });
    }
  }

  function get(groupId, peerId) {
    return rows.get(key(groupId, peerId)) || { mode: '', product: '' };
  }

  async function put(groupId, peerId, turn) {
    const mode = turn && turn.mode ? String(turn.mode).slice(0, 20) : '';
    const product = turn && turn.product ? String(turn.product).slice(0, 80) : '';
    const id = key(groupId, peerId);
    if (!mode) rows.delete(id);
    else rows.set(id, { mode, product });
    if (!pool) return;
    try {
      if (!mode) {
        await pool.query('DELETE FROM don_shop_turn WHERE group_id = $1 AND peer_id = $2', [groupId, peerId]);
        return;
      }
      await pool.query(
        `INSERT INTO don_shop_turn (group_id, peer_id, mode, product)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, peer_id) DO UPDATE SET mode = EXCLUDED.mode, product = EXCLUDED.product`,
        [groupId, peerId, mode, product],
      );
    } catch {
      console.error(`Сообщество ${groupId}: шаг заявки не записался`);
    }
  }

  return { load, get, put };
}

function say(peerId, message, keyboard, turn, notify = null) {
  return {
    kind: 'message',
    peerId,
    message: String(message || '').slice(0, 3900),
    keyboard,
    notify,
    turn,
  };
}

function welcome(reply) {
  const enabled = reply.shopCatalog || reply.shopContacts || reply.shopOrder || reply.shopAdmin;
  if (!enabled) return 'Здравствуйте. Кнопки включаются в кабинете сообщества.';
  return 'Здравствуйте. Выберите кнопку ниже.';
}

function menuKeyboard(reply) {
  const labels = [];
  if (reply.shopCatalog) labels.push('Каталог');
  if (reply.shopContacts) labels.push('Контакты');
  if (reply.shopOrder) labels.push('Заявка');
  if (reply.shopAdmin) labels.push('Администратор');
  return keyboard(labels);
}

function catalogKeyboard(goods, reply) {
  if (!buttonCatalog(goods)) return menuKeyboard(reply || {});
  const rows = goods.map((item) => [key(item.name)]);
  rows.push([key('В меню', 'primary')]);
  return JSON.stringify({ one_time: false, inline: false, buttons: rows });
}

function adminKeyboard() {
  return keyboard(['К помощнику']);
}

function keyboard(labels) {
  if (!labels.length) return '';
  const rows = [];
  for (let index = 0; index < labels.length; index += 2) {
    const row = [key(labels[index])];
    if (labels[index + 1]) row.push(key(labels[index + 1]));
    rows.push(row);
  }
  return JSON.stringify({ one_time: false, inline: false, buttons: rows });
}

function key(label, color = 'secondary') {
  const text = String(label).slice(0, 40);
  return {
    action: { type: 'text', label: text, payload: JSON.stringify({ b: text }) },
    color,
  };
}

function buttonCatalog(goods) {
  return goods.length > 0 && goods.length <= 6 && goods.every((item) => item.name.length <= 40);
}

function catalogText(goods) {
  if (!goods.length) return 'Список товаров ещё пуст.';
  const lines = goods.map((item, index) => {
    const price = priceLabel(item.price);
    return `${index + 1}. ${item.name}${price ? ` — ${price}` : ''}`;
  });
  const tail = buttonCatalog(goods) ? 'Выберите товар.' : 'Напишите номер или название.';
  return `${lines.join('\n')}\n\n${tail}`;
}

function goodText(item) {
  return [item.name, priceLabel(item.price), item.link].filter(Boolean).join('\n');
}

function findGood(goods, text) {
  const raw = String(text || '').trim();
  if (/^\d{1,2}$/.test(raw)) {
    const index = Number(raw) - 1;
    return goods[index] || null;
  }
  const lower = raw.toLowerCase();
  return goods.find((item) => item.name.toLowerCase() === lower) || null;
}

function priceLabel(price) {
  const text = String(price || '').trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) return `${text} ₽`;
  return text;
}

function phoneOf(text) {
  const digits = String(text || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 40);
}

function notice(community, peerId, message) {
  const ownerId = Number(community.ownerUserId ?? community.userId);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0 || ownerId === peerId) return null;
  return { peerId: ownerId, message: `${message} Клиент: https://vk.com/gim${community.groupId}?sel=${peerId}` };
}

function speaker(update) {
  const note = messageOf(update);
  if (!note || note.out === 1 || note.out === true) return null;
  const fromId = asId(note.from_id);
  const peerId = asId(note.peer_id);
  if (fromId === null || peerId === null || fromId !== peerId) return null;
  return fromId;
}

function spoken(update) {
  const note = messageOf(update);
  return note && typeof note.text === 'string' ? note.text : '';
}

function messageOf(update) {
  const object = update && update.object;
  const note = object && object.message ? object.message : object;
  return note && typeof note === 'object' ? note : null;
}

function isStart(update, text) {
  const note = messageOf(update);
  let payload = note && note.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }
  if (payload && payload.command === 'start') return true;
  return /^(?:начать|start|\/start)[.!?\s]*$/i.test(text);
}

function isGreeting(text) {
  return /^(?:привет|здравствуйте|добрый\s+(?:день|вечер|утро)|hello|hi)[.!?\s]*$/i.test(text);
}

function asId(value) {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function on(value) {
  return value === true || value === 'true';
}

function cleanGood(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || item.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const link = https(item.link || item.url);
  if (name.length < 2 || !link) return null;
  return { name, price: cleanPrice(item.price), link };
}

function cleanPrice(value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!text) return '';
  const numeric = text.replace(/\s/g, '').replace(',', '.').replace(/₽|руб\.?/gi, '');
  if (/^\d{1,7}(?:\.0+)?$/.test(numeric)) return String(Number(numeric));
  return text;
}

function https(value) {
  const link = String(value || '').trim();
  if (!link || link.length > 300 || /\s/.test(link)) return '';
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function partsOf(line) {
  let parts;
  if (line.includes('\t')) parts = line.split('\t');
  else if (line.includes('|')) parts = line.split('|');
  else if (line.includes(';')) parts = line.split(';');
  else parts = line.split(/\s+[—–]\s+/);
  const bits = parts.map((part) => part.trim()).filter(Boolean);
  const link = bits.find((part) => /^https:\/\//i.test(part)) || '';
  const rest = bits.filter((part) => part !== link);
  const price = rest.find((part) => /^[\d\s]{1,12}(?:₽|руб\.?)?$/i.test(part)) || '';
  const name = rest.filter((part) => part !== price).join(' ');
  return { name, price, link };
}

function parseOffers(text, groupId) {
  const goods = [];
  const seen = new Set();
  let skipped = 0;
  const blocks = text.match(/<offer\b[\s\S]*?<\/offer>/gi) || [];
  for (const block of blocks) {
    const id = /<offer\b[^>]*\bid=["'](\d+)["']/i.exec(block);
    const link = tag(block, 'url') || (id && positiveGroup(groupId) ? `https://vk.com/product-${Number(groupId)}_${id[1]}` : '');
    const row = cleanGood({ name: tag(block, 'name') || tag(block, 'model'), price: tag(block, 'price'), link });
    if (!row) {
      skipped += 1;
      continue;
    }
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    goods.push(row);
    if (goods.length >= GOODS_LIMIT) break;
  }
  return { goods, skipped };
}

function tag(block, name) {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!match) return '';
  return decode(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/\s+/g, ' ').trim();
}

function decode(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function positiveGroup(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

module.exports = { shopPack, cleanGoods, parseSheet };
