const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

const MODRINTH_PROJECT_SLUG = 'litematica-together';
const MODRINTH_PROJECT_URL = 'https://modrinth.com/mod/litematica-together';
const MODRINTH_API_BASE = 'https://api.modrinth.com/v2';
const MOD_UPDATES_CHANNEL_NAME = 'mod-updates';
const CHECK_INTERVAL_MS = Math.max(60_000, Number(process.env.MODRINTH_CHECK_INTERVAL_MS || 300_000));
const FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.MODRINTH_FETCH_TIMEOUT_MS || 8_000));
const MAX_SEEN_IDS = 100;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function updatesOverwrites(guild, hiddenRole) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    },
  ];

  if (hiddenRole) {
    overwrites.push({ id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel] });
  }

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

async function ensureUpdatesChannel(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const cfg = db.guild(guild.id);

  let channel = cfg.modUpdatesChannelId
    ? await guild.channels.fetch(cfg.modUpdatesChannelId).catch(() => null)
    : null;

  if (!channel) {
    channel = guild.channels.cache.find(ch => (
      ch.name === MOD_UPDATES_CHANNEL_NAME
      && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)
    ));
  }

  const startHere = cfg.startHereCategoryId
    ? await guild.channels.fetch(cfg.startHereCategoryId).catch(() => null)
    : null;
  const hiddenRole = guild.roles.cache.find(role => role.name === 'Hidden');
  const permissionOverwrites = updatesOverwrites(guild, hiddenRole);

  if (!channel) {
    channel = await guild.channels.create({
      name: MOD_UPDATES_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: startHere?.type === ChannelType.GuildCategory ? startHere.id : null,
      topic: 'Automatic Litematica Together releases and changelogs from Modrinth.',
      permissionOverwrites,
      reason: 'LTT HELPER: Modrinth release announcements',
    });
  } else {
    if (startHere?.type === ChannelType.GuildCategory && channel.parentId !== startHere.id) {
      await channel.setParent(startHere.id, { lockPermissions: false }).catch(() => {});
    }
    await channel.setTopic('Automatic Litematica Together releases and changelogs from Modrinth.').catch(() => {});
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }

  await channel.setPosition(3).catch(() => {});
  cfg.modUpdatesChannelId = channel.id;
  db.save();
  return channel;
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

function releasePayload(project, version, { current = false } = {}) {
  const published = Math.floor(new Date(version.date_published).getTime() / 1000);
  const versionUrl = `${MODRINTH_PROJECT_URL}/version/${version.id}`;
  const title = current
    ? `📦 Current Litematica Together release — ${version.version_number}`
    : `🚀 New Litematica Together release — ${version.version_number}`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(versionUrl)
    .setDescription(trim(version.changelog))
    .addFields(
      { name: 'Release type', value: String(version.version_type || 'release'), inline: true },
      { name: 'Minecraft', value: list(version.game_versions), inline: true },
      { name: 'Loaders', value: list(version.loaders), inline: true },
      { name: 'Published', value: Number.isFinite(published) ? `<t:${published}:F>\n<t:${published}:R>` : '—', inline: false },
    )
    .setFooter({ text: 'Source: Modrinth • Litematica Together' });

  if (project?.icon_url) embed.setThumbnail(project.icon_url);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open on Modrinth')
        .setStyle(ButtonStyle.Link)
        .setURL(versionUrl),
      new ButtonBuilder()
        .setLabel('Project page')
        .setStyle(ButtonStyle.Link)
        .setURL(MODRINTH_PROJECT_URL),
    )],
    allowedMentions: { parse: [] },
  };
}

async function initializeState(guild, channel, project, versions) {
  const cfg = db.guild(guild.id);
  const currentIds = versions.map(version => version.id);
  cfg.modrinthSeenVersionIds = currentIds.slice(-MAX_SEEN_IDS);
  cfg.modrinthLastCheckAt = Date.now();
  db.save();

  const latest = versions.at(-1);
  if (latest && !cfg.modrinthInitialAnnouncementSent) {
    await channel.send(releasePayload(project, latest, { current: true }));
    cfg.modrinthInitialAnnouncementSent = true;
    db.save();
  }
}

async function checkGuild(guild) {
  const channel = await ensureUpdatesChannel(guild);
  const [project, versions] = await Promise.all([fetchProject(), fetchVersions()]);
  if (!versions.length) return;

  const cfg = db.guild(guild.id);
  const seen = new Set(cfg.modrinthSeenVersionIds || []);

  if (!seen.size) {
    await initializeState(guild, channel, project, versions);
    return;
  }

  const fresh = versions.filter(version => !seen.has(version.id));
  for (const version of fresh) {
    await channel.send(releasePayload(project, version));
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

  console.log(`[MODRINTH] watching ${MODRINTH_PROJECT_URL} every ${Math.round(CHECK_INTERVAL_MS / 1000)}s`);
  return timer;
}

module.exports = {
  MODRINTH_PROJECT_SLUG,
  MODRINTH_PROJECT_URL,
  MOD_UPDATES_CHANNEL_NAME,
  ensureUpdatesChannel,
  checkGuild,
  startModrinthWatcher,
};
