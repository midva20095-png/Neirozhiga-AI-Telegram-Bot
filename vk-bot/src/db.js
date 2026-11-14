const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Нужна переменная DATABASE_URL');
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
      max: 8
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      sort INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      image TEXT,
      video TEXT,
      visible BOOLEAN NOT NULL DEFAULT true,
      trend BOOLEAN NOT NULL DEFAULT false,
      type TEXT NOT NULL,
      mode TEXT NOT NULL,
      size TEXT,
      prompt TEXT,
      video_prompt TEXT,
      categories JSONB NOT NULL DEFAULT '[]',
      fix_images JSONB NOT NULL DEFAULT '[]',
      fix_videos JSONB NOT NULL DEFAULT '[]',
      fields JSONB NOT NULL DEFAULT '[]',
      duration INTEGER,
      sd_duration INTEGER,
      resolution TEXT,
      pixels JSONB,
      kit_items JSONB,
      price INTEGER NOT NULL
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS usage (
      id SERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL,
      template_id TEXT NOT NULL,
      user_id BIGINT NOT NULL
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS usage_template_idx ON usage (template_id, at DESC)');
  await query(`
    CREATE TABLE IF NOT EXISTS daily (
      user_id BIGINT PRIMARY KEY,
      last_day TEXT,
      streak INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS payers (
      user_id BIGINT PRIMARY KEY,
      first_at TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      amount INTEGER NOT NULL,
      bonus INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      price INTEGER NOT NULL,
      payload JSONB NOT NULL,
      result_url TEXT,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      mime TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);
}

async function meta(key) {
  const res = await query('SELECT value FROM meta WHERE key = $1', [key]);
  return res.rows[0] ? res.rows[0].value : null;
}

async function setMeta(key, value) {
  await query(
    `INSERT INTO meta (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

async function importSeed(seed, { force = false } = {}) {
  const existing = await meta('seed');
  if (existing && !force) return { imported: false, reason: 'already' };
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const user of seed.users) {
      await client.query(
        `INSERT INTO users (user_id, balance, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = NOW()`,
        [user.userId, user.balance]
      );
    }
    for (const item of seed.templates) {
      await client.query(
        `INSERT INTO templates (
           id, sort, title, description, image, video, visible, trend, type, mode, size, prompt, video_prompt,
           categories, fix_images, fix_videos, fields, duration, sd_duration, resolution, pixels, kit_items, price
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21::jsonb,$22::jsonb,$23
         )
         ON CONFLICT (id) DO UPDATE SET
           sort = EXCLUDED.sort, title = EXCLUDED.title, description = EXCLUDED.description, image = EXCLUDED.image,
           video = EXCLUDED.video, visible = EXCLUDED.visible, trend = EXCLUDED.trend, type = EXCLUDED.type,
           mode = EXCLUDED.mode, size = EXCLUDED.size, prompt = EXCLUDED.prompt, video_prompt = EXCLUDED.video_prompt,
           categories = EXCLUDED.categories, fix_images = EXCLUDED.fix_images, fix_videos = EXCLUDED.fix_videos,
           fields = EXCLUDED.fields, duration = EXCLUDED.duration, sd_duration = EXCLUDED.sd_duration,
           resolution = EXCLUDED.resolution, pixels = EXCLUDED.pixels, kit_items = EXCLUDED.kit_items, price = EXCLUDED.price`,
        [
          item.id, item.sort, item.title, item.description, item.image, item.video, item.visible, item.trend,
          item.type, item.mode, item.size, item.prompt, item.videoPrompt,
          JSON.stringify(item.categories), JSON.stringify(item.fixImages), JSON.stringify(item.fixVideos), JSON.stringify(item.fields),
          item.duration, item.sdDuration, item.resolution,
          item.pixels ? JSON.stringify(item.pixels) : null,
          item.kitItems && item.kitItems.length ? JSON.stringify(item.kitItems) : null,
          item.price
        ]
      );
    }
    if (force) await client.query('DELETE FROM usage');
    for (const row of seed.usage) {
      await client.query('INSERT INTO usage (at, template_id, user_id) VALUES ($1, $2, $3)', [row.at, row.templateId, row.userId]);
    }
    for (const row of seed.daily) {
      await client.query(
        `INSERT INTO daily (user_id, last_day, streak, total) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET last_day = EXCLUDED.last_day, streak = EXCLUDED.streak, total = EXCLUDED.total`,
        [row.userId, row.lastDay, row.streak, row.total]
      );
    }
    for (const row of seed.payers) {
      await client.query(
        `INSERT INTO payers (user_id, first_at) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [row.userId, row.firstAt]
      );
    }
    await client.query(
      `INSERT INTO meta (key, value) VALUES ('seed', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ capturedAt: seed.capturedAt, users: seed.users.length, templates: seed.templates.length, at: new Date().toISOString() })]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { imported: true, users: seed.users.length, templates: seed.templates.length, usage: seed.usage.length };
}

function rowTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    sort: row.sort,
    title: row.title,
    description: row.description,
    image: row.image,
    video: row.video,
    visible: row.visible,
    trend: row.trend,
    type: row.type,
    mode: row.mode,
    size: row.size,
    prompt: row.prompt,
    videoPrompt: row.video_prompt,
    categories: row.categories || [],
    fixImages: row.fix_images || [],
    fixVideos: row.fix_videos || [],
    fields: row.fields || [],
    duration: row.duration,
    sdDuration: row.sd_duration,
    resolution: row.resolution,
    pixels: row.pixels,
    kitItems: row.kit_items || [],
    price: row.price
  };
}

async function templates(visibleOnly) {
  const res = await query(
    `SELECT * FROM templates ${visibleOnly ? 'WHERE visible = true' : ''} ORDER BY sort ASC`
  );
  return res.rows.map(rowTemplate);
}

async function template(id) {
  const res = await query('SELECT * FROM templates WHERE id = $1', [String(id)]);
  return rowTemplate(res.rows[0]);
}

async function usageStats(sinceWeek, sinceToday) {
  const res = await query(
    `SELECT template_id,
            COUNT(*) FILTER (WHERE at >= $1)::int AS week,
            COUNT(*) FILTER (WHERE at >= $2)::int AS today
     FROM usage GROUP BY template_id`,
    [sinceWeek, sinceToday]
  );
  const out = {};
  for (const row of res.rows) out[row.template_id] = { week: row.week, today: row.today };
  return out;
}

async function addUsage(templateId, userId) {
  await query('INSERT INTO usage (at, template_id, user_id) VALUES (NOW(), $1, $2)', [String(templateId), userId]);
}

async function ensureUser(userId, client) {
  const q = client || getPool();
  await q.query('INSERT INTO users (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function balance(userId) {
  const res = await query('SELECT balance FROM users WHERE user_id = $1', [userId]);
  return res.rows[0] ? res.rows[0].balance : 0;
}

async function charge(userId, price) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await ensureUser(userId, client);
    const locked = await client.query('SELECT balance FROM users WHERE user_id = $1 FOR UPDATE', [userId]);
    const current = locked.rows[0].balance;
    if (current < price) {
      await client.query('ROLLBACK');
      return { ok: false, balance: current };
    }
    const next = await client.query('UPDATE users SET balance = balance - $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance', [userId, price]);
    await client.query('COMMIT');
    return { ok: true, balance: next.rows[0].balance };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw error;
  } finally {
    client.release();
  }
}

async function credit(userId, amount) {
  await ensureUser(userId);
  const res = await query('UPDATE users SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance', [userId, amount]);
  return res.rows[0].balance;
}

async function topup(userId, amount, bonus, paymentId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (paymentId) {
      const dup = await client.query('SELECT payment_id FROM payments WHERE payment_id = $1', [paymentId]);
      if (dup.rows[0]) {
        const current = await client.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
        await client.query('COMMIT');
        return { duplicate: true, balance: current.rows[0] ? current.rows[0].balance : 0 };
      }
      await client.query('INSERT INTO payments (payment_id, user_id, amount, bonus) VALUES ($1, $2, $3, $4)', [paymentId, userId, amount, bonus]);
    }
    await client.query('INSERT INTO users (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [userId]);
    const res = await client.query('UPDATE users SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance', [userId, amount + bonus]);
    await client.query('INSERT INTO payers (user_id, first_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [userId, new Date().toISOString()]);
    await client.query('COMMIT');
    return { duplicate: false, balance: res.rows[0].balance, bonus };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw error;
  } finally {
    client.release();
  }
}

async function isPayer(userId) {
  const res = await query('SELECT user_id FROM payers WHERE user_id = $1', [userId]);
  return !!res.rows[0];
}

async function dailyRow(userId) {
  const res = await query('SELECT last_day, streak, total FROM daily WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

async function saveDaily(userId, lastDay, streak, total) {
  await query(
    `INSERT INTO daily (user_id, last_day, streak, total) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET last_day = EXCLUDED.last_day, streak = EXCLUDED.streak, total = EXCLUDED.total`,
    [userId, lastDay, streak, total]
  );
}

async function putJob(job) {
  await query(
    `INSERT INTO jobs (id, user_id, kind, status, price, payload, result_url)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [job.id, job.userId, job.kind, job.status || 'pending', job.price, JSON.stringify(job.payload || {}), job.resultUrl || null]
  );
}

async function pendingJobs() {
  const res = await query(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20`);
  return res.rows.map(row => ({
    id: row.id,
    userId: String(row.user_id),
    kind: row.kind,
    price: row.price,
    payload: row.payload || {},
    resultUrl: row.result_url,
    createdAt: row.created_at
  }));
}

async function patchJob(id, patch) {
  const current = await query('SELECT payload, result_url, status FROM jobs WHERE id = $1', [id]);
  if (!current.rows[0] || current.rows[0].status !== 'pending') return false;
  const payload = patch.payload || current.rows[0].payload;
  await query(
    `UPDATE jobs SET payload = $2::jsonb, result_url = COALESCE($3, result_url), updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
    [id, JSON.stringify(payload), patch.resultUrl || null]
  );
  return true;
}

async function finishJob(id, status, error) {
  const res = await query(
    `UPDATE jobs SET status = $2, error = $3, updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id, status, error || null]
  );
  return res.rowCount > 0;
}

async function saveUpload(id, userId, mime, bytes) {
  await query('INSERT INTO uploads (id, user_id, mime, bytes) VALUES ($1, $2, $3, $4)', [id, userId, mime, bytes]);
}

async function upload(id) {
  const res = await query('SELECT user_id, mime, bytes FROM uploads WHERE id = $1', [id]);
  if (!res.rows[0]) return null;
  return { userId: String(res.rows[0].user_id), mime: res.rows[0].mime, bytes: res.rows[0].bytes };
}

async function counts() {
  const users = await query('SELECT COUNT(*)::int AS n, COALESCE(SUM(balance), 0)::int AS credits FROM users');
  const templatesCount = await query('SELECT COUNT(*)::int AS n FROM templates WHERE visible = true');
  return { users: users.rows[0].n, credits: users.rows[0].credits, templates: templatesCount.rows[0].n };
}

module.exports = {
  init, query, meta, setMeta, importSeed, templates, template, usageStats, addUsage,
  balance, charge, credit, topup, isPayer, dailyRow, saveDaily,
  putJob, pendingJobs, patchJob, finishJob, saveUpload, upload, counts
};
