const axios = require('axios');
const audit = require('./vk-audit');

const GROUP_ID = '214554778';
const JOIN_URL = 'https://vk.com/donut/club214554778';
const SITE_URL = 'https://babayagaland.ru/';
const ASK_URL = 'https://vk.me/neuroyaga';

const LEVELS = [
    {
        name: 'Фудфото',
        price: '50 ₽ в месяц',
        about: 'Чек-листы, гайды и уроки по фото без дизайнера.',
        url: 'https://vk.com/@neuroyaga-navigaciya-po-urovnu-fudfoto-chek-listy-pdf-gaidy',
        keys: 'фудфото фото фотограф визуал чеклист гайд'
    },
    {
        name: 'Бабка-таргетолог',
        price: 'включает уровень «Фудфото»',
        about: 'Ведение сообщества: оформление, посты, боты, рассылки, игры, карточки товаров. Чат поддержки круглосуточно. 2 макета в месяц у дизайнера бесплатно, следующий макет 50 ₽.',
        url: 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa',
        keys: 'бабка таргетолог сообщество оформление пост бот рассылка виджет меню макет дизайнер поддержка'
    },
    {
        name: 'Базовая поддержка по ИИ',
        price: 'включает «Фудфото» и «Бабку-таргетолога»',
        about: 'Промпты, практикумы по фото и карточкам, генерация картинок и видео. В месяц 6 бесплатных генераций в Яга-генераторе.',
        url: 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po',
        pay: 'https://vk.com/neuroyaga?w=donut_payment-214554778&levelId=2538',
        keys: 'ии нейросет промпт генерац картинк видео клип карточка'
    }
];

const LESSONS = [
    ['Обложки сообщества с помощью ИИ', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'обложка шапка сообщество ии'],
    ['Аватар и обложка с помощью ИИ', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'аватар обложка ии'],
    ['Меню и виджеты с помощью нейросети', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'меню виджет нейросет'],
    ['Карточки товаров и услуг с помощью ИИ', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'карточк товар услуг ии'],
    ['Чистота фото, фон и текст', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'фон текст чистот фото ии'],
    ['Оживление фото', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'оживл фото видео ии'],
    ['Промпты для кондитеров, обложек и маркетплейсов', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'промпт кондитер маркетплейс фон фотосесс'],
    ['Прайс с помощью ИИ за 5 минут', 'https://vk.com/@neuroyaga-navigaciya-po-urokam-kluba-na-urovne-bazovaya-podderzhka-po', 'прайс ии'],
    ['Клип «Полёт над сладкой страной»', 'https://vk.ru/@neuroyaga-urok-po-sozdaniu-klipa-polet-nad-sladkoi-stranoi', 'клип полет сладк стран нейросет'],
    ['Клип «Полёт на драконе»', 'https://vk.ru/@neuroyaga-urok-po-sozdaniu-klipa-s-pomoschu-neirosetei-polet-na-drakon', 'клип дракон полет нейросет'],
    ['Создание сообщества ВК', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'создан сообществ урок'],
    ['Живая и статическая обложка', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'обложка живая статическ'],
    ['Товары, обсуждения и фотоальбомы', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'товар обсужден фотоальбом'],
    ['Карточки услуг ВК', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'карточк услуг'],
    ['Меню и виджеты сообщества', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'меню виджет'],
    ['Сайт-визитка из сообщества', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'сайт визитк'],
    ['Алгоритмы ВК и контент-план', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'алгоритм контент пост знакомств'],
    ['Игры, конкурсы и активности', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'игр конкурс активност рулетк'],
    ['Боты, рассылки и воронки', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'бот рассылк воронк сенлер триггер'],
    ['Клипы: съёмка, монтаж, публикация', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'клип съемк монтаж публикац'],
    ['Маркировка, таргет и маркет-платформа', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'маркировк таргет маркет парсинг'],
    ['Оформление в SUPA', 'https://vk.com/@neuroyaga-navigator-po-klubu-babki-targetologa', 'дизайн supa редактор оформлен']
];

function words(value) {
    return (String(value || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]{4,}/g) || [])
        .map(word => word.slice(0, 5));
}

function wantsLevels(query) {
    return /подписк|донаг|донат|дон\b|уровн|клуб|сколько стоит|цен[аеуы]/i.test(query);
}

function wantsSite(query) {
    return /сайт|генератор|приложен/i.test(query);
}

function overview() {
    const levels = LEVELS.map((level, index) => (
        `${index + 1}. ${level.name} — ${level.price}\n${level.about}\n${level.url}`
    )).join('\n\n');
    return `Клуб «НейроЯга». Кредиты не списываются.

Напишите, что найти: урок, обложку, бота, клип, виджет или подписку.

Подписки VK Донат:
${levels}

Вступить: ${JOIN_URL}
Вопросы по клубу: ${ASK_URL}
Сайт: ${SITE_URL}

Описание всех уровней: https://vk.com/@neuroyaga-opisanie-nashego-vip-kluba-neiroyaga-chto-vnutri-kakie-urovn

«Назад» возвращает меню.`;
}

function rankLessons(query) {
    const need = words(query);
    if (!need.length) return [];
    return LESSONS.map(item => {
        const hay = words(`${item[0]} ${item[2]}`).join(' ');
        const score = need.filter(word => hay.includes(word)).length;
        return { title: item[0], url: item[1], score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
}

function reply(query, posts) {
    const text = String(query || '').trim();
    if (!text || wantsLevels(text) && rankLessons(text).length === 0) return overview();
    const parts = [];
    if (wantsLevels(text)) parts.push(overview());
    if (wantsSite(text)) {
        parts.push(`Сайт НейроЯги: ${SITE_URL}\nГенерации для уровня «Базовая поддержка по ИИ» лежат в сообществе https://vk.com/club236645486`);
    }
    const lessons = rankLessons(text);
    if (lessons.length) {
        parts.push('Уроки:\n' + lessons.map(item => `• ${item.title}\n${item.url}`).join('\n'));
    }
    const found = (Array.isArray(posts) ? posts : []).filter(item => item && item.url).slice(0, 3);
    if (found.length) {
        parts.push('На стене сообщества:\n' + found.map(item => `• ${item.title}\n${item.url}`).join('\n'));
    }
    if (!parts.length) {
        return 'По этому запросу в клубе ничего не нашла. Напишите иначе: обложка, бот, клип, виджет или подписка.';
    }
    return parts.join('\n\n').slice(0, 3500);
}

async function searchPosts(query) {
    const token = audit.readerToken();
    const q = (String(query || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]{4,}/g) || []).slice(0, 5).join(' ');
    if (!token || q.length < 4) return [];
    const body = new URLSearchParams({
        owner_id: `-${GROUP_ID}`,
        query: q,
        owners_only: '1',
        count: '3',
        access_token: token,
        v: '5.199'
    });
    const res = await axios.post('https://api.vk.com/method/wall.search', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
        validateStatus: () => true
    });
    const items = res.data && res.data.response && res.data.response.items;
    if (!Array.isArray(items)) return [];
    return items.map(post => {
        const own = `https://vk.com/wall-${GROUP_ID}_${post.id}`;
        const link = String(post.text || '').match(/https?:\/\/\S+/) || [];
        return {
            title: String(post.text || 'Запись сообщества').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Запись сообщества',
            url: link[0] || own
        };
    });
}

module.exports = { overview, reply, searchPosts, JOIN_URL, SITE_URL };
