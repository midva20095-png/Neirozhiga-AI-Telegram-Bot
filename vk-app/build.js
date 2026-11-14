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
function tellCabinet(msg){
  const frame = document.querySelector('iframe');
  if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*');
}
let fragment = '';
function rememberFragment(value){
  const goal = String(value || '').replace(/^#/, '').split('&')[0].split('?')[0];
  if (goal !== 'rate' && goal !== 'site' && goal !== 'sub') return;
  fragment = goal;
  tellCabinet({ type: 'ny-goal', goal: goal });
}
function readFragment(){ rememberFragment(location.hash); }
readFragment();
window.addEventListener('hashchange', readFragment);
setTimeout(readFragment, 400);
setTimeout(readFragment, 1500);
function showCovers(groupId, code){
  const id = String(groupId || here.get('vk_group_id') || '230706467');
  const body = String(code || '');
  if (body.indexOf('cover_id') < 0 || body.length > 12000) return;
  vkSend('VKWebAppShowCommunityWidgetPreviewBox', {
    group_id: Number(id),
    type: 'cover_list',
    code: body
  });
}
const here = new URLSearchParams(location.search);
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
  if (data.type === 'ny-goal-ask') {
    readFragment();
    if (fragment) tellCabinet({ type: 'ny-goal', goal: fragment });
    return;
  }
  if (data.type === 'ny-community-token') {
    vkSend('VKWebAppGetCommunityToken', {
      app_id: 54895627,
      group_id: Number(here.get('vk_group_id') || '230706467'),
      scope: 'app_widget'
    });
    return;
  }
  if (data.type === 'ny-widget-show') { showCovers(data.group_id, data.code); return; }
  let bridgeType = (data.data && data.data.type) || data.handler || '';
  let bridgeData = (data.data && data.data.data) || data.params || {};
  if (!bridgeType && String(data.type || '').indexOf('VKWebApp') === 0) {
    bridgeType = data.type;
    bridgeData = data.data || {};
  }
  if (bridgeType === 'VKWebAppChangeFragment' || bridgeType === 'VKWebAppLocationChanged') {
    rememberFragment((bridgeData && (bridgeData.location || bridgeData.hash)) || (data.data && data.data.location) || '');
    return;
  }
  if (bridgeType === 'VKWebAppGetCommunityTokenResult' && bridgeData.access_token) {
    tellCabinet({ type: 'ny-community-token', token: bridgeData.access_token });
    return;
  }
  if (bridgeType === 'VKWebAppGetCommunityTokenFailed') {
    tellCabinet({ type: 'ny-community-token-fail' });
    return;
  }
  if (String(bridgeType).indexOf('WidgetPreviewBoxFailed') >= 0) {
    tellCabinet({ type: 'ny-widget-fail' });
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
