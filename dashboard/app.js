/* Token Launch Radar — the page. Reads window.TOKEN_RADAR (written by main.ts
   from the same board as board.json), renders the ranked board, the detail
   view, the live-tokens table and the methodology. No network: no fetch, no
   external URL, every figure comes from the snapshot the program scored.
   The page also recomputes every row in the browser from the fitted
   coefficients in the data and says whether it agrees with the board. */
(function () {
  'use strict';
  var D = window.TOKEN_RADAR;
  if (!D || !D.rows) { document.body.innerHTML = '<p class="empty">No radar data loaded.</p>'; return; }
  var FLOOR = D.floor_usd;
  var E = D.economics;
  var MP = D.model_params;

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
  function r2(n) { return Math.round(n * 100) / 100; }
  function sig(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }
  function f3(n) { return Number(n).toFixed(3); }
  function f2(n) { return Number(n).toFixed(2); }
  function sharePct(x) { return String(Math.round(x * 100)); }

  /* ---------- the recompute: the same formulas as lib/model.ts ---------- */
  function condOdds(r) {
    var ageDays = r.age_days == null ? MP.odds_median_age : r.age_days;
    var share = MP.odds_category_share[r.category || 'Uncategorized'];
    if (share == null) share = 0.5;
    var growth = Math.max(-0.5, Math.min(1, (r.change_7d == null ? 0 : r.change_7d) / 100));
    function f(a) {
      var feats = { age: Math.log(a + 1), share: share, size: Math.log(r.tvl_usd), growth: growth };
      var z = MP.odds_weights[0];
      MP.odds_terms.forEach(function (k, j) { z += MP.odds_weights[j + 1] * ((feats[k] - MP.odds_means[k]) / MP.odds_sds[k]); });
      return sig(z);
    }
    var fNow = f(ageDays), fLater = f(ageDays + MP.odds_horizon_days);
    return Math.min(0.99, Math.max(0.01, (fLater - fNow) / (1 - fNow)));
  }
  function recompute(r) {
    var growthF = Math.max(-0.5, Math.min(1, (r.change_7d == null ? 0 : r.change_7d) / 100));
    var logMult = MP.value_intercept + MP.value_size_slope * (Math.log(r.tvl_usd) - MP.value_mean_log_tvl)
      + (MP.value_cat ? (MP.value_cat[r.category || 'Uncategorized'] || 0) : 0)
      + MP.value_growth_coef * growthF
      + (MP.value_age_coef && r.age_days != null ? MP.value_age_coef * (Math.log(r.age_days + 1) - MP.value_mean_log_age) : 0)
      + MP.value_chains_coef * (Math.log(r.chains.length) - MP.value_mean_log_chains);
    var mult = Math.min(MP.multiple_high, Math.max(MP.multiple_low, Math.exp(logMult)));
    var launch = r.tvl_usd * mult;
    var odds = condOdds(r);
    var implied = Math.round(launch * odds);
    var gas = 0, mins = 0;
    r.plan.steps.forEach(function (s) { gas += s.gasUsd; mins += s.minutes; });
    gas = r2(gas);
    var hours = r2(mins / 60);
    var drop = r2((E.plan_usd * implied / r.tvl_usd) * E.drop_share);
    var net = r2(drop - gas);
    var nph = r2(net / hours);
    var verdict = (net >= E.farm_net_min && nph >= E.hour_rate) ? 'FARM' : (net >= 0 ? 'MARGINAL' : 'SKIP');
    return {
      multiple: mult, launch: Math.round(launch), odds: odds, implied: implied,
      lo: Math.round(launch * Math.exp(MP.residual_q25) * odds),
      hi: Math.round(launch * Math.exp(MP.residual_q75) * odds),
      lo90: Math.round(launch * Math.exp(MP.residual_q10) * odds),
      hi90: Math.round(launch * Math.exp(MP.residual_q90) * odds),
      gas: gas, hours: hours, drop: drop, net: net, nph: nph, verdict: verdict
    };
  }
  function fnv1a(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  /* The farm economics at the plan size and farmer share the reader picks. */
  function economicsFor(r, planUsd, share) {
    var drop = r2((planUsd * r.implied_value_usd / r.tvl_usd) * share);
    var net = r2(drop - r.plan.gas_usd);
    var nph = r2(net / r.plan.hours);
    var verdict = (net >= E.farm_net_min && nph >= E.hour_rate) ? 'FARM' : (net >= 0 ? 'MARGINAL' : 'SKIP');
    return { drop: drop, net: net, nph: nph, verdict: verdict };
  }

  /* ---------- state, from the hash so every view is linkable ---------- */
  function hashToState() {
    var h = {};
    location.hash.slice(1).split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) h[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    return {
      protocol: h.protocol || '',
      tab: h.tab || 'all',
      plan: h.plan ? parseInt(h.plan, 10) : E.plan_usd,
      share: h.share ? parseFloat(h.share) : E.drop_share,
      chain: h.chain || '', cat: h.cat || '',
      sort: h.sort || 'value', q: h.q || ''
    };
  }
  function stateToHash() {
    var bits = [];
    if (state.protocol) bits.push('protocol=' + encodeURIComponent(state.protocol));
    if (state.tab !== 'all') bits.push('tab=' + state.tab);
    if (state.plan !== E.plan_usd) bits.push('plan=' + state.plan);
    if (state.share !== E.drop_share) bits.push('share=' + state.share);
    if (state.chain) bits.push('chain=' + encodeURIComponent(state.chain));
    if (state.cat) bits.push('cat=' + encodeURIComponent(state.cat));
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

  /* ---------- the checklist: recompute the whole board in the browser ---------- */
  var recomputed = D.rows.map(function (r) { return { row: r, calc: recompute(r) }; });
  var agree = 0;
  recomputed.forEach(function (x) {
    var c = x.calc, r = x.row;
    if (Math.abs(c.implied - r.implied_value_usd) <= 1 && Math.abs(c.odds - r.token_odds) <= 0.001
      && Math.abs(c.lo - r.range_lo_usd) <= 1 && Math.abs(c.hi - r.range_hi_usd) <= 1
      && Math.abs(c.lo90 - r.range_lo90_usd) <= 1 && Math.abs(c.hi90 - r.range_hi90_usd) <= 1
      && Math.abs(c.drop - r.drop_usd) <= 0.02 && Math.abs(c.net - r.net_usd) <= 0.02
      && Math.abs(c.nph - r.net_per_hour_usd) <= 0.02 && c.verdict === r.verdict) agree += 1;
  });
  var ranksOk = D.rows.every(function (r, i) { return r.rank === i + 1; });
  var orderOk = D.rows.every(function (r, i) { return i === 0 || D.rows[i - 1].implied_value_usd >= r.implied_value_usd; });
  var totalOk = D.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0) === D.board_total_usd;
  var checksumOk = fnv1a(D.rows.map(function (r) { return r.slug + ':' + r.implied_value_usd; }).join('\n') + '\n') === D.checksum;
  var watchOk = D.rows.filter(function (r) { return r.watchlist; }).length === D.watchlist_size && D.watchlist_size === 40;
  var ledgerOk = D.accounting.reduce(function (s, g) { return s + g.count; }, 0) === 758;

  /* ---------- header, KPIs, ledger, checks ---------- */
  function renderMeta() {
    $('meta').innerHTML = 'Snapshot <b>' + esc(D.as_of) + '</b> · ' + D.board_size + ' pre-token protocols ranked<br>' +
      'Watchlist <b>' + D.watchlist_size + '</b> · not on the watchlist <b>' + (D.board_size - D.watchlist_size) + '</b> · below the $50M floor <b>' + D.early_size + '</b> · model <b>' + esc(D.model_version) + '</b>';
    $('foot').textContent = 'Source: ' + D.source + '. Implied values are this radar\u2019s own claim from the snapshot\u2019s figures, never a promise of a launch. ' +
      'A protocol records no token; the snapshot cannot prove it has none.';
  }
  function renderKpis() {
    var v = D.value_validation, o = D.odds_validation;
    var farmN = D.rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
    var keptN = v.kept_terms.length + o.kept_terms.length;
    $('kpis').innerHTML =
      '<div class="kpi"><div class="n">×' + v.wf_miss + ' <small>vs flat ×' + v.flat_wf + '</small></div><div class="l">Walk-forward miss</div><div class="d">Median factor by which the fitted value is off, on protocols listed later than the fit. Leave-one-out ×' + v.loo_miss + ' (flat ×' + v.flat_loo + ').</div></div>' +
      '<div class="kpi"><div class="n">' + Math.round(v.range_p25_75_loo * 100) + '% <small>of caps in P25–P75</small></div><div class="l">Range honesty, held out</div><div class="d">P10–P90 holds ' + Math.round(v.range_p10_90_loo * 100) + '% (stated 80%). Walk-forward: ' + Math.round(v.range_p25_75_wf * 100) + '% / ' + Math.round(v.range_p10_90_wf * 100) + '%.</div></div>' +
      '<div class="kpi"><div class="n">' + o.brier_wf + ' <small>vs base ' + o.base_brier_wf + '</small></div><div class="l">Token-odds Brier, walk-forward</div><div class="d">10-fold ' + o.brier_cv + ' vs base ' + o.base_brier_cv + '. Base rate ' + (o.base_rate * 100).toFixed(1) + '% of dated protocols record a token.</div></div>' +
      '<div class="kpi"><div class="n">' + keptN + ' <small>terms survived</small></div><div class="l">Terms kept on both tests</div><div class="d">' + v.kept_terms.length + ' value terms, ' + o.kept_terms.length + ' odds terms. The rest were tried and dropped — see the tables below.</div></div>' +
      '<div class="kpi"><div class="n">' + farmN + ' <small>of ' + D.board_size + '</small></div><div class="l">Worth farming</div><div class="d">Net clears $' + E.farm_net_min + ' and $' + E.hour_rate + '/hour on the $' + E.plan_usd.toLocaleString('en-US') + ' plan at a ' + sharePct(E.drop_share) + '% farmer share.</div></div>' +
      '<div class="kpi"><div class="n">' + D.watchlist_size + '/40</div><div class="l">Watchlist covered</div><div class="d">Every watchlist protocol is on the board. Board total ' + money(D.board_total_usd) + ' implied value.</div></div>';
  }
  function renderLedger() {
    $('ledger').innerHTML = D.accounting.map(function (g) {
      return '<span class="led"><b>' + g.count + '</b>' + esc(g.label) + '</span>';
    }).join('') + '<span class="led"><b>758</b>protocols in the snapshot</span>';
    function check(ok, label) { return '<span class="check ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ ' : '✗ ') + esc(label) + '</span>'; }
    $('checks').innerHTML =
      check(agree === D.rows.length, agree + '/' + D.rows.length + ' rows recomputed in this browser agree with board.json') +
      check(ranksOk, 'ranks run 1..' + D.rows.length + ' in order') +
      check(orderOk, 'values non-increasing down the board') +
      check(totalOk, 'board total ' + full(D.board_total_usd) + ' matches') +
      check(checksumOk, 'checksum ' + D.checksum + ' matches main.ts') +
      check(watchOk, 'watchlist 40/40') +
      check(ledgerOk, 'ledger sums to 758/758');
  }
  function renderEvidence() {
    var v = D.value_validation, o = D.odds_validation;
    $('valStages').innerHTML = v.stages.map(function (s) {
      var tag = s.control ? '<span class="drop">must not help</span>' : (s.kept ? '<span class="kept">kept</span>' : '<span class="drop">dropped</span>');
      return '<tr><td>' + esc(s.term) + '</td><td class="num">×' + s.loo + '</td><td class="num">×' + s.wf + '</td><td>' + tag + '</td></tr>';
    }).join('');
    $('oddStages').innerHTML = o.stages.map(function (s) {
      var tag = s.kept ? '<span class="kept">kept</span>' : '<span class="drop">dropped</span>';
      return '<tr><td>' + esc(s.term) + '</td><td class="num">' + s.cv + '</td><td class="num">' + s.wf + '</td><td>' + tag + '</td></tr>';
    }).join('');
    $('rangeCal').innerHTML =
      '<tr><td>P25–P75</td><td class="num">' + Math.round(v.range_p25_75_loo * 100) + '%</td><td class="num">' + Math.round(v.range_p25_75_wf * 100) + '%</td><td class="num">50%</td></tr>' +
      '<tr><td>P10–P90</td><td class="num">' + Math.round(v.range_p10_90_loo * 100) + '%</td><td class="num">' + Math.round(v.range_p10_90_wf * 100) + '%</td><td class="num">80%</td></tr>';
    $('pricing').innerHTML =
      '<div class="formula"><b>How a row is priced.</b> Implied value = TVL × fitted multiple × token odds. ' +
      'Fitted multiple = exp(' + f3(MP.value_intercept) + ' + ' + f3(MP.value_size_slope) + ' × (log TVL − ' + f3(MP.value_mean_log_tvl) + ')' +
      (MP.value_cat ? ' + category effect (shrunk, per category)' : '') +
      (MP.value_growth_coef ? ' + ' + f3(MP.value_growth_coef) + ' × (7-day change / 100)' : '') +
      (MP.value_age_coef ? ' + ' + f3(MP.value_age_coef) + ' × (log age − ' + f3(MP.value_mean_log_age) + ')' : '') +
      (MP.value_chains_coef ? ' + ' + f3(MP.value_chains_coef) + ' × (log chains − ' + f3(MP.value_mean_log_chains) + ')' : '') +
      '), clamped to ' + MP.multiple_low + '–' + MP.multiple_high + '. ' +
      'Token odds = the chance of a token within 24 months given no token yet, from a logistic model on ' +
      MP.odds_terms.join(' and ') + ' (weights ' + MP.odds_weights.map(f3).join(', ') + '). ' +
      'Ranges come from the leave-one-out residuals: P25–P75 uses log offsets ' + f2(MP.residual_q25) + ' / +' + f2(MP.residual_q75) +
      ', P10–P90 uses ' + f2(MP.residual_q10) + ' / +' + f2(MP.residual_q90) + '. ' +
      'Farm: a $' + E.plan_usd.toLocaleString('en-US') + ' plan, expected drop = plan × (implied value ÷ TVL) × ' + sharePct(E.drop_share) + '% farmer share, ' +
      'gas $' + (E.gas_by_chain.Ethereum || E.gas_default) + ' a transaction on Ethereum, $' + (E.gas_by_chain.Bitcoin || E.gas_default) + ' on Bitcoin, $' + (E.gas_by_chain.Solana || E.gas_default) + ' on Solana, $' + E.gas_default + ' elsewhere, ' +
      'time at $' + E.hour_rate + '/hour. FARM when net clears $' + E.farm_net_min + ' and $' + E.hour_rate + '/hour; MARGINAL when net clears $0; else SKIP. ' +
      'Hold: under 180 days 90, under 365 days 60, under 730 days 45, older 30, no date 45. The gas prices are an assumption, not a snapshot figure — the snapshot has no gas data.</div>';
  }

  /* ---------- hero ---------- */
  function renderHero() {
    var top = D.rows[0];
    if (!top) return;
    var ec = economicsFor(top, state.plan, state.share);
    $('hero').innerHTML =
      '<div><div class="k">Farm this first</div><h2>#' + top.rank + ' ' + esc(top.name) + '</h2>' +
      '<p>' + esc(top.why_now) + '</p>' +
      '<p><strong>First step:</strong> ' + esc(top.farm_steps[0]) + '</p>' +
      '<p>Token odds <strong>' + (top.token_odds * 100).toFixed(0) + '%</strong> · verdict <strong>' + ec.verdict + '</strong> · net <strong>' + full(ec.net) + '</strong> · <strong>$' + ec.nph.toFixed(2) + '/hour</strong> on the $' + state.plan.toLocaleString('en-US') + ' plan.</p>' +
      '<div class="cta"><button id="heroGo">Open the full farm plan</button></div></div>' +
      '<div class="val">' + full(top.implied_value_usd) + '<small>implied value · ' + money(top.tvl_usd) + ' TVL · ' + pct(top.change_7d) + ' in 7 days · P25–P75 ' + money(top.range_lo_usd) + '–' + money(top.range_hi_usd) + '</small></div>';
    $('heroGo').addEventListener('click', function () { select(top.slug, true); });
  }

  /* ---------- filtering, tabs, sorting ---------- */
  function tabCounts() {
    var c = { all: D.rows.length, farm: 0, marginal: 0, skip: 0, watchlist: 0, early: 0, offlist: 0 };
    D.rows.forEach(function (r) {
      var ec = economicsFor(r, state.plan, state.share);
      if (ec.verdict === 'FARM') c.farm += 1;
      else if (ec.verdict === 'MARGINAL') c.marginal += 1;
      else c.skip += 1;
      if (r.watchlist) c.watchlist += 1; else c.offlist += 1;
      if (r.age_days != null && r.age_days < 180) c.early += 1;
    });
    return c;
  }
  function renderTabs() {
    var c = tabCounts();
    var tabs = [['all', 'All'], ['farm', 'Farm'], ['marginal', 'Marginal'], ['skip', 'Skip'], ['watchlist', 'Watchlist'], ['early', 'Early'], ['offlist', 'Off-list']];
    $('tabs').innerHTML = tabs.map(function (t) {
      return '<span class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '" role="tab">' + t[1] + ' <b>' + c[t[0]] + '</b></span>';
    }).join('');
    var els = $('tabs').querySelectorAll('.tab');
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener('click', function () { state.tab = this.getAttribute('data-tab'); renderTabs(); renderBoard(); stateToHash(); });
    }
  }
  function visibleRows() {
    var needle = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.tab === 'farm' || state.tab === 'marginal' || state.tab === 'skip') {
        if (economicsFor(r, state.plan, state.share).verdict.toLowerCase() !== state.tab) return false;
      }
      if (state.tab === 'watchlist' && !r.watchlist) return false;
      if (state.tab === 'early' && !(r.age_days != null && r.age_days < 180)) return false;
      if (state.tab === 'offlist' && r.watchlist) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (needle && (r.name.toLowerCase().indexOf(needle) < 0 && r.slug.indexOf(needle) < 0)) return false;
      return true;
    });
    var s = state.sort;
    rows.sort(function (a, b) {
      if (s === 'odds') return b.token_odds - a.token_odds;
      if (s === 'nph') return economicsFor(b, state.plan, state.share).nph - economicsFor(a, state.plan, state.share).nph;
      if (s === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (s === 'growth') return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d);
      if (s === 'age') return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days);
      if (s === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      return a.rank - b.rank;
    });
    return rows;
  }
  function rangeBar(r) {
    function pos(x) { return ((Math.log(x) - Math.log(r.range_lo90_usd)) / (Math.log(r.range_hi90_usd) - Math.log(r.range_lo90_usd))) * 100; }
    var lo = pos(r.range_lo_usd), hi = pos(r.range_hi_usd), mk = pos(r.implied_value_usd);
    return '<div class="rangebar"><div class="p1090" style="left:0%;right:0%"></div>' +
      '<div class="p2575" style="left:' + lo.toFixed(1) + '%;width:' + (hi - lo).toFixed(1) + '%"></div>' +
      '<div class="mk" style="left:' + mk.toFixed(1) + '%"></div></div>';
  }

  /* ---------- board ---------- */
  function renderBoard() {
    var rows = visibleRows();
    var html = '';
    if (!rows.length) {
      html = '<tr><td colspan="10" class="empty">No protocols match these filters. Clear a filter to see the board again.</td></tr>';
    }
    rows.forEach(function (r) {
      var ec = economicsFor(r, state.plan, state.share);
      html += '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.protocol ? ' style="background:#16263d"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + (r.watchlist ? ' <span class="tag">watchlist</span>' : '') + '<br><span style="color:var(--mut);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td><span class="odds"><span class="bar"><i style="width:' + (r.token_odds * 100).toFixed(1) + '%"></i></span><b>' + (r.token_odds * 100).toFixed(0) + '%</b></span></td>' +
        '<td class="num">' + money(r.launch_value_usd) + '</td>' +
        '<td class="num"><strong>' + full(r.implied_value_usd) + '</strong><br><span style="color:var(--mut);font-size:11px">' + money(r.range_lo_usd) + '–' + money(r.range_hi_usd) + '</span>' + rangeBar(r) + '</td>' +
        '<td><span class="badge b-' + ec.verdict + '">' + ec.verdict + '</span><br><span style="color:var(--mut);font-size:11px">net ' + full(ec.net) + '</span></td>' +
        '<td class="num"><strong>' + (ec.nph >= 0 ? '$' : '−$') + Math.abs(ec.nph).toFixed(2) + '</strong></td></tr>';
    });
    $('rows').innerHTML = html;
    $('count').textContent = 'Showing ' + rows.length + ' of ' + D.board_size + ' ranked protocols' +
      (state.tab !== 'all' ? ' · ' + state.tab : '') + (state.chain ? ' · ' + state.chain : '') + (state.cat ? ' · ' + state.cat : '') +
      ' · plan $' + state.plan.toLocaleString('en-US') + ', farmer share ' + sharePct(state.share) + '%.';
    var trs = $('rows').querySelectorAll('tr[data-slug]');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { select(this.getAttribute('data-slug'), true); });
    }
  }

  /* ---------- detail view ---------- */
  var PHASES = ['Set up', 'Deposit', 'Second deposit', 'Repeat', 'Hold', 'Claim', 'Unwind'];
  function stepHtml(step) {
    var cut = step.indexOf(' (Cost:');
    if (cut < 0) return esc(step);
    return esc(step.slice(0, cut)) + ' <b>' + esc(step.slice(cut + 1)) + '</b>';
  }
  function renderDetail() {
    var r = bySlug[state.protocol] || D.rows[0];
    if (!r) { $('detail').innerHTML = ''; return; }
    var m = r.model;
    var ec = economicsFor(r, state.plan, state.share);
    var cal = calibByCat[r.category || 'Uncategorized'];
    var peerCount = cal ? cal.peers : 0;
    var peers = cal && cal.examples.length
      ? cal.examples.map(function (p) { return esc(p.name) + ' (' + full(p.mcap_usd) + ' mcap on ' + money(p.tvl_usd) + ' TVL, ×' + p.multiple.toFixed(2) + ')'; }).join('; ')
      : 'No token-bearing peer in this category — the snapshot-wide median applies.';
    var verdictText = ec.verdict === 'FARM'
      ? 'Farm it now: on the $' + state.plan.toLocaleString('en-US') + ' plan the expected drop covers the gas and clears $' + E.farm_net_min + ' net at $' + E.hour_rate + '/hour. Start with the first step below and keep the position for the full hold.'
      : ec.verdict === 'MARGINAL'
        ? 'Worth a small position: the expected drop covers the gas, but the net is thin. Farm it at the plan\u2019s size and watch the risks.'
        : 'Skip it at this plan size: the expected drop does not cover the gas. Do the cheap steps first, or pick a bigger plan and re-check the verdict.';
    var steps = r.plan.steps.map(function (s, i) {
      return '<tr><td class="when">' + (PHASES[i] || 'Step') + '</td><td>' + esc(s.text) + '</td><td class="num">' + esc(s.cost) + '</td><td class="num">' + esc(s.time) + '</td></tr>';
    }).join('');
    var risks = r.risks.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var netCls = ec.net >= E.farm_net_min ? 'good' : (ec.net >= 0 ? 'warn' : 'bad');
    $('detail').innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="hint">' + esc(r.category || 'Uncategorized') + ' · ' + r.chains.map(esc).join(', ') + '</span></h2>' +
      '<p>' + esc(r.why_now) + '</p>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + full(r.implied_value_usd) + '</b></div>' +
      '<div><span>If it launches</span><b>' + full(r.launch_value_usd) + '</b></div>' +
      '<div><span>Token odds (24 mo)</span><b>' + (r.token_odds * 100).toFixed(1) + '%</b></div>' +
      '<div><span>P25–P75 range</span><b>' + money(r.range_lo_usd) + '–' + money(r.range_hi_usd) + '</b></div>' +
      '<div><span>P10–P90 range</span><b>' + money(r.range_lo90_usd) + '–' + money(r.range_hi90_usd) + '</b></div>' +
      '<div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b class="' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</b></div>' +
      '<div><span>Days with no token</span><b>' + age(r.age_days) + '</b></div></div>' +
      '<h3>How this row is priced</h3>' +
      '<p class="note">Fitted multiple ×' + m.multiple.toFixed(3) + ' = exp(' + f3(MP.value_intercept) + ' + ' + f3(MP.value_size_slope) + ' × (log TVL − ' + f3(MP.value_mean_log_tvl) + ')' +
      (MP.value_cat ? ' + category effect' : '') +
      (MP.value_growth_coef ? ' + ' + f3(MP.value_growth_coef) + ' × (7-day change / 100)' : '') +
      (MP.value_age_coef ? ' + ' + f3(MP.value_age_coef) + ' × (log age − ' + f3(MP.value_mean_log_age) + ')' : '') +
      (MP.value_chains_coef ? ' + ' + f3(MP.value_chains_coef) + ' × (log chains − ' + f3(MP.value_mean_log_chains) + ')' : '') +
      '), so the size curve contributes ' + m.size_log_mult.toFixed(2) + ' in log units' +
      (MP.value_growth_coef ? ' and the 7-day growth contributes ' + m.growth_log_mult.toFixed(2) : '') +
      (MP.value_chains_coef ? ' and the chain count contributes ' + m.chains_log_mult.toFixed(2) : '') + '. ' +
      'Token odds ' + (r.token_odds * 100).toFixed(1) + '% come from the logistic model on ' + MP.odds_terms.join(' and ') + ': ' +
      (r.age_days == null ? 'no listing date is recorded, so the odds use the board median age of ' + MP.odds_median_age + ' days' : 'the protocol has been listed ' + r.age_days + ' days with no token') +
      ', and ' + (r.category || 'Uncategorized') + ' records a token in ' + Math.round((MP.odds_category_share[r.category || 'Uncategorized'] || 0) * 100) + '% of its protocols. ' +
      'Comparable launches in this category: ' + peers + '</p>' +
      '<h3>Farm plan — 7 steps, ' + r.plan.hold_days + '-day hold</h3>' +
      '<div class="tablewrap"><table class="plantable"><thead><tr><th>When</th><th>Step</th><th>Cost</th><th>Time</th></tr></thead><tbody>' + steps + '</tbody></table></div>' +
      '<h3>Budget — $' + state.plan.toLocaleString('en-US') + ' plan, ' + sharePct(state.share) + '% farmer share</h3>' +
      '<div class="budget">' +
      '<div><span>Plan deployed</span><b>$' + state.plan.toLocaleString('en-US') + '</b></div>' +
      '<div><span>Gas, all steps</span><b>$' + r.plan.gas_usd.toFixed(2) + '</b></div>' +
      '<div><span>Active time</span><b>' + r.plan.hours.toFixed(2) + ' h</b></div>' +
      '<div><span>Expected drop</span><b>' + full(ec.drop) + '</b></div>' +
      '<div><span>Net of fees</span><b class="' + netCls + '">' + full(ec.net) + '</b></div>' +
      '<div><span>Net / hour</span><b class="' + netCls + '">$' + ec.nph.toFixed(2) + '</b></div>' +
      '<div><span>Verdict</span><b>' + ec.verdict + '</b></div></div>' +
      '<h3>Risks the snapshot shows</h3><ul class="risks">' + risks + '</ul>' +
      '<p><strong>Verdict:</strong> ' + verdictText + '</p>';
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
    var v = D.value_validation, o = D.odds_validation;
    $('method').innerHTML =
      '<p class="note">Implied value = TVL × fitted multiple × token odds. The multiple is a log-linear fit of log(market-cap/TVL) on ' +
      v.kept_terms.join(' and ') + ', fitted on ' + v.peers + ' token-bearing peers with a market cap of at least $1M, outside the exchange, bridge and liquid-staking categories whose tokens are not launches of their own. ' +
      'Every term was added in order and kept only when it lowered the typical miss in BOTH the leave-one-out test (×' + v.loo_miss + ' vs flat ×' + v.flat_loo + ') and the walk-forward test (×' + v.wf_miss + ' vs flat ×' + v.flat_wf + '). ' +
      'Category effects, age and chain count were tried the same way and dropped — their numbers are in the tables above, not hidden. ' +
      'The odds model is a logistic fit on ' + o.peers + ' dated protocols, kept terms ' + o.kept_terms.join(' and ') + ', Brier ' + o.brier_cv + ' (10-fold) and ' + o.brier_wf + ' (walk-forward) against a base rate of ' + o.base_rate + '. ' +
      'Ranges are P25–P75 and P10–P90 bands from the leave-one-out residuals; the held-out shares are printed in the tables above, and they are what the bands are worth. ' +
      'Wrapped, staked and bridged products are excluded, and no protocol name is ever special-cased — the same scoring path ranks every row.</p>';
    $('calib').innerHTML = D.calibration.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.peers + '</td><td class="num">×' + c.multiple.toFixed(3) + (c.peers === 0 ? ' †' : '') + '</td>' +
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
    $('sort').value = state.sort;
    $('q').value = state.q;
    $('plan').value = String(state.plan);
    $('share').value = String(state.share);
  }
  function wire() {
    $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); stateToHash(); });
    $('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); stateToHash(); });
    $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); stateToHash(); });
    $('sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); stateToHash(); });
    $('plan').addEventListener('change', function () { state.plan = parseInt(this.value, 10); renderTabs(); renderBoard(); renderDetail(); renderHero(); stateToHash(); });
    $('share').addEventListener('change', function () { state.share = parseFloat(this.value); renderTabs(); renderBoard(); renderDetail(); renderHero(); stateToHash(); });
    window.addEventListener('hashchange', function () {
      state = hashToState();
      $('chain').value = state.chain; $('cat').value = state.cat;
      $('sort').value = state.sort; $('q').value = state.q;
      $('plan').value = String(state.plan); $('share').value = String(state.share);
      renderTabs(); renderBoard(); renderDetail();
    });
  }

  renderMeta();
  renderKpis();
  renderLedger();
  renderEvidence();
  renderHero();
  renderTabs();
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
