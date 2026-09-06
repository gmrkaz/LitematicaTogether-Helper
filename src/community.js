const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('./db');

const HIDDEN_ROLE_NAME = 'Hidden';
const START_HERE_CATEGORY_NAME = 'START HERE';
const WELCOME_CHANNEL_NAME = 'welcome';

const roleByName = (guild, name) => guild.roles.cache.find(role => role.name === name);
const channelByName = (guild, name, types = null) => guild.channels.cache.find(channel => (
  channel.name.toLowerCase() === name.toLowerCase() && (!types || types.includes(channel.type))
));

function normalizedCategoryName(name) {
  return String(name || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryByNames(guild, names) {
  const wanted = new Set(names.map(normalizedCategoryName));
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory && wanted.has(normalizedCategoryName(channel.name))
  ));
}

// Kept as exported compatibility helpers for older modules/integrations. The
// final server no longer creates START HERE/#rules or START HERE/#faq.
function rulesPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Server Rules / Правила сервера')
      .setDescription('Use **COMMUNITY RU → #правила** or **COMMUNITY GB → #rules** for the full language-specific rules.')],
    allowedMentions: { parse: [] },
  };
}

function faqPayload(supportChannelId = null) {
  const support = supportChannelId ? `<#${supportChannelId}>` : '#support';
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Help / Помощь')
      .setDescription(`For technical help with **Litematica Together** or **Simple Translator**, use ${support}.`)],
    allowedMentions: { parse: [] },
  };
}

function welcomePayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Welcome / Добро пожаловать')
      .setDescription([
        'Official community for **Litematica Together** and **Simple Translator**.',
        'Официальное сообщество **Litematica Together** и **Simple Translator**.',
        '',
        'Discord Onboarding selects **Русский** or **English** before you enter the server.',
        'Discord Onboarding выбирает **Русский** или **English** до входа на сервер.',
      ].join('\n'))],
    components: [],
    allowedMentions: { parse: [] },
  };
}

async function ensureHiddenRole(guild) {
  let role = roleByName(guild, HIDDEN_ROLE_NAME);
  if (!role) {
    role = await guild.roles.create({
      name: HIDDEN_ROLE_NAME,
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: 'MODS HUB: role for hiding members from server channels',
    });
  }
  return role;
}

function readOnlyOverwrites(guild, hiddenRole) {
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
    { id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];

  if (guild.members.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }
  return overwrites;
}

async function ensureStartHereCategory(guild, hiddenRole) {
  let startHere = categoryByNames(guild, ['START HERE', 'Start Here']);
  const info = categoryByNames(guild, ['INFO', 'Info']);

  if (!startHere && info) {
    startHere = info;
    await startHere.setName(START_HERE_CATEGORY_NAME, 'MODS HUB: merge INFO into START HERE').catch(() => {});
  }

  if (!startHere) {
    startHere = await guild.channels.create({
      name: START_HERE_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      reason: 'MODS HUB: clean onboarding and navigation category',
    });
  }

  if (info && info.id !== startHere.id) {
    const children = guild.channels.cache.filter(channel => channel.parentId === info.id);
    for (const child of children.values()) {
      await child.setParent(startHere.id, { lockPermissions: false }).catch(() => {});
    }
    await info.delete('MODS HUB: INFO merged into START HERE').catch(() => {});
  }

  if (startHere.name !== START_HERE_CATEGORY_NAME) {
    await startHere.setName(START_HERE_CATEGORY_NAME, 'MODS HUB: normalize onboarding category').catch(() => {});
  }

  await startHere.permissionOverwrites.edit(hiddenRole, { ViewChannel: false }, {
    reason: 'MODS HUB: Hidden role cannot view server channels',
  }).catch(() => {});
  await startHere.setPosition(0).catch(() => {});
  return startHere;
}

async function ensureReadOnlyChannel(guild, category, hiddenRole, name, topic) {
  let channel = channelByName(guild, name, [ChannelType.GuildText]);
  const permissionOverwrites = readOnlyOverwrites(guild, hiddenRole);

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      permissionOverwrites,
      reason: 'MODS HUB: information channel',
    });
  } else {
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
    await channel.setTopic(topic).catch(() => {});
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return channel;
}

async function upsertWelcomeMessage(channel) {
  const cfg = db.guild(channel.guild.id);
  let existing = cfg.welcomeMessageId
    ? await channel.messages.fetch(cfg.welcomeMessageId).catch(() => null)
    : null;

  if (!existing) {
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    existing = recent?.find(message => (
      message.author.id === channel.client.user.id
      && message.embeds.some(embed => [
        'Welcome / Добро пожаловать',
        'Choose your language / Выберите язык',
        '✨ Добро пожаловать / Welcome',
      ].includes(embed.title))
    ));
  }

  if (existing) await existing.edit(welcomePayload()).catch(() => {});
  else existing = await channel.send(welcomePayload());

  cfg.welcomeChannelId = channel.id;
  cfg.welcomeMessageId = existing.id;
  db.save();
  if (!existing.pinned) await existing.pin('MODS HUB: keep welcome information at the top').catch(() => {});
  return existing;
}

function viewState(channel, memberId) {
  const overwrite = channel.permissionOverwrites?.cache?.get(memberId);
  if (!overwrite) return 'unset';
  if (overwrite.allow.has(PermissionFlagsBits.ViewChannel)) return 'allow';
  if (overwrite.deny.has(PermissionFlagsBits.ViewChannel)) return 'deny';
  return 'unset';
}

function hiddenSnapshots(guild) {
  const cfg = db.guild(guild.id);
  cfg.hiddenAccessSnapshots ||= {};
  return cfg.hiddenAccessSnapshots;
}

async function hideMemberFromChannel(member, channel, snapshots) {
  if (!channel?.permissionOverwrites?.edit || channel.isThread?.()) return;
  snapshots[channel.id] ??= viewState(channel, member.id);
  await channel.permissionOverwrites.edit(member, { ViewChannel: false }, {
    reason: 'MODS HUB: member has Hidden role',
  });
}

async function hideMemberEverywhere(member) {
  if (!member?.guild || member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const guild = member.guild;
  await guild.channels.fetch();
  const allSnapshots = hiddenSnapshots(guild);
  const snapshots = allSnapshots[member.id] ||= {};

  for (const channel of guild.channels.cache.values()) {
    await hideMemberFromChannel(member, channel, snapshots).catch(() => {});
  }
  db.save();
}

async function restoreMemberVisibility(member) {
  if (!member?.guild) return;
  const guild = member.guild;
  const allSnapshots = hiddenSnapshots(guild);
  const snapshots = allSnapshots[member.id];
  if (!snapshots) return;

  for (const [channelId, state] of Object.entries(snapshots)) {
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.permissionOverwrites?.edit || channel.isThread?.()) continue;
    const value = state === 'allow' ? true : state === 'deny' ? false : null;
    await channel.permissionOverwrites.edit(member, { ViewChannel: value }, {
      reason: 'MODS HUB: Hidden role removed; restore previous visibility',
    }).catch(() => {});
  }

  delete allSnapshots[member.id];
  db.save();
}

async function syncHiddenMemberRoleChange(oldMember, newMember) {
  const hiddenRole = roleByName(newMember.guild, HIDDEN_ROLE_NAME);
  if (!hiddenRole) return;
  const hadRole = oldMember.roles.cache.has(hiddenRole.id);
  const hasRole = newMember.roles.cache.has(hiddenRole.id);
  if (hadRole === hasRole) return;

  if (hasRole) await hideMemberEverywhere(newMember);
  else await restoreMemberVisibility(newMember);
}

async function syncHiddenMembers(guild, hiddenRole) {
  await guild.members.fetch();
  const allSnapshots = hiddenSnapshots(guild);

  for (const memberId of Object.keys(allSnapshots)) {
    const member = guild.members.cache.get(memberId);
    if (!member || !member.roles.cache.has(hiddenRole.id)) {
      if (member) await restoreMemberVisibility(member);
      else {
        delete allSnapshots[memberId];
        db.save();
      }
    }
  }

  for (const member of hiddenRole.members.values()) {
    await hideMemberEverywhere(member);
  }
}

async function applyHiddenRoleToChannel(channel, role = null) {
  if (!channel?.guild || channel.isThread?.() || !channel.permissionOverwrites?.edit) return;
  const hiddenRole = role || roleByName(channel.guild, HIDDEN_ROLE_NAME);
  if (!hiddenRole) return;

  await channel.permissionOverwrites.edit(hiddenRole, { ViewChannel: false }, {
    reason: 'MODS HUB: Hidden role cannot view server channels',
  });

  const allSnapshots = hiddenSnapshots(channel.guild);
  for (const member of hiddenRole.members.values()) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) continue;
    const snapshots = allSnapshots[member.id] ||= {};
    await hideMemberFromChannel(member, channel, snapshots).catch(() => {});
  }
  db.save();
}

async function applyHiddenRoleToAllChannels(guild, hiddenRole) {
  await guild.channels.fetch();
  for (const channel of guild.channels.cache.values()) {
    await applyHiddenRoleToChannel(channel, hiddenRole).catch(() => {});
  }
}

async function sendWelcomeNotification(member) {
  if (!member?.guild || member.user?.bot) return;
  const cfg = db.guild(member.guild.id);
  let channel = cfg.welcomeChannelId
    ? await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null)
    : null;
  if (!channel) channel = channelByName(member.guild, WELCOME_CHANNEL_NAME, [ChannelType.GuildText]);
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: `👋 <@${member.id}> Welcome! / Добро пожаловать!`,
    allowedMentions: { users: [member.id] },
  }).catch(() => {});
}

async function ensureCommunityInfrastructure(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const hiddenRole = await ensureHiddenRole(guild);
  const startHere = await ensureStartHereCategory(guild, hiddenRole);
  const welcome = await ensureReadOnlyChannel(
    guild,
    startHere,
    hiddenRole,
    WELCOME_CHANNEL_NAME,
    'Welcome and navigation for Litematica Together + Simple Translator.',
  );

  await welcome.setPosition(0).catch(() => {});
  await upsertWelcomeMessage(welcome);

  const cfg = db.guild(guild.id);
  Object.assign(cfg, {
    startHereCategoryId: startHere.id,
    welcomeChannelId: welcome.id,
  });
  db.save();

  await applyHiddenRoleToAllChannels(guild, hiddenRole);
  await syncHiddenMembers(guild, hiddenRole);

  return { hiddenRole, startHere, welcome };
}

module.exports = {
  HIDDEN_ROLE_NAME,
  rulesPayload,
  faqPayload,
  welcomePayload,
  ensureCommunityInfrastructure,
  applyHiddenRoleToChannel,
  syncHiddenMemberRoleChange,
  sendWelcomeNotification,
};
