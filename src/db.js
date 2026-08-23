const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.DATA_DIR || (fs.existsSync('/app') ? '/app/data' : path.join(process.cwd(), 'data'));
const file = path.join(dir, 'ltt-helper.json');
fs.mkdirSync(dir, { recursive: true });
let data = { guilds: {}, tickets: {}, warnings: {} };
try { if (fs.existsSync(file)) data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
catch (e) { console.error('[STORE]', e); }

function save() {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function guild(id) {
  if (!data.guilds[id]) {
    data.guilds[id] = {
      supportChannelId: null, modLogChannelId: null, supportStaffChannelId: null, supportRoleId: null,
      logMessages: String(process.env.LOG_MESSAGES || 'true').toLowerCase() !== 'false',
      logVoice: String(process.env.LOG_VOICE || 'false').toLowerCase() === 'true',
      raidThreshold: Number(process.env.RAID_THRESHOLD || 6),
      raidWindowSeconds: Number(process.env.RAID_WINDOW_SECONDS || 15),
    };
    save();
  }
  return data.guilds[id];
}
const ticket = id => data.tickets[id] || null;
const openTicketFor = (gid, uid) => Object.values(data.tickets).find(t => t.guildId === gid && t.userId === uid && t.status === 'open') || null;
const putTicket = (id, t) => { data.tickets[id] = t; save(); };
const patchTicket = (id, p) => { if (data.tickets[id]) { Object.assign(data.tickets[id], p); save(); } return data.tickets[id]; };
const warningKey = (gid, uid) => `${gid}:${uid}`;
function addWarning(gid, uid, w) { const k = warningKey(gid, uid); data.warnings[k] ||= []; data.warnings[k].push(w); save(); return data.warnings[k]; }
const warnings = (gid, uid) => data.warnings[warningKey(gid, uid)] || [];
const clearWarnings = (gid, uid) => { delete data.warnings[warningKey(gid, uid)]; save(); };

module.exports = { data, save, guild, ticket, openTicketFor, putTicket, patchTicket, addWarning, warnings, clearWarnings };
