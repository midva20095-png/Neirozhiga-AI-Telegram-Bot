const fs = require('fs');
const path = require('path');

const api = String(process.env.NY_API || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app').replace(/\/$/, '');
const buildDir = path.join(__dirname, 'build');

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>НейроЯга</title>
<script>
parent.postMessage({ handler: 'VKWebAppInit', params: {}, type: 'vk-connect', connectVersion: '2.15.8', sendTime: Date.now() }, '*');
location.replace(${JSON.stringify(api + '/')} + location.search + location.hash);
</script>
</head>
<body>
<p>Открываю кабинет с сервера бота…</p>
</body>
</html>
`;

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'index.html'), html);
