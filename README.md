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
TEMPLATE_MODEL=nanobanana
SITE_API_URL=https://neiroyaga-backend-production.up.railway.app
SITE_TRANSFER_KEY=общий_секрет_с_сайтом
GIGACHAT_AUTH_KEY=
KIE_API_KEY=ключ с https://kie.ai/api-key
ADMIN_PASSWORD=admin123
```

Ключ Kie ставится в переменные Railway сервиса бота: `KIE_API_KEY`, страница ключа https://kie.ai/api-key . После сохранения переменной сервис перезапускается. Пока ключа нет, разделы «Текст дешевле» и «Картинки дешевле» скрыты. В админке на вкладке «Модели» видно, задан ли ключ. Вкладка «Журнал» показывает оплату и сбои без текста запросов.

Шаблоны кабинета задаются только в админке бота: фото-пример, скрытый промпт, своя цена и модель. Google-таблица больше не используется. Для шаблона со скрытым промптом клиент видит пример, прикрепляет своё фото и нажимает «Сгенерировать». Дневной лимит GigaChat задаётся в админке (пустое поле — без лимита) и считается по московским суткам.

Кнопка «На сайт» и вкладка «Баланс» в кабинете переносят кредиты на почту аккаунта сайта. Кнопка «С сайта» и блок «Перенос в бот» на той же вкладке забирают кредиты обратно: сайт списывает их после проверки пароля кабинета, бот начисляет. Пароль на боте не хранится. На боте и на сайте должна быть одна и та же `SITE_TRANSFER_KEY`.

Сайт принимает `POST /api/telegram/transfer` с заголовком `X-Transfer-Key` и телом `{email, credits, transferId, telegramUserId}`. Если почты нет или сайт не подтвердил перевод, сумма возвращается на баланс бота.

Обратный перенос: `POST /api/telegram/balance` с `{email, password}`, `POST /api/telegram/pull` с `{email, password, credits, transferId, telegramUserId}` и `POST /api/telegram/pull/refund` с `{transferId}`. Повтор того же `transferId` не списывает сумму второй раз. Если сайт списал, а бот не успел начислить, следующий перенос доначисляет без нового списания.

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
