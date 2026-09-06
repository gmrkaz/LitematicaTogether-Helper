'use strict';

const { Client, Events, PermissionFlagsBits } = require('discord.js');

const installed = Symbol.for('modsHub.pinNotificationsInstalled');
const CHANNEL_PINNED_MESSAGE_TYPE = 6;
const MAX_HISTORY_PAGES = Math.max(1, Number(process.env.PIN_NOTIFICATION_SCAN_PAGES || 50));

function isPinNotification(message) {
  return Boolean(message?.guild && message.type === CHANNEL_PINNED_MESSAGE_TYPE);
}

async function deletePinNotification(message) {
  if (!isPinNotification(message)) return false;
  try {
    await message.delete();
    return true;
  } catch (error) {
    console.warn(`[PIN CLEANUP] ${message.guild?.name || 'guild'}/#${message.channel?.name || message.channelId}: ${error.message}`);
    return false;
  }
}

function canCleanChannel(guild, channel) {
  if (!channel?.messages?.fetch || !channel.isTextBased?.()) return false;
  const me = guild.members.me;
  if (!me) return false;
  const permissions = channel.permissionsFor(me);
  return Boolean(
    permissions?.has(PermissionFlagsBits.ViewChannel)
    && permissions.has(PermissionFlagsBits.ReadMessageHistory)
    && permissions.has(PermissionFlagsBits.ManageMessages)
  );
}

async function cleanupChannel(channel) {
  const guild = channel.guild;
  if (!guild || !canCleanChannel(guild, channel)) return { removed: 0, skipped: true };

  let removed = 0;
  let before = null;

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const options = { limit: 100 };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options).catch(error => {
      console.warn(`[PIN CLEANUP] ${guild.name}/#${channel.name}: history fetch failed: ${error.message}`);
      return null;
    });
    if (!batch?.size) break;

    for (const message of batch.values()) {
      if (isPinNotification(message) && await deletePinNotification(message)) removed += 1;
    }

    const oldest = batch.last();
    if (!oldest || batch.size < 100) break;
    before = oldest.id;
  }

  return { removed, skipped: false };
}

async function cleanupPinNotifications(guild) {
  await guild.channels.fetch();

  let removed = 0;
  let scanned = 0;
  let skipped = 0;

  for (const channel of guild.channels.cache.values()) {
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) continue;
    const result = await cleanupChannel(channel);
    if (result.skipped) skipped += 1;
    else {
      scanned += 1;
      removed += result.removed;
    }
  }

  console.log(`[PIN CLEANUP] ${guild.name}: removed=${removed}, scanned=${scanned}, skipped=${skipped}`);
  return { removed, scanned, skipped };
}

function registerClient(client) {
  client.on(Events.MessageCreate, message => {
    if (!isPinNotification(message)) return;
    deletePinNotification(message).catch(() => {});
  });

  client.once(Events.ClientReady, readyClient => {
    const run = async () => {
      for (const guild of readyClient.guilds.cache.values()) {
        await cleanupPinNotifications(guild).catch(error => {
          console.warn(`[PIN CLEANUP] ${guild.name}: ${error.message}`);
        });
      }
    };

    run().catch(() => {});
    const secondSweep = setTimeout(() => run().catch(() => {}), 15000);
    secondSweep.unref?.();
  });
}

function installPinNotificationCleanupHook() {
  if (Client.prototype[installed]) return;
  Client.prototype[installed] = true;

  const originalLogin = Client.prototype.login;
  Client.prototype.login = function patchedLogin(...args) {
    registerClient(this);
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  CHANNEL_PINNED_MESSAGE_TYPE,
  cleanupPinNotifications,
  deletePinNotification,
  installPinNotificationCleanupHook,
};
