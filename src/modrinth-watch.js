'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('./db');
const { ensureProjectInfrastructure } = require('./project-layout');

const MODRINTH_API_BASE = 'https://api.modrinth.com/v2';
const CHECK_INTERVAL_MS = Math.max(60_000, Number(process.env.MODRINTH_CHECK_INTERVAL_MS || 300_000));
const FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.MODRINTH_FETCH_TIMEOUT_MS || 8_000));
const MAX_SEEN_IDS = 100;

function slugFrom(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/modrinth\.com\/(?:mod|plugin)\/([^/?#]+)/i);
  return match ? match[1] : raw.replace(/^\/+|\/+$/g, '');
}

const WATCHED_PROJECTS = [
  {
    key: 'ltt',
    name: 'Litematica Together',
    slug: 'litematica-together',
    ruChannelKey: 'lttRuUpdatesChannelId',
    gbChannelKey: 'lttGbUpdatesChannelId',
    seenKey: 'lttModrinthSeenVersionIds',
    seededRuKey: 'lttModrinthRuSeeded',
    seededGbKey: 'lttModrinthGbSeeded',
    lastCheckKey: 'lttModrinthLastCheckAt',
    lastErrorKey: 'lttModrinthLastError',
  },
  {
    key: 'simpleTranslator',
    name: 'Simple Translator',
    slug: slugFrom(process.env.SIMPLE_TRANSLATOR_MODRINTH_SLUG || process.env.SIMPLE_TRANSLATOR_MODRINTH_URL),
    ruChannelKey: 'simpleTranslatorRuUpdatesChannelId',
    gbChannelKey: 'simpleTranslatorGbUpdatesChannelId',
    seenKey: 'simpleTranslatorModrinthSeenVersionIds',
    seededRuKey: 'simpleTranslatorModrinthRuSeeded',
    seededGbKey: 'simpleTranslatorModrinthGbSeeded',
    lastCheckKey: 'simpleTranslatorModrinthLastCheckAt',
    lastErrorKey: 'simpleTranslatorModrinthLastError',
  },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ModsHub-Helper/2.0 (Litematica Together + Simple Translator)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Modrinth HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProject(config) {
  return fetchJson(`${MODRINTH_API_BASE}/project/${encodeURIComponent(config.slug)}`);
}

async function fetchVersions(config) {
  const versions = await fetchJson(
    `${MODRINTH_API_BASE}/project/${encodeURIComponent(config.slug)}/version?include_changelog=true`,
  );
  return versions
    .filter(version => !['draft', 'unlisted', 'archived'].includes(version.status))
    .sort((a, b) => new Date(a.date_published) - new Date(b.date_published));
}

function trim(text, max = 3500, russian = false) {
  const value = String(text || '').trim();
  if (!value) return russian ? 'Для этой версии список изменений не указан.' : 'No changelog was provided for this release.';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function list(values, max = 15) {
  if (!Array.isArray(values) || !values.length) return '—';
  const shown = values.slice(0, max);
  return `${shown.join(', ')}${values.length > max ? ` +${values.length - max}` : ''}`;
}

function releaseTypeRu(type) {
  if (type === 'release') return 'Релиз';
  if (type === 'beta') return 'Бета';
  if (type === 'alpha') return 'Альфа';
  return String(type || 'Релиз');
}

function projectUrl(config) {
  return `https://modrinth.com/mod/${config.slug}`;
}

function releasePayload(config, project, version, { current = false, russian = false } = {}) {
  const published = Math.floor(new Date(version.date_published).getTime() / 1000);
  const baseUrl = projectUrl(config);
  const versionUrl = `${baseUrl}/version/${version.id}`;
  const title = russian
    ? `${current ? '📦 Текущая версия' : '🚀 Новая версия'} ${config.name} — ${version.version_number}`
    : `${current ? '📦 Current release' : '🚀 New release'} ${config.name} — ${version.version_number}`;

  const changelog = trim(version.changelog, 3500, russian);
  const description = russian ? `**Список изменений с Modrinth:**\n${changelog}` : changelog;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(versionUrl)
    .setDescription(description)
    .addFields(
      {
        name: russian ? 'Тип версии' : 'Release type',
        value: russian ? releaseTypeRu(version.version_type) : String(version.version_type || 'release'),
        inline: true,
      },
      { name: 'Minecraft', value: list(version.game_versions), inline: true },
      { name: russian ? 'Загрузчики' : 'Loaders', value: list(version.loaders), inline: true },
      {
        name: russian ? 'Опубликовано' : 'Published',
        value: Number.isFinite(published) ? `<t:${published}:F>\n<t:${published}:R>` : '—',
        inline: false,
      },
    )
    .setFooter({ text: `${russian ? 'Источник' : 'Source'}: Modrinth • ${config.name}` });

  if (project?.icon_url) embed.setThumbnail(project.icon_url);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(russian ? 'Открыть версию' : 'Open release')
        .setStyle(ButtonStyle.Link)
        .setURL(versionUrl),
      new ButtonBuilder()
        .setLabel(russian ? 'Страница мода' : 'Mod page')
        .setStyle(ButtonStyle.Link)
        .setURL(baseUrl),
    )],
    allowedMentions: { parse: [] },
  };
}

async function channelsFor(guild, config) {
  let cfg = db.guild(guild.id);
  let ru = cfg[config.ruChannelKey] ? await guild.channels.fetch(cfg[config.ruChannelKey]).catch(() => null) : null;
  let gb = cfg[config.gbChannelKey] ? await guild.channels.fetch(cfg[config.gbChannelKey]).catch(() => null) : null;
  if (!ru || !gb) {
    await ensureProjectInfrastructure(guild);
    cfg = db.guild(guild.id);
    ru = cfg[config.ruChannelKey] ? await guild.channels.fetch(cfg[config.ruChannelKey]).catch(() => null) : null;
    gb = cfg[config.gbChannelKey] ? await guild.channels.fetch(cfg[config.gbChannelKey]).catch(() => null) : null;
  }
  return { ru, gb };
}

function migrateLegacyLttState(cfg, config) {
  if (config.key !== 'ltt') return;
  if (!cfg[config.seenKey]?.length && Array.isArray(cfg.modrinthSeenVersionIds)) {
    cfg[config.seenKey] = cfg.modrinthSeenVersionIds;
  }
  if (cfg[config.seededGbKey] == null && cfg.modrinthProjectUpdatesSeeded != null) {
    cfg[config.seededGbKey] = Boolean(cfg.modrinthProjectUpdatesSeeded);
  }
  if (cfg[config.seededRuKey] == null && cfg.modrinthRussianUpdatesSeeded != null) {
    cfg[config.seededRuKey] = Boolean(cfg.modrinthRussianUpdatesSeeded);
  }
}

async function seedCurrent(guild, config, channels, project, latest) {
  if (!latest) return;
  const cfg = db.guild(guild.id);
  migrateLegacyLttState(cfg, config);
  if (channels.gb && !cfg[config.seededGbKey]) {
    await channels.gb.send(releasePayload(config, project, latest, { current: true }));
    cfg[config.seededGbKey] = true;
  }
  if (channels.ru && !cfg[config.seededRuKey]) {
    await channels.ru.send(releasePayload(config, project, latest, { current: true, russian: true }));
    cfg[config.seededRuKey] = true;
  }
  db.save();
}

async function checkProject(guild, config) {
  if (!config.slug) return { skipped: true, reason: 'not_configured' };
  const channels = await channelsFor(guild, config);
  if (!channels.ru && !channels.gb) throw new Error(`${config.name} update channels are missing`);

  const [project, versions] = await Promise.all([fetchProject(config), fetchVersions(config)]);
  if (!versions.length) return { skipped: true, reason: 'no_versions' };

  const cfg = db.guild(guild.id);
  migrateLegacyLttState(cfg, config);
  const seen = new Set(cfg[config.seenKey] || []);

  if (!seen.size) {
    cfg[config.seenKey] = versions.map(version => version.id).slice(-MAX_SEEN_IDS);
    cfg[config.lastCheckKey] = Date.now();
    cfg[config.lastErrorKey] = null;
    db.save();
    await seedCurrent(guild, config, channels, project, versions.at(-1));
    return { seeded: true };
  }

  await seedCurrent(guild, config, channels, project, versions.at(-1));
  const fresh = versions.filter(version => !seen.has(version.id));
  for (const version of fresh) {
    if (channels.gb) await channels.gb.send(releasePayload(config, project, version));
    if (channels.ru) await channels.ru.send(releasePayload(config, project, version, { russian: true }));
    seen.add(version.id);
    await sleep(500);
  }

  cfg[config.seenKey] = [...seen].slice(-MAX_SEEN_IDS);
  cfg[config.lastCheckKey] = Date.now();
  cfg[config.lastErrorKey] = null;
  db.save();
  return { published: fresh.length };
}

async function safeCheckProject(guild, config) {
  try {
    return await checkProject(guild, config);
  } catch (error) {
    const cfg = db.guild(guild.id);
    cfg[config.lastCheckKey] = Date.now();
    cfg[config.lastErrorKey] = String(error.message || error).slice(0, 500);
    db.save();
    console.warn(`[MODRINTH/${config.key}] ${guild.name}: ${error.message}`);
    return { error: error.message };
  }
}

async function checkGuild(guild) {
  const results = {};
  for (const config of WATCHED_PROJECTS) {
    results[config.key] = await safeCheckProject(guild, config);
  }
  return results;
}

function startModrinthWatcher(client, targetGuildId = null) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (targetGuildId && guild.id !== targetGuildId) continue;
        await checkGuild(guild);
      }
    } finally {
      running = false;
    }
  };

  run().catch(error => console.error('[MODRINTH]', error));
  const timer = setInterval(() => run().catch(error => console.error('[MODRINTH]', error)), CHECK_INTERVAL_MS);
  timer.unref?.();

  const enabled = WATCHED_PROJECTS.filter(project => project.slug).map(project => `${project.name}:${project.slug}`);
  const disabled = WATCHED_PROJECTS.filter(project => !project.slug).map(project => project.name);
  console.log(`[MODRINTH] watching ${enabled.join(', ')} every ${Math.round(CHECK_INTERVAL_MS / 1000)}s`);
  if (disabled.length) {
    console.log(`[MODRINTH] not configured yet: ${disabled.join(', ')}. Set SIMPLE_TRANSLATOR_MODRINTH_SLUG when its Modrinth page is ready.`);
  }
  return timer;
}

module.exports = {
  WATCHED_PROJECTS,
  checkGuild,
  checkProject,
  startModrinthWatcher,
};
