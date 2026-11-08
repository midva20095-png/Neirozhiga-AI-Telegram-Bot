const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        balance INTEGER DEFAULT 0 NOT NULL,
        current_model TEXT DEFAULT 'flash',
        email TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица users готова (PostgreSQL)');
  } catch (err) {
    console.error('❌ Ошибка инициализации таблицы users:', err.message);
    throw err;
  }
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

async function getUserBalance(userId) {
  try {
    const user = await getUser(userId);
    return user ? parseInt(user.balance, 10) : 0;
  } catch (err) {
    console.error('❌ getUserBalance error:', err.message);
    return 0;
  }
}

async function updateBalance(userId, amount) {
  const id = String(userId);
  try {
    // Сначала убедимся, что пользователь существует
    await getUser(id);
    const res = await pool.query(
      `UPDATE users
       SET balance = GREATEST(0, balance + $1), updated_at = NOW()
       WHERE user_id = $2
       RETURNING balance`,
      [amount, id]
    );
    return res.rows[0] ? parseInt(res.rows[0].balance, 10) : null;
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

module.exports = {
  initDB,
  getUser,
  getUserBalance,
  updateBalance,
  setCurrentModel,
  getCurrentModel,
  pool,
};
