const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.DATA_DIR || (fs.existsSync('/app') ? '/app/data' : path.join(process.cwd(), 'data'));
const file = path.join(dir, 'ltt-helper.json');
fs.mkdirSync(dir, { recursive: true });

const empty = () => ({ guilds: {}, tickets: {}, warnings: {} });
let data = empty();
let lastLoadedMtime = 0;

function replaceData(next) {
  data.guilds = next.guilds || {};
  data.tickets = next.tickets || {};
  data.warnings = next.warnings || {};
}

function refresh(force = false) {
  try {
    if (!fs.existsSync(file)) return data;
    const stat = fs.statSync(file);
    if (!force && stat.mtimeMs <= lastLoadedMtime) return data;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    replaceData({ ...empty(), ...parsed });
    lastLoadedMtime = stat.mtimeMs;
  } catch (e) {
    console.error('[STORE REFRESH]', e);
  }
  return data;
}

refresh(true);

function save() {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  try { lastLoadedMtime = fs.statSync(file).mtimeMs; } catch {}
}

function guild(id) {
  refresh();
  if (!data.guilds[id]) {
    data.guilds[id] = {
      supportChannelId: null, modLogChannelId: null, supportStaffChannelId: null, ticketArchiveChannelId: null, supportRoleId: null, ticketHubReady: false,
      logMessages: String(process.env.LOG_MESSAGES || 'true').toLowerCase() !== 'false',
      logVoice: String(process.env.LOG_VOICE || 'false').toLowerCase() === 'true',
      raidThreshold: Number(process.env.RAID_THRESHOLD || 6),
      raidWindowSeconds: Number(process.env.RAID_WINDOW_SECONDS || 15),
    };
    save();
  }
  return data.guilds[id];
}

const ticket = id => { refresh(); return data.tickets[id] || null; };
const openTicketFor = (gid, uid) => {
  refresh();
  return Object.values(data.tickets).find(t => t.guildId === gid && t.userId === uid && t.status === 'open') || null;
};
const putTicket = (id, t) => {
  refresh(true);
  data.tickets[id] = t;
  save();
};
const patchTicket = (id, p) => {
  refresh(true);
  if (data.tickets[id]) {
    Object.assign(data.tickets[id], p);
    save();
  }
  return data.tickets[id];
};

const warningKey = (gid, uid) => `${gid}:${uid}`;
function addWarning(gid, uid, w) {
  refresh(true);
  const k = warningKey(gid, uid);
  data.warnings[k] ||= [];
  data.warnings[k].push(w);
  save();
  return data.warnings[k];
}
const warnings = (gid, uid) => { refresh(); return data.warnings[warningKey(gid, uid)] || []; };
const clearWarnings = (gid, uid) => {
  refresh(true);
  delete data.warnings[warningKey(gid, uid)];
  save();
};

module.exports = { data, save, refresh, guild, ticket, openTicketFor, putTicket, patchTicket, addWarning, warnings, clearWarnings };
