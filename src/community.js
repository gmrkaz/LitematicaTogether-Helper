const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const HIDDEN_ROLE_NAME = 'Hidden';
const INFO_CATEGORY_NAME = 'INFO';
const RULES_CHANNEL_NAME = 'rules';
const FAQ_CHANNEL_NAME = 'faq';

const roleByName = (guild, name) => guild.roles.cache.find(role => role.name === name);
const channelByName = (guild, name, types = null) => guild.channels.cache.find(channel => (
  channel.name === name && (!types || types.includes(channel.type))
));

function rulesPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Server Rules')
      .setDescription([
        'Simple version: Let\'s keep this server clean and "on topic".',
        '',
        '- No politics, religion, and other IRL stuff that is not in any way related to this server, and can or will cause drama at some point',
        '- No memes or other similar content, because that can easily become too edgy and disturbing and lead to increased moderation need and time usage',
        '- Respect everyone else as human beings (presumably there aren\'t any AI bots here yet...), and don\'t attack or insult or judge anyone else for who they are or what they think of whatever subject',
        '- Try to keep discussions and questions on the relevant channels as much as possible, and avoid off-topic threads/rants on the topic/mod-specific channels',
      ].join('\n'))],
    allowedMentions: { parse: [] },
  };
}

function faqPayload(supportChannelId = null) {
  const support = supportChannelId ? `<#${supportChannelId}>` : '#support';
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Frequently Asked Questions')
      .setDescription([
        `**Where can I get help?**\nGo to ${support} and press **Open Support Request**.`,
        '**What should I include in a support request?**\nInclude your Litematica Together, Minecraft, Litematica and MaLiLib versions, explain what happened, what you expected to happen, and attach logs/screenshots when useful.',
        '**Can I open several support tickets at once?**\nNo. The support system allows one open ticket per user.',
        `**Where do I report bugs, connection/sync problems or suggestions?**\nUse ${support}. The same support form is used for bugs, installation, connection, synchronization, compatibility questions and suggestions.`,
        '**How can I support the project?**\nUse the **Donate** button in the support panel or the `/donate` command.',
        '**Where should general discussion go?**\nPlease use the channel that best matches the topic and keep mod-specific channels focused on Litematica Together.',
      ].join('\n\n'))],
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
      reason: 'LTT HELPER: role for hiding members from server channels',
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
      ],
    });
  }
  return overwrites;
}

async function ensureInfoCategory(guild, hiddenRole) {
  let category = channelByName(guild, INFO_CATEGORY_NAME, [ChannelType.GuildCategory]);
  if (!category) {
    category = await guild.channels.create({
      name: INFO_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      reason: 'LTT HELPER: rules and FAQ category',
    });
  }
  await category.permissionOverwrites.edit(hiddenRole, { ViewChannel: false }, {
    reason: 'LTT HELPER: Hidden role cannot view server channels',
  }).catch(() => {});
  return category;
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
      reason: 'LTT HELPER: community information channel',
    });
  } else {
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
    await channel.setTopic(topic).catch(() => {});
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return channel;
}

async function upsertBotEmbed(channel, title, payload) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find(message => (
    message.author.id === channel.client.user.id
    && message.embeds.some(embed => embed.title === title)
  ));

  if (existing) {
    await existing.edit(payload).catch(() => {});
    return existing;
  }
  return channel.send(payload);
}

async function applyHiddenRoleToChannel(channel, role = null) {
  if (!channel?.guild || channel.isThread?.() || !channel.permissionOverwrites?.edit) return;
  const hiddenRole = role || roleByName(channel.guild, HIDDEN_ROLE_NAME);
  if (!hiddenRole) return;
  await channel.permissionOverwrites.edit(hiddenRole, { ViewChannel: false }, {
    reason: 'LTT HELPER: Hidden role cannot view server channels',
  });
}

async function applyHiddenRoleToAllChannels(guild, hiddenRole) {
  await guild.channels.fetch();
  for (const channel of guild.channels.cache.values()) {
    await applyHiddenRoleToChannel(channel, hiddenRole).catch(() => {});
  }
}

async function ensureCommunityInfrastructure(guild, { supportChannelId = null } = {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const hiddenRole = await ensureHiddenRole(guild);
  const infoCategory = await ensureInfoCategory(guild, hiddenRole);
  const rules = await ensureReadOnlyChannel(
    guild,
    infoCategory,
    hiddenRole,
    RULES_CHANNEL_NAME,
    'Official Litematica Together server rules.',
  );
  const faq = await ensureReadOnlyChannel(
    guild,
    infoCategory,
    hiddenRole,
    FAQ_CHANNEL_NAME,
    'Frequently asked questions and support information.',
  );

  await upsertBotEmbed(rules, 'Server Rules', rulesPayload());
  await upsertBotEmbed(faq, 'Frequently Asked Questions', faqPayload(supportChannelId));
  await applyHiddenRoleToAllChannels(guild, hiddenRole);

  return { hiddenRole, infoCategory, rules, faq };
}

module.exports = {
  HIDDEN_ROLE_NAME,
  rulesPayload,
  faqPayload,
  ensureCommunityInfrastructure,
  applyHiddenRoleToChannel,
};
