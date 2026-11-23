'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const bookingCore = require('../lib/booking-core');
const tg = require('../lib/telegram-broadcast');
const apiBooking = require('../api/booking');
const apiWebhook = require('../api/telegram-webhook');

const NETLIFY_BOOKING_URL = pathToFileURL(
  path.resolve(__dirname, '../netlify/functions/booking.mjs')
).href;
const NETLIFY_WEBHOOK_URL = pathToFileURL(
  path.resolve(__dirname, '../netlify/functions/telegram-webhook.mjs')
).href;

const SAMPLE_BOOKING = {
  name: 'Анна Петрова',
  phone: '+7 (913) 555-12-34',
  service: 'Испанский массаж лица',
  master: 'Елена Соколова',
  promo: true,
  consent: true,
  company: '',
};

function createPersistentTestStore(initialSubscribers = [], initialMeta = {}) {
  const subs = new Map();
  for (const id of initialSubscribers) {
    subs.set(String(id), { chatId: String(id), type: 'private' });
  }
  const meta = new Map(Object.entries(initialMeta));

  return {
    kind: 'test-persistent',
    isPersistent: true,
    _subs: subs,
    _meta: meta,
    async listSubscribers() {
      return Array.from(subs.keys());
    },
    async hasSubscriber(chatId) {
      return subs.has(String(chatId));
    },
    async addSubscriber(chatId, info = {}) {
      subs.set(String(chatId), { chatId: String(chatId), ...info });
    },
    async removeSubscriber(chatId) {
      subs.delete(String(chatId));
    },
    async getMeta(key) {
      return meta.has(String(key)) ? meta.get(String(key)) : null;
    },
    async setMeta(key, value) {
      meta.set(String(key), String(value));
    },
  };
}

function createMockNodeReqRes({ method = 'POST', headers = {}, body = undefined } = {}) {
  const req = { method, headers, body };
  const resHeaders = {};
  const res = {
    statusCode: 200,
    headers: resHeaders,
    bodyPayload: null,
    setHeader(name, value) {
      resHeaders[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.bodyPayload = payload;
      return this;
    },
    end(raw) {
      this.bodyPayload = JSON.parse(raw);
      return this;
    },
  };
  return { req, res };
}

async function withEnvAndFetch(envPatch, mockFetch, fn) {
  const prevEnv = {};
  for (const key of Object.keys(envPatch)) {
    prevEnv[key] = process.env[key];
    if (envPatch[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envPatch[key];
    }
  }
  const prevFetch = globalThis.fetch;
  if (mockFetch) {
    globalThis.fetch = mockFetch;
  }
  try {
    return await fn();
  } finally {
    globalThis.fetch = prevFetch;
    for (const key of Object.keys(envPatch)) {
      if (prevEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prevEnv[key];
      }
    }
  }
}

function makeTelegramResponse(httpStatus, ok, extra = {}) {
  return {
    status: httpStatus,
    ok: httpStatus >= 200 && httpStatus < 300,
    async json() {
      return { ok, ...extra };
    },
  };
}

/* 1. @netlify/blobs import and consistency detection */
test('1. @netlify/blobs exports and createSubscriberStore consistency selection', async () => {
  const blobs = require('@netlify/blobs');
  assert.equal(typeof blobs.connectLambda, 'function');
  assert.equal(typeof blobs.getStore, 'function');

  const strongCtx = Buffer.from(
    JSON.stringify({
      siteID: 'site-1',
      token: 'tok-1',
      edgeURL: 'https://edge.example',
      uncachedEdgeURL: 'https://uncached.example',
    })
  ).toString('base64');
  await withEnvAndFetch({ NETLIFY_BLOBS_CONTEXT: strongCtx }, null, () => {
    const strongStore = tg.createSubscriberStore({ env: process.env });
    assert.equal(strongStore.kind, 'netlify-blobs');
    assert.equal(strongStore.isPersistent, true);
  });

  const edgeOnlyCtx = Buffer.from(
    JSON.stringify({
      siteID: 'site-1',
      token: 'tok-1',
      edgeURL: 'https://edge.example',
    })
  ).toString('base64');
  await withEnvAndFetch({ NETLIFY_BLOBS_CONTEXT: edgeOnlyCtx }, null, () => {
    const eventualStore = tg.createSubscriberStore({ env: process.env });
    assert.equal(eventualStore.kind, 'netlify-blobs');
    assert.equal(eventualStore.isPersistent, true);
  });

  await withEnvAndFetch({ NETLIFY_BLOBS_CONTEXT: undefined }, null, () => {
    const memStore = tg.createSubscriberStore({ env: process.env });
    assert.equal(memStore.kind, 'memory');
    assert.equal(memStore.isPersistent, false);
  });
});

/* 2. Payload validation, honeypot, HTML escaping, and _internal exports */
test('2. Booking validation, honeypot handling, HTML escaping, and _internal exports', () => {
  assert.equal(apiBooking._internal.escapeHtml, bookingCore.escapeHtml);
  assert.equal(apiBooking._internal.validateBookingPayload, bookingCore.validateBookingPayload);
  assert.equal(apiBooking._internal.formatTelegramMessage, bookingCore.formatTelegramMessage);

  const spam = bookingCore.validateBookingPayload({ ...SAMPLE_BOOKING, company: 'Bot LLC' });
  assert.equal(spam.isSpam, true);

  const invalid = bookingCore.validateBookingPayload({
    name: 'А',
    phone: '123',
    consent: false,
  });
  assert.equal(invalid.isSpam, false);
  assert.ok(invalid.fields.name);
  assert.ok(invalid.fields.phone);
  assert.ok(invalid.fields.consent);

  const valid = bookingCore.validateBookingPayload({
    ...SAMPLE_BOOKING,
    name: '<b>Анна</b> & "Тест"',
  });
  assert.deepEqual(valid.fields, {});
  const html = bookingCore.formatTelegramMessage(valid.data, 'ME-4242');
  assert.match(html, /&lt;b&gt;Анна&lt;\/b&gt; &amp; &quot;Тест&quot;/);
  assert.match(html, /ME-4242/);
});

/* 3. Demo mode, HTTP method guards, and malformed JSON (Netlify v2 + Vercel) */
test('3. Demo mode when TELEGRAM_BOT_TOKEN is unset and HTTP error guards on both platforms', async () => {
  const netlifyBookingMod = await import(NETLIFY_BOOKING_URL);
  const netlifyBooking = netlifyBookingMod.default;
  assert.equal(netlifyBookingMod.config.path, '/api/booking');

  await withEnvAndFetch({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }, null, async () => {
    const getRes = await netlifyBooking(new Request('https://example.com/api/booking', { method: 'GET' }));
    assert.equal(getRes.status, 405);
    assert.equal(getRes.headers.get('allow'), 'POST');

    const badJsonRes = await netlifyBooking(
      new Request('https://example.com/api/booking', { method: 'POST', body: '{bad' })
    );
    assert.equal(badJsonRes.status, 400);

    const demoRes = await netlifyBooking(
      new Request('https://example.com/api/booking', {
        method: 'POST',
        body: JSON.stringify(SAMPLE_BOOKING),
      })
    );
    assert.equal(demoRes.status, 200);
    const demoBody = await demoRes.json();
    assert.equal(demoBody.ok, true);
    assert.equal(demoBody.mode, 'demo');
    assert.match(demoBody.bookingId, /^ME-\d{4}$/);

    const { req: vGetReq, res: vGetRes } = createMockNodeReqRes({ method: 'GET' });
    await apiBooking(vGetReq, vGetRes);
    assert.equal(vGetRes.statusCode, 405);
    assert.equal(vGetRes.headers.allow, 'POST');

    const { req: vDemoReq, res: vDemoRes } = createMockNodeReqRes({
      method: 'POST',
      body: SAMPLE_BOOKING,
    });
    await apiBooking(vDemoReq, vDemoRes);
    assert.equal(vDemoRes.statusCode, 200);
    assert.equal(vDemoRes.bodyPayload.ok, true);
    assert.equal(vDemoRes.bodyPayload.mode, 'demo');
  });
});

/* 4. Pure getUpdates fallback mode + optional TELEGRAM_CHAT_ID merge + end-to-end handlers */
test('4. Pure getUpdates broadcast sends to all /start users and groups without TELEGRAM_CHAT_ID', async () => {
  tg._resetMemoryStore();
  const calls = [];
  const mockFetch = async (url, init) => {
    const method = url.split('/').pop();
    const payload = JSON.parse(init.body);
    calls.push({ method, payload });

    if (method === 'getUpdates') {
      return makeTelegramResponse(200, true, {
        result: [
          { update_id: 1, message: { chat: { id: 101, type: 'private' }, from: { is_bot: false }, text: '/start' } },
          { update_id: 2, message: { chat: { id: 102, type: 'private' }, from: { is_bot: false }, text: '/start' } },
          { update_id: 3, message: { chat: { id: 102, type: 'private' }, from: { is_bot: false }, text: '/stop' } },
          { update_id: 4, message: { chat: { id: 103, type: 'private' }, from: { is_bot: false }, text: '/start@my_bot' } },
          { update_id: 5, my_chat_member: { chat: { id: 104, type: 'private' }, new_chat_member: { status: 'kicked' } } },
          { update_id: 6, my_chat_member: { chat: { id: -100555, type: 'supergroup', title: 'Salon Team' }, new_chat_member: { status: 'member' } } },
          { update_id: 7, message: { chat: { id: 999, type: 'private' }, from: { is_bot: true }, text: '/start' } },
        ],
      });
    }

    if (method === 'sendMessage') {
      return makeTelegramResponse(200, true, { result: { message_id: 1 } });
    }
    throw new Error(`Unexpected method ${method}`);
  };

  const store = tg.createSubscriberStore({ env: {} });
  const result = await tg.broadcastBookingMessage({
    botToken: '123:TEST_TOKEN',
    text: '<b>Lead</b>',
    bookingId: 'ME-1111',
    store,
    env: { TELEGRAM_CHAT_ID: '777, -100888; 101' },
    fetchImpl: mockFetch,
    sleepImpl: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.delivered, 5);

  const getUpdatesCall = calls.find((c) => c.method === 'getUpdates');
  assert.ok(getUpdatesCall);
  assert.equal(getUpdatesCall.payload.offset, -100);
  assert.equal(getUpdatesCall.payload.limit, 100);

  const sentIds = calls
    .filter((c) => c.method === 'sendMessage')
    .map((c) => String(c.payload.chat_id))
    .sort();
  assert.deepEqual(sentIds, ['-100555', '-100888', '101', '103', '777']);

  // Verify end-to-end through both Netlify v2 and Vercel booking handlers with ONLY TELEGRAM_BOT_TOKEN
  const netlifyBooking = (await import(NETLIFY_BOOKING_URL)).default;
  tg._resetMemoryStore();
  await withEnvAndFetch(
    {
      TELEGRAM_BOT_TOKEN: '123:TEST_TOKEN',
      TELEGRAM_CHAT_ID: undefined,
      NETLIFY_BLOBS_CONTEXT: undefined,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async (url, init) => {
      const method = url.split('/').pop();
      if (method === 'getUpdates') {
        return makeTelegramResponse(200, true, {
          result: [
            { update_id: 10, message: { chat: { id: 501, type: 'private' }, text: '/start' } },
            { update_id: 11, message: { chat: { id: 502, type: 'private' }, text: '/start' } },
          ],
        });
      }
      if (method === 'sendMessage') {
        return makeTelegramResponse(200, true, { result: { message_id: 2 } });
      }
      return makeTelegramResponse(404, false, {});
    },
    async () => {
      const nRes = await netlifyBooking(
        new Request('https://example.com/api/booking', {
          method: 'POST',
          body: JSON.stringify(SAMPLE_BOOKING),
        })
      );
      assert.equal(nRes.status, 200);
      const nData = await nRes.json();
      assert.equal(nData.ok, true);
      assert.equal(nData.mode, 'telegram');
      assert.equal(nData.recipients, 2);

      const { req: vReq, res: vRes } = createMockNodeReqRes({
        method: 'POST',
        body: SAMPLE_BOOKING,
      });
      await apiBooking(vReq, vRes);
      assert.equal(vRes.statusCode, 200);
      assert.equal(vRes.bodyPayload.ok, true);
      assert.equal(vRes.bodyPayload.mode, 'telegram');
      assert.equal(vRes.bodyPayload.recipients, 2);
    }
  );
});

/* 5. Hybrid persistent store + auto-webhook mode */
test('5. Hybrid persistent store registers webhook once on production, self-heals, and skips previews', async () => {
  const botToken = '123:PROD_TOKEN';
  const prodEnv = { CONTEXT: 'production', URL: 'https://maison-eclat.netlify.app/' };
  const store = createPersistentTestStore();
  const calls = [];

  const mockFetch = async (url, init) => {
    const method = url.split('/').pop();
    const payload = JSON.parse(init.body);
    calls.push({ method, payload });

    if (method === 'getUpdates') {
      return makeTelegramResponse(200, true, {
        result: [
          { update_id: 1, message: { chat: { id: 201, type: 'private' }, text: '/start' } },
          { update_id: 2, message: { chat: { id: 202, type: 'private' }, text: '/start' } },
        ],
      });
    }
    if (method === 'setWebhook') {
      return makeTelegramResponse(200, true, { result: true });
    }
    if (method === 'sendMessage') {
      return makeTelegramResponse(200, true, { result: { message_id: 10 } });
    }
    throw new Error(`Unexpected method ${method}`);
  };

  // First production booking
  const first = await tg.broadcastBookingMessage({
    botToken,
    text: 'First lead',
    bookingId: 'ME-2001',
    store,
    env: prodEnv,
    fetchImpl: mockFetch,
    sleepImpl: async () => {},
  });
  assert.equal(first.ok, true);
  assert.equal(first.delivered, 2);
  assert.equal(await store.getMeta('webhook-url'), 'https://maison-eclat.netlify.app/api/telegram-webhook');

  const setWebhookCall = calls.find((c) => c.method === 'setWebhook');
  assert.ok(setWebhookCall);
  assert.equal(setWebhookCall.payload.url, 'https://maison-eclat.netlify.app/api/telegram-webhook');
  assert.equal(setWebhookCall.payload.secret_token, tg.getWebhookSecret(botToken, prodEnv));
  assert.equal(setWebhookCall.payload.drop_pending_updates, false);

  // Second production booking: no getUpdates, no setWebhook
  calls.length = 0;
  const second = await tg.broadcastBookingMessage({
    botToken,
    text: 'Second lead',
    bookingId: 'ME-2002',
    store,
    env: prodEnv,
    fetchImpl: mockFetch,
    sleepImpl: async () => {},
  });
  assert.equal(second.ok, true);
  assert.equal(second.delivered, 2);
  assert.equal(calls.some((c) => c.method === 'getUpdates'), false);
  assert.equal(calls.some((c) => c.method === 'setWebhook'), false);

  // Self-healing when store has meta webhook-url but 0 subscribers and Telegram webhook was cleared
  const emptyStore = createPersistentTestStore([], {
    'webhook-url': 'https://maison-eclat.netlify.app/api/telegram-webhook',
  });
  const healCalls = [];
  const healFetch = async (url, init) => {
    const method = url.split('/').pop();
    healCalls.push(method);
    if (method === 'getWebhookInfo') {
      return makeTelegramResponse(200, true, { result: { url: '' } });
    }
    if (method === 'getUpdates') {
      return makeTelegramResponse(200, true, { result: [] });
    }
    if (method === 'setWebhook') {
      return makeTelegramResponse(200, true, { result: true });
    }
    return makeTelegramResponse(404, false, {});
  };
  const zeroRes = await tg.broadcastBookingMessage({
    botToken,
    text: 'Lead',
    bookingId: 'ME-2003',
    store: emptyStore,
    env: prodEnv,
    fetchImpl: healFetch,
    sleepImpl: async () => {},
  });
  assert.equal(zeroRes.ok, false);
  assert.equal(zeroRes.reason, 'no_subscribers');
  assert.deepEqual(healCalls, ['getWebhookInfo', 'getUpdates', 'setWebhook']);

  // Deploy-preview must NOT call setWebhook
  const previewStore = createPersistentTestStore(['301']);
  const previewCalls = [];
  await tg.broadcastBookingMessage({
    botToken,
    text: 'Preview lead',
    bookingId: 'ME-2004',
    store: previewStore,
    env: { CONTEXT: 'deploy-preview', URL: 'https://preview--site.netlify.app' },
    fetchImpl: async (url) => {
      const method = url.split('/').pop();
      previewCalls.push(method);
      if (method === 'getUpdates') return makeTelegramResponse(200, true, { result: [] });
      if (method === 'sendMessage') return makeTelegramResponse(200, true, { result: { message_id: 1 } });
      throw new Error(`Should not call ${method}`);
    },
    sleepImpl: async () => {},
  });
  assert.equal(previewCalls.includes('setWebhook'), false);
});

/* 6. Error handling, resilience, pruning, 429 retry, migration, 401 secret safety, 409, batching */
test('6. Resilience: 403 pruning, 429 retry, migrate_to_chat_id, 401 no-leak, 409 conflict, >20 batching, Blobs fallback', async () => {
  const botToken = '987654:SUPER_SECRET_BOT_TOKEN';

  // 6a. 403 pruning (preserves static TELEGRAM_CHAT_ID), 429 retry, migrate_to_chat_id
  const store = createPersistentTestStore(['301', '302', '-500', '999403'], {
    'webhook-url': 'https://site.netlify.app/api/telegram-webhook',
  });
  const sleepCalls = [];
  const attempts = new Map();

  const res = await tg.broadcastBookingMessage({
    botToken,
    text: 'Lead',
    bookingId: 'ME-3001',
    store,
    env: { TELEGRAM_CHAT_ID: '999403' },
    sleepImpl: async (ms) => {
      sleepCalls.push(ms);
    },
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body);
      const chatId = String(payload.chat_id);
      const count = (attempts.get(chatId) || 0) + 1;
      attempts.set(chatId, count);

      if (chatId === '301' && count === 1) {
        return makeTelegramResponse(429, false, {
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 1 },
        });
      }
      if (chatId === '301' && count === 2) {
        return makeTelegramResponse(200, true, { result: { message_id: 1 } });
      }
      if (chatId === '302' || chatId === '999403') {
        return makeTelegramResponse(403, false, {
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        });
      }
      if (chatId === '-500') {
        return makeTelegramResponse(400, false, {
          error_code: 400,
          description: 'Bad Request: group chat was upgraded to a supergroup chat',
          parameters: { migrate_to_chat_id: -100999888 },
        });
      }
      if (chatId === '-100999888') {
        return makeTelegramResponse(200, true, { result: { message_id: 2 } });
      }
      return makeTelegramResponse(500, false, {});
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.delivered, 2);
  assert.equal(res.pruned, 2);
  assert.ok(sleepCalls.includes(1000));
  assert.equal(await store.hasSubscriber('302'), false);
  assert.equal(await store.hasSubscriber('999403'), true);
  assert.equal(await store.hasSubscriber('-500'), false);
  assert.equal(await store.hasSubscriber('-100999888'), true);

  // 6b. 401 fail-fast without leaking bot token in logs
  const loggedLines = [];
  const origConsoleError = console.error;
  console.error = (...args) => loggedLines.push(JSON.stringify(args));
  try {
    const authRes = await tg.broadcastBookingMessage({
      botToken,
      text: 'Lead',
      bookingId: 'ME-3002',
      store: createPersistentTestStore(['1']),
      env: {},
      fetchImpl: async () => makeTelegramResponse(401, false, { error_code: 401, description: 'Unauthorized' }),
      sleepImpl: async () => {},
    });
    assert.equal(authRes.ok, false);
    assert.equal(authRes.reason, 'auth_error');
    assert.equal(loggedLines.join('\n').includes(botToken), false);
  } finally {
    console.error = origConsoleError;
  }

  // 6c. 409 Conflict on getUpdates handled gracefully
  tg._resetMemoryStore();
  const conflictStore = tg.createSubscriberStore({ env: {} });
  await conflictStore.addSubscriber('801');
  const conflictRes = await tg.broadcastBookingMessage({
    botToken,
    text: 'Lead',
    bookingId: 'ME-3003',
    store: conflictStore,
    env: {},
    fetchImpl: async (url) => {
      const method = url.split('/').pop();
      if (method === 'getUpdates') {
        return makeTelegramResponse(409, false, { error_code: 409, description: 'Conflict' });
      }
      return makeTelegramResponse(200, true, { result: { message_id: 1 } });
    },
    sleepImpl: async () => {},
  });
  assert.equal(conflictRes.ok, true);
  assert.equal(conflictRes.delivered, 1);

  // 6d. Batching >20 recipients (25 recipients = 2 batches, 1 delay of 800ms)
  const manyIds = Array.from({ length: 25 }, (_, i) => String(1000 + i));
  const batchSleeps = [];
  const batchRes = await tg.broadcastBookingMessage({
    botToken,
    text: 'Lead',
    bookingId: 'ME-3004',
    store: createPersistentTestStore(manyIds, { 'webhook-url': 'https://x.test/api/telegram-webhook' }),
    env: {},
    sleepImpl: async (ms) => batchSleeps.push(ms),
    fetchImpl: async () => makeTelegramResponse(200, true, { result: { message_id: 1 } }),
  });
  assert.equal(batchRes.ok, true);
  assert.equal(batchRes.delivered, 25);
  assert.deepEqual(batchSleeps, [800]);

  // 6e. Lazy MissingBlobsEnvironmentError falls back cleanly to memory store
  tg._resetMemoryStore();
  const lazyBrokenBlobsStore = {
    kind: 'netlify-blobs',
    isPersistent: true,
    async listSubscribers() {
      const err = new Error('Missing env');
      err.name = 'MissingBlobsEnvironmentError';
      throw err;
    },
  };
  const fallbackRes = await tg.broadcastBookingMessage({
    botToken,
    text: 'Lead',
    bookingId: 'ME-3005',
    store: lazyBrokenBlobsStore,
    env: {},
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      const method = url.split('/').pop();
      if (method === 'getUpdates') {
        return makeTelegramResponse(200, true, {
          result: [{ update_id: 1, message: { chat: { id: 901, type: 'private' }, text: '/start' } }],
        });
      }
      return makeTelegramResponse(200, true, { result: { message_id: 1 } });
    },
  });
  assert.equal(fallbackRes.ok, true);
  assert.equal(fallbackRes.delivered, 1);
  assert.equal(fallbackRes.storeKind, 'memory');
});

/* 7. Webhook endpoint tests (both Netlify v2 .mjs and Vercel api/telegram-webhook.js) */
test('7. Webhook endpoints verify secrets, handle commands (/start, /stop, /status), groups, and bots', async () => {
  const botToken = '555:WEBHOOK_TOKEN';
  const netlifyWebhookMod = await import(NETLIFY_WEBHOOK_URL);
  const netlifyWebhook = netlifyWebhookMod.default;
  assert.equal(netlifyWebhookMod.config.path, '/api/telegram-webhook');
  const secret = tg.getWebhookSecret(botToken, {});

  // 7a. HTTP method, secret auth, and invalid JSON guards on both platforms
  await withEnvAndFetch({ TELEGRAM_BOT_TOKEN: botToken }, null, async () => {
    const nGet = await netlifyWebhook(new Request('https://example.com/api/telegram-webhook', { method: 'GET' }));
    assert.equal(nGet.status, 405);

    const nNoSecret = await netlifyWebhook(
      new Request('https://example.com/api/telegram-webhook', { method: 'POST', body: '{}' })
    );
    assert.equal(nNoSecret.status, 401);

    const nBadJson = await netlifyWebhook(
      new Request('https://example.com/api/telegram-webhook', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: '{invalid',
      })
    );
    assert.equal(nBadJson.status, 400);

    const { req: vGetReq, res: vGetRes } = createMockNodeReqRes({ method: 'GET' });
    await apiWebhook(vGetReq, vGetRes);
    assert.equal(vGetRes.statusCode, 405);

    const { req: vBadSecReq, res: vBadSecRes } = createMockNodeReqRes({
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: {},
    });
    await apiWebhook(vBadSecReq, vBadSecRes);
    assert.equal(vBadSecRes.statusCode, 401);
  });

  // 7b. End-to-end /start -> /status -> /stop via Netlify v2 & Vercel handlers
  tg._resetMemoryStore();
  const sentReplies = [];
  await withEnvAndFetch(
    {
      TELEGRAM_BOT_TOKEN: botToken,
      NETLIFY_BLOBS_CONTEXT: undefined,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async (url, init) => {
      sentReplies.push(JSON.parse(init.body));
      return makeTelegramResponse(200, true, { result: { message_id: 1 } });
    },
    async () => {
      const startRes = await netlifyWebhook(
        new Request('https://example.com/api/telegram-webhook', {
          method: 'POST',
          headers: { 'x-telegram-bot-api-secret-token': secret },
          body: JSON.stringify({
            update_id: 1,
            message: {
              chat: { id: 7001, type: 'private', first_name: 'Мария' },
              from: { is_bot: false },
              date: Math.floor(Date.now() / 1000),
              text: '/start',
            },
          }),
        })
      );
      assert.equal(startRes.status, 200);
      assert.equal(sentReplies.length, 1);
      assert.match(sentReplies[0].text, /подписаны/i);

      const { req: vStatusReq, res: vStatusRes } = createMockNodeReqRes({
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: {
          update_id: 2,
          message: {
            chat: { id: 7001, type: 'private' },
            from: { is_bot: false },
            text: '/status',
          },
        },
      });
      await apiWebhook(vStatusReq, vStatusRes);
      assert.equal(vStatusRes.statusCode, 200);
      assert.match(sentReplies[1].text, /Подписка активна/);

      const { req: vStopReq, res: vStopRes } = createMockNodeReqRes({
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': secret },
        body: {
          update_id: 3,
          message: {
            chat: { id: 7001, type: 'private' },
            from: { is_bot: false },
            text: '/stop',
          },
        },
      });
      await apiWebhook(vStopReq, vStopRes);
      assert.equal(vStopRes.statusCode, 200);
      assert.match(sentReplies[2].text, /отключены/i);
    }
  );

  // 7c. Unit webhook update rules: stale /start, private text, my_chat_member, bot ignore
  const unitStore = createPersistentTestStore();
  const unitReplies = [];
  const unitFetch = async (url, init) => {
    unitReplies.push(JSON.parse(init.body));
    return makeTelegramResponse(200, true, { result: { message_id: 1 } });
  };

  // Fresh /start -> subscribes & replies
  const nowSec = 1_800_000_000;
  await tg.handleTelegramWebhookUpdate({
    update: {
      message: {
        chat: { id: 8001, type: 'private' },
        from: { is_bot: false },
        date: nowSec - 10,
        text: '/start',
      },
    },
    botToken,
    store: unitStore,
    fetchImpl: unitFetch,
    nowMs: nowSec * 1000,
  });
  assert.equal(await unitStore.hasSubscriber('8001'), true);
  assert.equal(unitReplies.length, 1);

  // Stale /start when already subscribed -> suppresses duplicate reply
  await tg.handleTelegramWebhookUpdate({
    update: {
      message: {
        chat: { id: 8001, type: 'private' },
        from: { is_bot: false },
        date: nowSec - 1000,
        text: '/start',
      },
    },
    botToken,
    store: unitStore,
    fetchImpl: unitFetch,
    nowMs: nowSec * 1000,
  });
  assert.equal(unitReplies.length, 1);

  // Private non-command text for new user -> auto-subscribes & replies; second message -> ignored
  await tg.handleTelegramWebhookUpdate({
    update: {
      message: { chat: { id: 8002, type: 'private' }, from: { is_bot: false }, text: 'Привет' },
    },
    botToken,
    store: unitStore,
    fetchImpl: unitFetch,
  });
  assert.equal(await unitStore.hasSubscriber('8002'), true);
  assert.equal(unitReplies.length, 2);

  await tg.handleTelegramWebhookUpdate({
    update: {
      message: { chat: { id: 8002, type: 'private' }, from: { is_bot: false }, text: 'Как дела?' },
    },
    botToken,
    store: unitStore,
    fetchImpl: unitFetch,
  });
  assert.equal(unitReplies.length, 2);

  // my_chat_member group member -> adds and replies; kicked -> removes without reply
  await tg.handleTelegramWebhookUpdate({
    update: {
      my_chat_member: {
        chat: { id: -100777, type: 'supergroup', title: 'Masters' },
        new_chat_member: { status: 'member' },
      },
    },
    botToken,
    store: unitStore,
    fetchImpl: unitFetch,
  });
  assert.equal(await unitStore.hasSubscriber('-100777'), true);
  assert.equal(unitReplies.length, 3);

  await tg.handleTelegramWebhookUpdate({
    update: {
      my_chat_member: {
        chat: { id: -100777, type: 'supergroup' },
        new_chat_member: { status: 'kicked' },
      },
    },
    botToken,
    store: unitStore,
    fetchImpl: unitFetch,
  });
  assert.equal(await unitStore.hasSubscriber('-100777'), false);
  assert.equal(unitReplies.length, 3);

  // Bot sender ignored
  const botRes = await tg.handleTelegramWebhookUpdate({
    update: {
      message: { chat: { id: 9999, type: 'private' }, from: { is_bot: true }, text: '/start' },
    },
    botToken,
    store: unitStore,
    fetchImpl: unitFetch,
  });
  assert.equal(botRes.action, 'ignored');
  assert.equal(await unitStore.hasSubscriber('9999'), false);
});

/* 8. Upstash Redis / Vercel KV REST adapter tests */
test('8. Upstash Redis REST adapter executes expected commands and auth header', async () => {
  const redisSet = new Set();
  const redisKv = new Map();
  const requests = [];

  const mockRedisFetch = async (url, init) => {
    const args = JSON.parse(init.body);
    requests.push({ url, auth: init.headers.Authorization, args });
    const [cmd, key, val] = args;
    let result = null;

    if (cmd === 'SADD') {
      redisSet.add(val);
      result = 1;
    } else if (cmd === 'SREM') {
      result = redisSet.delete(val) ? 1 : 0;
    } else if (cmd === 'SISMEMBER') {
      result = redisSet.has(val) ? 1 : 0;
    } else if (cmd === 'SMEMBERS') {
      result = Array.from(redisSet);
    } else if (cmd === 'SET') {
      redisKv.set(key, val);
      result = 'OK';
    } else if (cmd === 'GET') {
      result = redisKv.has(key) ? redisKv.get(key) : null;
    }

    return {
      status: 200,
      ok: true,
      async json() {
        return { result };
      },
    };
  };

  const store = tg.createSubscriberStore({
    env: {
      UPSTASH_REDIS_REST_URL: 'https://redis.upstash.io/',
      UPSTASH_REDIS_REST_TOKEN: 'upstash-secret-token',
    },
    fetchImpl: mockRedisFetch,
  });

  assert.equal(store.kind, 'upstash-redis');
  assert.equal(store.isPersistent, true);

  await store.addSubscriber(12345);
  assert.equal(await store.hasSubscriber(12345), true);
  assert.deepEqual(await store.listSubscribers(), ['12345']);
  await store.setMeta('webhook-url', 'https://app.vercel.app/api/telegram-webhook');
  assert.equal(await store.getMeta('webhook-url'), 'https://app.vercel.app/api/telegram-webhook');
  await store.removeSubscriber(12345);
  assert.equal(await store.hasSubscriber(12345), false);

  assert.equal(requests[0].url, 'https://redis.upstash.io');
  assert.equal(requests[0].auth, 'Bearer upstash-secret-token');

  // Verify KV_REST_API_* fallback env vars also work
  const kvStore = tg.createSubscriberStore({
    env: {
      KV_REST_API_URL: 'https://kv.vercel.test',
      KV_REST_API_TOKEN: 'kv-token',
    },
    fetchImpl: mockRedisFetch,
  });
  assert.equal(kvStore.kind, 'upstash-redis');
  assert.equal(kvStore.isPersistent, true);
});
