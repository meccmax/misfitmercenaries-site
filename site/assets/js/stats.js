/* =====================================================================
   Misfit Mercenaries — Stats page
   Reads:  data/servers.json            (server list, colours, restart hours)
           data/live/status.json        (online / players right now)
           data/live/history.json       (player count over time)
           data/live/bb/…               MM BlackBox stats (AI kills, travel, longest shot …):
                                        leaderboards, lookup, causes of death and records
           data/archive/cftools.json    old CFTools boards (hours, deaths), frozen; shown
                                        under "Before BlackBox"
   The data/live files are written by scripts/update-stats.mjs (GitHub Action).
   If they don't exist yet, the page shows "not connected" placeholders.
   ===================================================================== */
(function () {
  'use strict';
  var esc = function (s) { return window.MM.esc(s); };
  var getJSON = function (u) { return window.MM.getJSON(u); };
  var opt = function (p) { return p.catch(function () { return null; }); };

  var CATS = [
    { id: 'playtime', label: 'Hours played', unit: 'Hours', fmt: hours },
    { id: 'deaths', label: 'Most deaths', unit: 'Deaths', fmt: num }
  ];
  var RANGES = [
    { id: '24h', label: '24h', name: 'last 24 hours', ms: 864e5 },
    { id: '7d', label: '7 days', name: 'last 7 days', ms: 7 * 864e5 },
    { id: '30d', label: '30 days', name: 'last 30 days', ms: 30 * 864e5 }
  ];

  function num(v) { return (+v || 0).toLocaleString(); }
  function metres(v) { return (+v || 0) ? Math.round(+v).toLocaleString() + ' m' : '—'; }
  function hours(sec) { sec = +sec || 0; return !sec ? '—' : sec < 3600 ? Math.max(1, Math.round(sec / 60)) + ' min' : Math.round(sec / 3600).toLocaleString() + ' h'; }

  function dur(sec) {
    sec = +sec || 0; if (!sec) return '—';
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  }
  function dist(m) { m = +m || 0; return !m ? '—' : m >= 1000 ? (m / 1000).toLocaleString(undefined, { maximumFractionDigits: m >= 100000 ? 0 : 1 }) + ' km' : Math.round(m) + ' m'; }
  function pct(v) { return (+v || 0).toFixed(1) + '%'; }
  function ratio(v) { return (+v || 0).toFixed(2); }

  /* MM BlackBox boards, in groups. extra = what the 4th column holds. */
  var BB = {
    playtime: { label: 'Hours played', unit: 'Hours', fmt: hours },
    longest_life: { label: 'Longest life', unit: 'Time alive', fmt: dur },
    alive: { label: 'Still alive', unit: 'Current life', fmt: dur, extra: 'Server', note: 'Longest-running lives that are still going.' },
    kd: { label: 'AI kills per death', unit: 'Ratio', fmt: ratio, min: true },
    ai_kills: { label: 'AI kills', unit: 'Kills', fmt: num },
    headshot_pct: { label: 'Headshot %', unit: 'Headshots', fmt: pct, extra: 'Hits / kills', min: true },
    longest_ai_kill: { label: 'Longest AI kill', unit: 'Distance', fmt: metres, extra: 'Weapon' },
    longest_hit: { label: 'Longest shot', unit: 'Distance', fmt: metres, extra: 'Weapon', note: 'Longest shot that hit anything.' },
    best_kill_streak: { label: 'Kill streak', unit: 'Kills', fmt: num, note: 'Most AI and infected kills in a single life.' },
    infected_kills: { label: 'Infected kills', unit: 'Kills', fmt: num },
    animal_kills: { label: 'Hunting', unit: 'Animals', fmt: num },
    travel: { label: 'All travel', unit: 'Distance', fmt: dist },
    travel_foot: { label: 'On foot', unit: 'Distance', fmt: dist },
    travel_land: { label: 'Land vehicles', unit: 'Distance', fmt: dist },
    travel_air: { label: 'Air', unit: 'Distance', fmt: dist },
    travel_boat: { label: 'Boats', unit: 'Distance', fmt: dist },
    parts_built: { label: 'Base parts built', unit: 'Parts', fmt: num },
    deaths: { label: 'Most deaths', unit: 'Deaths', fmt: num }
  };
  var GROUPS = [
    { id: 'survival', label: 'Survival', boards: ['playtime', 'longest_life', 'alive', 'kd'] },
    { id: 'combat', label: 'Combat', boards: ['ai_kills', 'headshot_pct', 'longest_ai_kill', 'longest_hit', 'best_kill_streak', 'infected_kills', 'animal_kills'] },
    { id: 'travel', label: 'Travel', boards: ['travel', 'travel_foot', 'travel_land', 'travel_air', 'travel_boat'] },
    { id: 'building', label: 'Building', boards: ['parts_built'] },
    { id: 'deaths', label: 'Deaths', boards: ['deaths'] }
  ];
  var DEATHS = { ai: 'AI soldiers', infected: 'Infected', animal: 'Animals', fall: 'Falls', vehicle_crash: 'Vehicle crashes', explosion: 'Explosions',
    hypothermia: 'Cold', starvation: 'Starvation', dehydration: 'Dehydration', bleeding_out: 'Bleeding out', sickness_poison: 'Sickness & poison',
    suicide: 'Suicide', other_player: 'Other players', unknown: 'Unknown', other: 'Other' };

  var params = new URLSearchParams(location.search);
  var state = { srv: params.get('server') || 'all', range: '24h', cat: 'playtime', period: 'all_time', group: 'survival', board: 'playtime', more: false, look: null };
  var D = { cfg: null, status: null, history: null, arch: null, bb: null, bbIdx: null, cache: {} };

  function chips(el, items, current, onPick) {
    el.innerHTML = items.map(function (it) {
      return '<button type="button" class="chip" data-id="' + esc(it.id) + '" aria-pressed="' + (it.id === current) + '">' + esc(it.label) + '</button>';
    }).join('');
    el.onclick = function (e) { var b = e.target.closest('[data-id]'); if (b) onPick(b.getAttribute('data-id')); };
  }
  function servers() { return D.cfg ? D.cfg.servers : []; }
  function srvById(id) { return servers().filter(function (s) { return s.id === id; })[0]; }
  function shown() { return state.srv === 'all' ? servers() : servers().filter(function (s) { return s.id === state.srv; }); }

  /* ---------- status cards ---------- */
  function renderStatus() {
    var box = document.getElementById('status-cards');
    box.innerHTML = shown().map(function (s) {
      var st = D.status && D.status.servers && D.status.servers[s.id];
      var max = (st && st.max_players) || s.slots || 0;
      var players = st && st.online ? st.players : null;
      var pct = players != null && max ? Math.min(100, Math.round(players / max * 100)) : 0;
      var tag = !st ? '<span class="tag tag-off">No data yet</span>' : st.online ? '<span class="tag tag-live tag-on">Online</span>' : '<span class="tag tag-off">Offline</span>';
      return '<div class="panel brk pad stack" style="gap:14px">' +
        '<div class="card-top"><span class="hud">' + esc(s.map) + '</span>' + tag + '</div>' +
        '<div class="h4" style="font-size:24px;font-weight:700">' + esc(s.name) + '</div>' +
        '<div class="row" style="align-items:baseline;gap:8px"><span class="statnum" style="font-size:48px;color:var(--orange)">' + (players != null ? players : '—') + '</span><span class="hud">/ ' + (max || '—') + ' players</span></div>' +
        '<div class="meter" style="height:6px" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
        '<div class="card-top"><span class="hud" style="font-size:11px">Next restart</span><span class="mono" style="font-size:13px;color:var(--silver)">' + nextRestart(s) + '</span></div>' +
        '</div>';
    }).join('');
  }
  function nextRestart(s) {
    var hrs = (s.restart_hours_utc || []).slice().sort(function (a, b) { return a - b; });
    if (!hrs.length) return 'Every 4 hours';
    var now = new Date();
    for (var d = 0; d < 2; d++) {
      for (var i = 0; i < hrs.length; i++) {
        var t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, hrs[i]));
        if (t > now) return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
    return 'Every 4 hours';
  }

  /* ---------- population chart (SVG, hand-built) ---------- */
  function renderChart() {
    var range = RANGES.filter(function (r) { return r.id === state.range; })[0];
    document.getElementById('chart-title').textContent = 'Players online — ' + range.name;
    var box = document.getElementById('chart'), legend = document.getElementById('legend'), table = document.getElementById('pop-table');
    var now = Date.now(), from = now - range.ms;
    var series = shown().map(function (s) {
      var pts = ((D.history && D.history.servers && D.history.servers[s.id]) || [])
        .filter(function (p) { return p[0] * 1000 >= from; })
        .map(function (p) { return { t: p[0] * 1000, v: p[1] }; });
      return { s: s, pts: pts };
    }).filter(function (x) { return x.pts.length; });

    if (!series.length) {
      box.innerHTML = '<div class="empty" style="padding:80px 20px">Player-count history appears here once the stats feed has been running for a while</div>';
      legend.innerHTML = ''; table.innerHTML = '';
      return;
    }

    var W = Math.max(340, Math.round(box.clientWidth || 1000)), narrow = W < 640;
    var H = narrow ? 240 : 300, L = 40, R = narrow ? 70 : 96, T = 12, B = 32, iw = W - L - R, ih = H - T - B;
    var maxV = 0;
    series.forEach(function (x) { x.pts.forEach(function (p) { if (p.v != null && p.v > maxV) maxV = p.v; }); });
    var cap = Math.max(20, Math.ceil(maxV / 20) * 20);
    var X = function (t) { return L + (t - from) / (now - from) * iw; };
    var Y = function (v) { return T + ih - v / cap * ih; };

    var g = '';
    for (var i = 0; i <= 4; i++) {
      var v = cap / 4 * i, y = Y(v);
      g += '<line x1="' + L + '" x2="' + (L + iw) + '" y1="' + y + '" y2="' + y + '" stroke="#1E2126"/>' +
        '<text x="' + (L - 10) + '" y="' + (y + 4) + '" text-anchor="end" fill="#9AA1AB" font-size="12" font-family="JetBrains Mono, monospace">' + Math.round(v) + '</text>';
    }
    var ticks = narrow ? 3 : 6;
    for (i = 0; i <= ticks; i++) {
      var t = from + (now - from) / ticks * i, x = X(t);
      var lab = range.id === '24h' ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
      g += '<text x="' + x + '" y="' + (H - 8) + '" text-anchor="middle" fill="#9AA1AB" font-size="12" font-family="JetBrains Mono, monospace">' + lab + '</text>';
    }
    /* restart markers (24h view only, when restart hours are configured for exactly one shown server) */
    if (range.id === '24h' && series.length === 1) {
      (series[0].s.restart_hours_utc || []).forEach(function (h) {
        for (var d = -1; d <= 0; d++) {
          var n = new Date(); var tt = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + d, h);
          if (tt >= from && tt <= now) g += '<line x1="' + X(tt) + '" x2="' + X(tt) + '" y1="' + T + '" y2="' + (T + ih) + '" stroke="#6B3A1C" stroke-dasharray="4 4"/>';
        }
      });
    }
    g += '<line x1="' + L + '" x2="' + (L + iw) + '" y1="' + (T + ih) + '" y2="' + (T + ih) + '" stroke="#2C3037"/>';

    var lines = series.map(function (x) {
      var d = '', pen = false, last = null;
      x.pts.forEach(function (p) {
        if (p.v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' ';
        pen = true; last = p;
      });
      var label = last && series.length > 1 ? '<text x="' + (X(last.t) + 8) + '" y="' + (Y(last.v) + 4) + '" fill="#C4C9D0" font-size="12" font-family="JetBrains Mono, monospace">' + esc(x.s.map) + '</text>' : '';
      return '<path d="' + d + '" fill="none" stroke="' + x.s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' + label;
    }).join('');

    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Players online, ' + esc(range.name) + '">' + g + lines +
      '<line id="xh" y1="' + T + '" y2="' + (T + ih) + '" stroke="#5A606A" stroke-width="1" style="display:none"/>' +
      '<g id="dots"></g><rect id="hit" x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg><div class="tip" id="tip"></div>';

    legend.innerHTML = series.length > 1 ? series.map(function (x) { return '<span><i style="background:' + x.s.color + '"></i>' + esc(x.s.map) + '</span>'; }).join('') : '';

    /* hover: crosshair + tooltip with every shown series at the nearest time */
    var svg = box.querySelector('svg'), hit = svg.querySelector('#hit'), xh = svg.querySelector('#xh'), dots = svg.querySelector('#dots'), tip = box.querySelector('#tip');
    function nearest(pts, t) {
      var best = null, bd = Infinity;
      for (var k = 0; k < pts.length; k++) { var dd = Math.abs(pts[k].t - t); if (dd < bd) { bd = dd; best = pts[k]; } }
      return best;
    }
    function move(ev) {
      var r = svg.getBoundingClientRect();
      var sx = (ev.clientX - r.left) / r.width * W;
      var t = from + (sx - L) / iw * (now - from);
      var rows = [], dh = '', cx = null;
      series.forEach(function (x) {
        var p = nearest(x.pts, t); if (!p) return;
        cx = X(p.t);
        if (p.v != null) dh += '<circle cx="' + X(p.t) + '" cy="' + Y(p.v) + '" r="5" fill="' + x.s.color + '" stroke="#111317" stroke-width="2"/>';
        rows.push('<div style="display:flex;justify-content:space-between;gap:16px"><span><i style="display:inline-block;width:10px;height:2px;background:' + x.s.color + ';vertical-align:middle;margin-right:6px"></i>' + esc(x.s.map) + '</span><b>' + (p.v == null ? 'offline' : p.v) + '</b></div>');
      });
      if (cx == null) return;
      xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.style.display = '';
      dots.innerHTML = dh;
      tip.innerHTML = '<div class="hud" style="font-size:10px;margin-bottom:6px">' + new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div>' + rows.join('');
      tip.style.display = 'block';
      tip.style.left = (cx / W * r.width) + 'px';
      tip.style.top = (T / H * r.height) + 'px';
    }
    function leave() { xh.style.display = 'none'; dots.innerHTML = ''; tip.style.display = 'none'; }
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', leave);
    hit.addEventListener('touchstart', function (e) { move(e.touches[0]); }, { passive: true });

    /* table view */
    table.innerHTML = '<thead><tr><th>Server</th><th class="r">Now</th><th class="r">Average</th><th class="r">Peak</th></tr></thead><tbody>' +
      series.map(function (x) {
        var vals = x.pts.filter(function (p) { return p.v != null; }).map(function (p) { return p.v; });
        var avg = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : '—';
        var lastp = x.pts[x.pts.length - 1];
        return '<tr><td>' + esc(x.s.name) + '</td><td class="r mono">' + (lastp.v == null ? 'offline' : lastp.v) + '</td><td class="r mono">' + avg + '</td><td class="r mono">' + (vals.length ? Math.max.apply(null, vals) : '—') + '</td></tr>';
      }).join('') + '</tbody>';
  }


  /* =================== MM BlackBox helpers =================== */
  function scope() { return state.srv === 'all' ? 'network' : state.srv; }
  function seasonName(id) { id = String(id || ''); return id ? id.replace(/[-_]+/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) : 'This season'; }
  function curSeason() { return !D.bb ? '' : state.srv === 'all' ? D.bb.network_season : ((D.bb.servers[state.srv] || {}).season_id); }
  function isArchive() { return state.period === 'archive'; }
  function pastEntry() { var id = state.period.indexOf('past-') === 0 ? state.period.slice(5) : null; return id && D.bb ? D.bb.past_seasons.filter(function (p) { return p.season_id === id; })[0] : null; }
  function periodName() { var p = pastEntry(); return isArchive() ? 'Before BlackBox' : state.period === 'all_time' ? 'All-time' : p ? seasonName(p.season_id) + ' (ended)' : seasonName(curSeason()); }
  function hasScope() { if (!D.bb) return false; var p = pastEntry(); return p ? !!p.scopes[scope()] : !!D.bb.scopes[scope()]; }
  function summary() { var p = pastEntry(); return p ? p.scopes[scope()] : (D.bb.scopes[scope()] || {})[state.period]; }
  function boardsFile() {
    var key = scope() + '-' + state.period;
    if (!D.cache[key]) D.cache[key] = getJSON('data/live/bb/boards-' + key + '.json');
    return D.cache[key];
  }
  function srvName(id) { var s = srvById(id); return s ? s.map : id; }
  function scopeLabel(short) { return state.srv === 'all' ? 'All servers' : short ? srvById(state.srv).map : srvById(state.srv).name; }
  function periodItems() {
    var items = [];
    if (D.bb) {
      items.push({ id: 'all_time', label: 'All-time' }, { id: 'season', label: seasonName(curSeason()) });
      D.bb.past_seasons.forEach(function (p) { items.push({ id: 'past-' + p.season_id, label: seasonName(p.season_id) }); });
    }
    if (D.arch) items.push({ id: 'archive', label: 'Before BlackBox' });
    return items;
  }

  /* =================== archived CFTools records (frozen; see data/archive/cftools.json) =================== */
  function archDate() { return D.arch ? new Date(D.arch.frozen_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }
  function archRows(cat) { return ((state.srv === 'all' ? D.arch.combined : (D.arch.servers[state.srv] || {})) || {})[cat] || []; }
  function archPlayer(name) {
    if (!D.arch || !name) return null;
    var n = name.toLowerCase();
    return D.arch.players.filter(function (x) { return (x.name || '').toLowerCase() === n; })[0] || null;
  }
  function archTotals(p) {
    var t = { playtime: 0, deaths: 0, servers: 0 };
    Object.keys(p.servers || {}).forEach(function (id) {
      if (state.srv !== 'all' && id !== state.srv) return;
      t.playtime += p.servers[id].playtime || 0; t.deaths += p.servers[id].deaths || 0; t.servers++;
    });
    return t;
  }

  /* =================== leaderboard =================== */
  function renderBoard() {
    var items = periodItems(), pc = document.getElementById('period-chips');
    var table = document.getElementById('lb-table'), more = document.getElementById('lb-more'), note = document.getElementById('lb-note');
    if (!items.length) {
      document.getElementById('lb-label').textContent = 'Leaderboard';
      document.getElementById('group-chips').hidden = document.getElementById('cat-chips').hidden = pc.hidden = note.hidden = more.hidden = true;
      table.innerHTML = '<tbody><tr><td><div class="empty">Leaderboards appear here once the stats feed is connected</div></td></tr></tbody>';
      return;
    }
    if (!items.some(function (p) { return p.id === state.period; })) state.period = items[0].id;
    pc.hidden = false;
    chips(pc, items, state.period, function (id) { state.period = id; state.more = false; renderBoard(); renderDeaths(); renderRecords(); });
    if (isArchive()) archiveBoard(); else bbBoard();
  }

  function archiveBoard() {
    document.getElementById('group-chips').hidden = true;
    var cc = document.getElementById('cat-chips'); cc.hidden = false;
    if (!CATS.some(function (c) { return c.id === state.cat; })) state.cat = 'playtime';
    chips(cc, CATS, state.cat, function (id) { state.cat = id; state.more = false; renderBoard(); });
    var cat = CATS.filter(function (c) { return c.id === state.cat; })[0];
    document.getElementById('lb-label').textContent = 'Leaderboard · ' + scopeLabel() + ' · Before BlackBox';
    var note = document.getElementById('lb-note');
    note.textContent = 'Archived CFTools records up to ' + archDate() + ', from before MM BlackBox started counting. These are frozen and no longer change.';
    note.hidden = false;
    var table = document.getElementById('lb-table'), more = document.getElementById('lb-more');
    table.setAttribute('data-want', '');
    var head = '<thead><tr><th style="width:64px">Rank</th><th>Player</th><th class="r">' + esc(cat.unit) + '</th></tr></thead>';
    var rows = archRows(cat.id);
    if (!rows.length) { table.innerHTML = head + '<tbody><tr><td colspan="3"><div class="empty">No archived records for this server</div></td></tr></tbody>'; more.hidden = true; return; }
    table.innerHTML = head + '<tbody>' + rows.slice(0, state.more ? 50 : 25).map(function (r, i) {
      var cls = i === 0 ? 'top1' : i < 3 ? 'top3' : '';
      return '<tr><td><span class="rank ' + cls + '">' + String(i + 1).padStart(2, '0') + '</span></td><td>' + esc(r.name) + '</td><td class="r mono" style="color:var(--silver)">' + cat.fmt(r.value) + '</td></tr>';
    }).join('') + '</tbody>';
    more.hidden = rows.length <= 25;
    more.textContent = state.more ? 'Show top 25' : 'Show top ' + Math.min(50, rows.length);
  }

  function bbBoard() {
    var gc = document.getElementById('group-chips');
    gc.hidden = false;
    chips(gc, GROUPS, state.group, function (id) { state.group = id; state.board = GROUPS.filter(function (g) { return g.id === id; })[0].boards[0]; state.more = false; renderBoard(); });
    var grp = GROUPS.filter(function (g) { return g.id === state.group; })[0];
    var cc = document.getElementById('cat-chips');
    cc.hidden = grp.boards.length < 2;
    chips(cc, grp.boards.map(function (b) { return { id: b, label: BB[b].label }; }), state.board, function (id) { state.board = id; state.more = false; renderBoard(); });

    var b = BB[state.board], extraCol = b.extra && !(state.board === 'alive' && state.srv !== 'all');
    document.getElementById('lb-label').textContent = 'Leaderboard · ' + scopeLabel() + ' · ' + periodName();
    var note = document.getElementById('lb-note');
    var noteText = (b.note || '') + (b.min ? (b.note ? ' ' : '') + 'Needs at least ' + D.bb.min_kills_for_ratios + ' AI kills.' : '');
    note.textContent = noteText; note.hidden = !noteText;
    var table = document.getElementById('lb-table'), more = document.getElementById('lb-more');
    var head = '<thead><tr><th style="width:64px">Rank</th><th>Player</th>' + (extraCol ? '<th>' + esc(b.extra) + '</th>' : '') + '<th class="r">' + esc(b.unit) + '</th></tr></thead>';
    var cols = extraCol ? 4 : 3;
    var empty = function (msg) { table.innerHTML = head + '<tbody><tr><td colspan="' + cols + '"><div class="empty">' + msg + '</div></td></tr></tbody>'; more.hidden = true; };
    if (!hasScope()) return empty(pastEntry() ? 'This server wasn’t part of that season' : 'No BlackBox stats from this server yet');
    var want = state.board + scope() + state.period;
    table.setAttribute('data-want', want);
    boardsFile().then(function (bd) {
      if (table.getAttribute('data-want') !== want) return; // the user moved on
      var rows = bd[state.board] || [];
      if (!rows.length) return empty('No entries for this board yet');
      var show = rows.slice(0, state.more ? 50 : 25);
      table.innerHTML = head + '<tbody>' + show.map(function (r, i) {
        var cls = i === 0 ? 'top1' : i < 3 ? 'top3' : '';
        var ex = r[3] || '';
        if (state.board === 'alive') ex = srvName(ex);
        return '<tr><td><span class="rank ' + cls + '">' + String(i + 1).padStart(2, '0') + '</span></td>' +
          '<td><button type="button" class="plink" data-pid="' + esc(r[0]) + '">' + esc(r[1]) + '</button></td>' +
          (extraCol ? '<td class="mono" style="font-size:14px;color:var(--muted)">' + (ex ? esc(ex) : '—') + '</td>' : '') +
          '<td class="r mono" style="color:var(--silver)">' + b.fmt(r[2]) + '</td></tr>';
      }).join('') + '</tbody>';
      more.hidden = rows.length <= 25;
      more.textContent = state.more ? 'Show top 25' : 'Show top ' + rows.length;
    }).catch(function () { empty('This board couldn’t be loaded'); });
  }

  /* =================== causes of death (one series, horizontal bars) =================== */
  function renderDeaths() {
    var sec = document.getElementById('deaths-section'), spacer = document.getElementById('deaths-spacer');
    var sum = D.bb && !isArchive() && hasScope() ? summary() : null;
    var by = sum && sum.deaths_by, keys = by ? Object.keys(DEATHS).filter(function (k) { return by[k] > 0; }) : [];
    sec.hidden = !keys.length; spacer.hidden = !!keys.length;
    if (!keys.length) return;
    keys.sort(function (a, b) { return by[b] - by[a]; });
    var total = keys.reduce(function (a, k) { return a + by[k]; }, 0), top = by[keys[0]];
    document.getElementById('deaths-label').textContent = 'Causes of death · ' + scopeLabel() + ' · ' + periodName() + ' · ' + num(total) + ' deaths';
    document.getElementById('deaths-chart').innerHTML = keys.map(function (k) {
      var share = by[k] / total * 100, w = Math.max(0.6, by[k] / top * 100);
      var tip = DEATHS[k] + ': ' + num(by[k]) + ' deaths (' + share.toFixed(1) + '%)';
      return '<div class="dbar" title="' + esc(tip) + '"><span class="dbar-l">' + esc(DEATHS[k]) + '</span>' +
        '<span class="dbar-t"><i style="width:' + w.toFixed(2) + '%"></i></span>' +
        '<span class="dbar-v mono">' + num(by[k]) + ' <em>' + share.toFixed(share < 10 ? 1 : 0) + '%</em></span></div>';
    }).join('');
  }

  /* =================== player lookup =================== */
  function pickList(items) {
    return '<div class="stack" style="gap:8px;padding-top:8px"><span class="hud">Pick a player</span>' + items.map(function (it) {
      return '<button type="button" class="chip" ' + it.attr + ' style="justify-content:flex-start;text-transform:none;letter-spacing:0;font-size:14px">' + esc(it.name) + '</button>';
    }).join('') + '</div>';
  }
  function rank(a, b, q) { return (b.toLowerCase() === q) - (a.toLowerCase() === q) || (a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q)); }
  function lookup(q) {
    var out = document.getElementById('lookup-out');
    q = (q || '').trim().toLowerCase();
    if (!q) return;
    if (!D.bbIdx && !D.arch) { out.innerHTML = '<p class="empty">Player lookup goes live once the stats feed is connected</p>'; return; }
    var hits = (D.bbIdx || []).filter(function (p) { return p[1].toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return rank(a[1], b[1], q); }).slice(0, 8);
    if (hits.length) {
      if (hits.length > 1 && hits[0][1].toLowerCase() !== q) { out.innerHTML = pickList(hits.map(function (p) { return { name: p[1], attr: 'data-pid="' + esc(p[0]) + '"' }; })); return; }
      return bbProfile(hits[0][0]);
    }
    // not on the BlackBox boards yet: try the archived CFTools records
    var old = D.arch ? D.arch.players.filter(function (p) { return (p.name || '').toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return rank(a.name, b.name, q); }).slice(0, 8) : [];
    if (!old.length) { out.innerHTML = '<p class="small">No match for “' + esc(q) + '”. New players appear after 10 minutes of play and the next stats update.</p>'; return; }
    if (old.length > 1 && old[0].name.toLowerCase() !== q) { out.innerHTML = pickList(old.map(function (p) { return { name: p.name, attr: 'data-arch="' + esc(p.name) + '"' }; })); return; }
    archProfile(old[0]);
  }

  function tileGrid(tiles) {
    return '<div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + tiles.map(function (t) {
      return '<div style="padding:12px 14px;background:var(--bg);border:1px solid var(--line)" class="stack"><span class="hud" style="font-size:10px">' + t[0] + '</span><span class="statnum" style="font-size:22px">' + t[1] + '</span>' +
        (t[2] ? '<span class="mono" style="font-size:12px;color:var(--muted);overflow-wrap:anywhere">' + esc(t[2]) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function archProfile(p) {
    var t = archTotals(p);
    document.getElementById('lookup-out').innerHTML = '<div class="stack" style="gap:14px;padding-top:14px;border-top:1px solid var(--line)">' +
      '<div class="stack" style="gap:4px"><span class="h4" style="font-size:22px;font-weight:700;overflow-wrap:anywhere">' + esc(p.name) + '</span>' +
      '<span class="hud" style="font-size:11px">' + esc(scopeLabel()) + ' · before BlackBox</span></div>' +
      tileGrid([['Hours played', hours(t.playtime)], ['Deaths', num(t.deaths)]]) +
      '<p class="small">From our archived CFTools records (up to ' + esc(archDate()) + '). No MM BlackBox stats for this name yet.</p></div>';
  }

  var shardCache = {};
  function bbProfile(id, period) {
    var out = document.getElementById('lookup-out');
    var key = id.slice(0, 2);
    if (!shardCache[key]) shardCache[key] = getJSON('data/live/bb/p/' + key + '.json');
    shardCache[key].then(function (sh) {
      var p = sh[id]; if (!p) throw 0;
      state.look = { id: id, period: period || (state.period === 'season' ? 'season' : 'all_time') };
      var per = state.look.period;
      var single = state.srv !== 'all' && p.servers[state.srv];
      var s = single ? p.servers[state.srv][per] : (p.network || {})[per];
      var playedOn = Object.keys(p.servers).filter(function (k) { return p.servers[k][per]; });
      var head = '<div class="stack" style="gap:4px"><span class="h4" style="font-size:22px;font-weight:700;overflow-wrap:anywhere">' + esc(p.name) + '</span>' +
        '<span class="hud" style="font-size:11px">' + (single ? esc(srvById(state.srv).name) : 'All servers') + (playedOn.length ? ' · plays on ' + playedOn.map(function (k) { return esc(srvName(k)); }).join(', ') : '') + '</span></div>' +
        '<div class="row" role="group" aria-label="Record period" style="gap:8px">' + ['all_time', 'season'].map(function (k) {
          return '<button type="button" class="chip" data-look-period="' + k + '" aria-pressed="' + (k === per) + '">' + (k === 'all_time' ? 'All-time' : esc(seasonName(curSeason()))) + '</button>';
        }).join('') + '</div>';
      if (!s) { out.innerHTML = '<div class="stack" style="gap:14px;padding-top:14px;border-top:1px solid var(--line)">' + head + '<p class="small">No ' + (per === 'season' ? 'stats this season' : 'stats') + (single ? ' on this server' : '') + ' yet.</p></div>'; return; }
      var travel = s.travel_m.foot + s.travel_m.land + s.travel_m.air + s.travel_m.boat;
      var minK = D.bb.min_kills_for_ratios;
      var tiles = [
        ['Hours played', hours(s.playtime_s)], ['AI kills', num(s.ai_kills)],
        ['Deaths', num(s.deaths)], ['AI kills per death', s.ai_kills >= minK ? ratio(s.ai_kills / Math.max(1, s.deaths)) : '—'],
        ['Headshot %', s.ai_kills >= minK ? pct(s.ai_headshots / s.ai_kills * 100) : '—'], ['Kill streak', num(s.best_kill_streak)],
        ['Longest AI kill', metres(s.longest_ai_kill_m), s.longest_ai_kill_weapon], ['Longest shot', metres(s.longest_hit_m), s.longest_hit_weapon],
        ['Longest life', dur(s.longest_life_s)], ['Current life', s.current_life_s ? dur(s.current_life_s) : 'Dead', !single && s.current_life_s && s._alive_on ? srvName(s._alive_on) : ''],
        ['Distance travelled', dist(travel)], ['Infected kills', num(s.infected_kills)],
        ['Animals hunted', num(s.animal_kills)], ['Base parts built', num(s.parts_built)]
      ];
      var old = per === 'all_time' ? archPlayer(p.name) : null, oldT = old ? archTotals(old) : null;
      var ranks = [];
      if (!single && p.ranks && p.ranks[per]) {
        Object.keys(p.ranks[per]).forEach(function (b) { if (BB[b] && b !== 'deaths') ranks.push({ b: b, r: p.ranks[per][b] }); });
        ranks.sort(function (a, b) { return a.r - b.r; });
      }
      var causes = Object.keys(DEATHS).filter(function (k) { return s.deaths_by[k] > 0; }).sort(function (a, b) { return s.deaths_by[b] - s.deaths_by[a]; }).slice(0, 3);
      out.innerHTML = '<div class="stack" style="gap:14px;padding-top:14px;border-top:1px solid var(--line)">' + head + tileGrid(tiles) +
        (ranks.length ? '<div class="tags">' + ranks.slice(0, 5).map(function (x) { return '<span class="tag tag-o">#' + x.r + ' ' + esc(BB[x.b].label) + '</span>'; }).join('') + '</div>' : '') +
        (causes.length ? '<p class="small">Most often killed by: ' + causes.map(function (k) { return esc(DEATHS[k].toLowerCase()) + ' (' + num(s.deaths_by[k]) + ')'; }).join(', ') + '</p>' : '') +
        (oldT && oldT.playtime ? '<p class="small">Before BlackBox (archived CFTools records): ' + hours(oldT.playtime) + ' played, ' + num(oldT.deaths) + ' deaths.</p>' : '') +
        '</div>';
    }).catch(function () { out.innerHTML = '<p class="small">That record couldn’t be loaded. Try again after the next update.</p>'; });
  }

  /* =================== records =================== */
  function card(title, value, sub) {
    return '<div class="panel brk pad stack" style="gap:8px"><span class="hud">' + esc(title) + '</span><span class="statnum" style="color:var(--orange)">' + (value != null ? esc(value) : '—') + '</span><span class="body">' + (sub ? esc(sub) : 'Waiting for data') + '</span></div>';
  }
  function peakPop() {
    var peak = null;
    if (D.history && D.history.servers) Object.keys(D.history.servers).forEach(function (id) {
      if (state.srv !== 'all' && id !== state.srv) return;
      D.history.servers[id].forEach(function (p) { if (p[1] != null && (!peak || p[1] > peak.v)) peak = { v: p[1], id: id, t: p[0] }; });
    });
    return peak;
  }
  function renderRecords() {
    var peak = peakPop(), box = document.getElementById('records');
    var peakCard = card('Peak population', peak && peak.v, peak && (srvName(peak.id) + ' · ' + new Date(peak.t * 1000).toLocaleDateString()));
    document.getElementById('records-label').textContent = '// Hall of fame · ' + scopeLabel(true) + ' · ' + periodName();
    if (isArchive()) {
      var h = archRows('playtime')[0], d = archRows('deaths')[0];
      box.innerHTML = [
        card('Most hours played', h && hours(h.value), h && h.name),
        card('Most deaths', d && num(d.value), d && d.name),
        card('Players in the archive', num(D.arch.players.filter(function (p) { return archTotals(p).servers > 0; }).length), 'CFTools records up to ' + archDate())
      ].join('');
      return;
    }
    var sm = hasScope() ? summary() : null, rec = (sm && sm.records) || {};
    var r = function (k, fmt, withExtra) { var x = rec[k]; return x ? [fmt(x[2]), x[1] + (withExtra && x[3] ? ' · ' + x[3] : '')] : [null, null]; };
    var cards = [
      ['Most hours played'].concat(r('playtime', hours)), ['Most AI kills'].concat(r('ai_kills', num)),
      ['Longest AI kill'].concat(r('longest_ai_kill', metres, true)), ['Best kill streak'].concat(r('best_kill_streak', num)),
      ['Longest life'].concat(r('longest_life', dur)), ['Furthest travelled'].concat(r('travel', dist))
    ];
    var totals = [
      card('AI killed', sm ? num(sm.ai_kills) : null, sm ? 'By ' + num(sm.players) + ' mercs on the boards' : null),
      card('Distance covered', sm ? dist(sm.travel_m) : null, sm ? num(sm.infected_kills) + ' infected put down on the way' : null)
    ];
    if (!pastEntry()) totals.push(peakCard); // population history isn't kept per season
    box.innerHTML = cards.map(function (c) { return card(c[0], c[1], c[2]); }).join('') + totals.join('');
  }

  /* =================== wiring =================== */
  function renderAll() {
    chips(document.getElementById('server-chips'), [{ id: 'all', label: 'All servers' }].concat(servers().map(function (s) { return { id: s.id, label: s.map }; })), state.srv, function (id) {
      state.srv = id; state.more = false; renderAll();
      if (state.look && D.bb) bbProfile(state.look.id, state.look.period);
    });
    rangeChips();
    renderStatus(); renderChart(); renderBoard(); renderDeaths(); renderRecords();
  }
  function rangeChips() {
    chips(document.getElementById('range-chips'), RANGES, state.range, function (id) { state.range = id; rangeChips(); renderChart(); });
  }

  var rz;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (D.cfg) renderChart(); }, 200); });

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
      getJSON('data/servers.json'),
      opt(getJSON('data/live/status.json')),
      opt(getJSON('data/live/history.json')),
      opt(getJSON('data/archive/cftools.json')),
      opt(getJSON('data/live/bb/meta.json')),
      opt(getJSON('data/live/bb/index.json'))
    ]).then(function (r) {
      D.cfg = r[0]; D.status = r[1]; D.history = r[2]; D.arch = r[3] && r[3].players ? r[3] : null;
      if (r[4] && r[4].scopes) { D.bb = r[4]; D.bbIdx = r[5] || []; }
      if (!srvById(state.srv)) state.srv = 'all';
      var gen = (D.status && D.status.generated_at) || (D.bb && D.bb.generated_at);
      document.getElementById('updated').textContent = gen ? 'Updated ' + new Date(gen).toLocaleString() : 'Stats feed not connected yet';
      document.getElementById('lookup-hint').textContent = 'Shows your hours played, AI kills, longest shot, distance travelled and where you rank.';
      document.getElementById('about-data').textContent = 'Player stats are recorded by MM BlackBox on each server and refreshed about every 30 minutes. All servers adds your stats from every map together. Season boards restart at each wipe; all-time boards keep going. Players with under 10 minutes played and staff aren’t listed.' +
        (D.arch ? ' “Before BlackBox” keeps our older CFTools records (hours played and deaths) up to ' + archDate() + '.' : '') + ' Want your name hidden? Ask any staff member.';
      renderAll();
      var q = params.get('player');
      if (q) { document.getElementById('lookup').value = q; lookup(q); }
    }).catch(function () {
      document.getElementById('status-cards').innerHTML = '<p class="empty">Stats are unavailable right now</p>';
    });
    document.getElementById('lookup-form').addEventListener('submit', function (e) { e.preventDefault(); lookup(document.getElementById('lookup').value); });
    document.getElementById('lb-more').addEventListener('click', function () { state.more = !state.more; renderBoard(); });
    /* clicking a name on the board, or a pick-list / period button in the lookup */
    document.addEventListener('click', function (e) {
      var pl = e.target.closest('[data-pid]');
      if (pl && D.bb) {
        e.preventDefault();
        bbProfile(pl.getAttribute('data-pid'));
        if (pl.classList.contains('plink')) {
          var box = document.getElementById('lookup-out');
          if (box.getBoundingClientRect().top < 0 || box.getBoundingClientRect().top > innerHeight) document.getElementById('lookup-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
      var ar = e.target.closest('[data-arch]');
      if (ar && D.arch) { var ap = archPlayer(ar.getAttribute('data-arch')); if (ap) archProfile(ap); return; }
      var lp = e.target.closest('[data-look-period]');
      if (lp && state.look) bbProfile(state.look.id, lp.getAttribute('data-look-period'));
    });
  });
})();
