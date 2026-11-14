const fs = require('fs');
const path = require('path');

const api = process.env.NY_API || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app';
const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>НейроЯга</title>
<style>
html,body{margin:0;height:100%;background:#0b0614;color:#f3efff;font:15px/1.4 system-ui,sans-serif}
iframe{position:fixed;z-index:1;inset:0;width:100%;height:100%;border:0;background:#0b0614}
p{margin:24px;text-align:center}
</style>
</head>
<body>
<p id="wait">Открываю кабинет…</p>
<button id="pin" type="button" style="display:none;position:fixed;z-index:5;top:10px;left:10px;right:10px;border:0;border-radius:14px;padding:14px;font-weight:800;color:#fff;background:#6d28d9">Поставить кнопки на страницу</button>
<p id="pinnote" style="display:none;position:fixed;z-index:5;top:62px;left:10px;right:10px;margin:0;text-align:center"></p>
<script>
const API = ${JSON.stringify(api)};
function vkSend(handler, params){
  try { parent.postMessage({ handler: handler, params: params || {}, type: 'vk-connect', sendTime: Date.now() }, '*'); }
  catch (e) {}
}
vkSend('VKWebAppInit');
vkSend('VKWebAppGetLaunchParams');
let opened = false;
function openCabinet(search, hash){
  if (opened) return;
  opened = true;
  const frame = document.createElement('iframe');
  frame.src = API + '/' + (search || '') + (hash || '');
  frame.addEventListener('load', function(){
    const note = document.getElementById('wait');
    if (note) note.remove();
  });
  document.body.appendChild(frame);
}
function queryFrom(data){
  const src = data && (data.params || data.data || data);
  const bag = src && src.sign ? src : (src && src.data && src.data.sign ? src.data : null);
  if (!bag || !bag.vk_user_id || !bag.sign) return '';
  const q = new URLSearchParams();
  Object.keys(bag).forEach(function(key){
    if (key === 'sign' || key.indexOf('vk_') === 0) q.set(key, bag[key]);
  });
  return '?' + q.toString();
}
function widgetCode(groupId){
  const app = 'https://vk.com/app54895627_-' + groupId;
  return 'return {"title":"НейроЯга","rows":[' +
    '{"title":"Чат ИИ","descr":"Написать боту","button":"Открыть","button_url":"https://vk.me/tochki_linii","title_url":"https://vk.me/tochki_linii"},' +
    '{"title":"Рейтинг","descr":"Баллы за неделю","button":"Смотреть","button_url":"' + app + '#rate","title_url":"' + app + '#rate"},' +
    '{"title":"Сайт","descr":"Страница НейроЯга","button":"Открыть","button_url":"' + app + '#site","title_url":"' + app + '#site"},' +
    '{"title":"Подписка","descr":"Рассылка в чат","button":"Подписаться","button_url":"' + app + '#sub","title_url":"' + app + '#sub"}' +
  ']};';
}
let armWidget = false;
function showWidget(groupId){
  const id = String(groupId || here.get('vk_group_id') || '230706467');
  vkSend('VKWebAppShowCommunityWidgetPreviewBox', {
    group_id: Number(id),
    type: 'compact_list',
    code: widgetCode(id)
  });
}
function installWidget(){
  armWidget = true;
  vkSend('VKWebAppAddToCommunity');
  setTimeout(function(){
    if (!armWidget) return;
    armWidget = false;
    showWidget();
  }, 1600);
}
const here = new URLSearchParams(location.search);
const role = here.get('vk_viewer_group_role') || '';
if (here.get('vk_group_id') && (role === 'admin' || role === 'editor')) {
  const pin = document.getElementById('pin');
  pin.style.display = 'block';
  pin.onclick = installWidget;
}
if ((here.get('sign') && here.get('vk_user_id')) || /(^|[?#&])tk=/.test(location.hash)) {
  openCabinet(location.search, location.hash);
}
function payHost(url){
  try {
    const host = new URL(url).hostname;
    return host === 'yoomoney.ru' || host === 'yookassa.ru' || host.endsWith('.yoomoney.ru') || host.endsWith('.yookassa.ru');
  } catch (e) { return false; }
}
window.addEventListener('message', function(event){
  const data = event.data || {};
  if (data.type === 'ny-widget') { installWidget(); return; }
  const bridgeType = (data.data && data.data.type) || data.handler || '';
  const bridgeData = (data.data && data.data.data) || data.params || {};
  if (armWidget && (bridgeType === 'VKWebAppAddToCommunityResult' || bridgeType === 'VKWebAppAddToCommunityFailed')) {
    armWidget = false;
    showWidget(bridgeData.group_id);
    return;
  }
  if (String(bridgeType).indexOf('WidgetPreviewBoxFailed') >= 0) {
    const note = document.getElementById('pinnote');
    note.style.display = 'block';
    note.textContent = 'ВК не открыл окно кнопок. Откройте приложение из сообщества под администратором.';
    return;
  }
  if (data.type === 'ny-open' && /^https:\\/\\//.test(String(data.url || ''))) {
    vkSend('VKWebAppOpenLink', { url: data.url });
    return;
  }
  if (data.type === 'ny-pay' && payHost(data.url)) {
    vkSend('VKWebAppOpenLink', { url: data.url });
    window.open(data.url, '_blank', 'noopener');
    return;
  }
  const search = queryFrom(data);
  if (search) openCabinet(search, location.hash);
});
setTimeout(function(){ openCabinet(location.search, location.hash); }, 1200);
</script>
</body>
</html>
`;
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'build/index.html'), html);
