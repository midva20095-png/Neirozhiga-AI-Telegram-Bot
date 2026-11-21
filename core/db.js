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
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS fields TEXT`);
  await pool.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS topics TEXT`);
  await pool.query(`ALTER TABLE templates ALTER COLUMN topics TYPE TEXT`);
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vk_group BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vk_mode TEXT`);
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
  await pool.query(`ALTER TABLE vk_activity ADD COLUMN IF NOT EXISTS group_id BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE vk_activity DROP CONSTRAINT IF EXISTS vk_activity_user_id_kind_object_key_key`);
  await pool.query(`
    DO $$
    DECLARE cname text;
    BEGIN
      FOR cname IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'vk_activity'::regclass AND contype = 'u'
          AND pg_get_constraintdef(oid) NOT LIKE '%group_id%'
      LOOP
        EXECUTE format('ALTER TABLE vk_activity DROP CONSTRAINT %I', cname);
      END LOOP;
    END $$;
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS vk_activity_event_idx ON vk_activity (user_id, kind, object_key, group_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS vk_activity_week_idx ON vk_activity (created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_member (
      user_id BIGINT NOT NULL,
      group_id BIGINT NOT NULL,
      seen_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, group_id)
    )
  `);
  await pool.query(`
    INSERT INTO vk_member (user_id, group_id)
    SELECT DISTINCT user_id, group_id FROM vk_activity
    WHERE group_id <> 0 AND kind IN ('like', 'comment', 'repost')
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO vk_member (user_id, group_id)
    SELECT u.user_id, u.vk_group FROM users u
    WHERE u.vk_group <> 0
      AND NOT EXISTS (
        SELECT 1 FROM vk_activity a
        WHERE a.user_id = u.user_id AND a.group_id <> 0 AND a.group_id <> u.vk_group
          AND a.kind IN ('like', 'comment', 'repost')
      )
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_profiles (
      user_id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      photo TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_donut_survey (
      user_id BIGINT NOT NULL,
      group_id BIGINT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0,
      gaps JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, group_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_donut_log (
      id SERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS vk_donut_log_group_idx ON vk_donut_log (group_id, id DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_assistant_don (
      user_id BIGINT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_assistant_community (
      group_id BIGINT PRIMARY KEY,
      owner_id BIGINT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT '',
      sync_error TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS vk_assistant_community_owner_idx ON vk_assistant_community (owner_id)`);
  await pool.query(`ALTER TABLE vk_assistant_community ADD COLUMN IF NOT EXISTS reply JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_assistant_setup (
      user_id BIGINT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_lesson_memory (
      id SERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      post_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS vk_lesson_memory_idx ON vk_lesson_memory (group_id, post_id, user_id, id DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_bonus (
      user_id BIGINT NOT NULL,
      group_id BIGINT NOT NULL,
      month DATE NOT NULL,
      points INTEGER NOT NULL,
      spent INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, group_id, month)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_honor (
      group_id BIGINT NOT NULL,
      month DATE NOT NULL,
      place INTEGER NOT NULL,
      user_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      points INTEGER NOT NULL,
      PRIMARY KEY (group_id, month, place)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_shop_item (
      id SERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT -1,
      photo TEXT NOT NULL DEFAULT '',
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_shop_order (
      id SERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      item_id INTEGER,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      bonuses INTEGER NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      takes JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS vk_shop_order_group_idx ON vk_shop_order (group_id, id DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_promo (
      id SERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      owner_id BIGINT,
      package_id TEXT NOT NULL DEFAULT '',
      percent INTEGER NOT NULL DEFAULT 15,
      uses_left INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'admin',
      shop_price INTEGER NOT NULL DEFAULT 0,
      shop_stock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS vk_promo_shop_owner ON vk_promo (owner_id) WHERE source = 'shop' AND owner_id IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vk_promo_grant (
      code_id INTEGER NOT NULL,
      user_id BIGINT NOT NULL,
      PRIMARY KEY (code_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yookassa_payment (
      payment_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credits INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('✅ Таблица users готова (PostgreSQL)');
}

function surveyGaps(value) {
  if (Array.isArray(value)) return value.map(Number).filter(item => Number.isInteger(item) && item >= 0);
  if (typeof value === 'string') {
    try { return surveyGaps(JSON.parse(value)); } catch (e) { return []; }
  }
  return [];
}

async function getDonutSurvey(userId, groupId) {
  const res = await pool.query(
    'SELECT step, gaps FROM vk_donut_survey WHERE user_id = $1 AND group_id = $2',
    [String(userId), String(groupId)]
  );
  const row = res.rows[0];
  if (!row) return null;
  return { step: Number(row.step) || 0, gaps: surveyGaps(row.gaps) };
}

async function saveDonutSurvey(userId, groupId, step, gaps) {
  await pool.query(
    `INSERT INTO vk_donut_survey (user_id, group_id, step, gaps, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (user_id, group_id)
     DO UPDATE SET step = $3, gaps = $4::jsonb, updated_at = NOW()`,
    [String(userId), String(groupId), Math.max(0, Number(step) || 0), JSON.stringify(surveyGaps(gaps))]
  );
}

async function setVkMode(userId, mode) {
  const next = mode === 'audit' || mode === 'club' ? mode : null;
  await pool.query('UPDATE users SET vk_mode = $2, updated_at = NOW() WHERE user_id = $1', [String(userId), next]);
}

async function getVkMode(userId) {
  const res = await pool.query('SELECT vk_mode FROM users WHERE user_id = $1', [String(userId)]);
  const mode = res.rows[0] && res.rows[0].vk_mode;
  return mode === 'audit' || mode === 'club' ? mode : '';
}

async function clearDonutSurvey(userId, groupId) {
  await pool.query(
    'DELETE FROM vk_donut_survey WHERE user_id = $1 AND group_id = $2',
    [String(userId), String(groupId)]
  );
}

async function recordDonut(groupId, userId, kind, amount) {
  const allowed = new Set(['create', 'prolong', 'cancel', 'expire']);
  const eventKind = allowed.has(kind) ? kind : '';
  const id = String(groupId || '').replace(/\D/g, '');
  const person = Number(userId);
  if (!eventKind || !id || !Number.isInteger(person) || person <= 0) return false;
  const recent = await pool.query(
    `SELECT id FROM vk_donut_log
     WHERE group_id = $1 AND user_id = $2 AND kind = $3 AND created_at > NOW() - INTERVAL '2 minutes'
     LIMIT 1`,
    [id, person, eventKind]
  );
  if (recent.rows.length) return false;
  await pool.query(
    'INSERT INTO vk_donut_log (group_id, user_id, kind, amount) VALUES ($1, $2, $3, $4)',
    [id, person, eventKind, Math.max(0, Math.round(Number(amount) || 0))]
  );
  return true;
}

function assistantPerson(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return 0;
  return id;
}

async function getAssistantDon(userId) {
  const id = assistantPerson(userId);
  if (!id) return null;
  const res = await pool.query(
    'SELECT user_id, name, active, updated_at FROM vk_assistant_don WHERE user_id = $1',
    [id]
  );
  return res.rows[0] || null;
}

async function listAssistantDons() {
  const res = await pool.query(
    'SELECT user_id, name, active, updated_at FROM vk_assistant_don ORDER BY active DESC, updated_at DESC'
  );
  return res.rows;
}

async function upsertAssistantDon(userId, name, active) {
  const id = assistantPerson(userId);
  if (!id) return null;
  const title = String(name || '').trim().slice(0, 120);
  const res = await pool.query(
    `INSERT INTO vk_assistant_don (user_id, name, active, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE vk_assistant_don.name END,
       active = EXCLUDED.active,
       updated_at = NOW()
     RETURNING user_id, name, active, updated_at`,
    [id, title, !!active]
  );
  return res.rows[0] || null;
}

async function listAssistantCommunities(ownerId) {
  const id = ownerId == null ? 0 : assistantPerson(ownerId);
  const res = id
    ? await pool.query(
      `SELECT group_id, owner_id, title, token, sync_state, sync_error, reply, updated_at
       FROM vk_assistant_community WHERE owner_id = $1 ORDER BY updated_at DESC`,
      [id]
    )
    : await pool.query(
      `SELECT group_id, owner_id, title, token, sync_state, sync_error, reply, updated_at
       FROM vk_assistant_community ORDER BY updated_at DESC`
    );
  return res.rows;
}

async function saveAssistantCommunity(row) {
  const groupId = String(row.groupId || '').replace(/\D/g, '');
  const ownerId = assistantPerson(row.ownerId);
  const token = String(row.token || '').replace(/\s+/g, '');
  if (!groupId || !ownerId || token.length < 20) return null;
  const res = await pool.query(
    `INSERT INTO vk_assistant_community (group_id, owner_id, title, token, sync_state, sync_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (group_id) DO UPDATE SET
       owner_id = EXCLUDED.owner_id,
       title = EXCLUDED.title,
       token = EXCLUDED.token,
       sync_state = EXCLUDED.sync_state,
       sync_error = EXCLUDED.sync_error,
       updated_at = NOW()
     RETURNING group_id, owner_id, title, sync_state, sync_error, reply, updated_at`,
    [
      groupId,
      ownerId,
      String(row.title || '').trim().slice(0, 120),
      token.slice(0, 2000),
      String(row.syncState || '').slice(0, 20),
      String(row.syncError || '').slice(0, 240)
    ]
  );
  return res.rows[0] || null;
}

async function saveAssistantReply(groupId, ownerId, reply) {
  const id = String(groupId || '').replace(/\D/g, '');
  const owner = assistantPerson(ownerId);
  if (!id || !owner || !reply) return null;
  const res = await pool.query(
    `UPDATE vk_assistant_community
     SET reply = $3::jsonb, updated_at = NOW()
     WHERE group_id = $1 AND owner_id = $2
     RETURNING group_id, owner_id, title, sync_state, sync_error, reply, updated_at`,
    [id, owner, JSON.stringify(reply)]
  );
  return res.rows[0] || null;
}

async function markAssistantCommunity(groupId, state, error) {
  const id = String(groupId || '').replace(/\D/g, '');
  if (!id) return;
  await pool.query(
    `UPDATE vk_assistant_community
     SET sync_state = $2, sync_error = $3, updated_at = NOW()
     WHERE group_id = $1`,
    [id, String(state || '').slice(0, 20), String(error || '').slice(0, 240)]
  );
}

async function markAssistantOwner(ownerId, state, error) {
  const id = assistantPerson(ownerId);
  if (!id) return;
  await pool.query(
    `UPDATE vk_assistant_community
     SET sync_state = $2, sync_error = $3, updated_at = NOW()
     WHERE owner_id = $1`,
    [id, String(state || '').slice(0, 20), String(error || '').slice(0, 240)]
  );
}

async function saveAssistantSetup(userId, note) {
  const id = assistantPerson(userId);
  if (!id) return null;
  const text = String(note || '').slice(0, 500);
  const res = await pool.query(
    `INSERT INTO vk_assistant_setup (user_id, note, status, updated_at)
     VALUES ($1, $2, 'open', NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET note = EXCLUDED.note, status = 'open', updated_at = NOW()
     RETURNING user_id, note, status, updated_at`,
    [id, text]
  );
  return res.rows[0] || null;
}

async function listAssistantSetups(status) {
  const state = status === 'done' ? 'done' : 'open';
  const res = await pool.query(
    'SELECT user_id, note, status, updated_at FROM vk_assistant_setup WHERE status = $1 ORDER BY updated_at DESC',
    [state]
  );
  return res.rows;
}

async function closeAssistantSetup(userId) {
  const id = assistantPerson(userId);
  if (!id) return null;
  const res = await pool.query(
    `UPDATE vk_assistant_setup SET status = 'done', updated_at = NOW()
     WHERE user_id = $1 RETURNING user_id, note, status, updated_at`,
    [id]
  );
  return res.rows[0] || null;
}

async function deleteAssistantCommunity(groupId) {
  const id = String(groupId || '').replace(/\D/g, '');
  if (!id) return null;
  const res = await pool.query(
    'DELETE FROM vk_assistant_community WHERE group_id = $1 RETURNING group_id, owner_id',
    [id]
  );
  return res.rows[0] || null;
}

async function listDonutLog(groupId, limit) {
  const id = String(groupId || '').replace(/\D/g, '');
  const n = Math.min(200, Math.max(1, Number(limit) || 100));
  if (!id) return [];
  const res = await pool.query(
    `SELECT user_id, kind, amount, created_at
     FROM vk_donut_log WHERE group_id = $1
     ORDER BY id DESC LIMIT $2`,
    [id, n]
  );
  return res.rows;
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

async function rememberLesson(groupId, postId, userId, role, body) {
  await pool.query(
    `INSERT INTO vk_lesson_memory (group_id, post_id, user_id, role, body) VALUES ($1,$2,$3,$4,$5)`,
    [String(groupId), String(postId), String(userId), String(role), String(body || '').slice(0, 1500)]
  );
}

async function listLessonMemory(groupId, postId, userId) {
  const res = await pool.query(
    `SELECT role, body FROM vk_lesson_memory
     WHERE group_id = $1 AND post_id = $2 AND user_id = $3
     ORDER BY id DESC LIMIT 8`,
    [String(groupId), String(postId), String(userId)]
  );
  return res.rows.reverse();
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

async function listTickets(status, platform, groupId) {
  const params = [];
  const parts = [];
  if (status && status !== 'all') {
    params.push(status);
    parts.push(`status = $${params.length}`);
  }
  if (platform === 'vk') parts.push('user_id < 0');
  if (platform === 'tg') parts.push('user_id > 0');
  const group = String(groupId || '').replace(/\D/g, '');
  if (group) {
    params.push(group);
    parts.push(`user_id IN (SELECT user_id FROM vk_member WHERE group_id = $${params.length})`);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const res = await pool.query(`SELECT * FROM support_tickets ${where} ORDER BY id DESC LIMIT 200`, params);
  return res.rows;
}

async function rememberCommunity(userId, groupId) {
  const group = String(groupId || '').replace(/\D/g, '');
  if (!group || group === '0') return;
  await pool.query(
    `INSERT INTO vk_member (user_id, group_id, seen_at) VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, group_id) DO UPDATE SET seen_at = NOW()`,
    [String(userId), group]
  );
  await pool.query('UPDATE users SET vk_group = $2 WHERE user_id = $1', [String(userId), group]);
}

async function communityOf(userId) {
  const res = await pool.query('SELECT vk_group::text AS vk_group FROM users WHERE user_id = $1', [String(userId)]);
  const group = String((res.rows[0] && res.rows[0].vk_group) || '').replace(/\D/g, '');
  return group && group !== '0' ? group : '';
}

async function answerTicket(id, answer) {
  const res = await pool.query(
    `UPDATE support_tickets SET answer = $2, status = 'answered', answered_at = NOW() WHERE id = $1 RETURNING *`,
    [id, String(answer).slice(0, 4000)]
  );
  return res.rows[0];
}

function activityGroup(groupId) {
  return String(groupId || '').replace(/\D/g, '') || '0';
}

async function recordActivity(userId, kind, objectKey, points, groupId) {
  const key = String(objectKey || '').slice(0, 160);
  if (!key) return false;
  const res = await pool.query(
    `INSERT INTO vk_activity (user_id, kind, object_key, points, group_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, kind, object_key, group_id) DO NOTHING
     RETURNING id`,
    [String(userId), String(kind), key, Math.max(0, Math.round(Number(points) || 0)), activityGroup(groupId)]
  );
  return res.rows.length > 0;
}

async function removeActivity(userId, kind, objectKey, groupId) {
  await pool.query(
    'DELETE FROM vk_activity WHERE user_id = $1 AND kind = $2 AND object_key = $3 AND group_id = $4',
    [String(userId), String(kind), String(objectKey || '').slice(0, 160), activityGroup(groupId)]
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

async function listWeekActivity(since, groupId, until, limit, postIds) {
  const weights = require('./activity').POINTS;
  const like = Math.max(0, Math.round(Number(weights.like) || 0));
  const comment = Math.max(0, Math.round(Number(weights.comment) || 0));
  const repost = Math.max(0, Math.round(Number(weights.repost) || 0));
  const bot = Math.max(0, Math.round(Number(weights.bot) || 0));
  const cap = Math.min(200, Math.max(1, Math.round(Number(limit) || 50)));
  const params = [since, like, comment, repost, bot, activityGroup(groupId)];
  let untilSql = '';
  if (until) {
    params.push(until);
    untilSql = `a.created_at < $${params.length}`;
  }
  const botWhen = [`a.kind = 'bot'`, 'a.created_at >= $1', untilSql].filter(Boolean).join(' AND ');
  const timeWhen = ['a.created_at >= $1', untilSql].filter(Boolean).join(' AND ');
  let where = `a.group_id = $6 AND ${timeWhen}`;
  if (postIds === 'bot') {
    where = `a.group_id = $6 AND ${botWhen}`;
  } else if (Array.isArray(postIds)) {
    const ids = [...new Set(postIds.map(id => String(Math.round(Number(id) || 0))).filter(id => id !== '0'))];
    params.push(ids);
    where = `a.group_id = $6 AND ((${botWhen}) OR (a.kind <> 'bot' AND split_part(a.object_key, ':', 2) = ANY($${params.length}::text[])))`;
  }
  params.push(cap);
  const res = await pool.query(
    `SELECT a.user_id,
            COALESCE(u.username, '') AS username,
            ($2::int * COUNT(*) FILTER (WHERE a.kind = 'like')
             + $3::int * COUNT(*) FILTER (WHERE a.kind = 'comment')
             + $4::int * COUNT(*) FILTER (WHERE a.kind = 'repost')
             + $5::int * COUNT(*) FILTER (WHERE a.kind = 'bot'))::int AS points,
            COUNT(*) FILTER (WHERE a.kind = 'like')::int AS likes,
            COUNT(*) FILTER (WHERE a.kind = 'comment')::int AS comments,
            COUNT(*) FILTER (WHERE a.kind = 'repost')::int AS reposts,
            COUNT(*) FILTER (WHERE a.kind = 'bot')::int AS bot
     FROM vk_activity a
     LEFT JOIN users u ON u.user_id = a.user_id
     WHERE ${where}
     GROUP BY a.user_id, u.username
     ORDER BY points DESC, a.user_id
     LIMIT $${params.length}`,
    params
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

async function getStats(platform, groupId) {
  const group = String(groupId || '').replace(/\D/g, '');
  const groupSql = group ? ` AND vk_group = ${group}` : '';
  const where = (platform === 'vk' ? 'user_id < 0' : platform === 'tg' ? 'user_id > 0' : 'TRUE') + groupSql;
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
      (SELECT COUNT(*)::int FROM support_tickets WHERE status = 'open' ${platform === 'vk' ? 'AND user_id < 0' : platform === 'tg' ? 'AND user_id > 0' : ''} ${group ? `AND user_id IN (SELECT user_id FROM users WHERE vk_group = ${group})` : ''}) AS tickets_open
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

async function claimPayment(paymentId, userId, credits) {
  const res = await pool.query(
    `INSERT INTO yookassa_payment (payment_id, user_id, credits)
     VALUES ($1, $2, $3)
     ON CONFLICT (payment_id) DO NOTHING
     RETURNING payment_id`,
    [String(paymentId), String(userId), Math.round(Number(credits) || 0)]
  );
  return !!res.rows[0];
}

async function releasePayment(paymentId) {
  await pool.query('DELETE FROM yookassa_payment WHERE payment_id = $1', [String(paymentId)]);
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

async function adminClient(userId) {
  const id = String(userId || '').trim();
  if (!/^-?\d+$/.test(id)) return null;
  const res = await pool.query(
    `SELECT user_id::text AS user_id, COALESCE(username, '') AS username, balance, current_model,
            blocked, COALESCE(gens, 0) AS gens, COALESCE(spent, 0) AS spent,
            created_at, last_seen, vk_group::text AS vk_group
     FROM users WHERE user_id = $1`,
    [id]
  );
  if (!res.rows[0]) return null;
  const homes = await pool.query(
    'SELECT group_id::text AS group_id FROM vk_member WHERE user_id = $1 ORDER BY seen_at DESC',
    [id]
  );
  res.rows[0].groups = homes.rows.map(row => row.group_id).join(',');
  return { user: res.rows[0], history: await listHistory(id, 40) };
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

function cleanTopics(value) {
  const seen = new Set();
  const out = [];
  String(value || '').split(/[,;|]/).forEach(part => {
    const name = part.trim().replace(/\s+/g, ' ').slice(0, 40);
    const key = name.toLowerCase();
    if (!name || seen.has(key) || out.length >= 40) return;
    seen.add(key);
    out.push(name);
  });
  return out.join(', ') || null;
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
    ['tg', 'vk', 'all'].includes(data.audience) ? data.audience : 'all',
    String(data.fields || '').trim().slice(0, 8000) || null,
    cleanTopics(data.topics)
  ];
  if (data.id) {
    const res = await pool.query(
      `UPDATE templates
       SET title=$1, category=$2, prompt=$3, model=$4, cost=$5, active=$6,
           image=$7, description=$8, hide_prompt=$9, formats=$10, sort=$11,
           quality=$12, duration=$13, audience=$14, fields=$15, topics=$16
       WHERE id=$17 RETURNING *`,
      [...values, data.id]
    );
    return res.rows[0];
  }
  const res = await pool.query(
    `INSERT INTO templates (title, category, prompt, model, cost, active, image, description, hide_prompt, formats, sort, quality, duration, audience, fields, topics)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
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
  rememberLesson,
  listLessonMemory,
  note,
  listJournal,
  touchUser,
  recordGeneration,
  createTicket,
  listTickets,
  rememberCommunity,
  communityOf,
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
  adminClient,
  getUserBalance,
  updateBalance,
  debitBalance,
  claimPayment,
  releasePayment,
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
  getDonutSurvey,
  saveDonutSurvey,
  setVkMode,
  getVkMode,
  clearDonutSurvey,
  recordDonut,
  listDonutLog,
  getAssistantDon,
  listAssistantDons,
  upsertAssistantDon,
  listAssistantCommunities,
  saveAssistantCommunity,
  saveAssistantReply,
  markAssistantCommunity,
  markAssistantOwner,
  deleteAssistantCommunity,
  saveAssistantSetup,
  listAssistantSetups,
  closeAssistantSetup,
  pool,
};
