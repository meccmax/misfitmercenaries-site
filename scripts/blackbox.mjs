/* =====================================================================
   Misfit Mercenaries — MM BlackBox player stats
   Called by scripts/update-stats.mjs every run (about every 30 minutes).

   Input: each DayZ server's public_stats.json written by MM BlackBox.
     - Fetched from the URL template in servers.json → "blackbox.url", normally the
       MM Server Agent: "https://game.misfitmercenaries.com:2999/mm-agent/v1/blackbox-stats/{port}/{file}".
       {port} becomes the server's game_port, {server} its id (deer-isle / sakhal / nasdara),
       {file} public_stats.json (or public_stats_season_<id>.json).
     - The BLACKBOX_TOKEN repository secret is sent as "Authorization: Bearer …".
     - The agent uses its own self-made encryption key, so "blackbox.agent_fingerprint" pins it:
       the connection is only used (and the password only sent) if the agent's key matches,
       the same check the MM Launcher does (fingerprint from trust/agents.jsonc in mm-launcher).
     - For local testing set MM_BLACKBOX_DIR to a folder holding <server>/public_stats.json.

   Safety: a file is only accepted if it parses and looks right. Otherwise the last
   good copy (kept in data/live/bb-raw/) is used, so the boards never go blank.
   When a server's season_id changes, the final season file is fetched and archived
   for the "past seasons" boards.

   Output (all in site/data/live/bb/, read by assets/js/stats.js):
     meta.json                       servers, seasons, totals, death causes, records
     boards-<scope>-<period>.json    top 50 per board; scope = network or a server id,
                                     period = all_time, season or past-<season id>
     index.json                      [id, name] list for the name search
     p/<00-ff>.json                  full per-player stats, split by the id's first two characters
   ===================================================================== */
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import zlib from 'node:zlib';
import { createHash, X509Certificate } from 'node:crypto';

const TOP_N = 50;
const MIN_HS_KILLS = 25;      // headshot % and AI-kills-per-death need at least this many AI kills
const SUM = ['playtime_s', 'sessions', 'ai_kills', 'ai_headshots', 'infected_kills', 'animal_kills', 'deaths', 'parts_built'];
const MAX = ['longest_life_s', 'longest_ai_kill_m', 'longest_hit_m', 'best_kill_streak'];
const DEATH_KEYS = ['ai', 'infected', 'animal', 'fall', 'vehicle_crash', 'explosion', 'hypothermia', 'starvation',
  'dehydration', 'bleeding_out', 'sickness_poison', 'suicide', 'other_player', 'unknown', 'other'];
const TRAVEL_KEYS = ['foot', 'land', 'air', 'boat'];
const ID_RE = /^[0-9a-f]{16}$/;
const UA = 'MisfitMercenariesSite/1.0 (+https://github.com/meccmax)';

/* Boards: value(stats) → number (or null to leave the player off); extra(stats) → small label */
const BOARDS = [
  { id: 'playtime', v: (s) => s.playtime_s },
  { id: 'longest_life', v: (s) => s.longest_life_s },
  { id: 'alive', v: (s) => s.current_life_s, extra: (s) => s._alive_on || '' },
  { id: 'kd', v: (s) => s.ai_kills >= MIN_HS_KILLS ? +(s.ai_kills / Math.max(1, s.deaths)).toFixed(2) : null },
  { id: 'ai_kills', v: (s) => s.ai_kills },
  { id: 'headshot_pct', v: (s) => s.ai_kills >= MIN_HS_KILLS ? +(s.ai_headshots / s.ai_kills * 100).toFixed(1) : null, extra: (s) => `${s.ai_headshots}/${s.ai_kills}` },
  { id: 'infected_kills', v: (s) => s.infected_kills },
  { id: 'animal_kills', v: (s) => s.animal_kills },
  { id: 'longest_ai_kill', v: (s) => s.longest_ai_kill_m, extra: (s) => s.longest_ai_kill_weapon },
  { id: 'longest_hit', v: (s) => s.longest_hit_m, extra: (s) => s.longest_hit_weapon },
  { id: 'best_kill_streak', v: (s) => s.best_kill_streak },
  { id: 'travel', v: (s) => TRAVEL_KEYS.reduce((a, k) => a + s.travel_m[k], 0) },
  ...TRAVEL_KEYS.map((k) => ({ id: 'travel_' + k, v: (s) => s.travel_m[k] })),
  { id: 'parts_built', v: (s) => s.parts_built },
  { id: 'deaths', v: (s) => s.deaths }
];

const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
const str = (v, max = 64) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/* Turn whatever the server sent into a clean stats object (unknown keys dropped, all numbers whole and ≥ 0). */
function cleanStats(s) {
  s = s && typeof s === 'object' ? s : {};
  const o = {};
  for (const k of [...SUM, ...MAX, 'current_life_s']) o[k] = int(s[k]);
  o.longest_ai_kill_weapon = str(s.longest_ai_kill_weapon, 48);
  o.longest_hit_weapon = str(s.longest_hit_weapon, 48);
  o.first_seen = iso(s.first_seen);
  o.last_seen = iso(s.last_seen);
  o.deaths_by = {}; for (const k of DEATH_KEYS) o.deaths_by[k] = int((s.deaths_by || {})[k]);
  o.travel_m = {}; for (const k of TRAVEL_KEYS) o.travel_m[k] = int((s.travel_m || {})[k]);
  return o;
}

/* Accept a file only if it is a real BlackBox export for the server we asked for. */
function cleanFile(raw, serverId) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players)) throw new Error('no players array');
  // "deerisle", "Deer Isle" and "deer-isle" all count as the same server
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm(raw.server_id) !== norm(serverId)) throw new Error(`server_id is "${raw.server_id}", expected "${serverId}"`);
  if (!iso(raw.generated_at)) throw new Error('generated_at missing');
  const seen = new Set(), players = [];
  for (const p of raw.players) {
    const id = String((p && p.id) || '').toLowerCase();
    if (!ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    players.push({ id, name: str(p.name) || 'Unknown', all_time: cleanStats(p.all_time), season: cleanStats(p.season) });
  }
  return { generated_at: iso(raw.generated_at), server_id: serverId, season_id: str(raw.season_id, 40) || 'season', players };
}

async function readJSON(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }
async function writeJSON(file, data) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); }

const MAX_DOWNLOAD = 40 * 1024 * 1024;

/* The agent's key fingerprint: base64 SHA-256 of its public key (SubjectPublicKeyInfo), no padding. */
const keyFingerprint = (cert) => createHash('sha256')
  .update(new X509Certificate(cert.raw).publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64').replace(/=+$/, '');

/* HTTPS GET to the agent: connect, check its key, and only then send the request (with the password). */
async function pinnedGet(url, headers, pin) {
  const u = new URL(url);
  const socket = await new Promise((resolve, reject) => {
    const s = tls.connect({ host: u.hostname, port: +u.port || 443, servername: net.isIP(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false });
    s.setTimeout(15000, () => s.destroy(new Error('connection timed out')));
    s.once('secureConnect', () => resolve(s));
    s.once('error', reject);
  });
  const fp = keyFingerprint(socket.getPeerCertificate());
  if (fp !== pin) { socket.destroy(); throw new Error(`the agent's encryption key (${fp}) doesn't match blackbox.agent_fingerprint; not sending the password`); }
  return new Promise((resolve, reject) => {
    const req = https.request({ method: 'GET', host: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { ...headers, 'Accept-Encoding': 'gzip' }, createConnection: () => socket });
    req.setTimeout(30000, () => req.destroy(new Error('download timed out')));
    req.on('error', reject);
    req.on('response', (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_DOWNLOAD) req.destroy(new Error('file too large')); else chunks.push(c); });
      res.on('error', reject);
      res.on('end', () => {
        try {
          let body = Buffer.concat(chunks);
          if (/gzip/i.test(res.headers['content-encoding'] || '')) body = zlib.gunzipSync(body, { maxOutputLength: MAX_DOWNLOAD });
          const text = body.toString('utf8');
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${text.slice(0, 120).trim()}`));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.end();
  });
}

async function fetchFile(cfg, server, file) {
  if (process.env.MM_BLACKBOX_DIR) {
    const raw = await readFile(path.join(process.env.MM_BLACKBOX_DIR, server.id, file), 'utf8');
    return JSON.parse(raw);
  }
  const url = cfg.url.replace('{server}', encodeURIComponent(server.id)).replace('{port}', String(server.game_port || ''))
    .replace('{file}', encodeURIComponent(file));
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  const token = (process.env.BLACKBOX_TOKEN || '').trim();
  if (token) {
    if (!url.startsWith('https://')) throw new Error('blackbox.url must start with https:// when BLACKBOX_TOKEN is set (the password is never sent unencrypted)');
    headers.Authorization = `Bearer ${token}`;
  }
  const pin = String(cfg.agent_fingerprint || '').trim();
  let text;
  if (pin && url.startsWith('https://')) text = await pinnedGet(url, headers, pin);
  else {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    text = await r.text();
  }
  return JSON.parse(text); // throws on a half-written file
}

/* Combine several servers' copies of one player into one stats object (rules from the BlackBox spec). */
function combine(list) {
  const o = cleanStats({});
  let bestLast = null;
  for (const { s, server } of list) {
    for (const k of SUM) o[k] += s[k];
    for (const k of DEATH_KEYS) o.deaths_by[k] += s.deaths_by[k];
    for (const k of TRAVEL_KEYS) o.travel_m[k] += s.travel_m[k];
    for (const k of MAX) if (s[k] > o[k]) o[k] = s[k];
    if (s.longest_ai_kill_m >= o.longest_ai_kill_m && s.longest_ai_kill_m) o.longest_ai_kill_weapon = s.longest_ai_kill_weapon;
    if (s.longest_hit_m >= o.longest_hit_m && s.longest_hit_m) o.longest_hit_weapon = s.longest_hit_weapon;
    if (s.first_seen && (!o.first_seen || s.first_seen < o.first_seen)) o.first_seen = s.first_seen;
    if (s.last_seen && (!o.last_seen || s.last_seen > o.last_seen)) { o.last_seen = s.last_seen; bestLast = server; }
    // current life is per character, so the network view shows the longest one and where it is
    if (s.current_life_s > o.current_life_s) { o.current_life_s = s.current_life_s; o._alive_on = server; }
  }
  return { stats: o, newest: bestLast };
}

/* rows: [{ id, name, stats }] → { boardId: [[id, name, value, extra], …] } */
function buildBoards(rows) {
  const out = {};
  for (const b of BOARDS) {
    out[b.id] = rows
      .map((r) => ({ r, v: b.v(r.stats) }))
      .filter((x) => x.v != null && x.v > 0)
      .sort((a, b2) => b2.v - a.v || a.r.name.localeCompare(b2.r.name))
      .slice(0, TOP_N)
      .map((x) => { const e = b.extra ? b.extra(x.r.stats) : ''; return e ? [x.r.id, x.r.name, x.v, e] : [x.r.id, x.r.name, x.v]; });
  }
  return out;
}

function summarise(rows) {
  const t = { players: rows.length, playtime_s: 0, ai_kills: 0, infected_kills: 0, animal_kills: 0, deaths: 0, travel_m: 0, parts_built: 0, deaths_by: {} };
  for (const k of DEATH_KEYS) t.deaths_by[k] = 0;
  for (const { stats: s } of rows) {
    for (const k of ['playtime_s', 'ai_kills', 'infected_kills', 'animal_kills', 'deaths', 'parts_built']) t[k] += s[k];
    t.travel_m += TRAVEL_KEYS.reduce((a, k) => a + s.travel_m[k], 0);
    for (const k of DEATH_KEYS) t.deaths_by[k] += s.deaths_by[k];
  }
  return t;
}

/* Summary plus the #1 on the headline boards (for the "Server records" cards). */
function withRecords(d) {
  const sum = d.summary;
  sum.records = {};
  for (const b of ['playtime', 'ai_kills', 'longest_ai_kill', 'best_kill_streak', 'longest_life', 'travel']) sum.records[b] = d.boards[b][0] || null;
  return sum;
}

/* Build boards + summary for one period across a set of server files. */
function scopeData(files, period) {
  const byId = new Map();
  for (const f of files) for (const p of f.players) {
    const e = byId.get(p.id) || { id: p.id, parts: [], names: [] };
    e.parts.push({ s: p[period], server: f.server_id });
    e.names.push({ name: p.name, last: p[period].last_seen || p.all_time.last_seen || '' });
    byId.set(p.id, e);
  }
  const rows = [...byId.values()].map((e) => {
    const { stats } = combine(e.parts);
    if (files.length === 1) delete stats._alive_on; // per-server board: no need to say which server
    const name = e.names.sort((a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : 0))[0].name;
    return { id: e.id, name, stats };
  }).filter((r) => r.stats.playtime_s > 0 || r.stats.deaths > 0);
  return { rows, boards: buildBoards(rows), summary: summarise(rows) };
}

export async function updateBlackBox({ cfg, servers, live, log }) {
  const bbCfg = cfg.blackbox || {};
  if (!process.env.MM_BLACKBOX_DIR && !bbCfg.url) { log('BlackBox: no "blackbox.url" in servers.json yet, skipping'); return; }
  const RAW = path.join(live, 'bb-raw'), OUT = path.join(live, 'bb');
  const list = servers.filter((s) => s.blackbox !== false);
  if (!process.env.MM_BLACKBOX_DIR && /\/mm-agent\//.test(bbCfg.url) && !(process.env.BLACKBOX_TOKEN || '').trim()) {
    log('BlackBox: the BLACKBOX_TOKEN secret isn\'t set yet (run stats-token.bat on the server and add it in GitHub), skipping');
    return;
  }

  /* 1. fetch each server's current file, keep the last good copy on failure */
  const current = [];
  for (const srv of list) {
    const id = srv.id;
    const keptPath = path.join(RAW, `${id}.json`);
    const kept = await readJSON(keptPath);
    let file = null;
    try { file = cleanFile(await fetchFile(bbCfg, srv, 'public_stats.json'), id); }
    catch (e) { log(`BlackBox ${id}: ${e.message}${kept ? ' (keeping last good copy)' : ''}`); }
    if (file && kept && file.generated_at < kept.generated_at) { log(`BlackBox ${id}: received an older file than the saved one, ignoring it`); file = null; }

    /* 2. season changed → archive the old season's final file */
    if (file && kept && kept.season_id !== file.season_id) {
      let fin = null;
      try { fin = cleanFile(await fetchFile(bbCfg, srv, `public_stats_season_${kept.season_id}.json`), id); }
      catch (e) { log(`BlackBox ${id}: final file for ${kept.season_id} not found (${e.message}); archiving the last copy instead`); }
      const arch = fin && fin.season_id === kept.season_id ? fin : kept;
      await writeJSON(path.join(RAW, 'seasons', `${id}__${kept.season_id}.json`), arch);
      log(`BlackBox ${id}: season ${kept.season_id} archived`);
    }
    if (file) { await writeJSON(keptPath, file); log(`BlackBox ${id}: ${file.players.length} players, ${file.season_id}`); }
    const use = file || kept;
    if (use) current.push(use);
  }
  if (!current.length) { log('BlackBox: no data yet'); return; }

  /* 3. pick the season shared by most servers (newest wins a tie) for the network season board */
  const count = {};
  for (const f of current) count[f.season_id] = (count[f.season_id] || 0) + 1;
  const netSeason = Object.keys(count).sort((a, b) => count[b] - count[a] ||
    Math.max(...current.filter((f) => f.season_id === b).map((f) => Date.parse(f.generated_at))) -
    Math.max(...current.filter((f) => f.season_id === a).map((f) => Date.parse(f.generated_at))))[0];

  await rm(OUT, { recursive: true, force: true });
  const meta = {
    _comment: 'MM BlackBox stats, combined. Generated by scripts/blackbox.mjs; do not edit by hand.',
    generated_at: new Date().toISOString(),
    top_n: TOP_N, min_kills_for_ratios: MIN_HS_KILLS,
    network_season: netSeason,
    servers: {}, scopes: {}, past_seasons: []
  };
  for (const f of current) meta.servers[f.server_id] = { season_id: f.season_id, generated_at: f.generated_at, players: f.players.length };

  const scopes = [['network', current], ...current.map((f) => [f.server_id, [f]])];
  const players = new Map(); // id → lookup record
  for (const [scope, files] of scopes) {
    meta.scopes[scope] = {};
    for (const period of ['all_time', 'season']) {
      const use = period === 'season' && scope === 'network' ? files.filter((f) => f.season_id === netSeason) : files;
      const d = scopeData(use, period);
      await writeJSON(path.join(OUT, `boards-${scope}-${period}.json`), d.boards);
      meta.scopes[scope][period] = withRecords(d);
      for (const r of d.rows) {
        const p = players.get(r.id) || { name: r.name, servers: {} };
        if (scope === 'network') { p.name = r.name; (p.network = p.network || {})[period] = r.stats; }
        else (p.servers[scope] = p.servers[scope] || { season_id: files[0].season_id })[period] = r.stats;
        players.set(r.id, p);
      }
      // rank on network boards, for the lookup's "your best ranks"
      if (scope === 'network') for (const [bid, rows] of Object.entries(d.boards)) rows.forEach((row, i) => {
        const p = players.get(row[0]); if (p) ((p.ranks = p.ranks || {})[period] = p.ranks[period] || {})[bid] = i + 1;
      });
    }
  }

  /* 4. past seasons */
  let archived = [];
  try { archived = (await readdir(path.join(RAW, 'seasons'))).filter((n) => n.endsWith('.json')); } catch {}
  const bySeason = {};
  for (const n of archived) {
    const f = await readJSON(path.join(RAW, 'seasons', n)); if (!f) continue;
    (bySeason[f.season_id] = bySeason[f.season_id] || []).push(f);
  }
  for (const [sid, files] of Object.entries(bySeason)) {
    if (current.some((f) => f.season_id === sid)) continue; // still running somewhere: not "past" yet
    const ended = files.map((f) => f.generated_at).sort().pop();
    const entry = { season_id: sid, ended_at: ended, servers: files.map((f) => f.server_id), scopes: {} };
    for (const [scope, fs] of [['network', files], ...files.map((f) => [f.server_id, [f]])]) {
      const d = scopeData(fs, 'season');
      await writeJSON(path.join(OUT, `boards-${scope}-past-${sid}.json`), d.boards);
      entry.scopes[scope] = withRecords(d);
    }
    meta.past_seasons.push(entry);
  }
  meta.past_seasons.sort((a, b) => (b.ended_at > a.ended_at ? 1 : -1));

  /* 5. lookup index + shards */
  const index = [...players.entries()].map(([id, p]) => [id, p.name]).sort((a, b) => a[1].localeCompare(b[1]));
  const shards = {};
  for (const [id, p] of players) (shards[id.slice(0, 2)] = shards[id.slice(0, 2)] || {})[id] = p;
  for (const [k, v] of Object.entries(shards)) await writeJSON(path.join(OUT, 'p', `${k}.json`), v);
  await writeJSON(path.join(OUT, 'index.json'), index);
  await writeJSON(path.join(OUT, 'meta.json'), meta);
  log(`BlackBox: wrote boards for ${index.length} players across ${current.length} server(s)`);
}
