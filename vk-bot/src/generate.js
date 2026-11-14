const crypto = require('crypto');
const db = require('./db');
const bratuha = require('./bratuha');
const vk = require('./vk');
const media = require('./media');
const maint = require('./maint');
const pricing = require('./pricing');
const layout = require('./layout');
const { applyAnswers, referenceList, publicTemplate } = require('./templates');

const recent = new Map();
const chunks = new Map();
let publicBase = '';

function configure(options) {
  publicBase = String(options.base || '').replace(/\/$/, '');
}

function tooFast(userId) {
  const now = Date.now();
  if ((recent.get(String(userId)) || 0) > now) return true;
  recent.set(String(userId), now + 15000);
  return false;
}

function moscowDay(offset) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date(Date.now() + (offset || 0) * 864e5));
}

function moscowStart() {
  const [year, month, day] = moscowDay(0).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, -3, 0, 0));
}

async function uploadDataUrls(userId, values) {
  const urls = [];
  for (const value of values || []) {
    const raw = String(value || '');
    if (!raw) continue;
    if (/^https?:\/\//.test(raw)) { urls.push(raw); continue; }
    if (raw.length > 8000000) throw new Error('photo too big');
    const body = Buffer.from(raw.split(',').pop(), 'base64');
    urls.push(await bratuha.uploadImage(body, 'image/jpeg', `${userId}_${Date.now()}.jpg`));
  }
  return urls;
}

async function launch(userId, spec) {
  if (maint.on()) return { ok: false, error: maint.TEXT };
  const paid = await db.charge(userId, spec.price);
  if (!paid.ok) return { ok: false, error: `Недостаточно средств. Нужно ${spec.price} ₽, на балансе ${paid.balance} ₽` };
  let created;
  try { created = await bratuha.createOperation(spec.tool, spec.input); }
  catch (error) { created = { ok: false, error: String(error) }; }
  if (!created.ok) {
    await db.credit(userId, spec.price);
    maint.note(0, created.error || '', () => notifyAdmin(created.error));
    return { ok: false, error: 'Не удалось запустить, деньги возвращены' };
  }
  await db.putJob({
    id: created.id,
    userId,
    kind: spec.kind,
    price: spec.price,
    payload: spec.payload || {}
  });
  if (spec.templateId) {
    try { await db.addUsage(spec.templateId, userId); } catch (e) {}
  }
  const text = spec.notice || `Генерация запущена (${spec.price} ₽). Результат придёт в этот чат.`;
  try { await vk.sendText(userId, text, vk.menuKeyboard()); } catch (e) {}
  return { ok: true, balance: await db.balance(userId), message: 'Готово! Результат придёт в чат с ботом' };
}

function notifyAdmin(text) {
  const admin = process.env.VK_ADMIN_ID;
  if (!admin) return;
  vk.sendText(admin, `Похоже, на балансе Братухи закончились деньги. Клиентам показывается обновление на 30 минут. ${String(text || '').slice(0, 200)}`).catch(() => {});
}

async function runTemplate(userId, body) {
  if (tooFast(userId)) return { ok: false, error: 'Подождите несколько секунд' };
  const template = await db.template(body.templateId);
  if (!template || !template.visible) return { ok: false, error: 'Шаблон не найден' };
  if (maint.on()) return { ok: false, error: maint.TEXT };
  if (template.type === 'slicer') return { ok: false, error: 'Этот шаблон сейчас недоступен' };
  const filled = applyAnswers(template, body.answers || {}, body.photos || []);
  if (filled.error) return { ok: false, error: filled.error };
  let uploaded = [];
  try { uploaded = await uploadDataUrls(userId, filled.photos); }
  catch (e) { return { ok: false, error: 'Не удалось загрузить фото, попробуйте другое' }; }
  const refs = referenceList(template, uploaded);
  const ref = refs.join(' ');
  const extraTypes = ['chain', 'chainsd', 'carousel', 'circle', 'exact', 'kit', 'image'];
  const extra = extraTypes.includes(template.type) ? pricing.refExtra(template.mode, ref) : 0;
  const price = template.price + extra;
  if (await db.balance(userId) < price) return { ok: false, error: `Недостаточно средств. Нужно ${price} ₽` };

  if (template.type === 'video') {
    if (!refs.length) return { ok: false, error: 'Для видео нужно хотя бы одно фото' };
    const built = pricing.grokInput(filled.prompt, refs, template.size, template.duration, template.resolution);
    return launch(userId, {
      kind: 'video', tool: built.tool, input: built.input, price: template.price, templateId: template.id,
      notice: `Видео создаётся. ${template.duration} сек · ${template.resolution} · ${template.price} ₽.`,
      payload: { caption: `${template.title}. ${template.duration} сек` }
    });
  }
  if (template.type === 'seedance') {
    if (!refs.length) return { ok: false, error: 'Добавьте фото' };
    const scene = seedanceScene(filled.prompt, refs, [], [], template.sdDuration, template.resolution, template.size === '16:9' ? '16:9' : '9:16');
    return launch(userId, {
      kind: 'video', tool: 'seedance-2-5', input: pricing.seedanceInput(scene), price: scene.price, templateId: template.id,
      notice: `Видео Seedance создаётся. ${scene.duration} сек · ${scene.resolution} · ${scene.price} ₽.`,
      payload: { caption: template.title }
    });
  }

  let prompt = filled.prompt;
  let size = template.size;
  const payload = { caption: template.title, templateId: template.id };
  if (template.type === 'carousel') {
    const count = layout.carNorm(template.mode, filled.slides);
    prompt = layout.carPrompt(prompt, count);
    size = layout.carGrid(count)[2];
    payload.n = count;
  } else if (template.type === 'exact') {
    if (!template.pixels) return { ok: false, error: 'У шаблона не задан размер' };
    const plan = layout.exPlan(template.pixels[0], template.pixels[1], template.pixels[2] || 1);
    prompt = layout.exPrompt(prompt, plan, template.pixels[0], template.pixels[1], template.pixels[2] || 1);
    size = plan.size;
    payload.ex = { W: template.pixels[0], H: template.pixels[1], N: template.pixels[2] || 1, kw: plan.kw, kh: plan.kh, label: template.title };
  } else if (template.type === 'kit') {
    if (!template.kitItems.length) return { ok: false, error: 'У шаблона не заданы размеры набора' };
    const first = template.kitItems[0];
    const plan = layout.exPlan(first[0], first[1], first[2] || 1);
    prompt = layout.exPrompt(layout.kitPrompt(prompt, first, false), plan, first[0], first[1], first[2] || 1);
    size = plan.size;
    payload.ex = { W: first[0], H: first[1], N: first[2] || 1, kw: plan.kw, kh: plan.kh, label: layout.kitLabel(first) };
    payload.kit = { mode: template.mode, prompt: filled.prompt, ref, items: template.kitItems, unit: pricing.MODES[template.mode].price };
  } else if (template.type === 'circle') {
    prompt = layout.circPrompt(prompt);
    size = '1:1';
    payload.diameter = filled.diameter;
  } else if (template.type === 'chain' || template.type === 'chainsd') {
    const imagePrice = pricing.MODES[template.mode].price + extra;
    payload.videoPrice = price - imagePrice;
    payload.videoPrompt = filled.videoPrompt;
    payload.duration = template.type === 'chainsd' ? template.sdDuration : template.duration;
    payload.resolution = template.resolution;
    payload.size = template.size === '16:9' ? '16:9' : (template.type === 'chainsd' ? '9:16' : template.size);
    payload.fixVideos = template.fixVideos || [];
    payload.chainsd = template.type === 'chainsd';
  }

  const built = pricing.buildInput(template.mode, prompt, size, ref);
  if (!built) return { ok: false, error: 'Модель шаблона недоступна' };
  const kind = ['carousel', 'exact', 'kit', 'circle', 'chain', 'chainsd'].includes(template.type) ? template.type : 'image';
  return launch(userId, {
    kind, tool: built.tool, input: built.input, price, templateId: template.id, payload,
    notice: `Запускаю «${template.title}» (${price} ₽). Результат придёт в этот чат.`
  });
}

function seedanceScene(prompt, refs, videos, audios, duration, resolution, size) {
  const scene = {
    type: (refs.length === 1 && !videos.length && !audios.length) ? 'image' : 'references',
    prompt: String(prompt).slice(0, 4000),
    refs, videos, audios,
    duration, resolution, size,
    videoSecReal: 0,
    videoSecBilled: 0
  };
  scene.price = pricing.sdClientPrice(scene);
  return scene;
}

async function ownedMedia(userId, url) {
  const match = String(url || '').match(/\/media\/([a-f0-9]{32})$/);
  if (!match) return '';
  const file = await db.upload(match[1]);
  if (!file || String(file.userId) !== String(userId)) return '';
  return `${publicBase}/media/${match[1]}`;
}

async function createFree(userId, body) {
  if (tooFast(userId)) return { ok: false, error: 'Подождите несколько секунд' };
  if (maint.on()) return { ok: false, error: maint.TEXT };
  if (body.kind === 'sd') return createSeedance(userId, body);
  const resolved = pricing.resolveCreate(body);
  if (resolved.error) return { ok: false, error: resolved.error };
  const prompt = String(body.prompt || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 4000);
  if (prompt.length < 3) return { ok: false, error: 'Опишите, что нужно сделать' };
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, resolved.kind === 'video' ? 4 : 6) : [];
  if (resolved.kind === 'video' && !photos.length) return { ok: false, error: 'Для видео нужно фото' };
  let urls = [];
  try { urls = await uploadDataUrls(userId, photos); }
  catch (e) { return { ok: false, error: 'Не удалось загрузить фото, попробуйте другое' }; }
  if (resolved.kind === 'video') {
    const built = pricing.grokInput(prompt, urls, resolved.size, resolved.duration, resolved.resolution);
    return launch(userId, {
      kind: 'video', tool: built.tool, input: built.input, price: resolved.price,
      notice: `Видео создаётся. ${resolved.duration} сек · ${resolved.resolution} · ${resolved.price} ₽.`,
      payload: { caption: 'Ваше видео' }
    });
  }
  const size = resolved.sizes.includes(String(body.size)) ? String(body.size) : '1:1';
  const price = pricing.modeExact(resolved.key, urls.length);
  const built = pricing.buildInput(resolved.key, prompt, size, urls.join(' '));
  if (!built) return { ok: false, error: 'Выберите модель' };
  return launch(userId, {
    kind: 'image', tool: built.tool, input: built.input, price,
    notice: `Рисую изображение (${price} ₽).`,
    payload: { caption: 'Ваша картинка' }
  });
}

async function createSeedance(userId, body) {
  const prompt = String(body.prompt || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 4000);
  if (prompt.length < 2) return { ok: false, error: 'Опишите, что должно быть в видео' };
  const duration = [5, 10, 15, 20, 25, 30].includes(Number(body.dur)) ? Number(body.dur) : 5;
  const resolution = body.res === '720p' ? '720p' : '480p';
  const size = body.size === '16:9' ? '16:9' : '9:16';
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 6) : [];
  const videos = [];
  let videoSeconds = 0;
  for (const item of (Array.isArray(body.vids) ? body.vids : []).slice(0, 2)) {
    const url = await ownedMedia(userId, item && item.url);
    const seconds = Number(item && item.dur);
    if (url && seconds >= 2) { videos.push(url); videoSeconds += seconds; }
  }
  const audios = [];
  for (const item of (Array.isArray(body.auds) ? body.auds : []).slice(0, 2)) {
    const url = await ownedMedia(userId, item);
    if (url) audios.push(url);
  }
  if (!photos.length && !videos.length && !audios.length) return { ok: false, error: 'Добавьте фото, видео или аудио' };
  let refs = [];
  try { refs = await uploadDataUrls(userId, photos); }
  catch (e) { return { ok: false, error: 'Не удалось загрузить фото, попробуйте другое' }; }
  const scene = seedanceScene(prompt, refs, videos, audios, duration, resolution, size);
  scene.videoSecReal = Math.round(videoSeconds * 100) / 100;
  scene.videoSecBilled = Math.ceil(videoSeconds);
  scene.price = pricing.sdClientPrice(scene);
  return launch(userId, {
    kind: 'video', tool: 'seedance-2-5', input: pricing.seedanceInput(scene), price: scene.price,
    notice: `Видео Seedance создаётся. ${duration} сек · ${resolution} · ${scene.price} ₽.`,
    payload: { caption: 'Видео Seedance' }
  });
}

async function chatPrompt(userId, text, photoUrls) {
  const prompt = String(text || '').trim();
  const photos = photoUrls || [];
  if (prompt.length < 3 && !photos.length) return { ok: false, error: 'Напишите, что нарисовать' };
  if (maint.on()) return { ok: false, error: maint.TEXT };
  const price = pricing.modeExact('standard', photos.length);
  const built = pricing.buildInput('standard', prompt || 'Улучши это фото', '1:1', photos.join(' '));
  return launch(userId, {
    kind: 'image', tool: built.tool, input: built.input, price,
    notice: `Рисую в режиме «стандарт» (${price} ₽).`,
    payload: { caption: 'Ваша картинка' }
  });
}

async function uploadChunk(userId, body) {
  const uid = String(body.uid || '').replace(/[^\w]/g, '').slice(0, 30);
  const index = Number(body.i);
  const count = Number(body.n);
  const size = Number(body.size);
  const ext = String(body.ext || '').toLowerCase();
  const types = { mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg' };
  if (!uid || !types[ext] || !(size > 0 && size <= 60 * 1048576) || !(count >= 1) || !(index >= 0 && index < count)) {
    return { ok: false, error: 'Неверные данные загрузки' };
  }
  const key = `${userId}:${uid}`;
  if (index === 0) chunks.set(key, { size, mime: types[ext], parts: [], got: 0, ext });
  const session = chunks.get(key);
  if (!session) return { ok: false, error: 'Загрузка прервалась, начните заново' };
  const bytes = Buffer.from(String(body.data || ''), 'base64');
  if (!session.parts[index]) session.got += bytes.length;
  session.parts[index] = bytes;
  if (session.got < size) return { ok: true };
  const file = Buffer.concat(session.parts);
  chunks.delete(key);
  const id = crypto.randomBytes(16).toString('hex');
  await db.saveUpload(id, userId, session.mime, file);
  if (!publicBase) return { ok: false, error: 'Загрузка файлов заработает после публикации сервиса' };
  return { ok: true, url: `${publicBase}/media/${id}` };
}

async function dailyState(userId, member) {
  const row = await db.dailyRow(userId);
  const today = moscowDay(0);
  const yesterday = moscowDay(-1);
  const last = row ? String(row.last_day || '') : '';
  const stored = row ? Number(row.streak) || 0 : 0;
  const claimed = last === today;
  const streak = (claimed || last === yesterday) ? stored : 0;
  const next = pricing.DAY_BONUS + ((streak + 1) % pricing.STREAK_DAYS === 0 ? pricing.STREAK_BONUS : 0);
  const dots = streak === 0 ? 0 : (streak % pricing.STREAK_DAYS === 0 ? pricing.STREAK_DAYS : streak % pricing.STREAK_DAYS);
  return {
    payer: await db.isPayer(userId),
    claimed,
    streak,
    next,
    dots,
    streakBonus: pricing.STREAK_BONUS,
    subRequired: true,
    sub: !!(member && member.sub),
    subErr: !!(member && member.err)
  };
}

async function initUser(userId) {
  const list = await db.templates(true);
  const stats = await db.usageStats(new Date(Date.now() - 7 * 864e5), moscowStart());
  const member = await vk.isMember(userId);
  return {
    ok: true,
    balance: await db.balance(userId),
    templates: list.map(item => publicTemplate(item, stats)),
    models: pricing.modelsForApp(),
    videoPrices: { '480p': pricing.videoPrice('480p', 1), '720p': pricing.videoPrice('720p', 1) },
    videoInfo: { sizes: pricing.VIDEO_SIZES, maxPhotos: 4, durations: [6, 10, 15] },
    daily: await dailyState(userId, member)
  };
}

async function claimDaily(userId) {
  const member = await vk.isMember(userId);
  const state = await dailyState(userId, member);
  if (!state.payer) return { ok: false, error: 'Бонус откроется после первого пополнения' };
  if (!state.sub) return { ok: false, error: state.subErr ? 'Не удалось проверить подписку, попробуйте позже' : 'Подпишитесь на сообщество, чтобы получать бонус' };
  if (state.claimed) return { ok: false, error: 'Бонус за сегодня уже получен' };
  const streak = state.streak + 1;
  const reward = pricing.DAY_BONUS + (streak % pricing.STREAK_DAYS === 0 ? pricing.STREAK_BONUS : 0);
  const row = await db.dailyRow(userId);
  await db.saveDaily(userId, moscowDay(0), streak, (row ? Number(row.total) || 0 : 0) + reward);
  const balance = await db.credit(userId, reward);
  return { ok: true, balance, reward, daily: await dailyState(userId, { sub: true }) };
}

async function hook(body) {
  if (!process.env.BOT_SECRET || String(body.secret) !== process.env.BOT_SECRET) return { response: 'bad_secret' };
  const userId = String(body.user_id || '').trim();
  if (!/^\d+$/.test(userId)) return { response: 'bad_params' };
  if (body.action === 'balance') {
    const value = await db.balance(userId);
    try { await vk.sendText(userId, `Ваш баланс: ${value} ₽`, vk.menuKeyboard()); } catch (e) {}
    return { response: String(value), balance: String(value) };
  }
  if (body.action === 'topup') {
    const amount = Number((String(body.amount || '').replace(',', '.').match(/\d+(\.\d+)?/) || [0])[0]);
    if (!(amount > 0)) return { response: 'bad_params' };
    const bonus = pricing.topupBonus(amount);
    const paymentId = String(body.payment_id || '').trim() || `tu_${userId}_${amount}_${Math.floor(Date.now() / 120000)}`;
    const result = await db.topup(userId, Math.round(amount), bonus, paymentId);
    if (!result.duplicate) {
      try {
        await vk.sendText(userId, `Оплата получена.\nПополнено: ${Math.round(amount)} ₽${bonus ? `\nБонус: +${bonus} ₽` : ''}\nВаш баланс: ${result.balance} ₽`, vk.menuKeyboard());
      } catch (e) {}
    }
    return { response: 'ok', balance: result.balance, duplicate: !!result.duplicate };
  }
  return { response: 'bad_params' };
}

async function refund(job, reason) {
  if (!(await db.finishJob(job.id, 'failed', reason))) return;
  const amount = Number(job.payload && job.payload.refund != null ? job.payload.refund : job.price) || 0;
  if (amount > 0) await db.credit(job.userId, amount);
  try {
    await vk.sendText(job.userId, amount > 0 ? `Генерация не удалась. ${amount} ₽ возвращены на баланс.` : 'Эту часть набора не удалось отправить.', vk.menuKeyboard());
  } catch (e) {}
}

async function deliver(job) {
  if (!job.resultUrl) {
    const state = await bratuha.getOperation(job.id);
    const status = String(state.status || '').toLowerCase();
    const url = bratuha.firstUrl(state.result || state.output || state, 0);
    const age = Date.now() - new Date(job.createdAt).getTime();
    const ready = ['completed', 'succeeded', 'success', 'done', 'finished', 'ready'].includes(status) && url;
    const failed = ['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(status) || age > 40 * 60 * 1000;
    if (!ready) {
      if (failed) await refund(job, status || 'timeout');
      return;
    }
    job.resultUrl = url;
    await db.patchJob(job.id, { resultUrl: url, payload: job.payload });
  }
  const file = await bratuha.download(job.resultUrl);
  const caption = (job.payload && job.payload.caption) || 'Готово';
  if (job.kind === 'video') {
    await vk.sendDoc(job.userId, file, 'video.mp4', caption, vk.menuKeyboard());
  } else if (job.kind === 'carousel') {
    const parts = await media.slices(file, job.payload.n || 6);
    for (let index = 0; index < parts.length; index++) {
      await vk.sendPhoto(job.userId, parts[index], `${caption}. Слайд ${index + 1} из ${parts.length}`, index === parts.length - 1 ? vk.menuKeyboard() : null);
    }
  } else if (job.kind === 'exact' || job.kind === 'kit') {
    const parts = await media.exact(file, job.payload.ex);
    for (let index = 0; index < parts.length; index++) {
      const label = job.payload.ex.label || caption;
      await vk.sendPhoto(job.userId, parts[index], parts.length > 1 ? `${label}, плитка ${index + 1} из ${parts.length}` : label, vk.menuKeyboard());
    }
    if (job.kind === 'kit' && job.payload.kit && !job.payload.kit.spawned) await spawnKit(job);
  } else if (job.kind === 'circle') {
    const png = await media.circle(file);
    await vk.sendDoc(job.userId, png, `circle-${job.payload.diameter || 12}cm.png`, `${caption}. Макет-круг ${job.payload.diameter || 12} см`, vk.menuKeyboard());
  } else if (job.kind === 'chain' || job.kind === 'chainsd') {
    await vk.sendPhoto(job.userId, file, 'Картинка готова. Собираю видео.', null);
    await startFollowup(job);
  } else {
    await vk.sendPhoto(job.userId, file, caption, vk.menuKeyboard());
  }
  await db.finishJob(job.id, 'done');
}

async function startFollowup(job) {
  const payload = job.payload || {};
  const refs = [job.resultUrl].concat(payload.fixVideos || []).filter(Boolean);
  let created;
  if (payload.chainsd) {
    const scene = seedanceScene(payload.videoPrompt || 'Оживи изображение: естественные плавные движения', refs, [], [], payload.duration || 5, payload.resolution || '480p', payload.size || '9:16');
    created = await bratuha.createOperation('seedance-2-5', pricing.seedanceInput(scene));
  } else {
    const built = pricing.grokInput(payload.videoPrompt || 'Оживи изображение', refs, payload.size || '9:16', payload.duration || 6, payload.resolution || '480p');
    created = await bratuha.createOperation(built.tool, built.input);
  }
  if (!created.ok) {
    if (payload.videoPrice > 0) await db.credit(job.userId, payload.videoPrice);
    try { await vk.sendText(job.userId, 'Картинка выше уже готова. Видео запустить не удалось, эта часть суммы возвращена.', vk.menuKeyboard()); } catch (e) {}
    return;
  }
  await db.putJob({
    id: created.id,
    userId: job.userId,
    kind: 'video',
    price: 0,
    payload: { caption: 'Видео', refund: payload.videoPrice || 0 }
  });
}

async function spawnKit(job) {
  const kit = job.payload.kit;
  kit.spawned = true;
  await db.patchJob(job.id, { payload: job.payload, resultUrl: job.resultUrl });
  for (let index = 1; index < kit.items.length; index++) {
    const item = kit.items[index];
    const plan = layout.exPlan(item[0], item[1], item[2] || 1);
    const prompt = layout.exPrompt(layout.kitPrompt(kit.prompt, item, true), plan, item[0], item[1], item[2] || 1);
    const built = pricing.buildInput(kit.mode, prompt, plan.size, [job.resultUrl, kit.ref].filter(Boolean).join(' '));
    const created = built ? await bratuha.createOperation(built.tool, built.input) : { ok: false };
    if (!created.ok) {
      await db.credit(job.userId, kit.unit);
      try { await vk.sendText(job.userId, `Элемент «${layout.kitLabel(item)}» не запустился, ${kit.unit} ₽ возвращены.`, vk.menuKeyboard()); } catch (e) {}
      continue;
    }
    await db.putJob({
      id: created.id,
      userId: job.userId,
      kind: 'exact',
      price: 0,
      payload: {
        caption: layout.kitLabel(item),
        refund: kit.unit,
        ex: { W: item[0], H: item[1], N: item[2] || 1, kw: plan.kw, kh: plan.kh, label: layout.kitLabel(item) }
      }
    });
  }
}

async function safeDeliver(job) {
  try {
    await deliver(job);
  } catch (error) {
    const tries = Number(job.payload.tries || 0) + 1;
    job.payload.tries = tries;
    await db.patchJob(job.id, { payload: job.payload, resultUrl: job.resultUrl });
    if (tries >= 8) await refund(job, String(error.message || error));
  }
}

module.exports = {
  configure, runTemplate, createFree, chatPrompt, uploadChunk, initUser, claimDaily, hook, safeDeliver, moscowDay
};
