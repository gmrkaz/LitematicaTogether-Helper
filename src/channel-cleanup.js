'use strict';

const { ChannelType } = require('discord.js');

function normalize(name) {
  return String(name || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isGithubNamedChannel(channel) {
  if (!channel || channel.type === ChannelType.GuildCategory) return false;
  const name = normalize(channel.name);
  return name.includes('github') || name.includes('гитхаб');
}

async function cleanupGithubChannels(guild) {
  await guild.channels.fetch();
  const targets = [...guild.channels.cache.values()].filter(isGithubNamedChannel);

  for (const channel of targets) {
    await channel.delete('LTT HELPER: remove GitHub-related Discord channels').catch(error => {
      console.warn(`[CHANNEL CLEANUP] ${guild.name}: failed to delete #${channel.name}: ${error.message}`);
    });
  }

  if (targets.length) {
    console.log(`[CHANNEL CLEANUP] ${guild.name}: removed ${targets.length} GitHub-related channel(s).`);
  }

  return targets.length;
}

module.exports = {
  cleanupGithubChannels,
};
