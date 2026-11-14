const { Pool } = require('pg');
const worksLib = require('./works');

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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mail_ok BOOLEAN DEFAULT false`);
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
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS image TEXT`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS hide_prompt BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS formats TEXT`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS sort INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS quality TEXT`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS duration INTEGER`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS audience TEXT DEFAULT 'all'`);
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_pulls (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      email TEXT NOT NULL,
      credits INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS works (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT,
      prompt TEXT,
      mime TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS works_user_id_idx ON works (user_id, id DESC)`);
  await pool.query(`ALTER TABLE works ADD COLUMN IF NOT EXISTS template_id INTEGER`);
  await pool.query(`ALTER TABLE works ADD COLUMN IF NOT EXISTS shared_at TIMESTAMP`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_pushes (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      email TEXT NOT NULL,
      credits INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_activity (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      kind TEXT NOT NULL,
      object_key TEXT NOT NULL,
      points INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, kind, object_key)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS vk_activity_week_idx ON vk_activity (created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_profiles (
      user_id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      photo TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('✅ Таблица users готова (PostgreSQL)');
}

async function note(kind, message) {
  const line = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!line) return;
  console.log(`[${kind}] ${line}`);
  try {
    await pool.query('INSERT INTO journal (kind, message) VALUES ($1, $2)', [String(kind || 'sys').slice(0, 20), line]);
    await pool.query('DELETE FROM journal WHERE id NOT IN (SELECT id FROM journal ORDER BY id DESC LIMIT 200)');
  } catch (e) {}
}

async function listJournal(limit) {
  const n = Math.min(200, Math.max(1, Number(limit) || 80));
  const res = await pool.query(
    'SELECT id, kind, message, created_at FROM journal ORDER BY id DESC LIMIT $1',
    [n]
  );
  return res.rows;
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

async function listTickets(status, platform) {
  const params = [];
  const parts = [];
  if (status && status !== 'all') {
    params.push(status);
    parts.push(`status = $${params.length}`);
  }
  if (platform === 'vk') parts.push('user_id < 0');
  if (platform === 'tg') parts.push('user_id > 0');
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const res = await pool.query(`SELECT * FROM support_tickets ${where} ORDER BY id DESC LIMIT 200`, params);
  return res.rows;
}

async function answerTicket(id, answer) {
  const res = await pool.query(
    `UPDATE support_tickets SET answer = $2, status = 'answered', answered_at = NOW() WHERE id = $1 RETURNING *`,
    [id, String(answer).slice(0, 4000)]
  );
  return res.rows[0];
}

async function recordActivity(userId, kind, objectKey, points) {
  const key = String(objectKey || '').slice(0, 160);
  if (!key) return false;
  const res = await pool.query(
    `INSERT INTO vk_activity (user_id, kind, object_key, points)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, kind, object_key) DO NOTHING
     RETURNING id`,
    [String(userId), String(kind), key, Math.max(0, Math.round(Number(points) || 0))]
  );
  return res.rows.length > 0;
}

async function removeActivity(userId, kind, objectKey) {
  await pool.query(
    'DELETE FROM vk_activity WHERE user_id = $1 AND kind = $2 AND object_key = $3',
    [String(userId), String(kind), String(objectKey || '').slice(0, 160)]
  );
}

async function listVkProfiles(userIds) {
  const ids = [...new Set((userIds || []).map(id => String(id)).filter(Boolean))];
  if (!ids.length) return [];
  const res = await pool.query(
    'SELECT user_id, name, photo, updated_at FROM vk_profiles WHERE user_id = ANY($1::bigint[])',
    [ids]
  );
  return res.rows;
}

async function saveVkProfiles(rows) {
  const list = (rows || []).filter(row => row && row.userId && row.name);
  for (const row of list) {
    await pool.query(
      `INSERT INTO vk_profiles (user_id, name, photo, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo, updated_at = NOW()`,
      [String(row.userId), String(row.name).slice(0, 80), String(row.photo || '').slice(0, 300)]
    );
  }
}

async function listWeekActivity(since) {
  const res = await pool.query(
    `SELECT a.user_id,
            COALESCE(u.username, '') AS username,
            SUM(a.points)::int AS points,
            COUNT(*) FILTER (WHERE a.kind = 'like')::int AS likes,
            COUNT(*) FILTER (WHERE a.kind = 'comment')::int AS comments,
            COUNT(*) FILTER (WHERE a.kind = 'repost')::int AS reposts,
            COUNT(*) FILTER (WHERE a.kind = 'bot')::int AS bot
     FROM vk_activity a
     LEFT JOIN users u ON u.user_id = a.user_id
     WHERE a.created_at >= $1
     GROUP BY a.user_id, u.username
     ORDER BY points DESC, a.user_id
     LIMIT 50`,
    [since]
  );
  return res.rows;
}

async function setMail(userId, on) {
  await pool.query('UPDATE users SET mail_ok = $2, updated_at = NOW() WHERE user_id = $1', [String(userId), !!on]);
}

async function listUserIds(platform, opts) {
  const gate = platform === 'vk' ? 'AND user_id < 0' : platform === 'tg' ? 'AND user_id > 0' : '';
  const mail = opts && opts.mail ? 'AND mail_ok = true' : '';
  const res = await pool.query(`SELECT user_id FROM users WHERE blocked = false ${gate} ${mail}`);
  return res.rows.map(r => r.user_id);
}

async function getStats(platform) {
  const where = platform === 'vk' ? 'user_id < 0' : platform === 'tg' ? 'user_id > 0' : 'TRUE';
  const q = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE ${where}) AS users_total,
      (SELECT COUNT(*)::int FROM users WHERE blocked AND ${where}) AS users_blocked,
      (SELECT COUNT(*)::int FROM users WHERE last_seen >= NOW() - INTERVAL '1 day' AND ${where}) AS active_day,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '1 day' AND ${where}) AS new_day,
      (SELECT COALESCE(SUM(balance),0)::int FROM users WHERE ${where}) AS balance_total,
      (SELECT COALESCE(SUM(gens),0)::int FROM users WHERE ${where}) AS gens_total,
      (SELECT COALESCE(SUM(spent),0)::int FROM users WHERE ${where}) AS spent_total,
      (SELECT COALESCE(SUM(delta),0)::int FROM history WHERE delta > 0 AND ${where}) AS credited_total,
      (SELECT COUNT(*)::int FROM support_tickets WHERE status = 'open' ${platform === 'vk' ? 'AND user_id < 0' : platform === 'tg' ? 'AND user_id > 0' : ''}) AS tickets_open
  `);
  return q.rows[0];
}

async function findUser(userId) {
  const res = await pool.query('SELECT user_id, blocked, balance FROM users WHERE user_id = $1', [String(userId)]);
  return res.rows[0] || null;
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

async function debitBalance(userId, amount, reason) {
  const id = String(userId);
  const amt = Math.round(Number(amount));
  if (!(amt > 0)) return { ok: false, error: 'amount' };
  try {
    await getUser(id);
    const res = await pool.query(
      `UPDATE users
       SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2 AND balance >= $1
       RETURNING balance`,
      [amt, id]
    );
    if (!res.rows[0]) return { ok: false, error: 'balance' };
    const balance = parseInt(res.rows[0].balance, 10);
    await pool.query(
      'INSERT INTO history (user_id, delta, balance, reason) VALUES ($1,$2,$3,$4)',
      [id, -amt, balance, reason || 'Списание']
    );
    return { ok: true, balance };
  } catch (err) {
    console.error('❌ debitBalance error:', err.message);
    return { ok: false, error: 'balance' };
  }
}

async function findTelegramUser(raw) {
  const text = String(raw || '').trim();
  if (/^\d{5,20}$/.test(text)) {
    const res = await pool.query('SELECT user_id, blocked FROM users WHERE user_id = $1', [text]);
    return res.rows[0] || null;
  }
  const name = text.replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9_]{4,32}$/.test(name)) return null;
  const res = await pool.query(
    `SELECT user_id, blocked FROM users
     WHERE lower(username) = $1 OR lower(username) = $2
     LIMIT 2`,
    ['@' + name, name]
  );
  if (res.rows.length > 1) return { ambiguous: true };
  return res.rows[0] || null;
}

async function creditIncoming({ id, userId, email, credits }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO site_pushes (id, user_id, email, credits)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, String(userId), email, credits]
    );
    if (!ins.rows.length) {
      const bal = await client.query('SELECT balance FROM users WHERE user_id = $1', [String(userId)]);
      await client.query('COMMIT');
      return { ok: true, duplicate: true, balance: bal.rows[0] ? parseInt(bal.rows[0].balance, 10) : 0 };
    }
    const res = await client.query(
      `UPDATE users
       SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2 AND blocked = false
       RETURNING balance`,
      [credits, String(userId)]
    );
    if (!res.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Аккаунт в боте не найден или заблокирован' };
    }
    const balance = parseInt(res.rows[0].balance, 10);
    await client.query(
      'INSERT INTO history (user_id, delta, balance, reason) VALUES ($1,$2,$3,$4)',
      [String(userId), credits, balance, `Перенос с сайта · ${email}`]
    );
    await client.query('COMMIT');
    return { ok: true, balance };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('❌ creditIncoming:', err.message);
    return { ok: false, error: 'Не удалось начислить кредиты в бот' };
  } finally {
    client.release();
  }
}

async function insertSitePull({ id, userId, email, credits }) {
  const res = await pool.query(
    `INSERT INTO site_pulls (id, user_id, email, credits, status)
     VALUES ($1,$2,$3,$4,'pending')
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [id, String(userId), email, credits]
  );
  return { ok: res.rows.length > 0 };
}

async function listPendingPulls(userId) {
  const where = `status IN ('pending', 'refunding')`;
  if (userId) {
    const res = await pool.query(
      `SELECT id, user_id, email, credits, status, created_at
       FROM site_pulls WHERE ${where} AND user_id = $1
       ORDER BY created_at`,
      [String(userId)]
    );
    return res.rows;
  }
  const res = await pool.query(
    `SELECT id, user_id, email, credits, status, created_at
     FROM site_pulls WHERE ${where}
     ORDER BY created_at LIMIT 50`
  );
  return res.rows;
}

async function markSitePull(id, status, fromStatus = 'pending') {
  const res = await pool.query(
    `UPDATE site_pulls SET status = $2 WHERE id = $1 AND status = $3`,
    [id, status, fromStatus]
  );
  return res.rowCount > 0;
}

// Начисляет сумму один раз: повтор того же id не увеличивает баланс.
async function creditSitePull({ id, userId, credits, email }) {
  try {
    await getUser(userId);
  } catch (err) {
    console.error('❌ creditSitePull user:', err.message);
    return { ok: false };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `UPDATE site_pulls SET status = 'credited' WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id]
    );
    if (!lock.rows.length) {
      const cur = await client.query('SELECT status FROM site_pulls WHERE id = $1', [id]);
      const status = cur.rows[0] ? cur.rows[0].status : '';
      let balance = 0;
      if (status === 'credited') {
        const bal = await client.query('SELECT balance FROM users WHERE user_id = $1', [String(userId)]);
        balance = bal.rows[0] ? parseInt(bal.rows[0].balance, 10) : 0;
      }
      await client.query('COMMIT');
      if (status === 'credited') return { ok: true, already: true, balance };
      return { ok: false, status };
    }
    const res = await client.query(
      `UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 RETURNING balance`,
      [credits, String(userId)]
    );
    if (!res.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'user' };
    }
    const balance = parseInt(res.rows[0].balance, 10);
    await client.query(
      'INSERT INTO history (user_id, delta, balance, reason) VALUES ($1,$2,$3,$4)',
      [String(userId), credits, balance, `Перенос с сайта · ${email}`]
    );
    await client.query('COMMIT');
    return { ok: true, balance };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('❌ creditSitePull:', err.message);
    return { ok: false };
  } finally {
    client.release();
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

async function saveWork(userId, input) {
  const row = worksLib.prepareWork(input);
  if (!row) return null;
  const templateId = numericId(input && input.templateId);
  const ins = await pool.query(
    `INSERT INTO works (user_id, kind, model, prompt, mime, bytes, template_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [String(userId), row.kind, row.model || null, row.prompt || null, row.mime, row.buffer, templateId]
  );
  await pool.query(
    `DELETE FROM works WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM works WHERE user_id = $1 ORDER BY id DESC LIMIT $2
     )`,
    [String(userId), worksLib.KEEP]
  );
  return ins.rows[0].id;
}

async function listWorks(userId, limit = 30) {
  const cap = Math.min(worksLib.KEEP, Math.max(1, Number(limit) || 30));
  const res = await pool.query(
    `SELECT id, kind, model, prompt, template_id, shared_at, created_at
     FROM works WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [String(userId), cap]
  );
  return res.rows;
}

async function getWork(userId, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const res = await pool.query(
    'SELECT id, kind, model, prompt, mime, bytes, template_id, shared_at FROM works WHERE id = $1 AND user_id = $2',
    [n, String(userId)]
  );
  return res.rows[0] || null;
}

function numericId(id) {
  const n = String(id || '').replace(/^local:/, '');
  return /^\d+$/.test(n) ? Number(n) : null;
}

async function recentShare(userId) {
  const res = await pool.query(
    `SELECT shared_at FROM works
     WHERE user_id = $1 AND shared_at > NOW() - INTERVAL '10 minutes'
     ORDER BY shared_at DESC LIMIT 1`,
    [String(userId)]
  );
  return res.rows[0] || null;
}

async function claimShare(userId, id) {
  const n = numericId(id);
  if (!n) return false;
  const res = await pool.query(
    `UPDATE works SET shared_at = NOW()
     WHERE id = $1 AND user_id = $2 AND shared_at IS NULL
     RETURNING id`,
    [n, String(userId)]
  );
  return !!res.rows.length;
}

async function releaseShare(userId, id) {
  const n = numericId(id);
  if (!n) return;
  await pool.query(
    'UPDATE works SET shared_at = NULL WHERE id = $1 AND user_id = $2',
    [n, String(userId)]
  );
}

async function listHistory(userId, limit = 40) {
  const res = await pool.query(
    'SELECT id, delta, balance, reason, created_at FROM history WHERE user_id = $1 ORDER BY id DESC LIMIT $2',
    [String(userId), limit]
  );
  return res.rows;
}

function audienceSql(audience, params) {
  if (audience === 'vk') return `(audience = 'vk' OR audience = 'all' OR audience IS NULL)`;
  if (audience === 'tg') return `(audience = 'tg' OR audience = 'all' OR audience IS NULL)`;
  if (audience === 'vk-only') return `audience = 'vk'`;
  return '';
}

async function listTemplates(all = false, audience) {
  const parts = [];
  if (!all) parts.push('active = true');
  const gate = audienceSql(audience);
  if (gate) parts.push(gate);
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const order = all ? 'sort ASC, id DESC' : 'sort ASC, id ASC';
  const res = await pool.query(`SELECT * FROM templates ${where} ORDER BY ${order}`);
  return res.rows;
}

function cleanTemplateImage(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (s.startsWith('data:image/')) {
    if (s.length > 1500000) {
      const err = new Error('Фото-пример слишком большое. Загрузите картинку поменьше.');
      err.code = 'image';
      throw err;
    }
    return s;
  }
  return s.slice(0, 2000);
}

async function saveTemplate(data) {
  const values = [
    String(data.title || '').trim().slice(0, 120),
    data.category || 'image',
    String(data.prompt || '').trim(),
    data.model || 'nanobanana',
    Math.max(0, Math.round(Number(data.cost) || 0)),
    data.active !== false,
    cleanTemplateImage(data.image),
    data.description ? String(data.description).trim().slice(0, 500) : null,
    true,
    data.formats ? String(data.formats).trim().slice(0, 200) : null,
    Number.isFinite(Number(data.sort)) ? Math.round(Number(data.sort)) : 0,
    String(data.quality || '').trim().slice(0, 40) || null,
    Number(data.duration) > 0 ? Math.round(Number(data.duration)) : null,
    ['tg', 'vk', 'all'].includes(data.audience) ? data.audience : 'all'
  ];
  if (data.id) {
    const res = await pool.query(
      `UPDATE templates
       SET title=$1, category=$2, prompt=$3, model=$4, cost=$5, active=$6,
           image=$7, description=$8, hide_prompt=$9, formats=$10, sort=$11,
           quality=$12, duration=$13, audience=$14
       WHERE id=$15 RETURNING *`,
      [...values, data.id]
    );
    return res.rows[0];
  }
  const res = await pool.query(
    `INSERT INTO templates (title, category, prompt, model, cost, active, image, description, hide_prompt, formats, sort, quality, duration, audience)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    values
  );
  return res.rows[0];
}

async function deleteTemplate(id) {
  await pool.query('DELETE FROM templates WHERE id = $1', [id]);
}

const DAY_MSK = `(NOW() AT TIME ZONE 'Europe/Moscow')::date`;

// limit === null — без дневного потолка. Иначе число, включая 0.
async function peekGiga(userId, model, limit) {
  if (limit === null || limit === undefined || limit === '') return { ok: true, unlimited: true, used: 0, limit: null };
  const cap = Math.max(0, Math.round(Number(limit)));
  if (!Number.isFinite(cap)) return { ok: true, unlimited: true, used: 0, limit: null };
  if (cap === 0) return { ok: false, used: 0, limit: 0 };
  const res = await pool.query(
    `SELECT count FROM gigachat_usage WHERE user_id=$1 AND model=$2 AND day=${DAY_MSK}`,
    [String(userId), model]
  );
  const used = res.rows[0] ? Number(res.rows[0].count) : 0;
  return { ok: used < cap, used, limit: cap };
}

// Атомарно занимает слот. При гонке второй запрос не проходит, если потолок уже взят.
async function consumeGiga(userId, model, limit) {
  const before = await peekGiga(userId, model, limit);
  if (before.unlimited || !before.ok) return before;
  const res = await pool.query(
    `INSERT INTO gigachat_usage (user_id, model, day, count)
     VALUES ($1, $2, ${DAY_MSK}, 1)
     ON CONFLICT (user_id, model, day)
     DO UPDATE SET count = gigachat_usage.count + 1
     WHERE gigachat_usage.count < $3
     RETURNING count`,
    [String(userId), model, before.limit]
  );
  if (!res.rows.length) {
    const again = await peekGiga(userId, model, before.limit);
    return { ok: false, used: again.used, limit: before.limit };
  }
  return { ok: true, used: Number(res.rows[0].count), limit: before.limit };
}

async function releaseGiga(userId, model) {
  await pool.query(
    `UPDATE gigachat_usage SET count = GREATEST(0, count - 1)
     WHERE user_id=$1 AND model=$2 AND day=${DAY_MSK} AND count > 0`,
    [String(userId), model]
  );
}

module.exports = {
  initDB,
  getUser,
  ensureUser,
  getSettings,
  setSetting,
  note,
  listJournal,
  touchUser,
  recordGeneration,
  createTicket,
  listTickets,
  answerTicket,
  recordActivity,
  removeActivity,
  listVkProfiles,
  saveVkProfiles,
  listWeekActivity,
  setMail,
  listUserIds,
  getStats,
  findUser,
  getUserBalance,
  updateBalance,
  debitBalance,
  findTelegramUser,
  creditIncoming,
  insertSitePull,
  listPendingPulls,
  markSitePull,
  creditSitePull,
  setCurrentModel,
  getCurrentModel,
  isBlocked,
  setBlocked,
  saveWork,
  listWorks,
  getWork,
  recentShare,
  claimShare,
  releaseShare,
  listHistory,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  peekGiga,
  consumeGiga,
  releaseGiga,
  pool,
};
