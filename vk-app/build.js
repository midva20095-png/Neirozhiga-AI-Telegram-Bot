const fs = require('fs');
const path = require('path');

const api = process.env.NY_API || 'https://neirozhiga-ai-telegram-bot-production-7ae5.up.railway.app';
const source = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const hook = '<script>window.NY_API=' + JSON.stringify(api) + ';var _fetch=window.fetch;window.fetch=function(u,o){if(typeof u==="string"&&u.charAt(0)==="/")u=window.NY_API+u;return _fetch.call(this,u,o);};</script>';
const html = source.replace('<head>', '<head>' + hook);
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'build/index.html'), html);
