// Stock-page analysis tabs (Valuation, Peers, Earnings history) and the Creator views page.
// Loaded before the main script; everything runs later, when the helpers in index.html exist.

const median = (a) => { const s = a.filter(isN).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const A_NOTE = '<p class="note">Rough models built from public data (Yahoo Finance). They depend heavily on assumptions and can be badly wrong. Information only, not investment advice.</p>';

// ---------- creator views (typed in by you, with a source link; stored in this browser) ----------
const views = {
  get() { try { return JSON.parse(localStorage.getItem('se.views')) || []; } catch { return []; } },
  set(v) { try { localStorage.setItem('se.views', JSON.stringify(v)); } catch {} },
};
// Views I found and checked in public videos, shipped as a file (each has a link and what exactly it is based on).
let _researched; const researchedViews = () => _researched ||= fetch('researched-views.json').then((r) => r.ok ? r.json() : []).then((a) => a.map((v, i) => ({ ...v, id: 'r' + i, ro: true }))).catch(() => []);
const STANCES = { buy: ['Buy / bullish', 'var(--up)'], hold: ['Hold / neutral', 'var(--warn)'], overvalued: ['Overvalued / avoid', 'var(--down)'] };

// ---------- Valuation tab ----------
function dcfValue({ fcf, g, r, tg, shares, netCash }) {      // 10-year cash-flow model: growth g for 5 years, fading to tg, then a terminal value
  if (!(fcf > 0) || !(shares > 0) || r <= tg) return null;
  let cf = fcf, pv = 0;
  for (let y = 1; y <= 10; y++) { cf *= 1 + (y <= 5 ? g : g + (tg - g) * (y - 5) / 5); pv += cf / Math.pow(1 + r, y); }
  pv += (cf * (1 + tg) / (r - tg)) / Math.pow(1 + r, 10);
  return (pv + (netCash || 0)) / shares;
}

async function valuationView(el, s) {
  const $ = (sel, r = el) => r.querySelector(sel);           // look only inside this pane, so a slow load can't write into another stock's page
  const p = s.price || {}, fd = s.financialData || {}, ks = s.defaultKeyStatistics || {}, px = p.regularMarketPrice;
  const fcf = fd.freeCashflow, shares = ks.sharesOutstanding, netCash = isN(fd.totalCash) && isN(fd.totalDebt) ? fd.totalCash - fd.totalDebt : 0;
  const yr = (s.earningsTrend?.trend || []).find((t) => t.period === '+1y'), gGuess = yr?.earningsEstimate?.growth ?? fd.revenueGrowth ?? 0.08;
  const g0 = Math.min(0.25, Math.max(0, +gGuess)), state = { g: g0, r: 0.09, tg: 0.03 };
  el.innerHTML = '<div class="loading">Building the valuation…</div>';
  const researched = await researchedViews();
  // Price at each past fiscal year-end, to find this stock's own typical P/E.
  let hist = [];
  try {
    const c = await api(`/api/chart/${s.symbol}?range=5y`), pts = c.points || [];
    const eps = (s.annual?.DilutedEPS || []).filter((x) => x.v > 0);
    hist = eps.map((x) => { const t = Date.parse(x.date); let q = null; for (const pt of pts) { if (pt[0] <= t + 7 * 864e5) q = pt; else break; } return q && q[0] > t - 30 * 864e5 ? { date: x.date.slice(0, 10), eps: x.v, price: q[1], pe: q[1] / x.v } : null; }).filter(Boolean);
  } catch { /* no history: the P/E method is skipped */ }
  const rawPE = hist.length >= 3 ? median(hist.map((h) => h.pe)) : null, ttmEps = ks.trailingEps;
  const peOk = isN(rawPE) && rawPE >= 5 && rawPE <= 100, medPE = peOk ? rawPE : null;     // a past P/E of 280× (tiny early profits) says nothing about fair value

  const draw = () => {
    const methods = [];
    if (isN(fd.targetMeanPrice)) methods.push({ name: 'Analyst average target', v: fd.targetMeanPrice, note: `${fd.numberOfAnalystOpinions ?? '?'} analysts, range ${usd(fd.targetLowPrice, 0)} – ${usd(fd.targetHighPrice, 0)}` });
    if (isN(medPE) && ttmEps > 0) methods.push({ name: 'Own typical P/E × current EPS', v: medPE * ttmEps, note: `median P/E ${nf(medPE, 1)} over ${hist.length} fiscal years × EPS ${usd(ttmEps)}` });
    const d = dcfValue({ fcf, g: state.g, r: state.r, tg: state.tg, shares, netCash });
    const dcfNote = `growth ${pct(state.g, 0)} for 5 yrs, fading to ${pct(state.tg, 1)}; discount ${pct(state.r, 1)}`;
    if (isN(ks.forwardEps) && ks.forwardEps > 0) methods.push({ name: 'Forward EPS × 20 (market-style multiple)', v: ks.forwardEps * 20, note: `forward EPS ${usd(ks.forwardEps)}; 20× is a rough market average, not a rule` });
    // The cash-flow model only counts when it is in the same ballpark as the other methods. Today's free cash flow can be
    // far below normal (for example during a heavy investment phase), and then the model is misleading, so it is shown but left out.
    const others = median(methods.map((m) => m.v));
    if (isN(d)) {
      const outlier = isN(others) && (d < others * 0.4 || d > others * 2.5);
      methods.push({ name: 'Cash-flow model (DCF)', v: d, note: dcfNote, excluded: outlier, why: outlier ? 'Left out of the summary: it is far from every other method. Current free cash flow is probably depressed or unusually high, which this simple model cannot handle.' : '' });
    }
    const counted = methods.filter((m) => !m.excluded), med = median(counted.map((m) => m.v)), gap = isN(med) && isN(px) ? px / med - 1 : null;
    const verdict = !isN(gap) ? ['Not enough data', 'var(--mute)'] : gap > 0.2 ? ['Looks expensive on these models', 'var(--down)'] : gap < -0.2 ? ['Looks cheap on these models', 'var(--up)'] : ['Roughly fairly valued on these models', 'var(--warn)'];
    const spread = counted.length > 1 ? Math.max(...counted.map((m) => m.v)) / Math.min(...counted.map((m) => m.v)) - 1 : null;
    const hi = Math.max(px || 0, ...counted.map((m) => m.v)) * 1.08, pos = (v) => Math.max(0, Math.min(100, v / hi * 100)) + '%';
    const mine = [...researched, ...views.get()].filter((v) => v.ticker === s.symbol.toUpperCase());
    $('#vbody').innerHTML = `<div class="card"><h3>Summary</h3><div style="display:flex;gap:18px;align-items:baseline;flex-wrap:wrap"><span class="price" style="color:${verdict[1]}">${verdict[0]}</span>${isN(gap) ? `<span class="muted">Price ${usd(px)} is ${pc(gap * 100, 0)} vs the middle estimate of ${usd(med)}</span>` : ''}</div>
        <div class="muted" style="font-size:13px;margin-top:6px">${counted.length} method${counted.length === 1 ? '' : 's'} counted${methods.length > counted.length ? ` (${methods.length - counted.length} shown but left out)` : ''}. ${isN(spread) ? `The highest estimate is ${Math.round(spread * 100)}% above the lowest: ${spread > 0.5 ? 'a wide spread, so low confidence.' : spread > 0.25 ? 'a moderate spread.' : 'they roughly agree.'}` : 'Too few methods to judge the spread.'}</div></div>
      <div class="card"><h3>Fair-value estimates vs price</h3><table><thead><tr><th class="l">Method</th><th>Fair value</th><th>Price vs it</th><th class="l" style="min-width:200px"></th></tr></thead><tbody>${methods.map((m) => {
        const dv = isN(px) ? px / m.v - 1 : null;
        return `<tr style="${m.excluded ? 'opacity:.55' : ''}"><td class="l">${esc(m.name)}${m.excluded ? ' <span class="tag news">left out</span>' : ''}<div class="muted" style="font-size:12px;white-space:normal;max-width:420px">${esc(m.note)}${m.why ? '<br>' + esc(m.why) : ''}</div></td><td><b>${usd(m.v)}</b></td><td class="${isN(dv) ? (dv > 0 ? 'down' : 'up') : ''}">${isN(dv) ? pc(dv * 100, 0) : '—'}</td>
          <td class="l"><div style="position:relative;height:14px;background:var(--line);border-radius:7px"><i style="position:absolute;left:${pos(m.v)};top:-2px;width:3px;height:18px;background:var(--accent);border-radius:2px" title="fair value"></i><i style="position:absolute;left:${pos(px)};top:-2px;width:3px;height:18px;background:var(--text);border-radius:2px" title="price"></i></div></td></tr>`; }).join('') || '<tr><td class="l muted">No usable data</td></tr>'}</tbody></table>
        <div class="note">Blue marker = the method's fair value, white marker = today's price. "Price vs it" above 0% means the price is higher than that estimate (looks expensive on that method).</div></div>
      <div class="card"><h3>Cash-flow model: change the assumptions</h3>${isN(dcfValue({ fcf, g: state.g, r: state.r, tg: state.tg, shares, netCash })) ? `<div class="alerts"><label>Growth (5 yrs) <input id="vg" type="number" step="1" value="${Math.round(state.g * 100)}"> %</label><label>Discount rate <input id="vr" type="number" step="0.5" value="${state.r * 100}"> %</label><label>Terminal growth <input id="vt" type="number" step="0.5" value="${state.tg * 100}"> %</label></div>
        <div class="grid">${kpi('Free cash flow (TTM)', big(fcf))}${kpi('Shares outstanding', big(shares).replace('$', ''))}${kpi('Net cash', big(netCash))}${kpi('Starting growth guess', pct(g0, 0), 'analyst estimates, capped 0–25%')}</div>
        <div class="note">The model projects free cash flow for 10 years, adds a terminal value, discounts it back, and divides by shares. Small changes to these three inputs change the answer a lot: try it. It starts from today's free cash flow, so it is unreliable for companies in a heavy investment phase or with unusually high or low cash flow right now.</div>` : '<span class="muted">Not available: the company has no positive free cash flow to project.</span>'}</div>
      ${hist.length ? `<div class="card scroll"><h3>This stock's own past P/E (price at each fiscal year-end ÷ that year's EPS)</h3><table><thead><tr><th class="l">Year-end</th><th>Price</th><th>EPS</th><th>P/E</th></tr></thead><tbody>${hist.map((h) => `<tr><td class="l">${h.date}</td><td>${usd(h.price)}</td><td>${usd(h.eps)}</td><td>${nf(h.pe, 1)}</td></tr>`).join('')}</tbody></table><div class="note">${hist.length < 3 ? 'Fewer than 3 usable years, so this method is skipped.' : !peOk ? `Median ${nf(rawPE, 1)} is outside the sensible 5–100 range (profits were tiny or the price extreme), so this method is skipped.` : `Median ${nf(medPE, 1)}. Today's P/E is ${nf(s.summaryDetail?.trailingPE, 1)}.`} GAAP EPS only; years with losses are left out.</div></div>` : ''}
      <div class="card"><h3>What people you follow think</h3>${mine.length ? `<table><thead><tr><th class="l">Who</th><th class="l">View</th><th>Their target</th><th>vs price</th><th class="l">Source</th></tr></thead><tbody>${mine.map((v) => `<tr><td class="l">${esc(v.who)}<div class="muted" style="font-size:12px">${esc(v.date || '')}${v.ro ? ' · researched' : ''}</div></td><td class="l" style="color:${STANCES[v.stance][1]}">${STANCES[v.stance][0]}${v.note ? `<div class="muted" style="font-size:12px;white-space:normal;max-width:360px">${esc(v.note)}</div>` : ''}</td><td>${isN(v.target) ? usd(v.target) : '—'}</td><td class="${cls(v.target / px - 1)}">${isN(v.target) && px ? pc((v.target / px - 1) * 100, 0) : '—'}</td><td class="l">${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener">link</a>` : '—'}</td></tr>`).join('')}</tbody></table>` : '<span class="muted">Nothing recorded for this stock yet. Add views on the <a href="#/~views">Creator views</a> page.</span>'}</div>`;
    const bind = (id, key, scale) => { const x = $(id); if (x) x.onchange = () => { const v = parseFloat(x.value) / 100; if (isFinite(v)) { state[key] = v; draw(); } }; };
    bind('#vg', 'g'); bind('#vr', 'r'); bind('#vt', 'tg');
  };
  el.innerHTML = `<div id="vbody"></div>${A_NOTE}`; draw();
}

// ---------- Peers tab ----------
const PEER_METRICS = [                                           // [key, label, formatter, "lower is better"]
  ['forwardPE', 'Forward P/E', (v) => nf(v, 1), true, (v) => v > 0], ['pe', 'P/E (TTM)', (v) => nf(v, 1), true, (v) => v > 0], ['peg', 'PEG', (v) => nf(v), true, (v) => v > 0], ['ps', 'Price / sales', (v) => nf(v, 1), true, (v) => v > 0],
  ['evEbitda', 'EV / EBITDA', (v) => nf(v, 1), true, (v) => v > 0], ['revGrowth', 'Revenue growth', (v) => pct(v), false], ['earnGrowth', 'Earnings growth', (v) => pct(v), false],
  ['grossMargin', 'Gross margin', (v) => pct(v), false], ['opMargin', 'Operating margin', (v) => pct(v), false], ['netMargin', 'Net margin', (v) => pct(v), false],
  ['roe', 'Return on equity', (v) => pct(v), false], ['debtEq', 'Debt / equity', (v) => nf(v, 0), true, (v) => v >= 0], ['upside', 'Upside to analyst target', (v) => pc(v * 100, 0), false], ['divYield', 'Dividend yield', (v) => pct(v), false],
];
async function peersView(el, s) {
  el.innerHTML = '<div class="loading">Finding peers…</div>';
  let d; try { d = await api('/api/peers/' + encodeURIComponent(s.symbol)); } catch (e) { el.innerHTML = `<div class="card err">${STATIC ? 'Peer comparison needs the local app.' : esc(e.message)}</div>`; return; }
  const all = [d.self, ...d.peers];
  if (!d.peers.length) { el.innerHTML = '<div class="card muted">No comparable peers were found for this stock.</div>'; return; }
  const basis = { industry: `Peers are the other large stocks in the same industry (${esc(d.industry || '')}), closest in size first.`, sector: `Few stocks share this industry, so peers are from the same sector (${esc(d.sector || '')}), closest in size first.`, similar: "No same-industry stocks were found, so these are Yahoo's 'similar stocks', which can be loosely related." }[d.basis];
  const stats = PEER_METRICS.map(([k, label, f, lowBetter, ok]) => {
    const valid = (x) => isN(x[k]) && (!ok || ok(x[k])), mine = d.self, vals = all.filter(valid);
    if (!valid(mine) || vals.length < 3) return null;
    const better = vals.filter((x) => x !== mine && (lowBetter ? x[k] > mine[k] : x[k] < mine[k])).length;     // how many others it beats
    return { k, label, better, of: vals.length - 1, med: median(vals.filter((x) => x !== mine).map((x) => x[k])), f, lowBetter };
  });
  const sc = stats.filter(Boolean);
  el.innerHTML = `<div class="card"><h3>${esc(s.symbol)} vs ${d.peers.length} peer${d.peers.length === 1 ? '' : 's'}</h3><div class="muted" style="font-size:13px">${basis}</div>
      <div style="margin-top:10px">${sc.map((x) => `<div class="check"><b style="color:${x.better / x.of >= 0.6 ? 'var(--up)' : x.better / x.of <= 0.4 ? 'var(--down)' : 'var(--warn)'}">●</b><div>${esc(x.label)}: better than <b>${x.better} of ${x.of}</b> peers <span class="muted">(${x.lowBetter ? 'lower is better' : 'higher is better'}; peer median ${x.f(x.med)})</span></div></div>`).join('') || '<span class="muted">Not enough overlapping data to rank.</span>'}</div></div>
    <div class="card scroll"><table><thead><tr><th class="l">Company</th>${PEER_METRICS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${all.map((x) => `<tr class="${x === d.self ? 'watch' : 'row'}" ${x === d.self ? '' : `data-s="${esc(x.symbol)}"`}><td class="l"><span class="sym">${esc(x.symbol)}</span><span class="nm">${esc(x.name || '')}</span></td>${PEER_METRICS.map(([k, , f, , ok]) => `<td>${isN(x[k]) && (!ok || ok(x[k])) ? f(x[k]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <div class="note">The highlighted row is ${esc(s.symbol)}. A cheaper stock is not automatically better: a low P/E can mean slower growth or higher risk. Negative or missing values are shown as "—" and left out of the ranking.</div></div>${A_NOTE}`;
  el.querySelectorAll('tr.row').forEach((tr) => tr.onclick = () => location.hash = '#/' + tr.dataset.s);
}

// ---------- Earnings history tab ----------
function earningsHistoryView(el, s) {
  const hist = (s.earningsHistory?.history || []).filter((h) => isN(h.epsActual)), q = s.quarterly || {}, rev = q.TotalRevenue || [], eps = q.DilutedEPS || [];
  const beats = hist.filter((h) => h.epsActual > h.epsEstimate).length, misses = hist.filter((h) => h.epsActual < h.epsEstimate).length;
  const avgSur = hist.length ? hist.reduce((a, h) => a + (h.surprisePercent ?? 0), 0) / hist.length : null;
  const ce = s.calendarEvents?.earnings || {}, next = (ce.earningsDate || [])[0];
  const yoy = (arr, i) => i >= 4 && arr[i - 4]?.v > 0 && isN(arr[i].v) ? arr[i].v / arr[i - 4].v - 1 : null;
  const rows = rev.map((r, i) => ({ date: r.date, rev: r.v, rg: yoy(rev, i), eps: eps.find((e) => e.date === r.date)?.v ?? null, eg: (() => { const i2 = eps.findIndex((e) => e.date === r.date); return i2 >= 4 && eps[i2 - 4].v > 0 ? eps[i2].v / eps[i2 - 4].v - 1 : null; })() })).reverse();
  el.innerHTML = `<div class="card"><h3>Track record (last ${hist.length} reported quarters)</h3><div class="grid">
      ${kpi('Beat / missed estimates', hist.length ? `${beats} / ${misses}` : '—', hist.length ? `${hist.length - beats - misses} in line` : '')}${kpi('Average surprise', isN(avgSur) ? pc(avgSur * 100, 1) : '—', 'actual EPS vs analysts')}
      ${kpi('Next earnings', next ? date(next) : '—', next && next * 1000 > Date.now() ? `in ${Math.ceil((next * 1000 - Date.now()) / 864e5)} days` : '')}${kpi('Expected EPS (next)', usd(ce.earningsAverage), isN(ce.earningsLow) ? `${usd(ce.earningsLow)} – ${usd(ce.earningsHigh)}` : '')}</div></div>
    <div class="card scroll"><h3>Estimate vs actual</h3><table><thead><tr><th class="l">Quarter ended</th><th>Estimate</th><th>Actual</th><th>Difference</th><th>Surprise</th><th class="l">Result</th></tr></thead><tbody>${hist.slice().reverse().map((h) => `<tr><td class="l">${date(h.quarter)}</td><td>${usd(h.epsEstimate)}</td><td>${usd(h.epsActual)}</td><td class="${cls(h.epsDifference)}">${usd(h.epsDifference)}</td><td class="${cls(h.surprisePercent)}">${pct(h.surprisePercent)}</td><td class="l">${h.epsActual > h.epsEstimate ? '<span class="up">Beat</span>' : h.epsActual < h.epsEstimate ? '<span class="down">Missed</span>' : 'In line'}</td></tr>`).join('') || '<tr><td class="l muted">No history</td></tr>'}</tbody></table>
      <div class="note">Yahoo provides the last four quarters of estimates. Beating estimates is common (companies guide cautiously), so a beat does not guarantee the stock rises: the market reacts to guidance and to how big the beat is against what was already expected.</div></div>
    <div class="card scroll"><h3>Reported results by quarter (newest first)</h3><table><thead><tr><th class="l">Quarter ended</th><th>Revenue</th><th>Revenue YoY</th><th>Diluted EPS (GAAP)</th><th>EPS YoY</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="l">${esc(r.date.slice(0, 10))}</td><td>${big(r.rev)}</td><td class="${cls(r.rg)}">${isN(r.rg) ? pc(r.rg * 100, 1) : '—'}</td><td>${usd(r.eps)}</td><td class="${cls(r.eg)}">${isN(r.eg) ? pc(r.eg * 100, 1) : '—'}</td></tr>`).join('') || '<tr><td class="l muted">No quarterly data</td></tr>'}</tbody></table>
      <div class="note">YoY compares each quarter with the same quarter a year earlier, so it needs five quarters of data. GAAP EPS includes one-time items, so it can differ from the "actual" EPS in the table above, which analysts adjust.${s.earningsHistory?.history?.length ? '' : ''} Price reactions to past reports aren't included: Yahoo does not provide the report dates needed to measure them reliably.</div></div>${A_NOTE}`;
}

// ---------- Creator views page ----------
async function viewsPage(el) {
  const $ = (sel, r = el) => r.querySelector(sel);
  await ensureHome();
  const rowsHome = new Map([...(home.watch || []), ...home.rows, ...(home.ai || []).flatMap((g) => g.rows)].map((r) => [r.symbol, r]));
  let who = '';
  const researched = await researchedViews();
  const draw = async () => {
    const all = [...researched, ...views.get()], names = [...new Set(all.map((v) => v.who))], list = all.filter((v) => !who || v.who === who);
    const need = [...new Set(list.map((v) => v.ticker).filter((t) => !rowsHome.has(t)))]; let extra = {};
    if (need.length && !STATIC) { try { (await api('/api/quotes?symbols=' + need.join(','))).forEach((q) => extra[q.symbol] = q); } catch {} }
    $('#vlist').innerHTML = list.length ? `<div class="card scroll" style="padding:0"><table><thead><tr><th class="l">Who</th><th class="l">Stock</th><th class="l">Their view</th><th>Their target</th><th>Price</th><th>Upside to their target</th><th>Analyst target</th><th class="l">Compared with analysts</th><th class="l">Source</th><th></th></tr></thead><tbody>${list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((v) => {
      const r = rowsHome.get(v.ticker) || extra[v.ticker] || {}, px = r.price, at = r.targetMean, up = isN(v.target) && isN(px) ? v.target / px - 1 : null;
      const cmp = isN(v.target) && isN(at) ? (v.target > at * 1.1 ? 'More bullish than analysts' : v.target < at * 0.9 ? 'More cautious than analysts' : 'In line with analysts') : '—';
      return `<tr class="row" data-s="${esc(v.ticker)}"><td class="l">${esc(v.who)}<div class="muted" style="font-size:12px">${esc(v.date || '')}</div></td><td class="l"><span class="sym">${esc(v.ticker)}</span></td><td class="l" style="color:${STANCES[v.stance][1]}">${STANCES[v.stance][0]}${v.note ? `<div class="muted" style="font-size:12px;white-space:normal;max-width:240px">${esc(v.note)}</div>` : ''}</td>
        <td>${isN(v.target) ? usd(v.target) : '—'}</td><td>${usd(px)}</td><td class="${cls(up)}">${isN(up) ? pc(up * 100, 0) : '—'}</td><td>${isN(at) ? usd(at) : '—'}</td><td class="l">${cmp}</td><td class="l">${v.url ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">link</a>` : '—'}${v.basis ? `<div class="muted" style="font-size:11px;white-space:normal;max-width:150px">${esc(v.basis)}</div>` : ''}</td><td>${v.ro ? '<span class="tag news" title="Researched from a public video. Not editable: open the link to verify.">researched</span>' : `<button class="star" data-rm="${v.id}" title="Remove">✕</button>`}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="card muted">Nothing recorded yet. Add a view above, with a link to the video or post so you can check it later.</div>';
    $('#vlist').insertAdjacentHTML('afterbegin', '<div class="note" style="margin:0 0 10px">Rows tagged <b>researched</b> come from public videos I read in Chrome. Each links to its source and says what it is based on. Titles and descriptions are the creators\' own words; transcripts are auto-generated and don\'t say who is speaking, so those rows are not pinned to one person. Always open the link before relying on one.</div>');
    $('#vlist').querySelectorAll('tr.row').forEach((tr) => tr.onclick = () => location.hash = '#/' + tr.dataset.s);
    $('#vlist').querySelectorAll('[data-rm]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); views.set(views.get().filter((v) => String(v.id) !== b.dataset.rm)); draw(); });
    $('#vwho').innerHTML = names.length ? `<button class="chip ${!who ? 'on' : ''}" data-w="">Everyone</button>${names.map((n) => `<button class="chip ${who === n ? 'on' : ''}" data-w="${esc(n)}">${esc(n)}</button>`).join('')}` : '';
    $('#vwho').querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { who = b.dataset.w; draw(); });
  };
  el.innerHTML = pageHead('Creator views', 'Record what investors you follow say about a stock, with a link to where they said it. The app compares each view with today\'s price and with the Wall Street average target, so you can see who is more bullish or more cautious, and later who was right.') +
    `<div class="card"><h3>Add a view</h3><div class="toolbar"><input id="vw" class="chip" style="cursor:text;width:170px" placeholder="Who (e.g. a channel name)"><input id="vt" class="chip" style="cursor:text;width:90px" placeholder="Ticker">
      <select id="vs" class="chip">${Object.entries(STANCES).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select><input id="vp" class="chip" style="cursor:text;width:120px" type="number" min="0" step="any" placeholder="Their target $"><input id="vd" class="chip" style="cursor:text;width:150px" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="toolbar"><input id="vu" class="chip" style="cursor:text;flex:1;min-width:260px" placeholder="Link to the video or post (so you can check it later)"><input id="vn" class="chip" style="cursor:text;flex:1;min-width:200px" placeholder="Note (optional): their reasoning in your own words"><button class="chip on" id="vadd">Add</button></div>
      <div class="note">The app can't read videos for you, and it doesn't guess what anyone said. Only add what you watched or read yourself, and only a target if they actually stated one.</div></div>
    <div class="toolbar" id="vwho"></div><div id="vlist"></div>${NOT_ADVICE}`;
  $('#vadd').onclick = () => {
    const w = $('#vw').value.trim(), t = $('#vt').value.trim().toUpperCase(), tg = parseFloat($('#vp').value), url = $('#vu').value.trim();
    if (!w || !/^[\w.\-^=]{1,12}$/.test(t)) { toast('Enter who said it and a ticker.'); return; }
    if (url && !/^https?:\/\//i.test(url)) { toast('The link should start with http:// or https://'); return; }
    views.set([...views.get(), { id: Date.now(), who: w, ticker: t, stance: $('#vs').value, target: isFinite(tg) && tg > 0 ? tg : null, url, date: $('#vd').value, note: $('#vn').value.trim() }]);
    ['#vt', '#vp', '#vu', '#vn'].forEach((i) => $(i).value = ''); draw();
  };
  draw();
}
