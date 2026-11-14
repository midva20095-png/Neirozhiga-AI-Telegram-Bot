const crypto = require('crypto');

function parseQuery(search) {
  return String(search || '').replace(/^\?/, '').split('&').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    const key = decodeURIComponent(index < 0 ? part : part.slice(0, index));
    const raw = index < 0 ? '' : part.slice(index + 1).replace(/\+/g, ' ');
    return [key, decodeURIComponent(raw)];
  });
}

function signParams(params, secret) {
  const pairs = Object.entries(params)
    .filter(([key]) => key.indexOf('vk_') === 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return crypto.createHmac('sha256', secret).update(query).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function userFromLaunch(search, secret, now) {
  if (!secret) return null;
  const parts = parseQuery(search);
  const sign = (parts.find(part => part[0] === 'sign') || [])[1];
  const vk = parts.filter(part => part[0].indexOf('vk_') === 0).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!sign || !vk.length) return null;
  const query = vk.map(part => `${part[0]}=${encodeURIComponent(part[1])}`).join('&');
  const expected = crypto.createHmac('sha256', secret).update(query).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const left = Buffer.from(sign);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  const data = {};
  vk.forEach(part => { data[part[0]] = part[1]; });
  const moment = now == null ? Date.now() : now;
  if (moment / 1000 - Number(data.vk_ts || 0) > 86400) return null;
  return data.vk_user_id ? String(data.vk_user_id) : null;
}

module.exports = { parseQuery, signParams, userFromLaunch };
