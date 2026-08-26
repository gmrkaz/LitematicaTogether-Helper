const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('./db');
const {
  clean, trunc, isStaff, isHigherStaff, isSupportStaff, isTicketAssignable, SUPPORT_ROLE_ID, base,
} = require('./common');
const { log } = require('./infra');

const TICKET_SUPERVISOR_ROLES = ['Owner', 'Co-Owner'];
const claimLocks = new Set();
const isTicketSupervisor = m => !!m && (
  m.guild.ownerId === m.id || m.roles.cache.some(r => TICKET_SUPERVISOR_ROLES.includes(r.name))
);

const ownerOverwrite = {
  ViewChannel: true,
  ReadMessageHistory: true,
  SendMessages: false,
  SendMessagesInThreads: true,
  AttachFiles: true,
  EmbedLinks: true,
  UseApplicationCommands: true,
};

async function fetchGuildMembers(guild) {
  return guild.members.fetch().catch(() => guild.members.cache);
}

async function addThreadMember(thread, id) {
  if (!id || id === thread.guild.members.me?.id) return;
  await thread.members.add(id).catch(() => {});
}

async function ticketForInteraction(i) {
  const existing = db.ticket(i.channelId);
  if (existing) return existing;
  if (!i.guild || !i.channel?.isThread?.()) return null;

  const cfg = db.guild(i.guild.id);
  if (!cfg.supportStaffChannelId || i.channel.parentId !== cfg.supportStaffChannelId) return null;
  if (i.channel.locked) return null;

  const messages = await i.channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages?.size) return null;

  const request = [...messages.values()].find(m =>
    m.author?.id === i.client.user.id
    && m.embeds?.some(e => e.title === 'Support Request' && /^User ID:\s*\d+$/.test(e.footer?.text || ''))
  );
  if (!request) return null;

  const requestEmbed = request.embeds.find(e => e.title === 'Support Request');
  const ownerId = requestEmbed?.footer?.text?.match(/^User ID:\s*(\d+)$/)?.[1];
  if (!ownerId) return null;

  const claimMessage = [...messages.values()]
    .filter(m => m.author?.id === i.client.user.id && /Ticket claimed by <@\d+>/.test(m.content || ''))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
  const claimedBy = claimMessage?.content?.match(/Ticket claimed by <@(\d+)>/)?.[1] || null;

  const recovered = {
    threadId: i.channelId,
    guildId: i.guild.id,
    userId: ownerId,
    status: 'open',
    createdAt: request.createdTimestamp || Date.now(),
    claimedBy,
    claimedAt: claimMessage?.createdTimestamp || null,
    addedMembers: [],
    name: i.channel.name,
    recoveredAt: Date.now(),
  };
  db.putTicket(i.channelId, recovered);
  return recovered;
}

async function seedUnclaimedTicket(thread, guild, ownerId) {
  const members = await fetchGuildMembers(guild);
  await addThreadMember(thread, ownerId);
  for (const member of members.values()) {
    if (member.user.bot) continue;
    if (isTicketSupervisor(member) || isSupportStaff(member)) await addThreadMember(thread, member.id);
  }
}

async function pruneClaimedSupport(thread, guild, ticket, claimerId) {
  const added = new Set(ticket.addedMembers || []);
  const members = await fetchGuildMembers(guild);
  const threadMembers = await thread.members.fetch().catch(() => new Map());

  for (const tm of threadMembers.values()) {
    const id = tm.id;
    if (!id || id === ticket.userId || id === claimerId || added.has(id) || id === guild.members.me?.id) continue;
    const member = members.get(id) || await guild.members.fetch(id).catch(() => null);
    if (!member) continue;
    if (isTicketSupervisor(member)) continue;
    if (isSupportStaff(member) || isHigherStaff(member)) {
      await thread.members.remove(id, 'Ticket claimed by another Support Team member').catch(() => {});
    }
  }
}

async function syncTicketAccess(guild) {
  const cfg = db.guild(guild.id);
  const hub = cfg.supportStaffChannelId ? await guild.channels.fetch(cfg.supportStaffChannelId).catch(() => null) : null;
  const members = await fetchGuildMembers(guild);
  const supervisors = [...members.values()].filter(m => !m.user.bot && isTicketSupervisor(m));
  const support = [...members.values()].filter(m => !m.user.bot && isSupportStaff(m));

  for (const ticket of Object.values(db.data.tickets)) {
    if (ticket.guildId !== guild.id || ticket.status !== 'open') continue;
    const threadId = ticket.threadId || ticket.channelId;
    if (!threadId) continue;
    const thread = await guild.channels.fetch(threadId).catch(() => null);
    if (!thread?.isThread()) continue;

    if (hub?.permissionOverwrites) {
      await hub.permissionOverwrites.edit(ticket.userId, ownerOverwrite, { reason: 'Restore open Support ticket access' }).catch(() => {});
    }

    await addThreadMember(thread, ticket.userId);
    for (const member of supervisors) await addThreadMember(thread, member.id);
    for (const id of ticket.addedMembers || []) await addThreadMember(thread, id);

    if (ticket.claimedBy) {
      await addThreadMember(thread, ticket.claimedBy);
      await pruneClaimedSupport(thread, guild, ticket, ticket.claimedBy);
    } else {
      for (const member of support) await addThreadMember(thread, member.id);
    }
  }
}

async function openTicket(i) {
  const old = db.openTicketFor(i.guild.id, i.user.id);
  if (old) {
    const oldId = old.threadId || old.channelId;
    const th = oldId ? await i.guild.channels.fetch(oldId).catch(() => null) : null;
    if (th) return i.reply({ content: `You already have an open ticket: <#${th.id}>`, ephemeral: true });
    if (oldId) db.patchTicket(oldId, { status: 'closed' });
  }

  const c = db.guild(i.guild.id);
  const parent = await i.guild.channels.fetch(c.supportStaffChannelId).catch(() => null);
  if (!parent || parent.type !== ChannelType.GuildText) {
    return i.reply({ content: 'Support Staff is not configured. Staff should run /setup-server.', ephemeral: true });
  }

  const v = id => i.fields.getTextInputValue(id) || '—';
  await parent.permissionOverwrites.edit(i.user.id, ownerOverwrite, { reason: 'Open Support ticket' }).catch(() => {});

  const th = await parent.threads.create({
    name: `report-${clean(i.user.username)}`,
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 1440,
    reason: 'LTT Support ticket',
  });

  await seedUnclaimedTicket(th, i.guild, i.user.id);

  db.putTicket(th.id, {
    threadId: th.id,
    guildId: i.guild.id,
    userId: i.user.id,
    status: 'open',
    createdAt: Date.now(),
    claimedBy: null,
    addedMembers: [],
    name: th.name,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
  );

  await th.send({
    content: `<@&${SUPPORT_ROLE_ID}> <@${i.user.id}>`,
    allowedMentions: {
      users: [i.user.id],
      roles: [SUPPORT_ROLE_ID],
    },
    embeds: [new EmbedBuilder()
      .setTitle('Support Request')
      .addFields(
        { name: 'Topic', value: trunc(v('topic')) },
        { name: 'Versions', value: trunc(v('versions')) },
        { name: 'Problem / expected result', value: trunc(v('problem')) },
        { name: 'Already tried / reproduction', value: trunc(v('tried')) },
        { name: 'Extra', value: trunc(v('extra')) },
      )
      .setFooter({ text: `User ID: ${i.user.id}` })
      .setTimestamp()],
    components: [row],
  });

  await i.reply({ content: `Support request created: <#${th.id}>`, ephemeral: true });
  await log(i.guild, base('Support ticket opened').addFields(
    { name: 'User', value: `${i.user.tag} (${i.user.id})` },
    { name: 'Ticket', value: `<#${th.id}>` },
  ));
}

async function claimTicket(i) {
  const t = await ticketForInteraction(i);
  if (!t || t.status !== 'open') return i.reply({ content: 'Not an open ticket.', ephemeral: true });
  if (!isTicketSupervisor(i.member) && !isSupportStaff(i.member)) {
    return i.reply({ content: 'Only Support Team, Owner or Co-Owner can claim tickets.', ephemeral: true });
  }
  if (t.claimedBy) {
    if (t.claimedBy === i.user.id) return i.reply({ content: 'You already claimed this ticket.', ephemeral: true });
    return i.reply({ content: `This ticket is already claimed by <@${t.claimedBy}>.`, ephemeral: true });
  }
  if (claimLocks.has(i.channelId)) {
    return i.reply({ content: 'This ticket is being claimed by another support member right now.', ephemeral: true });
  }

  claimLocks.add(i.channelId);
  try {
    const latest = await ticketForInteraction(i);
    if (!latest || latest.status !== 'open') return i.reply({ content: 'Not an open ticket.', ephemeral: true });
    if (latest.claimedBy) {
      if (latest.claimedBy === i.user.id) return i.reply({ content: 'You already claimed this ticket.', ephemeral: true });
      return i.reply({ content: `This ticket is already claimed by <@${latest.claimedBy}>.`, ephemeral: true });
    }

    db.patchTicket(i.channelId, { claimedBy: i.user.id, claimedAt: Date.now() });
    await i.deferReply({ ephemeral: true });

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claimed').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
    );
    if (i.message?.editable) await i.message.edit({ components: [disabledRow] }).catch(() => {});

    const current = db.ticket(i.channelId);
    await pruneClaimedSupport(i.channel, i.guild, current, i.user.id);

    await i.channel.send({
      content: `🔒 Ticket claimed by <@${i.user.id}>. Other Support Team members were removed. Owner and Co-Owner keep access.`,
      allowedMentions: { users: [i.user.id] },
    }).catch(() => {});

    await i.editReply('Ticket claimed. Other Support Team members were removed from this ticket.');
    await log(i.guild, base('Support ticket claimed').addFields(
      { name: 'Ticket', value: `<#${i.channelId}>` },
      { name: 'Claimed by', value: `${i.user.tag} (${i.user.id})` },
    ));
  } finally {
    claimLocks.delete(i.channelId);
  }
}

function canManageTicket(member, ticket) {
  return isTicketSupervisor(member) || ticket.claimedBy === member.id;
}

async function addTicketMember(i) {
  const t = await ticketForInteraction(i);
  if (!t || t.status !== 'open') return i.reply({ content: 'Not an open ticket.', ephemeral: true });
  if (!canManageTicket(i.member, t)) {
    return i.reply({ content: t.claimedBy ? 'Only the staff member who claimed this ticket, Owner or Co-Owner can add people.' : 'Claim this ticket first.', ephemeral: true });
  }

  const user = i.options.getUser('user', true);
  const member = await i.guild.members.fetch(user.id).catch(() => null);
  if (!member) return i.reply({ content: 'That user is not a member of this server.', ephemeral: true });
  if (!isTicketAssignable(member)) {
    return i.reply({ content: 'You can only add Support / technical / higher staff members to a ticket.', ephemeral: true });
  }
  if (user.id === t.userId || user.id === t.claimedBy) {
    return i.reply({ content: 'That member already has access to this ticket.', ephemeral: true });
  }

  await i.channel.members.add(user.id, `Added to ticket by ${i.user.tag}`);
  const addedMembers = [...new Set([...(t.addedMembers || []), user.id])];
  db.patchTicket(i.channelId, { addedMembers });

  return i.reply({ content: `Added <@${user.id}> to this ticket.`, allowedMentions: { users: [user.id] } });
}

async function removeTicketMember(i) {
  const t = await ticketForInteraction(i);
  if (!t || t.status !== 'open') return i.reply({ content: 'Not an open ticket.', ephemeral: true });
  if (!canManageTicket(i.member, t)) {
    return i.reply({ content: 'Only the staff member who claimed this ticket, Owner or Co-Owner can remove added people.', ephemeral: true });
  }

  const user = i.options.getUser('user', true);
  if (user.id === t.userId) return i.reply({ content: 'You cannot remove the ticket owner.', ephemeral: true });
  if (user.id === t.claimedBy) return i.reply({ content: 'You cannot remove the staff member who claimed the ticket.', ephemeral: true });

  const member = await i.guild.members.fetch(user.id).catch(() => null);
  if (member && isTicketSupervisor(member)) return i.reply({ content: 'Owner and Co-Owner always keep access to tickets.', ephemeral: true });

  const addedMembers = t.addedMembers || [];
  if (!addedMembers.includes(user.id)) return i.reply({ content: 'That member was not manually added to this ticket.', ephemeral: true });

  await i.channel.members.remove(user.id, `Removed from ticket by ${i.user.tag}`).catch(() => {});
  db.patchTicket(i.channelId, { addedMembers: addedMembers.filter(id => id !== user.id) });

  return i.reply({ content: `Removed <@${user.id}> from this ticket.`, allowedMentions: { parse: [] } });
}

async function closeTicket(i) {
  const t = await ticketForInteraction(i);
  if (!t || t.status !== 'open') return i.reply({ content: 'This is not an open Support ticket.', ephemeral: true });
  if (i.user.id !== t.userId && !isTicketSupervisor(i.member) && !isStaff(i.member)) {
    return i.reply({ content: 'Only the ticket owner or staff can close this ticket.', ephemeral: true });
  }

  await i.deferReply({ ephemeral: true });
  const all = [];
  let before;
  for (let x = 0; x < 10; x++) {
    const b = await i.channel.messages.fetch({ limit: 100, before });
    if (!b.size) break;
    const a = [...b.values()];
    all.push(...a);
    before = a[a.length - 1].id;
    if (b.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const txt = all.map(m => {
    const embeds = m.embeds?.length ? ` [${m.embeds.map(e => e.title || e.description || 'embed').join(' | ')}]` : '';
    const files = m.attachments.size ? ` ${[...m.attachments.values()].map(a => `${a.name || 'attachment'}: ${a.url}`).join(' ')}` : '';
    return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag || 'Unknown'}: ${m.content || ''}${embeds}${files}`.trimEnd();
  }).join('\n');

  const cfg = db.guild(i.guild.id);
  const archiveId = cfg.ticketArchiveChannelId || cfg.supportStaffChannelId;
  const archive = await i.guild.channels.fetch(archiveId).catch(() => null);
  if (archive?.isTextBased()) {
    await archive.send({
      content: `Closed **${i.channel.name}** — opened by <@${t.userId}>, closed by <@${i.user.id}>`,
      files: [new AttachmentBuilder(Buffer.from(txt || 'No messages.', 'utf8'), { name: `${i.channel.name}.txt` })],
    });
  }

  db.patchTicket(i.channelId, { status: 'closed', closedAt: Date.now(), closedBy: i.user.id, transcriptSaved: true });
  await i.editReply('Ticket closed. The conversation was saved for staff.');

  const parent = i.channel.parent;
  if (parent?.permissionOverwrites) await parent.permissionOverwrites.delete(t.userId, 'Support ticket closed').catch(() => {});
  await i.channel.setLocked(true).catch(() => {});
  await i.channel.setArchived(true).catch(() => {});
  await log(i.guild, base('Support ticket closed').addFields(
    { name: 'Ticket', value: i.channel.name },
    { name: 'Closed by', value: `${i.user.tag} (${i.user.id})` },
  ));
}

module.exports = {
  openTicket,
  claimTicket,
  addTicketMember,
  removeTicketMember,
  closeTicket,
  syncTicketAccess,
};
