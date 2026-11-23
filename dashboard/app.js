(function () {
  'use strict';
  var data = window.RADAR;
  var app = document.getElementById('app');
  var drawer = document.getElementById('detail');
  var scrim = document.getElementById('scrim');
  var detailContent = document.getElementById('detail-content');
  if (!data || !Array.isArray(data.rows) || !app) {
    if (app) app.textContent = 'Radar data is unavailable. Re-run the local build with the sealed snapshot.';
    return;
  }
  var state = { query: '', chain: 'all', category: 'all', evidence: 'all', minTvl: 0, sort: 'implied_value_usd', direction: -1, page: 0 };
  var initialParams = new URLSearchParams(window.location.search);
  state.query = initialParams.get('q') || '';
  state.chain = initialParams.get('chain') || 'all';
  state.category = initialParams.get('category') || 'all';
  var pageSize = 30;
  var renderFrame = 0;
  var returnFocus = null;
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function compactUsd(value) {
    if (value == null || !Number.isFinite(value)) return 'n/a';
    if (Math.abs(value) >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
    if (Math.abs(value) >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (Math.abs(value) >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (Math.abs(value) >= 1e3) return '$' + (value / 1e3).toFixed(0) + 'K';
    return money.format(value);
  }
  function percent(value) {
    if (value == null || !Number.isFinite(value)) return 'n/a';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }
  function age(value) {
    if (value == null) return 'Unknown';
    if (value >= 365) return (value / 365).toFixed(1) + 'y';
    return integer.format(value) + 'd';
  }
  function chainsFor(row) {
    return Array.isArray(row.chains) ? row.chains : [];
  }
  function makeOptions(values, selected, title) {
    return '<option value="all">' + title + '</option>' + values.map(function (value) {
      return '<option value="' + esc(value) + '"' + (selected === value ? ' selected' : '') + '>' + esc(value) + '</option>';
    }).join('');
  }
  function filteredRows() {
    var query = state.query.trim().toLowerCase();
    return data.rows.filter(function (row) {
      if (state.chain !== 'all' && chainsFor(row).indexOf(state.chain) < 0) return false;
      if (state.category !== 'all' && (row.category || 'Uncategorized') !== state.category) return false;
      if (state.evidence !== 'all' && row.evidence !== state.evidence) return false;
      if (row.tvl_usd < state.minTvl) return false;
      if (!query) return true;
      return [row.name, row.slug, row.category, chainsFor(row).join(' ')].join(' ').toLowerCase().indexOf(query) >= 0;
    }).sort(function (a, b) {
      var left = a[state.sort];
      var right = b[state.sort];
      if (left == null) return 1;
      if (right == null) return -1;
      if (typeof left === 'string') return left.localeCompare(right) * state.direction;
      return (left - right) * state.direction || a.rank - b.rank;
    });
  }
  function badge(level) {
    var label = level === 'complete' ? 'COMPLETE' : level === 'partial' ? 'PARTIAL' : 'LIMITED';
    return '<span class="badge ' + esc(level) + '" title="Snapshot field completeness; not an on-chain safety score">' + label + '</span>';
  }
  function renderTable(rows) {
    var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.page = Math.min(state.page, totalPages - 1);
    var start = state.page * pageSize;
    var visible = rows.slice(start, start + pageSize);
    var body = visible.map(function (row) {
      var chain = chainsFor(row).slice(0, 2).join(', ') || 'n/a';
      var changeClass = row.change_7d > 0 ? 'change-up' : row.change_7d < 0 ? 'change-down' : '';
      return '<tr tabindex="0" data-open="' + esc(row.slug) + '" aria-label="Open ' + esc(row.name) + ' details">' +
        '<td class="rank-cell">' + String(row.rank).padStart(3, '0') + '</td>' +
        '<td class="protocol-cell"><strong>' + esc(row.name) + '</strong><small>' + esc(row.slug) + '</small></td>' +
        '<td>' + esc(row.category || 'Uncategorized') + '</td><td>' + esc(chain) + '</td>' +
        '<td class="num">' + compactUsd(row.tvl_usd) + '</td><td class="num ' + changeClass + '">' + percent(row.change_7d) + '</td>' +
        '<td class="value-cell">' + compactUsd(row.implied_value_usd) + '</td><td>' + badge(row.evidence) + '</td></tr>';
    }).join('');
    return '<div class="table-card"><div class="table-scroll"><table><thead><tr>' +
      '<th>Rank</th><th><button data-sort="name">Protocol</button></th><th>Category</th><th>Networks</th>' +
      '<th><button data-sort="tvl_usd">TVL</button></th><th><button data-sort="change_7d">7D change</button></th>' +
      '<th><button data-sort="implied_value_usd">Model value</button></th><th>Data</th></tr></thead><tbody>' +
      (body || '<tr><td class="empty-state" colspan="8">No protocols match these filters. Adjust the research lens to continue.</td></tr>') +
      '</tbody></table></div><div class="table-footer"><span>Showing ' + (rows.length ? start + 1 : 0) + '-' +
      Math.min(start + pageSize, rows.length) + ' of ' + rows.length + ' matching protocols</span>' +
      '<div class="pager"><button class="page-button" data-page="prev"' + (state.page === 0 ? ' disabled' : '') + '>PREVIOUS</button>' +
      '<span>PAGE ' + (state.page + 1) + ' / ' + totalPages + '</span><button class="page-button" data-page="next"' +
      (state.page >= totalPages - 1 ? ' disabled' : '') + '>NEXT</button></div></div></div>';
  }
  function render() {
    var allRows = data.rows;
    var rows = filteredRows();
    var chains = Array.from(new Set(allRows.reduce(function (all, row) { return all.concat(chainsFor(row)); }, []))).sort();
    var categories = Array.from(new Set(allRows.map(function (row) { return row.category || 'Uncategorized'; }))).sort();
    var top = allRows.slice().sort(function (a, b) { return a.rank - b.rank; }).slice(0, 3);
    var topValue = top.length ? top[0].tvl_usd : 1;
    var rankedTvl = data.total_ranked_tvl_usd || 0;
    var meanValue = allRows.length ? allRows.reduce(function (sum, row) { return sum + row.implied_value_usd; }, 0) / allRows.length : 0;
    document.getElementById('snapshot-date').textContent = data.as_of + ' UTC';
    var spotlight = top.map(function (row) {
      return '<article class="spotlight" tabindex="0" data-open="' + esc(row.slug) + '"><div class="spot-top"><span class="rank-chip">RANK ' +
        String(row.rank).padStart(2, '0') + '</span><span>' + esc(row.category || 'PROTOCOL') + '</span></div><h3>' + esc(row.name) +
        '</h3><div class="spot-meta">' + esc(chainsFor(row).slice(0, 2).join(' / ') || 'Network not listed') + ' &nbsp;·&nbsp; ' +
        percent(row.change_7d) + ' 7D</div><div class="spot-value"><strong>' + compactUsd(row.implied_value_usd) +
        '</strong><span>TVL ' + compactUsd(row.tvl_usd) + '</span></div><div class="relative-track" aria-label="TVL relative to the top pick"><i style="width:' +
        Math.max(3, Math.min(100, row.tvl_usd / topValue * 100)) + '%"></i></div></article>';
    }).join('');
    var live = (data.live || []).slice(0, 8).map(function (row) {
      return '<span class="live-item"><b>' + esc(row.name) + '</b> &nbsp;' + compactUsd(row.mcap_usd) + ' mcap</span>';
    }).join('');
    app.innerHTML = '<section class="hero"><div><div class="eyebrow">EARLY-PROTOCOL RESEARCH / ' + esc(data.model_version) + '</div>' +
      '<h1>Find signal before the token story.</h1><p class="hero-copy">A ranked research queue for protocols whose sealed data record carries no token. ' +
      'Every value is derived from TVL, seven-day change, and tracked age - not a launch prediction.</p></div>' +
      '<aside class="hero-note"><strong>READ THE MODEL, NOT A PROMISE</strong>No token contract, holder distribution, mint authority, freeze authority, or LP-lock fields exist in this snapshot. Safety is not inferred.</aside></section>' +
      '<section class="kpi-grid" aria-label="Radar summary"><article class="kpi"><div class="kpi-label">Watchlist coverage</div><div class="kpi-value">' +
      data.watchlist_size + '/' + data.watchlist_size + '</div><div class="kpi-foot">Every house-flagged protocol retained</div></article>' +
      '<article class="kpi"><div class="kpi-label">Ranked protocols</div><div class="kpi-value">' + integer.format(allRows.length) +
      '</div><div class="kpi-foot">Pre-token records, including below-floor finds</div></article>' +
      '<article class="kpi"><div class="kpi-label">Ranked protocol TVL</div><div class="kpi-value">' + compactUsd(rankedTvl) +
      '</div><div class="kpi-foot">TVL across the selected research set</div></article>' +
      '<article class="kpi"><div class="kpi-label">Mean implied value</div><div class="kpi-value">' + compactUsd(meanValue) +
      '</div><div class="kpi-foot">' + esc(data.model_version) + ' score; per protocol</div></article></section>' +
      '<section aria-labelledby="spotlight-title"><div class="section-head"><div><div class="section-kicker">01 / PRIORITY QUEUE</div>' +
      '<h2 id="spotlight-title">Top of the radar</h2></div><p>TVL and model value bars are relative, not historical price charts.</p></div>' +
      '<div class="spotlight-grid">' + spotlight + '</div></section>' +
      '<section class="board-section" aria-labelledby="board-title"><div class="board-heading"><div><div class="section-kicker">02 / FULL COVERAGE</div>' +
      '<h2 id="board-title">Protocol board</h2></div><span class="result-count" id="result-count">' + rows.length + ' MATCHES</span></div>' +
      '<div class="filters"><div class="filter"><label for="search">Search name, slug, category</label><input id="search" type="search" placeholder="Try a protocol or network" value="' +
      esc(state.query) + '" autocomplete="off"></div><div class="filter"><label for="chain">Network</label><select id="chain">' +
      makeOptions(chains, state.chain, 'All networks') + '</select></div><div class="filter"><label for="category">Category</label><select id="category">' +
      makeOptions(categories, state.category, 'All categories') + '</select></div><div class="filter"><label for="evidence">Snapshot completeness</label><select id="evidence">' +
      '<option value="all">Any evidence</option><option value="complete"' + (state.evidence === 'complete' ? ' selected' : '') + '>Complete fields</option>' +
      '<option value="partial"' + (state.evidence === 'partial' ? ' selected' : '') + '>Partial fields</option><option value="limited"' +
      (state.evidence === 'limited' ? ' selected' : '') + '>Limited fields</option></select></div><div class="filter"><label for="min-tvl">Minimum TVL</label>' +
      '<select id="min-tvl"><option value="0">Any TVL</option><option value="10000000">$10M+</option><option value="50000000">$50M+</option>' +
      '<option value="250000000">$250M+</option><option value="1000000000">$1B+</option></select></div><button class="reset-button" id="reset">RESET</button></div>' +
      renderTable(rows) + '</section><section class="live-reference"><div class="section-kicker">03 / CONTEXT ONLY</div>' +
      '<h2>Token-bearing protocols in the same snapshot</h2><p>Separated from the pre-token ranking; market-cap records are context, not launch scores.</p>' +
      '<div class="live-list">' + (live || '<span class="live-item">No token-bearing reference rows in this snapshot.</span>') + '</div></section>' +
      '<div class="source-line"><b>SNAPSHOT:</b> ' + esc(data.as_of) + ' &nbsp;·&nbsp; ' + esc(data.source) +
      '<br><b>MODEL:</b> implied value = TVL × ' + Number(data.model.base_multiple).toFixed(2) + ' × growth factor × age factor; growth clamped to ' +
      data.model.growth_floor + '% / +' + data.model.growth_cap + '%.<br><b>NOT INCLUDED:</b> launch date, token address, liquidity safety, holder concentration, or future airdrops.</div>';
    document.getElementById('result-count').textContent = rows.length + ' MATCHES';
    app.setAttribute('aria-busy', 'false');
  }
  function openDetail(slug) {
    var row = data.rows.find(function (item) { return item.slug === slug; });
    if (!row) return;
    returnFocus = document.activeElement;
    detailContent.innerHTML = '<div class="drawer-head"><span>PROTOCOL DOSSIER / #' + String(row.rank).padStart(3, '0') +
      '</span><button class="close-button" id="close-detail" aria-label="Close detail">×</button></div><h2 class="detail-title" id="detail-title">' +
      esc(row.name) + '</h2><div class="detail-sub">' + esc(row.slug) + ' &nbsp;·&nbsp; ' + esc(row.category || 'Uncategorized') + '</div>' +
      '<div class="detail-value"><small>MODEL IMPLIED VALUE / ' + esc(data.model_version) + '</small><strong>' +
      compactUsd(row.implied_value_usd) + '</strong><span>Not a market price or a prediction of token issuance.</span></div>' +
      '<div class="detail-grid"><div class="detail-stat"><small>TVL</small><b>' + compactUsd(row.tvl_usd) + '</b></div>' +
      '<div class="detail-stat"><small>7-day TVL change</small><b>' + percent(row.change_7d) + '</b></div><div class="detail-stat"><small>Tracked age</small><b>' +
      age(row.age_days) + '</b></div><div class="detail-stat"><small>Evidence completeness</small><b>' + esc(row.evidence.toUpperCase()) +
      '</b></div><div class="detail-stat"><small>Networks</small><b>' + esc(chainsFor(row).join(', ') || 'Not listed') +
      '</b></div><div class="detail-stat"><small>Token record</small><b>None recorded</b></div></div>' +
      '<div class="detail-note">Safety check unavailable: this sealed snapshot has no contract address, owner/mint/freeze authority, holder concentration, or LP-lock data. Verify contracts and risks independently.</div>' +
      '<div class="copy-row"><span>Protocol identifier</span><button class="copy-button" id="copy-slug" data-slug="' + esc(row.slug) +
      '">COPY SLUG</button></div><div class="copy-status" id="copy-status" role="status" aria-live="polite"></div>' +
      '<h3 class="detail-section">Research plan / costs & time</h3><ol class="farm-list">' +
      row.farm_steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') + '</ol>' +
      '<h3 class="detail-section">Value model inputs</h3><div class="detail-note">TVL ' + compactUsd(row.tvl_usd) +
      ' × ' + Number(data.model.base_multiple).toFixed(2) + ' base multiple × ' + Number(row.growth_multiplier).toFixed(4) +
      ' growth × ' + Number(row.maturity_multiplier).toFixed(4) + ' maturity. The model uses only snapshot fields.</div>';
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('close-detail').focus();
  }
  function closeDetail() {
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    scrim.hidden = true;
    document.body.style.overflow = '';
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }
  function renderKeepingFocus() {
    var active = document.activeElement;
    var searchPosition = active && active.id === 'search' ? active.selectionStart : null;
    render();
    if (!active || !active.id) return;
    var replacement = document.getElementById(active.id);
    if (!replacement) return;
    replacement.focus();
    if (replacement.id === 'search' && searchPosition !== null) {
      replacement.setSelectionRange(searchPosition, searchPosition);
    }
  }
  function scheduleRender() {
    if (renderFrame) window.cancelAnimationFrame(renderFrame);
    renderFrame = window.requestAnimationFrame(function () {
      renderFrame = 0;
      renderKeepingFocus();
    });
  }

  app.addEventListener('input', function (event) {
    if (event.target.id !== 'search') return;
    state.query = event.target.value;
    state.page = 0;
    scheduleRender();
  });
  app.addEventListener('change', function (event) {
    var target = event.target;
    if (target.id === 'chain') state.chain = target.value;
    else if (target.id === 'category') state.category = target.value;
    else if (target.id === 'evidence') state.evidence = target.value;
    else if (target.id === 'min-tvl') state.minTvl = Number(target.value);
    else return;
    state.page = 0;
    renderKeepingFocus();
  });
  app.addEventListener('click', function (event) {
    var target = event.target instanceof Element ? event.target.closest('button, [data-open]') : null;
    if (!target) return;
    if (target.id === 'reset') {
      state.query = ''; state.chain = 'all'; state.category = 'all'; state.evidence = 'all'; state.minTvl = 0; state.page = 0;
      renderKeepingFocus(); return;
    }
    if (target.dataset.sort) {
      state.direction = state.sort === target.dataset.sort ? -state.direction : (target.dataset.sort === 'name' ? 1 : -1);
      state.sort = target.dataset.sort; renderKeepingFocus(); return;
    }
    if (target.dataset.page) { state.page += target.dataset.page === 'next' ? 1 : -1; renderKeepingFocus(); return; }
    if (target.dataset.open) openDetail(target.dataset.open);
  });
  app.addEventListener('keydown', function (event) {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.dataset.open) {
      event.preventDefault(); openDetail(event.target.dataset.open);
    }
  });
  detailContent.addEventListener('click', function (event) {
    if (event.target.id === 'close-detail') closeDetail();
    if (event.target.id === 'copy-slug') {
      var status = document.getElementById('copy-status');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          navigator.clipboard.writeText(event.target.dataset.slug).then(function () {
            status.textContent = 'Protocol slug copied.';
          }, function () {
            status.textContent = 'Clipboard unavailable. Select the slug shown above and copy it manually.';
          });
        } catch (error) {
          status.textContent = 'Could not copy protocol slug: ' + (error instanceof Error ? error.message : String(error));
        }
      } else {
          status.textContent = 'Clipboard unavailable. Select the slug shown above and copy it manually.';
      }
    }
  });
  scrim.addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !drawer.hidden) closeDetail();
  });
  document.getElementById('workspace').setAttribute('aria-busy', 'false');
  render();
  var initialDetail = initialParams.get('detail');
  if (initialDetail) openDetail(initialDetail);
}());
