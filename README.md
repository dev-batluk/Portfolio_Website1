# Maison Éclat — Студия эстетики лица и ухода

Адаптивный лендинг студии эстетики лица и SPA в Новосибирске с интерактивным каталогом процедур, галереей, каруселью отзывов и быстрой онлайн-записью в **Telegram** бота.

## Стек и особенности

- **Zero-build фронтенд:** чистые HTML5, CSS3 и Vanilla JS (без фреймворков, сборщиков и внешних npm-зависимостей).
- **Быстрый каталог процедур:** карточки направлений, табы с плавным индикатором и живой поиск по услугам с автоподстановкой в форму записи.
- **Серверная отправка заявок (`/api/booking`):** валидация полей, honeypot-защита от спама и мгновенная доставка заявок в Telegram Bot API (без переменных окружения работает в безопасном демо-режиме).
- **Мультиплатформенная готовность:** поддержка развёртывания на **Netlify** и **Vercel** из коробки.
- **Безопасность и SEO:** заголовки кеширования и безопасности (CSP, nosniff, frame-options), OpenGraph, JSON-LD `BeautySalon`, юридические модальные окна (152-ФЗ / 149-ФЗ).

---

## Структура проекта

```text
├── index.html                  # Разметка лендинга и модальных окон
├── css/
│   └── styles.css              # Стили, дизайн-токены и плавные анимации
├── js/
│   └── main.js                 # Скролл-эффекты, поиск услуг, карусель, лайтбокс, форма
├── api/
│   └── booking.js              # Vercel Serverless Function (POST /api/booking → Telegram)
├── netlify/
│   └── functions/
│       └── booking.js          # Netlify Serverless Function (POST /api/booking → Telegram)
├── photos/                     # Оптимизированные изображения сайта (WebP, JPG)
├── netlify.toml                # Конфигурация Netlify (headers, redirects, functions)
├── vercel.json                 # Конфигурация Vercel (cleanUrls, кеш, security headers)
├── .env.example                # Шаблон переменных окружения для Telegram
├── .gitignore                  # Исключает локальные бекапы, .env и тяжёлые исходники
└── .vercelignore               # Исключает ненужные для деплоя файлы
```

---

## Деплой на Netlify (рекомендуемый способ)

1. Войдите в личный кабинет [app.netlify.com](https://app.netlify.com/) (через GitHub).
2. Нажмите **Add new site** → **Import an existing project**.
3. Выберите провайдер **GitHub** и найдите репозиторий `Portfolio_Website1`.
4. Все параметры сборки Netlify подтянет автоматически из файла `netlify.toml`:
   - **Base directory:** не заполнять (корень)
   - **Build command:** не заполнять (статический сайт)
   - **Publish directory:** `.`
   - **Functions directory:** `netlify/functions`
5. *(Опционально)* Для подключения реальных заявок в Telegram перейдите в **Site configuration** → **Environment variables** и добавьте:
   - `TELEGRAM_BOT_TOKEN` — токен бота от [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_CHAT_ID` — ID вашего чата или канала (можно узнать в [@userinfobot](https://t.me/userinfobot))
6. Нажмите **Deploy Portfolio_Website1**. Сайт будет доступен по ссылке `*.netlify.app` через 10 секунд!

---

## Деплой на Vercel

1. Войдите на [vercel.com](https://vercel.com/) через GitHub.
2. Нажмите **Add New...** → **Project** и импортируйте `Portfolio_Website1`.
3. В разделе **Environment Variables** при необходимости добавьте `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`.
4. Нажмите **Deploy**.

---

## Локальный запуск

Сайт работает без сборки:
```bash
# Любой локальный статический сервер, например:
npx serve .
# или Python:
python -m http.server 3000
```
Откройте `http://localhost:3000` в браузере.
