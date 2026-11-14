const { MODES, CIRC_PRICE, SLICER_PRICE, videoPrice, getRefs } = require('./pricing');
const { exSize, exSizeList } = require('./layout');

const QUICK = {
  'фото': { type: 'фото', label: 'Ваше фото' },
  'имя': { type: 'текст', label: 'Как вас зовут?' },
  'возраст': { type: 'число', label: 'Сколько вам лет?' },
  'пол': { type: 'выбор', label: 'Ваш пол', options: ['Мужской', 'Женский'] },
  'рождение': { type: 'дата', label: 'Дата рождения' },
  'профессия': { type: 'текст', label: 'Ваша профессия' },
  'город': { type: 'текст', label: 'Ваш город' },
  'хобби': { type: 'текст', label: 'Ваше хобби' },
  'слайды': { type: 'выбор', label: 'Сколько частей (слайдов)', options: ['3', '6', '8', '9'] },
  'диаметр': { type: 'выбор', label: 'Диаметр макета, см', options: ['8', '10', '11', '12', '14', '16', '18', '20'] },
  'рецепт': { type: 'длинный', label: 'Вставьте текст рецепта (ингредиенты и шаги)' }
};

function driveImage(url, size) {
  const value = String(url || '').trim();
  const match = value.match(/\/d\/([\w-]+)/) || value.match(/[?&]id=([\w-]+)/);
  return match ? `https://drive.google.com/thumbnail?sz=${size}&id=${match[1]}` : value;
}

function driveFile(url) {
  const value = String(url || '').trim();
  const match = value.match(/\/d\/([\w-]+)/) || value.match(/[?&]id=([\w-]+)/);
  return match ? `https://drive.google.com/uc?export=download&id=${match[1]}` : value;
}

function driveLinks(text) {
  return String(text || '').split(/[\s,;]+/).map(item => driveImage(item, 'w2000')).filter(url => /^https?:\/\//.test(url));
}

function normSize(value) {
  const text = String(value == null ? '' : value).trim();
  const match = text.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  return match ? `${Number(match[1])}:${Number(match[2])}` : text;
}

function parseFields(text) {
  const out = [];
  String(text || '').split('\n').forEach(line => {
    if (line.indexOf(';') >= 0) {
      const parts = line.split(';').map(item => item.trim());
      if (parts[0] && parts[1]) {
        out.push({
          key: parts[0],
          type: parts[1].toLowerCase(),
          label: parts[2] || parts[0],
          options: (parts[3] || '').split(',').map(item => item.trim()).filter(Boolean)
        });
      }
      return;
    }
    line.split(',').map(item => item.trim().toLowerCase()).filter(Boolean).forEach(word => {
      const photo = word.match(/^фото(?:\s+до\s+(\d+))?(\?)?$/);
      if (photo) {
        const count = Math.min(5, Number(photo[1]) || 0);
        out.push({
          key: 'фото',
          type: 'фото',
          options: [],
          multi: count,
          optional: !!photo[2],
          label: `${count ? `Ваши фото (до ${count}), по порядку` : 'Ваше фото'}${photo[2] ? ' (необязательно)' : ''}`
        });
        return;
      }
      const quick = QUICK[word];
      if (quick) out.push({ key: word, type: quick.type, label: quick.label, options: quick.options || [] });
    });
  });
  if (!out.length) out.push({ key: 'фото', type: 'фото', label: 'Ваше фото', options: [] });
  return out;
}

function classify(row, index) {
  const title = String(row[1] || '').trim();
  if (!title) return null;
  const id = String(row[0] || '').trim() || String(index + 1);
  const modeRaw = String(row[4] || '').trim().toLowerCase();
  const video = modeRaw === 'video';
  const chain = modeRaw === 'chain';
  const circle = modeRaw === 'circle';
  const seedance = modeRaw === 'seedance';
  const chainSeedance = modeRaw === 'chainsd';
  const slicer = modeRaw === 'slicer';
  const exact = modeRaw === 'exact';
  const kit = modeRaw === 'kit';
  const carousel = modeRaw === 'carousel' || circle;
  const imageModeRaw = String(row[13] || '').trim().toLowerCase();
  const imageMode = MODES[imageModeRaw] ? imageModeRaw : 'super';
  const key = (!video && !chain && !carousel && !seedance && !chainSeedance && !slicer && !exact && !kit && MODES[modeRaw]) ? modeRaw : 'standard';
  const seconds = parseInt(row[10], 10);
  const sdDur = [5, 10, 15, 20, 25, 30].includes(seconds) ? seconds : 5;
  const resolution = String(row[11] || '').trim() === '720p' ? '720p' : '480p';
  const duration = Math.min(15, Math.max(1, parseInt(row[10], 10) || 6));
  const clipPrice = videoPrice(resolution, duration);
  const seedancePrice = Math.ceil(180 * sdDur / 5 * (resolution === '720p' ? 2 : 1));
  const sizeText = normSize(row[5]);
  const pixels = exact ? exSize(sizeText) : null;
  const kitItems = kit ? exSizeList(sizeText) : [];
  let type = 'image';
  if (chain) type = 'chain';
  else if (video) type = 'video';
  else if (kit) type = 'kit';
  else if (exact) type = 'exact';
  else if (slicer) type = 'slicer';
  else if (chainSeedance) type = 'chainsd';
  else if (seedance) type = 'seedance';
  else if (circle) type = 'circle';
  else if (carousel) type = 'carousel';
  const generationMode = (chain || carousel || chainSeedance || exact || kit) ? imageMode : key;
  let price = MODES[key].price;
  if (kit) price = kitItems.length * MODES[imageMode].price;
  else if (exact) price = MODES[imageMode].price;
  else if (slicer) price = SLICER_PRICE;
  else if (chainSeedance) price = MODES[imageMode].price + seedancePrice;
  else if (seedance) price = seedancePrice;
  else if (chain) price = MODES[imageMode].price + clipPrice;
  else if (video) price = clipPrice;
  else if (circle) price = CIRC_PRICE;
  else if (carousel) price = MODES[imageMode].price;
  return {
    id,
    sort: index,
    title,
    description: String(row[2] || ''),
    image: driveImage(row[3], 'w600'),
    video: driveFile(row[14]),
    visible: String(row[8] || '').trim().toLowerCase() !== 'нет',
    trend: String(row[9] || '').trim().toLowerCase() === 'да',
    type,
    mode: generationMode,
    size: sizeText || '1:1',
    prompt: String(row[6] || ''),
    videoPrompt: String(row[12] || ''),
    categories: String(row[15] || '').split(/[,;]/).map(item => item.trim()).filter(Boolean),
    fixImages: driveLinks(row[16]),
    fixVideos: driveLinks(row[17]),
    fieldsRaw: String(row[7] || ''),
    fields: parseFields(row[7]),
    duration,
    sdDuration: sdDur,
    resolution,
    pixels,
    kitItems,
    price
  };
}

function publicTemplate(template, stats) {
  const usage = stats[template.id] || {};
  return {
    id: template.id,
    title: template.title,
    desc: template.description,
    image: template.image,
    video: template.video || '',
    type: template.type,
    price: template.price,
    trend: template.trend,
    cats: template.categories || [],
    fields: template.fields,
    today: usage.today || 0,
    week: usage.week || 0
  };
}

function applyAnswers(template, answers, photos) {
  const fields = template.fields || [];
  const subs = [];
  let slots = 0;
  let required = 0;
  for (const field of fields) {
    if (field.type === 'фото') {
      slots += field.multi || 1;
      if (!field.optional) required += 1;
      continue;
    }
    const long = field.type === 'длинный';
    let value = String(answers[field.key] == null ? '' : answers[field.key]).replace(long ? /[{}]/g : /[\r\n{}]/g, ' ').trim().slice(0, long ? 6000 : 600);
    if (!value) return { error: `Заполните: ${field.label}` };
    if (field.type === 'выбор' && (field.options || []).indexOf(value) < 0) return { error: `Выберите вариант: ${field.label}` };
    if (field.type === 'дата') value = value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1');
    if (field.type === 'число') {
      const number = parseInt(value, 10);
      if (!(number >= 0 && number < 1000)) return { error: `Введите число: ${field.label}` };
      value = String(number);
      subs.push([`{${field.key}-1}`, String(number - 1)], [`{${field.key}+1}`, String(number + 1)]);
    }
    subs.push([`{${field.key}}`, value]);
  }
  const list = Array.isArray(photos) ? photos : [];
  if (list.length < required) return { error: 'Загрузите фото' };
  const apply = source => subs.reduce((text, pair) => text.split(pair[0]).join(pair[1]), String(source || ''));
  return {
    prompt: apply(template.prompt),
    videoPrompt: apply(template.videoPrompt),
    photos: list.slice(0, slots),
    slides: Number(answers['слайды']) || 6,
    diameter: Number(answers['диаметр']) || 12
  };
}

function referenceList(template, uploaded) {
  return getRefs((template.fixImages || []).concat(uploaded).join(' '));
}

module.exports = { parseFields, classify, publicTemplate, applyAnswers, referenceList, driveImage, driveLinks };
