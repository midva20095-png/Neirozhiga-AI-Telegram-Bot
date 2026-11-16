const fs = require('fs');
const path = require('path');

const api = String(process.env.NY_API || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app').replace(/\/$/, '');
const root = path.join(__dirname, '..', 'public');
const buildDir = path.join(__dirname, 'build');

const host = `<script>
window.__nyApi = ${JSON.stringify(api)};
(function(){
  const orig = window.fetch;
  window.fetch = function(input, init){
    if (typeof input === 'string' && input.charAt(0) === '/' && input.charAt(1) !== '/') input = window.__nyApi + input;
    return orig.call(this, input, init);
  };
})();
function vkSend(handler, params){
  try { parent.postMessage({ handler: handler, params: params || {}, type: 'vk-connect', connectVersion: '2.15.8', sendTime: Date.now() }, '*'); }
  catch (e) {}
}
vkSend('VKWebAppInit');
vkSend('VKWebAppGetLaunchParams');
function tell(msg){
  window.dispatchEvent(new MessageEvent('message', { data: msg }));
}
function goalOf(value){
  const goal = String(value || '').replace(/^#/, '').split('&')[0].split('?')[0];
  if (goal.indexOf('rate') === 0) return 'rate';
  return goal === 'site' || goal === 'sub' ? goal : '';
}
window.__nyHost = function(msg){
  if (!msg || !msg.type) return;
  if (msg.type === 'ny-goal-ask') {
    const goal = goalOf(location.hash);
    if (goal) tell({ type: 'ny-goal', goal: goal });
    return;
  }
  if (msg.type === 'ny-group-ask') {
    const id = new URLSearchParams(location.search).get('vk_group_id') || '';
    if (id) tell({ type: 'ny-group', id: id });
    return;
  }
  if (msg.type === 'ny-community-token') {
    const id = new URLSearchParams(location.search).get('vk_group_id') || '';
    if (!id) { tell({ type: 'ny-community-token-fail' }); return; }
    vkSend('VKWebAppGetCommunityToken', { app_id: 54895627, group_id: Number(id), scope: 'app_widget' });
    return;
  }
  if (msg.type === 'ny-widget-show') {
    const id = String(msg.group_id || '').replace(/\\D/g, '');
    const body = String(msg.code || '');
    if (!id || body.indexOf('cover_id') < 0 || body.length > 12000) { tell({ type: 'ny-widget-fail' }); return; }
    vkSend('VKWebAppShowCommunityWidgetPreviewBox', { group_id: Number(id), type: 'cover_list', code: body });
    return;
  }
  if (msg.type === 'ny-user-ask') {
    vkSend('VKWebAppGetAuthToken', { app_id: 54895627, scope: '' });
    return;
  }
  if ((msg.type === 'ny-open' || msg.type === 'ny-pay') && /^https:\\/\\//.test(String(msg.url || ''))) {
    vkSend('VKWebAppOpenLink', { url: msg.url });
  }
};
window.addEventListener('message', function(event){
  let data = event.data || {};
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { data = {}; }
  }
  if (data.type && String(data.type).indexOf('ny-') === 0) return;
  let bridgeType = (data.data && data.data.type) || data.handler || '';
  let bridgeData = (data.data && data.data.data) || data.params || {};
  if (!bridgeType && String(data.type || '').indexOf('VKWebApp') === 0) {
    bridgeType = data.type;
    bridgeData = data.data || {};
  }
  if (bridgeType === 'VKWebAppChangeFragment' || bridgeType === 'VKWebAppLocationChanged') {
    const goal = goalOf((bridgeData && (bridgeData.location || bridgeData.hash)) || (data.data && data.data.location) || '');
    if (goal) tell({ type: 'ny-goal', goal: goal });
    return;
  }
  if (bridgeType === 'VKWebAppGetLaunchParamsResult') {
    const bag = {};
    [bridgeData, bridgeData && bridgeData.params, bridgeData && bridgeData.data].forEach(function(level){
      if (!level || typeof level !== 'object') return;
      Object.keys(level).forEach(function(key){
        if (key === 'sign' || key.indexOf('vk_') === 0) bag[key] = level[key];
      });
    });
    const id = String(bag.vk_group_id || (bridgeData && bridgeData.group_id) || '').replace(/\\D/g, '');
    if (id) tell({ type: 'ny-group', id: id });
    tell({ type: 'ny-launch', params: bag });
    return;
  }
  if (bridgeType === 'VKWebAppGetCommunityTokenResult' && bridgeData.access_token) {
    tell({ type: 'ny-community-token', token: bridgeData.access_token });
    return;
  }
  if (bridgeType === 'VKWebAppGetCommunityTokenFailed') {
    tell({ type: 'ny-community-token-fail' });
    return;
  }
  if (bridgeType === 'VKWebAppGetAuthTokenResult' && bridgeData.access_token) {
    tell({ type: 'ny-user-token', token: bridgeData.access_token });
    return;
  }
  if (bridgeType === 'VKWebAppGetAuthTokenFailed') {
    tell({ type: 'ny-user-token-fail' });
    return;
  }
  if (String(bridgeType).indexOf('WidgetPreviewBoxFailed') >= 0) {
    const reason = bridgeData && (bridgeData.error_reason || (bridgeData.error_data && bridgeData.error_data.error_reason) || '');
    tell({ type: 'ny-widget-fail', reason: String(reason || '').replace(/access_token=[^&\\s]+/g, '').slice(0, 180) });
  }
});
</script>
`;

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"(?: defer)?><\/script>\n?/g, '');
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^"]*" rel="stylesheet">\n?/g, '');
const saver = fs.readFileSync(path.join(root, 'save-work.js'), 'utf8');
if (!html.includes('<script src="/save-work.js"></script>')) throw new Error('В кабинете нет сохранения работ');
html = html.replace('<script src="/save-work.js"></script>', '<script>\n' + saver + '\n</script>');
if (!html.includes('function nyPost(')) throw new Error('В кабинете нет связи с приложением ВК');
const at = html.indexOf('<script>');
if (at < 0) throw new Error('В кабинете нет скрипта');
html = html.slice(0, at) + host + html.slice(at);
if (html.includes('location.replace')) throw new Error('Приложение ВК не должно уходить с адреса ВК');

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(buildDir, 'widget'), { recursive: true });
for (const name of ['chat', 'rate', 'site']) {
    fs.copyFileSync(path.join(root, 'widget', name + '.jpg'), path.join(buildDir, 'widget', name + '.jpg'));
}
fs.copyFileSync(path.join(root, 'cover.jpg'), path.join(buildDir, 'cover.jpg'));
fs.writeFileSync(path.join(buildDir, 'index.html'), html);
