# Hayanmi Detailing — сайт

Одностраничный сайт с формой заявок. Заявки сохраняются в PostgreSQL,
приходят в Telegram и видны на странице `/admin`.

Картинки сайта скачиваются автоматически при `npm install`
(скрипт `scripts/fetch-assets.js`) и кладутся в папку `public/`.

## Запуск на Railway

1. Загрузите эту папку в новый репозиторий на GitHub.
2. В Railway: **New Project → Deploy from GitHub repo** и выберите репозиторий.
3. В проекте нажмите **+ New → Database → PostgreSQL**.
4. Откройте сервис сайта → **Variables** и добавьте:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (ссылка на базу из шага 3)
   - `TELEGRAM_BOT_TOKEN` = токен бота от @BotFather
   - `TELEGRAM_CHAT_ID` = ваш chat ID (узнать у @userinfobot)
   - `ADMIN_PASSWORD` = пароль для страницы /admin
5. **Settings → Networking → Generate Domain**, чтобы получить адрес сайта.
   Свой домен подключается там же через **Custom Domain**.

Railway сам поставит зависимости и запустит `npm start`.

## Что поменять

Телефон, адрес, часы и Instagram указаны в `public/index.html`
(ищите `+992 00 000 00 00` и `адрес появится скоро`).

## Локально

```
npm install
npm start
```
Сайт откроется на http://localhost:3000. Без `DATABASE_URL` заявки не
сохраняются, но уходят в Telegram, если он настроен.
