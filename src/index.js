'use strict';

// Keep the Discord gateway supervised even though this process also hosts the
// Litematica Together HTTP service. Without this, the HTTP server can keep the
// container alive while the Discord client is permanently offline.
const { Client } = require('discord.js');

const originalLogin = Client.prototype.login;
Client.prototype.login = function supervisedLogin(token) {
  const client = this;
  let wasReady = false;
  let offlineSince = 0;

  client.on('ready', () => {
    wasReady = true;
    offlineSince = 0;
    console.log('[DISCORD WATCHDOG] gateway ready');
  });

  client.on('shardDisconnect', (event, shardId) => {
    if (wasReady && !offlineSince) offlineSince = Date.now();
    console.error(`[DISCORD WATCHDOG] shard ${shardId} disconnected code=${event?.code ?? 'unknown'} reason=${event?.reason || 'none'}`);
  });

  client.on('shardReconnecting', shardId => {
    console.warn(`[DISCORD WATCHDOG] shard ${shardId} reconnecting`);
  });

  client.on('shardResume', (shardId, replayedEvents) => {
    offlineSince = 0;
    console.log(`[DISCORD WATCHDOG] shard ${shardId} resumed replayed=${replayedEvents}`);
  });

  const watchdog = setInterval(() => {
    if (client.isReady()) {
      offlineSince = 0;
      return;
    }

    if (!wasReady) return;
    if (!offlineSince) offlineSince = Date.now();

    const offlineMs = Date.now() - offlineSince;
    if (offlineMs >= 90_000) {
      console.error(`[DISCORD WATCHDOG] Discord stayed offline for ${Math.round(offlineMs / 1000)}s. Exiting so the host can restart the process.`);
      process.exit(1);
    }
  }, 15_000);
  watchdog.unref();

  return originalLogin.call(client, token).catch(error => {
    console.error('[DISCORD LOGIN FATAL]', error);
    process.exit(1);
  });
};

require('./ltt-service');
require('./bot');
