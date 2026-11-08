const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const agent = new https.Agent({ rejectUnauthorized: false });
const AUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_URL = 'https://api.giga.chat/v1/chat/completions';

const MODELS = {
  'giga-lite': 'GigaChat-2',
  'giga-pro': 'GigaChat-2-Pro',
  'giga-max': 'GigaChat-2-Max',
  'giga-ultra': 'GigaChat-3-Ultra'
};

let token = null;
let tokenUntil = 0;

async function getToken() {
  if (token && Date.now() < tokenUntil) return token;
  const key = process.env.GIGACHAT_AUTH_KEY;
  if (!key) throw new Error('Нет GIGACHAT_AUTH_KEY');
  const scope = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
  const res = await axios.post(AUTH_URL, `scope=${scope}`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: key.startsWith('Basic ') ? key : `Basic ${key}`
    },
    httpsAgent: agent,
    timeout: 20000
  });
  token = res.data.access_token;
  tokenUntil = Date.now() + 25 * 60 * 1000;
  return token;
}

async function processRequest({ prompt, modelKey = 'giga-lite' }) {
  const model = MODELS[modelKey] || MODELS['giga-lite'];
  const access = await getToken();
  const res = await axios.post(API_URL, {
    model,
    messages: [{ role: 'user', content: String(prompt || '').trim() }],
    temperature: 0.7
  }, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${access}`
    },
    httpsAgent: agent,
    timeout: 60000
  });
  const text = res.data?.choices?.[0]?.message?.content || 'Пустой ответ';
  return { type: 'text', text };
}

module.exports = { processRequest, MODELS };
