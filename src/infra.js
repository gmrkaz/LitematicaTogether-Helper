const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder,
  PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const db = require('./db');
const { HIGH_STAFF, TECH_STAFF } = require('./common');

const TICKET_SUPERVISOR_ROLES = ['Owner', 'Co-Owner'];
const roleByName = (g, n) => g.roles.cache.find(r => r.name === n);
const channelByName = (g, n, t) => g.channels.cache.find(c => c.name === n && (!t || t.includes(c.type)));

async function ensureRole(g, name, permissions = []) {
  return roleByName(g, name) || g.roles.create({ name, permissions, hoist: true, reason: 'LTT HELPER infrastructure' });
}
async function ensureCat(g, name) {
  return channelByName(g, name, [ChannelType.GuildCategory]) || g.channels.create({ name, type: ChannelType.GuildCategory, reason: 'LTT HELPER infrastructure' });
}

function panelPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setTitle('Litematica Together Support')
      .setDescription('All project questions go through Support: bugs, installation, connection, synchronization, compatibility, suggestions and general questions.\n\nPress **Open Support Request** and fill in the short form.')
      .setFooter({ text: 'One open ticket per user.' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('support_open').setLabel('Open Support Request').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('donate_show').setLabel('Donate').setStyle(ButtonStyle.Success),
    )],
  };
}
async function postPanel(ch) { await ch.send(panelPayload()); }

async function ensureInfrastructure(g, { forcePanel = false } = {}) {
  await g.roles.fetch();
  await g.channels.fetch();
  const cfg = db.guild(g.id);

  const supportRole = await ensureRole(g, 'Support Team', [PermissionFlagsBits.UseApplicationCommands]);

  // Support Team must NOT have ManageThreads globally: otherwise claimed private tickets remain visible.
  if (supportRole.permissions.has(PermissionFlagsBits.ManageThreads) && !supportRole.permissions.has(PermissionFlagsBits.Administrator)) {
    await supportRole.setPermissions(
      supportRole.permissions.remove(PermissionFlagsBits.ManageThreads),
      'LTT HELPER: claimed tickets are private to the assigned support member',
    ).catch(() => {});
  }

  const supportCat = await ensureCat(g, 'SUPPORT');
  const staffCat = await ensureCat(g, 'STAFF');

  const staffAllow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.UseApplicationCommands,
  ];
  const highStaffAllow = [...staffAllow, PermissionFlagsBits.ManageThreads];

  const staffPO = [
    { id: g.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: supportRole.id, allow: staffAllow },
  ];
  for (const n of HIGH_STAFF) {
    const r = roleByName(g, n);
    if (r) staffPO.push({ id: r.id, allow: highStaffAllow });
  }
  for (const n of TECH_STAFF) {
    const r = roleByName(g, n);
    if (r) staffPO.push({ id: r.id, allow: staffAllow });
  }

  // Ticket hub is stricter than the rest of STAFF: only Owner / Co-Owner may ManageThreads.
  // Everyone else can see the parent but needs explicit private-thread membership.
  const ticketPO = [
    { id: g.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: supportRole.id, allow: staffAllow },
  ];
  for (const n of HIGH_STAFF) {
    const r = roleByName(g, n);
    if (!r) continue;
    ticketPO.push({
      id: r.id,
      allow: TICKET_SUPERVISOR_ROLES.includes(n) ? highStaffAllow : staffAllow,
      deny: TICKET_SUPERVISOR_ROLES.includes(n) ? [] : [PermissionFlagsBits.ManageThreads],
    });
  }
  for (const n of TECH_STAFF) {
    const r = roleByName(g, n);
    if (r) ticketPO.push({ id: r.id, allow: staffAllow, deny: [PermissionFlagsBits.ManageThreads] });
  }
  if (g.members.me?.id) {
    ticketPO.push({
      id: g.members.me.id,
      allow: [...highStaffAllow, PermissionFlagsBits.MentionEveryone],
    });
  }

  const highOnlyPO = [{ id: g.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
  for (const n of HIGH_STAFF) {
    const r = roleByName(g, n);
    if (r) highOnlyPO.push({ id: r.id, allow: highStaffAllow });
  }

  let mod = channelByName(g, 'mod-log', [ChannelType.GuildText])
    || await g.channels.create({
      name: 'mod-log',
      type: ChannelType.GuildText,
      parent: staffCat.id,
      permissionOverwrites: staffPO,
      topic: 'Private HELPER monitoring log.',
    });
  await mod.permissionOverwrites.set(staffPO).catch(() => {});

  // Migrate the old transcript/discussion channel once. A fresh support-staff channel is used only as a ticket hub.
  let oldInternal = null;
  if (!cfg.ticketHubReady) {
    oldInternal = channelByName(g, 'support-staff', [ChannelType.GuildText]);
    if (oldInternal) {
      await oldInternal.setName('support-archive-old', 'LTT HELPER: migrate old Support Staff channel').catch(() => {});
      await oldInternal.setParent(staffCat.id, { lockPermissions: false }).catch(() => {});
      await oldInternal.permissionOverwrites.set(highOnlyPO).catch(() => {});
    }
  }

  let ticketHub = channelByName(g, 'support-staff', [ChannelType.GuildText]);
  if (!ticketHub) {
    ticketHub = await g.channels.create({
      name: 'support-staff',
      type: ChannelType.GuildText,
      parent: staffCat.id,
      permissionOverwrites: ticketPO,
      topic: 'Unclaimed tickets ping Support Team. After claim only the assignee, ticket owner, Owner/Co-Owner and explicitly added staff retain access.',
    });
  } else {
    await ticketHub.setParent(staffCat.id, { lockPermissions: false }).catch(() => {});
    await ticketHub.permissionOverwrites.set(ticketPO).catch(() => {});
    await ticketHub.setTopic('Unclaimed tickets ping Support Team. After claim only the assignee, ticket owner, Owner/Co-Owner and explicitly added staff retain access.').catch(() => {});
  }

  let archive = channelByName(g, 'ticket-archive', [ChannelType.GuildText]);
  if (!archive) {
    archive = await g.channels.create({
      name: 'ticket-archive',
      type: ChannelType.GuildText,
      parent: staffCat.id,
      permissionOverwrites: highOnlyPO,
      topic: 'Closed Support transcripts. Higher staff only.',
    });
  } else {
    await archive.setParent(staffCat.id, { lockPermissions: false }).catch(() => {});
    await archive.permissionOverwrites.set(highOnlyPO).catch(() => {});
    await archive.setTopic('Closed Support transcripts. Higher staff only.').catch(() => {});
  }

  let support = channelByName(g, 'support', [ChannelType.GuildText]);
  if (!support) {
    support = await g.channels.create({
      name: 'support',
      type: ChannelType.GuildText,
      parent: supportCat.id,
      topic: 'All bugs, questions, installation, connection, sync, compatibility and suggestions.',
      permissionOverwrites: [
        {
          id: g.roles.everyone.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.UseApplicationCommands,
          ],
          deny: [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.CreatePrivateThreads,
          ],
        },
        {
          id: supportRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.SendMessagesInThreads,
          ],
        },
      ],
    });
  }

  Object.assign(cfg, {
    supportChannelId: support.id,
    modLogChannelId: mod.id,
    supportStaffChannelId: ticketHub.id,
    ticketArchiveChannelId: archive.id,
    supportRoleId: supportRole.id,
    ticketHubReady: true,
  });
  db.save();

  const recent = await support.messages.fetch({ limit: 50 }).catch(() => null);
  const has = recent && recent.some(m => m.author.id === g.client.user.id
    && m.components.some(r => r.components.some(b => b.customId === 'support_open')));
  if (forcePanel || !has) await postPanel(support);

  return { support, mod, ticketHub, archive, supportRole };
}

function supportModal() {
  const m = new ModalBuilder().setCustomId('support_modal').setTitle('Litematica Together Support');
  const rows = [
    ['topic', 'What do you need help with?', TextInputStyle.Short, 'Bug / Question / Install / Sync / Suggestion', true],
    ['versions', 'Versions', TextInputStyle.Short, 'LTT, Minecraft, Litematica, MaLiLib', true],
    ['problem', 'What happened?', TextInputStyle.Paragraph, 'Describe the issue and expected result.', true],
    ['tried', 'What have you already tried?', TextInputStyle.Paragraph, 'Steps tried or reproduction steps.', false],
    ['extra', 'Extra information', TextInputStyle.Paragraph, 'Attach logs/screenshots after creation.', false],
  ];
  for (const [id, label, style, ph, req] of rows) {
    m.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setPlaceholder(ph)
        .setRequired(req)
        .setMaxLength(style === TextInputStyle.Short ? 200 : 1000),
    ));
  }
  return m;
}

async function log(g, embed) {
  const id = db.guild(g.id).modLogChannelId;
  if (!id) return;
  const ch = await g.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { ensureInfrastructure, postPanel, supportModal, log };
