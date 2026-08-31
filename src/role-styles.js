'use strict';

const { Client, Events } = require('discord.js');

const installed = Symbol.for('ltt.enhancedRoleStylesInstalled');

const HOLOGRAPHIC = {
  primaryColor: 11127295,
  secondaryColor: 16759788,
  tertiaryColor: 16761760,
};

const ROLE_STYLES = [
  {
    names: ['owner'],
    style: HOLOGRAPHIC,
  },
  {
    names: ['co-owner', 'co owner'],
    style: { primaryColor: '#FF4FD8', secondaryColor: '#8B5CF6' },
  },
  {
    ids: ['1540936192672006216'],
    names: ['administrator', 'admin'],
    style: { primaryColor: '#FF3B30', secondaryColor: '#FF9500' },
  },
  {
    ids: ['1540936194953584704'],
    names: ['moderator', 'mod'],
    style: { primaryColor: '#5865F2', secondaryColor: '#22D3EE' },
  },
  {
    ids: ['1540936197168431224'],
    names: ['developer', 'dev', 'tech team', 'technical team'],
    style: { primaryColor: '#7C3AED', secondaryColor: '#06B6D4' },
  },
  {
    ids: ['1540936200859291699'],
    names: ['design', 'designer'],
    style: { primaryColor: '#EC4899', secondaryColor: '#8B5CF6' },
  },
  {
    ids: ['1540936203744972992'],
    names: ['contributor'],
    style: { primaryColor: '#22C55E', secondaryColor: '#14B8A6' },
  },
  {
    names: ['support team', 'support', 'helper'],
    style: { primaryColor: '#0EA5E9', secondaryColor: '#5865F2' },
  },
  {
    names: ['русский', 'russian'],
    style: { primaryColor: '#4F7CFF', secondaryColor: '#EF4444' },
  },
  {
    names: ['english'],
    style: { primaryColor: '#2563EB', secondaryColor: '#DC2626' },
  },
  {
    names: ['server booster'],
    style: { primaryColor: '#F47FFF', secondaryColor: '#FF73FA' },
  },
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

function hexToInt(value) {
  if (typeof value === 'number') return value;
  return Number.parseInt(String(value).replace('#', ''), 16);
}

function desiredNumbers(style) {
  return {
    primaryColor: hexToInt(style.primaryColor),
    secondaryColor: style.secondaryColor == null ? null : hexToInt(style.secondaryColor),
    tertiaryColor: style.tertiaryColor == null ? null : hexToInt(style.tertiaryColor),
  };
}

function styleForRole(role) {
  const name = normalize(role.name);
  return ROLE_STYLES.find(entry => (
    entry.ids?.includes(role.id)
    || entry.names.some(candidate => normalize(candidate) === name)
  )) || null;
}

function alreadyStyled(role, style) {
  if (!role.colors) return false;
  const desired = desiredNumbers(style);
  return role.colors.primaryColor === desired.primaryColor
    && role.colors.secondaryColor === desired.secondaryColor
    && role.colors.tertiaryColor === desired.tertiaryColor;
}

async function applyStyle(role, entry) {
  if (!role || role.name === '@everyone' || role.name === 'Hidden') return 'ignored';
  if (role.managed) return 'managed';
  if (!role.editable) return 'not-editable';
  if (typeof role.setColors !== 'function') return 'unsupported';
  if (alreadyStyled(role, entry.style)) return 'unchanged';

  await role.setColors(entry.style, 'LTT HELPER: apply Enhanced Role Style');
  return 'updated';
}

async function applyEnhancedRoleStyles(guild) {
  await guild.roles.fetch();

  const summary = {
    updated: [],
    unchanged: [],
    skipped: [],
    failed: [],
  };

  for (const role of guild.roles.cache.values()) {
    const entry = styleForRole(role);
    if (!entry) continue;

    try {
      const result = await applyStyle(role, entry);
      if (result === 'updated') summary.updated.push(role.name);
      else if (result === 'unchanged') summary.unchanged.push(role.name);
      else summary.skipped.push(`${role.name}:${result}`);
    } catch (error) {
      summary.failed.push(`${role.name}:${String(error.message || error).slice(0, 180)}`);
    }
  }

  console.log(
    `[ROLE STYLES] ${guild.name}: updated=${summary.updated.length}, unchanged=${summary.unchanged.length}, skipped=${summary.skipped.length}, failed=${summary.failed.length}`,
  );
  if (summary.updated.length) console.log(`[ROLE STYLES] updated: ${summary.updated.join(', ')}`);
  if (summary.skipped.length) console.warn(`[ROLE STYLES] skipped: ${summary.skipped.join(', ')}`);
  if (summary.failed.length) console.warn(`[ROLE STYLES] failed: ${summary.failed.join(' | ')}`);

  return summary;
}

function registerClient(client) {
  client.once(Events.ClientReady, async readyClient => {
    for (const guild of readyClient.guilds.cache.values()) {
      await applyEnhancedRoleStyles(guild).catch(error => {
        console.warn(`[ROLE STYLES] ${guild.name}: ${error.message}`);
      });
    }
  });

  client.on(Events.GuildRoleCreate, async role => {
    const entry = styleForRole(role);
    if (!entry) return;
    await applyStyle(role, entry).catch(error => {
      console.warn(`[ROLE STYLES] ${role.guild.name}/${role.name}: ${error.message}`);
    });
  });
}

function installRoleStylesHook() {
  if (Client.prototype[installed]) return;
  Client.prototype[installed] = true;

  const originalLogin = Client.prototype.login;
  Client.prototype.login = function patchedLogin(...args) {
    registerClient(this);
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  HOLOGRAPHIC,
  ROLE_STYLES,
  applyEnhancedRoleStyles,
  installRoleStylesHook,
};
