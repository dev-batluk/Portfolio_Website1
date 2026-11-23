'use strict';

const crypto = require('crypto');

const BATCH_SIZE = 20;
const INTER_BATCH_DELAY_MS = 800;
const TELEGRAM_ALLOWED_UPDATES = ['message', 'my_chat_member'];
const STALE_START_SECONDS = 600;

const UNREACHABLE_400_RE =
  /chat not found|user not found|bot was blocked|bot was kicked|user is deactivated|chat_write_forbidden/i;

const memorySubscribers = new Set();
const memoryMeta = new Map();

function _resetMemoryStore() {
  memorySubscribers.clear();
  memoryMeta.clear();
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeErrorText(text) {
  return String(text || '').replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>');
}

function parseStaticChatIds(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }
  const tokens = raw.split(/[\s,;]+/);
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (/^-?\d+$/.test(trimmed) || /^@[A-Za-z0-9_]{4,}$/.test(trimmed)) {
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}

function getWebhookSecret(botToken, env = process.env) {
  const explicit = typeof env?.TELEGRAM_WEBHOOK_SECRET === 'string'
    ? env.TELEGRAM_WEBHOOK_SECRET.trim()
    : '';
  if (explicit) {
    return explicit;
  }
  return crypto
    .createHmac('sha256', String(botToken || ''))
    .update('maison-eclat-tg-webhook-v1')
    .digest('hex');
}

function verifyWebhookSecret(receivedHeader, expectedSecret) {
  if (typeof receivedHeader !== 'string' || typeof expectedSecret !== 'string') {
    return false;
  }
  if (!receivedHeader || !expectedSecret) {
    return false;
  }
  const a = Buffer.from(receivedHeader, 'utf8');
  const b = Buffer.from(expectedSecret, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function resolveProductionWebhookUrl(env = process.env) {
  if (!env || env.TELEGRAM_AUTO_WEBHOOK === 'false') {
    return null;
  }

  const explicitUrl = typeof env.TELEGRAM_WEBHOOK_URL === 'string'
    ? env.TELEGRAM_WEBHOOK_URL.trim()
    : '';
  if (explicitUrl) {
    return /^https:\/\//i.test(explicitUrl) ? explicitUrl.replace(/\/+$/, '') : null;
  }

  if (env.CONTEXT === 'production' && typeof env.URL === 'string' && /^https:\/\//i.test(env.URL.trim())) {
    return `${env.URL.trim().replace(/\/+$/, '')}/api/telegram-webhook`;
  }

  if (
    env.VERCEL_ENV === 'production' &&
    typeof env.VERCEL_PROJECT_PRODUCTION_URL === 'string' &&
    env.VERCEL_PROJECT_PRODUCTION_URL.trim()
  ) {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL.trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    if (host) {
      return `https://${host}/api/telegram-webhook`;
    }
  }

  return null;
}

function createMemoryStore() {
  return {
    kind: 'memory',
    isPersistent: false,
    async listSubscribers() {
      return Array.from(memorySubscribers);
    },
    async hasSubscriber(chatId) {
      return memorySubscribers.has(String(chatId));
    },
    async addSubscriber(chatId) {
      memorySubscribers.add(String(chatId));
    },
    async removeSubscriber(chatId) {
      memorySubscribers.delete(String(chatId));
    },
    async getMeta(key) {
      const val = memoryMeta.get(String(key));
      return val === undefined ? null : val;
    },
    async setMeta(key, value) {
      memoryMeta.set(String(key), String(value));
    },
  };
}

function createUpstashRedisStore({ url, token, fetchImpl = fetch }) {
  const endpoint = url.replace(/\/+$/, '');

  async function redisCmd(args) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(5000)
        : undefined,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error) {
      throw new Error(`Redis REST error (status ${response.status})`);
    }
    return payload.result;
  }

  return {
    kind: 'upstash-redis',
    isPersistent: true,
    async listSubscribers() {
      const result = await redisCmd(['SMEMBERS', 'tg:subscribers']);
      return Array.isArray(result) ? result.map(String) : [];
    },
    async hasSubscriber(chatId) {
      const result = await redisCmd(['SISMEMBER', 'tg:subscribers', String(chatId)]);
      return Number(result) === 1;
    },
    async addSubscriber(chatId) {
      await redisCmd(['SADD', 'tg:subscribers', String(chatId)]);
    },
    async removeSubscriber(chatId) {
      await redisCmd(['SREM', 'tg:subscribers', String(chatId)]);
    },
    async getMeta(key) {
      const result = await redisCmd(['GET', `tg:meta:${String(key)}`]);
      return result === null || result === undefined ? null : String(result);
    },
    async setMeta(key, value) {
      await redisCmd(['SET', `tg:meta:${String(key)}`, String(value)]);
    },
  };
}

function parseBlobsContextConsistency(rawBlobsCtx) {
  try {
    const decoded = Buffer.from(rawBlobsCtx, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      return !parsed.edgeURL || Boolean(parsed.uncachedEdgeURL);
    }
  } catch {
    // Fall back to default strong preference; any error will be caught by outer guard
  }
  return true;
}

function createNetlifyBlobsStore(rawBlobsCtx) {
  const useStrong = parseBlobsContextConsistency(rawBlobsCtx);
  const blobsLib = require('@netlify/blobs');
  const store = blobsLib.getStore({
    name: 'telegram-subscribers',
    consistency: useStrong ? 'strong' : 'eventual',
  });

  return {
    kind: 'netlify-blobs',
    isPersistent: true,
    async listSubscribers() {
      const result = await store.list({ prefix: 'sub/' });
      const blobs = Array.isArray(result?.blobs) ? result.blobs : [];
      return blobs.map((blob) => String(blob.key).slice(4)).filter(Boolean);
    },
    async hasSubscriber(chatId) {
      const val = await store.get(`sub/${String(chatId)}`);
      return val !== null && val !== undefined;
    },
    async addSubscriber(chatId, info = {}) {
      const idStr = String(chatId);
      await store.setJSON(`sub/${idStr}`, {
        chatId: idStr,
        type: info.type || 'private',
        username: info.username || '',
        firstName: info.firstName || '',
        updatedAt: new Date().toISOString(),
      });
    },
    async removeSubscriber(chatId) {
      await store.delete(`sub/${String(chatId)}`);
    },
    async getMeta(key) {
      const val = await store.get(`meta/${String(key)}`);
      return val === null || val === undefined ? null : String(val);
    },
    async setMeta(key, value) {
      await store.set(`meta/${String(key)}`, String(value));
    },
  };
}

function createFallbackStore({ env = process.env, fetchImpl = fetch } = {}) {
  const redisUrl = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim();
  const redisToken = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim();
  if (redisUrl && redisToken) {
    return createUpstashRedisStore({ url: redisUrl, token: redisToken, fetchImpl });
  }
  return createMemoryStore();
}

function createSubscriberStore({ env = process.env, customStore, fetchImpl = fetch } = {}) {
  if (customStore) {
    return customStore;
  }

  const rawBlobsCtx =
    (typeof globalThis.netlifyBlobsContext === 'string' && globalThis.netlifyBlobsContext) ||
    (typeof env?.NETLIFY_BLOBS_CONTEXT === 'string' ? env.NETLIFY_BLOBS_CONTEXT : '') ||
    '';

  if (rawBlobsCtx) {
    try {
      return createNetlifyBlobsStore(rawBlobsCtx);
    } catch (err) {
      console.warn('[booking] Netlify Blobs initialization failed, using fallback store', {
        name: err instanceof Error ? err.name : 'Error',
      });
    }
  }

  return createFallbackStore({ env, fetchImpl });
}

async function telegramRequest(botToken, method, payload = {}, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(timeoutMs)
        : undefined,
    });

    const data = await response.json().catch(() => null);
    return {
      httpStatus: response.status,
      ok: Boolean(response.ok && data && data.ok === true),
      result: data ? data.result : undefined,
      errorCode: data ? data.error_code : undefined,
      description: data ? data.description : undefined,
      parameters: data ? data.parameters : undefined,
    };
  } catch (err) {
    return {
      httpStatus: 0,
      ok: false,
      description: sanitizeErrorText(err instanceof Error ? err.message : 'Network error'),
    };
  }
}

function extractChatInfo(chat) {
  return {
    type: chat?.type || 'private',
    username: chat?.username || '',
    firstName: chat?.first_name || chat?.title || '',
  };
}

function extractChatStateChanges(updates) {
  const changes = new Map();
  let maxUpdateId = null;

  if (!Array.isArray(updates) || updates.length === 0) {
    return { changes, maxUpdateId };
  }

  const sorted = [...updates].sort((a, b) => (a?.update_id ?? 0) - (b?.update_id ?? 0));

  for (const update of sorted) {
    if (!update || typeof update !== 'object') continue;
    if (typeof update.update_id === 'number') {
      maxUpdateId = maxUpdateId === null ? update.update_id : Math.max(maxUpdateId, update.update_id);
    }

    if (update.message && typeof update.message === 'object') {
      const msg = update.message;
      if (msg.from?.is_bot === true || msg.chat?.id === undefined || msg.chat?.id === null) {
        continue;
      }
      const chatId = String(msg.chat.id);
      const chatType = msg.chat.type || 'private';
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';

      if (/^\/(stop|unsubscribe)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
        changes.set(chatId, { subscribed: false });
      } else if (chatType === 'private' || /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
        changes.set(chatId, {
          subscribed: true,
          info: extractChatInfo(msg.chat),
        });
      }
    } else if (update.my_chat_member && typeof update.my_chat_member === 'object') {
      const memberUpdate = update.my_chat_member;
      if (memberUpdate.chat?.id === undefined || memberUpdate.chat?.id === null) {
        continue;
      }
      const chatId = String(memberUpdate.chat.id);
      const status = memberUpdate.new_chat_member?.status;

      if (status === 'kicked' || status === 'left') {
        changes.set(chatId, { subscribed: false });
      } else if (status === 'member' || status === 'administrator') {
        changes.set(chatId, {
          subscribed: true,
          info: extractChatInfo(memberUpdate.chat),
        });
      }
    }
  }

  return { changes, maxUpdateId };
}

function isBlobsEnvError(err) {
  return Boolean(
    err &&
      (err.name === 'MissingBlobsEnvironmentError' || err.name === 'BlobsConsistencyError')
  );
}

async function syncSubscribersAndWebhook({ botToken, store, env = process.env, fetchImpl = fetch }) {
  let activeStore = store;
  let storedIds = [];

  try {
    storedIds = await activeStore.listSubscribers();
  } catch (err) {
    if (activeStore.kind === 'netlify-blobs' && isBlobsEnvError(err)) {
      console.warn('[booking] Netlify Blobs runtime error, falling back', { name: err.name });
      activeStore = createFallbackStore({ env, fetchImpl });
      storedIds = await activeStore.listSubscribers();
    } else {
      throw err;
    }
  }

  const targetWebhookUrl = activeStore.isPersistent ? resolveProductionWebhookUrl(env) : null;
  let registeredWebhookUrl = activeStore.isPersistent
    ? await activeStore.getMeta('webhook-url').catch(() => null)
    : null;

  if (
    activeStore.isPersistent &&
    targetWebhookUrl &&
    registeredWebhookUrl === targetWebhookUrl &&
    storedIds.length === 0
  ) {
    const infoRes = await telegramRequest(botToken, 'getWebhookInfo', {}, { fetchImpl });
    if (infoRes.httpStatus === 401) {
      return { fatalAuthError: true, status: 401 };
    }
    if (infoRes.ok && infoRes.result && infoRes.result.url !== targetWebhookUrl) {
      registeredWebhookUrl = null;
    }
  }

  const shouldPullUpdates =
    !activeStore.isPersistent ||
    !registeredWebhookUrl ||
    (targetWebhookUrl && registeredWebhookUrl !== targetWebhookUrl);

  if (shouldPullUpdates) {
    const updatesRes = await telegramRequest(
      botToken,
      'getUpdates',
      {
        offset: -100,
        limit: 100,
        timeout: 0,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      },
      { fetchImpl }
    );

    if (updatesRes.httpStatus === 401) {
      return { fatalAuthError: true, status: 401 };
    }

    if (updatesRes.ok && Array.isArray(updatesRes.result)) {
      const { changes } = extractChatStateChanges(updatesRes.result);
      const ops = [];
      for (const [chatId, change] of changes.entries()) {
        if (change.subscribed) {
          ops.push(activeStore.addSubscriber(chatId, change.info));
        } else {
          ops.push(activeStore.removeSubscriber(chatId));
        }
      }
      if (ops.length > 0) {
        await Promise.allSettled(ops);
      }
    } else if (updatesRes.httpStatus !== 409 && !updatesRes.ok) {
      console.warn('[booking] Telegram getUpdates failed', {
        status: updatesRes.httpStatus,
      });
    }
  }

  if (activeStore.isPersistent && targetWebhookUrl && registeredWebhookUrl !== targetWebhookUrl) {
    const webhookRes = await telegramRequest(
      botToken,
      'setWebhook',
      {
        url: targetWebhookUrl,
        secret_token: getWebhookSecret(botToken, env),
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
        drop_pending_updates: false,
      },
      { fetchImpl }
    );

    if (webhookRes.httpStatus === 401) {
      return { fatalAuthError: true, status: 401 };
    }

    if (webhookRes.ok) {
      await activeStore.setMeta('webhook-url', targetWebhookUrl).catch(() => {});
    } else {
      console.warn('[booking] Telegram setWebhook failed', {
        status: webhookRes.httpStatus,
      });
    }
  }

  const refreshedStoredIds = await activeStore.listSubscribers().catch(() => storedIds);
  const staticChatIds = parseStaticChatIds(env?.TELEGRAM_CHAT_ID);
  const staticChatIdSet = new Set(staticChatIds);
  const recipientSet = new Set([...refreshedStoredIds.map(String), ...staticChatIds]);

  return {
    fatalAuthError: false,
    recipients: Array.from(recipientSet),
    staticChatIdSet,
    storeKind: activeStore.kind,
    store: activeStore,
  };
}

function isUnreachableTelegramError(res) {
  if (res.httpStatus === 403) {
    return true;
  }
  if (res.httpStatus === 400 && UNREACHABLE_400_RE.test(res.description || '')) {
    return true;
  }
  return false;
}

async function sendToSingleChat({ botToken, chatId, text, store, staticChatIdSet, fetchImpl, sleepImpl }) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  let res = await telegramRequest(botToken, 'sendMessage', payload, { fetchImpl });

  if (res.httpStatus === 429) {
    const retryAfter = res.parameters?.retry_after;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0 && retryAfter <= 3) {
      await sleepImpl(retryAfter * 1000);
      res = await telegramRequest(botToken, 'sendMessage', payload, { fetchImpl });
    }
  }

  if (!res.ok && res.parameters?.migrate_to_chat_id !== undefined && res.parameters?.migrate_to_chat_id !== null) {
    const migratedId = String(res.parameters.migrate_to_chat_id);
    if (!staticChatIdSet.has(chatId)) {
      await store.removeSubscriber(chatId).catch(() => {});
    }
    await store.addSubscriber(migratedId, { type: 'supergroup' }).catch(() => {});
    res = await telegramRequest(
      botToken,
      'sendMessage',
      { ...payload, chat_id: migratedId },
      { fetchImpl }
    );
  }

  if (res.ok) {
    return { status: 'delivered' };
  }

  if (res.httpStatus === 401) {
    return { status: 'auth_error' };
  }

  if (isUnreachableTelegramError(res)) {
    if (!staticChatIdSet.has(chatId)) {
      await store.removeSubscriber(chatId).catch(() => {});
    }
    return { status: 'pruned' };
  }

  return { status: 'failed', httpStatus: res.httpStatus };
}

async function broadcastBookingMessage({
  botToken,
  text,
  bookingId,
  store,
  env = process.env,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
}) {
  const sync = await syncSubscribersAndWebhook({ botToken, store, env, fetchImpl });

  if (sync.fatalAuthError) {
    console.error('[booking] Telegram authorization failed', { bookingId });
    return { ok: false, reason: 'auth_error', delivered: 0, attempted: 0 };
  }

  const { recipients, staticChatIdSet, storeKind } = sync;
  const activeStore = sync.store;

  if (recipients.length === 0) {
    return { ok: false, reason: 'no_subscribers', delivered: 0, attempted: 0, storeKind };
  }

  let delivered = 0;
  let failed = 0;
  let pruned = 0;
  let authFailed = false;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((chatId) =>
        sendToSingleChat({
          botToken,
          chatId,
          text,
          store: activeStore,
          staticChatIdSet,
          fetchImpl,
          sleepImpl,
        })
      )
    );

    for (const entry of settled) {
      if (entry.status !== 'fulfilled') {
        failed += 1;
        continue;
      }
      if (entry.value.status === 'delivered') {
        delivered += 1;
      } else if (entry.value.status === 'auth_error') {
        authFailed = true;
      } else if (entry.value.status === 'pruned') {
        pruned += 1;
      } else {
        failed += 1;
      }
    }

    if (authFailed) {
      break;
    }

    if (i + BATCH_SIZE < recipients.length) {
      await sleepImpl(INTER_BATCH_DELAY_MS);
    }
  }

  if (delivered > 0) {
    return {
      ok: true,
      delivered,
      attempted: recipients.length,
      failed,
      pruned,
      storeKind,
    };
  }

  if (authFailed) {
    console.error('[booking] Telegram authorization failed during broadcast', { bookingId });
    return { ok: false, reason: 'auth_error', delivered: 0, attempted: recipients.length, storeKind };
  }

  if (pruned === recipients.length) {
    return {
      ok: false,
      reason: 'no_subscribers',
      delivered: 0,
      attempted: recipients.length,
      pruned,
      storeKind,
    };
  }

  console.error('[booking] Telegram delivery rejected for all recipients', {
    bookingId,
    attempted: recipients.length,
    failed,
  });
  return {
    ok: false,
    reason: 'delivery_failed',
    delivered: 0,
    attempted: recipients.length,
    storeKind,
  };
}

async function sendWebhookReply(botToken, chatId, text, fetchImpl) {
  try {
    await telegramRequest(
      botToken,
      'sendMessage',
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { fetchImpl }
    );
  } catch {
    // Reply delivery errors must never fail webhook HTTP 200 acknowledgement
  }
}

async function handleTelegramWebhookUpdate({
  update,
  botToken,
  store,
  fetchImpl = fetch,
  nowMs = Date.now(),
}) {
  if (!update || typeof update !== 'object') {
    return { action: 'ignored' };
  }

  if (update.message && typeof update.message === 'object') {
    const msg = update.message;
    if (msg.from?.is_bot === true || msg.chat?.id === undefined || msg.chat?.id === null) {
      return { action: 'ignored' };
    }

    const chatId = String(msg.chat.id);
    const chatType = msg.chat.type || 'private';
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    const info = extractChatInfo(msg.chat);
    const isGroup = chatType === 'group' || chatType === 'supergroup';

    if (/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
      const alreadySubscribed = await store.hasSubscriber(chatId);
      await store.addSubscriber(chatId, info);
      const isStale =
        typeof msg.date === 'number' && nowMs / 1000 - msg.date > STALE_START_SECONDS;

      if (!(alreadySubscribed && isStale)) {
        const welcome = isGroup
          ? '<b>Уведомления Maison Éclat подключены для этого чата.</b>\nВсе новые заявки с сайта будут приходить сюда.\n\nКоманды: /status — проверить статус, /stop — отключить.'
          : '<b>Вы подписаны на заявки Maison Éclat.</b>\nВсе новые записи с сайта будут мгновенно приходить в этот чат.\n\nКоманды: /status — проверить статус, /stop — отключить уведомления.';
        await sendWebhookReply(botToken, chatId, welcome, fetchImpl);
      }

      return { action: 'subscribed', chatId };
    }

    if (/^\/(stop|unsubscribe)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
      await store.removeSubscriber(chatId);
      await sendWebhookReply(
        botToken,
        chatId,
        '<b>Уведомления о заявках отключены.</b>\nЧтобы снова получать заявки, отправьте /start.',
        fetchImpl
      );
      return { action: 'unsubscribed', chatId };
    }

    if (/^\/status(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) {
      const active = await store.hasSubscriber(chatId);
      const statusMsg = active
        ? '<b>Подписка активна.</b> Вы получаете все новые заявки с сайта. Для отключения отправьте /stop.'
        : '<b>Подписка не активна.</b> Чтобы получать заявки с сайта, отправьте /start.';
      await sendWebhookReply(botToken, chatId, statusMsg, fetchImpl);
      return { action: 'status', chatId, active };
    }

    if (chatType === 'private') {
      const alreadySubscribed = await store.hasSubscriber(chatId);
      if (!alreadySubscribed) {
        await store.addSubscriber(chatId, info);
        await sendWebhookReply(
          botToken,
          chatId,
          '<b>Вы подписаны на заявки Maison Éclat.</b>\nВсе новые записи с сайта будут мгновенно приходить сюда.\n\nДля отключения отправьте /stop.',
          fetchImpl
        );
        return { action: 'subscribed', chatId };
      }
      return { action: 'ignored', chatId };
    }

    return { action: 'ignored', chatId };
  }

  if (update.my_chat_member && typeof update.my_chat_member === 'object') {
    const memberUpdate = update.my_chat_member;
    if (memberUpdate.chat?.id === undefined || memberUpdate.chat?.id === null) {
      return { action: 'ignored' };
    }
    const chatId = String(memberUpdate.chat.id);
    const chatType = memberUpdate.chat.type || 'private';
    const status = memberUpdate.new_chat_member?.status;

    if (status === 'kicked' || status === 'left') {
      await store.removeSubscriber(chatId);
      return { action: 'unsubscribed', chatId };
    }

    if (status === 'member' || status === 'administrator') {
      await store.addSubscriber(chatId, extractChatInfo(memberUpdate.chat));
      if (chatType === 'group' || chatType === 'supergroup') {
        await sendWebhookReply(
          botToken,
          chatId,
          '<b>Бот подключён к группе.</b> Новые заявки с сайта Maison Éclat будут приходить в этот чат.',
          fetchImpl
        );
      }
      return { action: 'subscribed', chatId };
    }
  }

  return { action: 'ignored' };
}

module.exports = {
  BATCH_SIZE,
  INTER_BATCH_DELAY_MS,
  parseStaticChatIds,
  getWebhookSecret,
  verifyWebhookSecret,
  resolveProductionWebhookUrl,
  createSubscriberStore,
  telegramRequest,
  extractChatStateChanges,
  syncSubscribersAndWebhook,
  broadcastBookingMessage,
  handleTelegramWebhookUpdate,
  _resetMemoryStore,
};
