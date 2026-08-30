'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');
const { ensureRussianChannels } = require('./russian-channels');

const MODRINTH_PROJECT_SLUG = 'litematica-together';
const MODRINTH_PROJECT_URL = 'https://modrinth.com/mod/litematica-together';
const MODRINTH_API_BASE = 'https://api.modrinth.com/v2';
const CHECK_INTERVAL_MS = Math.max(60_000, Number(process.env.MODRINTH_CHECK_INTERVAL_MS || 300_000));
const FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.MODRINTH_FETCH_TIMEOUT_MS || 8_000));
const MAX_SEEN_IDS = 100;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(name) {
  return String(name || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LitematicaTogether-Helper/1.4.0 (https://github.com/gmrkaz/LitematicaTogether-Helper)',
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

async function fetchProject() {
  return fetchJson(`${MODRINTH_API_BASE}/project/${MODRINTH_PROJECT_SLUG}`);
}

async function fetchVersions() {
  const versions = await fetchJson(
    `${MODRINTH_API_BASE}/project/${MODRINTH_PROJECT_SLUG}/version?include_changelog=true`,
  );
  return versions
    .filter(version => !['draft', 'unlisted', 'archived'].includes(version.status))
    .sort((a, b) => new Date(a.date_published) - new Date(b.date_published));
}

function categoryByName(guild, name) {
  const wanted = normalize(name);
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === wanted
  ));
}

function readOnlyOverwrites(guild, hiddenRole, languageRole = null) {
  const overwrites = languageRole
    ? [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: languageRole.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages],
      },
    ]
    : [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages],
      },
    ];

  if (hiddenRole) overwrites.push({ id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel] });
  if (guild.members.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }
  return overwrites;
}

async function cleanupLegacyChannel(guild) {
  const cfg = db.guild(guild.id);
  if (!cfg.modUpdatesChannelId) return;
  const channel = await guild.channels.fetch(cfg.modUpdatesChannelId).catch(() => null);
  if (channel?.name === 'mod-updates') {
    await channel.delete('LTT HELPER: PROJECT #updates already exists').catch(() => {});
  }
  delete cfg.modUpdatesChannelId;
  db.save();
}

async function ensureUpdatesChannels(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  await cleanupLegacyChannel(guild);

  const cfg = db.guild(guild.id);
  const project = categoryByName(guild, 'PROJECT') || await guild.channels.create({
    name: 'PROJECT',
    type: ChannelType.GuildCategory,
    reason: 'LTT HELPER: project information category',
  });
  const hiddenRole = guild.roles.cache.find(role => role.name === 'Hidden');
  const russianRole = guild.roles.cache.find(role => ['Русский', 'Russian'].includes(role.name));

  let english = guild.channels.cache.find(channel => (
    channel.parentId === project.id
    && channel.name === 'updates'
    && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
  ));
  if (!english) {
    english = await guild.channels.create({
      name: 'updates',
      type: ChannelType.GuildText,
      parent: project.id,
      topic: 'Official Litematica Together release updates from Modrinth.',
      permissionOverwrites: readOnlyOverwrites(guild, hiddenRole),
      reason: 'LTT HELPER: missing PROJECT updates channel',
    });
  }

  let russian = cfg.russianUpdatesChannelId
    ? await guild.channels.fetch(cfg.russianUpdatesChannelId).catch(() => null)
    : null;
  if (!russian) {
    russian = guild.channels.cache.find(channel => (
      channel.parentId === project.id
      && channel.name === 'обновления'
      && channel.type === ChannelType.GuildText
    ));
  }
  if (!russian && russianRole) {
    russian = await guild.channels.create({
      name: 'обновления',
      type: ChannelType.GuildText,
      parent: project.id,
      topic: 'Автоматические новости о новых версиях Litematica Together на русском языке.',
      permissionOverwrites: readOnlyOverwrites(guild, hiddenRole, russianRole),
      reason: 'LTT HELPER: Russian PROJECT updates channel',
    });
  }

  cfg.projectUpdatesChannelId = english.id;
  if (russian) cfg.russianUpdatesChannelId = russian.id;
  db.save();
  return { english, russian };
}

function trim(text, max = 3500) {
  const value = String(text || '').trim();
  if (!value) return 'No changelog was provided for this release.';
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

function releasePayload(project, version, { current = false, russian = false } = {}) {
  const published = Math.floor(new Date(version.date_published).getTime() / 1000);
  const versionUrl = `${MODRINTH_PROJECT_URL}/version/${version.id}`;

  const title = russian
    ? (current
      ? `📦 Текущая версия Litematica Together — ${version.version_number}`
      : `🚀 Новая версия Litematica Together — ${version.version_number}`)
    : (current
      ? `📦 Current Litematica Together release — ${version.version_number}`
      : `🚀 New Litematica Together release — ${version.version_number}`);

  const changelog = trim(version.changelog);
  const description = russian
    ? `**Список изменений с Modrinth:**\n${changelog}`
    : changelog;

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
    .setFooter({ text: russian ? 'Источник: Modrinth • Litematica Together' : 'Source: Modrinth • Litematica Together' });

  if (project?.icon_url) embed.setThumbnail(project.icon_url);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(russian ? 'Открыть версию на Modrinth' : 'Open on Modrinth')
        .setStyle(ButtonStyle.Link)
        .setURL(versionUrl),
      new ButtonBuilder()
        .setLabel(russian ? 'Страница проекта' : 'Project page')
        .setStyle(ButtonStyle.Link)
        .setURL(MODRINTH_PROJECT_URL),
    )],
    allowedMentions: { parse: [] },
  };
}

async function seedCurrent(guild, channels, project, latest) {
  const cfg = db.guild(guild.id);
  if (latest && !cfg.modrinthProjectUpdatesSeeded) {
    await channels.english.send(releasePayload(project, latest, { current: true }));
    cfg.modrinthProjectUpdatesSeeded = true;
  }
  if (latest && channels.russian && !cfg.modrinthRussianUpdatesSeeded) {
    await channels.russian.send(releasePayload(project, latest, { current: true, russian: true }));
    cfg.modrinthRussianUpdatesSeeded = true;
  }
  db.save();
}

async function initializeState(guild, channels, project, versions) {
  const cfg = db.guild(guild.id);
  cfg.modrinthSeenVersionIds = versions.map(version => version.id).slice(-MAX_SEEN_IDS);
  cfg.modrinthLastCheckAt = Date.now();
  db.save();
  await seedCurrent(guild, channels, project, versions.at(-1));
}

async function checkGuild(guild) {
  await ensureRussianChannels(guild, {
    supportChannelId: db.guild(guild.id).supportChannelId,
  });

  const channels = await ensureUpdatesChannels(guild);
  const [project, versions] = await Promise.all([fetchProject(), fetchVersions()]);
  if (!versions.length) return;

  const cfg = db.guild(guild.id);
  const seen = new Set(cfg.modrinthSeenVersionIds || []);

  if (!seen.size) {
    await initializeState(guild, channels, project, versions);
    return;
  }

  await seedCurrent(guild, channels, project, versions.at(-1));

  const fresh = versions.filter(version => !seen.has(version.id));
  for (const version of fresh) {
    await channels.english.send(releasePayload(project, version));
    if (channels.russian) {
      await channels.russian.send(releasePayload(project, version, { russian: true }));
    }
    seen.add(version.id);
    await sleep(500);
  }

  cfg.modrinthSeenVersionIds = [...seen].slice(-MAX_SEEN_IDS);
  cfg.modrinthLastCheckAt = Date.now();
  cfg.modrinthLastError = null;
  db.save();
}

async function safeCheckGuild(guild) {
  try {
    await checkGuild(guild);
  } catch (error) {
    const cfg = db.guild(guild.id);
    cfg.modrinthLastCheckAt = Date.now();
    cfg.modrinthLastError = String(error.message || error).slice(0, 500);
    db.save();
    console.warn(`[MODRINTH] ${guild.name}: ${error.message}`);
  }
}

function startModrinthWatcher(client, targetGuildId = null) {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (targetGuildId && guild.id !== targetGuildId) continue;
        await safeCheckGuild(guild);
      }
    } finally {
      running = false;
    }
  };

  run().catch(error => console.error('[MODRINTH]', error));
  const timer = setInterval(() => {
    run().catch(error => console.error('[MODRINTH]', error));
  }, CHECK_INTERVAL_MS);
  timer.unref?.();

  console.log(`[MODRINTH] watching ${MODRINTH_PROJECT_URL} -> PROJECT/#updates + #обновления every ${Math.round(CHECK_INTERVAL_MS / 1000)}s`);
  return timer;
}

module.exports = {
  MODRINTH_PROJECT_SLUG,
  MODRINTH_PROJECT_URL,
  ensureUpdatesChannels,
  checkGuild,
  startModrinthWatcher,
};
