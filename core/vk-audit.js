const axios = require('axios');

const POSTS_COUNT = 50;
const API_VERSION = '5.199';
const CLUB_URL = 'https://m.vk.ru/@neuroyaga-navigator-po-klubu-babki-targetologa';
const CLUB_NAME = 'клуб «Бабки таргетолога»';

class AuditError extends Error {
    constructor(message, retry) {
        super(message);
        this.audit = true;
        this.retry = !!retry;
    }
}

const STOP_WORDS = new Set(('чтобы,который,которые,которая,может,можно,будет,будут,очень,также,только,когда,после,этого,этот,' +
    'нужно,своей,своих,сегодня,завтра,потому,здесь,между,через,перед,около,всего,всегда,много,более,менее,снова,' +
    'вместе,просто,нашей,наших,ваших,вашей,других,другой,каждый,каждая,такой,такие,этими,ссылке,группе,группы,' +
    'больше,меньше,можете,будем,время,этому,потом,тогда,какой,какие,кстати,конечно').split(','));

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractScreenName(raw) {
    const source = String(raw || '').trim();
    const wall = source.match(/wall-(\d+)_\d+/i);
    if (wall) return `club${wall[1]}`;
    let s = source.replace(/[\s\u200B]+/g, '');
    s = s.split(/[?#&]/)[0];
    const m = s.match(/vk\.(?:com|ru)\/([A-Za-z0-9_.]+)/i);
    s = m ? m[1] : s.replace(/^@/, '');
    s = s.replace(/[^A-Za-z0-9_.]/g, '').replace(/\.+$/, '');
    if (!s || /^(away|im|feed|wall|write)$/i.test(s)) {
        throw new AuditError('Не понял ссылку. Пришлите её в виде vk.com/название');
    }
    return s;
}

let queue = Promise.resolve();

function vkCall(method, params, token) {
    const run = queue.then(async () => {
        await delay(350);
        const body = new URLSearchParams();
        Object.entries(Object.assign({}, params, { access_token: token, v: API_VERSION })).forEach(([key, value]) => {
            if (value != null) body.set(key, String(value));
        });
        const res = await axios.post(`https://api.vk.com/method/${method}`, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 20000,
            validateStatus: () => true
        });
        const json = res.data || {};
        if (json.error) {
            const err = new Error('vk');
            err.code = json.error.error_code;
            throw err;
        }
        return json;
    });
    queue = run.then(() => {}, () => {});
    return run;
}

async function checkReplies(token, groupId, posts) {
    let totalComments = 0;
    let groupReplies = 0;
    let checked = 0;
    for (const post of posts.slice(0, 10)) {
        if (!(post.comments && post.comments.count > 0)) continue;
        try {
            const res = (await vkCall('wall.getComments', {
                owner_id: -groupId,
                post_id: post.id,
                count: 20,
                need_likes: 0,
                thread_items_count: 10
            }, token)).response;
            const items = (res && res.items) || [];
            items.forEach(comment => {
                if (comment.from_id === -groupId) groupReplies += 1;
                else totalComments += 1;
                ((comment.thread && comment.thread.items) || []).forEach(reply => {
                    if (reply.from_id === -groupId) groupReplies += 1;
                    else totalComments += 1;
                });
            });
            checked += 1;
        } catch (e) {}
        if (checked >= 8) break;
    }
    return { totalComments, groupReplies };
}

async function checkSpelling(text) {
    try {
        const clean = String(text || '').replace(/https?:\/\/\S+/g, '').replace(/\[[^\]]*\]/g, '').slice(0, 9000);
        const body = new URLSearchParams({ text: clean, lang: 'ru', options: '518' });
        const res = await axios.post('https://speller.yandex.net/services/spellservice.json/checkText', body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
            validateStatus: () => true
        });
        const arr = Array.isArray(res.data) ? res.data : [];
        const words = [...new Set(arr.map(item => item.word))].filter(word => /^[а-яё]+$/i.test(word));
        return { count: words.length, examples: words.slice(0, 6).join(', ') };
    } catch (e) {
        return { count: 0, examples: '' };
    }
}

function groupOf(response) {
    if (!response) return null;
    if (response.groups && response.groups[0]) return response.groups[0];
    if (response.items && response.items[0]) return response.items[0];
    if (Array.isArray(response) && response[0]) return response[0];
    if (response.id) return response;
    return null;
}

const GROUP_FIELDS = 'description,members_count,cover,activity,status,site,contacts,market,verified,links,counters';

async function fetchGroup(token, idOrScreen) {
    let json;
    try {
        json = await vkCall('groups.getById', { group_ids: idOrScreen, fields: GROUP_FIELDS }, token);
    } catch (error) {
        if (Number(error && error.code) !== 100) throw error;
        json = await vkCall('groups.getById', { group_id: idOrScreen, fields: GROUP_FIELDS }, token);
    }
    return groupOf(json.response);
}

async function resolveGroupId(token, screen) {
    if (/^(club|public|event)?\d+$/i.test(screen)) return screen.replace(/\D/g, '');
    try {
        const resolved = (await vkCall('utils.resolveScreenName', { screen_name: screen }, token)).response;
        if (resolved && resolved.type === 'user') throw new AuditError('Это личная страница. Пришлите ссылку на группу или паблик');
        if (resolved && resolved.type === 'group' && resolved.object_id) return String(resolved.object_id);
    } catch (error) {
        if (error && error.audit) throw error;
    }
    const info = await fetchGroup(token, screen);
    if (info && info.id) return String(info.id);
    throw new AuditError(`Сообщество vk.com/${screen} не найдено или стена пустая`, true);
}

let serviceCache = { token: '', until: 0, failedUntil: 0 };

async function serviceToken() {
    if (serviceCache.token && serviceCache.until > Date.now()) return serviceCache.token;
    if (serviceCache.failedUntil > Date.now()) return '';
    const id = String(process.env.VK_APP_ID || '').trim();
    const secret = String(process.env.VK_APP_SECRET || '').trim();
    if (!id || !secret) return '';
    const body = new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: 'client_credentials',
        v: API_VERSION
    });
    for (const url of ['https://oauth.vk.com/access_token', 'https://oauth.vk.ru/access_token']) {
        try {
            const res = await axios.post(url, body.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000,
                validateStatus: () => true
            });
            const token = res.data && res.data.access_token;
            if (!token) continue;
            const expires = Number(res.data.expires_in);
            const ttl = expires > 60 ? expires - 60 : 12 * 3600;
            serviceCache = { token, until: Date.now() + ttl * 1000, failedUntil: 0 };
            return token;
        } catch (error) {}
    }
    serviceCache.failedUntil = Date.now() + 5 * 60 * 1000;
    return '';
}

async function analyzeOne(raw, token) {
    const screen = extractScreenName(raw);
    const groupId = await resolveGroupId(token, screen);
    const info = await fetchGroup(token, groupId);
    if (!info || !info.id) throw new AuditError('Сообщество не найдено', true);
    try {
        const rich = groupOf((await vkCall('groups.getById', {
            group_ids: info.id,
            fields: 'menu,addresses,donut,can_message'
        }, token)).response);
        if (rich) {
            if (rich.menu) info.menu = rich.menu;
            if (rich.addresses) info.addresses = rich.addresses;
            if (rich.donut) info.donut = rich.donut;
            if (rich.can_message != null) info.can_message = rich.can_message;
        }
    } catch (error) {}

    const members = info.members_count || 0;
    const cover = !!(info.cover && info.cover.enabled);
    const descLen = (info.description || '').trim().length;
    const avatar = !!(info.photo_200 && !String(info.photo_200).includes('camera_200'));
    const status = !!(info.status || '').trim();
    const site = !!(info.site || '').trim();
    const contacts = !!(info.contacts && info.contacts.length);
    const address = !!(info.addresses && info.addresses.is_enabled);
    const market = !!(info.market && info.market.enabled);
    const menu = !!(info.menu && info.menu.items && info.menu.items.length);
    const messagesOpen = info.can_message === 1;
    const screenName = info.screen_name || screen;
    const screenIsDigits = /^(club|public)?\d+$/i.test(screenName);
    const screenLatin = !screenIsDigits && /^[a-z0-9_.]+$/i.test(screenName);
    const isDonut = !!(info.donut && info.donut.is_donut);

    let posts = [];
    try {
        posts = ((await vkCall('wall.get', { owner_id: -info.id, count: POSTS_COUNT, filter: 'owner' }, token)).response || {}).items || [];
    } catch (error) {
        if (Number(error && error.code) !== 100) throw error;
        posts = ((await vkCall('wall.get', { owner_id: -info.id, count: POSTS_COUNT }, token)).response || {}).items || [];
    }
    const n = posts.length;
    if (!n) {
        if (info.is_closed) throw new AuditError('Сообщество закрытое — анализ невозможен', true);
        throw new AuditError('На стене нет постов', true);
    }

    const dates = posts.map(post => post.date);
    const newest = Math.max(...dates);
    const oldest = Math.min(...dates);
    const period = Math.max(1, Math.round((newest - oldest) / 86400));
    const perWeek = +(n / period * 7).toFixed(1);
    const sinceLast = Math.floor((Date.now() / 1000 - newest) / 86400);
    const sortedDates = [...dates].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < sortedDates.length; i++) maxGap = Math.max(maxGap, (sortedDates[i] - sortedDates[i - 1]) / 86400);
    maxGap = Math.round(maxGap);

    let tags = 0;
    let video = 0;
    let photo = 0;
    let textOnly = 0;
    let polls = 0;
    let links = 0;
    let cta = 0;
    let longText = 0;
    let totalLen = 0;
    let likes = 0;
    let reposts = 0;
    let comments = 0;
    let views = 0;
    let pinned = 0;
    let nightPosts = 0;
    let repostsOfOthers = 0;
    let maxTagsInPost = 0;
    let buyWordsFirstLine = 0;
    let adsMarked = 0;
    const hours = {};
    const wordFreq = {};
    const tagFreq = {};
    const engagements = [];
    let allText = '';

    posts.forEach(post => {
        const text = post.text || '';
        const att = (post.attachments || []).map(item => item.type);
        const hasVideo = att.includes('video');
        const hasPhoto = att.includes('photo');
        if (post.is_pinned) pinned += 1;
        if (post.copy_history && post.copy_history.length) repostsOfOthers += 1;
        if (post.marked_as_ads) adsMarked += 1;
        const tagsInThisPost = (text.match(/#[\wа-яё]+/gi) || []).length;
        if (tagsInThisPost) tags += 1;
        maxTagsInPost = Math.max(maxTagsInPost, tagsInThisPost);
        const firstLine = text.slice(0, 120).toLowerCase();
        if (/купи|заказать|скидк|акци[яю]/i.test(firstLine)) buyWordsFirstLine += 1;
        if (hasVideo) video += 1;
        if (hasPhoto) photo += 1;
        if (att.includes('poll')) polls += 1;
        if (att.includes('link') || /https?:\/\//.test(text)) links += 1;
        if (!hasVideo && !hasPhoto && !att.length) textOnly += 1;
        if (/\?|пишите|напишите|делитесь|поделитесь|ставьте|жми|переходи|оставляй|расскажи|голосуй|подписывайся|регистрируй|записывай/i.test(text)) cta += 1;
        if (text.length > 1500) longText += 1;
        totalLen += text.length;
        const like = (post.likes || {}).count || 0;
        const repost = (post.reposts || {}).count || 0;
        const comment = (post.comments || {}).count || 0;
        const view = (post.views || {}).count || 0;
        likes += like;
        reposts += repost;
        comments += comment;
        views += view;
        engagements.push(like + repost + comment);
        const hour = (new Date(post.date * 1000).getUTCHours() + 3) % 24;
        hours[hour] = (hours[hour] || 0) + 1;
        if (hour < 7) nightPosts += 1;
        (text.match(/#[\wа-яё]+/gi) || []).forEach(tag => {
            const key = tag.toLowerCase();
            tagFreq[key] = (tagFreq[key] || 0) + 1;
        });
        (text.toLowerCase().replace(/#[\wа-яё]+/gi, '').match(/[а-яё]{5,}/gi) || [])
            .filter(word => !STOP_WORDS.has(word))
            .forEach(word => { wordFreq[word] = (wordFreq[word] || 0) + 1; });
        allText += `${text}\n`;
    });

    const shortPosts = posts.filter(post => (post.text || '').length < 150 && !(post.copy_history && post.copy_history.length)).length;
    const donutPosts = posts.filter(post => post.donut && post.donut.is_donut).length;
    const lastDonut = donutPosts
        ? Math.floor((Date.now() / 1000 - Math.max(...posts.filter(post => post.donut && post.donut.is_donut).map(post => post.date))) / 86400)
        : null;
    const pinPost = posts.find(post => post.is_pinned);
    const pinText = pinPost ? (pinPost.text || '') : '';
    const pinHasContact = /\+7|8\s?\(?\d{3}|напиши|пишите|в лс|в личн|сообщени|vk\.me|записаться|запись/i.test(pinText);
    const pinHasPrice = /цен|прайс|стоимост|руб|₽|от \d/i.test(pinText);
    const topWordsArr = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(item => item[0]);
    const nameLower = (info.name || '').toLowerCase();
    const nameHasKeyword = topWordsArr.some(word => nameLower.includes(word.slice(0, 5))) ||
        (info.activity || '').toLowerCase().split(/[\s,]+/).some(word => word.length > 4 && nameLower.includes(word.slice(0, 5)));
    const nameLen = (info.name || '').length;
    const replies = await checkReplies(token, info.id, posts);
    const replyRate = replies.totalComments ? Math.round(replies.groupReplies / replies.totalComments * 100) : null;

    let topics = 0;
    let hasReviewsTopic = false;
    let albums = 0;
    let clips = 0;
    try {
        const board = (await vkCall('board.getTopics', { group_id: info.id, count: 20 }, token)).response;
        topics = (board && board.count) || 0;
        hasReviewsTopic = !!((board && board.items) || []).find(topic => /отзыв/i.test(topic.title));
    } catch (e) {}
    try { albums = ((await vkCall('photos.getAlbums', { owner_id: -info.id }, token)).response || {}).count || 0; } catch (e) {}
    try { clips = ((await vkCall('video.get', { owner_id: -info.id, count: 1 }, token)).response || {}).count || 0; } catch (e) {}
    const counters = info.counters || {};
    if (!topics && counters.topics) topics = counters.topics;
    if (!albums && counters.albums) albums = counters.albums;
    if (!clips && (counters.videos || counters.clips)) clips = counters.videos || counters.clips || 0;

    const avg = value => Math.round(value / n);
    const top = (obj, count) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, count).map(item => item[0]).join(', ');
    const bestHour = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
    const avgLikes = avg(likes);
    const avgReposts = avg(reposts);
    const avgComments = avg(comments);
    const avgViews = avg(views);
    const er = members ? +((likes + reposts + comments) / n / members * 100).toFixed(2) : 0;
    const erv = views ? +((likes + reposts + comments) / views * 100).toFixed(2) : 0;
    const vr = members && views ? +(avgViews / members * 100).toFixed(1) : 0;
    const spell = await checkSpelling(allText);

    return {
        name: info.name,
        nameLen,
        nameHasKeyword,
        link: `https://vk.com/${screenName}`,
        screenName,
        screenIsDigits,
        screenLatin,
        members,
        activity: info.activity || '',
        cover,
        descLen,
        avatar,
        status,
        site,
        contacts,
        address,
        market,
        menu,
        messagesOpen,
        pinned,
        pinHasContact,
        pinHasPrice,
        topics,
        hasReviewsTopic,
        albums,
        clips,
        isDonut,
        donutPosts,
        lastDonut,
        n,
        period,
        perWeek,
        sinceLast,
        maxGap,
        tags,
        maxTagsInPost,
        video,
        photo,
        textOnly,
        polls,
        links,
        cta,
        longText,
        shortPosts,
        avgLen: avg(totalLen),
        repostsOfOthers,
        buyWordsFirstLine,
        adsMarked,
        avgLikes,
        avgReposts,
        avgComments,
        avgViews,
        er,
        erv,
        vr,
        maxEng: Math.max(...engagements),
        minEng: Math.min(...engagements),
        nightPosts,
        bestHour: bestHour ? bestHour[0] : '—',
        replyRate,
        repliesChecked: replies.totalComments,
        errs: spell.count,
        errExamples: spell.examples,
        topWords: top(wordFreq, 10),
        topTags: top(tagFreq, 5)
    };
}

const club = lesson => `\n📚 В клубе есть урок «${lesson}» → ${CLUB_URL}`;
const gen = () => `\n🤖 Генератор текстов в клубе напишет пост за минуту, работает 24/7 → ${CLUB_URL}`;
function erNorm(members) { return members < 25000 ? [0.3, 0.6] : members < 100000 ? [0.2, 0.4] : members < 500000 ? [0.1, 0.25] : [0.05, 0.15]; }
function vrNorm(members) { return members < 10000 ? [15, 30] : members < 100000 ? [10, 20] : members < 500000 ? [6, 14] : [3, 8]; }
function grade(value, low, high) { return value < low ? '🔴 ниже нормы' : value < high ? '🟡 в норме' : '🟢 отлично'; }
function gradeRange(value, low, high) { return value < low ? '🔴 мало' : value > high ? '🟡 многовато' : '🟢 в норме'; }
function yn(flag) { return flag ? '✅' : '❌'; }
function num(value) { return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

function designList(data) {
    return [
        [data.nameHasKeyword, 'В названии есть ключевой запрос'],
        [data.nameLen <= 48, 'Название до 48 символов'],
        [data.screenLatin, 'Короткий адрес латиницей (не club123)'],
        [data.avatar, 'Аватар'],
        [data.cover, 'Обложка'],
        [data.status, 'Статус с оффером'],
        [data.descLen >= 100 && data.descLen <= 2000, 'Описание 100–2000 симв.'],
        [data.pinned > 0, 'Закреплённый пост'],
        [data.pinned > 0 && data.pinHasContact, 'В закрепе есть призыв написать/контакт']
    ];
}

function infraList(data) {
    return [
        [data.market, 'Товары/услуги заполнены'],
        [data.hasReviewsTopic, 'Обсуждение «Отзывы»'],
        [data.albums > 0, 'Фотоальбомы с работами'],
        [data.site || data.contacts, 'Контакты или сайт'],
        [data.address, 'Адрес'],
        [!!data.activity, 'Тематика указана']
    ];
}

function formatReport(data) {
    const pct = value => Math.round(value / data.n * 100);
    const [erLow, erHigh] = erNorm(data.members);
    const [vrLow, vrHigh] = vrNorm(data.members);
    const visual = (data.photo + data.video) / data.n;
    const design = designList(data);
    const infra = infraList(data);
    const designScore = design.filter(item => item[0]).length;
    const infraScore = infra.filter(item => item[0]).length;
    const repostShare = data.repostsOfOthers / data.n;
    let score = designScore * 2 + infraScore * 2;
    score += data.perWeek >= 3 && data.perWeek <= 7 ? 10 : data.perWeek >= 1 && data.perWeek <= 14 ? 5 : 0;
    score += data.sinceLast <= 3 ? 6 : data.sinceLast <= 7 ? 3 : 0;
    score += data.vr >= vrHigh ? 12 : data.vr >= vrLow ? 8 : data.vr >= 5 ? 3 : 0;
    score += data.erv >= 3 ? 10 : data.erv >= 1 ? 6 : data.erv >= 0.5 ? 2 : 0;
    score += visual >= 0.8 ? 8 : visual >= 0.5 ? 4 : 0;
    score += repostShare === 0 ? 6 : repostShare < 0.2 ? 3 : 0;
    score += data.maxTagsInPost <= 5 ? 4 : data.maxTagsInPost <= 10 ? 2 : 0;
    score += data.replyRate === null ? 2 : data.replyRate >= 50 ? 4 : data.replyRate > 0 ? 2 : 0;
    score += data.errs <= 3 ? 4 : data.errs <= 8 ? 2 : 0;
    score = Math.min(100, score);
    const verdict = score >= 80 ? '🏆 Сильное сообщество' : score >= 60 ? '👍 Хороший уровень, есть куда расти'
        : score >= 40 ? '⚠️ Средне — нужна системная работа' : '🚨 Слабо — начинаем с базы';
    let diagnosis;
    if (data.vr < 5) diagnosis = '🔴 Пост видят меньше 5% подписчиков. Диагноз: мёртвая база (боты, «собачки», спящие) или пессимизация за репосты/ссылки/продажу в лоб. Лечится по схеме «застрявшее сообщество» — см. ниже.';
    else if (data.vr < vrLow) diagnosis = `🟡 Охват ${data.vr}% при норме ${vrLow}–${vrHigh}%. Лента пускает посты только до тестовой выборки — предыдущие посты не удерживают внимание.`;
    else if (data.vr > 100) diagnosis = '🟢 Охват больше 100% — посты уходят в виральные показы, лента вас любит.';
    else diagnosis = `🟢 Охват ${data.vr}% — база живая, лента показывает посты подписчикам.`;

    const tips = [];
    if (data.vr < 5 && data.members > 300) tips.push(`🔴 Схема «застрявшее сообщество»: 1) почистить базу от ботов и «собачек»; 2) две недели без репостов, внешних ссылок и «купи/скидка»; 3) 10–15 постов подряд «польза + карусель», 2–3 клипа в неделю, опрос раз в неделю; 4) отвечать на каждый коммент и сообщение в течение часа; 5) статистику смотреть только через 3–6 недель — разгон в ВК идёт волнами.${club('Как работает алгоритм ВК и как поднять охват')}`);
    if (!data.nameHasKeyword) tips.push(`🔴 В названии нет ключевого запроса. Название — главный SEO-фактор в ВК и Яндексе. Не «${data.name}», а «Услуга + город | Бренд». Самый частотный запрос — первым словом.${club('Название и SEO сообщества')}`);
    if (data.nameLen > 48) tips.push(`🟡 Название ${data.nameLen} символов — в поиске и на телефоне обрезается. Лимит 48.`);
    if (data.screenIsDigits) tips.push(`🟡 Адрес сообщества club123… — поменяй на латиницу с ключевым словом (vk.com/manikur_kazan). Это и поиск, и доверие.${club('Оформление сообщества')}`);
    if (!data.avatar) tips.push(`🔴 Нет аватара — сообщество выглядит заброшенным.${club('Оформление сообщества: аватар и обложка')}`);
    if (!data.cover) tips.push(`🔴 Нет обложки. За 3 секунды она должна отвечать: что, где, для кого. Обязательно проверить мобильную версию — 85% трафика с телефона.${club('Как сделать обложку 1590×400')}`);
    if (!data.status) tips.push(`🟡 Пустой статус — а это одна строка с оффером под названием. Не «Добро пожаловать!», а «Маникюр за 1500 ₽, запись в ЛС».${club('Оформление сообщества')}`);
    if (data.descLen < 100) tips.push(`🔴 Описание почти пустое. Оно индексируется поиском: кто, что, для кого, город, как заказать, ключевые слова с синонимами.${club('Продающее описание сообщества')}${gen()}`);
    if (data.descLen > 2000) tips.push(`🟡 Описание больше 2000 символов — простыню никто не читает. Сократи до 2–3 абзацев.${gen()}`);
    if (!data.pinned) tips.push(`🟡 Нет закрепа. Нужен пост-знакомство или лид-магнит с призывом написать в ЛС.${club('Пост-закреп, который продаёт')}${gen()}`);
    else if (!data.pinHasContact) tips.push(`🟡 В закрепе нет призыва написать/контакта. Человек прочитал — и не понял, куда идти. Добавь «напиши в сообщения — подберу/скину прайс».${gen()}`);
    if (!data.market) tips.push(`🟡 Товары/услуги не заполнены. Карточки индексируются поиском ВК отдельно — это бесплатный трафик. Фото + цена (или «от») + описание с ключами.${club('Товары и услуги в сообществе')}`);
    if (!data.hasReviewsTopic && data.albums === 0) tips.push(`🟡 Нет отзывов — ни обсуждения, ни альбома со скринами. Без соцдоказательств новый человек не пишет.${club('Как собирать отзывы')}`);
    if (data.albums === 0) tips.push('🟡 Нет фотоальбомов — портфолио, «до/после», процесс. Пустые дефолтные альбомы лучше удалить.');
    if (!data.site && !data.contacts) tips.push('🟡 Нет контактов. В блоке «Контакты» должен быть реальный человек с открытым профилем, а не «администратор» без фото.');
    if (data.perWeek < 3) tips.push(`🔴 ${data.perWeek} постов в неделю — мало. Ориентир 3–5. Регулярность важнее идеальности.${club('Контент-план на месяц за час')}${gen()}`);
    if (data.perWeek > 7 && data.vr < vrLow) tips.push(`🔴 ${data.perWeek} постов в неделю при охвате ${data.vr}% — это и есть причина. Частый слабый контент топит сообщество целиком. Сократить до 3–5, но каждый — с удержанием.${club('Контент-план на месяц за час')}`);
    if (data.sinceLast > 7) tips.push(`🔴 Последний пост ${data.sinceLast} дн. назад. Лента считает сообщество мёртвым.${club('Контент-план на месяц за час')}${gen()}`);
    if (data.maxGap >= 14) tips.push(`🟡 Был перерыв ${data.maxGap} дней. После каждой такой дыры разгон начинается с нуля — лента оценивает сообщество, а не пост.`);
    if (data.nightPosts / data.n > 0.3) tips.push(`🟡 Треть постов выходит ночью. Лучшее время: 8–10, 12–14, 19–22. Но важнее другое — первые 30–60 минут пост должен собрать реакции: первый коммент от сообщества + попроси 3–5 живых людей отреагировать.${club('Как работает алгоритм ВК')}`);
    if (repostShare > 0) tips.push(`🔴 ${pct(data.repostsOfOthers)}% стены — репосты. Репосты в ВК получают практически ноль охвата и тянут вниз всё сообщество. Только самостоятельные посты.${club('Как работает алгоритм ВК')}`);
    if (data.maxTagsInPost > 10) tips.push(`🔴 До ${data.maxTagsInPost} хештегов в посте. Больше 10 — пост не попадает в ленту ни по одному тегу, а сами теги уводят твоих подписчиков к конкурентам. Оставить 0 или 3–5 навигационных (#отзывы@${data.screenName}).${club('Рубрикатор и хэштеги')}`);
    else if (data.maxTagsInPost > 5) tips.push(`🟡 Хештегов больше 5. Общие теги (#маникюр) трафика не дают, а кормят конкурентов. Только свои: #прайс@название, #отзывы@название.${club('Рубрикатор и хэштеги')}`);
    if (data.links / data.n > 0.3) tips.push(`🟡 ${pct(data.links)}% постов со внешними ссылками (Telegram, сайт, WB) — лента режет показы. Ссылку — в первый комментарий, кнопку меню или товары.${club('Как работает алгоритм ВК')}`);
    if (data.buyWordsFirstLine / data.n > 0.3) tips.push(`🔴 В ${pct(data.buyWordsFirstLine)}% постов первые строки — «купить / заказать / скидка / акция». Лента пессимизирует продажу в лоб, а подписчики отписываются. Правило 70/20/10: 70% польза и кейсы, 20% личность и закулисье, 10% продажа — и та через «вот что получил клиент, хочешь так же — пиши».${club('Как писать посты, которые продают')}${gen()}`);
    if (data.textOnly / data.n > 0.2) tips.push(`🔴 ${pct(data.textOnly)}% постов без картинки. Голый текст не останавливает скролл. Формула: картинка/карусель + структурированный текст. Всегда.${club('Визуал для постов без дизайнера')}`);
    if (data.shortPosts / data.n > 0.3) tips.push(`🟡 ${pct(data.shortPosts)}% постов — коротышки до 150 символов. Лента их не разгоняет: нет времени на посте, нечего раскрывать. Оптимум 500–1500 знаков с абзацами, а первые 2 строки — боль или вопрос клиента, не «Привет, друзья!».${club('Структура продающего поста')}${gen()}`);
    if (data.avgLen > 2000) tips.push(`🟡 Средний пост ${data.avgLen} символов. Длинные тексты работают только как разбор/кейс с подзаголовками. Простыня без структуры — минус охват.${gen()}`);
    if (data.video / data.n < 0.15) tips.push(`🔴 Клипов почти нет (видео в ${pct(data.video)}% постов). Клипы — единственный формат, где ВК бесплатно показывает вас неподписчикам. 2–3 в неделю, вертикаль, хук в первые 3 секунды, субтитры, до 40 сек. Заказы с них напрямую не ждать — они дают подписчиков, продаёт стена + ЛС.${club('Клипы ВК: с чего начать')}`);
    if (data.polls === 0) tips.push(`🟡 Ни одного опроса. Опрос — самое дешёвое вовлечение, работает даже там, где комментарии мёртвые. Раз в неделю, на тему выбора: цвет/дизайн/что показать дальше.${club('Игры и активности для вовлечения')}`);
    if (data.cta / data.n < 0.3) tips.push(`🟡 Призыв только в ${pct(data.cta)}% постов. В коммерции нужен не «ставь лайк», а «напиши в сообщения — скину прайс». И вопрос с вариантами «1 или 2?» — цифру написать не лень, мнение — лень.${club('Как писать посты, которые продают')}${gen()}`);
    if (data.replyRate !== null && data.replyRate < 30) tips.push(`🔴 Сообщество отвечает лишь на ${data.replyRate}% комментариев. Комментарий + ответ = две реакции вместо одной, плюс ветка держит людей на посте. Отвечать на каждый — в течение часа. Это напрямую конверсия в заказы.`);
    else if (data.replyRate === null && data.avgComments < 1 && data.members > 500) tips.push(`🟡 Комментариев нет месяцами — нет ни одного крючка на диалог. Первый коммент от сообщества сразу после публикации снимает барьер «никто не писал, я не буду первым».${club('Игры и активности для вовлечения')}`);
    if (data.isDonut && data.donutPosts === 0) tips.push(`🟡 Donut подключён, но закрытых постов в последних 50 нет. Доны платят каждый месяц — если эксклюзива нет, они отваливаются.${club('Монетизация: VK Donut')}`);
    if (data.isDonut && data.lastDonut !== null && data.lastDonut > 45) tips.push(`🟡 Последний платный пост ${data.lastDonut} дн. назад. Доны получают мало — риск отписок.${club('Монетизация: VK Donut')}`);
    if (data.isDonut && data.donutPosts / data.n > 0.6) tips.push('🟡 Больше 60% стены закрыто под Donut. Новым подписчикам нечего читать — рост встанет.');
    if (!data.isDonut && data.members > 1000 && data.erv >= 2) tips.push(`💡 Donut не подключён, а ERV хороший — у тебя лояльная аудитория, её можно монетизировать закрытым контентом.${club('Монетизация: VK Donut')}`);
    if (data.errs > 5) tips.push(`🟡 Спеллер нашёл ${data.errs} возможных ошибок (${data.errExamples}). Ошибки бьют по доверию к эксперту.${gen()}`);
    if (data.maxEng > data.minEng * 10 && data.n >= 20) tips.push(`💡 Разброс реакций между постами больше 10 раз. Один «стрельнувший» пост — это не рост, это лотерея. Найди 3–5 удачных и делай серию похожих — лента оценивает сообщество, а не пост.${club('Анализ статистики сообщества')}`);
    if (!tips.length) tips.push(`🟢 База в порядке! Дальше — стратегия: воронка подписчик → клиент, рассылки, лид-магнит. Всё это разбираем в ${CLUB_NAME} → ${CLUB_URL}`);
    const order = { '🔴': 0, '🟡': 1, '💡': 2, '🟢': 3 };
    tips.sort((a, b) => order[a.slice(0, 2)] - order[b.slice(0, 2)]);
    const donutLine = data.isDonut
        ? `Donut: ✅ подключён · закрытых постов: ${data.donutPosts}${data.lastDonut !== null ? ` · последний ${data.lastDonut} дн. назад` : ''}`
        : 'Donut: ❌ не подключён';
    return `📊 SMM-АУДИТ СООБЩЕСТВА
«${data.name}»
${data.link}
${data.activity ? `Тематика: ${data.activity}` : ''}

🏁 ИТОГОВАЯ ОЦЕНКА: ${score}/100
${verdict}

━━━━━━━━━━━━━━━━━━
🎨 А. ОФОРМЛЕНИЕ И ПОИСК — ${designScore}/${design.length}
${design.map(item => `${yn(item[0])} ${item[1]}`).join('\n')}

━━━━━━━━━━━━━━━━━━
🛒 Б. ИНФРАСТРУКТУРА ЗАКАЗА — ${infraScore}/${infra.length}
${infra.map(item => `${yn(item[0])} ${item[1]}`).join('\n')}
${donutLine}

━━━━━━━━━━━━━━━━━━
📈 В. ДИАГНОСТИКА ПО ЦИФРАМ
Подписчиков: ${num(data.members)}
Средний пост видят: ${num(data.avgViews)} чел. = ${data.vr}% — ${grade(data.vr, vrLow, vrHigh)} (норма ${vrLow}–${vrHigh}%)
Реакции на пост: ❤️ ${data.avgLikes} · 🔁 ${data.avgReposts} · 💬 ${data.avgComments}
ERV (реакции/просмотры): ${data.erv}% — ${grade(data.erv, 1, 3)} (коммерция 1–3%)
ER (от подписчиков): ${data.er}% — ${grade(data.er, erLow, erHigh)}
Комментарии: ${data.avgComments < 1 ? '🔴 почти нет' : data.avgComments < 5 ? '🟡 есть, но мало' : '🟢 живое общение'} — в 2026 это не главная метрика, главное — удержание и переходы в ЛС
Ответы сообщества на комменты: ${data.replyRate === null ? '— (комментариев нет)' : `${data.replyRate}% ${data.replyRate >= 50 ? '🟢' : data.replyRate > 0 ? '🟡' : '🔴'}`}

Диагноз: ${diagnosis}

━━━━━━━━━━━━━━━━━━
📅 Г. КОНТЕНТ
Постов: ${data.n} за ${data.period} дн. · ${data.perWeek}/нед — ${gradeRange(data.perWeek, 3, 7)} (норма 3–5)
Последний пост: ${data.sinceLast} дн. назад — ${data.sinceLast <= 3 ? '🟢' : data.sinceLast <= 7 ? '🟡' : '🔴 заброшено'}
Макс. перерыв: ${data.maxGap} дн. ${data.maxGap >= 14 ? '🟡' : '🟢'}
Чаще всего публикуете в ${data.bestHour}:00 МСК ${data.nightPosts / data.n > 0.3 ? '🟡 много ночных' : '🟢'}

Что режет лента:
${data.repostsOfOthers ? '🔴' : '🟢'} Репосты: ${pct(data.repostsOfOthers)}%
${data.links / data.n > 0.3 ? '🟡' : '🟢'} Внешние ссылки: ${pct(data.links)}%
${data.maxTagsInPost > 10 ? '🔴' : data.maxTagsInPost > 5 ? '🟡' : '🟢'} Хештегов в посте: до ${data.maxTagsInPost} (норма 0 или 3–5)
${data.buyWordsFirstLine / data.n > 0.3 ? '🔴' : '🟢'} «Купить/скидка» в первых строках: ${pct(data.buyWordsFirstLine)}%
${data.textOnly / data.n > 0.2 ? '🔴' : '🟢'} Посты без картинки: ${pct(data.textOnly)}%
${data.shortPosts / data.n > 0.3 ? '🟡' : '🟢'} Коротышки до 150 симв.: ${pct(data.shortPosts)}%

Что лента любит:
${visual >= 0.8 ? '🟢' : '🟡'} Картинка/видео + текст: ${pct(data.photo + data.video)}%
${data.video / data.n >= 0.2 ? '🟢' : '🔴'} Видео/клипы в постах: ${pct(data.video)}% (всего видео в сообществе: ${data.clips})
${data.polls ? '🟢' : '🔴'} Опросов: ${data.polls}
${data.cta / data.n >= 0.4 ? '🟢' : '🟡'} Призыв к действию: ${pct(data.cta)}%
Средняя длина: ${data.avgLen} симв. (оптимум 500–1500)
Грамотность: ${data.errs} возможных ошибок — ${data.errs <= 3 ? '🟢' : data.errs <= 8 ? '🟡' : '🔴'}${data.errExamples ? ` (${data.errExamples})` : ''}

🔑 О чём пишете: ${data.topWords || '—'}
🏷 Хэштеги: ${data.topTags || '—'}

━━━━━━━━━━━━━━━━━━
💡 РЕКОМЕНДАЦИИ (🔴 срочно → 🟡 важно → 💡 совет)
${tips.join('\n\n')}

━━━━━━━━━━━━━━━━━━
📌 С чего начать: ${tips[0].replace(/^[🔴🟡💡🟢] /, '').split('\n')[0]}

Помни: разгон в ВК идёт 3–6 недель. Лента оценивает не пост, а сообщество целиком.

🎓 Все уроки, шаблоны обложек, игры для вовлечения и генератор текстов 24/7 — в ${CLUB_NAME}:
${CLUB_URL}

Пересчитать через месяц — просто пришли ссылку ещё раз.`;
}

async function run(raw, fallbackToken) {
    const tokens = [];
    const add = value => {
        const token = String(value || '').trim();
        if (token && !tokens.includes(token)) tokens.push(token);
    };
    add(process.env.VK_AUDIT_TOKEN);
    add('00368ab500368ab500368ab50c030960dd0003600368ab56a84097d892fbd1c4685f08c');
    if (!tokens.length) {
        try { add(await serviceToken()); } catch (error) {}
        add(fallbackToken);
    }
    if (!tokens.length) throw new AuditError('Аудит скоро заработает. Напишите чуть позже.');
    let lastAudit = null;
    let sawAccess = false;
    let sawToken = false;
    let openedSpare = tokens.length > 1;
    for (let i = 0; i < tokens.length; i++) {
        try {
            return formatReport(await analyzeOne(raw, tokens[i]));
        } catch (error) {
            if (error && error.audit && !error.retry) throw error;
            if (error && error.audit) lastAudit = error;
            else {
                const code = Number(error && error.code);
                console.error(`ВК аудит: запрос не вышел${code ? ` (${code})` : ''}.`);
                if (code === 5 || code === 27 || code === 28) sawToken = true;
                else sawAccess = true;
            }
            if (!openedSpare) {
                openedSpare = true;
                try { add(await serviceToken()); } catch (e) {}
                add(fallbackToken);
            }
        }
    }
    if (lastAudit && !sawAccess) throw lastAudit;
    if (sawAccess) throw new AuditError('Это сообщество не открыло стену. Пришлите ссылку на открытую группу или паблик.');
    if (sawToken) throw new AuditError('Ключ аудита не читает чужие сообщества. Нужен пользовательский ключ.');
    throw lastAudit || new AuditError('Не получилось разобрать это сообщество. Проверьте, что оно открытое и ссылка верная.');
}

function readerToken() {
    const env = String(process.env.VK_AUDIT_TOKEN || '').trim();
    if (env && !env.startsWith('vk1.')) return env;
    return '00368ab500368ab500368ab50c030960dd0003600368ab56a84097d892fbd1c4685f08c';
}

module.exports = {
    AuditError,
    extractScreenName,
    formatReport,
    groupOf,
    readerToken,
    run,
    CLUB_URL
};
