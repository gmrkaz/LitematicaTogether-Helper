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
    category: 'LITEMATICA TOGETHER',
    oldCategories: ['LITEMATICA TOGETHER RU', 'LITEMATICA TOGETHER GB', 'PROJECT'],
    ru: [
      ['о-моде', 'Официальная информация о Litematica Together.', true, ['о-проекте']],
      ['обновления', 'Новости и новые версии Litematica Together.', true, []],
      ['дорожная-карта', 'Планы разработки Litematica Together.', true, []],
      ['известные-проблемы', 'Подтверждённые проблемы Litematica Together и обходные решения.', true, []],
      ['обсуждение', 'Обсуждение Litematica Together на русском языке.', false, []],
    ],
    gb: [
      ['about-mod', 'Official information about Litematica Together.', true, ['about-project']],
      ['updates', 'Litematica Together release news and updates.', true, []],
      ['roadmap', 'Litematica Together development roadmap.', true, []],
      ['known-issues', 'Confirmed Litematica Together issues and workarounds.', true, []],
      ['discussion', 'English discussion about Litematica Together.', false, []],
    ],
  },
  simpleTranslator: {
    key: 'simpleTranslator',
    name: 'Simple Translator',
    category: 'SIMPLE TRANSLATOR',
    oldCategories: ['SIMPLE TRANSLATOR RU', 'SIMPLE TRANSLATOR GB'],
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

const normalize = value => String(value || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

function roleByNames(guild, names) {
  const wanted = new Set(names.map(normalize));
  return guild.roles.cache.find(role => wanted.has(normalize(role.name)));
}

function categoryByName(guild, name) {
  const wanted = normalize(name);
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === wanted
  ));
}

function projectCategoryOverwrites(guild, russianRole, englishRole, hiddenRole) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: russianRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: englishRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (hiddenRole) overwrites.push({ id: hiddenRole.id, deny: [PermissionFlagsBits.ViewChannel] });
  if (guild.members.me?.id) overwrites.push({
    id: guild.members.me.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageChannels,
    ],
  });
  return overwrites;
}

function languageChannelOverwrites(guild, selectedRole, otherRole, hiddenRole, readOnly) {
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

  const overwrites = [
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
  if (hiddenRole) overwrites.push({
    id: hiddenRole.id,
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
  });
  if (guild.members.me?.id) overwrites.push({
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
  return overwrites;
}

async function ensureProjectCategory(guild, project, russianRole, englishRole, hiddenRole) {
  let category = categoryByName(guild, project.category);
  const permissionOverwrites = projectCategoryOverwrites(guild, russianRole, englishRole, hiddenRole);
  if (!category) {
    category = await guild.channels.create({
      name: project.category,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: `MODS HUB: create combined ${project.name} category`,
    });
  } else {
    await category.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return category;
}

function migrationParentIds(guild, project) {
  return project.oldCategories
    .map(name => categoryByName(guild, name)?.id)
    .filter(Boolean);
}

async function ensureProjectChannel(guild, project, category, spec, language, roles, oldParentIds) {
  const [name, topic, readOnly, aliases] = spec;
  const names = new Set([name, ...(aliases || [])].map(normalize));
  const selectedRole = language === 'ru' ? roles.russianRole : roles.englishRole;
  const otherRole = language === 'ru' ? roles.englishRole : roles.russianRole;

  let channel = guild.channels.cache.find(ch => (
    ch.type === ChannelType.GuildText
    && ch.parentId === category.id
    && names.has(normalize(ch.name))
  ));

  if (!channel) {
    channel = guild.channels.cache.find(ch => (
      ch.type === ChannelType.GuildText
      && oldParentIds.includes(ch.parentId)
      && names.has(normalize(ch.name))
    ));
    if (channel) {
      await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
      if (channel.name !== name) await channel.setName(name).catch(() => {});
    }
  }

  const permissionOverwrites = languageChannelOverwrites(
    guild, selectedRole, otherRole, roles.hiddenRole, readOnly,
  );

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      permissionOverwrites,
      reason: `MODS HUB: ${project.name}/${name}`,
    });
  } else {
    await channel.setTopic(topic).catch(() => {});
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return channel;
}

function aboutPayload(project, russian) {
  const simpleTranslator = project.key === 'simpleTranslator';
  const description = russian
    ? (simpleTranslator
      ? [
        '**Simple Translator** — мод для перевода в Minecraft.',
        '',
        'В этой категории русские и английские каналы находятся вместе. По языковой роли вы видите только нужный набор.',
        'Здесь находятся новости, дорожная карта, известные проблемы и обсуждение.',
        '',
        'Для технической помощи откройте **Support**, выберите **Simple Translator** и заполните форму.',
      ].join('\n')
      : [
        '**Litematica Together** — мод для совместной работы с размещениями Litematica и синхронизации строительства.',
        '',
        'В этой категории русские и английские каналы находятся вместе. По языковой роли вы видите только нужный набор.',
        'Здесь находятся новости, дорожная карта, известные проблемы и обсуждение.',
        '',
        'Для технической помощи откройте **Support**, выберите **Litematica Together** и заполните форму.',
      ].join('\n'))
    : (simpleTranslator
      ? [
        '**Simple Translator** is a Minecraft translation mod.',
        '',
        'Russian and English channels share this category; your language role controls which set you can see.',
        'This section contains releases, roadmap information, known issues and discussion.',
        '',
        'For technical help, open **Support**, choose **Simple Translator**, and complete the form.',
      ].join('\n')
      : [
        '**Litematica Together** focuses on collaborative Litematica placements and synchronized building.',
        '',
        'Russian and English channels share this category; your language role controls which set you can see.',
        'This section contains releases, roadmap information, known issues and discussion.',
        '',
        'For technical help, open **Support**, choose **Litematica Together**, and complete the form.',
      ].join('\n'));

  const marker = `MODS-HUB:${project.key === 'ltt' ? 'LTT' : 'ST'}:${russian ? 'RU' : 'GB'}:ABOUT-V2`;
  return {
    marker,
    payload: {
      embeds: [new EmbedBuilder()
        .setTitle(project.name)
        .setDescription(description)
        .setFooter({ text: marker })],
      allowedMentions: { parse: [] },
    },
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

async function ensureOneProject(guild, project, roles) {
  const category = await ensureProjectCategory(
    guild, project, roles.russianRole, roles.englishRole, roles.hiddenRole,
  );
  const oldParentIds = migrationParentIds(guild, project);
  const ru = {};
  const gb = {};

  for (const spec of project.ru) {
    ru[spec[0]] = await ensureProjectChannel(guild, project, category, spec, 'ru', roles, oldParentIds);
  }
  for (const spec of project.gb) {
    gb[spec[0]] = await ensureProjectChannel(guild, project, category, spec, 'gb', roles, oldParentIds);
  }

  const ruAbout = aboutPayload(project, true);
  const gbAbout = aboutPayload(project, false);
  await upsertMarker(ru['о-моде'], ruAbout.marker, ruAbout.payload);
  await upsertMarker(gb['about-mod'], gbAbout.marker, gbAbout.payload);
  return { category, ru, gb };
}

async function cleanupOldProjectCategories(guild) {
  for (const name of [
    'LITEMATICA TOGETHER RU',
    'LITEMATICA TOGETHER GB',
    'SIMPLE TRANSLATOR RU',
    'SIMPLE TRANSLATOR GB',
    'PROJECT',
  ]) {
    const category = categoryByName(guild, name);
    if (!category) continue;
    const children = guild.channels.cache.filter(ch => ch.parentId === category.id);
    if (!children.size) {
      await category.delete('MODS HUB: merged into one category per mod').catch(() => {});
    }
  }
}

function supportProjectPickerPayload() {
  return {
    content: '**Насчёт какого мода вопрос? / Which mod is your question about?**',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('support_open_ltt')
        .setLabel('Litematica Together')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('support_open_st')
        .setLabel('Simple Translator')
        .setStyle(ButtonStyle.Secondary),
    )],
    ephemeral: true,
    allowedMentions: { parse: [] },
  };
}

async function styleSupportPanel(guild) {
  const cfg = db.guild(guild.id);
  const support = cfg.supportChannelId ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null) : null;
  if (!support?.isTextBased()) return;
  const messages = await support.messages.fetch({ limit: 100 }).catch(() => null);
  const panels = messages?.filter(message => (
    message.author.id === guild.client.user.id
    && message.components.some(row => row.components.some(component => (
      ['support_open', 'support_open_ltt', 'support_open_st'].includes(component.customId)
    )))
  ));
  if (!panels?.size) return;
  const panel = [...panels.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
  await panel.edit({
    embeds: [new EmbedBuilder()
      .setTitle('Support / Поддержка')
      .setDescription([
        'Нажмите **Open Support Request** — затем выберите мод и заполните форму.',
        'Press **Open Support Request**, choose the mod, then complete the form.',
        '',
        'Форма попросит тему вопроса, версии, сам вопрос, срочность и дополнительный контекст.',
        'The form asks for the topic, versions, the actual question, urgency and extra context.',
        '',
        'One open ticket per user.',
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('support_open')
        .setLabel('Open Support Request')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('donate_show')
        .setLabel('Donate')
        .setStyle(ButtonStyle.Success),
    )],
  }).catch(() => {});
}

function projectSupportModal(projectKey) {
  const project = projectKey === 'simpleTranslator' ? PROJECTS.simpleTranslator : PROJECTS.ltt;
  const modal = new ModalBuilder()
    .setCustomId('support_modal')
    .setTitle(`${project.name} Support`);

  const fields = [
    ['topic', 'Смысл вопроса / Topic', TextInputStyle.Short, 'Bug / установка / совместимость / предложение...', true],
    ['versions', 'Версии / Versions', TextInputStyle.Short, 'Minecraft, mod, loader, dependencies', true],
    ['problem', 'Сам вопрос / Your question', TextInputStyle.Paragraph, 'Опишите вопрос или проблему подробно.', true],
    ['tried', 'Срочность + что пробовали / Urgency', TextInputStyle.Paragraph, 'Low / Normal / High / Critical — и что уже пробовали', true],
    ['extra', 'Дополнительно / Extra', TextInputStyle.Paragraph, 'Логи, ошибки, шаги воспроизведения, другая информация.', false],
  ];

  for (const [id, label, style, placeholder, required] of fields) {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setPlaceholder(placeholder)
      .setRequired(required)
      .setMaxLength(style === TextInputStyle.Short ? 200 : 1000);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

async function refreshProjectsOverview(guild, hiddenRole) {
  const startHere = categoryByName(guild, 'START HERE');
  if (!startHere) return;
  const channel = guild.channels.cache.find(ch => (
    ch.type === ChannelType.GuildText && ch.parentId === startHere.id && ch.name === 'projects'
  ));
  if (!channel?.isTextBased()) return;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const existing = messages?.find(message => (
    message.author.id === guild.client.user.id
    && message.embeds.some(embed => embed.footer?.text === 'MODS-HUB:PROJECTS')
  ));
  const payload = {
    embeds: [new EmbedBuilder()
      .setTitle('Our Mods / Наши моды')
      .setDescription([
        '🧱 **Litematica Together**',
        '🌐 **Simple Translator**',
        '',
        'У каждого мода теперь **одна категория**, внутри которой находятся русские и английские каналы.',
        'Each mod now has **one category** containing both Russian and English channels.',
        '',
        'Языковая роль определяет, какой набор каналов вы видите.',
        'Your language role controls which channel set you can see.',
      ].join('\n'))
      .setFooter({ text: 'MODS-HUB:PROJECTS' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Litematica Together')
        .setStyle(ButtonStyle.Link)
        .setURL('https://modrinth.com/mod/litematica-together'),
    )],
    allowedMentions: { parse: [] },
  };
  if (existing) await existing.edit(payload).catch(() => {});
  else await channel.send(payload).catch(() => {});
}

async function ensureProjectInfrastructure(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = {
    russianRole: roleByNames(guild, ['Русский', 'Russian']),
    englishRole: roleByNames(guild, ['English']),
    hiddenRole: roleByNames(guild, ['Hidden']),
  };
  if (!roles.russianRole || !roles.englishRole) {
    console.warn(`[PROJECT LAYOUT] ${guild.name}: language roles are missing.`);
    return null;
  }

  const ltt = await ensureOneProject(guild, PROJECTS.ltt, roles);
  const simpleTranslator = await ensureOneProject(guild, PROJECTS.simpleTranslator, roles);

  await cleanupOldProjectCategories(guild);
  await styleSupportPanel(guild);
  await refreshProjectsOverview(guild, roles.hiddenRole);

  const cfg = db.guild(guild.id);
  cfg.lttCategoryId = ltt.category.id;
  cfg.simpleTranslatorCategoryId = simpleTranslator.category.id;
  cfg.lttRuUpdatesChannelId = ltt.ru['обновления'].id;
  cfg.lttGbUpdatesChannelId = ltt.gb.updates.id;
  cfg.simpleTranslatorRuUpdatesChannelId = simpleTranslator.ru['обновления'].id;
  cfg.simpleTranslatorGbUpdatesChannelId = simpleTranslator.gb.updates.id;

  delete cfg.lttRuCategoryId;
  delete cfg.lttGbCategoryId;
  delete cfg.simpleTranslatorRuCategoryId;
  delete cfg.simpleTranslatorGbCategoryId;
  db.save();

  console.log(`[PROJECT LAYOUT] ${guild.name}: combined LITEMATICA TOGETHER + SIMPLE TRANSLATOR categories ready.`);
  return { ltt, simpleTranslator };
}

module.exports = {
  PROJECTS,
  ensureProjectInfrastructure,
  projectSupportModal,
  styleSupportPanel,
  supportProjectPickerPayload,
};
