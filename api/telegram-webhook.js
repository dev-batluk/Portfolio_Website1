'use strict';

const {
  getWebhookSecret,
  verifyWebhookSecret,
  createSubscriberStore,
  handleTelegramWebhookUpdate,
} = require('../lib/telegram-broadcast');

const MAX_WEBHOOK_BYTES = 65536;

function getHeaderCaseInsensitive(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  const lowerTarget = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget) {
      if (Array.isArray(value)) {
        return typeof value[0] === 'string' ? value[0] : '';
      }
      return typeof value === 'string' ? value : '';
    }
  }
  return '';
}

async function parseWebhookBody(req, maxBytes = MAX_WEBHOOK_BYTES) {
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

  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) {
    return sendJson(res, 503, {
      ok: false,
      error: 'Bot is not configured',
    });
  }

  const receivedSecret = getHeaderCaseInsensitive(req.headers, 'x-telegram-bot-api-secret-token');
  const expectedSecret = getWebhookSecret(botToken, process.env);

  if (!verifyWebhookSecret(receivedSecret, expectedSecret)) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Unauthorized',
    });
  }

  let update;
  try {
    update = await parseWebhookBody(req);
  } catch {
    return sendJson(res, 400, {
      ok: false,
      error: 'Invalid JSON',
    });
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

  return sendJson(res, 200, { ok: true });
}

module.exports = handler;
