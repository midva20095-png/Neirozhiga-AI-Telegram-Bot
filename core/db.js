const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

const SEED_TEMPLATES = [
  ['Портрет в неоне', 'image', 'Кинематографичный портрет, неоновый свет, фиолетовый и розовый, высокая детализация', 'nanobanana', 20],
  ['Обложка для поста', 'image', 'Яркая обложка для соцсети, крупный заголовок, стиль НейроЯга, тёмный фон, неон', 'nanobanana_pro', 50],
  ['Короткий сценарий', 'chat', 'Напиши короткий сценарий ролика на 20 секунд по теме, которую я пришлю следом. Сначала спроси тему, если её нет в этом сообщении.', 'flash', 4],
  ['Промпт для видео', 'video', 'Преврати идею в подробный промпт для видео: камера, движение, свет, настроение. Идея: ', 'pro', 15],
  ['Озвучка текста', 'audio', 'Подготовь текст для озвучки: короткие фразы, без скобок и пометок. Текст: ', 'qwen3-tts-flash', 100],
];

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      balance INTEGER DEFAULT 0 NOT NULL,
      current_model TEXT DEFAULT 'flash',
      email TEXT,
      blocked BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      delta INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'chat',
      prompt TEXT NOT NULL,
      model TEXT DEFAULT 'flash',
      cost INTEGER DEFAULT 4,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM templates');
  if (count.rows[0].n === 0) {
    for (const row of SEED_TEMPLATES) {
      await pool.query(
        `INSERT INTO templates (title, category, prompt, model, cost) VALUES ($1,$2,$3,$4,$5)`,
        row
      );
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gigachat_usage (
      user_id BIGINT NOT NULL,
      model TEXT NOT NULL,
      day DATE NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, model, day)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      username TEXT,
      message TEXT NOT NULL,
      answer TEXT,
      status TEXT DEFAULT 'open',
      source TEXT DEFAULT 'bot',
      created_at TIMESTAMP DEFAULT NOW(),
      answered_at TIMESTAMP
    )
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS spent INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gens INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW()`);
  console.log('✅ Таблица users готова (PostgreSQL)');
}

async function getSettings(keys) {
  const res = await pool.query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
  const out = {};
  for (const row of res.rows) out[row.key] = row.value;
  return out;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

async function touchUser(userId, username) {
  const id = String(userId);
  await getUser(id);
  await pool.query(
    'UPDATE users SET last_seen = NOW(), username = COALESCE($2, username) WHERE user_id = $1',
    [id, username || null]
  );
}

async function recordGeneration(userId, cost) {
  await pool.query(
    'UPDATE users SET gens = COALESCE(gens, 0) + 1, spent = COALESCE(spent, 0) + $2 WHERE user_id = $1',
    [String(userId), Math.max(0, Number(cost) || 0)]
  );
}

async function createTicket(userId, username, message, source) {
  const res = await pool.query(
    `INSERT INTO support_tickets (user_id, username, message, source) VALUES ($1,$2,$3,$4) RETURNING *`,
    [String(userId), username || null, String(message).slice(0, 4000), source || 'bot']
  );
  return res.rows[0];
}

async function listTickets(status) {
  const res = status && status !== 'all'
    ? await pool.query('SELECT * FROM support_tickets WHERE status = $1 ORDER BY id DESC LIMIT 200', [status])
    : await pool.query('SELECT * FROM support_tickets ORDER BY id DESC LIMIT 200');
  return res.rows;
}

async function answerTicket(id, answer) {
  const res = await pool.query(
    `UPDATE support_tickets SET answer = $2, status = 'answered', answered_at = NOW() WHERE id = $1 RETURNING *`,
    [id, String(answer).slice(0, 4000)]
  );
  return res.rows[0];
}

async function listUserIds() {
  const res = await pool.query('SELECT user_id FROM users WHERE blocked = false');
  return res.rows.map(r => r.user_id);
}

async function getStats() {
  const q = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users_total,
      (SELECT COUNT(*)::int FROM users WHERE blocked) AS users_blocked,
      (SELECT COUNT(*)::int FROM users WHERE last_seen >= NOW() - INTERVAL '1 day') AS active_day,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '1 day') AS new_day,
      (SELECT COALESCE(SUM(balance),0)::int FROM users) AS balance_total,
      (SELECT COALESCE(SUM(gens),0)::int FROM users) AS gens_total,
      (SELECT COALESCE(SUM(spent),0)::int FROM users) AS spent_total,
      (SELECT COALESCE(SUM(delta),0)::int FROM history WHERE delta > 0) AS credited_total,
      (SELECT COUNT(*)::int FROM support_tickets WHERE status = 'open') AS tickets_open
  `);
  return q.rows[0];
}

async function getUser(userId) {
  const id = String(userId);
  let res = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
  if (res.rows.length === 0) {
    await pool.query(
      'INSERT INTO users (user_id, balance, current_model) VALUES ($1, 0, $2) ON CONFLICT (user_id) DO NOTHING',
      [id, 'flash']
    );
    res = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
  }
  return res.rows[0];
}

async function ensureUser(userId, username) {
  const id = String(userId);
  const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [id]);
  if (res.rows.length > 0) {
    if (username) {
      await pool.query('UPDATE users SET username = $2, last_seen = NOW() WHERE user_id = $1', [id, username]);
    }
    return { user: res.rows[0], isNew: false };
  }
  const ins = await pool.query(
    'INSERT INTO users (user_id, balance, current_model, username) VALUES ($1, 0, $2, $3) ON CONFLICT (user_id) DO NOTHING RETURNING *',
    [id, 'flash', username || null]
  );
  const user = ins.rows[0] || (await pool.query('SELECT * FROM users WHERE user_id = $1', [id])).rows[0];
  return { user, isNew: ins.rows.length > 0 };
}

async function getUserBalance(userId) {
  try {
    const user = await getUser(userId);
    return user ? parseInt(user.balance, 10) : 0;
  } catch (err) {
    console.error('❌ getUserBalance error:', err.message);
    return 0;
  }
}

async function isBlocked(userId) {
  try {
    const user = await getUser(userId);
    return !!(user && user.blocked);
  } catch (err) {
    return false;
  }
}

async function setBlocked(userId, blocked) {
  const id = String(userId);
  await getUser(id);
  await pool.query('UPDATE users SET blocked = $1, updated_at = NOW() WHERE user_id = $2', [!!blocked, id]);
  return !!blocked;
}

async function updateBalance(userId, amount, reason) {
  const id = String(userId);
  try {
    await getUser(id);
    const res = await pool.query(
      `UPDATE users
       SET balance = GREATEST(0, balance + $1), updated_at = NOW()
       WHERE user_id = $2
       RETURNING balance`,
      [amount, id]
    );
    const balance = res.rows[0] ? parseInt(res.rows[0].balance, 10) : null;
    if (balance !== null) {
      await pool.query(
        'INSERT INTO history (user_id, delta, balance, reason) VALUES ($1,$2,$3,$4)',
        [id, amount, balance, reason || (amount >= 0 ? 'Начисление' : 'Списание')]
      );
    }
    return balance;
  } catch (err) {
    console.error('❌ updateBalance error:', err.message);
    return null;
  }
}

async function setCurrentModel(userId, model) {
  const id = String(userId);
  try {
    await getUser(id);
    await pool.query(
      'UPDATE users SET current_model = $1, updated_at = NOW() WHERE user_id = $2',
      [model, id]
    );
    return true;
  } catch (err) {
    console.error('❌ setCurrentModel error:', err.message);
    return false;
  }
}

async function getCurrentModel(userId) {
  try {
    const user = await getUser(userId);
    return user ? user.current_model : 'flash';
  } catch (err) {
    return 'flash';
  }
}

async function listHistory(userId, limit = 40) {
  const res = await pool.query(
    'SELECT id, delta, balance, reason, created_at FROM history WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
    [String(userId), limit]
  );
  return res.rows;
}

async function listTemplates(all = false) {
  const res = all
    ? await pool.query('SELECT * FROM templates ORDER BY id DESC')
    : await pool.query('SELECT * FROM templates WHERE active = true ORDER BY category, id');
  return res.rows;
}

async function saveTemplate(data) {
  if (data.id) {
    const res = await pool.query(
      `UPDATE templates SET title=$1, category=$2, prompt=$3, model=$4, cost=$5, active=$6 WHERE id=$7 RETURNING *`,
      [data.title, data.category || 'chat', data.prompt, data.model || 'flash', data.cost || 0, data.active !== false, data.id]
    );
    return res.rows[0];
  }
  const res = await pool.query(
    `INSERT INTO templates (title, category, prompt, model, cost, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [data.title, data.category || 'chat', data.prompt, data.model || 'flash', data.cost || 0, data.active !== false]
  );
  return res.rows[0];
}

async function deleteTemplate(id) {
  await pool.query('DELETE FROM templates WHERE id = $1', [id]);
}

const GIGA_LIMITS = { 'giga-lite': 30, 'giga-pro': 10, 'giga-max': 5, 'giga-ultra': 5 };

async function checkGigaLimit(userId, model) {
  const limit = GIGA_LIMITS[model] || 10;
  const res = await pool.query(
    `SELECT count FROM gigachat_usage WHERE user_id=$1 AND model=$2 AND day=CURRENT_DATE`,
    [String(userId), model]
  );
  const used = res.rows[0] ? res.rows[0].count : 0;
  return { ok: used < limit, used, limit };
}

async function addGigaUse(userId, model) {
  await pool.query(
    `INSERT INTO gigachat_usage (user_id, model, day, count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (user_id, model, day) DO UPDATE SET count = gigachat_usage.count + 1`,
    [String(userId), model]
  );
}

module.exports = {
  initDB,
  getUser,
  ensureUser,
  getSettings,
  setSetting,
  touchUser,
  recordGeneration,
  createTicket,
  listTickets,
  answerTicket,
  listUserIds,
  getStats,
  getUserBalance,
  updateBalance,
  setCurrentModel,
  getCurrentModel,
  isBlocked,
  setBlocked,
  listHistory,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  checkGigaLimit,
  addGigaUse,
  GIGA_LIMITS,
  pool,
};
