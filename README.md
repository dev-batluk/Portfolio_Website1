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
