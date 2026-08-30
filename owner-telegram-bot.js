'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '');
const SHARED_SECRET = process.env.OWNER_BOT_SHARED_SECRET;
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '';
const GUILD_ID = String(process.env.GUILD_ID || '');
const ENABLE_POLLING = String(process.env.OWNER_BOT_ENABLE_POLLING || 'true').toLowerCase() !== 'false';
const MODRINTH_PROJECT_URL = 'https://modrinth.com/mod/litematica-together';
const MODRINTH_API = 'https://api.modrinth.com/v2/project/litematica-together';

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN/TELEGRAM_BOT_TOKEN');
if (!CHAT_ID) throw new Error('Missing TELEGRAM_CHAT_ID');
if (!SHARED_SECRET || SHARED_SECRET.length < 24) {
  throw new Error('Missing or weak OWNER_BOT_SHARED_SECRET (use at least 24 characters)');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function clean(value, max = 200) {
  return String(value ?? '—').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function telegram(method, body = {}, timeoutMs = 35000) {
  const response = await fetchWithTimeout(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram HTTP ${response.status}`);
  }
  return payload.result;
}

async function sendText(text, extra = {}) {
  const value = String(text || '—');
  const chunks = [];
  for (let i = 0; i < value.length; i += 3900) chunks.push(value.slice(i, i + 3900));
  if (!chunks.length) chunks.push('—');

  let result = null;
  for (const chunk of chunks) {
    result = await telegram('sendMessage', {
      chat_id: CHAT_ID,
      text: chunk,
      disable_web_page_preview: true,
      ...extra,
    });
  }
  return result;
}

async function sendTicketNotification(payload) {
  return sendText([
    '🚨 Litematica Together — вызов Ametist1k',
    '',
    `Сервер: ${clean(payload.guildName)}`,
    `Тикет: ${clean(payload.channelName)}`,
    `Вызвал: ${clean(payload.requestedByTag)} (${clean(payload.requestedById, 32)})`,
    `Владелец тикета: ${clean(payload.ticketOwnerId, 32)}`,
    '',
    clean(payload.ticketUrl, 500),
  ].join('\n'));
}

function requireDiscordConfig() {
  if (!DISCORD_TOKEN || !GUILD_ID) {
    throw new Error('Для управления Discord добавьте DISCORD_BOT_TOKEN и GUILD_ID в переменные Telegram-бота.');
  }
}

async function discord(path, { method = 'GET', body = null } = {}) {
  requireDiscordConfig();
  const response = await fetchWithTimeout(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'LitematicaTogether-OwnerBot/2.0',
    },
    body: body == null ? undefined : JSON.stringify(body),
  }, 12000);

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || `Discord HTTP ${response.status}`);
  }
  return data;
}

async function guildInfo() {
  return discord(`/guilds/${GUILD_ID}?with_counts=true`);
}

async function guildChannels() {
  return discord(`/guilds/${GUILD_ID}/channels`);
}

async function guildRoles() {
  return discord(`/guilds/${GUILD_ID}/roles`);
}

async function findChannel(query) {
  const channels = await guildChannels();
  const raw = String(query || '').trim().replace(/^<#|>$/g, '').replace(/^#/, '');
  return channels.find(channel => channel.id === raw)
    || channels.find(channel => channel.name.toLowerCase() === raw.toLowerCase())
    || null;
}

async function sendDiscord(channelQuery, content) {
  const channel = await findChannel(channelQuery);
  if (!channel) throw new Error(`Канал «${channelQuery}» не найден.`);
  await discord(`/channels/${channel.id}/messages`, {
    method: 'POST',
    body: {
      content: String(content).slice(0, 2000),
      allowed_mentions: { parse: [] },
    },
  });
  return channel;
}

async function setDiscordTopic(channelQuery, topic) {
  const channel = await findChannel(channelQuery);
  if (!channel) throw new Error(`Канал «${channelQuery}» не найден.`);
  await discord(`/channels/${channel.id}`, {
    method: 'PATCH',
    body: { topic: String(topic).slice(0, 1024) },
  });
  return channel;
}

async function setMemberRole(userId, roleQuery, enabled) {
  if (!/^\d{15,22}$/.test(String(userId))) throw new Error('Нужен Discord user ID.');
  const roles = await guildRoles();
  const raw = String(roleQuery || '').trim();
  const role = roles.find(item => item.id === raw)
    || roles.find(item => item.name.toLowerCase() === raw.toLowerCase());
  if (!role) throw new Error(`Роль «${roleQuery}» не найдена.`);

  await discord(`/guilds/${GUILD_ID}/members/${userId}/roles/${role.id}`, {
    method: enabled ? 'PUT' : 'DELETE',
  });
  return role;
}

async function latestModrinth() {
  const [projectRes, versionsRes] = await Promise.all([
    fetchWithTimeout(MODRINTH_API, {
      headers: { 'user-agent': 'LitematicaTogether-OwnerBot/2.0' },
    }),
    fetchWithTimeout(`${MODRINTH_API}/version?include_changelog=true`, {
      headers: { 'user-agent': 'LitematicaTogether-OwnerBot/2.0' },
    }),
  ]);
  if (!projectRes.ok || !versionsRes.ok) throw new Error('Modrinth API недоступен.');
  const project = await projectRes.json();
  const versions = await versionsRes.json();
  const visible = versions
    .filter(version => !['draft', 'unlisted', 'archived'].includes(version.status))
    .sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
  return { project, latest: visible[0] || null };
}

function menuMarkup() {
  return {
    inline_keyboard: [
      [
        { text: '🟢 Статус', callback_data: 'owner_status' },
        { text: '📁 Каналы', callback_data: 'owner_channels' },
      ],
      [
        { text: '🧩 Modrinth', callback_data: 'owner_modrinth' },
        { text: '❓ Команды', callback_data: 'owner_help' },
      ],
    ],
  };
}

function helpText() {
  return [
    '🛠 Управление Litematica Together',
    '',
    '/status — состояние Discord и Modrinth',
    '/channels — список каналов Discord',
    '/modrinth — последняя версия на Modrinth',
    '',
    '/announce_ru текст — сообщение в #объявления',
    '/announce_en text — message in #announcements',
    '/announce_both текст — одинаковое сообщение в оба канала',
    '/say канал | текст — отправить сообщение в любой текстовый канал',
    '/topic канал | новый topic — поменять описание канала',
    '',
    '/hidden USER_ID on — выдать Hidden',
    '/hidden USER_ID off — снять Hidden',
    '/role USER_ID | ROLE | on — выдать любую роль',
    '/role USER_ID | ROLE | off — снять любую роль',
    '',
    'Пример:',
    '/say обновления | Сегодня тестируем новую сборку.',
  ].join('\n');
}

async function statusText() {
  requireDiscordConfig();
  const [guild, channels, modrinth] = await Promise.all([
    guildInfo(),
    guildChannels(),
    latestModrinth().catch(() => ({ latest: null })),
  ]);
  return [
    '🟢 Litematica Together — управление работает',
    '',
    `Discord: ${guild.name}`,
    `Участников: ${guild.approximate_member_count ?? '—'}`,
    `Каналов: ${channels.length}`,
    `Guild ID: ${guild.id}`,
    '',
    modrinth.latest
      ? `Modrinth: ${modrinth.latest.version_number} (${modrinth.latest.version_type})`
      : 'Modrinth: сейчас не удалось получить версию',
  ].join('\n');
}

async function channelsText() {
  const channels = await guildChannels();
  const categories = channels
    .filter(channel => channel.type === 4)
    .sort((a, b) => a.position - b.position);
  const lines = ['📁 Каналы Discord', ''];

  for (const category of categories) {
    lines.push(`【 ${category.name} 】`);
    const children = channels
      .filter(channel => channel.parent_id === category.id)
      .sort((a, b) => a.position - b.position);
    for (const channel of children) {
      const icon = channel.type === 2 ? '🔊' : channel.type === 5 ? '📢' : '#';
      lines.push(`${icon} ${channel.name} — ${channel.id}`);
    }
    lines.push('');
  }
  return lines.join('\n').slice(0, 12000);
}

async function modrinthText() {
  const { project, latest } = await latestModrinth();
  if (!latest) return 'На Modrinth не найдено опубликованных версий.';
  const published = new Date(latest.date_published).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  return [
    '🧩 Litematica Together — Modrinth',
    '',
    `Версия: ${latest.version_number}`,
    `Тип: ${latest.version_type}`,
    `Minecraft: ${(latest.game_versions || []).join(', ') || '—'}`,
    `Loader: ${(latest.loaders || []).join(', ') || '—'}`,
    `Опубликовано: ${published} МСК`,
    `Загрузок проекта: ${project.downloads ?? '—'}`,
    '',
    MODRINTH_PROJECT_URL,
  ].join('\n');
}

function commandArgs(text) {
  const trimmed = String(text || '').trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) return { command: trimmed.toLowerCase(), args: '' };
  return {
    command: trimmed.slice(0, firstSpace).toLowerCase().replace(/@[^\s]+$/, ''),
    args: trimmed.slice(firstSpace + 1).trim(),
  };
}

async function runCommand(text) {
  const { command, args } = commandArgs(text);

  if (['/start', '/menu'].includes(command)) {
    await sendText('🛠 Панель владельца Litematica Together', { reply_markup: menuMarkup() });
    return;
  }
  if (command === '/help') return sendText(helpText(), { reply_markup: menuMarkup() });
  if (command === '/status') return sendText(await statusText(), { reply_markup: menuMarkup() });
  if (command === '/channels') return sendText(await channelsText());
  if (command === '/modrinth') return sendText(await modrinthText(), { reply_markup: menuMarkup() });

  if (command === '/announce_ru') {
    if (!args) throw new Error('Использование: /announce_ru текст');
    const channel = await sendDiscord('объявления', args);
    return sendText(`✅ Опубликовано в #${channel.name}.`);
  }
  if (command === '/announce_en') {
    if (!args) throw new Error('Использование: /announce_en text');
    const channel = await sendDiscord('announcements', args);
    return sendText(`✅ Published to #${channel.name}.`);
  }
  if (command === '/announce_both') {
    if (!args) throw new Error('Использование: /announce_both текст');
    const ru = await sendDiscord('объявления', args);
    const en = await sendDiscord('announcements', args);
    return sendText(`✅ Опубликовано в #${ru.name} и #${en.name}.`);
  }
  if (command === '/say') {
    const [channelQuery, ...rest] = args.split('|');
    const content = rest.join('|').trim();
    if (!channelQuery?.trim() || !content) throw new Error('Использование: /say канал | текст');
    const channel = await sendDiscord(channelQuery.trim(), content);
    return sendText(`✅ Отправлено в #${channel.name}.`);
  }
  if (command === '/topic') {
    const [channelQuery, ...rest] = args.split('|');
    const topic = rest.join('|').trim();
    if (!channelQuery?.trim() || !topic) throw new Error('Использование: /topic канал | новый topic');
    const channel = await setDiscordTopic(channelQuery.trim(), topic);
    return sendText(`✅ Topic #${channel.name} обновлён.`);
  }
  if (command === '/hidden') {
    const [userId, state] = args.split(/\s+/);
    if (!userId || !['on', 'off'].includes(String(state).toLowerCase())) {
      throw new Error('Использование: /hidden USER_ID on|off');
    }
    await setMemberRole(userId, 'Hidden', state.toLowerCase() === 'on');
    return sendText(`✅ Hidden ${state.toLowerCase() === 'on' ? 'выдан' : 'снят'} для ${userId}.`);
  }
  if (command === '/role') {
    const [userId, roleName, state] = args.split('|').map(value => value.trim());
    if (!userId || !roleName || !['on', 'off'].includes(String(state).toLowerCase())) {
      throw new Error('Использование: /role USER_ID | ROLE | on|off');
    }
    const role = await setMemberRole(userId, roleName, state.toLowerCase() === 'on');
    return sendText(`✅ Роль ${role.name}: ${state.toLowerCase() === 'on' ? 'выдана' : 'снята'} для ${userId}.`);
  }

  await sendText(`Неизвестная команда.\n\n${helpText()}`);
}

async function handleCallback(query) {
  await telegram('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
  if (query.data === 'owner_status') return sendText(await statusText(), { reply_markup: menuMarkup() });
  if (query.data === 'owner_channels') return sendText(await channelsText());
  if (query.data === 'owner_modrinth') return sendText(await modrinthText(), { reply_markup: menuMarkup() });
  if (query.data === 'owner_help') return sendText(helpText(), { reply_markup: menuMarkup() });
}

async function handleUpdate(update) {
  const chatId = String(update.message?.chat?.id || update.callback_query?.message?.chat?.id || '');
  if (!safeEqual(chatId, CHAT_ID)) return;

  try {
    if (update.callback_query) return await handleCallback(update.callback_query);
    if (update.message?.text) return await runCommand(update.message.text);
  } catch (error) {
    console.error('[OWNER BOT COMMAND]', error);
    await sendText(`❌ ${String(error.message || error).slice(0, 1200)}`).catch(() => {});
  }
}

async function pollingLoop() {
  let offset = 0;
  console.log(`[OWNER BOT] Telegram polling enabled for chat ${CHAT_ID}`);
  while (ENABLE_POLLING) {
    try {
      const updates = await telegram('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      }, 32000);
      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      console.error('[OWNER BOT POLLING]', error.message || error);
      await sleep(3000);
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return json(res, 200, {
        ok: true,
        service: 'ltt-owner-telegram-bot',
        management: Boolean(DISCORD_TOKEN && GUILD_ID),
        polling: ENABLE_POLLING,
      });
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

    await sendTicketNotification(payload);
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
  if (!DISCORD_TOKEN || !GUILD_ID) {
    console.warn('[OWNER BOT] Discord management disabled: set DISCORD_BOT_TOKEN and GUILD_ID.');
  }
});

if (ENABLE_POLLING) {
  pollingLoop().catch(error => console.error('[OWNER BOT POLLING FATAL]', error));
}
