const fs = require('fs');
const path = require('path');
const express = require('express');
const { userFromLaunch } = require('./launch');
const db = require('./db');
const generate = require('./generate');

function apiBase(req) {
  const configured = process.env.PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '') + '/api';
  return `${req.protocol}://${req.get('host')}/api`;
}

function publicBase(req) {
  const configured = process.env.PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.text({ type: '*/*', limit: '20mb' }));

  app.get('/health', async (req, res) => {
    try {
      const counts = await db.counts();
      res.json({ ok: true, service: 'yaga-vk-bot', ...counts });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get(['/', '/index.html'], (req, res) => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    generate.configure({ base: publicBase(req) });
    res.type('html').send(html.replaceAll('__API__', apiBase(req)));
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/media/:id', async (req, res) => {
    const file = await db.upload(req.params.id);
    if (!file) return res.status(404).end();
    res.set('Content-Type', file.mime);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(file.bytes);
  });

  app.post('/api', async (req, res) => {
    try {
      const body = JSON.parse(req.body || '{}');
      generate.configure({ base: publicBase(req) });
      const userId = userFromLaunch(body.launch, process.env.VK_APP_SECRET);
      if (!userId) return res.json({ ok: false, error: 'Откройте приложение из ВКонтакте' });
      if (body.action === 'init') return res.json(await generate.initUser(userId));
      if (body.action === 'daily') return res.json(await generate.claimDaily(userId));
      if (body.action === 'up') return res.json(await generate.uploadChunk(userId, body));
      if (body.action === 'create') return res.json(await generate.createFree(userId, body));
      return res.json(await generate.runTemplate(userId, body));
    } catch (error) {
      console.error('API:', error.message);
      res.json({ ok: false, error: 'Сервер не смог выполнить запрос' });
    }
  });

  app.post('/hook', async (req, res) => {
    try {
      const body = JSON.parse(req.body || '{}');
      res.json(await generate.hook(body));
    } catch (error) {
      res.json({ response: 'error', error: error.message });
    }
  });

  app.use((error, req, res, next) => {
    res.status(413).json({ ok: false, error: 'Слишком большой запрос' });
  });

  return app;
}

module.exports = { createApp, apiBase };
