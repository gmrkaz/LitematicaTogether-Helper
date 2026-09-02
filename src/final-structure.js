'use strict';

const { ChannelType, Routes } = require('discord.js');

const TARGET_VOICE_CATEGORY_ID = '1540936226570244217';

const EXPECTED = {
  'START HERE': ['welcome', 'projects', 'announcements', 'downloads'],
  'COMMUNITY RU': ['правила', 'общий', 'вопросы', 'медиа', 'предложения'],
  'COMMUNITY GB': ['rules', 'general', 'questions', 'media', 'suggestions'],
  'LITEMATICA TOGETHER': [
    'о-моде', 'обновления', 'дорожная-карта', 'известные-проблемы', 'обсуждение',
    'about-mod', 'updates', 'roadmap', 'known-issues', 'discussion',
  ],
  'SIMPLE TRANSLATOR': [
    'о-моде', 'обновления', 'дорожная-карта', 'известные-проблемы', 'обсуждение',
    'about-mod', 'updates', 'roadmap', 'known-issues', 'discussion',
  ],
  SUPPORT: ['support'],
  STAFF: ['mod-log', 'support-staff', 'ticket-archive', 'support-archive-old'],
};

const OBSOLETE_BY_CATEGORY = {
  'START HERE': new Set(['rules', 'faq']),
  'COMMUNITY RU': new Set([
    'showcase', 'schematics', 'looking-for-group', 'off-topic',
    'витрина', 'схематики', 'поиск-группы', 'оффтоп',
  ]),
  'COMMUNITY GB': new Set(['showcase', 'schematics', 'looking-for-group', 'off-topic']),
};

const GLOBAL_OBSOLETE = new Set(['mod-updates']);
const EMPTY_LEGACY_CATEGORIES = new Set([
  'INFO',
  'COMMUNITY',
  'PROJECT',
  'LITEMATICA TOGETHER RU',
  'LITEMATICA TOGETHER GB',
  'SIMPLE TRANSLATOR RU',
  'SIMPLE TRANSLATOR GB',
  'LANGUAGE VOICE',
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryByName(guild, name) {
  const wanted = normalize(name);
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === wanted
  ));
}

function childChannels(guild, category) {
  if (!category) return [];
  return [...guild.channels.cache.values()]
    .filter(channel => channel.parentId === category.id)
    .sort((a, b) => a.rawPosition - b.rawPosition);
}

async function deleteChannel(channel, reason, deletedIds, removed) {
  if (!channel || channel.type === ChannelType.GuildCategory) return;
  try {
    await channel.delete(reason);
    deletedIds.add(channel.id);
    removed.push(channel.name);
  } catch (error) {
    console.warn(`[STRUCTURE] ${channel.guild?.name || 'guild'}: failed to delete #${channel.name}: ${error.message}`);
  }
}

async function cleanupObsoleteChannels(guild) {
  const deletedIds = new Set();
  const removed = [];

  for (const [categoryName, obsoleteNames] of Object.entries(OBSOLETE_BY_CATEGORY)) {
    const category = categoryByName(guild, categoryName);
    for (const channel of childChannels(guild, category)) {
      if (obsoleteNames.has(channel.name.toLowerCase())) {
        await deleteChannel(
          channel,
          `MODS HUB: obsolete channel removed from final ${categoryName} structure`,
          deletedIds,
          removed,
        );
      }
    }
  }

  for (const channel of [...guild.channels.cache.values()]) {
    if (channel.type === ChannelType.GuildCategory) continue;
    if (GLOBAL_OBSOLETE.has(channel.name.toLowerCase())) {
      await deleteChannel(
        channel,
        'MODS HUB: obsolete standalone update channel replaced by per-mod updates',
        deletedIds,
        removed,
      );
    }
  }

  return { deletedIds, removed };
}

function serializeOnboardingOption(option, deletedIds) {
  const emoji = option.emoji || {};
  return {
    id: option.id,
    title: option.title,
    description: option.description ?? null,
    emoji_id: option.emoji_id ?? emoji.id ?? null,
    emoji_name: option.emoji_name ?? emoji.name ?? null,
    emoji_animated: option.emoji_animated ?? emoji.animated ?? false,
    role_ids: option.role_ids || [],
    channel_ids: (option.channel_ids || []).filter(id => !deletedIds.has(id)),
  };
}

function serializeOnboardingPrompt(prompt, deletedIds) {
  return {
    id: prompt.id,
    type: prompt.type ?? 0,
    title: prompt.title,
    single_select: Boolean(prompt.single_select),
    required: Boolean(prompt.required),
    in_onboarding: Boolean(prompt.in_onboarding),
    options: (prompt.options || []).map(option => serializeOnboardingOption(option, deletedIds)),
  };
}

async function removeDeletedFromOnboarding(guild, deletedIds) {
  if (!deletedIds.size || !guild.features.includes('COMMUNITY')) return;
  const route = Routes.guildOnboarding(guild.id);
  const existing = await guild.client.rest.get(route).catch(() => null);
  if (!existing) return;

  const body = {
    prompts: (existing.prompts || []).map(prompt => serializeOnboardingPrompt(prompt, deletedIds)),
    default_channel_ids: (existing.default_channel_ids || []).filter(id => !deletedIds.has(id)),
    enabled: Boolean(existing.enabled),
    mode: existing.mode ?? 0,
  };

  await guild.client.rest.put(route, { body }).catch(error => {
    console.warn(`[STRUCTURE] ${guild.name}: could not remove deleted channels from onboarding: ${error.message}`);
  });
}

async function cleanupEmptyLegacyCategories(guild) {
  await guild.channels.fetch();
  const removed = [];

  for (const category of [...guild.channels.cache.values()]) {
    if (category.type !== ChannelType.GuildCategory) continue;
    if (!EMPTY_LEGACY_CATEGORIES.has(category.name.toUpperCase())) continue;
    const children = guild.channels.cache.filter(channel => channel.parentId === category.id);
    if (children.size) continue;
    await category.delete('MODS HUB: remove empty legacy category').then(() => {
      removed.push(category.name);
    }).catch(error => {
      console.warn(`[STRUCTURE] ${guild.name}: failed to delete category ${category.name}: ${error.message}`);
    });
  }

  return removed;
}

async function orderCategoryChildren(guild, categoryName, names) {
  const category = categoryByName(guild, categoryName);
  if (!category) return;
  const children = childChannels(guild, category);
  const byName = new Map(children.map(channel => [channel.name.toLowerCase(), channel]));
  for (let index = 0; index < names.length; index += 1) {
    const channel = byName.get(names[index].toLowerCase());
    if (channel) await channel.setPosition(index).catch(() => {});
  }
}

async function orderCategories(guild) {
  const names = [
    'START HERE',
    'COMMUNITY RU',
    'COMMUNITY GB',
    'LITEMATICA TOGETHER',
    'SIMPLE TRANSLATOR',
    'SUPPORT',
  ];

  for (let index = 0; index < names.length; index += 1) {
    const category = categoryByName(guild, names[index]);
    if (category) await category.setPosition(index).catch(() => {});
  }

  const voiceCategory = await guild.channels.fetch(TARGET_VOICE_CATEGORY_ID).catch(() => null);
  if (voiceCategory?.type === ChannelType.GuildCategory) {
    await voiceCategory.setPosition(names.length).catch(() => {});
  }

  const staff = categoryByName(guild, 'STAFF');
  if (staff) await staff.setPosition(names.length + 1).catch(() => {});

  for (const [categoryName, children] of Object.entries(EXPECTED)) {
    await orderCategoryChildren(guild, categoryName, children);
  }
}

function auditManagedCategories(guild) {
  const unexpected = [];
  for (const [categoryName, allowedNames] of Object.entries(EXPECTED)) {
    const category = categoryByName(guild, categoryName);
    if (!category) continue;
    const allowed = new Set(allowedNames.map(name => name.toLowerCase()));
    for (const channel of childChannels(guild, category)) {
      if (!allowed.has(channel.name.toLowerCase())) {
        unexpected.push(`${categoryName}/#${channel.name}`);
      }
    }
  }

  const voice = guild.channels.cache.get(TARGET_VOICE_CATEGORY_ID);
  if (voice?.type === ChannelType.GuildCategory) {
    const allowedVoice = new Set([
      '🇷🇺 Основной', '🇬🇧 Main',
      '🇷🇺 1x1', '🇬🇧 1x1',
      '🇷🇺 2x2', '🇬🇧 2x2',
      '🇷🇺 3x3', '🇬🇧 3x3',
      '🇷🇺 5x5', '🇬🇧 5x5',
      '🌐 International',
    ]);
    for (const channel of childChannels(guild, voice)) {
      if (channel.type === ChannelType.GuildVoice && !allowedVoice.has(channel.name)) {
        unexpected.push(`${voice.name}/🔊${channel.name}`);
      }
    }
  }

  return unexpected;
}

async function reconcileManagedStructure(guild) {
  await guild.channels.fetch();

  const { deletedIds, removed } = await cleanupObsoleteChannels(guild);
  await removeDeletedFromOnboarding(guild, deletedIds);
  const removedCategories = await cleanupEmptyLegacyCategories(guild);
  await guild.channels.fetch();
  await orderCategories(guild);
  await guild.channels.fetch();

  const unexpected = auditManagedCategories(guild);
  console.log(
    `[STRUCTURE] ${guild.name}: removed=${removed.length}, legacyCategories=${removedCategories.length}, unexpected=${unexpected.length}`,
  );
  if (removed.length) console.log(`[STRUCTURE] removed channels: ${removed.join(', ')}`);
  if (removedCategories.length) console.log(`[STRUCTURE] removed categories: ${removedCategories.join(', ')}`);
  if (unexpected.length) {
    console.warn(`[STRUCTURE] unexpected channels kept for safety: ${unexpected.join(' | ')}`);
  }

  return { removed, removedCategories, unexpected };
}

module.exports = {
  EXPECTED,
  reconcileManagedStructure,
};
