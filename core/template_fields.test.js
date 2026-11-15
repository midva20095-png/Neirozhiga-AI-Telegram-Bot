const test = require('node:test');
const assert = require('node:assert/strict');
const fields = require('./template_fields');

test('строки таблицы становятся полями, пустой шаблон остаётся без полей', () => {
    assert.deepEqual(fields.parseFields(''), []);
    const parsed = fields.parseFields([
        'фото | Портрет | до 2',
        'текст | имя | Как зовут?',
        'выбор | стиль | Стиль | Неон; Плёнка',
        'дата | дата | Дата рождения | необязательно'
    ].join('\n'));
    assert.equal(parsed[0].key, 'фото1');
    assert.equal(parsed[0].multi, 2);
    assert.equal(parsed[1].key, 'имя');
    assert.deepEqual(parsed[2].options, ['Неон', 'Плёнка']);
    assert.equal(parsed[3].optional, true);
});

test('ответы встают в текст запроса, дата даёт знак', () => {
    const list = fields.parseFields('текст | имя | Имя\nдата | дата | Дата');
    const prompt = fields.buildPrompt('Портрет {имя}, знак {знак}.', list, { имя: 'Маша', дата: '2000-05-14' });
    assert.match(prompt, /^Портрет Маша, знак Телец\./);
    assert.match(prompt, /Дата: 2000-05-14/);
    assert.equal(fields.zodiacSign('14.05.2000'), 'Телец');
    const extra = fields.buildPrompt('Просто портрет.', list, { имя: 'Маша' });
    assert.match(extra, /Имя: Маша/);
});

test('без обязательного ответа шаблон не запускается', () => {
    const list = fields.parseFields('фото | Лицо\nтекст | имя | Имя');
    assert.equal(fields.missing(list, {}, 1), 'Заполните: Имя');
    assert.equal(fields.missing(list, { имя: 'Маша' }, 0), 'Добавьте фото');
    assert.equal(fields.missing(list, { имя: 'Маша' }, 1), '');
    assert.equal(fields.missing([], {}, 0), '');
});
