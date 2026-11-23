import bookingCore from '../../lib/booking-core.js';
import telegramBroadcast from '../../lib/telegram-broadcast.js';

const {
  validateBookingPayload,
  generateBookingId,
  formatTelegramMessage,
} = bookingCore;

const {
  createSubscriberStore,
  broadcastBookingMessage,
} = telegramBroadcast;

const MAX_BODY_BYTES = 32768;

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(
      405,
      { ok: false, error: 'Method Not Allowed' },
      { Allow: 'POST' }
    );
  }

  let body = {};
  try {
    const rawText = await req.text();
    if (Buffer.byteLength(rawText, 'utf8') > MAX_BODY_BYTES) {
      return jsonResponse(400, {
        ok: false,
        error: 'Некорректный формат данных заявки',
        fields: {},
      });
    }
    body = rawText.trim() ? JSON.parse(rawText) : {};
  } catch {
    return jsonResponse(400, {
      ok: false,
      error: 'Некорректный формат данных заявки',
      fields: {},
    });
  }

  const validation = validateBookingPayload(body);

  if (validation.isSpam) {
    return jsonResponse(200, {
      ok: true,
      mode: 'demo',
      bookingId: generateBookingId(),
    });
  }

  if (Object.keys(validation.fields).length > 0) {
    return jsonResponse(400, {
      ok: false,
      error: 'Пожалуйста, проверьте заполнение обязательных полей',
      fields: validation.fields,
    });
  }

  const bookingId = generateBookingId();
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!botToken) {
    return jsonResponse(200, {
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
        return jsonResponse(502, {
          ok: false,
          error:
            'В Telegram-боте пока нет подписчиков. Откройте бота, нажмите /start и повторите отправку — или позвоните нам: +7 (383) 209-48-15',
        });
      }
      return jsonResponse(502, {
        ok: false,
        error: 'Сервис записи временно недоступен. Позвоните администратору: +7 (383) 209-48-15',
      });
    }

    return jsonResponse(200, {
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
    return jsonResponse(502, {
      ok: false,
      error:
        'Не удалось связаться с сервером. Попробуйте позже или позвоните по номеру +7 (383) 209-48-15',
    });
  }
};

export const config = {
  path: '/api/booking',
};
