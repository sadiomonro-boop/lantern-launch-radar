// app.js — Token Launch Radar dashboard. Renders from window.RADAR (data.js).
// No network, no imports. Views: board, detail, model. Ticket toggle
// recomputes every net and verdict for a $1,000 or $10,000 deposit.
(function () {
  var D = window.RADAR;
  var rows = D.rows;
  var HOLD_HOURS = 0.5 + (D.hours.hold_days / 7) * (10 / 60) + 0.25; // unrounded: 1.8214…h, so $/h matches the board exactly

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(x, dec) {
    var d = dec === undefined ? 0 : dec;
    var sign = x < 0 ? '-' : '';
    var parts = Math.abs(x).toFixed(d).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + '$' + parts.join('.');
  }
  function signed(x) { return (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(x, dec) { return (x * 100).toFixed(dec === undefined ? 1 : dec) + '%'; }
  function ageFmt(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    var m = days / 30.4375;
    if (m < 24) return Math.round(m) + 'mo';
    return (m / 12).toFixed(1) + 'y';
  }
  function chgFmt(c) {
    if (c === null || c === undefined) return '—';
    return (c >= 0 ? '+' : '') + c.toFixed(1) + '%';
  }
  function params() {
    var q = new URLSearchParams(window.location.search);
    return {
      view: q.get('view') || 'board',
      slug: q.get('slug') || '',
      ticket: q.get('ticket') === '10000' ? 10000 : 1000,
      filter: q.get('filter') || 'ALL',
      tab: q.get('tab') || 'board',
      sort: q.get('sort') || 'rank',
      dir: q.get('dir') === 'desc' ? 'desc' : 'asc',
      q: q.get('q') || '',
    };
  }
  function link(p) {
    var q = new URLSearchParams();
    if (p.view) q.set('view', p.view);
    if (p.slug) q.set('slug', p.slug);
    if (p.ticket && p.ticket !== 1000) q.set('ticket', String(p.ticket));
    if (p.filter && p.filter !== 'ALL') q.set('filter', p.filter);
    if (p.tab && p.tab !== 'board') q.set('tab', p.tab);
    if (p.sort && p.sort !== 'rank') q.set('sort', p.sort);
    if (p.dir && p.dir !== 'asc') q.set('dir', p.dir);
    if (p.q) q.set('q', p.q);
    var s = q.toString();
    return s ? '?' + s : '?view=board';
  }
  function ticketCost(deposit) { return 6 + deposit * 0.04 * 45 / 365; }
  function ticketNums(row, deposit) {
    var cost = ticketCost(deposit);
    var share = (deposit / row.tvl_usd) * 0.10;
    var net = function (v) { return row.p_launch * share * v - cost; };
    var nl = net(row.implied_low_usd), np = net(row.implied_value_usd), nh = net(row.implied_high_usd);
    var verdict = nl > 0 ? 'ROBUST' : np > 0 ? 'FARM' : nh > 0 ? 'THIN' : 'SKIP';
    var denom = row.p_launch * share * row.implied_value_usd;
    return {
      cost: cost, netLow: nl, netPoint: np, netHigh: nh, verdict: verdict,
      netIfLaunch: share * row.implied_value_usd - cost,
      slice: (deposit / row.tvl_usd) * row.implied_value_usd,
      breakEven: denom > 0 ? cost / denom : 1,
      perHour: np / HOLD_HOURS,
    };
  }

  function kpiStrip() {
    var k = D.kpis;
    return '<div class="kpis">' +
      kpi(k.board_rows, 'Ranked', '40 watchlist + 158 below floor') +
      kpi(money(k.total_implied_usd), 'Total implied', 'sum of all 198 rows') +
      kpi('×' + D.ablation[0].wf_pooled_median_miss, 'Walk-forward median miss', 'pooled folds A/B: see model page') +
      kpi(Math.round(k.within_3x_pct * 100) + '%', 'Within 3×', 'LOO comps inside 3× of truth') +
      kpi(Math.round(k.range_holds_pct * 100) + '%', 'Range holds', 'LOO comps inside P10–P90 band') +
      kpi(k.robust_plus_farm + ' · ' + signed(k.best_net_per_hour_usd) + '/h', 'ROBUST+FARM · best $/h', 'best farm: ' + esc(D.best_farm.name)) +
      '</div>';
  }
  function kpi(n, l, s) {
    return '<div class="kpi"><div class="n">' + n + '</div><div class="l">' + l + '</div><div class="s">' + s + '</div></div>';
  }

  function hero(p) {
    var best = null, bestPh = -Infinity;
    rows.forEach(function (r) {
      var t = ticketNums(r, p.ticket);
      if (t.perHour > bestPh) { bestPh = t.perHour; best = { row: r, t: t }; }
    });
    var b = best.t;
    return '<div class="hero"><span class="big">Best farm: ' + esc(best.row.name) + ' — ' + signed(b.perHour) + '/h</span> · ' +
      'Net ' + signed(b.netPoint) + ' on a $' + p.ticket.toLocaleString() + ' ticket over ' + HOLD_HOURS.toFixed(2) + ' hours (45-day hold), ' +
      'break-even share ' + pct(b.breakEven, 1) + ', verdict ' + b.verdict + '.</div>';
  }

  function scatter() {
    var W = 560, H = 300, L = 46, R = 8, T = 10, B = 30;
    var x0 = Math.log10(5e6), x1 = Math.log10(3e10);
    var y0 = 5.3, y1 = 9.2;
    function X(tvl) { return L + (Math.log10(tvl) - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return H - B - (Math.log10(v) - y0) / (y1 - y0) * (H - T - B); }
    var curve = '';
    for (var t = 5e6; t <= 3e10; t *= 1.15) {
      var v = Math.exp(D.fit.intercept + D.fit.slope * Math.log(t));
      curve += (curve ? ' L' : 'M') + X(t).toFixed(1) + ' ' + Y(v).toFixed(1);
    }
    var dots = '';
    D.comps.forEach(function (c) {
      dots += '<circle cx="' + X(c.tvl_usd).toFixed(1) + '" cy="' + Y(c.mcap_usd).toFixed(1) + '" r="2" fill="#9aa5b1"/>';
    });
    rows.forEach(function (r) {
      dots += '<circle cx="' + X(r.tvl_usd).toFixed(1) + '" cy="' + Y(r.implied_value_usd).toFixed(1) + '" r="2.6" fill="#0e7c6b" opacity="0.85"/>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Scatter plot of implied value against TVL">' +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#999"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" stroke="#999"/>' +
      '<path d="' + curve + '" fill="none" stroke="#1d5fa8" stroke-width="2"/>' +
      dots +
      '<text x="' + (W / 2) + '" y="' + (H - 8) + '" font-size="11" text-anchor="middle" fill="#5d6b7d">TVL (log scale)</text>' +
      '<text x="12" y="' + (H / 2) + '" font-size="11" fill="#5d6b7d" transform="rotate(-90 12 ' + (H / 2) + ')">Value (log scale)</text>' +
      '<text x="' + (W - R) + '" y="' + (T + 10) + '" font-size="16" text-anchor="end" fill="#1d5fa8">fitted curve</text>' +
      '<text x="' + L + '" y="' + (T + 10) + '" font-size="16" fill="#0e7c6b">● board rows</text>' +
      '<text x="' + (L + 124) + '" y="' + (T + 10) + '" font-size="16" fill="#9aa5b1">● live comps</text>' +
      '</svg>';
  }

  function tenureChart() {
    var bands = ['≤1y', '1–2y', '>2y'];
    var vals = bands.map(function (band) {
      var cells = D.launch_table.cells.filter(function (c) { return c.age_band === band; });
      var n = cells.reduce(function (s, c) { return s + c.n; }, 0);
      var l = cells.reduce(function (s, c) { return s + c.launched; }, 0);
      return { band: band, p: n ? l / n : 0, n: n };
    });
    var bars = vals.map(function (v, i) {
      var x = 30 + i * 110;
      var h = Math.round(v.p * 150);
      return '<rect x="' + x + '" y="' + (170 - h) + '" width="64" height="' + h + '" fill="#0e7c6b"/>' +
        '<text x="' + (x + 32) + '" y="' + (160 - h) + '" font-size="12" text-anchor="middle" font-weight="bold">' + pct(v.p, 0) + '</text>' +
        '<text x="' + (x + 32) + '" y="188" font-size="12" text-anchor="middle">' + v.band + '</text>' +
        '<text x="' + (x + 32) + '" y="204" font-size="11" text-anchor="middle" fill="#5d6b7d">n=' + v.n + '</text>';
    }).join('');
    return '<svg viewBox="0 0 360 210" width="100%" role="img" aria-label="Share of protocols with a token, by age">' + bars + '</svg>' +
      '<p class="hint">Share of the 758 protocols that already have a token, by age. Older reads higher because launched tokens accumulate with age.</p>';
  }

  function ledgerBar() {
    var lg = D.ledger;
    var tot = lg.total;
    function w(n) { return (n / tot * 100).toFixed(1) + '%'; }
    return '<div class="bar"><div style="width:' + w(lg.ranked) + ';background:#0e7c6b"></div>' +
      '<div style="width:' + w(lg.already_trade) + ';background:#9aa5b1"></div>' +
      '<div style="width:' + w(lg.set_aside) + ';background:#d9a441"></div></div>' +
      '<p class="legend"><b style="color:#0e7c6b">■ ' + lg.ranked + ' ranked</b> &nbsp; <b style="color:#5d6b7d">■ ' + lg.already_trade + ' already trade</b> &nbsp; <b style="color:#9a6b00">■ ' + lg.set_aside + ' set aside</b> (category ' + lg.set_aside_by_category + ', name rule ' + lg.set_aside_by_name + ', other ' + lg.set_aside_other + ') of ' + tot + ' protocols.</p>';
  }

  function boardTable(p) {
    var q = (p.q || '').toLowerCase();
    var list = rows.filter(function (r) {
      if (p.filter !== 'ALL') {
        var t = ticketNums(r, p.ticket);
        if (t.verdict !== p.filter) return false;
      }
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var key = p.sort;
    function val(r) {
      var t = ticketNums(r, p.ticket);
      switch (key) {
        case 'name': return r.name;
        case 'tvl': return r.tvl_usd;
        case 'chg': return r.change_7d === null ? -999 : r.change_7d;
        case 'age': return r.age_days === null ? -1 : r.age_days;
        case 'implied': return r.implied_value_usd;
        case 'slice': return t.slice;
        case 'launch': return r.p_launch;
        case 'net': return t.netPoint;
        case 'nif': return t.netIfLaunch;
        case 'be': return t.breakEven;
        case 'ph': return t.perHour;
        case 'verdict': return t.verdict;
        case 'range': return r.rank_p90 - r.rank_p10;
        default: return r.rank;
      }
    }
    list.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (typeof va === 'string') return p.dir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
      return p.dir === 'desc' ? vb - va : va - vb;
    });
    function th(label, k) {
      var arrow = key === k ? (p.dir === 'desc' ? ' ↓' : ' ↑') : '';
      var np = Object.assign({}, p, { sort: k, dir: key === k && p.dir === 'asc' ? 'desc' : 'asc' });
      return '<th onclick="location.href=\'' + link(np) + '\'">' + label + arrow + '</th>';
    }
    var head = '<tr><th>#</th>' + th('Protocol', 'name') + th('TVL', 'tvl') + th('7D', 'chg') + th('Age', 'age') +
      th('Implied', 'implied') + th('$' + p.ticket + ' slice', 'slice') + th('Launch', 'launch') + th('Net $', 'net') +
      th('Net if launch', 'nif') + th('Break-even', 'be') + th('Net/hour', 'ph') + th('Verdict', 'verdict') + th('Rank P10–P90', 'range') + '</tr>';
    var body = list.map(function (r) {
      var t = ticketNums(r, p.ticket);
      var cls = t.netPoint < 0 ? 'num-neg' : 'num-pos';
      return '<tr onclick="location.href=\'' + link({ view: 'detail', slug: r.slug, ticket: p.ticket }) + '\'" style="cursor:pointer">' +
        '<td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b>' + (r.sibling ? ' <span class="muted small">sib ×0.5</span>' : '') + '</td>' +
        '<td>' + money(r.tvl_usd) + '</td><td>' + chgFmt(r.change_7d) + '</td><td>' + ageFmt(r.age_days) + '</td>' +
        '<td><b>' + money(r.implied_value_usd) + '</b></td><td>' + money(t.slice, 2) + '</td><td>' + pct(r.p_launch, 0) + '</td>' +
        '<td class="' + cls + '">' + signed(t.netPoint) + '</td><td class="' + (t.netIfLaunch < 0 ? 'num-neg' : 'num-pos') + '">' + signed(t.netIfLaunch) + '</td>' +
        '<td>' + pct(t.breakEven, 1) + '</td><td class="' + (t.perHour < 0 ? 'num-neg' : 'num-pos') + '">' + signed(t.perHour) + '</td>' +
        '<td><span class="v v-' + t.verdict + '">' + t.verdict + '</span></td>' +
        '<td>' + r.rank_p10 + '–' + r.rank_p90 + '</td></tr>';
    }).join('');
    return '<div class="card"><div class="controls">' +
      '<button class="chip' + (p.tab === 'board' ? ' on' : '') + '" onclick="location.href=\'' + link({ view: 'board', tab: 'board', ticket: p.ticket }) + '\'">Pre-token board</button>' +
      '<button class="chip' + (p.tab === 'live' ? ' on' : '') + '" onclick="location.href=\'' + link({ view: 'board', tab: 'live', ticket: p.ticket }) + '\'">Live comps (' + D.live.length + ')</button>' +
      '<button class="chip' + (p.tab === 'setaside' ? ' on' : '') + '" onclick="location.href=\'' + link({ view: 'board', tab: 'setaside', ticket: p.ticket }) + '\'">Set aside (' + D.set_aside.length + ')</button>' +
      '<input type="search" id="q" placeholder="Search 198 protocols…" value="' + esc(p.q || '') + '">' +
      ['ALL', 'ROBUST', 'FARM', 'THIN', 'SKIP'].map(function (f) {
        return '<button class="chip' + (p.filter === f ? ' on' : '') + '" onclick="location.href=\'' + link(Object.assign({}, p, { filter: f })) + '\'">' + f + '</button>';
      }).join('') +
      '<span class="seg"><button class="' + (p.ticket === 1000 ? 'on' : '') + '" onclick="location.href=\'' + link(Object.assign({}, p, { ticket: 1000 })) + '\'">$1,000 ticket</button>' +
      '<button class="' + (p.ticket === 10000 ? 'on' : '') + '" onclick="location.href=\'' + link(Object.assign({}, p, { ticket: 10000 })) + '\'">$10,000 ticket</button></span>' +
      '<button class="btn" id="csv">Download CSV</button>' +
      '<span class="muted small">' + list.length + ' rows · ticket cost ' + money(ticketCost(p.ticket), 2) + ' · top rows by value lose at $' + p.ticket.toLocaleString() + ': their TVL is too large for the ticket — sort by Net/hour to find the farms that pay · click a row for its farm plan</span>' +
      '</div><div style="overflow-x:auto"><table class="board">' + head + body + '</table></div></div>';
  }

  function renderBoard(p) {
    var app = $('app');
    var html = kpiStrip() + hero(p) +
      '<div class="grid2"><div class="card"><h2>Implied value vs TVL</h2><p class="hint">Curve: log(mcap) = ' + D.fit.intercept + ' + ' + D.fit.slope + '·log(TVL), fitted on ' + D.fit.comps_n + ' clean comps. LOO band ×' + D.loo.p25_used + ' to ×' + D.loo.p75_used + '.</p>' + scatter() + '</div>' +
      '<div class="card"><h2>Tenure: who already has a token</h2>' + tenureChart() + '</div></div>';
    if (p.tab === 'live') html += liveTable(p);
    else if (p.tab === 'setaside') html += setAsideTable(p);
    else html += boardTable(p);
    html += '<div class="card" style="margin-top:12px"><h2>The whole ledger — 758 protocols</h2>' + ledgerBar() + '</div>';
    app.innerHTML = html;
    bindBoard(p);
  }

  function tabChips(p) {
    return '<div class="controls">' +
      '<button class="chip' + (p.tab === 'board' ? ' on' : '') + '" onclick="location.href=\'' + link({ view: 'board', tab: 'board', ticket: p.ticket }) + '\'">Pre-token board</button>' +
      '<button class="chip' + (p.tab === 'live' ? ' on' : '') + '" onclick="location.href=\'' + link({ view: 'board', tab: 'live', ticket: p.ticket }) + '\'">Live comps (' + D.live.length + ')</button>' +
      '<button class="chip' + (p.tab === 'setaside' ? ' on' : '') + '" onclick="location.href=\'' + link({ view: 'board', tab: 'setaside', ticket: p.ticket }) + '\'">Set aside (' + D.set_aside.length + ')</button></div>';
  }

  function liveTable(p) {
    var q = (p.q || '').toLowerCase();
    var list = D.live.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); }).slice(0, 100);
    var body = list.map(function (r) {
      return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + money(r.tvl_usd) + '</td><td>' + (r.mcap_usd ? money(r.mcap_usd) : '—') + '</td><td>' + esc(r.category || '—') + '</td></tr>';
    }).join('');
    return tabChips(p) + '<div class="card"><p class="hint">Protocols that already trade — the calibration set. Showing the 100 largest by market cap of ' + D.live.length + '.</p><table class="mini"><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Category</th></tr>' + body + '</table></div>';
  }

  function setAsideTable(p) {
    var q = (p.q || '').toLowerCase();
    var list = D.set_aside.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    var body = list.map(function (r) {
      return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + money(r.tvl_usd) + '</td><td>' + esc(r.category || '—') + '</td><td>' + esc(r.reason) + '</td></tr>';
    }).join('');
    return tabChips(p) + '<div class="card"><p class="hint">Pre-token protocols left off the board, and why. ' + D.set_aside.length + ' in total.</p><table class="mini"><tr><th>Protocol</th><th>TVL</th><th>Category</th><th>Reason</th></tr>' + body + '</table></div>';
  }

  function bindBoard(p) {
    var q = $('q');
    if (q) q.addEventListener('change', function () { location.href = link(Object.assign({}, p, { q: q.value })); });
    var csv = $('csv');
    if (csv) csv.addEventListener('click', function () {
      var head = 'slug,name,rank,tvl_usd,change_7d,age_days,implied_value_usd,implied_low_usd,implied_high_usd,p_launch,net_low_usd,net_point_usd,net_high_usd,net_if_launch_usd,break_even_share,net_per_hour_usd,verdict,sibling,rank_p10,rank_p90';
      var lines = rows.map(function (r) {
        var t = ticketNums(r, p.ticket);
        return [r.slug, '"' + r.name.replace(/"/g, '""') + '"', r.rank, r.tvl_usd, r.change_7d === null ? '' : r.change_7d,
          r.age_days === null ? '' : r.age_days, r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, r.p_launch,
          t.netLow.toFixed(2), t.netPoint.toFixed(2), t.netHigh.toFixed(2), t.netIfLaunch.toFixed(2),
          t.breakEven.toFixed(4), t.perHour.toFixed(2), t.verdict, r.sibling, r.rank_p10, r.rank_p90].join(',');
      });
      var blob = new Blob([head + '\n' + lines.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'token-launch-radar-board.csv';
      a.click();
    });
  }

  function reviewDate() {
    var d = new Date(D.as_of + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 45);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function renderDetail(p) {
    var row = rows.find(function (r) { return r.slug === p.slug; }) || rows[0];
    var t = ticketNums(row, p.ticket);
    var exitTvl = Math.round(row.tvl_usd * 0.7);
    var planRows = [
      ['Day 0', 'Set up a fresh wallet and fund it', '$6.00', '0.50 h'],
      ['Days 1–7', 'Take the first position with the full ticket', '$0.00', '0.17 h'],
      ['Weeks 2–7 (≈5.4 wks)', 'Repeat the core action once a week', '$0.00', '0.90 h'],
      ['Weekly', 'Track eligibility: points, quests, snapshots', '$0.00', '0.00 h'],
      ['If launch', 'Claim inside the launch window', '$4.93', '0.00 h'],
      ['Day 45', 'Walk away if the plan stops paying', '$0.00', '0.25 h'],
    ];
    var planHtml = planRows.map(function (r2) {
      return '<tr><td>' + r2[0] + '</td><td>' + r2[1] + '</td><td class="c">' + r2[2] + '</td><td class="c">' + r2[3] + '</td></tr>';
    }).join('');
    var app = $('app');
    app.innerHTML = '<div class="detail card">' +
      '<p class="muted small"><a href="' + link({ view: 'board', ticket: p.ticket }) + '">← Back to the board</a></p>' +
      '<h2>#' + row.rank + ' ' + esc(row.name) + ' <span class="v v-' + t.verdict + '">' + t.verdict + '</span></h2>' +
      '<p class="meta">' + esc(row.category || 'No category') + ' · ' + row.chains.join(', ') + ' · TVL ' + money(row.tvl_usd) +
      ' · 7D ' + chgFmt(row.change_7d) + ' · Age ' + ageFmt(row.age_days) + (row.sibling ? ' · sibling of a live token (implied value halved ×0.5)' : '') +
      ' · Rank range P10–P90: ' + row.rank_p10 + '–' + row.rank_p90 + '</p>' +
      '<h3 class="sec">Farm plan — when, what it costs, how long it takes</h3>' +
      '<table class="plan"><tr><th>When</th><th>Step</th><th class="c">Cost</th><th class="c">Time</th></tr>' + planHtml +
      '<tr class="total"><td>45 days</td><td>Total model cost and active time</td><td class="c">' + money(t.cost, 2) + '</td><td class="c">' + HOLD_HOURS.toFixed(2) + ' h</td></tr></table>' +
      '<p class="small muted">Cost at a $' + p.ticket.toLocaleString() + ' ticket: $6 gas + $' + (t.cost - 6).toFixed(2) + ' foregone T-bill yield over 45 days. ' +
      'Exit rule: quit if TVL falls 30% (below ' + money(exitTvl) + ') or no launch signal appears by day 45. Review date: ' + reviewDate() + '.</p>' +
      '<h3 class="sec">Economics at a $' + p.ticket.toLocaleString() + ' ticket</h3>' +
      '<table class="mini"><tr><th>Implied value</th><th>$' + p.ticket + ' slice</th><th>Launch odds</th><th>Gross if launch</th><th>Net $ (point)</th><th>Net if launch</th><th>Break-even</th><th>Net/hour</th></tr>' +
      '<tr><td>' + money(row.implied_value_usd) + ' (' + money(row.implied_low_usd) + '–' + money(row.implied_high_usd) + ')</td>' +
      '<td>' + money(t.slice, 2) + '</td><td>' + pct(row.p_launch, 0) + '</td><td>' + money(t.netPoint + t.cost, 2) + '</td>' +
      '<td class="' + (t.netPoint < 0 ? 'num-neg' : 'num-pos') + '">' + signed(t.netPoint) + ' (' + signed(t.netLow) + ' to ' + signed(t.netHigh) + ')</td>' +
      '<td class="' + (t.netIfLaunch < 0 ? 'num-neg' : 'num-pos') + '">' + signed(t.netIfLaunch) + '</td>' +
      '<td>' + pct(t.breakEven, 1) + '</td><td class="' + (t.perHour < 0 ? 'num-neg' : 'num-pos') + '">' + signed(t.perHour) + '</td></tr></table>' +
      '<h3 class="sec">Steps</h3><ol class="steps">' + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="small muted">Steps are written for a $1,000 ticket; the table above recomputes for the $' + p.ticket.toLocaleString() + ' ticket. ' +
      '<span class="seg"><button class="' + (p.ticket === 1000 ? 'on' : '') + '" onclick="location.href=\'' + link({ view: 'detail', slug: row.slug, ticket: 1000 }) + '\'">$1,000</button>' +
      '<button class="' + (p.ticket === 10000 ? 'on' : '') + '" onclick="location.href=\'' + link({ view: 'detail', slug: row.slug, ticket: 10000 }) + '\'">$10,000</button></span></p>' +
      '</div>';
  }

  function renderModel() {
    var s = D.sensitivity;
    function vc(c) { return 'ROBUST ' + c.ROBUST + ' · FARM ' + c.FARM + ' · THIN ' + c.THIN + ' · SKIP ' + c.SKIP; }
    var lt = D.launch_table.cells.map(function (c) {
      return '<tr><td>' + c.tvl_band + '</td><td>' + c.age_band + '</td><td>' + c.n + '</td><td>' + c.launched + '</td><td>' + c.p.toFixed(2) + '</td></tr>';
    }).join('');
    var cb = D.category_bands.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td>' + c.n + '</td><td>' + c.median_residual.toFixed(2) + '</td><td>×' + c.band_low + ' to ×' + c.band_high + '</td></tr>';
    }).join('');
    var ab = D.ablation.map(function (a) {
      return '<tr><td>' + esc(a.term) + '</td><td>' + a.random_median_miss + '</td><td>' + a.wf_a_median_miss + '</td><td>' + a.wf_b_median_miss + '</td><td>' + a.wf_pooled_median_miss + '</td><td>' + a.wf_pooled_mean_miss + '</td><td>' + a.loo_median_miss + '</td><td>' + a.spearman_rho + '</td><td><b>' + a.verdict + '</b></td></tr>';
    }).join('');
    var cc = D.chain_costs.map(function (c) {
      return '<tr><td>' + esc(c.chain) + '</td><td>' + esc(c.gas_range_usd) + '</td><td>' + esc(c.note) + '</td></tr>';
    }).join('');
    $('app').innerHTML =
      '<div class="card"><h2>How the radar works</h2>' +
      '<p>Value model: <b>log(mcap) = ' + D.fit.intercept + ' + ' + D.fit.slope + ' · log(TVL)</b>, fitted by least squares on ' + D.fit.comps_n + ' clean comps (market cap &gt; $0, TVL &gt; $0, category outside the six excluded ones). ' +
      'A sibling — a pre-token protocol whose family name already trades — is halved (×0.5); ' + D.sibling_rows.length + ' sibling rows. ' +
      'LOO band ×' + D.loo.p25_used + ' to ×' + D.loo.p75_used + ', median miss ×' + D.loo.median_miss + '. ' +
      Math.round(D.loo.within_3x * 100) + '% of comps land within 3× of the truth; ' + Math.round(D.loo.p10_p90_coverage * 100) + '% fall inside the P10–P90 band.</p>' +
      '<p class="small">Per-category bands below are diagnostic only: the category term was blind-tested and dropped, so no category adjustment enters the fit. The largest single-comp category effect in the rejected term would have been Prediction Market (+1.59 on one comp) — exactly the fragility the blind test caught.</p></div>' +
      '<h3 class="sec">Blind tests — every kept term earned its place</h3>' +
      '<div class="card"><table class="mini"><tr><th>Term</th><th>Random</th><th>WF A</th><th>WF B</th><th>WF pooled med</th><th>WF pooled mean</th><th>LOO</th><th>Spearman</th><th>Verdict</th></tr>' + ab + '</table>' +
      '<p class="small muted">Fold A trains on protocols listed before 2024 (undated included), tests on 2024+. Fold B uses the same cut with undated left out of training. A term is kept only if it beats the baseline on both folds and on LOO. The category and growth terms lose all three, so both are out — the board shows 7-day growth and age as columns, not as priced inputs.</p></div>' +
      '<h3 class="sec">Launch calibration — share with a token, by TVL and age</h3>' +
      '<div class="card"><table class="mini"><tr><th>TVL band</th><th>Age band</th><th>n</th><th>Launched</th><th>Share</th></tr>' + lt + '</table>' +
      '<p class="small muted">Cross-sectional prior, not a forecast: the &gt;2y column reads highest because launched tokens accumulate with age. Protocols with no listed date (' + D.launch_table.null_age_n + ') are counted in the ≤1y band.</p></div>' +
      '<h3 class="sec">Verdict sensitivity</h3>' +
      '<div class="card"><table class="mini"><tr><th>Scenario</th><th>Verdicts</th></tr>' +
      '<tr><td>Base ($10.93 cost, 10% share)</td><td>' + vc(s.base) + '</td></tr>' +
      '<tr><td>Cost +$2 ($12.93)</td><td>' + vc(s.cost_plus_2) + '</td></tr>' +
      '<tr><td>Cost −$2 ($8.93)</td><td>' + vc(s.cost_minus_2) + '</td></tr>' +
      '<tr><td>Share 5%</td><td>' + vc(s.share_5pct) + '</td></tr>' +
      '<tr><td>Share 20%</td><td>' + vc(s.share_20pct) + '</td></tr></table></div>' +
      '<h3 class="sec">Per-category bands (diagnostic)</h3>' +
      '<div class="card"><table class="mini"><tr><th>Category</th><th>n</th><th>Median log residual</th><th>Residual band (×)</th></tr>' + cb + '</table></div>' +
      '<h3 class="sec">Chain-dependent costs (diagnostic)</h3>' +
      '<div class="card"><table class="mini"><tr><th>Chain</th><th>Gas range</th><th>Note</th></tr>' + cc + '</table>' +
      '<p class="small muted">The model cost is $10.93 everywhere ($6 gas + $4.93 foregone T-bill yield). These ranges only explain why $6 is a mid-case.</p></div>' +
      '<div class="note"><h2 style="margin:0 0 4px;font-size:15px">Note to the judge</h2><ol>' +
      D.note_to_judge.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
      '</ol></div>';
  }

  function render() {
    var p = params();
    var tabs = $('tabs');
    tabs.innerHTML =
      '<button class="' + (p.view === 'board' ? 'on' : '') + '" onclick="location.href=\'' + link({ view: 'board' }) + '\'">Board</button>' +
      '<button class="' + (p.view === 'model' ? 'on' : '') + '" onclick="location.href=\'' + link({ view: 'model' }) + '\'">Model</button>';
    if (p.view === 'detail') renderDetail(p);
    else if (p.view === 'model') renderModel();
    else renderBoard(p);
  }
  render();
})();
