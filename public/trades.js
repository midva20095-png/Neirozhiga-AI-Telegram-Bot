(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ASSIST_TRADES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CONTACT = { label: 'Контакты', text: 'Показать контакты из карточки' };
  const CATALOG = { label: 'Каталог', text: 'Показать товары сообщества' };
  const ORDER = { label: 'Как заказать', text: 'Показать, как оформить заказ' };
  const PAY = { label: 'Оплата', text: 'Показать способ оплаты' };
  const ADDRESS = { label: 'Адрес', text: 'Показать адрес' };
  const BOOK = { label: 'Записаться', text: 'Открыть свободные дни' };
  const SERVICES = { label: 'Услуги', text: 'Показать услуги' };

  function buttonsFor(kind, bookingOn) {
    const shop = [CONTACT, CATALOG, ORDER, PAY, ADDRESS, BOOK];
    const food = [CONTACT, ORDER, BOOK, PAY, ADDRESS];
    const service = [CONTACT, SERVICES, BOOK, PAY, ADDRESS];
    const list = kind === 'shop' || kind === 'delivery' ? shop : (kind === 'food' ? food : service);
    return (bookingOn ? list : list.filter((button) => button.label !== 'Записаться')).map((button) => ({ ...button }));
  }

  function trade(id, title, group, kind, services, extra) {
    const flags = {
      bookingOn: kind !== 'delivery',
      goodsOn: kind === 'shop' || kind === 'delivery',
      linkOn: kind === 'shop' || kind === 'delivery',
      orderOn: kind === 'shop' || kind === 'food' || kind === 'delivery',
      ...(extra || {}),
    };
    return {
      id,
      title,
      group,
      services: services || [],
      bookingOn: flags.bookingOn,
      goodsOn: flags.goodsOn,
      linkOn: flags.linkOn,
      orderOn: flags.orderOn,
      buttons: buttonsFor(kind, flags.bookingOn),
    };
  }

  const trades = [
    trade('shop', 'Магазин', 'Товары и еда', 'shop', []),
    trade('cake', 'Кондитерская', 'Товары и еда', 'shop', ['Торт', 'Бенто', 'Капкейки', 'Десерт']),
    trade('bakery', 'Пекарня', 'Товары и еда', 'shop', ['Хлеб', 'Выпечка', 'Торт', 'Пироги']),
    trade('flowers', 'Цветы', 'Товары и еда', 'shop', ['Букет', 'Композиция', 'Комнатные', 'Доставка']),
    trade('cafe', 'Кафе', 'Товары и еда', 'food', ['Столик', 'Навынос', 'Банкет']),
    trade('food', 'Доставка еды', 'Товары и еда', 'delivery', []),
    trade('nails', 'Маникюр', 'Красота', 'service', ['Маникюр', 'Педикюр', 'Покрытие', 'Снятие']),
    trade('hair', 'Парикмахер', 'Красота', 'service', ['Стрижка', 'Окрашивание', 'Укладка', 'Уход']),
    trade('barber', 'Барбершоп', 'Красота', 'service', ['Стрижка', 'Борода', 'Комплекс', 'Бритьё']),
    trade('brows', 'Брови и ресницы', 'Красота', 'service', ['Брови', 'Ресницы', 'Ламинирование', 'Коррекция']),
    trade('cosmo', 'Косметолог', 'Красота', 'service', ['Чистка', 'Уход', 'Пилинг', 'Консультация']),
    trade('makeup', 'Визаж', 'Красота', 'service', ['Макияж', 'Причёска', 'Репетиция']),
    trade('depil', 'Эпиляция', 'Красота', 'service', ['Одна зона', 'Комплекс', 'Консультация']),
    trade('massage', 'Массаж', 'Красота', 'service', ['Спина', 'Общий', 'Спортивный', 'Лимфодренаж']),
    trade('tattoo', 'Тату и пирсинг', 'Красота', 'service', ['Консультация', 'Сеанс', 'Коррекция', 'Пирсинг']),
    trade('spa', 'СПА', 'Красота', 'service', ['Программа', 'Массаж', 'Уход']),
    trade('groom', 'Грумер', 'Животные', 'service', ['Комплекс', 'Стрижка', 'Мытьё', 'Когти']),
    trade('vet', 'Ветеринар', 'Животные', 'service', ['Приём', 'Вакцинация', 'Обработка', 'Консультация']),
    trade('tire', 'Шиномонтаж', 'Авто', 'service', ['Шиномонтаж', 'Ремонт', 'Балансировка', 'Сезонная смена']),
    trade('auto', 'Автосервис', 'Авто', 'service', ['Диагностика', 'Ремонт', 'ТО', 'Замена масла']),
    trade('wash', 'Автомойка', 'Авто', 'service', ['Кузов', 'Салон', 'Комплекс']),
    trade('detail', 'Детейлинг', 'Авто', 'service', ['Полировка', 'Химчистка', 'Керамика', 'Комплекс']),
    trade('tow', 'Эвакуатор', 'Авто', 'service', ['Эвакуация', 'Техпомощь', 'Подвоз']),
    trade('clean', 'Клининг', 'Дом', 'service', ['Поддерживающая', 'Генеральная', 'После ремонта', 'Окна']),
    trade('plumb', 'Сантехник', 'Дом', 'service', ['Вызов', 'Замена', 'Установка']),
    trade('electric', 'Электрик', 'Дом', 'service', ['Вызов', 'Замена', 'Монтаж']),
    trade('renovation', 'Ремонт квартир', 'Дом', 'service', ['Замер', 'Консультация', 'Ремонт']),
    trade('handyman', 'Мастер на час', 'Дом', 'service', ['Сборка', 'Навес', 'Мелкий ремонт']),
    trade('furniture', 'Сборка мебели', 'Дом', 'service', ['Сборка', 'Разборка', 'Установка']),
    trade('dental', 'Стоматология', 'Здоровье и спорт', 'service', ['Осмотр', 'Лечение', 'Чистка', 'Консультация']),
    trade('fitness', 'Фитнес', 'Здоровье и спорт', 'service', ['Персональная', 'Групповая', 'Пробная']),
    trade('yoga', 'Йога', 'Здоровье и спорт', 'service', ['Группа', 'Лично', 'Пробная']),
    trade('psych', 'Психолог', 'Здоровье и спорт', 'service', ['Консультация', 'Повторная']),
    trade('tutor', 'Репетитор', 'Обучение и услуги', 'service', ['Пробный урок', 'Занятие', 'Экзамен']),
    trade('kids', 'Детский центр', 'Обучение и услуги', 'service', ['Занятие', 'Пробное', 'День рождения']),
    trade('music', 'Музыка', 'Обучение и услуги', 'service', ['Пробный', 'Урок', 'Репетиция']),
    trade('dance', 'Танцы', 'Обучение и услуги', 'service', ['Пробное', 'Группа', 'Индивидуально']),
    trade('photo', 'Фотограф', 'Обучение и услуги', 'service', ['Съёмка', 'Обработка', 'Консультация']),
    trade('video', 'Видео', 'Обучение и услуги', 'service', ['Съёмка', 'Монтаж', 'Консультация']),
    trade('phone', 'Ремонт телефонов', 'Обучение и услуги', 'service', ['Диагностика', 'Экран', 'Батарея']),
    trade('tech', 'Ремонт техники', 'Обучение и услуги', 'service', ['Диагностика', 'Ремонт', 'Обслуживание']),
    trade('atelier', 'Ателье', 'Обучение и услуги', 'service', ['Подгонка', 'Пошив', 'Ремонт']),
    trade('dry', 'Химчистка', 'Обучение и услуги', 'service', ['Одежда', 'Обувь', 'Шторы', 'Ковёр']),
    trade('print', 'Полиграфия', 'Обучение и услуги', 'service', ['Визитки', 'Печать', 'Макет']),
    trade('realty', 'Недвижимость', 'Обучение и услуги', 'service', ['Показ', 'Консультация']),
  ];

  const groups = [];
  for (const item of trades) {
    if (!groups.includes(item.group)) groups.push(item.group);
  }

  function tradeById(id) {
    return trades.find((item) => item.id === id) || trades[0];
  }

  function servicePrice(value) {
    const text = String(value == null ? '' : value).replace(/\s+/g, '').replace(/₽/g, '').replace(/руб\.?/gi, '').replace(/р$/i, '');
    if (!/^\d{1,7}$/.test(text)) return 0;
    const price = Number(text);
    if (!Number.isSafeInteger(price) || price < 1 || price > 1000000) return 0;
    return price;
  }

  function serviceLink(value) {
    const link = String(value || '').trim();
    if (!link || link.length > 300 || /\s/.test(link)) return '';
    try {
      const url = new URL(link);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function serviceItem(raw) {
    if (raw && typeof raw === 'object') {
      const name = String(raw.name || raw.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) return null;
      const extra = raw.extra === true || raw.extra === 'true' || raw.extra === 1 || raw.extra === '1';
      const text = String(raw.text || raw.about || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const row = { name: name, price: servicePrice(raw.price), link: serviceLink(raw.link), extra: extra };
      if (text) row.text = text;
      return row;
    }
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 40) return null;
    return { name: name, price: 0, link: '', extra: false };
  }

  function cleanServices(value, tradeId) {
    const preset = tradeById(tradeId).services.slice(0, 8).map(serviceItem).filter(Boolean);
    if (value == null) return preset;
    const source = Array.isArray(value) ? value : String(value).split(',');
    const out = [];
    const seen = {};
    for (var index = 0; index < source.length; index += 1) {
      const clean = serviceItem(source[index]);
      const key = clean && clean.name.toLowerCase();
      if (!clean || seen[key]) continue;
      seen[key] = true;
      out.push(clean);
      if (out.length >= 8) break;
    }
    return out;
  }

  function sectionName(value) {
    const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name || /^(назад|оформить заказ|товары|услуги|записаться|каталог|общий каталог|витрина|добавить|убрать)$/i.test(name)) return '';
    return name;
  }

  function pushProduct(out, seen, item, section) {
    const clean = serviceItem(item);
    const place = sectionName(section);
    const key = clean && (place.toLowerCase() + '|' + clean.name.toLowerCase());
    if (!clean || seen[key] || out.length >= 64) return false;
    seen[key] = true;
    const row = { name: clean.name, price: clean.price, link: clean.link };
    if (clean.text) row.text = clean.text;
    if (place) row.section = place;
    out.push(row);
    return true;
  }

  function cleanProducts(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = {};
    var nested = false;
    for (var check = 0; check < value.length; check += 1) {
      if (value[check] && Array.isArray(value[check].items)) nested = true;
    }
    if (!nested) {
      for (var index = 0; index < value.length; index += 1) pushProduct(out, seen, value[index], value[index] && value[index].section);
      return out;
    }
    var sections = 0;
    for (var blockIndex = 0; blockIndex < value.length; blockIndex += 1) {
      if (sections >= 8) break;
      const block = value[blockIndex];
      const items = block && Array.isArray(block.items) ? block.items : [];
      var count = 0;
      var used = false;
      for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        if (count >= 8) break;
        if (!pushProduct(out, seen, items[itemIndex], block && (block.name || block.title))) continue;
        count += 1;
        used = true;
      }
      if (used) sections += 1;
    }
    return out;
  }

  return { trades, groups, tradeById, cleanServices, cleanProducts, buttonsFor };
});
