# MY WEEK

Планер недели в виде веб-приложения (PWA): план дня, тренировки, питание с подсчётом БЖУ по фото, напоминания, статистика, друзья и статус «в зале».

## Структура

- `site/` само приложение (статический сайт)
- `functions/api/food.js` функция Cloudflare Pages: распознавание еды по фото через Gemini
- `server/` сервер друзей и уведомлений (Node.js), запускается на своём сервере

## Запуск

1. Сайт и функция на Cloudflare Pages: `npx wrangler pages deploy site --project-name myweek`
2. Секрет с ключом нейросети: `npx wrangler pages secret put GEMINI_API_KEY --project-name myweek`
3. Сервер друзей: см. `server/ИНСТРУКЦИЯ-СЕРВЕР.txt`, адрес сервера записывается в `site/config.js`

## Важно

В репозиторий нельзя класть ключи: `GEMINI_API_KEY`, ключи уведомлений VAPID, файлы `.env` и `myweek.db`. Они хранятся только в настройках Cloudflare и на сервере.
