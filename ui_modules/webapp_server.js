const express = require('express');
const path = require('path');
const apiRoutes = require('./api_routes');

function startWebApp() {
    const app = express();

    // Поддержка загрузки картинок (base64)
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // 1. Раздача фронтенда из папки public
    app.use(express.static(path.join(__dirname, '../public')));

    // 2. Подключение API роутов
    app.use('/api', apiRoutes);

    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => {
        console.log(`📱 WebApp сервер запущен на порту ${PORT}`);
    });

    return app;
}

module.exports = { startWebApp };