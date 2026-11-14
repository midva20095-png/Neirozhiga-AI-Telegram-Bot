const { note } = require('./maint');

function apiBase() {
  return (process.env.BRATUKHA_API_URL || 'https://bratuha.ru/api/v1').replace(/\/$/, '');
}

function token() {
  const value = process.env.BRATUKHA_API_KEY || '';
  if (!value) throw new Error('Нужна переменная BRATUKHA_API_KEY');
  return value;
}

async function request(path, options) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { code: response.status, data, text };
}

async function uploadImage(buffer, mime, filename) {
  const result = await request('/uploads', {
    method: 'POST',
    body: JSON.stringify({
      filename: filename || 'photo.jpg',
      content_type: mime || 'image/jpeg',
      data: buffer.toString('base64')
    })
  });
  if (!result.data.url) throw new Error('Братуха не приняла фото');
  return result.data.url;
}

async function createOperation(tool, input) {
  let result;
  try {
    result = await request('/operations', { method: 'POST', body: JSON.stringify({ tool, input }) });
  } catch (error) {
    note(0, String(error));
    return { ok: false, error: String(error) };
  }
  note(result.code, result.text);
  const id = result.data && result.data.id;
  if (result.code >= 200 && result.code < 300 && id) {
    return { ok: true, id, cost: Number(result.data.cost || 0) };
  }
  return { ok: false, error: result.data.error_message || result.data.message || result.text || `HTTP ${result.code}` };
}

async function getOperation(id) {
  const result = await request(`/operations/${encodeURIComponent(id)}`, { method: 'GET' });
  return result.data || {};
}

function firstUrl(value, depth) {
  if (!value || depth > 6) return '';
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = firstUrl(value[key], depth + 1);
      if (found) return found;
    }
  }
  return '';
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Скачивание HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { uploadImage, createOperation, getOperation, firstUrl, download };
