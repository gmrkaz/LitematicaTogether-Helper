const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const HIGH_STAFF = ['Owner','Co-Owner','Administrator','Moderator'];
const TECH_STAFF = ['Developer','Tech Team','Technical Team'];
const SUPPORT_ROLE = 'Support Team';
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID || '1540936198988759080';
const STAFF = [...HIGH_STAFF, ...TECH_STAFF, SUPPORT_ROLE];

const trunc = (v, n=1000) => { const s = String(v || '—'); return s.length > n ? `${s.slice(0,n-1)}…` : s; };
const clean = v => String(v || 'user').toLowerCase().replace(/[^a-z0-9-_]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,24) || 'user';
const base = title => new EmbedBuilder().setTitle(title).setTimestamp();
const hasNamedRole = (m, names) => !!m?.roles?.cache?.some(r => names.includes(r.name));
const isHigherStaff = m => !!m && (m.guild.ownerId === m.id || m.permissions.has(PermissionFlagsBits.Administrator) || hasNamedRole(m, HIGH_STAFF));
const isSupportStaff = m => !!m && (m.roles.cache.has(SUPPORT_ROLE_ID) || hasNamedRole(m, [SUPPORT_ROLE]));
const isTechnicalStaff = m => !!m && hasNamedRole(m, TECH_STAFF);
const isStaff = m => !!m && (isHigherStaff(m) || isSupportStaff(m) || isTechnicalStaff(m));
const isTicketAssignable = m => isStaff(m);

function duration(s) { const m=String(s||'').toLowerCase().match(/^(\d+)(m|h|d)$/); if(!m)return null; const ms=Number(m[1])*({m:60000,h:3600000,d:86400000}[m[2]]); return ms>=60000&&ms<=28*86400000?ms:null; }

const commands = [
  new SlashCommandBuilder().setName('status').setDescription('Show HELPER status'),
  new SlashCommandBuilder().setName('donate').setDescription('Show donation addresses'),
  new SlashCommandBuilder().setName('setup-server').setDescription('Create or repair HELPER infrastructure').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('support-panel').setDescription('Repost Support panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('ticket-close').setDescription('Close the current Support ticket'),
  new SlashCommandBuilder().setName('ticket-add').setDescription('Add a staff member to this ticket').addUserOption(o=>o.setName('user').setDescription('Support / technical staff member').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-remove').setDescription('Remove an added staff member from this ticket').addUserOption(o=>o.setName('user').setDescription('Staff member').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('warnings').setDescription('Show warnings').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('clear-warnings').setDescription('Clear warnings').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('duration').setDescription('10m, 2h or 1d').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove timeout').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(o=>o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('settings').setDescription('Change monitoring settings').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addBooleanOption(o=>o.setName('log_messages').setDescription('Log deleted/edited messages')).addBooleanOption(o=>o.setName('log_voice').setDescription('Log voice joins/leaves')).addIntegerOption(o=>o.setName('raid_threshold').setDescription('Join count for alert').setMinValue(3).setMaxValue(50)).addIntegerOption(o=>o.setName('raid_window_seconds').setDescription('Detection window').setMinValue(5).setMaxValue(120)),
].map(x=>x.toJSON());

const DONATIONS = [
 ['BTC','Bitcoin','bc1qgcdwj2r95ygqh48ejnxezsff4wx3y5d3mhvth3'],['USDT','TRC20','TBpBrohT938QYz4ksb4kDm3GxHjuU9qAyp'],['GRAMM','TON','UQAvfNVz2v0Fk4Ri2L_WfGHuy2TE9JBY5nLUq24nDDn7cdLV'],['USDT','ERC20','0x93397e8Dc13D3e24464348Df86Fb877b0c7177f8'],['USDT','SOL','F3rcZ84JcEzWmccJED4uMfi9cPxqvN4PbjDiUPNB29jM'],['USDT','TON','UQAvfNVz2v0Fk4Ri2L_WfGHuy2TE9JBY5nLUq24nDDn7cdLV'],['USDC','SOL','F3rcZ84JcEzWmccJED4uMfi9cPxqvN4PbjDiUPNB29jM'],['USDC','ERC20','0x93397e8Dc13D3e24464348Df86Fb877b0c7177f8'],['ETH','Ethereum','0x93397e8Dc13D3e24464348Df86Fb877b0c7177f8'],['TRON','TRX','TBpBrohT938QYz4ksb4kDm3GxHjuU9qAyp'],['SOL','Solana','F3rcZ84JcEzWmccJED4uMfi9cPxqvN4PbjDiUPNB29jM']
];
function donationPayload() { return { embeds:[new EmbedBuilder().setTitle('Support Our Mods').setDescription(['If you want to support development of **Litematica Together** and **Simple Translator**, use one of the addresses below.','',...DONATIONS.map(([a,n,x])=>`**${a} — ${n}**\n\`${x}\``),'','**Important:** send only the listed asset through the exact network shown. A wrong network can permanently lose funds.'].join('\n\n')).setFooter({text:'Thank you for supporting our projects.'})], allowedMentions:{parse:[]} }; }

module.exports = {
  HIGH_STAFF, TECH_STAFF, SUPPORT_ROLE, SUPPORT_ROLE_ID, STAFF,
  trunc, clean, base, isHigherStaff, isSupportStaff, isTechnicalStaff, isStaff, isTicketAssignable,
  duration, commands, donationPayload,
};
