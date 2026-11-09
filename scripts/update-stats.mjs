#!/usr/bin/env node
/* =====================================================================
   Misfit Mercenaries — stats updater
   Runs inside the GitHub Action every 30 minutes (see .github/workflows/site.yml).
   No packages needed: plain Node 20+.

   What it does:
   1. Reads site/data/servers.json for the server list.
   2. Live status: asks each server directly over the Steam query protocol
      (needs "query_port" set). If that fails and CFTools is set up, it falls
      back to counting players from CFTools.
   3. Leaderboards + player lookup: MM BlackBox player stats (AI kills, travel,
      longest shot …), see scripts/blackbox.mjs. Writes site/data/live/bb/.
   4. Writes site/data/live/status.json and history.json.
   CFTools (CFTOOLS_APP_ID / CFTOOLS_SECRET secrets) is now only a backup for the
   player count when a server doesn't answer the Steam query. The old CFTools
   leaderboards are archived in site/data/archive/cftools.json.

   If something fails, the previous files are kept, so the site never goes blank.
   Run locally with:  node scripts/update-stats.mjs
   ===================================================================== */
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateBlackBox } from './blackbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = process.env.MM_CONFIG || path.join(ROOT, 'site/data/servers.json');
const LIVE = process.env.MM_LIVE || path.join(ROOT, 'site/data/live');
const HISTORY_DAYS = 35;                       // how much player-count history to keep
const CF_BASE = process.env.CFTOOLS_BASE || 'https://data.cftools.cloud'; // override only for testing
const UA = 'MisfitMercenariesSite/1.0 (+https://github.com/meccmax)';

const log = (...a) => console.log('[stats]', ...a);

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJSON(name, data) {
  await mkdir(LIVE, { recursive: true });
  await writeFile(path.join(LIVE, name), JSON.stringify(data));
  log('wrote', name);
}

/* ---------- Steam A2S_INFO query ---------- */
async function a2sInfo(host, port, timeoutMs = 3000) {
  const { address } = await dns.lookup(host, { family: 4 });
  const base = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]), Buffer.from('Source Engine Query\0', 'latin1')]);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, timeoutMs);
    sock.on('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.on('message', (msg) => {
      const type = msg[4];
      if (type === 0x41) { // challenge: resend with the 4 challenge bytes
        sock.send(Buffer.concat([base, msg.subarray(5, 9)]), port, address);
        return;
      }
      if (type !== 0x49) return;
      clearTimeout(timer); sock.close();
      try {
        let o = 6; // skip header + protocol byte
        const str = () => { const end = msg.indexOf(0, o); const s = msg.toString('utf8', o, end); o = end + 1; return s; };
        const name = str(), map = str(); str(); str(); o += 2;
        const players = msg[o], max = msg[o + 1], bots = msg[o + 2];
        resolve({ name, map, players: Math.max(0, players - bots), max_players: max });
      } catch (e) { reject(e); }
    });
    sock.send(base, port, address);
  });
}
async function a2sWithRetry(host, port) {
  for (let i = 0; i < 3; i++) {
    try { return await a2sInfo(host, port); } catch (e) { if (i === 2) throw e; }
  }
}

/* ---------- CFTools Data API ---------- */
let cfToken = null;
async function cfAuth() {
  const id = (process.env.CFTOOLS_APP_ID || '').trim(), secret = (process.env.CFTOOLS_SECRET || '').trim();
  if (!id || !secret) return false;
  const r = await fetch(`${CF_BASE}/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ application_id: id, secret })
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const hint = r.status === 404 ? ' (CFTools does not recognise the Application ID: check the CFTOOLS_APP_ID secret)'
      : (r.status === 401 || r.status === 403) ? ' (Application ID found but the Secret was rejected: check the CFTOOLS_SECRET secret)' : '';
    throw new Error(`CFTools auth failed: HTTP ${r.status} ${body.slice(0, 200)}${hint}. App ID length: ${id.length} characters`);
  }
  cfToken = (await r.json()).token;
  return true;
}
async function cfGet(p) {
  const r = await fetch(`${CF_BASE}/${p}`, { headers: { Authorization: `Bearer ${cfToken}`, 'User-Agent': UA } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`CFTools ${p.split('?')[0]}: HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  return r.json();
}
async function cfOnlineCount(serverApiId) {
  const res = await cfGet(`v1/server/${serverApiId}/GSM/list`);
  return (res.sessions || []).length;
}

/* ---------- main ---------- */
async function main() {
  const cfg = await readJSON(CONFIG, null);
  if (!cfg) throw new Error('site/data/servers.json is missing or invalid');
  const host = cfg.host;
  const servers = cfg.servers || [];
  const wantsQuery = servers.some((s) => s.query_port);
  const wantsCf = servers.some((s) => s.cftools_server_api_id);
  if (!wantsQuery && !wantsCf) {
    log('No query_port or cftools_server_api_id set in servers.json yet. Nothing to do.');
    return;
  }

  let cfReady = false;
  if (wantsCf) {
    try { cfReady = await cfAuth(); if (!cfReady) log('CFTOOLS_APP_ID / CFTOOLS_SECRET not set: no CFTools backup for player counts'); }
    catch (e) { log(e.message); }
  }

  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);

  /* 1. status */
  const status = { _comment: 'Generated by scripts/update-stats.mjs. Do not edit by hand.', generated_at: now.toISOString(), servers: {} };
  for (const s of servers) {
    let st = null;
    if (s.query_port) {
      try {
        const info = await a2sWithRetry(host, s.query_port);
        st = { online: true, players: info.players, max_players: info.max_players, source: 'steam-query' };
      } catch (e) { log(`${s.id}: steam query failed (${e.message})`); }
    }
    if (!st && cfReady && s.cftools_server_api_id) {
      try { st = { online: true, players: await cfOnlineCount(s.cftools_server_api_id), max_players: s.slots || null, source: 'cftools' }; }
      catch (e) { log(`${s.id}: CFTools player list failed (${e.message})`); }
    }
    if (!st && (s.query_port || (cfReady && s.cftools_server_api_id))) st = { online: false, players: 0, max_players: s.slots || null };
    if (st) status.servers[s.id] = st;
  }
  if (Object.keys(status.servers).length) await writeJSON('status.json', status);

  /* 2. history */
  const history = await readJSON(path.join(LIVE, 'history.json'), { servers: {} });
  history._comment = 'Player count over time: [unix seconds, players or null when offline]. Generated; do not edit by hand.';
  history.generated_at = now.toISOString();
  const cutoff = nowSec - HISTORY_DAYS * 86400;
  for (const s of servers) {
    const st = status.servers[s.id];
    if (!st) continue;
    const arr = (history.servers[s.id] || []).filter((p) => p[0] >= cutoff);
    arr.push([nowSec, st.online ? st.players : null]);
    history.servers[s.id] = arr;
  }
  if (Object.keys(status.servers).length) await writeJSON('history.json', history);

  /* 3. MM BlackBox stats (separate from CFTools; never stops the rest) */
  try { await updateBlackBox({ cfg, servers, live: LIVE, log }); }
  catch (e) { log('BlackBox step failed:', e.message); }

  /* 4. CFTools leaderboards are no longer used: the boards come from MM BlackBox, and the old
        CFTools boards are kept as a frozen archive in site/data/archive/cftools.json.
        Remove the old live copies so they stop being published. */
  for (const old of ['leaderboards.json', 'players.json']) {
    try { await unlink(path.join(LIVE, old)); log('removed old', old); } catch {}
  }
}

main().catch((e) => { console.error('[stats] failed:', e.message); process.exitCode = 1; });
