const express = require('express');
const path = require('path');
const apiRoutes = require('./api_routes');

function startWebApp() {
    const app = express();

    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    const publicPath = path.join(__dirname, '../public');

    // 1. Раздача статических файлов (CSS, JS)
    app.use(express.static(publicPath));

    // 2. Роуты API
    app.use('/api', apiRoutes);

    // 3. Явная отдача index.html на любой главный запрос
    app.get('/', (req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });

    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => {
        console.log(`📱 WebApp сервер запущен на порту ${PORT}`);
    });

    return app;
}

module.exports = { startWebApp };