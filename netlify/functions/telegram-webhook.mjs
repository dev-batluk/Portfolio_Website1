import telegramBroadcast from '../../lib/telegram-broadcast.js';

const {
  getWebhookSecret,
  verifyWebhookSecret,
  createSubscriberStore,
  handleTelegramWebhookUpdate,
} = telegramBroadcast;

const MAX_WEBHOOK_BYTES = 65536;

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

  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) {
    return jsonResponse(503, { ok: false, error: 'Bot is not configured' });
  }

  const receivedSecret = req.headers.get('x-telegram-bot-api-secret-token') || '';
  const expectedSecret = getWebhookSecret(botToken, process.env);

  if (!verifyWebhookSecret(receivedSecret, expectedSecret)) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized' });
  }

  let update;
  try {
    const rawText = await req.text();
    if (Buffer.byteLength(rawText, 'utf8') > MAX_WEBHOOK_BYTES) {
      return jsonResponse(400, { ok: false, error: 'Payload too large' });
    }
    update = rawText.trim() ? JSON.parse(rawText) : {};
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON' });
  }

  try {
    const store = createSubscriberStore({ env: process.env });
    await handleTelegramWebhookUpdate({
      update,
      botToken,
      store,
    });
  } catch (err) {
    console.error('[telegram-webhook] Update processing failed', {
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  return jsonResponse(200, { ok: true });
};

export const config = {
  path: '/api/telegram-webhook',
};
