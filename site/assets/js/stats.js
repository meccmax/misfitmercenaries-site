/* =====================================================================
   Misfit Mercenaries — Stats page
   Reads:  data/servers.json            (server list, colours, restart hours)
           data/live/status.json        (online / players right now)
           data/live/history.json       (player count over time)
           data/live/leaderboards.json  (top 100 per stat, per server + combined)
           data/live/players.json       (lookup index)
   The data/live files are written by scripts/update-stats.mjs (GitHub Action).
   If they don't exist yet, the page shows "not connected" placeholders.
   ===================================================================== */
(function () {
  'use strict';
  var esc = function (s) { return window.MM.esc(s); };
  var getJSON = function (u) { return window.MM.getJSON(u); };
  var opt = function (p) { return p.catch(function () { return null; }); };

  var CATS = [
    { id: 'playtime', label: 'Playtime', unit: 'Hours', fmt: hours },
    { id: 'kills', label: 'Player kills', unit: 'Kills', fmt: num },
    { id: 'kdratio', label: 'K/D', unit: 'K/D ratio', fmt: function (v) { return (+v || 0).toFixed(2); } },
    { id: 'longest_shot', label: 'Longest shot', unit: 'Distance', fmt: metres },
    { id: 'longest_kill', label: 'Longest kill', unit: 'Distance', fmt: metres },
    { id: 'deaths', label: 'Deaths', unit: 'Deaths', fmt: num }
  ];
  var RANGES = [
    { id: '24h', label: '24h', name: 'last 24 hours', ms: 864e5 },
    { id: '7d', label: '7 days', name: 'last 7 days', ms: 7 * 864e5 },
    { id: '30d', label: '30 days', name: 'last 30 days', ms: 30 * 864e5 }
  ];

  function num(v) { return (+v || 0).toLocaleString(); }
  function metres(v) { return (+v || 0) ? Math.round(+v).toLocaleString() + ' m' : '—'; }
  function hours(sec) { return (+sec || 0) ? Math.round(+sec / 3600).toLocaleString() + ' h' : '—'; }

  var params = new URLSearchParams(location.search);
  var state = { srv: params.get('server') || 'all', range: '24h', cat: 'playtime' };
  var D = { cfg: null, status: null, history: null, lb: null, players: null };

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

  /* ---------- leaderboard ---------- */
  function renderBoard() {
    var cat = CATS.filter(function (c) { return c.id === state.cat; })[0];
    var all = state.srv === 'all';
    document.getElementById('lb-label').textContent = 'Leaderboard · ' + (all ? 'All servers' : srvById(state.srv).name);
    var rows = [];
    if (D.lb) rows = (all ? (D.lb.combined || {})[cat.id] : ((D.lb.servers || {})[state.srv] || {})[cat.id]) || [];
    var table = document.getElementById('lb-table');
    var head = '<thead><tr><th style="width:64px">Rank</th><th>Player</th><th class="r">' + esc(cat.unit) + '</th></tr></thead>';
    if (!rows.length) {
      table.innerHTML = head + '<tbody><tr><td colspan="3"><div class="empty">' + (D.lb ? 'No entries for this board yet' : 'Leaderboards appear here once the stats feed is connected') + '</div></td></tr></tbody>';
      return;
    }
    table.innerHTML = head + '<tbody>' + rows.slice(0, 25).map(function (p, i) {
      var cls = i === 0 ? 'top1' : i < 3 ? 'top3' : '';
      return '<tr><td><span class="rank ' + cls + '">' + String(i + 1).padStart(2, '0') + '</span></td><td>' + esc(p.name) + '</td><td class="r mono" style="color:var(--silver)">' + cat.fmt(p.value) + '</td></tr>';
    }).join('') + '</tbody>';
  }

  /* ---------- player lookup ---------- */
  function lookup(q) {
    var out = document.getElementById('lookup-out');
    q = (q || '').trim().toLowerCase();
    if (!q) return;
    if (!D.players) { out.innerHTML = '<p class="empty">Player lookup goes live once the stats feed is connected</p>'; return; }
    var hits = D.players.players.filter(function (p) {
      return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.names || []).some(function (n) { return n.toLowerCase().indexOf(q) !== -1; });
    }).slice(0, 8);
    if (!hits.length) { out.innerHTML = '<p class="small">No match for “' + esc(q) + '”. Lookup covers players who appear on at least one top-100 board.</p>'; return; }
    if (hits.length > 1 && hits[0].name.toLowerCase() !== q) {
      out.innerHTML = '<div class="stack" style="gap:8px;padding-top:8px"><span class="hud">Pick a player</span>' + hits.map(function (p, i) {
        return '<button type="button" class="chip" data-pick="' + i + '" style="justify-content:flex-start">' + esc(p.name) + '</button>';
      }).join('') + '</div>';
      out.onclick = function (e) { var b = e.target.closest('[data-pick]'); if (b) profile(hits[+b.getAttribute('data-pick')]); };
      return;
    }
    profile(hits[0]);
  }
  function profile(p) {
    var out = document.getElementById('lookup-out');
    var ids = Object.keys(p.servers || {});
    var pick = state.srv !== 'all' && p.servers[state.srv] ? [state.srv] : ids;
    var tot = { kills: 0, deaths: 0, playtime: 0, longest_shot: 0, longest_kill: 0 };
    pick.forEach(function (id) {
      var s = p.servers[id];
      tot.kills += s.kills || 0; tot.deaths += s.deaths || 0; tot.playtime += s.playtime || 0;
      tot.longest_shot = Math.max(tot.longest_shot, s.longest_shot || 0); tot.longest_kill = Math.max(tot.longest_kill, s.longest_kill || 0);
    });
    var kd = tot.deaths ? tot.kills / tot.deaths : tot.kills;
    var tiles = [['Player kills', num(tot.kills)], ['Deaths', num(tot.deaths)], ['K/D', kd.toFixed(2)], ['Longest shot', metres(tot.longest_shot)], ['Hours played', hours(tot.playtime)], ['Longest kill', metres(tot.longest_kill)]];
    var best = [];
    pick.forEach(function (id) {
      var r = (p.ranks || {})[id] || {};
      Object.keys(r).forEach(function (k) {
        var c = CATS.filter(function (x) { return x.id === k; })[0];
        if (c && k !== 'deaths') best.push({ rank: r[k], label: c.label, where: (srvById(id) || {}).map || id });
      });
    });
    best.sort(function (a, b) { return a.rank - b.rank; });
    var ranks = best.slice(0, 4).map(function (b) {
      return '<span class="tag tag-o">#' + b.rank + ' ' + esc(b.label) + (pick.length > 1 ? ' · ' + esc(b.where) : '') + '</span>';
    });
    out.innerHTML = '<div class="stack" style="gap:14px;padding-top:14px;border-top:1px solid var(--line)">' +
      '<div class="stack" style="gap:4px"><span class="h4" style="font-size:22px;font-weight:700;overflow-wrap:anywhere">' + esc(p.name) + '</span>' +
      '<span class="hud" style="font-size:11px">' + (pick.length > 1 ? 'All servers' : esc((srvById(pick[0]) || {}).name || pick[0])) + '</span></div>' +
      '<div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + tiles.map(function (t) {
        return '<div style="padding:14px;background:var(--bg);border:1px solid var(--line)" class="stack"><span class="hud" style="font-size:10px">' + t[0] + '</span><span class="statnum" style="font-size:24px">' + t[1] + '</span></div>';
      }).join('') + '</div>' + (ranks.length ? '<div class="tags">' + ranks.join('') + '</div>' : '') + '</div>';
  }

  /* ---------- records ---------- */
  function renderRecords() {
    var c = (D.lb && D.lb.combined) || {};
    var top = function (k) { return (c[k] || [])[0]; };
    var peak = null;
    if (D.history && D.history.servers) {
      Object.keys(D.history.servers).forEach(function (id) {
        D.history.servers[id].forEach(function (p) { if (p[1] != null && (!peak || p[1] > peak.v)) peak = { v: p[1], id: id, t: p[0] }; });
      });
    }
    var cards = [
      ['Longest shot', top('longest_shot') && metres(top('longest_shot').value), top('longest_shot') && top('longest_shot').name],
      ['Most player kills', top('kills') && num(top('kills').value), top('kills') && top('kills').name],
      ['Most hours played', top('playtime') && hours(top('playtime').value), top('playtime') && top('playtime').name],
      ['Peak population', peak && peak.v, peak && (((srvById(peak.id) || {}).map || peak.id) + ' · ' + new Date(peak.t * 1000).toLocaleDateString())]
    ];
    document.getElementById('records').innerHTML = cards.map(function (r) {
      return '<div class="panel brk pad stack" style="gap:8px"><span class="hud">' + r[0] + '</span><span class="statnum" style="color:var(--orange)">' + (r[1] != null && r[1] !== undefined ? esc(r[1]) : '—') + '</span><span class="body">' + (r[2] ? esc(r[2]) : 'Waiting for data') + '</span></div>';
    }).join('');
  }

  function renderAll() {
    chips(document.getElementById('server-chips'), [{ id: 'all', label: 'All servers' }].concat(servers().map(function (s) { return { id: s.id, label: s.map }; })), state.srv, function (id) { state.srv = id; renderAll(); });
    rangeChips(); catChips();
    renderStatus(); renderChart(); renderBoard(); renderRecords();
  }
  function rangeChips() {
    chips(document.getElementById('range-chips'), RANGES, state.range, function (id) { state.range = id; rangeChips(); renderChart(); });
  }
  function catChips() {
    chips(document.getElementById('cat-chips'), CATS, state.cat, function (id) { state.cat = id; catChips(); renderBoard(); });
  }

  var rz;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (D.cfg) renderChart(); }, 200); });

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
      getJSON('data/servers.json'),
      opt(getJSON('data/live/status.json')),
      opt(getJSON('data/live/history.json')),
      opt(getJSON('data/live/leaderboards.json')),
      opt(getJSON('data/live/players.json'))
    ]).then(function (r) {
      D.cfg = r[0]; D.status = r[1]; D.history = r[2]; D.lb = r[3]; D.players = r[4];
      if (!srvById(state.srv)) state.srv = 'all';
      var gen = (D.status && D.status.generated_at) || (D.lb && D.lb.generated_at);
      document.getElementById('updated').textContent = gen ? 'Updated ' + new Date(gen).toLocaleString() : 'Stats feed not connected yet';
      renderAll();
      var q = params.get('player');
      if (q) { document.getElementById('lookup').value = q; lookup(q); }
    }).catch(function () {
      document.getElementById('status-cards').innerHTML = '<p class="empty">Stats are unavailable right now</p>';
    });
    document.getElementById('lookup-form').addEventListener('submit', function (e) { e.preventDefault(); lookup(document.getElementById('lookup').value); });
  });
})();
