# Telegram AI Bot + PostgreSQL

Проект готов к деплою с базой данных PostgreSQL (с нуля, без переноса старых данных).

## Структура
- `index.js` — точка входа
- `core/bot.js` — логика бота (балансы через Postgres)
- `core/db.js` — модуль работы с PostgreSQL
- `ai_plugins/` — плагины Google Gemini и Братуха
- `ui_modules/webapp_server.js` — Express-сервер
- `public/index.html` — заготовка мини-приложения

## Переменные окружения (Railway / .env)
Обязательные:
```
BOT_TOKEN=ваш_токен_бота
DATABASE_URL=postgresql://user:password@host:port/dbname
GEMINI_API_KEY=ваш_ключ
BRATUKHA_API_KEY=ваш_ключ
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
YOOKASSA_RETURN_URL=https://t.me/ваш_бот
WEBAPP_URL=https://ваш-сервис.up.railway.app   # или домен мини-приложения
TEMPLATES_SCRIPT_URL=https://script.google.com/macros/s/.../exec
TEMPLATES_KEY=секрет_из_таблицы
TEMPLATES_CACHE_SEC=300
TEMPLATE_MODEL=nanobanana
GIGACHAT_AUTH_KEY=
ADMIN_PASSWORD=admin123
```

Шаблоны кабинета запрашиваются у Apps Script (`POST {"action":"templates","key":...}`). Промпт на клиент не отдаётся: для шаблона с примером доступны только прикрепление фото и кнопка «Сгенерировать». Дневной лимит GigaChat задаётся в админке (пустое поле — без лимита) и считается по московским суткам.

## Мини-приложение
- Открывается кнопкой «📱 Личный кабинет» в главном меню.
- Показывает баланс и позволяет менять модель.
- API: `/api/me?userId=...` и `/api/set-model`.

Railway обычно сам подставляет `DATABASE_URL`, если Postgres привязан к сервису.

## Локальный запуск (для теста)
```bash
cd telegram-ai-bot
npm install
# создайте .env с переменными выше
npm start
```

## Деплой на Railway
1. Загрузите архив или подключите GitHub.
2. Убедитесь, что Postgres volume привязан к сервису (переменная `DATABASE_URL` появится автоматически).
3. Добавьте остальные переменные окружения.
4. Start Command: `npm start` или `node index.js`.
5. Redeploy.

При первом запуске бот создаст таблицу `users`. Новые пользователи получают баланс 0.

## Что изменилось
- Балансы, списание и начисление полностью на PostgreSQL.
- Старый Google Script больше не используется.
- Таблица создаётся автоматически.
