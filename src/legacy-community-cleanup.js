'use strict';

const { ChannelType } = require('discord.js');

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryByExactName(guild, name) {
  const wanted = normalize(name);
  return guild.channels.cache.find(channel => (
    channel.type === ChannelType.GuildCategory
    && normalize(channel.name) === wanted
  ));
}

async function cleanupLegacyCommunity(guild) {
  await guild.channels.fetch();

  const legacy = categoryByExactName(guild, 'COMMUNITY');
  if (!legacy) return { migrated: 0, removed: false };

  const target = categoryByExactName(guild, 'COMMUNITY GB');
  if (!target) {
    console.warn(`[COMMUNITY CLEANUP] ${guild.name}: COMMUNITY exists but COMMUNITY GB is missing.`);
    return { migrated: 0, removed: false, reason: 'target_missing' };
  }

  const children = [...guild.channels.cache.values()]
    .filter(channel => channel.parentId === legacy.id)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  let migrated = 0;
  for (const channel of children) {
    try {
      // Keep the channel itself (and therefore message history), but make it inherit
      // the English community visibility rules after the move.
      await channel.setParent(target.id, { lockPermissions: true });
      migrated += 1;
    } catch (error) {
      console.warn(`[COMMUNITY CLEANUP] ${guild.name}: failed to move #${channel.name}: ${error.message}`);
    }
  }

  await guild.channels.fetch();
  const remaining = guild.channels.cache.filter(channel => channel.parentId === legacy.id);
  let removed = false;
  if (!remaining.size) {
    await legacy.delete('MODS HUB: obsolete COMMUNITY category replaced by COMMUNITY RU/GB')
      .then(() => { removed = true; })
      .catch(error => console.warn(`[COMMUNITY CLEANUP] ${guild.name}: failed to delete COMMUNITY: ${error.message}`));
  }

  console.log(`[COMMUNITY CLEANUP] ${guild.name}: migrated=${migrated}, removed=${removed}.`);
  return { migrated, removed };
}

module.exports = { cleanupLegacyCommunity };
