'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');

const COLORS = {
  brand: 0x8B5CF6,
  ltt: 0x5865F2,
  translator: 0x22C7D6,
  ru: 0x3B82F6,
  gb: 0x6366F1,
  success: 0x22C55E,
};

const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[-_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function categoryByName(guild, name) {
  const wanted = normalize(name);
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === wanted
  ));
}

function textChannel(guild, categoryName, channelName) {
  const category = categoryByName(guild, categoryName);
  if (!category) return null;
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildText
    && channel.parentId === category.id
    && normalize(channel.name) === normalize(channelName)
  ));
}

function discordChannelUrl(guild, channel) {
  return channel ? `https://discord.com/channels/${guild.id}/${channel.id}` : null;
}

function brandEmbed(guild, title, description, color = COLORS.brand) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
  const icon = guild.iconURL({ size: 256 });
  if (icon) embed.setThumbnail(icon);
  return embed;
}

function linkButton(label, url, emoji = null) {
  if (!url) return null;
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
  if (emoji) button.setEmoji(emoji);
  return button;
}

function rows(...buttons) {
  const usable = buttons.filter(Boolean);
  return usable.length ? [new ActionRowBuilder().addComponents(...usable)] : [];
}

async function upsert(channel, marker, payload, { oldTitles = [], pin = true } = {}) {
  if (!channel?.isTextBased()) return null;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  let existing = messages?.find(message => (
    message.author.id === channel.client.user.id
    && message.embeds.some(embed => embed.footer?.text === marker)
  ));
  if (!existing && oldTitles.length) {
    const wanted = new Set(oldTitles);
    existing = messages?.find(message => (
      message.author.id === channel.client.user.id
      && message.embeds.some(embed => wanted.has(embed.title))
    ));
  }
  const message = existing
    ? await existing.edit(payload).catch(() => existing)
    : await channel.send(payload).catch(() => null);
  if (pin && message) await message.pin('MODS HUB: keep channel guide visible').catch(() => {});
  return message;
}

function readOnlyOverwrites(guild) {
  const hidden = guild.roles.cache.find(role => role.name === 'Hidden');
  const result = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
    ],
  }];
  if (hidden) result.push({ id: hidden.id, deny: [PermissionFlagsBits.ViewChannel] });
  if (guild.members.me?.id) result.push({
    id: guild.members.me.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageMessages,
    ],
  });
  return result;
}

async function ensureProjectsChannel(guild) {
  const startHere = categoryByName(guild, 'START HERE');
  if (!startHere) return null;
  let channel = textChannel(guild, 'START HERE', 'projects');
  if (!channel) {
    channel = await guild.channels.create({
      name: 'projects',
      type: ChannelType.GuildText,
      parent: startHere.id,
      topic: 'Litematica Together + Simple Translator — project navigation.',
      permissionOverwrites: readOnlyOverwrites(guild),
      reason: 'MODS HUB: projects overview',
    }).catch(() => null);
  } else {
    await channel.setParent(startHere.id, { lockPermissions: false }).catch(() => {});
    await channel.permissionOverwrites.set(readOnlyOverwrites(guild)).catch(() => {});
    await channel.setTopic('Litematica Together + Simple Translator — project navigation.').catch(() => {});
  }
  return channel;
}

async function styleStartHere(guild) {
  const cfg = db.guild(guild.id);
  const welcome = textChannel(guild, 'START HERE', 'welcome');
  const projects = await ensureProjectsChannel(guild);
  const rules = textChannel(guild, 'START HERE', 'rules');
  const faq = textChannel(guild, 'START HERE', 'faq');
  const announcements = textChannel(guild, 'START HERE', 'announcements');
  const downloads = textChannel(guild, 'START HERE', 'downloads');
  const support = cfg.supportChannelId
    ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null)
    : guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.name === 'support');

  const ordered = [welcome, projects, announcements, downloads, rules, faq].filter(Boolean);
  for (let index = 0; index < ordered.length; index += 1) {
    await ordered[index].setPosition(index).catch(() => {});
  }

  if (welcome) {
    const marker = 'MODS-HUB:WELCOME:PRETTY-V1';
    const embed = brandEmbed(
      guild,
      '✨ Добро пожаловать / Welcome',
      [
        'Официальное сообщество **Litematica Together** и **Simple Translator**.',
        'Official community for **Litematica Together** and **Simple Translator**.',
        '',
        'Новости, поддержка, обсуждения и развитие обоих модов — в одном аккуратном месте.',
        'News, support, discussion and development for both mods — all in one clean hub.',
      ].join('\n'),
    )
      .addFields(
        { name: '🌍 1. Язык / Language', value: 'Onboarding выдаёт роль **Русский** или **English** и показывает нужные каналы.' },
        { name: '🧩 2. Мод / Mod', value: 'Откройте **#projects**, затем категорию **LITEMATICA TOGETHER** или **SIMPLE TRANSLATOR**.' },
        { name: '🛟 3. Помощь / Help', value: support ? `Создайте Support Request в <#${support.id}>.` : 'Create a Support Request in the Support section.' },
      )
      .setFooter({ text: marker });

    const message = await upsert(welcome, marker, {
      embeds: [embed],
      components: rows(
        linkButton('Projects', discordChannelUrl(guild, projects), '🧩'),
        linkButton('Support', discordChannelUrl(guild, support), '🛟'),
        linkButton('Litematica Together', 'https://modrinth.com/mod/litematica-together', '🧱'),
      ),
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Welcome / Добро пожаловать', 'Choose your language / Выберите язык'] });

    if (message) {
      cfg.welcomeMessageId = message.id;
      cfg.welcomeChannelId = welcome.id;
      db.save();
    }
  }

  if (projects) {
    const marker = 'MODS-HUB:PROJECTS';
    const embed = brandEmbed(guild, '🧩 Наши моды / Our Mods', 'Два проекта — один Discord-хаб. Выберите нужный мод и язык.')
      .addFields(
        {
          name: '🧱 Litematica Together',
          value: 'Совместная работа с Litematica-размещениями и синхронизацией строительства.\n**RU:** `#о-моде` · `#обновления` · `#дорожная-карта` · `#известные-проблемы` · `#обсуждение`\n**EN:** `#about-mod` · `#updates` · `#roadmap` · `#known-issues` · `#discussion`',
        },
        {
          name: '🌐 Simple Translator',
          value: 'Перевод общения в Minecraft с отдельными новостями, roadmap, известными проблемами и обсуждением.\n**RU:** `#о-моде` · `#обновления` · `#дорожная-карта` · `#известные-проблемы` · `#обсуждение`\n**EN:** `#about-mod` · `#updates` · `#roadmap` · `#known-issues` · `#discussion`',
        },
      )
      .setFooter({ text: marker });

    await upsert(projects, marker, {
      embeds: [embed],
      components: rows(
        linkButton('Litematica Together on Modrinth', 'https://modrinth.com/mod/litematica-together', '🧱'),
        linkButton('Support', discordChannelUrl(guild, support), '🛟'),
      ),
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Our Mods / Наши моды'] });
  }

  if (rules) {
    const embed = brandEmbed(guild, 'Server Rules', '📜 **Коротко / In short:** подробные правила находятся в вашей языковой категории COMMUNITY.')
      .addFields(
        { name: '🇷🇺 Русский', value: 'Без политики/религии и конфликтного IRL-оффтопа, спама и травли. Уважайте людей и используйте каналы по назначению.' },
        { name: '🇬🇧 English', value: 'No politics/religion or conflict-heavy IRL topics, spam or harassment. Respect people and use the correct channels.' },
      )
      .setFooter({ text: 'MODS-HUB:START-RULES:PRETTY-V1' });
    await upsert(rules, 'MODS-HUB:START-RULES:PRETTY-V1', { embeds: [embed], allowedMentions: { parse: [] } }, { oldTitles: ['Server Rules'] });
  }

  if (faq) {
    const embed = brandEmbed(guild, 'Frequently Asked Questions', '❔ Самое важное перед тем, как писать в Support.')
      .addFields(
        { name: '🛟 Где получить помощь?', value: support ? `В <#${support.id}> — нажмите **Open Support Request**, выберите мод и заполните форму.` : 'В разделе Support.' },
        { name: '🎫 Сколько тикетов?', value: '**Один открытый тикет на пользователя.**' },
        { name: '📦 Где скачивать?', value: 'Проверяйте `#downloads` и официальные страницы проекта. Litematica Together публикуется на Modrinth.' },
        { name: '🌍 Почему не видно часть каналов?', value: 'Каналы разделены ролями **Русский** / **English**, которые выдаёт Onboarding.' },
      )
      .setFooter({ text: 'MODS-HUB:FAQ:PRETTY-V1' });
    await upsert(faq, 'MODS-HUB:FAQ:PRETTY-V1', {
      embeds: [embed],
      components: rows(linkButton('Support', discordChannelUrl(guild, support), '🛟')),
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Frequently Asked Questions'] });
  }

  if (announcements) {
    const marker = 'MODS-HUB:ANNOUNCEMENTS:PRETTY-V1';
    await upsert(announcements, marker, {
      embeds: [brandEmbed(guild, '📣 Объявления / Announcements', 'Важные новости сообщества и обоих проектов. Релизы конкретного мода публикуются в его `#обновления` / `#updates`.').setFooter({ text: marker })],
      allowedMentions: { parse: [] },
    });
  }

  if (downloads) {
    const marker = 'MODS-HUB:DOWNLOADS:PRETTY-V1';
    const embed = brandEmbed(guild, '📦 Загрузки / Downloads', 'Используйте только официальные страницы и ссылки из этого Discord.', COLORS.success)
      .addFields(
        { name: '🧱 Litematica Together', value: 'Официальные релизы доступны на **Modrinth**.' },
        { name: '🌐 Simple Translator', value: 'Официальная ссылка появится здесь, когда публичная страница релизов будет готова.' },
      )
      .setFooter({ text: marker });
    await upsert(downloads, marker, {
      embeds: [embed],
      components: rows(linkButton('Download Litematica Together', 'https://modrinth.com/mod/litematica-together', '🧱')),
      allowedMentions: { parse: [] },
    });
  }
}

const COMMUNITY_GUIDES = {
  'COMMUNITY RU': {
    color: COLORS.ru,
    channels: {
      общий: ['💬 Общий чат', 'Русскоязычное общение сообщества обоих модов. Технические проблемы лучше отправлять в Support.'],
      вопросы: ['❓ Вопросы', 'Короткие общие вопросы о сервере и модах. Для багов, логов и установки используйте Support.'],
      медиа: ['🎬 Медиа', 'Скриншоты, видео, клипы, красивые сборки и другой контент сообщества.'],
      предложения: ['💡 Предложения', 'Идеи по Litematica Together, Simple Translator и Discord. Опишите, какую проблему решает идея.'],
    },
  },
  'COMMUNITY GB': {
    color: COLORS.gb,
    channels: {
      general: ['💬 General', 'General English-speaking chat for both mod communities. Use Support for technical problems.'],
      questions: ['❓ Questions', 'Quick questions about the server or mods. Use Support for bugs, logs and installation help.'],
      media: ['🎬 Media', 'Screenshots, videos, clips, builds and other community content.'],
      suggestions: ['💡 Suggestions', 'Ideas for both mods and this Discord. Explain what problem your idea would solve.'],
      showcase: ['🏆 Showcase', 'Show finished builds, setups and creations you are proud of.'],
      schematics: ['🧱 Schematics', 'Share and discuss schematics with useful context and compatibility information.'],
      'looking-for-group': ['🤝 Looking for Group', 'Find people to build, test or play with. Add version and timezone when useful.'],
      'off-topic': ['🌙 Off-topic', 'Relaxed conversation outside project topics. Server rules still apply.'],
    },
  },
};

function ruRulesEmbed(guild) {
  return brandEmbed(
    guild,
    'Правила сервера',
    '📜 Короткая версия: поддерживаем сервер чистым, уважительным и по теме **Litematica Together** и **Simple Translator**.',
    COLORS.ru,
  )
    .addFields(
      { name: '🚫 1. Без конфликтного IRL-оффтопа', value: 'Политика, религия и другие темы, не относящиеся к серверу и легко вызывающие срачи, здесь не нужны.' },
      { name: '🧹 2. Без спама и жести', value: 'Не превращайте сервер в поток мем-спама, шок-контента и намеренных провокаций.' },
      { name: '🤝 3. Уважайте людей', value: 'Оскорбления, травля, унижение и личные нападки запрещены.' },
      { name: '🧭 4. Используйте каналы по назначению', value: 'Общие темы — в COMMUNITY, вопросы по конкретному моду — в его категории, технические проблемы — в Support.' },
      { name: '🛡️ 5. Не мешайте серверу и проектам', value: 'Рейды, вредоносные файлы, намеренная дезинформация и обход модерации запрещены.' },
      { name: '⚖️ Модерация', value: 'Если модератор просит прекратить конфликт или перенести обсуждение — выполните просьбу.' },
    )
    .setFooter({ text: 'LTT-COMMUNITY-RU:RULES' });
}

function gbRulesEmbed(guild) {
  return brandEmbed(
    guild,
    'Server Rules',
    '📜 Simple version: keep the server clean, respectful and on topic for **Litematica Together** and **Simple Translator**.',
    COLORS.gb,
  )
    .addFields(
      { name: '🚫 1. No conflict-heavy IRL topics', value: 'Politics, religion and unrelated topics likely to create drama do not belong here.' },
      { name: '🧹 2. No spam or disturbing content', value: 'Do not turn the server into meme spam, shock content or deliberate provocation.' },
      { name: '🤝 3. Respect people', value: 'Harassment, insults, humiliation and personal attacks are prohibited.' },
      { name: '🧭 4. Use the correct channels', value: 'General topics belong in COMMUNITY, mod-specific topics in the mod category, technical problems in Support.' },
      { name: '🛡️ 5. Do not disrupt the server or projects', value: 'Raids, malicious files, deliberate misinformation and moderation evasion are prohibited.' },
      { name: '⚖️ Moderation', value: 'If a moderator asks you to stop a conflict or move a discussion, follow that request.' },
    )
    .setFooter({ text: 'LTT-COMMUNITY-GB:RULES' });
}

async function styleCommunity(guild) {
  const cfg = db.guild(guild.id);
  const support = cfg.supportChannelId ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null) : null;

  const ruRules = textChannel(guild, 'COMMUNITY RU', 'правила');
  if (ruRules) {
    await upsert(ruRules, 'LTT-COMMUNITY-RU:RULES', {
      embeds: [ruRulesEmbed(guild)],
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Правила сервера'] });
  }

  const gbRules = textChannel(guild, 'COMMUNITY GB', 'rules');
  if (gbRules) {
    await upsert(gbRules, 'LTT-COMMUNITY-GB:RULES', {
      embeds: [gbRulesEmbed(guild)],
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Server Rules'] });
  }

  for (const [categoryName, def] of Object.entries(COMMUNITY_GUIDES)) {
    for (const [name, [title, description]] of Object.entries(def.channels)) {
      const channel = textChannel(guild, categoryName, name);
      if (!channel) continue;
      await channel.setTopic(description).catch(() => {});
      const marker = `MODS-HUB:COMMUNITY:${categoryName.endsWith('RU') ? 'RU' : 'GB'}:${name}:PRETTY-V1`;
      const embed = brandEmbed(guild, title, description, def.color).setFooter({ text: marker });
      if (['вопросы', 'questions'].includes(name) && support) {
        embed.addFields({
          name: categoryName.endsWith('RU') ? '🛟 Нужна техническая помощь?' : '🛟 Need technical help?',
          value: categoryName.endsWith('RU') ? `Используйте <#${support.id}> — вопрос попадёт прямо команде.` : `Use <#${support.id}> so your request reaches the team directly.`,
        });
      }
      await upsert(channel, marker, {
        embeds: [embed],
        components: ['вопросы', 'questions'].includes(name) ? rows(linkButton('Support', discordChannelUrl(guild, support), '🛟')) : [],
        allowedMentions: { parse: [] },
      });
    }
  }
}

const PROJECT_CHANNELS = {
  ru: {
    'о-моде': ['✨ О моде', 'Главная карточка проекта: что это за мод, где искать новости и куда обращаться за помощью.'],
    'обновления': ['🔔 Обновления', 'Новые версии и важные изменения проекта. Автоматические публикации релизов появляются здесь без дублей.'],
    'дорожная-карта': ['🗺️ Дорожная карта', 'Планы развития проекта, ближайшие направления и крупные цели.'],
    'известные-проблемы': ['⚠️ Известные проблемы', 'Подтверждённые проблемы, обходные решения и статус исправлений. Если вашей проблемы нет — откройте Support Request.'],
    'обсуждение': ['💬 Обсуждение', 'Обсуждение конкретно этого мода. Баги и технический разбор лучше отправлять в Support.'],
  },
  gb: {
    'about-mod': ['✨ About the mod', 'Project overview: what the mod does, where to find updates and where to get help.'],
    updates: ['🔔 Updates', 'New releases and important changes. Automated release posts appear here without duplicates.'],
    roadmap: ['🗺️ Roadmap', 'Development direction, upcoming work and larger project goals.'],
    'known-issues': ['⚠️ Known Issues', 'Confirmed problems, temporary workarounds and fix status. If your issue is not listed, open a Support Request.'],
    discussion: ['💬 Discussion', 'Discussion specifically about this mod. Use Support for bugs and technical troubleshooting.'],
  },
};

function aboutMarker(key, language) {
  const project = key === 'ltt' ? 'LTT' : 'ST';
  return `MODS-HUB:${project}:${language === 'ru' ? 'RU' : 'GB'}:ABOUT-V2`;
}

async function styleProject(guild, categoryName, projectName, color, key) {
  const cfg = db.guild(guild.id);
  const support = cfg.supportChannelId ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null) : null;
  const isLtt = key === 'ltt';

  for (const [language, defs] of Object.entries(PROJECT_CHANNELS)) {
    for (const [channelName, [title, description]] of Object.entries(defs)) {
      const channel = textChannel(guild, categoryName, channelName);
      if (!channel) continue;
      await channel.setTopic(description).catch(() => {});
      const isAbout = channelName === 'о-моде' || channelName === 'about-mod';
      const marker = isAbout
        ? aboutMarker(key, language)
        : `MODS-HUB:${key.toUpperCase()}:${language.toUpperCase()}:${channelName}:PRETTY-V1`;
      let embed;

      if (isAbout) {
        const russian = language === 'ru';
        embed = brandEmbed(
          guild,
          projectName,
          russian
            ? (isLtt
              ? '🧱 Совместная работа с Litematica-размещениями и синхронизацией строительства между игроками.'
              : '🌐 Проект перевода общения в Minecraft с отдельной инфраструктурой обновлений, поддержки и обсуждения.')
            : (isLtt
              ? '🧱 Collaborative Litematica placements and synchronized building between players.'
              : '🌐 A Minecraft communication translation project with dedicated updates, support and discussion.'),
          color,
        )
          .addFields(
            {
              name: russian ? '📚 В этой категории' : '📚 In this category',
              value: russian ? '`обновления` · `дорожная-карта` · `известные-проблемы` · `обсуждение`' : '`updates` · `roadmap` · `known-issues` · `discussion`',
            },
            {
              name: '🛟 Support',
              value: support
                ? (russian ? `Если что-то не работает — создайте тикет в <#${support.id}>.` : `If something is not working, create a ticket in <#${support.id}>.`)
                : 'Use the Support section for technical help.',
            },
          )
          .setFooter({ text: marker });
      } else {
        embed = brandEmbed(guild, title, description, color).setFooter({ text: marker });
        if (['известные-проблемы', 'known-issues', 'обсуждение', 'discussion'].includes(channelName) && support) {
          embed.addFields({
            name: '🛟 Support',
            value: language === 'ru' ? `Нужен разбор проблемы? Откройте тикет в <#${support.id}>.` : `Need troubleshooting? Open a ticket in <#${support.id}>.`,
          });
        }
      }

      await upsert(channel, marker, {
        embeds: [embed],
        components: isAbout
          ? rows(
            isLtt ? linkButton('Modrinth', 'https://modrinth.com/mod/litematica-together', '🧱') : null,
            linkButton('Support', discordChannelUrl(guild, support), '🛟'),
          )
          : [],
        allowedMentions: { parse: [] },
      }, { oldTitles: isAbout ? ['Litematica Together', 'Simple Translator'] : [] });
    }
  }
}

async function ensurePresentation(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  await styleStartHere(guild);
  await styleCommunity(guild);
  await styleProject(guild, 'LITEMATICA TOGETHER', 'Litematica Together', COLORS.ltt, 'ltt');
  await styleProject(guild, 'SIMPLE TRANSLATOR', 'Simple Translator', COLORS.translator, 'st');
  console.log(`[PRESENTATION] ${guild.name}: polished channel cards and navigation ready.`);
}

module.exports = {
  COLORS,
  ensurePresentation,
};
