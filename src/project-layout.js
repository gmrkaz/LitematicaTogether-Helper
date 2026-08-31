'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('./db');

const PROJECTS = {
  ltt: {
    key: 'ltt',
    name: 'Litematica Together',
    ruCategory: 'LITEMATICA TOGETHER RU',
    gbCategory: 'LITEMATICA TOGETHER GB',
    ru: [
      ['о-моде', 'Официальная информация о Litematica Together.', true, ['о-проекте']],
      ['обновления', 'Новости и новые версии Litematica Together.', true, ['обновления']],
      ['дорожная-карта', 'Планы разработки Litematica Together.', true, ['дорожная-карта']],
      ['известные-проблемы', 'Подтверждённые проблемы Litematica Together и обходные решения.', true, ['известные-проблемы']],
      ['обсуждение', 'Обсуждение Litematica Together на русском языке.', false, []],
    ],
    gb: [
      ['about-mod', 'Official information about Litematica Together.', true, ['about-project']],
      ['updates', 'Litematica Together release news and updates.', true, ['updates']],
      ['roadmap', 'Litematica Together development roadmap.', true, ['roadmap']],
      ['known-issues', 'Confirmed Litematica Together issues and workarounds.', true, ['known-issues']],
      ['discussion', 'English discussion about Litematica Together.', false, []],
    ],
  },
  simpleTranslator: {
    key: 'simpleTranslator',
    name: 'Simple Translator',
    ruCategory: 'SIMPLE TRANSLATOR RU',
    gbCategory: 'SIMPLE TRANSLATOR GB',
    ru: [
      ['о-моде', 'Официальная информация о Simple Translator.', true, []],
      ['обновления', 'Новости и новые версии Simple Translator.', true, []],
      ['дорожная-карта', 'Планы разработки Simple Translator.', true, []],
      ['известные-проблемы', 'Подтверждённые проблемы Simple Translator и обходные решения.', true, []],
      ['обсуждение', 'Обсуждение Simple Translator на русском языке.', false, []],
    ],
    gb: [
      ['about-mod', 'Official information about Simple Translator.', true, []],
      ['updates', 'Simple Translator release news and updates.', true, []],
      ['roadmap', 'Simple Translator development roadmap.', true, []],
      ['known-issues', 'Confirmed Simple Translator issues and workarounds.', true, []],
      ['discussion', 'English discussion about Simple Translator.', false, []],
    ],
  },
};

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function roleByNames(guild, names) {
  const wanted = new Set(names.map(normalize));
  return guild.roles.cache.find(role => wanted.has(normalize(role.name)));
}

function categoryByName(guild, name) {
  const wanted = normalize(name);
  return guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && normalize(ch.name) === wanted);
}

function categoryOverwrites(guild, selectedRole, otherRole, hiddenRole) {
  const result = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: selectedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: otherRole.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];
  if (hiddenRole) result.push({ id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel] });
  if (guild.members.me?.id) result.push({
    id: guild.members.me.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
  });
  return result;
}

function channelOverwrites(guild, selectedRole, otherRole, hiddenRole, readOnly) {
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  if (!readOnly) allow.push(
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  );

  const result = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    {
      id: selectedRole.id,
      allow,
      deny: readOnly ? [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ] : [],
    },
    { id: otherRole.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ];
  if (hiddenRole) result.push({ id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  if (guild.members.me?.id) result.push({
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
  return result;
}

async function ensureCategory(guild, name, selectedRole, otherRole, hiddenRole) {
  let category = categoryByName(guild, name);
  const permissionOverwrites = categoryOverwrites(guild, selectedRole, otherRole, hiddenRole);
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: `MODS HUB: create ${name}`,
    });
  } else {
    await category.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return category;
}

async function ensureProjectChannel(guild, category, selectedRole, otherRole, hiddenRole, spec) {
  const [name, topic, readOnly, aliases] = spec;
  const names = new Set([name, ...(aliases || [])].map(normalize));

  let channel = guild.channels.cache.find(ch => (
    ch.type === ChannelType.GuildText && ch.parentId === category.id && names.has(normalize(ch.name))
  ));

  if (!channel && aliases?.length) {
    channel = guild.channels.cache.find(ch => (
      ch.type === ChannelType.GuildText
      && ch.parentId !== category.id
      && names.has(normalize(ch.name))
      && !['COMMUNITY RU', 'COMMUNITY GB'].includes(ch.parent?.name)
    ));
    if (channel) {
      await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
      if (channel.name !== name) await channel.setName(name).catch(() => {});
    }
  }

  const permissionOverwrites = channelOverwrites(guild, selectedRole, otherRole, hiddenRole, readOnly);
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      permissionOverwrites,
      reason: `MODS HUB: ${category.name}/${name}`,
    });
  } else {
    await channel.setTopic(topic).catch(() => {});
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return channel;
}

function projectInfoPayload(project, russian) {
  if (project.key === 'ltt') {
    return {
      embeds: [new EmbedBuilder()
        .setTitle('Litematica Together')
        .setDescription(russian
          ? [
            '**Litematica Together** — мод для совместной работы с размещениями Litematica и синхронизации строительства между игроками.',
            '',
            'В этом разделе находятся новости, дорожная карта, известные проблемы и отдельное обсуждение мода.',
            '',
            'Если нужна техническая помощь, используйте общий **Support** и выберите **Litematica Together**.',
          ].join('\n')
          : [
            '**Litematica Together** is a mod focused on collaborative Litematica placements and synchronized building between players.',
            '',
            'This section contains releases, roadmap information, known issues and dedicated discussion.',
            '',
            'For technical help, use the shared **Support** panel and choose **Litematica Together**.',
          ].join('\n'))
        .setFooter({ text: russian ? 'MODS-HUB:LTT:RU:ABOUT' : 'MODS-HUB:LTT:GB:ABOUT' })],
      allowedMentions: { parse: [] },
    };
  }

  return {
    embeds: [new EmbedBuilder()
      .setTitle('Simple Translator')
      .setDescription(russian
        ? [
          '**Simple Translator** — второй мод этого сообщества, посвящённый удобному переводу текста в Minecraft.',
          '',
          'Здесь будут публиковаться его новости, дорожная карта, известные проблемы и обсуждение.',
          '',
          'Если нужна техническая помощь, используйте общий **Support** и выберите **Simple Translator**.',
        ].join('\n')
        : [
          '**Simple Translator** is the second mod supported by this community, focused on convenient text translation in Minecraft.',
          '',
          'This section contains its releases, roadmap, known issues and dedicated discussion.',
          '',
          'For technical help, use the shared **Support** panel and choose **Simple Translator**.',
        ].join('\n'))
      .setFooter({ text: russian ? 'MODS-HUB:ST:RU:ABOUT' : 'MODS-HUB:ST:GB:ABOUT' })],
    allowedMentions: { parse: [] },
  };
}

async function upsertMarker(channel, marker, payload) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const existing = messages?.find(message => (
    message.author.id === channel.client.user.id
    && message.embeds.some(embed => embed.footer?.text === marker)
  ));
  if (existing) return existing.edit(payload).catch(() => existing);
  return channel.send(payload);
}

async function ensureProjectBranch(guild, project, language, selectedRole, otherRole, hiddenRole) {
  const russian = language === 'ru';
  const category = await ensureCategory(
    guild,
    russian ? project.ruCategory : project.gbCategory,
    selectedRole,
    otherRole,
    hiddenRole,
  );
  const specs = russian ? project.ru : project.gb;
  const channels = {};
  for (const spec of specs) {
    channels[spec[0]] = await ensureProjectChannel(
      guild, category, selectedRole, otherRole, hiddenRole, spec,
    );
  }
  const aboutName = russian ? 'о-моде' : 'about-mod';
  const marker = project.key === 'ltt'
    ? (russian ? 'MODS-HUB:LTT:RU:ABOUT' : 'MODS-HUB:LTT:GB:ABOUT')
    : (russian ? 'MODS-HUB:ST:RU:ABOUT' : 'MODS-HUB:ST:GB:ABOUT');
  await upsertMarker(channels[aboutName], marker, projectInfoPayload(project, russian));
  return { category, channels };
}

function sharedReadOnlyOverwrites(guild, hiddenRole) {
  const result = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages],
  }];
  if (hiddenRole) result.push({ id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel] });
  if (guild.members.me?.id) result.push({
    id: guild.members.me.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
  });
  return result;
}

async function ensureProjectsOverview(guild, hiddenRole) {
  let startHere = categoryByName(guild, 'START HERE');
  if (!startHere) {
    startHere = await guild.channels.create({ name: 'START HERE', type: ChannelType.GuildCategory, reason: 'MODS HUB: start category' });
  }
  let channel = guild.channels.cache.find(ch => ch.parentId === startHere.id && ch.type === ChannelType.GuildText && ch.name === 'projects');
  if (!channel) {
    channel = await guild.channels.create({
      name: 'projects',
      type: ChannelType.GuildText,
      parent: startHere.id,
      topic: 'Projects supported by this Discord server.',
      permissionOverwrites: sharedReadOnlyOverwrites(guild, hiddenRole),
      reason: 'MODS HUB: project overview',
    });
  } else {
    await channel.permissionOverwrites.set(sharedReadOnlyOverwrites(guild, hiddenRole)).catch(() => {});
  }

  const payload = {
    embeds: [new EmbedBuilder()
      .setTitle('Our Mods / Наши моды')
      .setDescription([
        'Этот Discord теперь является общим сообществом для **двух модов**.',
        'This Discord is the shared community for **two mods**.',
        '',
        '🧱 **Litematica Together** — collaborative Litematica building and synchronization.',
        '🌐 **Simple Translator** — convenient text translation in Minecraft.',
        '',
        'После выбора языка в Discord Onboarding вы увидите соответствующие **RU** или **GB** разделы обоих проектов.',
        'After choosing a language in Discord Onboarding, you will see the matching **RU** or **GB** sections for both projects.',
      ].join('\n'))
      .setFooter({ text: 'MODS-HUB:PROJECTS' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Litematica Together').setStyle(ButtonStyle.Link).setURL('https://modrinth.com/mod/litematica-together'),
    )],
    allowedMentions: { parse: [] },
  };
  await upsertMarker(channel, 'MODS-HUB:PROJECTS', payload);
  return channel;
}

async function refreshWelcome(guild) {
  const welcome = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.name === 'welcome');
  if (!welcome) return;
  const messages = await welcome.messages.fetch({ limit: 100 }).catch(() => null);
  const existing = messages?.find(message => message.author.id === guild.client.user.id && message.embeds.length);
  if (!existing) return;
  await existing.edit({
    embeds: [new EmbedBuilder()
      .setTitle('Welcome / Добро пожаловать')
      .setDescription([
        'Welcome to the official community for **Litematica Together** and **Simple Translator**.',
        'Добро пожаловать в официальное сообщество **Litematica Together** и **Simple Translator**.',
        '',
        'Choose **Русский** or **English** in Discord Onboarding. Your language role controls which community and project sections you see.',
        'Выберите **Русский** или **English** во встроенном Discord Onboarding. Языковая роль определяет, какие разделы сообщества и проектов вы видите.',
        '',
        'Start with **#projects**, then use the section for the mod you need.',
        'Начните с **#projects**, затем откройте раздел нужного мода.',
      ].join('\n'))],
    components: [],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function refreshCommunityText(guild) {
  const updates = {
    'COMMUNITY RU': {
      общий: 'Общий чат русскоязычного сообщества Litematica Together и Simple Translator.',
      вопросы: 'Общие вопросы о сервере и двух модах. Для технической поддержки используйте Support.',
      медиа: 'Скриншоты, видео и другой контент сообщества обоих модов.',
      предложения: 'Идеи и предложения для Litematica Together, Simple Translator и Discord-сервера.',
    },
    'COMMUNITY GB': {
      general: 'General chat for the Litematica Together and Simple Translator community.',
      questions: 'General questions about the server and both mods. Use Support for technical help.',
      media: 'Screenshots, videos and community content for both mods.',
      suggestions: 'Ideas and suggestions for Litematica Together, Simple Translator and this Discord server.',
    },
  };
  for (const [categoryName, topics] of Object.entries(updates)) {
    const category = categoryByName(guild, categoryName);
    if (!category) continue;
    for (const [channelName, topic] of Object.entries(topics)) {
      const channel = guild.channels.cache.find(ch => ch.parentId === category.id && ch.name === channelName);
      if (channel?.type === ChannelType.GuildText) await channel.setTopic(topic).catch(() => {});
    }
  }
}

async function refreshRules(guild) {
  const defs = [
    {
      category: 'COMMUNITY RU',
      channel: 'правила',
      marker: 'LTT-COMMUNITY-RU:RULES',
      title: 'Правила сервера',
      lines: [
        'Короткая версия: поддерживаем сервер чистым, уважительным и по теме **Litematica Together** и **Simple Translator**.',
        '',
        '1. **Без политики, религии и конфликтного IRL-оффтопа.**',
        '2. **Без мем-спама, шокирующего и намеренно провокационного контента.**',
        '3. **Уважайте участников.** Оскорбления, травля и личные нападки запрещены.',
        '4. **Пишите по теме канала и проекта.** Для каждого мода есть отдельные разделы.',
        '5. **Не мешайте работе проектов и сервера.** Спам, рейды, вредоносные файлы, намеренная дезинформация и обход модерации запрещены.',
        '',
        'Если модератор просит прекратить конфликт или перенести обсуждение — выполните просьбу.',
      ],
    },
    {
      category: 'COMMUNITY GB',
      channel: 'rules',
      marker: 'LTT-COMMUNITY-GB:RULES',
      title: 'Server Rules',
      lines: [
        'Simple version: keep the server clean, respectful and on topic for **Litematica Together** and **Simple Translator**.',
        '',
        '1. **No politics, religion or conflict-heavy IRL topics.**',
        '2. **No meme spam, shocking content or deliberate provocation.**',
        '3. **Respect other members.** Harassment, insults and personal attacks are prohibited.',
        '4. **Use the correct channel and project section.** Each mod has its own area.',
        '5. **Do not disrupt the projects or server.** Spam, raids, malicious files, deliberate misinformation and moderation evasion are prohibited.',
        '',
        'If a moderator asks you to stop a conflict or move a discussion, follow that request.',
      ],
    },
  ];

  for (const def of defs) {
    const category = categoryByName(guild, def.category);
    const channel = category && guild.channels.cache.find(ch => ch.parentId === category.id && ch.name === def.channel);
    if (!channel?.isTextBased()) continue;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const existing = messages?.find(message => message.author.id === guild.client.user.id && message.embeds.some(embed => embed.footer?.text === def.marker));
    if (!existing) continue;
    await existing.edit({
      embeds: [new EmbedBuilder().setTitle(def.title).setDescription(def.lines.join('\n')).setFooter({ text: def.marker })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
}

async function cleanupOldRussianMirror(guild) {
  const topics = new Set([
    'Русская версия приветствия и основной информации.',
    'Официальные объявления проекта на русском языке.',
    'Ссылки на загрузку Litematica Together на русском языке.',
  ]);
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    if (!topics.has(String(channel.topic || ''))) continue;
    await channel.delete('MODS HUB: remove obsolete single-project Russian mirror').catch(() => {});
  }
}

async function cleanupLegacyProjectCategory(guild) {
  const old = categoryByName(guild, 'PROJECT');
  if (!old) return;
  const children = guild.channels.cache.filter(ch => ch.parentId === old.id);
  if (!children.size) await old.delete('MODS HUB: replaced by per-mod project categories').catch(() => {});
}

async function styleSupportPanel(guild) {
  const cfg = db.guild(guild.id);
  const support = cfg.supportChannelId ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null) : null;
  if (!support?.isTextBased()) return;
  const messages = await support.messages.fetch({ limit: 100 }).catch(() => null);
  const panels = messages?.filter(message => (
    message.author.id === guild.client.user.id
    && message.components.some(row => row.components.some(button => ['support_open', 'support_open_ltt', 'support_open_st'].includes(button.customId)))
  ));
  if (!panels?.size) return;
  const panel = [...panels.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
  await panel.edit({
    embeds: [new EmbedBuilder()
      .setTitle('Project Support / Поддержка проектов')
      .setDescription([
        'Choose the mod you need help with. / Выберите мод, с которым нужна помощь.',
        '',
        '🧱 **Litematica Together** — synchronization, placements, connection, compatibility and bugs.',
        '🌐 **Simple Translator** — translation, configuration, compatibility and bugs.',
        '',
        'One open ticket per user.',
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('support_open_ltt').setLabel('Litematica Together').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('support_open_st').setLabel('Simple Translator').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('donate_show').setLabel('Donate').setStyle(ButtonStyle.Success),
    )],
  }).catch(() => {});
}

function projectSupportModal(projectKey) {
  const project = projectKey === 'simpleTranslator' ? PROJECTS.simpleTranslator : PROJECTS.ltt;
  const modal = new ModalBuilder().setCustomId('support_modal').setTitle(`${project.name} Support`);
  const fields = [
    ['topic', 'Project / topic', TextInputStyle.Short, `${project.name} — Bug / Question / Install`, true, `${project.name} — `],
    ['versions', 'Versions', TextInputStyle.Short, 'Mod, Minecraft, loader and dependencies', true, null],
    ['problem', 'What happened?', TextInputStyle.Paragraph, 'Describe the issue and expected result.', true, null],
    ['tried', 'What have you already tried?', TextInputStyle.Paragraph, 'Steps tried or reproduction steps.', false, null],
    ['extra', 'Extra information', TextInputStyle.Paragraph, 'Attach logs/screenshots after creation.', false, null],
  ];
  for (const [id, label, style, placeholder, required, value] of fields) {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setPlaceholder(placeholder)
      .setRequired(required)
      .setMaxLength(style === TextInputStyle.Short ? 200 : 1000);
    if (value) input.setValue(value);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

async function ensureProjectInfrastructure(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const russianRole = roleByNames(guild, ['Русский', 'Russian']);
  const englishRole = roleByNames(guild, ['English']);
  const hiddenRole = roleByNames(guild, ['Hidden']);
  if (!russianRole || !englishRole) {
    console.warn(`[PROJECT LAYOUT] ${guild.name}: language roles are missing.`);
    return null;
  }

  const lttRu = await ensureProjectBranch(guild, PROJECTS.ltt, 'ru', russianRole, englishRole, hiddenRole);
  const lttGb = await ensureProjectBranch(guild, PROJECTS.ltt, 'gb', englishRole, russianRole, hiddenRole);
  const stRu = await ensureProjectBranch(guild, PROJECTS.simpleTranslator, 'ru', russianRole, englishRole, hiddenRole);
  const stGb = await ensureProjectBranch(guild, PROJECTS.simpleTranslator, 'gb', englishRole, russianRole, hiddenRole);

  await ensureProjectsOverview(guild, hiddenRole);
  await refreshWelcome(guild);
  await refreshCommunityText(guild);
  await refreshRules(guild);
  await cleanupOldRussianMirror(guild);
  await cleanupLegacyProjectCategory(guild);
  await styleSupportPanel(guild);

  const cfg = db.guild(guild.id);
  cfg.lttRuUpdatesChannelId = lttRu.channels['обновления'].id;
  cfg.lttGbUpdatesChannelId = lttGb.channels.updates.id;
  cfg.simpleTranslatorRuUpdatesChannelId = stRu.channels['обновления'].id;
  cfg.simpleTranslatorGbUpdatesChannelId = stGb.channels.updates.id;
  cfg.lttRuCategoryId = lttRu.category.id;
  cfg.lttGbCategoryId = lttGb.category.id;
  cfg.simpleTranslatorRuCategoryId = stRu.category.id;
  cfg.simpleTranslatorGbCategoryId = stGb.category.id;
  db.save();

  console.log(`[PROJECT LAYOUT] ${guild.name}: Litematica Together + Simple Translator RU/GB ready.`);
  return { lttRu, lttGb, stRu, stGb };
}

module.exports = {
  PROJECTS,
  ensureProjectInfrastructure,
  projectSupportModal,
  styleSupportPanel,
};
