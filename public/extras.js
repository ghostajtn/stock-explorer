// Extra pages for Stock Explorer: heatmap, earnings calendar, compare, portfolio, strategy lab,
// dividends, plus the nav and market strip. Loaded before the main script; everything here runs
// later (from the router or DOMContentLoaded), when the helpers in index.html ($, api, nf, usd...) exist.

const NAV = [['', 'Home'], ['~ai', 'AI stocks'], ['~heatmap', 'Heatmap'], ['~calendar', 'Earnings'], ['~compare', 'Compare'], ['~portfolio', 'Portfolio'], ['~lab', 'Strategy lab'], ['~dividends', 'Dividends']];
function renderNav(sym) {
  $('#nav').innerHTML = NAV.map(([h, label]) => `<a href="#/${h}" class="${(h === '' ? sym === '' : sym.startsWith(h)) ? 'on' : ''}">${label}</a>`).join('');
}

// ---------- market strip ----------
async function loadMarket() {
  if (STATIC) { $('#market').style.display = 'none'; return; }
  try {
    const m = await api('/api/market');
    $('#market').innerHTML = m.filter((x) => isN(x.price)).map((x) => `<span>${esc(x.name)} <b>${nf(x.price, x.price > 1000 ? 0 : 2)}</b><span class="${cls(x.changePct)}">${pc(x.changePct)}</span></span>`).join('');
  } catch { /* strip stays as it was */ }
}
addEventListener('DOMContentLoaded', () => { loadMarket(); setInterval(loadMarket, 60000); });

const ensureHome = async () => { if (!home.rows.length) await loadHome(); return [...(home.watch || []), ...home.rows]; };
const pageHead = (title, sub) => `<h2 style="margin:0 0 4px">${title}</h2><div class="muted" style="margin-bottom:14px">${sub}</div>`;
const NOT_ADVICE = '<p class="note">Information only, not investment advice. Data: Yahoo Finance (delayed, unofficial).</p>';

// ---------- heatmap (squarified treemap) ----------
function squarify(items, x, y, w, h) {                  // items: [{ v }] sorted by v descending
  const scale = (w * h) / items.reduce((a, i) => a + i.v, 0), out = [];
  const worst = (row, sum, side) => { const a = sum * scale, mx = row[0].v * scale, mn = row[row.length - 1].v * scale; return Math.max(side * side * mx / (a * a), a * a / (side * side * mn)); };
  let rest = items.slice();
  while (rest.length) {
    const side = Math.min(w, h); let row = [], sum = 0, best = Infinity;
    for (const it of rest) { const t = row.concat(it), s = sum + it.v, wr = worst(t, s, side); if (row.length && wr > best) break; row = t; sum = s; best = wr; }
    rest = rest.slice(row.length);
    const area = sum * scale; let off = 0;
    if (w >= h) { const cw = area / h; for (const it of row) { const ih = it.v * scale / cw; out.push({ it, x, y: y + off, w: cw, h: ih }); off += ih; } x += cw; w -= cw; }
    else { const rh = area / w; for (const it of row) { const iw = it.v * scale / rh; out.push({ it, x: x + off, y, w: iw, h: rh }); off += iw; } y += rh; h -= rh; }
  }
  return out;
}
const MAPS = { changePct: ['Today', 0.03, (r) => r.changePct / 100], vs50: ['vs 50-day', 0.12, (r) => r.vs50], vs200: ['vs 200-day', 0.25, (r) => r.vs200] };
const heat = (v, cap) => {                               // red <-> grey <-> green
  if (!isN(v)) return '#30363d'; const t = Math.min(Math.abs(v) / cap, 1), a = v >= 0 ? [35, 134, 54] : [218, 54, 51], b = [48, 54, 61];
  return `rgb(${a.map((c, i) => Math.round(b[i] + (c - b[i]) * (0.25 + 0.75 * t))).join(',')})`;
};
let heatBy = 'changePct';
async function heatmapPage(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const rows = (await ensureHome()).filter((r) => isN(r.marketCap) && !r.watch);
  const draw = () => {
    const [label, cap, f] = MAPS[heatBy], box = $('#hm'), W = box.clientWidth, H = box.clientHeight;
    const items = rows.map((r) => ({ v: r.marketCap, r })).sort((a, b) => b.v - a.v);
    box.innerHTML = squarify(items, 0, 0, W, H).map(({ it, x, y, w, h }) => {
      const v = f(it.r), small = w < 60 || h < 38;
      return `<a href="#/${esc(it.r.symbol)}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${heat(v, cap)}" title="${esc(it.r.name || '')} · ${big(it.r.marketCap)} · ${label}: ${isN(v) ? pc(v * 100, 1) : '—'}">
        <b style="font-size:${small ? 10 : Math.min(18, Math.max(12, w / 6))}px">${esc(it.r.symbol)}</b>${small ? '' : `<div style="font-size:11px">${isN(v) ? pc(v * 100, 1) : '—'}</div>`}</a>`;
    }).join('');
  };
  el.innerHTML = pageHead('Heatmap', `The top ${rows.length} companies. Box size is market cap; color shows the move. Click a box to open the stock.`) +
    `<div class="toolbar">${Object.entries(MAPS).map(([k, [l]]) => `<button class="chip ${k === heatBy ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}<span class="muted" style="font-size:12px">green = up / above, red = down / below</span></div><div class="hm" id="hm"></div>` + NOT_ADVICE;
  el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { heatBy = b.dataset.k; el.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  draw(); window.onresize = () => { if ($('#hm')) draw(); };
}

// ---------- earnings calendar ----------
async function calendarPage(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const now = Date.now(), rows = (await ensureHome()).filter((r) => r.earningsTs && r.earningsTs * 1000 > now - 864e5 && r.earningsTs * 1000 < now + 45 * 864e5)
    .filter((r, i, a) => a.findIndex((x) => x.symbol === r.symbol) === i).sort((a, b) => a.earningsTs - b.earningsTs);
  const weekOf = (ts) => { const d = new Date(ts * 1000), day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const weeks = new Map(); rows.forEach((r) => { const k = weekOf(r.earningsTs); (weeks.get(k) || weeks.set(k, []).get(k)).push(r); });
  const mine = new Set(wl.get().map((w) => w.s));
  el.innerHTML = pageHead('Earnings calendar', `${rows.length} companies report in the next 45 days. Results can move a stock sharply, so check here before you act on a signal. ★ = on your watchlist.`) +
    ([...weeks].map(([k, list]) => `<div class="card scroll"><h3>Week of ${new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</h3><table><thead><tr><th class="l">Date</th><th class="l">Company</th><th>Price</th><th>1D</th><th>EPS TTM</th><th>EPS fwd</th><th>Analysts</th></tr></thead><tbody>${list.map((r) => {
      const d = Math.ceil((r.earningsTs * 1000 - now) / 864e5);
      return `<tr class="row" data-s="${esc(r.symbol)}"><td class="l">${new Date(r.earningsTs * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} <span class="muted">${d <= 0 ? '(today)' : '(' + d + 'd)'}</span></td><td class="l"><span class="sym">${mine.has(r.symbol) ? '★ ' : ''}${esc(r.symbol)}</span><span class="nm">${esc(r.name || '')}</span></td><td>${nf(r.price)}</td><td class="${cls(r.changePct)}">${pc(r.changePct)}</td><td>${nf(r.eps)}</td><td>${nf(r.epsForward)}</td><td>${esc((r.rating || '—').replace(/^\d+(\.\d+)?\s*-\s*/, ''))}</td></tr>`;
    }).join('')}</tbody></table></div>`).join('') || '<div class="card muted">No earnings dates in the next 45 days.</div>') + '<p class="note">Dates come from Yahoo and can shift; companies confirm them shortly before reporting.</p>' + NOT_ADVICE;
  el.querySelectorAll('tr.row').forEach((tr) => tr.onclick = () => location.hash = '#/' + tr.dataset.s);
}

// ---------- compare ----------
const CMP_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f778ba'];
async function comparePage(el, arg) {
  const syms = [...new Set((arg || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 4);
  const set = (list) => { location.hash = '#/~compare/' + list.join(','); };
  el.innerHTML = pageHead('Compare stocks', 'Pick up to four stocks to see them side by side.') +
    `<div class="toolbar"><input id="cin" class="chip" style="cursor:text;min-width:160px" placeholder="Add a ticker, e.g. AAPL"><button class="chip" id="cadd">Add</button>${syms.map((s, i) => `<button class="chip on" data-rm="${s}" style="background:${CMP_COLORS[i]};border-color:${CMP_COLORS[i]}">${esc(s)} ✕</button>`).join('')}</div><div id="cbody"></div>`;
  const add = () => { const v = $('#cin').value.trim().toUpperCase(); if (v && syms.length < 4 && !syms.includes(v)) set([...syms, v]); };
  $('#cadd').onclick = add; $('#cin').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => set(syms.filter((s) => s !== b.dataset.rm)));
  const body = $('#cbody');
  if (syms.length < 2) { body.innerHTML = '<div class="card muted">Add at least two tickers. Try AAPL, MSFT and NVDA.</div>'; return; }
  body.innerHTML = '<div class="loading">Loading…</div>';
  const got = await Promise.all(syms.map(async (sym) => {
    const [s, c, g] = await Promise.allSettled([api('/api/stock/' + sym), api('/api/chart/' + sym + '?range=1y'), STATIC ? Promise.reject() : getSignal(sym)]);
    return { sym, s: s.value, c: c.value, g: g.value };
  }));
  const ok = got.filter((x) => x.s);
  const row = (label, f, hi) => `<tr><td class="l">${label}</td>${ok.map((x) => `<td>${f(x.s, x) ?? '—'}</td>`).join('')}</tr>`;
  const pct1 = (v) => isN(v) ? pct(v) : '—', up = (s) => isN(s.financialData?.targetMeanPrice) && isN(s.price?.regularMarketPrice) ? s.financialData.targetMeanPrice / s.price.regularMarketPrice - 1 : null;
  body.innerHTML = `<div class="card"><h3>1-year performance (all start at 100)</h3><div id="cchart" style="height:340px"></div></div>
    <div class="card scroll"><table><thead><tr><th class="l"></th>${ok.map((x, i) => `<th style="color:${CMP_COLORS[syms.indexOf(x.sym)]}">${esc(x.sym)}</th>`).join('')}</tr></thead><tbody>
      ${row('Company', (s) => esc(s.price?.shortName || ''))}${row('Price', (s) => usd(s.price?.regularMarketPrice))}${row('Today', (s) => `<span class="${cls(s.price?.regularMarketChangePercent)}">${pc((s.price?.regularMarketChangePercent ?? NaN) * 100)}</span>`)}
      ${row('Market cap', (s) => big(s.price?.marketCap))}${row('P/E (TTM)', (s) => nf(s.summaryDetail?.trailingPE, 1))}${row('Forward P/E', (s) => nf(s.summaryDetail?.forwardPE, 1))}${row('PEG', (s) => nf(s.defaultKeyStatistics?.pegRatio))}
      ${row('EPS TTM / forward', (s) => `${usd(s.defaultKeyStatistics?.trailingEps)} / ${usd(s.defaultKeyStatistics?.forwardEps)}`)}${row('Revenue growth', (s) => pct1(s.financialData?.revenueGrowth))}${row('Gross margin', (s) => pct1(s.financialData?.grossMargins))}
      ${row('Net margin', (s) => pct1(s.financialData?.profitMargins))}${row('Return on equity', (s) => pct1(s.financialData?.returnOnEquity))}${row('Debt / equity', (s) => nf(s.financialData?.debtToEquity, 0))}${row('Dividend yield', (s) => pct1(s.summaryDetail?.dividendYield))}
      ${row('vs 50-day average', (s) => { const v = s.price?.regularMarketPrice / s.summaryDetail?.fiftyDayAverage - 1; return isN(v) ? `<span class="${cls(v)}">${pc(v * 100, 1)}</span>` : '—'; })}
      ${row('vs 200-day average', (s) => { const v = s.price?.regularMarketPrice / s.summaryDetail?.twoHundredDayAverage - 1; return isN(v) ? `<span class="${cls(v)}">${pc(v * 100, 1)}</span>` : '—'; })}
      ${row('Analyst rating', (s) => esc((s.financialData?.recommendationKey || '—').replace('_', ' ')))}${row('Target upside', (s) => isN(up(s)) ? `<span class="${cls(up(s))}">${pc(up(s) * 100, 1)}</span>` : '—')}
      ${row('Buy-setup signal', (s, x) => x.g ? `${verdictChip(x.g.verdict)} <span class="muted">${x.g.score}/100</span>` : '—')}</tbody></table></div>${NOT_ADVICE}`;
  if (window.LightweightCharts) {
    const chart = LightweightCharts.createChart($('#cchart'), { autoSize: true, layout: { background: { color: 'transparent' }, textColor: getComputedStyle(document.documentElement).getPropertyValue('--mute').trim() }, grid: { vertLines: { color: 'transparent' }, horzLines: { color: getComputedStyle(document.documentElement).getPropertyValue('--line').trim() } } });
    got.forEach((x) => {
      const pts = (x.c?.candles || []).map((b) => [Math.floor(b.t / 1000), b.c]); if (!pts.length) return;
      const seen = new Set(), data = pts.filter(([t]) => !seen.has(t) && seen.add(t)).map(([t, v]) => ({ time: t, value: v / pts[0][1] * 100 }));
      chart.addLineSeries({ color: CMP_COLORS[syms.indexOf(x.sym)], lineWidth: 2, title: x.sym, priceLineVisible: false }).setData(data);
    });
    chart.timeScale().fitContent();
  }
}

// ---------- portfolio (kept in this browser; the app never trades) ----------
const port = {
  get() { try { return JSON.parse(localStorage.getItem('se.port')) || []; } catch { return []; } },
  set(v) { try { localStorage.setItem('se.port', JSON.stringify(v)); } catch {} },
};
async function portfolioPage(el) {
  const draw = async () => {
    const list = port.get(); let px = {};
    if (list.length) { try { (STATIC ? await ensureHome() : await api('/api/quotes?symbols=' + list.map((h) => h.s).join(','))).forEach((q) => px[q.symbol] = q); } catch {} }
    const rows = list.map((h) => { const p = px[h.s]?.price, val = isN(p) ? p * h.shares : null, cost = h.cost * h.shares; return { ...h, p, val, cost, pl: isN(val) ? val - cost : null, day: isN(val) && isN(px[h.s]?.changePct) ? val - val / (1 + px[h.s].changePct / 100) : null }; });
    const tv = rows.reduce((a, r) => a + (r.val ?? 0), 0), tc = rows.reduce((a, r) => a + r.cost, 0), td = rows.reduce((a, r) => a + (r.day ?? 0), 0);
    $('#pbody').innerHTML = rows.length ? `<div class="grid" style="margin-bottom:14px">${kpi('Value', usd(tv, 0))}${kpi('Cost', usd(tc, 0))}${kpi('Profit / loss', `<span class="${cls(tv - tc)}">${usd(tv - tc, 0)}</span>`, tc ? pc((tv / tc - 1) * 100, 1) : '')}${kpi('Today', `<span class="${cls(td)}">${usd(td, 0)}</span>`)}</div>
      <div class="card scroll" style="padding:0"><table><thead><tr><th class="l">Stock</th><th>Shares</th><th>Cost / share</th><th>Price</th><th>Value</th><th>Profit / loss</th><th>Weight</th><th>Signal</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr class="row" data-s="${esc(r.s)}"><td class="l"><span class="sym">${esc(r.s)}</span></td><td>${nf(r.shares, 2)}</td><td>${usd(r.cost / r.shares)}</td><td>${usd(r.p)}</td><td>${isN(r.val) ? usd(r.val, 0) : '—'}</td><td class="${cls(r.pl)}">${isN(r.pl) ? usd(r.pl, 0) + ' (' + pc(r.pl / r.cost * 100, 1) + ')' : '—'}</td>
        <td><span class="bar" style="width:80px" title="${tv ? Math.round((r.val ?? 0) / tv * 100) : 0}%"><i style="left:0;width:${tv ? (r.val ?? 0) / tv * 100 : 0}%;background:var(--accent);top:-3px;height:12px"></i></span> ${tv ? Math.round((r.val ?? 0) / tv * 100) : 0}%</td><td id="sg-${esc(r.s)}" class="muted">…</td><td><button class="star" data-rm="${esc(r.s)}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="card muted">No holdings yet. Add one above. Nothing leaves this computer.</div>';
    $('#pbody').querySelectorAll('tr.row').forEach((tr) => tr.onclick = () => location.hash = '#/' + tr.dataset.s);
    $('#pbody').querySelectorAll('[data-rm]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); port.set(port.get().filter((h) => h.s !== b.dataset.rm)); draw(); });
    if (!STATIC) rows.forEach((r) => getSignal(r.s).then((g) => { const c = document.getElementById('sg-' + r.s); if (c) c.innerHTML = verdictChip(g.verdict) + ` <span class="muted">${g.score}</span>`; }).catch(() => { const c = document.getElementById('sg-' + r.s); if (c) c.textContent = '—'; }));
  };
  el.innerHTML = pageHead('Portfolio', 'Track what you own. It is saved only in this browser, and this app never buys or sells anything.') +
    `<div class="toolbar"><input id="ps" class="chip" style="cursor:text;width:110px" placeholder="Ticker"><input id="pn" class="chip" style="cursor:text;width:110px" type="number" min="0" step="any" placeholder="Shares"><input id="pc" class="chip" style="cursor:text;width:140px" type="number" min="0" step="any" placeholder="Cost per share $"><button class="chip" id="padd">Add holding</button></div><div id="pbody"></div>` + NOT_ADVICE;
  $('#padd').onclick = () => {
    const s = $('#ps').value.trim().toUpperCase(), n = parseFloat($('#pn').value), c = parseFloat($('#pc').value);
    if (!/^[\w.\-^=]{1,12}$/.test(s) || !(n > 0) || !(c >= 0)) { toast('Enter a ticker, a number of shares, and your cost per share.'); return; }
    const l = port.get(), h = l.find((x) => x.s === s);
    if (h) { h.cost = (h.cost * h.shares + c * n) / (h.shares + n); h.shares += n; } else l.push({ s, shares: n, cost: c });   // adding to a holding averages the cost
    port.set(l); ['#ps', '#pn', '#pc'].forEach((i) => $(i).value = ''); draw();
  };
  draw();
}

// ---------- strategy lab ----------
async function labPage(el) {
  el.innerHTML = pageHead('Strategy lab', 'Compares six price-based rules over the last 5 years on the top 100 stocks. Each shows the average return after the rule fires, against buying on any random day.') +
    (STATIC ? '<div class="card muted">The lab needs the local app (it runs the backtests on the server).</div>' : '<div class="toolbar"><button class="chip" id="labgo">Run the lab (takes about 30 seconds)</button></div><div id="labout"></div>') + NOT_ADVICE;
  if (STATIC) return;
  $('#labgo').onclick = async () => {
    const btn = $('#labgo'); btn.disabled = true;
    const out = $('#labout'), syms = [...new Set((await ensureHome()).map((r) => r.symbol))], pooled = {}, now = {}; let i = 0, done = 0;
    const worker = async () => {
      while (i < syms.length) {
        const sym = syms[i++];
        try {
          const { presets } = await api(`/api/backtest/${encodeURIComponent(sym)}?all=1`);
          if (presets) { done++; now[sym] = Object.fromEntries(Object.entries(presets).map(([k, r]) => [k, r.nowInSetup])); for (const [k, r] of Object.entries(presets)) { const P = pooled[k] ||= { name: r.name, about: r.about, h: {} };
            for (const h of [21, 63, 126]) { const t = P.h[h] ||= { signal: { n: 0, sum: 0, wins: 0 }, all: { n: 0, sum: 0, wins: 0 } }; for (const w of ['signal', 'all']) { const x = r.horizons[h][w]; t[w].n += x.n; t[w].sum += x.sum; t[w].wins += x.wins; } } } }
        } catch { /* skip */ }
        out.innerHTML = `<div class="muted">Running… ${i} of ${syms.length}</div>`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]); btn.disabled = false;
    const avg = (x) => x.n ? x.sum / x.n : null, rows = Object.entries(pooled).map(([k, P]) => { const s3 = P.h[63].signal, a3 = P.h[63].all, s6 = P.h[126].signal, a6 = P.h[126].all;
      return { k, P, d3: avg(s3) - avg(a3), d6: avg(s6) - avg(a6), a3: avg(s3), a6: avg(s6), w3: s3.n ? s3.wins / s3.n : null, n: s3.n, base3: avg(a3), base6: avg(a6) }; }).sort((a, b) => b.d3 - a.d3);
    out.innerHTML = `<div class="muted" style="margin:6px 0">${done} stocks tested. Sorted by the 3-month difference vs buying on any day.</div><div class="card scroll"><table><thead><tr><th class="l">Rule</th><th class="l">What it requires</th><th>Avg after 3 mo</th><th>vs any day</th><th>Win rate</th><th>Avg after 6 mo</th><th>vs any day</th><th>Samples</th></tr></thead><tbody>${rows.map((r) =>
      `<tr><td class="l"><b>${esc(r.P.name)}</b></td><td class="l muted" style="white-space:normal;max-width:300px">${esc(r.P.about)}</td><td class="${cls(r.a3)}">${pc(r.a3 * 100, 1)}</td><td class="${cls(r.d3)}"><b>${pc(r.d3 * 100, 1)}</b></td><td>${r.w3 == null ? '—' : Math.round(r.w3 * 100) + '%'}</td><td class="${cls(r.a6)}">${pc(r.a6 * 100, 1)}</td><td class="${cls(r.d6)}"><b>${pc(r.d6 * 100, 1)}</b></td><td class="muted">${r.n.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
      <p class="note"><b>Read this carefully.</b> Picking the best of six rules after seeing the results is "data mining": the winner may just be lucky and can fail going forward. These are today's biggest companies (survivorship bias), samples on nearby days overlap, costs and taxes are ignored, and analyst/news rules can't be tested. Past results don't predict future returns.</p>
      <div id="matches"></div>`;
    renderMatches($('#matches'), rows, now);
  };
}

// What could move a stock: bullish and bearish things pulled from its news, analysts, earnings and short interest.
function catalysts(s) {
  const bull = [], bear = [], news = s.news || [], px = s.price?.regularMarketPrice, fd = s.financialData || {}, ks = s.defaultKeyStatistics || {}, now = Date.now();
  const link = (n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">· ${esc(n.source || '')}${n.ts ? ' · ' + ago(n.ts) : ''}</span>`;
  news.filter((n) => n.sentiment === 'pos').slice(0, 2).forEach((n) => bull.push(link(n)));
  news.filter((n) => n.sentiment === 'neg').slice(0, 2).forEach((n) => bear.push(link(n)));
  const acts = (s.upgradeDowngradeHistory?.history || []).filter((h) => h.epochGradeDate && now - h.epochGradeDate * 1000 <= 30 * 864e5);
  const ups = acts.filter((h) => h.action === 'up'), downs = acts.filter((h) => h.action === 'down');
  if (ups.length) bull.push(`${ups.length} analyst upgrade${ups.length > 1 ? 's' : ''} in the last 30 days (${ups.slice(0, 2).map((h) => esc(h.firm)).join(', ')})`);
  if (downs.length) bear.push(`${downs.length} analyst downgrade${downs.length > 1 ? 's' : ''} in the last 30 days (${downs.slice(0, 2).map((h) => esc(h.firm)).join(', ')})`);
  const up = isN(fd.targetMeanPrice) && isN(px) ? fd.targetMeanPrice / px - 1 : null;
  if (isN(up) && up >= 0.15) bull.push(`Analysts' average target is ${pc(up * 100, 0)} above the price`);
  if (isN(up) && up < 0) bear.push(`Price is already above analysts' average target (${pc(up * 100, 0)})`);
  const eg = isN(ks.forwardEps) && ks.trailingEps > 0 ? ks.forwardEps / ks.trailingEps - 1 : null;
  if (isN(eg) && eg >= 0.10) bull.push(`Earnings expected to grow ${pc(eg * 100, 0)} (forward vs trailing EPS)`);
  if (isN(eg) && eg < 0) bear.push(`Earnings expected to shrink ${pc(eg * 100, 0)} (forward vs trailing EPS)`);
  if (isN(fd.revenueGrowth) && fd.revenueGrowth >= 0.10) bull.push(`Revenue growing ${pct(fd.revenueGrowth)}`);
  if (isN(fd.revenueGrowth) && fd.revenueGrowth < 0) bear.push(`Revenue shrinking ${pct(fd.revenueGrowth)}`);
  const ets = (s.calendarEvents?.earnings?.earningsDate || [])[0], d = ets ? Math.ceil((ets * 1000 - now) / 864e5) : null;
  if (isN(d) && d >= 0 && d <= 14) bear.push(`Earnings in ${d} day${d === 1 ? '' : 's'}: results can move it sharply either way`);
  if (isN(ks.shortPercentOfFloat) && ks.shortPercentOfFloat > 0.10) bear.push(`${pct(ks.shortPercentOfFloat)} of the float is sold short`);
  const np = s.netSharePurchaseActivity || {};
  if (isN(np.netInfoShares) && np.netInfoShares > 0 && (np.buyInfoCount ?? 0) >= 2) bull.push(`Insiders net buyers (${np.buyInfoCount} buys in 6 months)`);
  return { bull, bear };
}

// Stocks that match a rule *today*, ranked by their Buy-setup score, each with what could move it.
async function renderMatches(box, rows, now) {
  const draw = async (key) => {
    const P = rows.find((r) => r.k === key), hits = Object.keys(now).filter((sym) => now[sym][key]);
    const body = $('#mbody', box); body.innerHTML = `<div class="loading">Checking ${hits.length} stocks…</div>`;
    const info = (await Promise.all(hits.map(async (sym) => {
      const [g, s] = await Promise.allSettled([getSignal(sym), api('/api/stock/' + encodeURIComponent(sym))]);
      return g.value && s.value ? { sym, g: g.value, s: s.value } : null;
    }))).filter(Boolean).sort((a, b) => b.g.score - a.g.score);
    if (box.dataset.key !== key) return;                                   // user switched rules while loading
    body.innerHTML = `<div class="muted" style="margin-bottom:8px">${info.length} of the top stocks match <b>${esc(P.P.name)}</b> today (${esc(P.P.about)}). Ranked by Buy-setup score, which blends analysts, news, trend and fundamentals.</div>` +
      (info.map(({ sym, g, s }) => { const c = catalysts(s), p = s.price || {};
        return `<div class="card"><div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap"><a href="#/${esc(sym)}"><b style="font-size:18px">${esc(sym)}</b></a><span class="muted">${esc(p.shortName || '')}</span><span>${usd(p.regularMarketPrice)}</span><span class="${cls(p.regularMarketChangePercent)}">${pc((p.regularMarketChangePercent ?? NaN) * 100)}</span>${verdictChip(g.verdict)}<span class="muted">score ${g.score}/100</span>${earnWarn(s)}</div>
          <div class="two" style="margin-top:10px"><div><h3 style="color:var(--up)">▲ Could push it up</h3>${c.bull.length ? `<ul class="news">${c.bull.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<span class="muted">Nothing obvious</span>'}</div>
          <div><h3 style="color:var(--down)">▼ Could push it down</h3>${c.bear.length ? `<ul class="news">${c.bear.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<span class="muted">Nothing obvious</span>'}</div></div></div>`; }).join('') || '<div class="card muted">No stocks match this rule right now.</div>');
  };
  box.innerHTML = `<h2 style="margin:18px 0 4px">Matching right now</h2><div class="muted" style="margin-bottom:10px">Pick a rule to see which stocks fit it today, and what could move each one. The best-ranked rule is selected first.</div>
    <div class="toolbar">${rows.map((r, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-key="${r.k}">${esc(r.P.name)}</button>`).join('')}</div><div id="mbody"></div>
    <p class="note">A rule that worked in the past is not a promise: a stock matching it today is a candidate to research, not a recommendation. Headlines are scored by their wording only and can be wrong or already priced in. Information only, not investment advice.</p>`;
  const pick = (key) => { box.dataset.key = key; box.querySelectorAll('[data-key]').forEach((b) => b.classList.toggle('on', b.dataset.key === key)); draw(key); };
  box.querySelectorAll('[data-key]').forEach((b) => b.onclick = () => pick(b.dataset.key));
  pick(rows[0].k);
}

// ---------- dividends ----------
let divMin = 0;
async function dividendsPage(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const rows = (await ensureHome()).filter((r) => isN(r.divYield) && r.divYield > 0).filter((r, i, a) => a.findIndex((x) => x.symbol === r.symbol) === i).sort((a, b) => b.divYield - a.divYield);
  const draw = () => {
    const list = rows.filter((r) => r.divYield * 100 >= divMin);
    $('#dtbl').innerHTML = `<thead><tr><th class="l">Company</th><th>Price</th><th>Dividend / share (yr)</th><th>Yield</th><th>Income per $10,000</th><th>Next payment</th><th>1D</th></tr></thead><tbody>${list.map((r) => `<tr class="row" data-s="${esc(r.symbol)}"><td class="l"><span class="sym">${esc(r.symbol)}</span><span class="nm">${esc(r.name || '')}</span></td><td>${nf(r.price)}</td><td>${isN(r.divRate) ? usd(r.divRate) : '—'}</td><td><b>${pct(r.divYield)}</b></td><td>${usd(r.divYield * 10000, 0)}</td><td>${r.divDate ? date(r.divDate) : '—'}</td><td class="${cls(r.changePct)}">${pc(r.changePct)}</td></tr>`).join('')}</tbody>`;
    $('#dtbl').querySelectorAll('tr.row').forEach((tr) => tr.onclick = () => location.hash = '#/' + tr.dataset.s);
  };
  el.innerHTML = pageHead('Dividends', `${rows.length} of the top companies pay a dividend. A very high yield can be a warning sign (the price may have fallen, or the dividend may be cut), so check the company before relying on it.`) +
    `<div class="toolbar">${[[0, 'All'], [1, 'Yield 1%+'], [2, 'Yield 2%+'], [3, 'Yield 3%+'], [4, 'Yield 4%+']].map(([v, l]) => `<button class="chip ${v === divMin ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div><div class="card scroll" style="padding:0"><table id="dtbl"></table></div>` + NOT_ADVICE;
  el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { divMin = +b.dataset.v; el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  draw();
}

// ---------- AI stocks (the AI supply chain, grouped) ----------
let aiSort = 'marketCap';
async function aiPage(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  await ensureHome();
  const groups = home.ai || [], all = groups.flatMap((g) => g.rows), upN = all.filter((r) => r.changePct > 0).length;
  const avg = (rs) => { const v = rs.map((r) => r.changePct).filter(isN); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const SORTS = { marketCap: 'Market cap', changePct: 'Today', vs50: 'vs 50-day', vs200: 'vs 200-day', forwardPE: 'Fwd P/E' };
  const sig = new Map();                                         // symbol -> signal, filled by the scan button
  const draw = () => {
    $('#aibody').innerHTML = groups.map((g) => {
      const rows = g.rows.slice().sort((a, b) => aiSort === 'forwardPE' ? (a[aiSort] > 0 ? a[aiSort] : 1e9) - (b[aiSort] > 0 ? b[aiSort] : 1e9) : (b[aiSort] ?? -1e9) - (a[aiSort] ?? -1e9)), a = avg(rows);
      return `<div class="card scroll"><h3>${esc(g.group)} <span class="muted" style="text-transform:none;letter-spacing:0">· average today <span class="${cls(a)}">${pc(a)}</span></span></h3><table><thead><tr><th class="l">Company</th><th>Price</th><th>1D</th><th>Mkt cap</th><th>P/E</th><th>Fwd P/E</th><th>Fwd EPS Δ</th><th>vs 50-day</th><th>vs 200-day</th><th>Analysts</th><th>Signal</th></tr></thead><tbody>${rows.map((r) => {
        const s = sig.get(r.symbol);
        return `<tr class="row" data-s="${esc(r.symbol)}"><td class="l"><span class="sym">${esc(r.symbol)}</span><span class="nm">${esc(r.name || '')}</span></td><td>${nf(r.price)}</td><td class="${cls(r.changePct)}">${pc(r.changePct)}</td><td>${big(r.marketCap)}</td><td>${r.pe > 0 ? nf(r.pe, 1) : 'n/m'}</td><td>${r.forwardPE > 0 ? nf(r.forwardPE, 1) : 'n/m'}</td>
          <td class="${cls(r.epsGrowth)}">${isN(r.epsGrowth) ? pc(r.epsGrowth * 100, 0) : '—'}</td><td class="${cls(r.vs50)}">${isN(r.vs50) ? pc(r.vs50 * 100, 1) : '—'}</td><td class="${cls(r.vs200)}">${isN(r.vs200) ? pc(r.vs200 * 100, 1) : '—'}</td>
          <td>${esc((r.rating || '—').replace(/^\d+(\.\d+)?\s*-\s*/, ''))}</td><td>${s ? verdictChip(s.verdict) + ' <span class="muted">' + s.score + '</span>' : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>`;
    }).join('') || '<div class="card muted">No AI stock data available.</div>';
    $('#aibody').querySelectorAll('tr.row').forEach((tr) => tr.onclick = () => location.hash = '#/' + tr.dataset.s);
  };
  el.innerHTML = pageHead('AI stocks', `${all.length} companies across the AI supply chain, from chips to power. ${upN} of ${all.length} are up today.`) +
    `<div class="toolbar">Sort by: ${Object.entries(SORTS).map(([k, l]) => `<button class="chip ${k === aiSort ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}${STATIC ? '' : '<button class="chip" id="aiscan" style="margin-left:auto">Score all with the Buy-setup checklist</button>'}<span class="muted" id="aiprog"></span></div><div id="aibody"></div>
    <p class="note">AI stocks tend to move together and swing hard, so a group like this is concentrated risk, not diversification. The "Signal" column is a checklist (analysts, news, trend, fundamentals), not a prediction. Information only, not investment advice.</p>`;
  el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { aiSort = b.dataset.k; el.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  if ($('#aiscan')) $('#aiscan').onclick = async () => {
    const btn = $('#aiscan'), syms = all.map((r) => r.symbol); let i = 0, n = 0; btn.disabled = true;
    const worker = async () => { while (i < syms.length) { const s = syms[i++]; try { sig.set(s, await getSignal(s)); } catch {} $('#aiprog').textContent = `Scoring ${++n} of ${syms.length}…`; } };
    await Promise.all([worker(), worker(), worker(), worker()]); btn.disabled = false;
    const buys = [...sig.values()].filter((x) => x.verdict === 'buy').map((x) => x.symbol);
    $('#aiprog').textContent = `Done: ${buys.length} Buy setup${buys.length === 1 ? '' : 's'}${buys.length ? ' (' + buys.join(', ') + ')' : ''}`; draw();
  };
  draw();
}

const EXTRA_PAGES = { ai: aiPage, heatmap: heatmapPage, calendar: calendarPage, compare: comparePage, portfolio: portfolioPage, lab: labPage, dividends: dividendsPage };
