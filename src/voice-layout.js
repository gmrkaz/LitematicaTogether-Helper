const { ChannelType, PermissionFlagsBits, Routes } = require('discord.js');
const db = require('./db');

const TARGET_VOICE_CATEGORY_ID = '1540936226570244217';
const SHARED_INTERNATIONAL_NAME = '🌐 International';
const LEGACY_INTERNATIONAL_NAMES = new Set(['🇷🇺 Международный', '🇬🇧 International']);

const roleByName = (guild, name) => guild.roles.cache.find(
  role => role.name.toLowerCase() === name.toLowerCase(),
);

function sharedOverwrites(guild, hiddenRole, russianRole, englishRole) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
    {
      id: russianRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseVAD,
      ],
    },
    {
      id: englishRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseVAD,
      ],
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

function serializeOption(option, deletedIds, sharedId) {
  const emoji = option.emoji || {};
  const ids = (option.channel_ids || []).filter(id => !deletedIds.has(id));
  if (!ids.includes(sharedId)) ids.push(sharedId);
  return {
    id: option.id,
    title: option.title,
    description: option.description ?? null,
    emoji_id: option.emoji_id ?? emoji.id ?? null,
    emoji_name: option.emoji_name ?? emoji.name ?? null,
    emoji_animated: option.emoji_animated ?? emoji.animated ?? false,
    role_ids: option.role_ids || [],
    channel_ids: ids,
  };
}

function serializePrompt(prompt, deletedIds, sharedId, russianRoleId, englishRoleId) {
  const languagePrompt = (prompt.options || []).some(option => (
    option.role_ids?.includes(russianRoleId) || option.role_ids?.includes(englishRoleId)
  ));

  return {
    id: prompt.id,
    type: prompt.type ?? 0,
    title: prompt.title,
    single_select: Boolean(prompt.single_select),
    required: Boolean(prompt.required),
    in_onboarding: Boolean(prompt.in_onboarding),
    options: (prompt.options || []).map(option => (
      languagePrompt
        ? serializeOption(option, deletedIds, sharedId)
        : {
          id: option.id,
          title: option.title,
          description: option.description ?? null,
          emoji_id: option.emoji_id ?? option.emoji?.id ?? null,
          emoji_name: option.emoji_name ?? option.emoji?.name ?? null,
          emoji_animated: option.emoji_animated ?? option.emoji?.animated ?? false,
          role_ids: option.role_ids || [],
          channel_ids: option.channel_ids || [],
        }
    )),
  };
}

async function patchNativeOnboarding(guild, deletedIds, sharedId, russianRole, englishRole) {
  if (!guild.features.includes('COMMUNITY')) return;
  const route = Routes.guildOnboarding(guild.id);
  const existing = await guild.client.rest.get(route).catch(() => null);
  if (!existing?.prompts) return;

  const prompts = existing.prompts.map(prompt => serializePrompt(
    prompt,
    deletedIds,
    sharedId,
    russianRole.id,
    englishRole.id,
  ));

  await guild.client.rest.put(route, {
    body: {
      prompts,
      default_channel_ids: existing.default_channel_ids || [],
      enabled: Boolean(existing.enabled),
      mode: existing.mode ?? 0,
    },
  }).catch(error => {
    console.warn(`[VOICE LAYOUT] Could not patch onboarding International channel: ${error.message}`);
  });
}

async function normalizeInternationalVoice(guild) {
  try {
    await guild.roles.fetch();
    await guild.channels.fetch();

    const category = await guild.channels.fetch(TARGET_VOICE_CATEGORY_ID).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return null;

    const russianRole = roleByName(guild, 'Русский') || roleByName(guild, 'Russian');
    const englishRole = roleByName(guild, 'English');
    if (!russianRole || !englishRole) return null;

    const hiddenRole = roleByName(guild, 'Hidden');
    const legacy = [...guild.channels.cache.values()].filter(channel => (
      channel.type === ChannelType.GuildVoice
      && channel.parentId === category.id
      && LEGACY_INTERNATIONAL_NAMES.has(channel.name)
    ));
    const deletedIds = new Set(legacy.map(channel => channel.id));

    let shared = [...guild.channels.cache.values()].find(channel => (
      channel.type === ChannelType.GuildVoice
      && channel.parentId === category.id
      && channel.name === SHARED_INTERNATIONAL_NAME
    ));

    const permissionOverwrites = sharedOverwrites(
      guild,
      hiddenRole,
      russianRole,
      englishRole,
    );

    if (!shared) {
      shared = await guild.channels.create({
        name: SHARED_INTERNATIONAL_NAME,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites,
        reason: 'LTT HELPER: one shared International room for both language roles',
      });
    } else {
      await shared.permissionOverwrites.set(permissionOverwrites).catch(() => {});
    }

    for (const channel of legacy) {
      await channel.delete('LTT HELPER: replaced by one shared International room').catch(() => {});
    }

    const languageVoices = [...guild.channels.cache.values()].filter(channel => (
      channel.type === ChannelType.GuildVoice
      && channel.parentId === category.id
      && (channel.name.startsWith('🇷🇺') || channel.name.startsWith('🇬🇧'))
      && !LEGACY_INTERNATIONAL_NAMES.has(channel.name)
    ));
    await shared.setPosition(languageVoices.length).catch(() => {});

    const cfg = db.guild(guild.id);
    cfg.sharedInternationalVoiceId = shared.id;
    cfg.russianLanguageVoiceIds = (cfg.russianLanguageVoiceIds || []).filter(id => !deletedIds.has(id));
    cfg.englishLanguageVoiceIds = (cfg.englishLanguageVoiceIds || []).filter(id => !deletedIds.has(id));
    if (!cfg.russianLanguageVoiceIds.includes(shared.id)) cfg.russianLanguageVoiceIds.push(shared.id);
    if (!cfg.englishLanguageVoiceIds.includes(shared.id)) cfg.englishLanguageVoiceIds.push(shared.id);
    db.save();

    await patchNativeOnboarding(
      guild,
      deletedIds,
      shared.id,
      russianRole,
      englishRole,
    );

    return shared;
  } catch (error) {
    console.error(`[VOICE LAYOUT] ${guild.name}: ${error.message}`);
    return null;
  }
}

module.exports = {
  SHARED_INTERNATIONAL_NAME,
  normalizeInternationalVoice,
};
