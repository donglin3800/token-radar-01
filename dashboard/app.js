/* Token Launch Radar — the page. Reads window.TOKEN_RADAR (written by main.ts from
   the same board as board.json), renders the ranked board, the detail view,
   the live-tokens table and the methodology. No network: no fetch, no
   external URL, every figure comes from the snapshot the program scored. */
(function () {
  'use strict';
  var D = window.TOKEN_RADAR;
  if (!D || !D.rows) { document.body.innerHTML = '<p class="empty">No radar data loaded.</p>'; return; }
  var FLOOR = D.floor_usd;

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function full(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function pctCls(v) { return v == null ? '' : v >= 0 ? 'up' : 'down'; }
  function age(v) { return v == null ? '—' : v + 'd'; }
  function $(id) { return document.getElementById(id); }
  function mult(v) { return '×' + v.toFixed(2); }

  /* ---------- state, from the hash so every view is linkable ---------- */
  function hashToState() {
    var h = {};
    var parts = location.hash.slice(1).split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0]) h[kv[0]] = decodeURIComponent(kv[1] || '');
    }
    return {
      protocol: h.protocol || '',
      chain: h.chain || '',
      cat: h.cat || '',
      watch: h.watch === '1',
      early: h.early === '1',
      sort: h.sort || 'value',
      q: h.q || ''
    };
  }
  function stateToHash() {
    var bits = [];
    if (state.protocol) bits.push('protocol=' + encodeURIComponent(state.protocol));
    if (state.chain) bits.push('chain=' + encodeURIComponent(state.chain));
    if (state.cat) bits.push('cat=' + encodeURIComponent(state.cat));
    if (state.watch) bits.push('watch=1');
    if (state.early) bits.push('early=1');
    if (state.sort !== 'value') bits.push('sort=' + state.sort);
    if (state.q) bits.push('q=' + encodeURIComponent(state.q));
    var next = bits.length ? '#' + bits.join('&') : '';
    if (location.hash !== next) history.replaceState(null, '', next || location.pathname + location.search);
  }
  var state = hashToState();
  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var calibByCat = {};
  D.calibration.forEach(function (c) { calibByCat[c.category] = c; });

  /* ---------- filtering and sorting ---------- */
  function visibleRows() {
    var needle = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.early && r.tvl_usd >= FLOOR) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (needle && (r.name.toLowerCase().indexOf(needle) < 0 && r.slug.indexOf(needle) < 0)) return false;
      return true;
    });
    var s = state.sort;
    rows.sort(function (a, b) {
      if (s === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (s === 'growth') return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d);
      if (s === 'age') return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days);
      if (s === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      return a.rank - b.rank;
    });
    return rows;
  }

  /* ---------- header, hero ---------- */
  function renderMeta() {
    $('meta').innerHTML = 'Snapshot <b>' + esc(D.as_of) + '</b> · ' + D.board_size + ' pre-token protocols ranked<br>' +
      'Watchlist <b>' + D.watchlist_size + '</b> · beyond the watchlist <b>' + D.early_size + '</b> · model <b>' + esc(D.model_version) + '</b>';
    $('foot').textContent = 'Source: ' + D.source + '. Implied values are this radar\u2019s own claim from the snapshot\u2019s figures, never a promise of a launch. ' +
      'A protocol records no token; the snapshot cannot prove it has none.';
  }
  function renderHero() {
    var top = D.rows[0];
    if (!top) return;
    $('hero').innerHTML =
      '<div><div class="k">Farm this first</div><h2>#' + top.rank + ' ' + esc(top.name) + '</h2>' +
      '<p>' + esc(top.why_now) + '</p>' +
      '<p><strong>First step:</strong> ' + esc(top.farm_steps[0]) + '</p>' +
      '<div class="cta"><button id="heroGo">Open the full farm plan</button></div></div>' +
      '<div class="val">' + full(top.implied_value_usd) + '<small>implied value · ' + money(top.tvl_usd) + ' TVL · ' + pct(top.change_7d) + ' in 7 days</small></div>';
    $('heroGo').addEventListener('click', function () { select(top.slug, true); });
  }

  /* ---------- board ---------- */
  function renderBoard() {
    var rows = visibleRows();
    var html = '';
    if (!rows.length) {
      html = '<tr><td colspan="9" class="empty">No protocols match these filters. Clear a filter to see the board again.</td></tr>';
    }
    rows.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.protocol ? ' style="background:#16263d"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + (r.watchlist ? ' <span class="tag">watchlist</span>' : '') + '<br><span style="color:var(--mut);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + r.chains.slice(0, 2).map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('') + (r.chains.length > 2 ? ' <span class="tag">+' + (r.chains.length - 2) + '</span>' : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><strong>' + full(r.implied_value_usd) + '</strong></td>' +
        '<td><span class="badge b-' + r.confidence + '">' + r.confidence + '</span></td></tr>';
    });
    $('rows').innerHTML = html;
    $('count').textContent = 'Showing ' + rows.length + ' of ' + D.board_size + ' ranked protocols' +
      (state.watch ? ' · watchlist only' : '') + (state.early ? ' · below the $50M floor' : '') +
      (state.chain ? ' · ' + state.chain : '') + (state.cat ? ' · ' + state.cat : '') + '.';
    var trs = $('rows').querySelectorAll('tr[data-slug]');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { select(this.getAttribute('data-slug'), true); });
    }
  }

  /* ---------- detail view ---------- */
  function stepHtml(step) {
    var cut = step.indexOf(' (Cost:');
    if (cut < 0) return esc(step);
    return esc(step.slice(0, cut)) + ' <b>' + esc(step.slice(cut + 1)) + '</b>';
  }
  function renderDetail() {
    var r = bySlug[state.protocol] || D.rows[0];
    if (!r) { $('detail').innerHTML = ''; return; }
    var m = r.model;
    var base = r.tvl_usd * m.category_multiple;
    var cal = calibByCat[r.category || 'Uncategorized'];
    var peerCount = cal ? cal.peers : 0;
    var minPeers = (D.tuning && D.tuning.min_peers) || 3;
    var peerSource = peerCount >= minPeers
      ? 'median mcap/TVL of ' + peerCount + ' token-bearing peers in ' + esc(r.category || 'this category')
      : 'snapshot-wide median mcap/TVL — only ' + peerCount + ' token-bearing peer' + (peerCount === 1 ? '' : 's') + ' in ' + esc(r.category || 'this category') + ', too few for a category median';
    var peers = cal && cal.examples.length
      ? cal.examples.map(function (p) { return esc(p.name) + ' (' + full(p.mcap_usd) + ' mcap on ' + money(p.tvl_usd) + ' TVL, ×' + p.multiple.toFixed(2) + ')'; }).join('; ')
      : 'No token-bearing peer in this category — the snapshot-wide median applies.';
    var verdict = r.confidence === 'high'
      ? 'Farm it now: size, momentum, age and reach all point the same way. Start with the first step below and keep the position for the full hold.'
      : r.confidence === 'medium'
        ? 'Worth a small position: the numbers are good but one signal is weak. Farm it, but keep the capital at the plan\u2019s size and watch the risks.'
        : 'Farm it only with spare capital: the snapshot shows a real protocol, but the launch case is thin. Do the cheap steps first and reassess in a month.';
    var steps = r.farm_steps.map(function (s) { return '<li>' + stepHtml(s) + '</li>'; }).join('');
    var risks = r.risks.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detail').innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="hint">' + esc(r.category || 'Uncategorized') + ' · ' + r.chains.map(esc).join(', ') + '</span></h2>' +
      '<p>' + esc(r.why_now) + '</p>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + full(r.implied_value_usd) + '</b></div>' +
      '<div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b class="' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</b></div>' +
      '<div><span>Days with no token</span><b>' + age(r.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + r.chains.length + '</b></div>' +
      '<div><span>Confidence</span><b>' + r.confidence + '</b></div></div>' +
      '<h3>How the implied value is built</h3>' +
      '<p class="note">Base ' + full(base) + ' = ' + money(r.tvl_usd) + ' TVL × ' + m.category_multiple.toFixed(3) +
      ' (' + peerSource + '), then ' +
      'growth ' + mult(m.growth_multiplier) + ', age ' + mult(m.age_multiplier) + ', chains ' + mult(m.chain_multiplier) +
      ', watchlist ' + mult(m.watchlist_multiplier) + ', launch likelihood ' + mult(m.launch_multiplier) + '.</p>' +
      '<p class="note">Comparable launches in this category: ' + peers + '</p>' +
      '<h3>Farm plan — 7 steps</h3><ol class="steps">' + steps + '</ol>' +
      '<h3>Risks the snapshot shows</h3><ul class="risks">' + risks + '</ul>' +
      '<p><strong>Verdict:</strong> ' + verdict + '</p>';
  }
  function select(slug, scroll) {
    state.protocol = slug;
    renderBoard();
    renderDetail();
    stateToHash();
    if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- live tokens, method, calibration ---------- */
  function renderLive() {
    $('live').innerHTML = D.live.map(function (p) {
      return '<tr><td><strong>' + esc(p.name) + '</strong><br><span style="color:var(--mut);font-size:12px">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + full(p.mcap_usd || 0) + '</strong></td>' +
        '<td class="num ' + pctCls(p.change_7d) + '">' + pct(p.change_7d) + '</td></tr>';
    }).join('');
  }
  function renderMethod() {
    var t = D.tuning;
    $('method').innerHTML =
      '<p class="note">Implied value = TVL × category peer multiple × growth × age × chains × watchlist × launch likelihood. ' +
      'The peer multiple is the median market-cap/TVL of the token-bearing protocols in the same category (snapshot-wide median ' +
      D.overall_multiple.toFixed(3) + ' when a category has fewer than ' + t.min_peers + ' peers), clamped to ' + t.multiple_low + '–' + t.multiple_high + '. ' +
      'Growth is the 7-day TVL change clamped to ' + t.growth_low + '%…+' + t.growth_high + '% and weighted ' + t.growth_weight + '. ' +
      'The age factor rises 0.70 → 1.00 over the first ' + t.age_peak_days + ' days tracked with no token, then eases back toward ' + t.age_old + '. ' +
      'Each extra chain adds ' + (t.chain_step * 100).toFixed(0) + '% (capped at ' + t.chain_cap + ' extra chains); the watchlist multiplies by ' + t.watchlist_boost + '. ' +
      'Launch likelihood is 0.90 + 0.20 × the share of the category that already records a token. ' +
      'Wrapped, staked and bridged products are excluded, and no protocol name is ever special-cased — the same scoring path ranks every row. ' +
      '† in the table below marks a multiple that is the snapshot-wide median, used because the category has fewer than ' + t.min_peers + ' token-bearing peers.</p>';
    $('calib').innerHTML = D.calibration.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td><td class="num">×' + c.multiple.toFixed(3) + (c.peers < t.min_peers ? ' †' : '') + '</td>' +
        '<td class="num">' + (c.token_share * 100).toFixed(0) + '%</td>' +
        '<td>' + (c.examples.length ? c.examples.map(function (p) { return esc(p.name) + ' ×' + p.multiple.toFixed(2); }).join(', ') : '—') + '</td></tr>';
    }).join('');
  }

  /* ---------- filter controls ---------- */
  function fillOptions() {
    var chains = {}, cats = {};
    D.rows.forEach(function (r) {
      r.chains.forEach(function (c) { chains[c] = true; });
      if (r.category) cats[r.category] = true;
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; $('chain').appendChild(o);
    });
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; $('cat').appendChild(o);
    });
    $('chain').value = state.chain;
    $('cat').value = state.cat;
    $('watch').checked = state.watch;
    $('early').checked = state.early;
    $('sort').value = state.sort;
    $('q').value = state.q;
  }
  function wire() {
    $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); stateToHash(); });
    $('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); stateToHash(); });
    $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); stateToHash(); });
    $('sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); stateToHash(); });
    $('watch').addEventListener('change', function () { state.watch = this.checked; renderBoard(); stateToHash(); });
    $('early').addEventListener('change', function () { state.early = this.checked; renderBoard(); stateToHash(); });
    window.addEventListener('hashchange', function () {
      state = hashToState();
      $('chain').value = state.chain; $('cat').value = state.cat;
      $('watch').checked = state.watch; $('early').checked = state.early;
      $('sort').value = state.sort; $('q').value = state.q;
      renderBoard(); renderDetail();
    });
  }

  renderMeta();
  renderHero();
  fillOptions();
  wire();
  renderBoard();
  renderDetail();
  renderLive();
  renderMethod();
  if (state.protocol && bySlug[state.protocol]) {
    var el = $('detail');
    if (el && el.scrollIntoView) el.scrollIntoView();
  }
})();
