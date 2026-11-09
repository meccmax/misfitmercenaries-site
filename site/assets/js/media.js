/* =====================================================================
   Misfit Mercenaries — Media page
   Reads data/media.json (built from the site/media/ folders on every deploy by
   scripts/build-media.py). Falls back to data/albums.json if it isn't built yet.
   media.html            -> album grid with filter buttons
   media.html?album=dayz -> that album's videos and screenshots, with a lightbox
   ===================================================================== */
(function () {
  'use strict';
  var esc = function (s) { return window.MM.esc(s); };
  var GROUPS = [
    { id: 'all', label: 'All', title: 'All albums' },
    { id: 'survival', label: 'Survival', title: 'Survival' },
    { id: 'milsim', label: 'Arma & milsim', title: 'Arma & milsim' },
    { id: 'sw', label: 'Star Wars', title: 'Star Wars' },
    { id: 'mmo', label: 'MMOs', title: 'MMOs' }
  ];
  var data = null, group = 'all';

  function load() {
    return window.MM.getJSON('data/media.json').catch(function () {
      return window.MM.getJSON('data/albums.json').then(function (c) {
        return { albums: c.albums.map(function (a) { return Object.assign({ count: 0, items: [], cover: null }, a); }) };
      });
    });
  }

  /* ---------- album grid ---------- */
  function renderGrid() {
    var chips = document.getElementById('group-chips');
    chips.innerHTML = GROUPS.map(function (g) {
      return '<button type="button" class="chip" data-g="' + g.id + '" aria-pressed="' + (g.id === group) + '">' + esc(g.label) + '</button>';
    }).join('');
    chips.onclick = function (e) { var b = e.target.closest('[data-g]'); if (b) { group = b.getAttribute('data-g'); renderGrid(); } };
    document.getElementById('group-title').textContent = GROUPS.filter(function (g) { return g.id === group; })[0].title;
    // albums with no uploads stay hidden until something is added to their folder
    var list = data.albums.filter(function (a) { return (a.count > 0 || a.active) && (group === 'all' || a.group === group); });
    if (!list.length) { document.getElementById('album-grid').innerHTML = '<p class="empty">No albums here yet.</p>'; return; }
    document.getElementById('album-grid').innerHTML = list.map(function (a) {
      var cover = a.cover ? '<img class="cover" src="' + esc(a.cover) + '" alt="" loading="lazy">' : '<div class="ph cover">' + esc(a.name) + '</div>';
      var count = a.count ? a.count + (a.count === 1 ? ' item' : ' items') : 'No uploads yet';
      return '<a class="panel lift" href="media.html?album=' + encodeURIComponent(a.id) + '">' + cover +
        '<div class="card-body" style="padding:18px 20px"><div class="card-top"><div class="stack" style="gap:4px;min-width:0">' +
        '<span class="h4">' + esc(a.name) + '</span><span class="hud" style="font-size:11px">' + esc(a.era) + ' · ' + count + '</span></div>' +
        '<span class="tag ' + (a.active ? 'tag-o' : '') + '">' + (a.active ? 'Active' : 'Archive') + '</span></div></div></a>';
    }).join('');
  }

  /* ---------- single album ---------- */
  var images = [];
  function renderAlbum(a) {
    document.getElementById('albums-view').hidden = true;
    document.getElementById('album-view').hidden = false;
    document.title = a.name + ' — Media — Misfit Mercenaries';
    document.getElementById('album-title').textContent = a.name;
    document.getElementById('album-era').textContent = '// ' + a.era;
    document.getElementById('album-count').textContent = a.count ? a.count + (a.count === 1 ? ' item' : ' items') : '';
    var box = document.getElementById('album-items');
    if (!a.items.length) {
      box.innerHTML = '<p class="empty" style="grid-column:1/-1">Nothing here yet. Got screenshots or clips from ' + esc(a.name) + '? Share them in the Discord.</p>';
      return;
    }
    images = a.items.filter(function (i) { return i.type === 'image'; });
    box.innerHTML = a.items.map(function (it) {
      if (it.type === 'image') {
        var n = images.indexOf(it);
        return '<button type="button" class="media-tile" data-img="' + n + '" aria-label="Open screenshot ' + (n + 1) + '">' +
          '<img src="' + esc(it.thumb || it.src) + '" alt="' + esc(it.title || a.name + ' screenshot') + '" loading="lazy"></button>';
      }
      if (it.type === 'youtube') {
        return '<div class="media-tile media-video"><button type="button" class="yt" data-yt="' + esc(it.id) + '" aria-label="Play video' + (it.title ? ': ' + esc(it.title) : '') + '">' +
          '<img src="https://i.ytimg.com/vi/' + esc(it.id) + '/hqdefault.jpg" alt="" loading="lazy"><span class="play" aria-hidden="true"></span></button>' +
          (it.title ? '<span class="media-cap">' + esc(it.title) + '</span>' : '') + '</div>';
      }
      if (it.type === 'video') {
        return '<div class="media-tile media-video"><video controls preload="none" playsinline' + (it.poster ? ' poster="' + esc(it.poster) + '"' : '') + ' src="' + esc(it.src) + '"></video>' +
          (it.title ? '<span class="media-cap">' + esc(it.title) + '</span>' : '') + '</div>';
      }
      return '<a class="media-tile media-link" href="' + esc(it.url) + '" target="_blank" rel="noopener"><span class="hud-o">Video link</span><span>' + esc(it.title) + '</span></a>';
    }).join('');
    box.onclick = function (e) {
      var y = e.target.closest('[data-yt]');
      if (y) {
        var id = y.getAttribute('data-yt');
        y.outerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0" title="YouTube video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
        return;
      }
      var t = e.target.closest('[data-img]');
      if (t) openLb(+t.getAttribute('data-img'));
    };
  }

  /* ---------- lightbox ---------- */
  var lb, lbImg, lbCap, cur = 0, lastFocus = null;
  function openLb(n) {
    lastFocus = document.activeElement;
    lb.hidden = false; document.body.style.overflow = 'hidden';
    showLb(n); lb.querySelector('.lb-close').focus();
  }
  function showLb(n) {
    cur = (n + images.length) % images.length;
    var it = images[cur];
    lbImg.src = it.src; lbImg.alt = it.title || 'Screenshot';
    lbCap.textContent = (cur + 1) + ' / ' + images.length;
  }
  function closeLb() { lb.hidden = true; document.body.style.overflow = ''; lbImg.removeAttribute('src'); if (lastFocus) lastFocus.focus(); }

  document.addEventListener('DOMContentLoaded', function () {
    lb = document.getElementById('lightbox'); lbImg = lb.querySelector('img'); lbCap = lb.querySelector('figcaption');
    lb.querySelector('.lb-close').onclick = closeLb;
    lb.querySelector('.lb-prev').onclick = function () { showLb(cur - 1); };
    lb.querySelector('.lb-next').onclick = function () { showLb(cur + 1); };
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') showLb(cur - 1);
      else if (e.key === 'ArrowRight') showLb(cur + 1);
    });

    load().then(function (d) {
      data = d;
      var id = new URLSearchParams(location.search).get('album');
      var a = id && data.albums.filter(function (x) { return x.id === id; })[0];
      if (a) renderAlbum(a); else renderGrid();
    }).catch(function () {
      document.getElementById('album-grid').innerHTML = '<p class="empty">Albums are unavailable right now.</p>';
    });
  });
})();
