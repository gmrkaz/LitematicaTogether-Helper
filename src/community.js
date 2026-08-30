const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

const HIDDEN_ROLE_NAME = 'Hidden';
const START_HERE_CATEGORY_NAME = 'START HERE';
const WELCOME_CHANNEL_NAME = 'welcome';
const RULES_CHANNEL_NAME = 'rules';
const FAQ_CHANNEL_NAME = 'faq';
const LANGUAGE_VOICE_CATEGORY_NAME = 'LANGUAGE VOICE';
const RUSSIAN_ROLE_NAME = 'Русский';
const ENGLISH_ROLE_NAME = 'English';
const RUSSIAN_ROLE_ALIASES = ['Русский', 'Russian'];
const ENGLISH_ROLE_ALIASES = ['English'];
const LANGUAGE_RU_BUTTON = 'language_ru';
const LANGUAGE_EN_BUTTON = 'language_en';

const roleByName = (guild, name) => guild.roles.cache.find(role => role.name === name);
const roleByAliases = (guild, names) => guild.roles.cache.find(
  role => names.some(name => role.name.toLowerCase() === name.toLowerCase()),
);
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

function welcomePayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Choose your language / Выберите язык')
      .setDescription([
        '**First, choose the language you speak.**',
        '**Сначала выберите язык, на котором вы разговариваете.**',
        '',
        '🇷🇺 **Русский** — Russian role + Russian voice room.',
        '🇬🇧 **English** — English role + English voice room.',
        '',
        'You can change your choice later by pressing the other button.',
        'Позже язык можно сменить, просто нажав другую кнопку.',
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(LANGUAGE_RU_BUTTON)
        .setLabel('Русский')
        .setEmoji('🇷🇺')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(LANGUAGE_EN_BUTTON)
        .setLabel('English')
        .setEmoji('🇬🇧')
        .setStyle(ButtonStyle.Primary),
    )],
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

async function ensureLanguageRole(guild, aliases, createName) {
  let role = roleByAliases(guild, aliases);
  if (!role) {
    role = await guild.roles.create({
      name: createName,
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: 'LTT HELPER: language onboarding role',
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

async function ensureStartHereCategory(guild, hiddenRole) {
  let startHere = categoryByNames(guild, ['START HERE', 'Start Here']);
  const info = categoryByNames(guild, ['INFO', 'Info']);

  if (!startHere && info) {
    startHere = info;
    await startHere.setName(START_HERE_CATEGORY_NAME, 'LTT HELPER: merge INFO into START HERE').catch(() => {});
  }

  if (!startHere) {
    startHere = await guild.channels.create({
      name: START_HERE_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      reason: 'LTT HELPER: onboarding, rules and FAQ',
    });
  }

  if (info && info.id !== startHere.id) {
    const children = guild.channels.cache.filter(channel => channel.parentId === info.id);
    for (const child of children.values()) {
      await child.setParent(startHere.id, { lockPermissions: false }).catch(() => {});
    }
    await info.delete('LTT HELPER: INFO merged into START HERE').catch(() => {});
  }

  if (startHere.name !== START_HERE_CATEGORY_NAME) {
    await startHere.setName(START_HERE_CATEGORY_NAME, 'LTT HELPER: normalize onboarding category').catch(() => {});
  }

  await startHere.permissionOverwrites.edit(hiddenRole, { ViewChannel: false }, {
    reason: 'LTT HELPER: Hidden role cannot view server channels',
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

async function upsertWelcomeMessage(channel) {
  const cfg = db.guild(channel.guild.id);
  let existing = cfg.welcomeMessageId
    ? await channel.messages.fetch(cfg.welcomeMessageId).catch(() => null)
    : null;

  if (!existing) {
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    existing = recent?.find(message => (
      message.author.id === channel.client.user.id
      && message.embeds.some(embed => embed.title === 'Choose your language / Выберите язык')
    ));
  }

  if (existing) await existing.edit(welcomePayload()).catch(() => {});
  else existing = await channel.send(welcomePayload());

  cfg.welcomeChannelId = channel.id;
  cfg.welcomeMessageId = existing.id;
  db.save();
  await existing.pin('LTT HELPER: keep language selection at the top').catch(() => {});
  return existing;
}

function languageCategoryOverwrites(guild, hiddenRole, russianRole, englishRole) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
    {
      id: russianRole.id,
      allow: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: englishRole.id,
      allow: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: hiddenRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
  ];
}

function languageVoiceOverwrites(guild, hiddenRole, languageRole) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
    {
      id: languageRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: hiddenRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
  ];

  if (guild.members.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    });
  }
  return overwrites;
}

async function ensureLanguageVoiceCategory(guild, hiddenRole, russianRole, englishRole) {
  let category = categoryByNames(guild, [LANGUAGE_VOICE_CATEGORY_NAME]);
  const permissionOverwrites = languageCategoryOverwrites(guild, hiddenRole, russianRole, englishRole);

  if (!category) {
    category = await guild.channels.create({
      name: LANGUAGE_VOICE_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: 'LTT HELPER: language-specific voice rooms',
    });
  } else {
    await category.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return category;
}

async function ensureLanguageVoiceChannel(guild, category, hiddenRole, languageRole, name) {
  let channel = channelByName(guild, name, [ChannelType.GuildVoice]);
  const permissionOverwrites = languageVoiceOverwrites(guild, hiddenRole, languageRole);

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites,
      reason: 'LTT HELPER: language-specific voice room',
    });
  } else {
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return channel;
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
    reason: 'LTT HELPER: member has Hidden role',
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
      reason: 'LTT HELPER: Hidden role removed; restore previous visibility',
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
    reason: 'LTT HELPER: Hidden role cannot view server channels',
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

async function handleLanguageInteraction(interaction) {
  if (!interaction.inGuild() || !interaction.isButton()) return false;
  const isRussian = interaction.customId === LANGUAGE_RU_BUTTON;
  const isEnglish = interaction.customId === LANGUAGE_EN_BUTTON;
  if (!isRussian && !isEnglish) return false;

  await interaction.guild.roles.fetch();
  const russianRole = await ensureLanguageRole(interaction.guild, RUSSIAN_ROLE_ALIASES, RUSSIAN_ROLE_NAME);
  const englishRole = await ensureLanguageRole(interaction.guild, ENGLISH_ROLE_ALIASES, ENGLISH_ROLE_NAME);
  const member = await interaction.guild.members.fetch(interaction.user.id);

  const selectedRole = isRussian ? russianRole : englishRole;
  const otherRole = isRussian ? englishRole : russianRole;

  if (member.roles.cache.has(otherRole.id)) {
    await member.roles.remove(otherRole, 'LTT HELPER: language changed');
  }
  if (!member.roles.cache.has(selectedRole.id)) {
    await member.roles.add(selectedRole, 'LTT HELPER: language selected');
  }

  await interaction.reply({
    content: isRussian
      ? '🇷🇺 Язык выбран: **Русский**. Вам открыт русский голосовой канал.'
      : '🇬🇧 Language selected: **English**. The English voice room is now available.',
    ephemeral: true,
  });
  return true;
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
    content: `👋 <@${member.id}> Welcome! / Добро пожаловать!\nChoose **Русский** or **English** using the buttons in the message above. / Выберите **Русский** или **English** кнопками в сообщении выше.`,
    allowedMentions: { users: [member.id] },
  }).catch(() => {});
}

async function ensureCommunityInfrastructure(guild, { supportChannelId = null } = {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const hiddenRole = await ensureHiddenRole(guild);
  const russianRole = await ensureLanguageRole(guild, RUSSIAN_ROLE_ALIASES, RUSSIAN_ROLE_NAME);
  const englishRole = await ensureLanguageRole(guild, ENGLISH_ROLE_ALIASES, ENGLISH_ROLE_NAME);

  const startHere = await ensureStartHereCategory(guild, hiddenRole);
  const welcome = await ensureReadOnlyChannel(
    guild,
    startHere,
    hiddenRole,
    WELCOME_CHANNEL_NAME,
    'Start here: choose Russian or English to receive the matching language role.',
  );
  const rules = await ensureReadOnlyChannel(
    guild,
    startHere,
    hiddenRole,
    RULES_CHANNEL_NAME,
    'Official Litematica Together server rules.',
  );
  const faq = await ensureReadOnlyChannel(
    guild,
    startHere,
    hiddenRole,
    FAQ_CHANNEL_NAME,
    'Frequently asked questions and support information.',
  );

  await welcome.setPosition(0).catch(() => {});
  await rules.setPosition(1).catch(() => {});
  await faq.setPosition(2).catch(() => {});

  await upsertWelcomeMessage(welcome);
  await upsertBotEmbed(rules, 'Server Rules', rulesPayload());
  await upsertBotEmbed(faq, 'Frequently Asked Questions', faqPayload(supportChannelId));

  const voiceCategory = await ensureLanguageVoiceCategory(
    guild,
    hiddenRole,
    russianRole,
    englishRole,
  );
  const russianVoice = await ensureLanguageVoiceChannel(
    guild,
    voiceCategory,
    hiddenRole,
    russianRole,
    'Русский',
  );
  const englishVoice = await ensureLanguageVoiceChannel(
    guild,
    voiceCategory,
    hiddenRole,
    englishRole,
    'English',
  );

  await russianVoice.setPosition(0).catch(() => {});
  await englishVoice.setPosition(1).catch(() => {});

  const cfg = db.guild(guild.id);
  Object.assign(cfg, {
    startHereCategoryId: startHere.id,
    welcomeChannelId: welcome.id,
    russianRoleId: russianRole.id,
    englishRoleId: englishRole.id,
    languageVoiceCategoryId: voiceCategory.id,
    russianVoiceChannelId: russianVoice.id,
    englishVoiceChannelId: englishVoice.id,
  });
  db.save();

  await applyHiddenRoleToAllChannels(guild, hiddenRole);
  await syncHiddenMembers(guild, hiddenRole);

  return {
    hiddenRole,
    russianRole,
    englishRole,
    startHere,
    welcome,
    rules,
    faq,
    voiceCategory,
    russianVoice,
    englishVoice,
  };
}

module.exports = {
  HIDDEN_ROLE_NAME,
  rulesPayload,
  faqPayload,
  welcomePayload,
  ensureCommunityInfrastructure,
  applyHiddenRoleToChannel,
  syncHiddenMemberRoleChange,
  handleLanguageInteraction,
  sendWelcomeNotification,
};
