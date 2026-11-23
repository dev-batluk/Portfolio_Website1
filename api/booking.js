'use strict';

const {
  escapeHtml,
  validateBookingPayload,
  generateBookingId,
  formatTelegramMessage,
} = require('../lib/booking-core');

const {
  createSubscriberStore,
  broadcastBookingMessage,
} = require('../lib/telegram-broadcast');

const MAX_BODY_BYTES = 32768;

async function parseRequestBody(req, maxBytes = MAX_BODY_BYTES) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
        throw new Error('PAYLOAD_TOO_LARGE');
      }
      return req.body.trim() ? JSON.parse(req.body) : {};
    }
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > maxBytes) {
        throw new Error('PAYLOAD_TOO_LARGE');
      }
      const text = req.body.toString('utf8').trim();
      return text ? JSON.parse(text) : {};
    }
    if (typeof req.body === 'object') {
      return req.body;
    }
  }

  if (typeof req.on !== 'function') {
    return {};
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
  return res;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, {
      ok: false,
      error: 'Method Not Allowed',
    });
  }

  let body;
  try {
    body = await parseRequestBody(req);
  } catch {
    return sendJson(res, 400, {
      ok: false,
      error: 'Некорректный формат данных заявки',
      fields: {},
    });
  }

  const validation = validateBookingPayload(body);

  if (validation.isSpam) {
    return sendJson(res, 200, {
      ok: true,
      mode: 'demo',
      bookingId: generateBookingId(),
    });
  }

  if (Object.keys(validation.fields).length > 0) {
    return sendJson(res, 400, {
      ok: false,
      error: 'Пожалуйста, проверьте заполнение обязательных полей',
      fields: validation.fields,
    });
  }

  const bookingId = generateBookingId();
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!botToken) {
    return sendJson(res, 200, {
      ok: true,
      mode: 'demo',
      bookingId,
    });
  }

  try {
    const store = createSubscriberStore({ env: process.env });
    const message = formatTelegramMessage(validation.data, bookingId);
    const result = await broadcastBookingMessage({
      botToken,
      text: message,
      bookingId,
      store,
      env: process.env,
    });

    if (!result.ok) {
      if (result.reason === 'no_subscribers') {
        return sendJson(res, 502, {
          ok: false,
          error:
            'В Telegram-боте пока нет подписчиков. Откройте бота, нажмите /start и повторите отправку — или позвоните нам: +7 (383) 209-48-15',
        });
      }
      return sendJson(res, 502, {
        ok: false,
        error: 'Сервис записи временно недоступен. Позвоните администратору: +7 (383) 209-48-15',
      });
    }

    return sendJson(res, 200, {
      ok: true,
      mode: 'telegram',
      bookingId,
      recipients: result.delivered,
    });
  } catch (err) {
    console.error('[booking] Telegram broadcast failed', {
      message: err instanceof Error ? err.message : 'Unknown error',
      bookingId,
    });
    return sendJson(res, 502, {
      ok: false,
      error:
        'Не удалось связаться с сервером. Попробуйте позже или позвоните по номеру +7 (383) 209-48-15',
    });
  }
}

handler._internal = {
  escapeHtml,
  validateBookingPayload,
  formatTelegramMessage,
};

module.exports = handler;
