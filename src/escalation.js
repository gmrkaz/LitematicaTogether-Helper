const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db');

const ROLE_CALLS = {
  ticket_call_developer: { label: 'Developer', roleId: '1540936197168431224' },
  ticket_call_design: { label: 'Design', roleId: '1540936200859291699' },
  ticket_call_contributor: { label: 'Contributor', roleId: '1540936203744972992' },
  ticket_call_moderator: { label: 'Moderator', roleId: '1540936194953584704' },
  ticket_call_administrator: { label: 'Administrator', roleId: '1540936192672006216' },
};

const OWNER_CALL_ID = 'ticket_call_ametist';
const OWNER_DISCORD_ID = '1435432634900811779';
const CALL_COOLDOWN_MS = Number(process.env.TICKET_CALL_COOLDOWN_MS || 10 * 60 * 1000);
const SUPERVISOR_ROLES = ['Owner', 'Co-Owner'];

function escalationRows() {
  return [
    new ActionRowBuilder().addComponents(
      ...Object.entries(ROLE_CALLS).map(([customId, cfg]) =>
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(cfg.label)
          .setStyle(ButtonStyle.Secondary)
      ),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(OWNER_CALL_ID)
        .setLabel('Ametist1k')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function isSupervisor(member) {
  return !!member && (
    member.guild.ownerId === member.id
    || member.roles.cache.some(r => SUPERVISOR_ROLES.includes(r.name))
  );
}

function canEscalate(member, ticket) {
  return isSupervisor(member) || ticket.claimedBy === member.id;
}

function cooldownRemaining(ticket, key) {
  const last = Number(ticket.escalations?.[key] || 0);
  return Math.max(0, CALL_COOLDOWN_MS - (Date.now() - last));
}

function markEscalation(channelId, ticket, key) {
  db.patchTicket(channelId, {
    escalations: {
      ...(ticket.escalations || {}),
      [key]: Date.now(),
    },
  });
}

async function addRoleMembersToThread(i, roleId, ticket) {
  const members = await i.guild.members.fetch().catch(() => i.guild.members.cache);
  const added = new Set(ticket.addedMembers || []);

  for (const member of members.values()) {
    if (member.user.bot || !member.roles.cache.has(roleId)) continue;
    await i.channel.members.add(member.id).catch(() => {});
    added.add(member.id);
  }

  db.patchTicket(i.channelId, { addedMembers: [...added] });
}

async function callRole(i, ticket, cfg) {
  await addRoleMembersToThread(i, cfg.roleId, ticket);
  markEscalation(i.channelId, ticket, cfg.roleId);

  await i.channel.send({
    content: `📣 <@&${cfg.roleId}> requested by <@${i.user.id}> for this ticket.`,
    allowedMentions: { roles: [cfg.roleId], users: [i.user.id] },
  });

  return i.reply({ content: `${cfg.label} called.`, ephemeral: true });
}

async function callOwnerTelegram(i, ticket) {
  const token = process.env.TELEGRAM_OWNER_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) {
    return i.reply({
      content: 'Telegram owner notifications are not configured yet. Set TELEGRAM_OWNER_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID on the host.',
      ephemeral: true,
    });
  }

  const link = `https://discord.com/channels/${i.guild.id}/${i.channelId}`;
  const text = [
    '🚨 Litematica Together — owner requested',
    `Server: ${i.guild.name}`,
    `Ticket: ${i.channel.name}`,
    `Requested by: ${i.user.tag} (${i.user.id})`,
    `Ticket owner Discord ID: ${ticket.userId}`,
    `Open ticket: ${link}`,
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(`Telegram notification failed: ${body?.description || response.status}`);
  }

  markEscalation(i.channelId, ticket, OWNER_DISCORD_ID);
  await i.channel.send({
    content: `📲 Ametist1k was notified in Telegram by <@${i.user.id}>.`,
    allowedMentions: { users: [i.user.id] },
  });
  return i.reply({ content: 'Request sent to Ametist1k in Telegram.', ephemeral: true });
}

async function handleTicketEscalation(i) {
  const cfg = ROLE_CALLS[i.customId];
  const isOwnerCall = i.customId === OWNER_CALL_ID;
  if (!cfg && !isOwnerCall) return false;

  const ticket = db.ticket(i.channelId);
  if (!ticket || ticket.status !== 'open') {
    await i.reply({ content: 'This is not an open Support ticket.', ephemeral: true });
    return true;
  }
  if (!canEscalate(i.member, ticket)) {
    await i.reply({
      content: ticket.claimedBy
        ? 'Only the assigned support member, Owner or Co-Owner can call another team.'
        : 'Claim the ticket first before calling another team.',
      ephemeral: true,
    });
    return true;
  }

  const key = isOwnerCall ? OWNER_DISCORD_ID : cfg.roleId;
  const left = cooldownRemaining(ticket, key);
  if (left > 0) {
    await i.reply({
      content: `That team was already called recently. Try again in ${Math.ceil(left / 60000)} minute(s).`,
      ephemeral: true,
    });
    return true;
  }

  if (isOwnerCall) await callOwnerTelegram(i, ticket);
  else await callRole(i, ticket, cfg);
  return true;
}

module.exports = {
  escalationRows,
  handleTicketEscalation,
};
