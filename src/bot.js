const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');
const db = require('./db');
const { commands, donationPayload, trunc, duration, base } = require('./common');
const { ensureInfrastructure, postPanel, log } = require('./infra');
const {
  ensureCommunityInfrastructure, applyHiddenRoleToChannel, syncHiddenMemberRoleChange,
  sendWelcomeNotification,
} = require('./community');
const { ensureOnboardingInfrastructure } = require('./onboarding');
const { normalizeInternationalVoice } = require('./voice-layout');
const { ensureLanguageCommunity } = require('./language-community');
const { cleanupGithubChannels } = require('./channel-cleanup');
const { cleanupLegacyCommunity } = require('./legacy-community-cleanup');
const {
  ensureProjectInfrastructure, projectSupportModal, styleSupportPanel,
} = require('./project-layout');
const { startModrinthWatcher } = require('./modrinth-watch');
const {
  openTicket, claimTicket, closeTicket, addTicketMember, removeTicketMember, syncTicketAccess,
} = require('./support');

const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
const TARGET = process.env.GUILD_ID || null;
const AUTO = String(process.env.AUTO_SETUP || 'true').toLowerCase() !== 'false';
if (!TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});
const joins = new Map();

async function prepareGuild(guild, { forcePanel = false } = {}) {
  await guild.commands.set(commands);
  if (AUTO || forcePanel) {
    await ensureInfrastructure(guild, { forcePanel });
    await syncTicketAccess(guild);
    await ensureCommunityInfrastructure(guild, {
      supportChannelId: db.guild(guild.id).supportChannelId,
    });
    await ensureOnboardingInfrastructure(guild);
    await normalizeInternationalVoice(guild);
    await ensureLanguageCommunity(guild);
    await cleanupLegacyCommunity(guild);
    await cleanupGithubChannels(guild);
    await ensureProjectInfrastructure(guild);
  } else {
    await syncTicketAccess(guild);
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`[READY] Logged in as ${c.user.tag}`);
  for (const g of c.guilds.cache.values()) {
    if (TARGET && g.id !== TARGET) continue;
    try {
      await prepareGuild(g);
      console.log(`[SETUP] Dual-mod infrastructure, RU/GB community, projects, onboarding and ticket access ready in ${g.name}`);
    } catch (e) {
      console.error(`[SETUP] ${g.name}`, e);
    }
  }
  startModrinthWatcher(c, TARGET);
});

client.on(Events.GuildCreate, async g => {
  if (TARGET && g.id !== TARGET) return;
  await prepareGuild(g).catch(console.error);
});

client.on(Events.InteractionCreate, async i => {
  try {
    if (!i.inGuild()) return;

    if (i.isButton()) {
      if (i.customId === 'donate_show') return i.reply({ ...donationPayload(), ephemeral: true });
      if (i.customId === 'support_open' || i.customId === 'support_open_ltt') {
        return i.showModal(projectSupportModal('ltt'));
      }
      if (i.customId === 'support_open_st') {
        return i.showModal(projectSupportModal('simpleTranslator'));
      }
      if (i.customId === 'ticket_close') return closeTicket(i);
      if (i.customId === 'ticket_claim') return claimTicket(i);
    }

    if (i.isModalSubmit() && i.customId === 'support_modal') return openTicket(i);
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'donate') return i.reply(donationPayload());
    if (i.commandName === 'status') {
      return i.reply({
        content: `HELPER is online.\nProjects: Litematica Together + Simple Translator\nUptime: ${Math.floor(process.uptime())}s\nOpen tickets: ${Object.values(db.data.tickets).filter(t => t.guildId === i.guild.id && t.status === 'open').length}`,
        ephemeral: true,
      });
    }

    if (i.commandName === 'setup-server') {
      await i.deferReply({ ephemeral: true });
      await ensureInfrastructure(i.guild, { forcePanel: true });
      await syncTicketAccess(i.guild);
      await ensureCommunityInfrastructure(i.guild, {
        supportChannelId: db.guild(i.guild.id).supportChannelId,
      });
      const onboarding = await ensureOnboardingInfrastructure(i.guild);
      await normalizeInternationalVoice(i.guild);
      await ensureLanguageCommunity(i.guild);
      await cleanupLegacyCommunity(i.guild);
      await cleanupGithubChannels(i.guild);
      await ensureProjectInfrastructure(i.guild);
      const nativeState = onboarding.onboarding?.enabled ? 'enabled' : 'configured but not enabled';
      return i.editReply(`Litematica Together + Simple Translator, COMMUNITY RU/GB, project sections, Support, native onboarding (${nativeState}), language voice rooms and monitoring are ready.`);
    }

    if (i.commandName === 'support-panel') {
      const ch = await i.guild.channels.fetch(db.guild(i.guild.id).supportChannelId).catch(() => null);
      if (!ch) return i.reply({ content: 'Run /setup-server first.', ephemeral: true });
      await postPanel(ch);
      await styleSupportPanel(i.guild);
      return i.reply({ content: 'Dual-project Support panel posted.', ephemeral: true });
    }

    if (i.commandName === 'ticket-close') return closeTicket(i);
    if (i.commandName === 'ticket-add') return addTicketMember(i);
    if (i.commandName === 'ticket-remove') return removeTicketMember(i);

    if (i.commandName === 'warn') {
      const u = i.options.getUser('user', true);
      const r = i.options.getString('reason', true);
      const a = db.addWarning(i.guild.id, u.id, { reason: r, by: i.user.id, at: Date.now() });
      await i.reply({ content: `Warned ${u.tag}. Total: ${a.length}`, ephemeral: true });
      return log(i.guild, base('Warning issued').addFields(
        { name: 'Member', value: `${u.tag} (${u.id})` },
        { name: 'Reason', value: trunc(r) },
        { name: 'Moderator', value: i.user.tag },
      ));
    }

    if (i.commandName === 'warnings') {
      const u = i.options.getUser('user', true);
      const a = db.warnings(i.guild.id, u.id);
      return i.reply({
        content: a.length ? a.map((w, n) => `${n + 1}. ${w.reason} — <@${w.by}>`).join('\n') : 'No warnings.',
        ephemeral: true,
      });
    }

    if (i.commandName === 'clear-warnings') {
      const u = i.options.getUser('user', true);
      db.clearWarnings(i.guild.id, u.id);
      return i.reply({ content: `Warnings cleared for ${u.tag}.`, ephemeral: true });
    }

    if (i.commandName === 'timeout') {
      const u = i.options.getUser('user', true);
      const ms = duration(i.options.getString('duration', true));
      const r = i.options.getString('reason', true);
      if (!ms) return i.reply({ content: 'Use duration like 10m, 2h or 1d.', ephemeral: true });
      const m = await i.guild.members.fetch(u.id);
      await m.timeout(ms, r);
      await i.reply({ content: `Timed out ${u.tag}.`, ephemeral: true });
      return log(i.guild, base('Member timed out').addFields(
        { name: 'Member', value: `${u.tag} (${u.id})` },
        { name: 'Reason', value: trunc(r) },
        { name: 'Moderator', value: i.user.tag },
      ));
    }

    if (i.commandName === 'untimeout') {
      const u = i.options.getUser('user', true);
      const m = await i.guild.members.fetch(u.id);
      await m.timeout(null, `Removed by ${i.user.tag}`);
      await i.reply({ content: `Timeout removed from ${u.tag}.`, ephemeral: true });
    }

    if (i.commandName === 'purge') {
      if (!i.channel.bulkDelete) return i.reply({ content: 'Not supported here.', ephemeral: true });
      const d = await i.channel.bulkDelete(i.options.getInteger('amount', true), true);
      return i.reply({ content: `Deleted ${d.size} messages.`, ephemeral: true });
    }

    if (i.commandName === 'settings') {
      const c = db.guild(i.guild.id);
      for (const [o, k] of [
        ['log_messages', 'logMessages'],
        ['log_voice', 'logVoice'],
        ['raid_threshold', 'raidThreshold'],
        ['raid_window_seconds', 'raidWindowSeconds'],
      ]) {
        const v = o.startsWith('log_') ? i.options.getBoolean(o) : i.options.getInteger(o);
        if (v !== null) c[k] = v;
      }
      db.save();
      return i.reply({
        content: `Saved. Message logs: ${c.logMessages}; voice logs: ${c.logVoice}; raid: ${c.raidThreshold}/${c.raidWindowSeconds}s`,
        ephemeral: true,
      });
    }
  } catch (e) {
    console.error('[INTERACTION]', e);
    if (i.isRepliable()) {
      const p = { content: `Error: ${trunc(e.message, 1500)}`, ephemeral: true };
      if (i.replied || i.deferred) await i.editReply(p).catch(() => {});
      else await i.reply(p).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberAdd, async m => {
  if (m.user.bot) return;
  const c = db.guild(m.guild.id);
  const now = Date.now();
  const win = c.raidWindowSeconds * 1000;
  const a = (joins.get(m.guild.id) || []).filter(x => now - x <= win);
  a.push(now);
  joins.set(m.guild.id, a);

  await sendWelcomeNotification(m).catch(e => console.error('[WELCOME]', e));
  await log(m.guild, base('Member joined').addFields(
    { name: 'Member', value: `${m.user.tag} (${m.id})` },
    { name: 'Account age', value: `${Math.floor((now - m.user.createdTimestamp) / 86400000)} day(s)` },
  ));
  if (a.length >= c.raidThreshold) {
    await log(m.guild, base('Possible raid / join spike').setDescription(`**${a.length} joins** in **${c.raidWindowSeconds}s**.`));
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  await syncHiddenMemberRoleChange(oldMember, newMember).catch(e => console.error('[HIDDEN MEMBER]', e));
});

client.on(Events.GuildMemberRemove, m => {
  if (!m.user?.bot) log(m.guild, base('Member left').addFields({ name: 'Member', value: `${m.user?.tag || 'Unknown'} (${m.id})` }));
});
client.on(Events.GuildBanAdd, b => log(b.guild, base('Member banned').addFields({ name: 'User', value: `${b.user.tag} (${b.user.id})` })));
client.on(Events.GuildBanRemove, b => log(b.guild, base('Member unbanned').addFields({ name: 'User', value: `${b.user.tag} (${b.user.id})` })));
client.on(Events.ChannelCreate, async c => {
  if (!c.guild) return;
  await applyHiddenRoleToChannel(c).catch(e => console.error('[HIDDEN ROLE]', e));
  return log(c.guild, base('Channel created').addFields({ name: 'Channel', value: `${c.name} (${c.id})` }));
});
client.on(Events.ChannelDelete, c => c.guild && log(c.guild, base('Channel deleted').addFields({ name: 'Channel', value: `${c.name} (${c.id})` })));
client.on(Events.GuildRoleCreate, r => log(r.guild, base('Role created').addFields({ name: 'Role', value: `${r.name} (${r.id})` })));
client.on(Events.GuildRoleDelete, r => log(r.guild, base('Role deleted').addFields({ name: 'Role', value: `${r.name} (${r.id})` })));

client.on(Events.MessageDelete, m => {
  if (!m.guild || m.author?.bot || !db.guild(m.guild.id).logMessages) return;
  log(m.guild, base('Message deleted').addFields(
    { name: 'Author', value: m.author ? `${m.author.tag} (${m.author.id})` : 'Unknown' },
    { name: 'Channel', value: `<#${m.channelId}>` },
    { name: 'Content', value: trunc(m.content || '[unavailable]') },
  ));
});

client.on(Events.MessageUpdate, (o, n) => {
  if (!n.guild || n.author?.bot || !db.guild(n.guild.id).logMessages || o.content === n.content) return;
  log(n.guild, base('Message edited').addFields(
    { name: 'Author', value: n.author ? `${n.author.tag} (${n.author.id})` : 'Unknown' },
    { name: 'Channel', value: `<#${n.channelId}>` },
    { name: 'Before', value: trunc(o.content || '[unavailable]') },
    { name: 'After', value: trunc(n.content || '[unavailable]') },
  ));
});

client.on(Events.VoiceStateUpdate, (o, n) => {
  const g = n.guild || o.guild;
  if (!g || !db.guild(g.id).logVoice || o.channelId === n.channelId) return;
  const a = !o.channelId ? 'Voice joined' : !n.channelId ? 'Voice left' : 'Voice moved';
  log(g, base(a).addFields(
    { name: 'Member', value: `${n.member?.user.tag || o.member?.user.tag || 'Unknown'} (${n.id})` },
    { name: 'From', value: o.channelId ? `<#${o.channelId}>` : '—' },
    { name: 'To', value: n.channelId ? `<#${n.channelId}>` : '—' },
  ));
});

client.on(Events.ThreadDelete, t => {
  if (db.ticket(t.id)) db.patchTicket(t.id, { status: 'closed' });
});
client.on(Events.Error, e => console.error('[CLIENT]', e));
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e));
process.on('uncaughtException', e => console.error('[UNCAUGHT]', e));

client.login(TOKEN);
