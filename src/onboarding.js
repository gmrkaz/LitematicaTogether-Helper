const { ChannelType, PermissionFlagsBits, Routes } = require('discord.js');
const db = require('./db');

const TARGET_VOICE_CATEGORY_ID = '1540936226570244217';
const HIDDEN_ROLE_NAME = 'Hidden';
const RUSSIAN_ROLE_NAME = 'Русский';
const ENGLISH_ROLE_NAME = 'English';
const LANGUAGE_PROMPT_TITLE = 'На каком языке вы говорите? / What language do you speak?';

const VOICE_LAYOUT = [
  { key: 'main', ru: '🇷🇺 Основной', en: '🇬🇧 Main' },
  { key: '1x1', ru: '🇷🇺 1x1', en: '🇬🇧 1x1' },
  { key: '2x2', ru: '🇷🇺 2x2', en: '🇬🇧 2x2' },
  { key: 'international', ru: '🇷🇺 Международный', en: '🇬🇧 International' },
];

const roleByName = (guild, name) => guild.roles.cache.find(
  role => role.name.toLowerCase() === name.toLowerCase(),
);

async function ensureLanguageRole(guild, name, aliases = []) {
  let role = [name, ...aliases]
    .map(candidate => roleByName(guild, candidate))
    .find(Boolean);
  if (!role) {
    role = await guild.roles.create({
      name,
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: 'LTT HELPER: Discord onboarding language role',
    });
  }
  return role;
}

function languageVoiceOverwrites(guild, hiddenRole, selectedRole, otherRole) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
    {
      id: selectedRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseVAD,
      ],
    },
    {
      id: otherRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
  ];

  if (hiddenRole) {
    overwrites.push({
      id: hiddenRole.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    });
  }

  if (guild.members.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    });
  }
  return overwrites;
}

async function ensureVoiceChannel(guild, category, hiddenRole, selectedRole, otherRole, name) {
  let channel = guild.channels.cache.find(ch => (
    ch.type === ChannelType.GuildVoice
    && ch.parentId === category.id
    && ch.name === name
  ));

  const permissionOverwrites = languageVoiceOverwrites(
    guild,
    hiddenRole,
    selectedRole,
    otherRole,
  );

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites,
      reason: 'LTT HELPER: language voice room',
    });
  } else {
    await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});
  }
  return channel;
}

async function cleanupLegacyVoiceCategory(guild, targetCategory) {
  const cfg = db.guild(guild.id);
  const oldIds = [cfg.russianVoiceChannelId, cfg.englishVoiceChannelId].filter(Boolean);

  for (const id of oldIds) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (channel && channel.parentId !== targetCategory.id) {
      await channel.delete('LTT HELPER: replaced by language rooms in configured category').catch(() => {});
    }
  }

  const oldCategoryId = cfg.languageVoiceCategoryId;
  if (oldCategoryId && oldCategoryId !== targetCategory.id) {
    const oldCategory = await guild.channels.fetch(oldCategoryId).catch(() => null);
    if (oldCategory?.type === ChannelType.GuildCategory) {
      const children = guild.channels.cache.filter(ch => ch.parentId === oldCategory.id);
      if (!children.size) {
        await oldCategory.delete('LTT HELPER: old language voice category no longer used').catch(() => {});
      }
    }
  }

  delete cfg.languageVoiceCategoryId;
  delete cfg.russianVoiceChannelId;
  delete cfg.englishVoiceChannelId;
  db.save();
}

async function ensureLanguageVoiceRooms(guild, russianRole, englishRole) {
  await guild.channels.fetch();
  const category = await guild.channels.fetch(TARGET_VOICE_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(`Language voice category ${TARGET_VOICE_CATEGORY_ID} was not found or is not a category.`);
  }

  const hiddenRole = roleByName(guild, HIDDEN_ROLE_NAME);
  await cleanupLegacyVoiceCategory(guild, category);

  const russianChannels = [];
  const englishChannels = [];

  for (const item of VOICE_LAYOUT) {
    russianChannels.push(await ensureVoiceChannel(
      guild,
      category,
      hiddenRole,
      russianRole,
      englishRole,
      item.ru,
    ));
    englishChannels.push(await ensureVoiceChannel(
      guild,
      category,
      hiddenRole,
      englishRole,
      russianRole,
      item.en,
    ));
  }

  for (let i = 0; i < russianChannels.length; i++) {
    await russianChannels[i].setPosition(i * 2).catch(() => {});
    await englishChannels[i].setPosition(i * 2 + 1).catch(() => {});
  }

  const cfg = db.guild(guild.id);
  cfg.languageVoiceParentId = category.id;
  cfg.russianLanguageVoiceIds = russianChannels.map(ch => ch.id);
  cfg.englishLanguageVoiceIds = englishChannels.map(ch => ch.id);
  db.save();

  return { category, russianChannels, englishChannels };
}

function everyonePermissions(guild, channel) {
  try {
    return guild.roles.everyone.permissionsIn(channel);
  } catch {
    return null;
  }
}

function collectDefaultChannels(guild, existingIds = []) {
  const validExisting = existingIds
    .map(id => guild.channels.cache.get(id))
    .filter(Boolean);

  const publicSendable = [...guild.channels.cache.values()].filter(channel => {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return false;
    const perms = everyonePermissions(guild, channel);
    return perms?.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
  });

  const publicVisible = [...guild.channels.cache.values()].filter(channel => {
    if (channel.type === ChannelType.GuildCategory || channel.isThread?.()) return false;
    const perms = everyonePermissions(guild, channel);
    return perms?.has(PermissionFlagsBits.ViewChannel);
  });

  const result = [];
  const add = channel => {
    if (channel && !result.some(x => x.id === channel.id)) result.push(channel);
  };

  validExisting.forEach(add);
  publicSendable.forEach(add);
  publicVisible.forEach(add);
  return result.slice(0, 25);
}

function onboardingCanEnable(guild, channels) {
  if (channels.length < 7) return false;
  const sendable = channels.filter(channel => {
    const perms = everyonePermissions(guild, channel);
    return perms?.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
  });
  return sendable.length >= 5;
}

function placeholderId(offset = 0) {
  return String(Date.now() + offset);
}

function optionId(existingPrompt, title, offset) {
  const existing = existingPrompt?.options?.find(option => option.title === title);
  return existing?.id || placeholderId(offset);
}

async function ensureNativeLanguageOnboarding(
  guild,
  russianRole,
  englishRole,
  russianChannels,
  englishChannels,
) {
  if (!guild.features.includes('COMMUNITY')) {
    console.warn(`[ONBOARDING] ${guild.name}: Community is not enabled; native onboarding cannot be enabled.`);
    return { enabled: false, reason: 'community_not_enabled' };
  }

  const route = Routes.guildOnboarding(guild.id);
  const existing = await guild.client.rest.get(route).catch(() => ({
    prompts: [],
    default_channel_ids: [],
    enabled: false,
    mode: 0,
  }));

  const existingLanguagePrompt = (existing.prompts || []).find(prompt => (
    prompt.title === LANGUAGE_PROMPT_TITLE
    || prompt.options?.some(option => option.role_ids?.includes(russianRole.id) || option.role_ids?.includes(englishRole.id))
  ));

  const languagePrompt = {
    id: existingLanguagePrompt?.id || placeholderId(1),
    type: 0,
    title: LANGUAGE_PROMPT_TITLE,
    single_select: true,
    required: true,
    in_onboarding: true,
    options: [
      {
        id: optionId(existingLanguagePrompt, 'Русский', 2),
        title: 'Русский',
        description: 'Русский интерфейс сообщества и русские голосовые комнаты',
        emoji_id: null,
        emoji_name: '🇷🇺',
        emoji_animated: false,
        role_ids: [russianRole.id],
        channel_ids: russianChannels.map(channel => channel.id),
      },
      {
        id: optionId(existingLanguagePrompt, 'English', 3),
        title: 'English',
        description: 'English community role and English voice rooms',
        emoji_id: null,
        emoji_name: '🇬🇧',
        emoji_animated: false,
        role_ids: [englishRole.id],
        channel_ids: englishChannels.map(channel => channel.id),
      },
    ],
  };

  const prompts = (existing.prompts || []).filter(prompt => prompt.id !== existingLanguagePrompt?.id);
  prompts.unshift(languagePrompt);

  const defaultChannels = collectDefaultChannels(guild, existing.default_channel_ids || []);
  const canEnable = onboardingCanEnable(guild, defaultChannels);
  const body = {
    prompts,
    default_channel_ids: defaultChannels.map(channel => channel.id),
    mode: existing.mode ?? 0,
    enabled: existing.enabled || canEnable,
  };

  const result = await guild.client.rest.put(route, {
    body,
    reason: 'LTT HELPER: configure required Russian/English native onboarding',
  });

  const cfg = db.guild(guild.id);
  cfg.nativeOnboardingConfigured = true;
  cfg.nativeOnboardingEnabled = Boolean(result.enabled);
  cfg.russianRoleId = russianRole.id;
  cfg.englishRoleId = englishRole.id;
  db.save();

  if (!result.enabled) {
    console.warn(`[ONBOARDING] ${guild.name}: language prompt configured, but onboarding is not enabled because the server does not currently satisfy Discord default-channel requirements.`);
  }
  return result;
}

async function ensureOnboardingInfrastructure(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const russianRole = await ensureLanguageRole(guild, RUSSIAN_ROLE_NAME, ['Russian']);
  const englishRole = await ensureLanguageRole(guild, ENGLISH_ROLE_NAME);
  const rooms = await ensureLanguageVoiceRooms(guild, russianRole, englishRole);
  const onboarding = await ensureNativeLanguageOnboarding(
    guild,
    russianRole,
    englishRole,
    rooms.russianChannels,
    rooms.englishChannels,
  );

  return { russianRole, englishRole, ...rooms, onboarding };
}

module.exports = {
  TARGET_VOICE_CATEGORY_ID,
  LANGUAGE_PROMPT_TITLE,
  VOICE_LAYOUT,
  ensureOnboardingInfrastructure,
};
