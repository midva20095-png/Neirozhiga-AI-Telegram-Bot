const { GPT_SIZES, NANO21_SIZES, NANO_SIZES, SEEDREAM_SIZES, MODES } = require('./pricing');

const EX_ZONES = { '1920x768': [120, 150, 1800, 730], '1080x1920': [190, 640, 890, 1140] };

function exSize(value) {
  const match = String(value || '').toLowerCase().replace(/[хx×]/g, 'x').match(/(\d{3,5})\s*x\s*(\d{3,5})(?:\s*\*\s*(\d))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 1)] : null;
}

function exSizeList(value) {
  return String(value || '').split(/[,;\s]+/).map(exSize).filter(Boolean);
}

function exPlan(width, height, tiles) {
  const count = tiles || 1;
  const ratio = width / (height * count);
  let best = null;
  let bestDelta = 99;
  GPT_SIZES.forEach(size => {
    if (size === 'auto') return;
    const parts = size.split(':');
    const current = parts[0] / parts[1];
    const delta = Math.abs(Math.log(current / ratio));
    if (delta < bestDelta) { bestDelta = delta; best = { size, ratio: current }; }
  });
  let keepW = 1;
  let keepH = 1;
  if (best.ratio > ratio) keepW = ratio / best.ratio;
  else keepH = best.ratio / ratio;
  const zone = EX_ZONES[`${width}x${height}`] || [width * 0.1, height * 0.1, width * 0.9, height * 0.9];
  const fx = value => (1 - keepW) / 2 + (value / width) * keepW;
  const fy = value => (1 - keepH) / 2 + (value / height) * keepH;
  return {
    size: best.size,
    kw: keepW,
    kh: keepH,
    zone: count > 1 ? null : [fx(zone[0]), fy(zone[1]), fx(zone[2]), fy(zone[3])],
    topFree: (count === 1 && width === 1920 && height === 768) ? fy(126) : 0
  };
}

function exPrompt(prompt, plan, width, height, tiles) {
  const percent = value => `${Math.round(value * 100)}%`;
  if (tiles > 1) {
    return `${prompt}\n\nФОРМАТ (строго): один лист из ${tiles} одинаковых плиток, расположенных друг под другом (1 колонка, ${tiles} ряда), без промежутков и рамок между ними, строго равной высоты. Каждая плитка отдельная картинка в едином стиле. Текст каждой плитки крупный, чёткий, по центру плитки с отступом не менее 12% от её краёв.`;
  }
  return `${prompt}\n\nПОДРЕЗКА И ЗОНЫ (строго): картинка будет автоматически подрезана под площадку (итоговый размер ${width}×${height} px). Весь текст и все важные объекты размещай ТОЛЬКО внутри центральной зоны: по ширине от ${percent(plan.zone[0])} до ${percent(plan.zone[2])} и по высоте от ${percent(plan.zone[1])} до ${percent(plan.zone[3])} холста. Вне этой зоны только фон и декор.` +
    (plan.topFree > 0 ? ` Верхние ${percent(plan.topFree)} высоты холста оставь пустыми: только фон.` : '') +
    (width === 1080 && height === 1920 ? ' В нижнем левом углу не размещай ничего важного.' : '');
}

function carGrid(count) {
  return ({ 3: [3, 1, '3:1'], 6: [3, 2, '3:2'], 8: [4, 2, '2:1'], 9: [3, 3, '1:1'] })[count] || [3, 2, '3:2'];
}

function carNorm(mode, count) {
  const n = [3, 6, 8, 9].includes(Number(count)) ? Number(count) : 6;
  const list = /^(super|standard|gpt6?:)/.test(mode) ? GPT_SIZES : (mode === 'nano2' ? NANO21_SIZES : (mode === 'nanopro' ? NANO_SIZES : SEEDREAM_SIZES));
  return list.includes(carGrid(n)[2]) ? n : 6;
}

function carPrompt(prompt, count) {
  const grid = carGrid(count);
  return `${prompt}\n\nФОРМАТ ЛИСТА (строго): один лист-коллаж из ${count} одинаковых квадратных карточек, сетка ${grid[0]} колонки на ${grid[1]} ряд(а), слева направо и сверху вниз. Карточки строго одного размера, без наложений, между ними тонкие одинаковые светлые промежутки, без внешней рамки. Всё важное находится внутри своей карточки.`;
}

function circPrompt(prompt) {
  return `${prompt}\n\nФОРМАТ (строго): квадратная картинка 1:1. В ней один идеально круглый макет для печати: окружность с тонкой ровной рамкой, занимающая почти весь квадрат (отступ от краёв не более 3%). ФОН ЗА ПРЕДЕЛАМИ ОКРУЖНОСТИ: сплошная однотонная ярко-пурпурная заливка (цвет #FF00FF). Всё содержимое макета находится строго внутри окружности.`;
}

function kitRole(item) {
  const key = `${item[0]}x${item[1]}`;
  const tiles = item[2] || 1;
  if (key === '1080x1920') return 'vcover';
  if (key === '1920x768') return 'hcover';
  if (key === '1000x1000') return 'avatar';
  if (tiles > 1 && key === '376x256') return 'menu';
  return 'widget';
}

function kitLabel(item) {
  const role = kitRole(item);
  const name = { vcover: 'Вертикальная обложка', hcover: 'Горизонтальная обложка', avatar: 'Аватар', menu: 'Меню', widget: 'Виджеты' }[role];
  return role === 'widget' ? `${name} ${item[0]}×${item[1]}` : name;
}

function kitFilter(prompt, role) {
  const out = [];
  String(prompt).split('\n').forEach(line => {
    const match = line.match(/^\s*@(меню|виджеты|обложка|аватар)\s*:\s*(.*)$/i);
    if (!match) { out.push(line); return; }
    const tag = match[1].toLowerCase();
    if ((tag === 'меню' && role === 'menu') || (tag === 'виджеты' && role === 'widget') || (tag === 'обложка' && (role === 'vcover' || role === 'hcover')) || (tag === 'аватар' && role === 'avatar')) out.push(match[2]);
  });
  return out.join('\n');
}

function kitPrompt(prompt, item, hasAnchor) {
  const role = kitRole(item);
  const filtered = kitFilter(prompt, role);
  const anchor = hasAnchor ? 'Повтори палитру, шрифт и орнамент приложенного образца. ' : '';
  return `${anchor}${filtered}`.trim();
}

function slicePlan(width, height, count) {
  const grid = carGrid(count);
  const cols = grid[0];
  const rows = grid[1];
  const want = cols / rows;
  let frameW = width;
  let frameH = height;
  let x0 = 0;
  let y0 = 0;
  if (frameW / frameH > want) { frameW = Math.round(frameH * want); x0 = Math.round((width - frameW) / 2); }
  else { frameH = Math.round(frameW / want); y0 = Math.round((height - frameH) / 2); }
  const cellW = frameW / cols;
  const cellH = frameH / rows;
  const inset = Math.round(Math.min(cellW, cellH) * 0.01);
  const parts = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      parts.push({
        left: x0 + Math.round(col * cellW) + inset,
        top: y0 + Math.round(row * cellH) + inset,
        width: Math.round(cellW) - 2 * inset,
        height: Math.round(cellH) - 2 * inset
      });
    }
  }
  return parts;
}

function exactCrops(imageW, imageH, spec) {
  const tiles = spec.N || 1;
  const cropW = Math.round(imageW * spec.kw);
  const cropH = Math.round(imageH * spec.kh);
  const originX = Math.round((imageW - cropW) / 2);
  const originY = Math.round((imageH - cropH) / 2);
  const parts = [];
  for (let index = 0; index < tiles; index++) {
    const tileH = cropH / tiles;
    const inset = tiles > 1 ? Math.round(tileH * 0.01) : 0;
    parts.push({
      left: originX + inset,
      top: originY + Math.round(index * tileH) + inset,
      width: cropW - 2 * inset,
      height: Math.round(tileH) - 2 * inset,
      outW: spec.W,
      outH: spec.H
    });
  }
  return parts;
}

function knownMode(key) {
  return !!MODES[key];
}

module.exports = {
  exSize, exSizeList, exPlan, exPrompt, carGrid, carNorm, carPrompt, circPrompt,
  kitRole, kitLabel, kitPrompt, slicePlan, exactCrops, knownMode
};
