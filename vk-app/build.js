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
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:#0b0614}
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
