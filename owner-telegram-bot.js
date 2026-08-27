'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SHARED_SECRET = process.env.OWNER_BOT_SHARED_SECRET;
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);

if (!BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');
if (!CHAT_ID) throw new Error('Missing TELEGRAM_CHAT_ID');
if (!SHARED_SECRET || SHARED_SECRET.length < 24) {
  throw new Error('Missing or weak OWNER_BOT_SHARED_SECRET (use at least 24 characters)');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function clean(value, max = 200) {
  return String(value ?? '—').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

async function sendTelegram(payload) {
  const text = [
    '🚨 Litematica Together — вызов Ametist1k',
    '',
    `Сервер: ${clean(payload.guildName)}`,
    `Тикет: ${clean(payload.channelName)}`,
    `Вызвал: ${clean(payload.requestedByTag)} (${clean(payload.requestedById, 32)})`,
    `Владелец тикета: ${clean(payload.ticketOwnerId, 32)}`,
    '',
    clean(payload.ticketUrl, 500),
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.description || `Telegram HTTP ${response.status}`);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return json(res, 200, { ok: true, service: 'ltt-owner-telegram-bot' });
    }

    if (req.method !== 'POST' || req.url !== '/notify') {
      return json(res, 404, { ok: false, error: 'not_found' });
    }

    if (!safeEqual(req.headers['x-owner-bot-secret'], SHARED_SECRET)) {
      return json(res, 401, { ok: false, error: 'unauthorized' });
    }

    const payload = await readJson(req);
    if (payload.type !== 'ticket_owner_call' || !/^https:\/\/discord\.com\/channels\/\d+\/\d+$/.test(String(payload.ticketUrl || ''))) {
      return json(res, 400, { ok: false, error: 'invalid_payload' });
    }

    await sendTelegram(payload);
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('[OWNER BOT]', error);
    return json(res, 500, { ok: false, error: String(error.message || error).slice(0, 300) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OWNER BOT] Listening on 0.0.0.0:${PORT}`);
  console.log('[OWNER BOT] Health endpoint: /healthz');
  console.log('[OWNER BOT] Notification endpoint: POST /notify');
});
