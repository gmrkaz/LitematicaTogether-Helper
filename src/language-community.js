'use strict';

const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('./db');

const RU_CATEGORY = 'COMMUNITY RU';
const GB_CATEGORY = 'COMMUNITY GB';

const RU_CHANNELS = [
  ['правила', 'Официальные правила сервера на русском языке.', true],
  ['общий', 'Общий чат русскоязычного сообщества Litematica Together.', false],
  ['вопросы', 'Вопросы, помощь и обсуждение проблем на русском языке.', false],
  ['медиа', 'Скриншоты, видео и другой контент сообщества.', false],
  ['предложения', 'Идеи и предложения для Litematica Together и Discord-сервера.', false],
];

const GB_CHANNELS = [
  ['rules', 'Official Litematica Together server rules in English.', true],
  ['general', 'General chat for the English-speaking Litematica Together community.', false],
  ['questions', 'Questions, help and troubleshooting discussion in English.', false],
  ['media', 'Screenshots, videos and other community content.', false],
  ['suggestions', 'Ideas and suggestions for Litematica Together and the Discord server.', false],
];

function roleByNames(guild, names) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  return guild.roles.cache.find(role => wanted.has(role.name.toLowerCase()));
}

function normalize(name) {
  return String(name || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryByName(guild, name) {
  const wanted = normalize(name);
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === wanted
  ));
}

function categoryOverwrites(guild, selectedRole, otherRole, hiddenRole) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: selectedRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    },
    { id: otherRole.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];
  if (hiddenRole) overwrites.push({ id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel] });
  if (guild.members.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }
  return overwrites;
}

function channelOverwrites(guild, selectedRole, otherRole, hiddenRole, readOnly) {
  const selectedAllow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  if (!readOnly) {
    selectedAllow.push(
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
    );
  }

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    },
    {
      id: selectedRole.id,
      allow: selectedAllow,
      deny: readOnly
        ? [
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.SendMessagesInThreads,
          PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.CreatePrivateThreads,
        ]
        : [],
    },
    {
      id: otherRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    },
  ];

  if (hiddenRole) {
    overwrites.push({
      id: hiddenRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
  }

  if (guild.members.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }
  return overwrites;
}

async function ensureCategory(guild, name, selectedRole, otherRole, hiddenRole) {
  let category = categoryByName(guild, name);
  const permissionOverwrites = categoryOverwrites(guild, selectedRole, otherRole, hiddenRole);
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: `LTT HELPER: create ${name}`,
    });
  } else {
    await category.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return category;
}

function isManagedLegacy(channel, language) {
  const topic = String(channel.topic || '');
  if (language === 'ru') {
    return [
      'Правила сервера на русском языке.',
      'Частые вопросы и помощь на русском языке.',
    ].includes(topic);
  }
  return [
    'Official Litematica Together server rules.',
    'Frequently asked questions and support information.',
  ].includes(topic);
}

async function migrateOrCreateChannel(
  guild,
  category,
  selectedRole,
  otherRole,
  hiddenRole,
  name,
  topic,
  readOnly,
  aliases = [],
  language,
) {
  const names = new Set([name, ...aliases].map(value => value.toLowerCase()));
  let channel = guild.channels.cache.find(ch => (
    ch.type === ChannelType.GuildText
    && ch.parentId === category.id
    && names.has(ch.name.toLowerCase())
  ));

  const legacy = [...guild.channels.cache.values()].filter(ch => (
    ch.type === ChannelType.GuildText
    && ch.parentId !== category.id
    && names.has(ch.name.toLowerCase())
  ));

  if (!channel && legacy.length) {
    channel = legacy.shift();
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
    if (channel.name !== name) await channel.setName(name).catch(() => {});
  }

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      permissionOverwrites: channelOverwrites(
        guild, selectedRole, otherRole, hiddenRole, readOnly,
      ),
      reason: `LTT HELPER: ${category.name}/${name}`,
    });
  } else {
    await channel.setTopic(topic).catch(() => {});
    await channel.permissionOverwrites.set(
      channelOverwrites(guild, selectedRole, otherRole, hiddenRole, readOnly),
    ).catch(() => {});
  }

  for (const duplicate of legacy) {
    if (isManagedLegacy(duplicate, language)) {
      await duplicate.delete('LTT HELPER: migrated to separated language community').catch(() => {});
    }
  }
  return channel;
}

function ruRulesPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Правила сервера')
      .setDescription([
        'Короткая версия: поддерживаем сервер чистым и стараемся общаться по теме проекта.',
        '',
        '1. **Без политики, религии и конфликтного IRL-оффтопа.** Не начинайте темы, которые не относятся к серверу и легко приводят к драме.',
        '2. **Без мем-спама и жёсткого/шокирующего контента.** Не превращайте сервер в помойку, требующую постоянной модерации.',
        '3. **Уважайте участников.** Не оскорбляйте, не унижайте и не атакуйте людей за их личность, мнение или интересы.',
        '4. **Пишите по теме канала.** Вопросы, предложения, медиа и обычное общение должны идти в соответствующие разделы.',
        '5. **Не мешайте работе проекта.** Спам, рейды, намеренная дезинформация, вредоносные файлы и попытки обхода модерации запрещены.',
        '',
        'Если модератор просит прекратить конфликт или перенести обсуждение — выполните просьбу.',
      ].join('\n'))
      .setFooter({ text: 'LTT-COMMUNITY-RU:RULES' })],
    allowedMentions: { parse: [] },
  };
}

function gbRulesPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Server Rules')
      .setDescription([
        'Simple version: keep the server clean, respectful and on topic.',
        '',
        '1. **No politics, religion or conflict-heavy IRL topics.** Avoid subjects unrelated to the server that are likely to create drama.',
        '2. **No meme spam or disturbing/edgy content.** Do not turn the server into something that requires constant moderation.',
        '3. **Respect other members.** Do not insult, harass or judge people for who they are, what they think or what they enjoy.',
        '4. **Use the correct channel.** Questions, suggestions, media and general discussion belong in their relevant channels.',
        '5. **Do not disrupt the project or community.** Spam, raids, deliberate misinformation, malicious files and moderation evasion are prohibited.',
        '',
        'If a moderator asks you to stop a conflict or move a discussion, please follow that request.',
      ].join('\n'))
      .setFooter({ text: 'LTT-COMMUNITY-GB:RULES' })],
    allowedMentions: { parse: [] },
  };
}

async function upsertRules(channel, marker, payload) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const existing = messages?.find(message => (
    message.author.id === channel.client.user.id
    && message.embeds.some(embed => embed.footer?.text === marker || embed.title === payload.embeds[0].data.title)
  ));
  const message = existing
    ? await existing.edit(payload).catch(() => existing)
    : await channel.send(payload);
  await message?.pin('LTT HELPER: keep language rules visible').catch(() => {});
}

async function ensureLanguageCommunity(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const russianRole = roleByNames(guild, ['Русский', 'Russian']);
  const englishRole = roleByNames(guild, ['English']);
  if (!russianRole || !englishRole) {
    console.warn(`[LANG COMMUNITY] ${guild.name}: language roles are missing.`);
    return null;
  }
  const hiddenRole = roleByNames(guild, ['Hidden']);

  const ruCategory = await ensureCategory(guild, RU_CATEGORY, russianRole, englishRole, hiddenRole);
  const gbCategory = await ensureCategory(guild, GB_CATEGORY, englishRole, russianRole, hiddenRole);

  const ru = {};
  for (const [name, topic, readOnly] of RU_CHANNELS) {
    const aliases = name === 'вопросы' ? ['faq'] : [];
    ru[name] = await migrateOrCreateChannel(
      guild, ruCategory, russianRole, englishRole, hiddenRole,
      name, topic, readOnly, aliases, 'ru',
    );
  }

  const gb = {};
  for (const [name, topic, readOnly] of GB_CHANNELS) {
    const aliases = name === 'questions' ? ['faq'] : [];
    gb[name] = await migrateOrCreateChannel(
      guild, gbCategory, englishRole, russianRole, hiddenRole,
      name, topic, readOnly, aliases, 'gb',
    );
  }

  await upsertRules(ru['правила'], 'LTT-COMMUNITY-RU:RULES', ruRulesPayload());
  await upsertRules(gb.rules, 'LTT-COMMUNITY-GB:RULES', gbRulesPayload());

  const cfg = db.guild(guild.id);
  cfg.communityRuCategoryId = ruCategory.id;
  cfg.communityGbCategoryId = gbCategory.id;
  cfg.communityRuChannelIds = Object.fromEntries(Object.entries(ru).map(([key, ch]) => [key, ch.id]));
  cfg.communityGbChannelIds = Object.fromEntries(Object.entries(gb).map(([key, ch]) => [key, ch.id]));
  db.save();

  console.log(`[LANG COMMUNITY] ${guild.name}: COMMUNITY RU and COMMUNITY GB ready.`);
  return { ruCategory, gbCategory, ru, gb };
}

module.exports = {
  RU_CATEGORY,
  GB_CATEGORY,
  RU_CHANNELS,
  GB_CHANNELS,
  ensureLanguageCommunity,
};
