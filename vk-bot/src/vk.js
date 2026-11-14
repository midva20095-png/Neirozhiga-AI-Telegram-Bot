const { toJpeg } = require('./media');

const API = 'https://api.vk.com/method';
const VERSION = '5.199';

function token() {
  return process.env.VK_GROUP_TOKEN || '';
}

function button(label, color, payload) {
  return { action: { type: 'text', label, payload: JSON.stringify(payload || { cmd: label }) }, color };
}

function menuKeyboard() {
  return JSON.stringify({
    one_time: false,
    buttons: [
      [button('Баланс', 'primary'), button('В меню', 'secondary')],
      [button('Пополнить баланс', 'positive')]
    ]
  });
}

async function call(method, params) {
  if (!token()) throw new Error('Нужна переменная VK_GROUP_TOKEN');
  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) body.set(key, String(value));
  });
  body.set('access_token', token());
  body.set('v', VERSION);
  const response = await fetch(`${API}/${method}`, { method: 'POST', body });
  return response.json();
}

function randomId() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function sendText(userId, text, keyboard) {
  const params = { user_id: userId, random_id: randomId(), message: text };
  if (keyboard) params.keyboard = keyboard;
  const result = await call('messages.send', params);
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result;
}

async function uploadAttachment(userId, buffer, filename, kind) {
  if (kind === 'photo') {
    const server = await call('photos.getMessagesUploadServer', { peer_id: userId });
    if (server.error) throw new Error(JSON.stringify(server.error));
    const form = new FormData();
    form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), filename);
    const uploaded = await fetch(server.response.upload_url, { method: 'POST', body: form });
    const payload = await uploaded.json();
    if (!payload.photo || payload.photo === '[]') throw new Error('ВК не принял фото');
    const saved = await call('photos.saveMessagesPhoto', { photo: payload.photo, server: payload.server, hash: payload.hash });
    if (saved.error) throw new Error(JSON.stringify(saved.error));
    const photo = saved.response[0];
    return `photo${photo.owner_id}_${photo.id}${photo.access_key ? `_${photo.access_key}` : ''}`;
  }
  const server = await call('docs.getMessagesUploadServer', { peer_id: userId, type: 'doc' });
  if (server.error) throw new Error(JSON.stringify(server.error));
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  const uploaded = await fetch(server.response.upload_url, { method: 'POST', body: form });
  const payload = await uploaded.json();
  if (!payload.file) throw new Error('ВК не принял файл');
  const saved = await call('docs.save', { file: payload.file, title: filename });
  if (saved.error) throw new Error(JSON.stringify(saved.error));
  const doc = saved.response.doc || saved.response[0] || saved.response;
  return `doc${doc.owner_id}_${doc.id}${doc.access_key ? `_${doc.access_key}` : ''}`;
}

async function sendAttachment(userId, buffer, filename, caption, keyboard, kind) {
  const prepared = kind === 'photo' ? await toJpeg(buffer) : buffer;
  const attachment = await uploadAttachment(userId, prepared, kind === 'photo' ? 'photo.jpg' : filename, kind);
  const params = { user_id: userId, random_id: randomId(), message: caption || '', attachment };
  if (keyboard) params.keyboard = keyboard;
  const result = await call('messages.send', params);
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result;
}

async function sendPhoto(userId, buffer, caption, keyboard) {
  try {
    return await sendAttachment(userId, buffer, 'photo.jpg', caption, keyboard, 'photo');
  } catch (error) {
    return sendAttachment(userId, await toJpeg(buffer), 'photo.jpg', caption, keyboard, 'doc');
  }
}

async function sendDoc(userId, buffer, filename, caption, keyboard) {
  return sendAttachment(userId, buffer, filename, caption, keyboard, 'doc');
}

async function isMember(userId) {
  if (!token() || !process.env.VK_GROUP_ID) return { sub: false, err: true };
  try {
    const result = await call('groups.isMember', { group_id: process.env.VK_GROUP_ID, user_id: userId });
    if (result.error) return { sub: false, err: true };
    return { sub: Number(result.response) === 1 };
  } catch (error) {
    return { sub: false, err: true };
  }
}

function photoUrls(message) {
  const urls = [];
  for (const item of message.attachments || []) {
    if (item.type !== 'photo' || !item.photo) continue;
    const sizes = item.photo.sizes || [];
    let best = null;
    sizes.forEach(size => {
      if (!best || size.width * size.height > best.width * best.height) best = size;
    });
    const url = (item.photo.orig_photo && item.photo.orig_photo.url) || (best && best.url);
    if (url) urls.push(url);
  }
  return urls.slice(0, 6);
}

module.exports = { call, sendText, sendPhoto, sendDoc, isMember, menuKeyboard, photoUrls, button };
