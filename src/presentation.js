'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const db = require('./db');

const COLORS = {
  brand: 0x8B5CF6,
  ltt: 0x5865F2,
  translator: 0x22C7D6,
  ru: 0x3B82F6,
  gb: 0x6366F1,
  support: 0xF59E0B,
  success: 0x22C55E,
  warning: 0xF59E0B,
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
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description);
  const icon = guild.iconURL({ size: 256 });
  if (icon) embed.setThumbnail(icon);
  return embed;
}

async function upsert(channel, marker, payload, {
  pin = true,
  oldTitles = [],
} = {}) {
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

function footer(embed, marker) {
  return embed.setFooter({ text: marker });
}

function linkButton(label, url, emoji = null) {
  if (!url) return null;
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
  if (emoji) button.setEmoji(emoji);
  return button;
}

function row(...buttons) {
  const usable = buttons.filter(Boolean);
  return usable.length ? [new ActionRowBuilder().addComponents(...usable)] : [];
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
      topic: 'Litematica Together + Simple Translator — choose a project and find the right section.',
      reason: 'MODS HUB: projects overview',
    }).catch(() => null);
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

  if (welcome) {
    const embed = footer(
      brandEmbed(
        guild,
        '✨ Добро пожаловать / Welcome',
        [
          'Официальное сообщество **Litematica Together** и **Simple Translator**.',
          'Official community for **Litematica Together** and **Simple Translator**.',
          '',
          'Здесь собраны новости, поддержка, обсуждения и развитие обоих модов — без лишнего хаоса.',
          'News, support, discussion and development for both mods live here in one place.',
        ].join('\n'),
      ),
      'MODS-HUB:WELCOME:PRETTY-V1',
    )
      .addFields(
        {
          name: '🌍 1. Язык / Language',
          value: 'Discord Onboarding выдаёт роль **Русский** или **English** и показывает подходящие каналы.',
        },
        {
          name: '🧩 2. Выберите мод / Pick a mod',
          value: 'Откройте **#projects**, затем категорию **LITEMATICA TOGETHER** или **SIMPLE TRANSLATOR**.',
        },
        {
          name: '🛟 3. Нужна помощь? / Need help?',
          value: support ? `Перейдите в <#${support.id}> и создайте один Support Request.` : 'Use the Support section and create one Support Request.',
        },
      );

    const components = row(
      linkButton('Наши моды / Projects', discordChannelUrl(guild, projects), '🧩'),
      linkButton('Support', discordChannelUrl(guild, support), '🛟'),
      linkButton('Litematica Together', 'https://modrinth.com/mod/litematica-together', '🧱'),
    );

    const message = await upsert(welcome, 'MODS-HUB:WELCOME:PRETTY-V1', {
      embeds: [embed],
      components,
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Welcome / Добро пожаловать', 'Choose your language / Выберите язык'] });

    if (message) {
      cfg.welcomeMessageId = message.id;
      cfg.welcomeChannelId = welcome.id;
      db.save();
    }
  }

  if (projects) {
    const embed = footer(
      brandEmbed(
        guild,
        '🧩 Наши моды / Our Mods',
        'Два проекта — один аккуратный Discord-хаб. Выберите нужный мод и язык.',
      ),
      'MODS-HUB:PROJECTS:PRETTY-V1',
    )
      .addFields(
        {
          name: '🧱 Litematica Together',
          value: [
            'Совместная работа с Litematica-размещениями и синхронизацией строительства.',
            '**RU:** `#о-моде` · `#обновления` · `#дорожная-карта` · `#известные-проблемы` · `#обсуждение`',
            '**EN:** `#about-mod` · `#updates` · `#roadmap` · `#known-issues` · `#discussion`',
          ].join('\n'),
        },
        {
          name: '🌐 Simple Translator',
          value: [
            'Перевод общения в Minecraft с отдельными новостями, roadmap, известными проблемами и обсуждением.',
            '**RU:** `#о-моде` · `#обновления` · `#дорожная-карта` · `#известные-проблемы` · `#обсуждение`',
            '**EN:** `#about-mod` · `#updates` · `#roadmap` · `#known-issues` · `#discussion`',
          ].join('\n'),
        },
      );

    await upsert(projects, 'MODS-HUB:PROJECTS:PRETTY-V1', {
      embeds: [embed],
      components: row(
        linkButton('Litematica Together on Modrinth', 'https://modrinth.com/mod/litematica-together', '🧱'),
        linkButton('Support', discordChannelUrl(guild, support), '🛟'),
      ),
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Our Mods / Наши моды'] });
  }

  if (rules) {
    const embed = footer(
      brandEmbed(guild, '📜 Quick Rules / Короткие правила', 'Подробные правила находятся в вашей языковой категории COMMUNITY.', COLORS.brand),
      'MODS-HUB:START-RULES:PRETTY-V1',
    ).addFields(
      {
        name: '🇷🇺 Русский',
        value: 'Без политики/религии и конфликтного IRL-оффтопа, без спама и травли. Уважайте людей и используйте каналы по назначению.',
      },
      {
        name: '🇬🇧 English',
        value: 'No politics/religion or conflict-heavy IRL topics, no spam or harassment. Respect people and use the correct channels.',
      },
    );
    await upsert(rules, 'MODS-HUB:START-RULES:PRETTY-V1', {
      embeds: [embed],
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Server Rules'] });
  }

  if (faq) {
    const embed = footer(
      brandEmbed(guild, '❔ FAQ / Частые вопросы', 'Самое важное перед тем, как писать в Support.', COLORS.brand),
      'MODS-HUB:FAQ:PRETTY-V1',
    ).addFields(
      { name: '🛟 Где получить помощь?', value: support ? `В <#${support.id}>. Выберите мод и заполните короткую форму.` : 'В разделе Support.' },
      { name: '🎫 Сколько тикетов можно открыть?', value: '**Один открытый тикет на пользователя.** Закройте старый перед созданием нового.' },
      { name: '📦 Где скачивать мод?', value: 'Проверяйте `#downloads` и официальный раздел нужного мода. Релизы Litematica Together также публикуются с Modrinth.' },
      { name: '🌍 Почему я вижу не все каналы?', value: 'Русские и английские каналы разделены ролями **Русский** / **English**, выбранными в Onboarding.' },
    );
    await upsert(faq, 'MODS-HUB:FAQ:PRETTY-V1', {
      embeds: [embed],
      components: row(linkButton('Support', discordChannelUrl(guild, support), '🛟')),
      allowedMentions: { parse: [] },
    }, { oldTitles: ['Frequently Asked Questions'] });
  }

  if (announcements) {
    const embed = footer(
      brandEmbed(
        guild,
        '📣 Объявления / Announcements',
        'Важные новости сообщества и двух проектов публикуются здесь. Для релизов конкретного мода используйте его `#обновления` / `#updates`.',
        COLORS.brand,
      ),
      'MODS-HUB:ANNOUNCEMENTS:PRETTY-V1',
    );
    await upsert(announcements, 'MODS-HUB:ANNOUNCEMENTS:PRETTY-V1', {
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }

  if (downloads) {
    const embed = footer(
      brandEmbed(
        guild,
        '📦 Загрузки / Downloads',
        'Используйте только официальные страницы и ссылки из этого Discord. Не скачивайте моды из случайных перезаливов.',
        COLORS.success,
      ),
      'MODS-HUB:DOWNLOADS:PRETTY-V1',
    ).addFields(
      { name: '🧱 Litematica Together', value: 'Официальные релизы доступны на **Modrinth**.' },
      { name: '🌐 Simple Translator', value: 'Официальная ссылка появится здесь, когда публичная страница релизов будет готова.' },
    );
    await upsert(downloads, 'MODS-HUB:DOWNLOADS:PRETTY-V1', {
      embeds: [embed],
      components: row(linkButton('Download Litematica Together', 'https://modrinth.com/mod/litematica-together', '🧱')),
      allowedMentions: { parse: [] },
    });
  }
}

const COMMUNITY_GUIDES = {
  'COMMUNITY RU': {
    color: COLORS.ru,
    channels: {
      правила: ['📜 Правила сообщества', 'Главные правила сервера. Прочитайте их перед общением — коротко, понятно и без юридического языка.'],
      общий: ['💬 Общий чат', 'Обычное русскоязычное общение сообщества обоих модов. Для технических проблем используйте Support.'],
      вопросы: ['❓ Вопросы', 'Короткие общие вопросы о сервере и модах. Если нужен разбор бага, логов или установки — создайте Support Request.'],
      медиа: ['🎬 Медиа', 'Скриншоты, видео, клипы, красивые сборки и другой контент сообщества.'],
      предложения: ['💡 Предложения', 'Идеи по Litematica Together, Simple Translator и самому Discord. Опишите не только идею, но и зачем она нужна.'],
    },
  },
  'COMMUNITY GB': {
    color: COLORS.gb,
    channels: {
      rules: ['📜 Community Rules', 'The main server rules. Read them before chatting — short, clear and practical.'],
      general: ['💬 General', 'General English-speaking chat for both mod communities. Use Support for technical problems.'],
      questions: ['❓ Questions', 'Quick questions about the server or mods. For bugs, logs or installation help, create a Support Request.'],
      media: ['🎬 Media', 'Screenshots, videos, clips, builds and other community content.'],
      suggestions: ['💡 Suggestions', 'Ideas for Litematica Together, Simple Translator and this Discord. Explain the problem your idea would solve.'],
      showcase: ['🏆 Showcase', 'Show finished builds, setups and creations you are proud of.'],
      schematics: ['🧱 Schematics', 'Share and discuss schematics. Add useful context, screenshots and compatibility information.'],
      'looking-for-group': ['🤝 Looking for Group', 'Find people to build, test or play with. Say what you want to do, version and timezone when useful.'],
      'off-topic': ['🌙 Off-topic', 'Relaxed conversation that does not fit the project channels. Server rules still apply.'],
    },
  },
};

async function styleCommunity(guild) {
  const cfg = db.guild(guild.id);
  const support = cfg.supportChannelId ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null) : null;
  for (const [categoryName, def] of Object.entries(COMMUNITY_GUIDES)) {
    for (const [name, [title, description]] of Object.entries(def.channels)) {
      const channel = textChannel(guild, categoryName, name);
      if (!channel) continue;
      const marker = `MODS-HUB:COMMUNITY:${categoryName.endsWith('RU') ? 'RU' : 'GB'}:${name}:PRETTY-V1`;
      const embed = footer(
        brandEmbed(guild, title, description, def.color),
        marker,
      );
      if (['вопросы', 'questions'].includes(name) && support) {
        embed.addFields({
          name: categoryName.endsWith('RU') ? '🛟 Нужна техническая помощь?' : '🛟 Need technical help?',
          value: categoryName.endsWith('RU')
            ? `Используйте <#${support.id}> — там вопрос попадёт прямо команде.`
            : `Use <#${support.id}> so your request reaches the team directly.`,
        });
      }
      await upsert(channel, marker, {
        embeds: [embed],
        components: ['вопросы', 'questions'].includes(name)
          ? row(linkButton('Support', discordChannelUrl(guild, support), '🛟'))
          : [],
        allowedMentions: { parse: [] },
      }, {
        oldTitles: name === 'правила' ? ['Правила сервера'] : name === 'rules' ? ['Server Rules'] : [],
      });
    }
  }
}

const PROJECT_CHANNELS = {
  ru: {
    'о-моде': ['✨ О моде', 'Главная карточка проекта: что это за мод, где искать новости и куда обращаться за помощью.'],
    'обновления': ['🔔 Обновления', 'Новые версии и важные изменения проекта. Автоматические публикации релизов появляются здесь без дублей.'],
    'дорожная-карта': ['🗺️ Дорожная карта', 'Планы развития проекта. Здесь команда может фиксировать ближайшие направления и крупные цели.'],
    'известные-проблемы': ['⚠️ Известные проблемы', 'Подтверждённые проблемы, временные обходные решения и статус исправлений. Если вашей проблемы здесь нет — откройте Support Request.'],
    'обсуждение': ['💬 Обсуждение', 'Свободное обсуждение конкретно этого мода. Баги и технические разборы лучше отправлять в Support.'],
  },
  gb: {
    'about-mod': ['✨ About the mod', 'The project overview: what the mod does, where to find updates and where to get help.'],
    updates: ['🔔 Updates', 'New releases and important changes. Automated release posts appear here without duplicates.'],
    roadmap: ['🗺️ Roadmap', 'Development direction, upcoming work and larger project goals.'],
    'known-issues': ['⚠️ Known Issues', 'Confirmed problems, temporary workarounds and fix status. If your issue is not listed, open a Support Request.'],
    discussion: ['💬 Discussion', 'Discussion specifically about this mod. Use Support for bugs and technical troubleshooting.'],
  },
};

async function styleProject(guild, categoryName, projectName, color, key) {
  const cfg = db.guild(guild.id);
  const support = cfg.supportChannelId ? await guild.channels.fetch(cfg.supportChannelId).catch(() => null) : null;
  const isLtt = key === 'ltt';

  for (const [language, defs] of Object.entries(PROJECT_CHANNELS)) {
    for (const [channelName, [title, description]] of Object.entries(defs)) {
      const channel = textChannel(guild, categoryName, channelName);
      if (!channel) continue;
      const marker = `MODS-HUB:${key.toUpperCase()}:${language.toUpperCase()}:${channelName}:PRETTY-V1`;
      let embed;

      if (['о-моде', 'about-mod'].includes(channelName)) {
        const russian = language === 'ru';
        embed = footer(
          brandEmbed(
            guild,
            `${isLtt ? '🧱' : '🌐'} ${projectName}`,
            russian
              ? (isLtt
                ? 'Совместная работа с Litematica-размещениями и синхронизацией строительства между игроками.'
                : 'Проект перевода общения в Minecraft с отдельной инфраструктурой обновлений, поддержки и обсуждения.')
              : (isLtt
                ? 'Collaborative Litematica placements and synchronized building between players.'
                : 'A Minecraft communication translation project with dedicated updates, support and discussion.'),
            color,
          ),
          marker,
        ).addFields(
          {
            name: russian ? '📚 Что находится в этой категории' : '📚 What you will find here',
            value: russian
              ? '`обновления` · `дорожная-карта` · `известные-проблемы` · `обсуждение`'
              : '`updates` · `roadmap` · `known-issues` · `discussion`',
          },
          {
            name: russian ? '🛟 Поддержка' : '🛟 Support',
            value: support
              ? (russian ? `Если что-то не работает — создайте тикет в <#${support.id}>.` : `If something is not working, create a ticket in <#${support.id}>.`)
              : 'Use the Support section for technical help.',
          },
        );
      } else {
        embed = footer(brandEmbed(guild, title, description, color), marker);
        if (['известные-проблемы', 'known-issues', 'обсуждение', 'discussion'].includes(channelName) && support) {
          embed.addFields({
            name: language === 'ru' ? '🛟 Support' : '🛟 Support',
            value: language === 'ru'
              ? `Нужен разбор проблемы? Откройте тикет в <#${support.id}>.`
              : `Need troubleshooting? Open a ticket in <#${support.id}>.`,
          });
        }
      }

      const components = [];
      if (['о-моде', 'about-mod'].includes(channelName)) {
        components.push(...row(
          isLtt ? linkButton('Modrinth', 'https://modrinth.com/mod/litematica-together', '🧱') : null,
          linkButton('Support', discordChannelUrl(guild, support), '🛟'),
        ));
      }
      await upsert(channel, marker, {
        embeds: [embed],
        components,
        allowedMentions: { parse: [] },
      }, {
        oldTitles: ['Litematica Together', 'Simple Translator'],
      });
    }
  }
}

async function ensurePresentation(guild) {
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
