/* =====================================================================
   Misfit Mercenaries — shared site script
   - Builds the header and footer on every page (edit them once, here)
   - Mobile menu, copy-address buttons, filter chips
   - Renders the DayZ server cards (data/servers.json) and mod list (data/mods.json)
   ===================================================================== */
(function () {
  'use strict';

  var DISCORD = 'https://www.dsc.gg/mmservers';
  var GITHUB = 'https://github.com/meccmax';

  var NAV = [
    ['home', 'Home', 'index.html'],
    ['servers', 'Servers', 'servers.html'],
    ['modding', 'Modding', 'modding.html'],
    ['tools', 'Tools', 'tools.html'],
    ['stats', 'Stats', 'stats.html'],
    ['media', 'Media', 'media.html'],
    ['about', 'About', 'about.html'],
    ['join', 'Rules', 'join.html']
  ];

  var LOGO = '<svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44" fill="none">' +
    '<path d="M22 2 L40 12 L40 32 L22 42 L4 32 L4 12 Z" stroke="#FF6B1A" stroke-width="2"/>' +
    '<path d="M22 8 L35 15.5 L35 28.5 L22 36 L9 28.5 L9 15.5 Z" stroke="#C4C9D0" stroke-opacity=".35"/>' +
    '<text x="22" y="27" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="13" fill="#E6E8EB">MM</text></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  window.MM = { esc: esc, DISCORD: DISCORD };

  /* ---------- header ---------- */
  function buildHeader() {
    var slot = document.getElementById('site-header');
    if (!slot) return;
    var active = document.body.getAttribute('data-page') || 'home';
    var links = NAV.map(function (n) {
      return '<a href="' + n[2] + '"' + (n[0] === active ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
    }).join('');
    slot.outerHTML =
      '<a class="skip" href="#main">Skip to content</a>' +
      '<div class="topbar"><div class="wrap">' +
      '<span class="hud" style="margin-left:auto"><span style="color:#FF8A3D">&#9632;</span> Node: game.misfitmercenaries.com</span></div></div>' +
      '<header class="site-header"><div class="wrap">' +
      '<a class="brand" href="index.html" aria-label="Misfit Mercenaries home">' + LOGO +
      '<span class="brand-name"><b>Misfit</b><span>Mercenaries</span></span></a>' +
      '<nav class="nav" id="main-nav" aria-label="Main">' + links + '</nav>' +
      '<div class="row"><a class="btn btn-p btn-sm header-cta" href="' + DISCORD + '">Discord</a>' +
      '<button class="nav-toggle" type="button" aria-controls="main-nav" aria-expanded="false" aria-label="Open menu">' +
      '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h16M3 11h16M3 16h16"/></svg></button></div>' +
      '</div></header>';
    var btn = document.querySelector('.nav-toggle');
    var nav = document.getElementById('main-nav');
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }

  /* ---------- footer ---------- */
  function buildFooter() {
    var slot = document.getElementById('site-footer');
    if (!slot) return;
    var year = new Date().getFullYear();
    slot.outerHTML =
      '<footer class="site-footer"><div class="wrap"><div class="foot-cols">' +
      '<div class="stack" style="flex:1 1 320px;max-width:420px">' +
      '<div style="font-family:var(--font-display);font-weight:700;font-size:22px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink)">Misfit <span class="accent">Mercenaries</span></div>' +
      '<p>A multi-game community running self-hosted servers since the late 1990s. Funded by members, never pay-to-win.</p>' +
      '<a class="btn btn-p btn-sm" href="' + DISCORD + '" style="align-self:flex-start">Join the Discord</a></div>' +
      '<nav class="foot-col" aria-label="Footer: site"><span class="hud" style="padding-bottom:8px">Navigate</span>' +
      '<a href="servers.html">Servers</a><a href="stats.html">Stats &amp; leaderboards</a><a href="modding.html">Modding</a><a href="tools.html">Tools</a><a href="media.html">Media</a></nav>' +
      '<nav class="foot-col" aria-label="Footer: community"><span class="hud" style="padding-bottom:8px">Community</span>' +
      '<a href="about.html">About us</a><a href="join.html">Server rules</a><a href="support.html">Support the servers</a><a href="' + GITHUB + '">GitHub</a></nav>' +
      '<div class="foot-col" style="min-width:260px;gap:10px"><span class="hud" style="padding-bottom:8px">Server nodes</span>' +
      '<div class="ipbox"><span>game.misfitmercenaries.com</span><span class="hud" style="font-size:10px;padding-right:6px">Main</span></div>' +
      '<div class="ipbox"><span>servers.misfitmercenaries.com</span><span class="hud" style="font-size:10px;padding-right:6px">Backup</span></div></div>' +
      '</div><div class="foot-base"><span class="hud" style="font-size:11px">&copy; ' + year + ' Misfit Mercenaries</span>' +
      '<span class="hud" style="font-size:11px">Not affiliated with Bohemia Interactive, Funcom or any game publisher</span></div></div></footer>';
  }

  /* ---------- copy buttons ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    var text = b.getAttribute('data-copy');
    var done = function () {
      var old = b.textContent; b.textContent = 'Copied';
      setTimeout(function () { b.textContent = old; }, 1400);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
  });

  /* ---------- filter chips ----------
     <div data-filter-group="x"> <button class="chip" data-filter="all" aria-pressed="true">
     items: <div data-filter-target="x"> <el data-tags="a b"> */
  function wireFilters(root) {
    (root || document).querySelectorAll('[data-filter-group]').forEach(function (g) {
      if (g._wired) return; g._wired = true;
      var name = g.getAttribute('data-filter-group');
      g.addEventListener('click', function (e) {
        var b = e.target.closest('[data-filter]');
        if (!b) return;
        var val = b.getAttribute('data-filter');
        g.querySelectorAll('[data-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var target = document.querySelector('[data-filter-target="' + name + '"]');
        if (!target) return;
        target.querySelectorAll('[data-tags]').forEach(function (it) {
          var tags = it.getAttribute('data-tags').split(' ');
          it.hidden = !(val === 'all' || tags.indexOf(val) !== -1);
        });
        var label = document.querySelector('[data-filter-label="' + name + '"]');
        if (label) label.textContent = b.getAttribute('data-title') || b.textContent;
      });
    });
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  window.MM.getJSON = getJSON;

  /* ---------- DayZ server cards (servers.html) ---------- */
  function renderServers() {
    var box = document.getElementById('dayz-servers');
    if (!box) return;
    Promise.all([
      getJSON('data/servers.json'),
      getJSON('data/live/status.json').catch(function () { return null; })
    ]).then(function (res) {
      var cfg = res[0], live = res[1];
      var host = cfg.host || 'game.misfitmercenaries.com';
      box.innerHTML = cfg.servers.map(function (s) {
        var addr = s.game_port ? host + ':' + s.game_port : null;
        var st = live && live.servers && live.servers[s.id];
        var status = st ? (st.online ? '<span class="tag tag-live tag-on">Online · ' + st.players + '/' + (st.max_players || s.slots || '?') + '</span>' : '<span class="tag tag-off">Offline</span>') : '';
        return '<article class="panel brk" style="display:flex;flex-direction:column">' +
          (s.image ? '<img class="cover banner" src="' + esc(s.image) + '" alt="' + esc(s.map) + ' banner" loading="lazy">' : '<div class="ph cover">' + esc(s.map) + '</div>') +
          '<div class="card-body">' +
          '<div class="card-top"><span class="hud-o">' + esc(s.badge || '') + '</span>' + status + '</div>' +
          '<h3 class="h3" style="font-size:30px">' + esc(s.name) + '</h3>' +
          '<p class="body">' + esc(s.description) + '</p>' +
          (s.server_name ? '<div class="stack" style="gap:4px"><span class="hud" style="font-size:11px">In the server browser</span><span class="mono" style="font-size:13px;color:var(--silver);overflow-wrap:anywhere">' + esc(s.server_name) + '</span></div>' : '') +
          '<dl class="dl"><dt>Map</dt><dd>' + esc(s.map) + '</dd><dt>Style</dt><dd>' + esc(s.style || 'Ask in Discord') + '</dd>' +
          '<dt>Slots</dt><dd>' + esc(s.slots || 'Ask in Discord') + '</dd>' +
          (s.view ? '<dt>View</dt><dd>' + esc(s.view) + '</dd>' : '') +
          '<dt>DLC</dt><dd>' + (s.dlc ? '<span class="tag tag-o">' + esc(s.dlc) + ' required</span>' : 'None needed') + '</dd></dl>' +
          (addr ? '<div class="ipbox"><span>' + esc(addr) + '</span><button class="copy" type="button" data-copy="' + esc(addr) + '">Copy</button></div>'
                : '<div class="ipbox"><span>' + esc(host) + '</span><span class="hud" style="font-size:10px;padding-right:6px">Port in Discord</span></div>') +
          '<div class="tags">' + (s.mods || []).map(function (m) { return '<span class="tag">' + esc(m) + '</span>'; }).join('') + '</div>' +
          '<div class="row push" style="padding-top:8px"><a class="btn btn-p btn-sm" href="stats.html?server=' + esc(s.id) + '">Live stats</a>' +
          (s.battlemetrics ? '<a class="btn btn-g btn-sm" href="' + esc(s.battlemetrics) + '">BattleMetrics</a>' : '<a class="btn btn-g btn-sm" href="join.html#rules">Server rules</a>') + '</div>' +
          '</div></article>';
      }).join('');
    }).catch(function () {
      box.innerHTML = '<p class="empty">Server list unavailable. Check the Discord for addresses.</p>';
    });
  }

  /* ---------- mods (modding.html) ---------- */
  function renderMods() {
    var box = document.getElementById('mod-grid');
    if (!box) return;
    var LABEL = { live: 'Live', testing: 'In testing', development: 'In development', planned: 'Planned' };
    var CLS = { live: 'tag-live', testing: 'tag-o', development: 'tag-o', planned: '' };
    getJSON('data/mods.json').then(function (cfg) {
      box.innerHTML = cfg.mods.map(function (m) {
        return '<article class="panel lift pad stack" data-tags="' + esc(m.status) + '">' +
          '<div class="card-top"><span class="hud">' + esc(m.category) + '</span><span class="tag ' + (CLS[m.status] || '') + '">' + esc(LABEL[m.status] || m.status) + '</span></div>' +
          '<h3 class="h3">' + esc(m.name) + '</h3><p class="body">' + esc(m.description) + '</p>' +
          '<div class="tags push" style="padding-top:6px">' + (m.requires || []).map(function (r) { return '<span class="tag" style="font-size:10px">' + esc(r) + '</span>'; }).join('') + '</div>' +
          (m.link ? '<a class="hud-o" href="' + esc(m.link) + '" style="min-height:44px;display:inline-flex;align-items:center">' + esc(m.link_label || 'More') + ' &rarr;</a>' : '') +
          '</article>';
      }).join('');
    }).catch(function () {
      box.innerHTML = '<p class="empty">Mod list unavailable right now.</p>';
    });
  }

  /* ---------- home: live status on the operations board ---------- */
  function fillHomeStatus() {
    var els = document.querySelectorAll('[data-live-for]');
    if (!els.length) return;
    getJSON('data/live/status.json').then(function (live) {
      els.forEach(function (el) {
        var st = live.servers && live.servers[el.getAttribute('data-live-for')];
        if (!st) return;
        el.className = st.online ? 'tag tag-live tag-on' : 'tag tag-off';
        el.textContent = st.online ? st.players + ' online' : 'Offline';
      });
    }).catch(function () {});
  }

  /* ---------- screenshot carousels ([data-carousel]) ----------
     Auto-advances every 5 s, pauses on hover/focus, never auto-plays for reduced-motion users. */
  function wireCarousels() {
    document.querySelectorAll('[data-carousel]').forEach(function (box) {
      var slides = box.querySelectorAll('.shot'), dots = box.querySelectorAll('.dot'), cap = box.querySelector('.shot-cap');
      if (!slides.length) return;
      var i = 0, timer = null, paused = false;
      var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function show(n) {
        i = (n + slides.length) % slides.length;
        slides.forEach(function (s, k) {
          var on = k === i;
          s.classList.toggle('is-on', on);
          if (on) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
          var a = s.querySelector('a'); if (a) a.tabIndex = on ? 0 : -1;
        });
        dots.forEach(function (d, k) { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
        if (cap) cap.textContent = slides[i].getAttribute('data-caption') || '';
      }
      function start() { if (still || timer) return; timer = setInterval(function () { if (!paused) show(i + 1); }, 5000); }
      function restart() { clearInterval(timer); timer = null; start(); }
      box.addEventListener('click', function (e) {
        var b = e.target.closest('.shot-btn'); if (b) { show(i + (+b.getAttribute('data-dir'))); restart(); return; }
        var d = e.target.closest('.dot'); if (d) { show(Array.prototype.indexOf.call(dots, d)); restart(); }
      });
      box.addEventListener('mouseenter', function () { paused = true; });
      box.addEventListener('mouseleave', function () { paused = false; });
      box.addEventListener('focusin', function () { paused = true; });
      box.addEventListener('focusout', function () { paused = false; });
      show(0); start();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireCarousels();
    buildHeader();
    buildFooter();
    wireFilters();
    renderServers();
    renderMods();
    fillHomeStatus();
  });
})();
