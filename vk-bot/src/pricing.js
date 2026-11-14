const GPT_SIZES = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3'];
const NANO_SIZES = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'];
const NANO21_SIZES = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1'];
const SEEDREAM_SIZES = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
const VIDEO_SIZES = ['auto', '1:1', '16:9', '9:16', '3:2', '2:3'];

const GPT_COST = {
  low: { '1k': 2, '2k': 2, '4k': 4 },
  medium: { '1k': 4, '2k': 4, '4k': 8 },
  high: { '1k': 16, '2k': 12, '4k': 31 },
  xhigh: { '1k': 29, '2k': 22, '4k': 54 },
  max: { '1k': 64, '2k': 48, '4k': 121 }
};
const GPT6_COST = {
  low: { '1k': 3, '2k': 6, '4k': 10 },
  medium: { '1k': 6, '2k': 11, '4k': 17 },
  high: { '1k': 7, '2k': 13, '4k': 21 },
  xhigh: { '1k': 11, '2k': 22, '4k': 37 },
  max: { '1k': 25, '2k': 50, '4k': 83 }
};
const GPT_MARKUP = 2.25;
const GPT_PHOTO_FREE = 2;
const GPT_PHOTO_PRICE = 2;
const GPT6_PHOTO_PRICE = 4;
const GPT6_CX = { l: 'low', m: 'medium', h: 'high' };
const CIRC_PRICE = 60;
const SLICER_PRICE = 10;
const TEXT_PRICE = 1;
const BONUS_TIERS = [{ from: 1000, percent: 8 }];
const SD_RATE = { '480p': 14, '720p': 28 };
const SD_RATE_VREF = { '480p': 8, '720p': 16 };
const SD_CLIENT_5S = 180;
const SD_EXTRA_MULT = 2.5;
const DAY_BONUS = 1;
const STREAK_DAYS = 7;
const STREAK_BONUS = 10;

const BASE_MODES = {
  standard: { price: 5, tool: 'gpt-image-2-5', title: 'GPT Image 2.5 Стандарт' },
  super: { price: 9, tool: 'gpt-image-2-5', title: 'GPT Image 2.5 Супер' },
  nano2: { price: 9, tool: 'nano-banana-2-1', title: 'Nano Banana 2.1' },
  nanopro: { price: 18, tool: 'nano-banana-pro', title: 'Nano Banana Pro' },
  seedream: { price: 11, tool: 'seedream-5-pro', title: 'Seedream 5 Pro' }
};

const HINTS = {
  standard: 'Быстро и недорого. Подходит для набросков, идей и простых картинок.',
  super: 'Лучшее качество и точность. Подходит для картинок с надписями, инфографики и сложных сцен.',
  nano2: 'Хорошо сохраняет лицо и детали на фото. Подходит для обработки фото: фон, одежда, образ.',
  nanopro: 'Максимальный реализм и детальность. Подходит для портретов и рекламных фото.',
  seedream: 'Яркие художественные картинки. Подходит для иллюстраций, арта и обложек.',
  gpt: 'Универсальная модель: рисует с нуля и редактирует по фото. Sunburst точнее, Flare быстрее. В экономном режиме качество Medium и выше стоит дешевле.',
  gpt6: 'Новая версия GPT Image: лучше держит плотный текст и сложную композицию. Каждое фото добавляет к цене.'
};

function pickSize(size, list, hasRef) {
  if (list.indexOf(size) >= 0) return size;
  return hasRef ? 'auto' : '1:1';
}

function getRefs(raw) {
  const s = String(raw || '').replace(/[\s,;"'<>\[\]()]+(?=https?:\/\/)/g, ' ');
  const found = s.match(/https?:\/\/\S+/g) || [];
  const uniq = [];
  found.forEach(u => {
    u = u.replace(/[,;"'<>\[\]()]+$/, '');
    if (uniq.indexOf(u) < 0) uniq.push(u);
  });
  return uniq.slice(0, 6);
}

function gptValid(variant, quality, resolution, cheap) {
  if (variant !== 'flare' && variant !== 'sunburst') return false;
  if (!GPT_COST[quality] || !GPT_COST[quality][resolution]) return false;
  if (cheap && quality === 'low') return false;
  if (cheap && variant === 'flare' && (quality === 'xhigh' || quality === 'max')) return false;
  return true;
}

function gptCost(quality, resolution, cheap) {
  return (cheap && quality !== 'low') ? 4 : GPT_COST[quality][resolution];
}

function gptKey(variant, quality, resolution, cheap) {
  return `gpt:${variant}:${quality}:${resolution}:${cheap ? 'c' : 'n'}`;
}

function gpt6Key(variant, quality, resolution, complexity) {
  return `gpt6:${variant}:${quality}:${resolution}:${complexity}`;
}

function buildModes() {
  const modes = {};
  for (const [id, spec] of Object.entries(BASE_MODES)) modes[id] = { ...spec };
  for (const variant of ['flare', 'sunburst']) {
    for (const quality of Object.keys(GPT_COST)) {
      for (const resolution of ['1k', '2k', '4k']) {
        for (const cheap of [false, true]) {
          if (!gptValid(variant, quality, resolution, cheap)) continue;
          modes[gptKey(variant, quality, resolution, cheap)] = {
            price: Math.ceil(gptCost(quality, resolution, cheap) * GPT_MARKUP),
            tool: 'gpt-image-2-5',
            variant, quality, resolution, cheap
          };
        }
      }
    }
  }
  for (const variant of ['flare', 'sunburst']) {
    for (const quality of Object.keys(GPT6_COST)) {
      for (const resolution of ['1k', '2k', '4k']) {
        for (const complexity of ['l', 'm', 'h']) {
          modes[gpt6Key(variant, quality, resolution, complexity)] = {
            price: Math.ceil(GPT6_COST[quality][resolution] * GPT_MARKUP),
            tool: 'gpt-image-2-6',
            variant, quality, resolution, complexity: GPT6_CX[complexity]
          };
        }
      }
    }
  }
  return modes;
}

const MODES = buildModes();

function sizesFor(modeKey) {
  const mode = MODES[modeKey];
  if (!mode) return GPT_SIZES;
  if (mode.tool === 'gpt-image-2-5' || mode.tool === 'gpt-image-2-6') return GPT_SIZES;
  if (modeKey === 'nano2') return NANO21_SIZES;
  if (modeKey === 'nanopro') return NANO_SIZES;
  if (modeKey === 'seedream') return SEEDREAM_SIZES;
  return GPT_SIZES;
}

function modeExact(modeKey, photos) {
  const mode = MODES[modeKey];
  if (!mode) return 0;
  const n = photos || 0;
  if (mode.tool === 'gpt-image-2-6') return mode.price + GPT6_PHOTO_PRICE * n;
  if (mode.tool === 'gpt-image-2-5') return mode.price + GPT_PHOTO_PRICE * Math.max(0, n - GPT_PHOTO_FREE);
  return mode.price;
}

function refExtra(modeKey, ref) {
  if (!MODES[modeKey]) return 0;
  return Math.max(0, modeExact(modeKey, getRefs(ref).length) - MODES[modeKey].price);
}

function videoPrice(resolution, duration) {
  const seconds = Math.ceil(Number(duration) || 1);
  return seconds * (resolution === '720p' ? 4 : 2) * 3;
}

function sdBaseClient(duration, resolution) {
  return SD_CLIENT_5S * (duration / 5) * (resolution === '720p' ? 2 : 1);
}

function sdBratuhaCost(scene) {
  if (!(scene.type === 'references' && scene.videos.length > 0)) return scene.duration * SD_RATE[scene.resolution];
  return scene.duration * SD_RATE_VREF[scene.resolution] + scene.videoSecBilled * SD_RATE_VREF[scene.resolution];
}

function sdClientPrice(scene) {
  const extra = Math.max(0, sdBratuhaCost(scene) - scene.duration * SD_RATE[scene.resolution]);
  return Math.ceil(sdBaseClient(scene.duration, scene.resolution) + extra * SD_EXTRA_MULT);
}

function topupBonus(amount) {
  for (const tier of BONUS_TIERS) {
    if (amount >= tier.from) return Math.floor(amount * tier.percent / 100);
  }
  return 0;
}

function gptPriceTable() {
  const table = { n: {}, c: {}, free: GPT_PHOTO_FREE, photo: GPT_PHOTO_PRICE };
  for (const quality of Object.keys(GPT_COST)) {
    table.n[quality] = {};
    table.c[quality] = {};
    for (const resolution of ['1k', '2k', '4k']) {
      table.n[quality][resolution] = Math.ceil(gptCost(quality, resolution, false) * GPT_MARKUP);
      table.c[quality][resolution] = Math.ceil(gptCost(quality, resolution, true) * GPT_MARKUP);
    }
  }
  return table;
}

function gpt6PriceTable() {
  const table = {};
  for (const quality of Object.keys(GPT6_COST)) {
    table[quality] = {};
    for (const resolution of ['1k', '2k', '4k']) table[quality][resolution] = Math.ceil(GPT6_COST[quality][resolution] * GPT_MARKUP);
  }
  return table;
}

function modelsForApp() {
  const base = ['nano2', 'nanopro', 'seedream'].map(id => ({
    id,
    title: BASE_MODES[id].title,
    hint: HINTS[id],
    price: MODES[id].price,
    sizes: sizesFor(id),
    maxPhotos: 6
  }));
  const gpt6 = {
    id: 'gpt6',
    title: 'GPT Image 2.6',
    hint: HINTS.gpt6,
    price: MODES[gpt6Key('sunburst', 'medium', '2k', 'm')].price,
    sizes: GPT_SIZES,
    maxPhotos: 6,
    gpt6: { price: gpt6PriceTable(), photo: GPT6_PHOTO_PRICE }
  };
  const gpt = {
    id: 'gpt',
    title: 'GPT Image 2.5',
    hint: HINTS.gpt,
    price: MODES[gptKey('sunburst', 'medium', '2k', false)].price,
    sizes: GPT_SIZES,
    maxPhotos: 6,
    gpt: gptPriceTable()
  };
  return [gpt6, gpt].concat(base);
}

function buildInput(modeKey, prompt, size, ref) {
  const mode = MODES[modeKey];
  if (!mode) return null;
  const refs = getRefs(ref);
  const hasRef = refs.length > 0;
  if (mode.tool === 'gpt-image-2-5' && mode.variant) {
    const input = {
      model_variant: mode.variant,
      prompt: String(prompt),
      quality: mode.quality,
      size: pickSize(size, GPT_SIZES, hasRef),
      resolution: mode.resolution,
      output_format: (mode.resolution === '4k' || mode.quality === 'low') ? 'jpeg' : 'png',
      background: 'auto',
      output_compression: 90,
      moderation: 'low'
    };
    if (mode.cheap) input.mode = 'cheap';
    if (hasRef) input.image_urls = refs;
    return { tool: mode.tool, input };
  }
  if (mode.tool === 'gpt-image-2-6') {
    const input = {
      model_variant: mode.variant,
      prompt: String(prompt).slice(0, 32000),
      quality: mode.quality,
      size: pickSize(size, GPT_SIZES, hasRef),
      resolution: mode.resolution,
      complexity: mode.complexity,
      output_format: (mode.resolution === '4k' || mode.quality === 'low') ? 'jpeg' : 'png',
      background: 'auto',
      output_compression: 90,
      moderation: 'low'
    };
    if (hasRef) input.image_urls = refs;
    return { tool: mode.tool, input };
  }
  if (modeKey === 'standard' || modeKey === 'super') {
    const preset = modeKey === 'super'
      ? { model_variant: 'sunburst', quality: 'medium', resolution: '2k', output_format: 'png' }
      : { model_variant: 'flare', quality: 'low', resolution: '1k', output_format: 'jpeg' };
    const input = {
      ...preset,
      prompt: String(prompt),
      size: pickSize(size, GPT_SIZES, hasRef),
      background: 'auto',
      output_compression: 85,
      moderation: 'low'
    };
    if (hasRef) input.image_urls = refs;
    else input.mode = 'normal';
    return { tool: mode.tool, input };
  }
  if (modeKey === 'nano2' || modeKey === 'nanopro') {
    const input = {
      mode: modeKey === 'nano2' ? 'cheap' : 'normal',
      prompt: String(prompt).slice(0, 20000),
      aspect_ratio: pickSize(size, modeKey === 'nano2' ? NANO21_SIZES : NANO_SIZES, hasRef),
      image_size: '4K'
    };
    if (hasRef) input.image_urls = refs;
    return { tool: mode.tool, input };
  }
  if (modeKey === 'seedream') {
    const input = {
      generation_mode: 'normal',
      prompt: String(prompt).slice(0, 5000),
      resolution: '1.5K',
      size: pickSize(size, SEEDREAM_SIZES, hasRef),
      output_format: 'jpeg'
    };
    if (hasRef) input.image_urls = refs;
    return { tool: mode.tool, input };
  }
  return null;
}

function resolveCreate(body) {
  const kind = String(body.kind || 'img');
  if (kind === 'vid') {
    const duration = [6, 10, 15].includes(Number(body.dur)) ? Number(body.dur) : 6;
    const resolution = body.res === '720p' ? '720p' : '480p';
    const size = VIDEO_SIZES.includes(String(body.size)) ? String(body.size) : 'auto';
    return { kind: 'video', price: videoPrice(resolution, duration), duration, resolution, size, photos: 4 };
  }
  if (kind === 'sd') return { kind: 'seedance' };
  if (body.model === 'gpt6') {
    const variant = body.g6v === 'flare' ? 'flare' : 'sunburst';
    const quality = GPT6_COST[body.g6q] ? body.g6q : 'medium';
    const resolution = ['1k', '2k', '4k'].includes(body.g6r) ? body.g6r : '2k';
    const complexity = ({ low: 'l', medium: 'm', high: 'h' })[body.g6x] || 'm';
    const key = gpt6Key(variant, quality, resolution, complexity);
    return { kind: 'image', key, sizes: GPT_SIZES };
  }
  if (body.model === 'gpt' || !body.model) {
    const variant = body.gv === 'flare' ? 'flare' : 'sunburst';
    const quality = GPT_COST[body.gq] ? body.gq : 'medium';
    const resolution = ['1k', '2k', '4k'].includes(body.gr) ? body.gr : '2k';
    const cheap = body.gc === true;
    if (cheap && !gptValid(variant, quality, resolution, true)) return { error: 'Это сочетание недоступно в экономном режиме' };
    return { kind: 'image', key: gptKey(variant, quality, resolution, cheap), sizes: GPT_SIZES };
  }
  if (!MODES[body.model] || !BASE_MODES[body.model] || body.model === 'standard' || body.model === 'super') {
    return { error: 'Выберите модель' };
  }
  return { kind: 'image', key: body.model, sizes: sizesFor(body.model) };
}

function seedanceInput(scene) {
  const input = {
    seedance_2_5_generation_type: scene.type,
    prompt: scene.prompt,
    size: scene.size,
    resolution: scene.resolution,
    duration: scene.duration,
    generate_audio: true,
    watermark: false,
    output_format: 'mp4'
  };
  if (scene.type === 'image') input.image_urls = scene.refs;
  else {
    if (scene.refs.length) input.reference_image_urls = scene.refs;
    if (scene.videos.length) input.video_urls = scene.videos;
    if (scene.audios.length) input.audio_urls = scene.audios;
  }
  return input;
}

function grokInput(prompt, photos, size, duration, resolution) {
  return {
    tool: 'grok-video-1-5',
    input: {
      prompt: String(prompt).slice(0, 4096),
      image_urls: photos.slice(0, 6),
      aspect_ratio: VIDEO_SIZES.includes(size) ? size : 'auto',
      duration,
      resolution
    }
  };
}

module.exports = {
  GPT_SIZES, NANO_SIZES, NANO21_SIZES, SEEDREAM_SIZES, VIDEO_SIZES,
  MODES, CIRC_PRICE, SLICER_PRICE, TEXT_PRICE, DAY_BONUS, STREAK_DAYS, STREAK_BONUS,
  getRefs, pickSize, modeExact, refExtra, videoPrice, sdClientPrice, sdBratuhaCost, sdBaseClient,
  topupBonus, modelsForApp, buildInput, resolveCreate, seedanceInput, grokInput, sizesFor,
  gptKey, gpt6Key
};
