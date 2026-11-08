const db = require('./db');

let googlePlugin = null;
try { googlePlugin = require('../ai_plugins/google_gemini_plugin'); } catch (e) {}
let gigaPlugin = null;
try { gigaPlugin = require('../ai_plugins/gigachat_plugin'); } catch (e) {}

function getPlugin(modelKey) {
  if (['flash', 'flash_25', 'pro', 'nanobanana', 'nanobanana_pro'].includes(modelKey)) return googlePlugin;
  if (['giga-lite', 'giga-pro', 'giga-max', 'giga-ultra'].includes(modelKey)) return gigaPlugin;
  return bratukhaPlugin;
}

const COSTS = {
  flash: 4, flash_25: 4, pro: 15, nanobanana: 20, nanobanana_pro: 50,
  'qwen3-tts': 100, 'qwen3-tts-flash': 100,
  'phota-enhance': 220, 'p-image-upscale': 10,
  'qwen-image-2-1': 40, 'qwen-image-3-0': 45,
  'recraft-v4': 15, 'recraft-v4-1': 20, 'runway-gen4-image': 80,
  'seedream-4-0': 15, 'seedream-4-5': 20, 'sam-3d': 40,
  'giga-lite': 0, 'giga-pro': 0, 'giga-max': 0, 'giga-ultra': 0
};

const NAMES = {
  flash: 'Gemini Flash', flash_25: 'Gemini 2.5 Flash', pro: 'Gemini Pro',
  nanobanana: 'Nano Banana', nanobanana_pro: 'Nano Banana Pro',
  'qwen-image-3-0': 'Qwen Image 3.0', 'seedream-4-5': 'Seedream 4.5',
  'recraft-v4-1': 'Recraft V4.1', 'runway-gen4-image': 'Runway Gen4',
  'qwen3-tts-flash': 'Озвучка',
  'giga-lite': 'GigaChat 2 Lite', 'giga-pro': 'GigaChat 2 Pro',
  'giga-max': 'GigaChat 2 Max', 'giga-ultra': 'GigaChat 3 Ultra'
};

async function generate({ userId, prompt, model }) {
  const key = model || (await db.getCurrentModel(userId)) || 'flash';
  const plugin = getPlugin(key);
  if (!plugin || !plugin.processRequest) throw new Error('Модель недоступна');
  const cost = COSTS[key] || 4;
  const user = await db.getUser(userId);
  if (user.blocked) throw new Error('Аккаунт в чёрном списке');
  if (String(key).startsWith('giga-')) {
    const lim = await db.checkGigaLimit(userId, key);
    if (!lim.ok) throw new Error(`Лимит на сегодня: ${lim.used}/${lim.limit}`);
  }
  if (user.balance < cost) throw new Error(`Недостаточно кредитов: ${user.balance}, нужно ${cost}`);

  const result = await plugin.processRequest({ prompt, modelKey: key });
  const balance = await db.updateBalance(userId, -cost, `Генерация · ${NAMES[key] || key}`);
  if (String(key).startsWith('giga-')) await db.addGigaUse(userId, key);
  await db.setCurrentModel(userId, key);

  const out = { type: result.type || 'text', text: result.text || '', cost, balance, model: key };
  if (result.buffer) {
    const mime = result.type === 'audio' ? 'audio/mpeg' : result.type === 'video' ? 'video/mp4' : 'image/png';
    out.media = `data:${mime};base64,${result.buffer.toString('base64')}`;
  }
  return out;
}

module.exports = { generate, COSTS, NAMES };
