'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

const MODRINTH_URL = 'https://modrinth.com/mod/litematica-together';
const HELPER_GITHUB_URL = 'https://github.com/gmrkaz/LitematicaTogether-Helper';

const START_HERE_CHANNELS = [
  ['приветствие', 'Русская версия приветствия и основной информации.'],
  ['правила', 'Правила сервера на русском языке.'],
  ['вопросы', 'Частые вопросы и помощь на русском языке.'],
  ['объявления', 'Официальные объявления проекта на русском языке.'],
  ['загрузки', 'Ссылки на загрузку Litematica Together на русском языке.'],
];

const PROJECT_CHANNELS = [
  ['о-проекте', 'Информация о Litematica Together на русском языке.'],
  ['обновления', 'Автоматические новости о новых версиях Litematica Together.'],
  ['дорожная-карта', 'Дорожная карта и планы проекта на русском языке.'],
  ['известные-проблемы', 'Известные проблемы и обходные решения на русском языке.'],
  ['github-ru', 'GitHub и исходный код инфраструктуры проекта.'],
];

const roleByNames = (guild, names) => guild.roles.cache.find(role => (
  names.some(name => role.name.toLowerCase() === name.toLowerCase())
));

function normalize(name) {
  return String(name || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryByName(guild, wanted) {
  const key = normalize(wanted);
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === key
  ));
}

async function ensureCategory(guild, name) {
  let category = categoryByName(guild, name);
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      reason: 'LTT HELPER: Russian channel infrastructure',
    });
  }
  return category;
}

function russianOverwrites(guild, russianRole, hiddenRole) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    },
    {
      id: russianRole.id,
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
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }
  return overwrites;
}

async function ensureRussianChannel(guild, category, russianRole, hiddenRole, name, topic) {
  let channel = guild.channels.cache.find(ch => (
    ch.type === ChannelType.GuildText && ch.parentId === category.id && ch.name === name
  ));

  const permissionOverwrites = russianOverwrites(guild, russianRole, hiddenRole);
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      permissionOverwrites,
      reason: 'LTT HELPER: Russian mirror channel',
    });
  } else {
    await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
    await channel.setTopic(topic).catch(() => {});
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return channel;
}

async function upsert(channel, marker, payload) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const existing = recent?.find(message => (
    message.author.id === channel.client.user.id
    && message.embeds.some(embed => embed.footer?.text === marker)
  ));

  if (existing) {
    await existing.edit(payload).catch(() => {});
    return existing;
  }
  return channel.send(payload);
}

function ruEmbed(title, description, marker) {
  return {
    embeds: [new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: marker })],
    allowedMentions: { parse: [] },
  };
}

function welcomePayload() {
  return ruEmbed(
    'Добро пожаловать в Litematica Together!',
    [
      'Это русская часть официального Discord-сервера проекта.',
      '',
      'Язык выбирается во встроенном **Discord Onboarding** при входе на сервер. Если вы выбрали **Русский**, вам доступны русские информационные каналы и русские голосовые комнаты.',
      '',
      'Перед общением прочитайте **#правила**. Если нужна помощь — загляните в **#вопросы** и Support.',
    ].join('\n'),
    'LTT-RU:welcome',
  );
}

function rulesPayload() {
  return ruEmbed(
    'Правила сервера',
    [
      'Короткая версия: поддерживаем сервер чистым и стараемся общаться по теме проекта.',
      '',
      '- Не обсуждаем политику, религию и другие оффтопные темы из реальной жизни, которые не связаны с сервером и могут привести к конфликтам.',
      '- Не публикуем мемы и похожий контент, который легко уходит в слишком жёсткий или неприятный оффтоп и требует лишней модерации.',
      '- Уважайте других участников. Не оскорбляйте и не атакуйте людей за то, кто они и что они думают.',
      '- Старайтесь писать вопросы и обсуждения в подходящих каналах и не уводить тематические каналы проекта в оффтоп.',
    ].join('\n'),
    'LTT-RU:rules',
  );
}

function faqPayload(supportChannelId = null) {
  const support = supportChannelId ? `<#${supportChannelId}>` : '#support';
  return ruEmbed(
    'Частые вопросы',
    [
      `**Где получить помощь?**\nОткройте ${support} и нажмите **Open Support Request**.`,
      '**Что указать в обращении?**\nВерсии Litematica Together, Minecraft, Litematica и MaLiLib; что произошло; что ожидалось; при необходимости приложите логи и скриншоты.',
      '**Можно открыть несколько тикетов?**\nНет. Одновременно у пользователя может быть один открытый тикет.',
      `**Куда писать о багах, проблемах синхронизации, подключении и предложениях?**\nВ ${support}.`,
      '**Где смотреть новые версии?**\nВ **#обновления**. Бот автоматически следит за Modrinth.',
      '**Где скачать мод?**\nВ **#загрузки** или на официальной странице Modrinth.',
    ].join('\n\n'),
    'LTT-RU:faq',
  );
}

function announcementsPayload() {
  return ruEmbed(
    'Официальные объявления',
    'Здесь будут публиковаться важные новости проекта, изменения на сервере, объявления команды и другая официальная информация на русском языке.',
    'LTT-RU:announcements',
  );
}

function downloadsPayload() {
  const payload = ruEmbed(
    'Скачать Litematica Together',
    [
      'Используйте официальную страницу проекта на **Modrinth** для загрузки актуальной версии.',
      '',
      'Перед установкой проверяйте совместимость версии мода с вашей версией Minecraft, Fabric Loader, Litematica и MaLiLib.',
    ].join('\n'),
    'LTT-RU:downloads',
  );
  payload.components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Открыть Modrinth').setStyle(ButtonStyle.Link).setURL(MODRINTH_URL),
  )];
  return payload;
}

function aboutPayload() {
  return ruEmbed(
    'О проекте Litematica Together',
    [
      '**Litematica Together** помогает работать с размещениями Litematica вместе с другими игроками и синхронизировать совместную работу в реальном времени.',
      '',
      'Основная цель проекта — сделать совместное строительство по схематикам удобнее: участники подключаются друг к другу, видят общие размещения и могут работать над одной постройкой без постоянной ручной пересылки изменений.',
      '',
      'Актуальные версии публикуются на Modrinth. Технические вопросы, баги и предложения отправляйте через Support.',
    ].join('\n'),
    'LTT-RU:about',
  );
}

function roadmapPayload() {
  return ruEmbed(
    'Дорожная карта',
    [
      'Здесь будет публиковаться актуальная дорожная карта Litematica Together на русском языке.',
      '',
      '**Статусы:** `Запланировано` → `В работе` → `Готово`.',
      '',
      'Планы могут меняться по мере разработки. Не считайте пункт дорожной карты обещанием конкретной даты релиза, пока команда отдельно её не объявила.',
    ].join('\n'),
    'LTT-RU:roadmap',
  );
}

function issuesPayload() {
  return ruEmbed(
    'Известные проблемы',
    [
      'Здесь команда будет публиковать подтверждённые известные проблемы, временные обходные решения и информацию о том, в какой версии исправлена ошибка.',
      '',
      'Если вашей проблемы здесь нет — создайте обращение через Support и приложите версии модов, описание проблемы и логи.',
    ].join('\n'),
    'LTT-RU:issues',
  );
}

function githubPayload() {
  const payload = ruEmbed(
    'GitHub',
    [
      'Здесь находятся ссылки на GitHub-ресурсы проекта.',
      '',
      `**LitematicaTogether Helper / Discord / relay infrastructure:**\n${HELPER_GITHUB_URL}`,
      '',
      'Если будет опубликован отдельный репозиторий самого мода, его ссылку можно добавить сюда отдельно.',
    ].join('\n'),
    'LTT-RU:github',
  );
  payload.components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Открыть GitHub Helper').setStyle(ButtonStyle.Link).setURL(HELPER_GITHUB_URL),
  )];
  return payload;
}

async function ensureRussianChannels(guild, { supportChannelId = null } = {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const russianRole = roleByNames(guild, ['Русский', 'Russian']);
  if (!russianRole) {
    console.warn(`[RUSSIAN CHANNELS] ${guild.name}: Russian role is missing.`);
    return null;
  }
  const hiddenRole = roleByNames(guild, ['Hidden']);
  const startHere = await ensureCategory(guild, 'START HERE');
  const project = await ensureCategory(guild, 'PROJECT');

  const channels = {};
  for (const [name, topic] of START_HERE_CHANNELS) {
    channels[name] = await ensureRussianChannel(guild, startHere, russianRole, hiddenRole, name, topic);
  }
  for (const [name, topic] of PROJECT_CHANNELS) {
    channels[name] = await ensureRussianChannel(guild, project, russianRole, hiddenRole, name, topic);
  }

  await upsert(channels['приветствие'], 'LTT-RU:welcome', welcomePayload());
  await upsert(channels['правила'], 'LTT-RU:rules', rulesPayload());
  await upsert(channels['вопросы'], 'LTT-RU:faq', faqPayload(supportChannelId));
  await upsert(channels['объявления'], 'LTT-RU:announcements', announcementsPayload());
  await upsert(channels['загрузки'], 'LTT-RU:downloads', downloadsPayload());
  await upsert(channels['о-проекте'], 'LTT-RU:about', aboutPayload());
  await upsert(channels['дорожная-карта'], 'LTT-RU:roadmap', roadmapPayload());
  await upsert(channels['известные-проблемы'], 'LTT-RU:issues', issuesPayload());
  await upsert(channels['github-ru'], 'LTT-RU:github', githubPayload());

  const cfg = db.guild(guild.id);
  cfg.russianChannelIds = Object.fromEntries(
    Object.entries(channels).map(([name, channel]) => [name, channel.id]),
  );
  cfg.russianUpdatesChannelId = channels['обновления'].id;
  cfg.russianAnnouncementsChannelId = channels['объявления'].id;
  db.save();

  console.log(`[RUSSIAN CHANNELS] ${guild.name}: ${Object.keys(channels).length} channels ready.`);
  return { startHere, project, channels };
}

module.exports = {
  MODRINTH_URL,
  START_HERE_CHANNELS,
  PROJECT_CHANNELS,
  ensureRussianChannels,
};
