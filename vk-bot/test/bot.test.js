const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSeed } = require('../src/seed');
const pricing = require('../src/pricing');
const { userFromLaunch, signParams } = require('../src/launch');
const { parseFields, applyAnswers } = require('../src/templates');
const { exSize, exSizeList, slicePlan } = require('../src/layout');
const { slices } = require('../src/media');
const sharp = require('sharp');

const seed = loadSeed();

test('снимок таблицы переносит балансы без дублей', () => {
  assert.equal(seed.users.length, 199);
  assert.equal(seed.users.reduce((sum, user) => sum + user.balance, 0), 18123);
  assert.equal(seed.users.find(user => user.userId === '390221833').balance, 140);
  assert.equal(seed.payers.length > 100, true);
  assert.equal(seed.daily.length > 40, true);
  assert.equal(seed.usage.length > 700, true);
});

test('шаблоны сохраняют режим, цену и видимость', () => {
  assert.equal(seed.templates.length, 126);
  assert.equal(seed.templates.filter(item => item.visible).length, 105);
  const byId = id => seed.templates.find(item => item.id === id);
  assert.equal(byId('1').price, 9);
  assert.equal(byId('1').type, 'image');
  assert.equal(byId('1').mode, 'super');
  assert.equal(byId('3').type, 'chain');
  assert.equal(byId('3').price, 45);
  assert.equal(byId('27').price, 129);
  assert.equal(byId('44').type, 'video');
  assert.equal(byId('44').price, 36);
  assert.equal(byId('61').type, 'circle');
  assert.equal(byId('61').price, 60);
  assert.equal(byId('94').type, 'exact');
  assert.equal(byId('94').price, 9);
  assert.deepEqual(byId('94').pixels, [1080, 1920, 1]);
  assert.equal(byId('100').type, 'kit');
  assert.equal(byId('100').price, 45);
  assert.equal(byId('100').kitItems.length, 5);
  assert.equal(byId('1').prompt.length > 40, true);
  assert.equal(byId('1').fields.some(field => field.type === 'фото'), true);
});

test('цены моделей совпадают со скриптом ВК', () => {
  assert.equal(pricing.MODES.standard.price, 5);
  assert.equal(pricing.MODES.super.price, 9);
  assert.equal(pricing.MODES.nano2.price, 9);
  assert.equal(pricing.MODES.nanopro.price, 18);
  assert.equal(pricing.MODES.seedream.price, 11);
  assert.equal(pricing.MODES[pricing.gptKey('sunburst', 'medium', '2k', false)].price, 9);
  assert.equal(pricing.MODES[pricing.gptKey('flare', 'high', '4k', true)].price, 9);
  assert.equal(pricing.MODES[pricing.gptKey('sunburst', 'high', '4k', false)].price, 70);
  assert.equal(pricing.MODES[pricing.gpt6Key('sunburst', 'medium', '2k', 'm')].price, 25);
  assert.equal(pricing.videoPrice('480p', 6), 36);
  assert.equal(pricing.videoPrice('720p', 10), 120);
  assert.equal(pricing.topupBonus(1000), 80);
  assert.equal(pricing.topupBonus(500), 0);
  const gpt = pricing.gptKey('sunburst', 'medium', '2k', false);
  assert.equal(pricing.refExtra(gpt, 'https://a.test/1 https://a.test/2'), 0);
  assert.equal(pricing.refExtra(gpt, 'https://a.test/1 https://a.test/2 https://a.test/3'), 2);
  assert.equal(pricing.refExtra(pricing.gpt6Key('flare', 'low', '1k', 'l'), 'https://a.test/1'), 4);
  assert.equal(pricing.modelsForApp()[0].id, 'gpt6');
  assert.equal(pricing.modelsForApp()[1].id, 'gpt');
});

test('подпись запуска ВК и поля шаблона', () => {
  const now = Date.now();
  const params = { vk_user_id: '560405350', vk_ts: String(Math.floor(now / 1000)), vk_app_id: '54824593', vk_language: 'ru' };
  const sign = signParams(params, 'test-secret');
  const query = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).concat(`sign=${sign}`).join('&');
  assert.equal(userFromLaunch(query, 'test-secret', now), '560405350');
  assert.equal(userFromLaunch(query, 'other', now), null);
  assert.equal(userFromLaunch(query, 'test-secret', now + 3 * 864e5), null);
  const fields = parseFields('фото до 2?\nимя');
  assert.equal(fields[0].multi, 2);
  assert.equal(fields[0].optional, true);
  assert.equal(fields[1].key, 'имя');
  const filled = applyAnswers({
    fields: parseFields('имя; текст; Как вас зовут?\nвозраст; число; Сколько лет'),
    prompt: '{имя}, вам было {возраст-1}'
  }, { имя: 'Анна', возраст: '30' }, []);
  assert.equal(filled.prompt, 'Анна, вам было 29');
});

test('раскладка карусели и точного размера', () => {
  assert.deepEqual(exSize('1080x1920'), [1080, 1920, 1]);
  assert.deepEqual(exSize('376x256*3'), [376, 256, 3]);
  assert.equal(exSizeList('1080x1920,1920x768,1000x1000').length, 3);
  assert.equal(slicePlan(300, 200, 6).length, 6);
});

test('нарезка картинки отдаёт число слайдов', async () => {
  const image = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#336699' } }).png().toBuffer();
  const parts = await slices(image, 6);
  assert.equal(parts.length, 6);
  assert.equal(parts[0][0], 0x89);
});
