# Maison Éclat — Студия эстетики лица и ухода

Адаптивный лендинг студии эстетики лица и SPA в Новосибирске с интерактивным каталогом процедур, галереей, каруселью отзывов и быстрой онлайн-записью с рассылкой в **Telegram** бота.

## Стек и особенности

- **Zero-build фронтенд:** чистые HTML5, CSS3 и Vanilla JS (без фреймворков и клиентских бандлеров).
- **Быстрый каталог процедур:** карточки направлений, табы с плавным индикатором и живой поиск по услугам с автоподстановкой в форму записи.
- **Серверная рассылка заявок (`/api/booking`):** валидация полей, honeypot-защита от спама и доставка каждой новой заявки **всем пользователям и группам, которые запустили бота (`/start`)**.
- **Постоянная база подписчиков и команды бота (`/api/telegram-webhook`):** на Netlify подписчики сохраняются во встроенном **Netlify Blobs** (без внешней БД), а webhook подключается автоматически при первой заявке на продакшене. Бот поддерживает команды `/start`, `/stop` (`/unsubscribe`), `/status` и добавление в групповые чаты.
- **Мультиплатформенная готовность:** поддержка развёртывания на **Netlify** (рекомендуется) и **Vercel** из коробки.
- **Безопасность и SEO:** заголовки кеширования и безопасности (`nosniff`, `frame-options`, блокировка внутренних файлов), OpenGraph, JSON-LD `BeautySalon`, юридические модальные окна (152-ФЗ / 149-ФЗ).

---

## Структура проекта

```text
├── index.html                           # Разметка лендинга и модальных окон
├── css/
│   └── styles.css                       # Стили, дизайн-токены и плавные анимации
├── js/
│   └── main.js                          # Скролл-эффекты, поиск услуг, карусель, лайтбокс, форма
├── lib/
│   ├── booking-core.js                  # Общая валидация, форматирование и генерация ID заявок
│   └── telegram-broadcast.js            # Рассылка по подписчикам, хранилище и обработчик webhook
├── netlify/
│   └── functions/
│       ├── booking.mjs                  # Netlify Function v2 (POST /api/booking → Telegram рассылка)
│       └── telegram-webhook.mjs         # Netlify Function v2 (POST /api/telegram-webhook → /start, /stop)
├── api/
│   ├── booking.js                       # Vercel Serverless Function (POST /api/booking → Telegram рассылка)
│   └── telegram-webhook.js              # Vercel Serverless Function (POST /api/telegram-webhook)
├── tests/
│   └── booking.test.js                  # Автотесты бэкенда (node --test)
├── photos/                              # Оптимизированные изображения сайта (WebP, JPG)
├── package.json                         # Зависимости для Netlify Blobs и скрипт тестирования
├── netlify.toml                         # Конфигурация Netlify (Node 22, headers, защита внутренних путей)
├── vercel.json                          # Конфигурация Vercel (cleanUrls, кеш, security headers)
├── .env.example                         # Шаблон переменных окружения для Telegram
├── .gitignore                           # Исключает локальные бекапы, .env, node_modules и исходники
└── .vercelignore                        # Исключает ненужные для деплоя файлы
```

---

## Деплой на Netlify (рекомендуемый способ)

1. Войдите в личный кабинет [app.netlify.com](https://app.netlify.com/) (через GitHub).
2. Нажмите **Add new site** → **Import an existing project**.
3. Выберите провайдер **GitHub** и найдите репозиторий.
4. Все параметры сборки Netlify подтянет автоматически из `netlify.toml` и `package.json`:
   - **Base directory:** не заполнять (корень)
   - **Build command:** не заполнять (статический сайт; зависимости функций установятся автоматически)
   - **Publish directory:** `.`
   - **Functions directory:** `netlify/functions`
5. Перейдите в **Site configuration** → **Environment variables** и добавьте всего **одну** переменную:
   - `TELEGRAM_BOT_TOKEN` — токен бота от [@BotFather](https://t.me/BotFather)
6. *(Необязательно)* При желании можно дополнительно указать `TELEGRAM_CHAT_ID` (один или несколько ID через запятую) — эти чаты будут получать заявки всегда, даже без нажатия `/start`.
7. Нажмите **Deploy**. После деплоя каждый администратор или мастер, который откроет бота и нажмёт **Start (`/start`)** (или добавит бота в общий рабочий чат), начнёт получать все новые заявки с сайта. При первой заявке на продакшене сайт сам сохранит всех текущих подписчиков в **Netlify Blobs** и автоматически привяжет webhook для мгновенных ответов на `/start`, `/stop` и `/status`.

---

## Деплой на Vercel

1. Войдите на [vercel.com](https://vercel.com/) через GitHub.
2. Нажмите **Add New...** → **Project** и импортируйте репозиторий.
3. В **Environment Variables** добавьте `TELEGRAM_BOT_TOKEN`.
4. *(Рекомендуется для Vercel)* Чтобы подписчики хранились постоянно (дольше 24-часового окна `getUpdates` в Telegram) и работал автоматический webhook, подключите **Upstash Redis** (или Vercel KV) и добавьте `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`. Без Redis рассылка тоже работает сразу с одним `TELEGRAM_BOT_TOKEN` — через `getUpdates` по всем пользователям, нажавшим `/start` за последние 24 часа (либо указанным в `TELEGRAM_CHAT_ID`).
5. Нажмите **Deploy**.

---

## Локальный запуск и тесты

Сайт работает без сборки:
```bash
# Запуск автотестов бэкенда:
npm test

# Любой локальный статический сервер, например:
npx serve .
# или Python:
python -m http.server 3000
```
Откройте `http://localhost:3000` в браузере.
