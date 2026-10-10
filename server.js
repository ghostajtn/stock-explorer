// Stock Explorer — zero-dependency Node server.
// Proxies + caches Yahoo Finance (cookie/crumb session) and serves ./public.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyHeadline } from './classify.js';
import { sentimentLabel } from './sentiment.js';
import { computeSignal } from './signal.js';
import { runBacktests } from './backtest.js';

const PORT = process.env.PORT || 3456;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

// Candidate universe: ~230 of the largest listed companies. We rank by live market cap
// and keep the top TOP_N, so a name that grows into the top 100 appears automatically.
// (Tickers Yahoo doesn't return a market cap for are simply skipped.)
const TOP_N = 100;
const UNIVERSE = `AAPL MSFT NVDA GOOGL AMZN META AVGO TSLA BRK-B LLY WMT JPM V ORCL MA XOM NFLX COST JNJ HD PG ABBV BAC
TMUS CVX KO CRM AMD CSCO WFC PLTR IBM MRK PM ABT GE NOW AXP MCD LIN TMO ISRG DIS QCOM INTU CAT UBER TXN BKNG GS
VZ T RTX AMGN PEP ADBE TSM ASML SAP NVO AZN BABA SHEL TM MU LRCX AMAT ANET NEE SPGI PGR BLK SCHW ACN C MS DHR
UNH PFE SYK BSX LOW HON ETN PANW KLAC ARM ADI CRWD APP SHOP COP TJX CMCSA BX SNPS CDNS SPCX
INTC BA UNP UPS LMT DE GILD VRTX REGN MDLZ MMC CB SO DUK SBUX NKE MO CI ELV CVS MCK ZTS BMY PLD AMT EQIX WM SHW
ICE CME PYPL FI ADP MMM NOC GD FDX CSX NSC EMR ITW TGT ROST ORLY AZO CMG MAR HLT ABNB F GM SLB EOG OXY MPC PSX VLO
PNC USB TFC COF BK TRV AFL AIG PRU MET D AEP SRE EXC HCA BDX SYK MRVL FTNT ADSK WDAY TEAM DDOG COIN MELI SE PDD JD
SONY TTE BP UL DEO TD RY BNS ENB CNQ SU NEM FCX SCCO APD ECL CL KMB KHC KDP GIS STZ HSY MNST PAYX PCAR CTAS FAST
MSI ROP AME TT CARR OTIS CEG VST NRG LHX HWM TDG ODFL URI WMB KMI ET EPD OKE PSA O SPG CCI DLR VICI WELL AVB EQR
HUM CNC MCO MSCI FICO CPRT IDXX IQV EW A RMD DXCM ALGN MTD WAT ILMN BIIB MRNA AMP HIG FITB NTRS DFS SYF`.split(/\s+/);

// ---------- tiny TTL cache ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

// ---------- Yahoo session ----------
let sess = null;
async function session(force = false) {
  if (sess && !force && Date.now() - sess.t < 45 * 60e3) return sess;
  const r = await fetch('https://fc.yahoo.com', { headers: UA, redirect: 'manual' });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const crumb = await (await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...UA, cookie } })).text();
  sess = { cookie, crumb, t: Date.now() };
  return sess;
}

async function yahoo(url, { crumb = true } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await session(attempt > 0);
    const u = crumb ? `${url}${url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(s.crumb)}` : url;
    const res = await fetch(u, { headers: { ...UA, cookie: s.cookie } });
    if (res.status === 401 || res.status === 403) { lastErr = new Error(`Yahoo ${res.status}`); continue; }
    if (!res.ok) throw new Error(`Yahoo ${res.status} for ${url.split('?')[0]}`);
    return res.json();
  }
  throw lastErr;
}

// Yahoo wraps numbers as {raw, fmt}; flatten to plain values, drop empty objects.
function unwrap(x) {
  if (Array.isArray(x)) return x.map(unwrap);
  if (x && typeof x === 'object') {
    if ('raw' in x) return x.raw;
    const keys = Object.keys(x);
    if (!keys.length) return null;
    return Object.fromEntries(keys.map((k) => [k, unwrap(x[k])]));
  }
  return x;
}

// ---------- endpoints ----------
async function getQuotes(symbols) {
  const out = [];
  for (let i = 0; i < symbols.length; i += 50) {
    const chunk = symbols.slice(i, i + 50).join(',');
    const j = await yahoo(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk)}`);
    out.push(...(j.quoteResponse?.result || []));
  }
  return out;
}

// Always shown above the table, whatever their market-cap rank. Add tickers here.
const WATCHLIST = ['NBIS', 'MRNA'];

// The AI supply chain, grouped. Shown on the AI stocks page whatever their market-cap rank;
// a ticker Yahoo has no quote for is skipped. Add or move tickers here.
const AI_GROUPS = {
  'Chips & accelerators': 'NVDA AMD AVGO MRVL INTC ARM QCOM MU ALAB CRDO',
  'Chip equipment & foundry': 'TSM ASML LRCX AMAT KLAC SNPS CDNS',
  'Cloud & AI platforms': 'MSFT GOOGL AMZN META ORCL IBM CRWV NBIS SPCX',
  'AI software & data': 'PLTR SNOW AI PATH DDOG MDB NOW CRM ADBE ESTC',
  'Servers, networking & data centers': 'SMCI DELL HPE ANET CSCO VRT COHR CIEN EQIX DLR IREN APLD',
  'Power for AI': 'CEG VST NRG GEV ETN SMR OKLO',
  'AI applications': 'TSLA APP SOUN TEM RXRX',
};
const AI_SYMBOLS = [...new Set(Object.values(AI_GROUPS).flatMap((g) => g.split(' ')))];

// Analyst price targets are not in Yahoo's bulk quote feed, so they're fetched per stock (small
// 'financialData' request, 8 at a time) and kept for 30 minutes. A failed lookup retries in ~5 minutes.
const TARGETS = new Map();                                // symbol -> { t, mean, high, low, sector, industry }
let SHOWN = [];                                           // symbols currently on the home/AI pages (peer candidates)
const SHOWN_CAPS = new Map();                             // symbol -> market cap, to pick peers closest in size
let targetsRun = null;
function refreshTargets(symbols) {
  if (targetsRun) return targetsRun;
  const queue = symbols.filter((s) => { const x = TARGETS.get(s); return !x || Date.now() - x.t > 30 * 60e3; });   // symbols are queued in the order given
  if (!queue.length) return Promise.resolve();
  const worker = async () => {
    for (let s; (s = queue.shift());) {
      try {
        const j = await yahoo(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=financialData,assetProfile`);
        const r = unwrap(j.quoteSummary?.result?.[0] || {}), fd = r.financialData || {};
        TARGETS.set(s, { t: Date.now(), mean: fd.targetMeanPrice ?? null, high: fd.targetHighPrice ?? null, low: fd.targetLowPrice ?? null, sector: r.assetProfile?.sector ?? null, industry: r.assetProfile?.industry ?? null });
      } catch { TARGETS.set(s, { t: Date.now() - 25 * 60e3, mean: null, high: null, low: null, sector: null, industry: null }); }
    }
  };
  return (targetsRun = Promise.all(Array.from({ length: 8 }, worker)).finally(() => { targetsRun = null; }));
}

const top50 = () => cached('top50', 60e3, async () => {
  const quotes = await getQuotes([...new Set([...UNIVERSE, ...WATCHLIST, ...AI_SYMBOLS])]);
  const shown = new Set([...quotes.filter((q) => q.marketCap && UNIVERSE.includes(q.symbol)).sort((a, b) => b.marketCap - a.marketCap).slice(0, TOP_N).map((q) => q.symbol), ...WATCHLIST, ...AI_SYMBOLS]);
  // Peers may be any candidate, not just the ones on screen, so every candidate gets an industry and a market cap.
  SHOWN = [...new Set([...shown, ...UNIVERSE, ...AI_SYMBOLS])]; quotes.forEach((q) => q.marketCap && SHOWN_CAPS.set(q.symbol, q.marketCap));
  // Wait a few seconds so the first load already has the targets for what is shown; the rest fill in behind it.
  await Promise.race([refreshTargets(SHOWN), new Promise((r) => setTimeout(r, 7000))]);
  const toRow = (q, rank) => ({
      rank,
      symbol: q.symbol,
      name: q.shortName || q.longName,
      price: q.regularMarketPrice,
      changePct: q.regularMarketChangePercent,
      marketCap: q.marketCap,
      pe: q.trailingPE ?? null,
      forwardPE: q.forwardPE ?? null,
      eps: q.epsTrailingTwelveMonths ?? null,
      epsForward: q.epsForward ?? null,
      epsYear: q.epsCurrentYear ?? null,
      targetMean: TARGETS.get(q.symbol)?.mean ?? null,
      targetHigh: TARGETS.get(q.symbol)?.high ?? null,
      targetLow: TARGETS.get(q.symbol)?.low ?? null,
      pb: q.priceToBook ?? null,
      divYield: q.trailingAnnualDividendYield ?? null,
      low52: q.fiftyTwoWeekLow,
      high52: q.fiftyTwoWeekHigh,
      divRate: q.trailingAnnualDividendRate ?? null,
      divDate: q.dividendDate ?? null,
      ma50: q.fiftyDayAverage ?? null,
      ma200: q.twoHundredDayAverage ?? null,
      earningsTs: q.earningsTimestamp ?? null,
      rating: q.averageAnalystRating ?? null,
      volume: q.regularMarketVolume,
  });
  const rows = quotes
    .filter((q) => q.marketCap && UNIVERSE.includes(q.symbol))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, TOP_N)
    .map((q, i) => toRow(q, i + 1));
  const watch = WATCHLIST.map((s) => quotes.find((q) => q.symbol === s)).filter(Boolean)
    .map((q) => ({ ...toRow(q, '★'), watch: true }));
  const ai = Object.entries(AI_GROUPS).map(([group, syms]) => ({
    group,
    rows: syms.split(' ').map((s) => quotes.find((q) => q.symbol === s)).filter(Boolean).map((q) => toRow(q, '')).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)),
  })).filter((g) => g.rows.length);
  return { updated: Date.now(), rows, watch, ai };
});

// ---------- US bond market ----------
// Treasury yields come from Yahoo's index quotes (value = yield in %, change = percentage points, so ×100 = basis points).
const YIELDS = [['^IRX', '3-month', 0.25], ['^FVX', '5-year', 5], ['^TNX', '10-year', 10], ['^TYX', '30-year', 30]];
const BOND_ETFS = [['SHY', 'Short-term Treasuries (1-3 yr)'], ['IEF', 'Intermediate Treasuries (7-10 yr)'], ['TLT', 'Long Treasuries (20+ yr)'], ['TIP', 'Inflation-protected (TIPS)'], ['AGG', 'US aggregate bonds'], ['LQD', 'Investment-grade corporate'], ['HYG', 'High-yield (junk) corporate']];
async function bonds() {
  const qs = await getQuotes([...YIELDS.map((y) => y[0]), ...BOND_ETFS.map((b) => b[0])]);
  const by = (s) => qs.find((q) => q.symbol === s) || {};
  const yields = YIELDS.map(([symbol, label, years]) => { const q = by(symbol); return { symbol, label, years, yield: q.regularMarketPrice ?? null, changeBps: q.regularMarketChange != null ? q.regularMarketChange * 100 : null, prev: q.regularMarketPreviousClose ?? null }; });
  const y = (s) => yields.find((x) => x.symbol === s)?.yield ?? null;
  const spread = (a, b) => (y(a) != null && y(b) != null ? (y(a) - y(b)) * 100 : null);     // in basis points
  const etfs = BOND_ETFS.map(([symbol, name]) => { const q = by(symbol); return { symbol, name, price: q.regularMarketPrice ?? null, changePct: q.regularMarketChangePercent ?? null, ma50: q.fiftyDayAverage ?? null, ma200: q.twoHundredDayAverage ?? null, yield: q.trailingAnnualDividendYield ?? q.yield ?? null }; });
  return { updated: Date.now(), yields, spreads: { '10y-3m': spread('^TNX', '^IRX'), '30y-5y': spread('^TYX', '^FVX'), '10y-5y': spread('^TNX', '^FVX') }, etfs };
}
// Bond-market headlines. "move" tags what a headline says yields did (rise / fall), from its wording only.
const bondNews = async () => {
  const [search, rss] = await Promise.allSettled([
    yahoo(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent('Treasury yields bond market')}&newsCount=30&quotesCount=0`, { crumb: false }),
    fetch('https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5ETNX,TLT,IEF&region=US&lang=en-US', { headers: UA }).then((r) => r.text()),
  ]);
  const items = [];
  if (search.status === 'fulfilled') for (const n of search.value.news || []) items.push({ title: n.title, url: n.link, source: n.publisher, ts: (n.providerPublishTime || 0) * 1000 });
  if (rss.status === 'fulfilled') {
    const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
    for (const m of rss.value.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const pick = (tag) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
      items.push({ title: dec(pick('title')), url: dec(pick('link')), source: 'Yahoo Finance', ts: Date.parse(pick('pubDate')) || 0 });
    }
  }
  const seen = new Set(), up = /\b(yields?|rates?)\b.*\b(rise|rises|rising|jump|jumps|climb|climbs|surge|surges|higher|spike|spikes|up)\b|\b(rise|jump|climb|surge|spike)\b.*\byields?\b/i, down = /\b(yields?|rates?)\b.*\b(fall|falls|falling|drop|drops|slip|slips|slide|slides|lower|ease|eases|retreat|retreats|down)\b|\b(fall|drop|slip|slide|retreat)\b.*\byields?\b/i;
  return items.filter((n) => n.title && !seen.has(n.title.toLowerCase()) && seen.add(n.title.toLowerCase()) && /yield|treasur|bond|fed\b|rate|inflation|debt/i.test(n.title))
    .sort((a, b) => b.ts - a.ts).slice(0, 25).map((n) => ({ ...n, move: up.test(n.title) ? 'up' : down.test(n.title) ? 'down' : null }));
};

// One stock's comparison metrics (a single light request, cached 30 min), used by the Peers tab.
const peerData = (sym) => cached('peer:' + sym, 30 * 60e3, async () => {
  const j = await yahoo(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=financialData,defaultKeyStatistics,summaryDetail,assetProfile,price`);
  const r = unwrap(j.quoteSummary?.result?.[0] || {}), fd = r.financialData || {}, ks = r.defaultKeyStatistics || {}, sd = r.summaryDetail || {}, p = r.price || {};
  const price = p.regularMarketPrice ?? null;
  return {
    symbol: sym, name: p.shortName || sym, sector: r.assetProfile?.sector ?? null, industry: r.assetProfile?.industry ?? null,
    price, marketCap: p.marketCap ?? null, pe: sd.trailingPE ?? null, forwardPE: sd.forwardPE ?? null, peg: ks.pegRatio ?? null,
    ps: sd.priceToSalesTrailing12Months ?? null, evEbitda: ks.enterpriseToEbitda ?? null,
    revGrowth: fd.revenueGrowth ?? null, earnGrowth: fd.earningsGrowth ?? null, grossMargin: fd.grossMargins ?? null, opMargin: fd.operatingMargins ?? null,
    netMargin: fd.profitMargins ?? null, roe: fd.returnOnEquity ?? null, debtEq: fd.debtToEquity ?? null, divYield: sd.dividendYield ?? null,
    upside: price && fd.targetMeanPrice ? fd.targetMeanPrice / price - 1 : null, rating: fd.recommendationKey ?? null,
  };
});

// Peers = other big stocks in the same industry (closest in size first), then the same sector, then Yahoo's "similar" list.
async function peersOf(sym) {
  await top50();                                          // makes sure the industry table (TARGETS/SHOWN) is filled
  await Promise.race([refreshTargets(SHOWN), new Promise((r) => setTimeout(r, 20000))]);   // let the background industry lookups finish (up to 20 s)
  const me = await peerData(sym), pool = [...new Set(SHOWN)].filter((s) => s !== sym);
  const info = (s) => TARGETS.get(s) || {};
  const byCap = (list) => list.map((s) => ({ s, d: Math.abs(Math.log((SHOWN_CAPS.get(s) || 1) / (me.marketCap || 1))) })).sort((a, b) => a.d - b.d).map((x) => x.s);
  let basis = 'industry', syms = byCap(pool.filter((s) => me.industry && info(s).industry === me.industry));
  if (syms.length < 3) { basis = 'sector'; syms = byCap(pool.filter((s) => me.sector && info(s).sector === me.sector)); }
  if (syms.length < 3) {
    basis = 'similar';
    try { const j = await yahoo(`https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(sym)}`, { crumb: false }); syms = (j.finance?.result?.[0]?.recommendedSymbols || []).map((x) => x.symbol); } catch { syms = []; }
  }
  const peers = (await Promise.allSettled(syms.slice(0, 6).map(peerData))).filter((x) => x.status === 'fulfilled').map((x) => x.value);
  return { basis, industry: me.industry, sector: me.sector, self: me, peers };
}

const SUMMARY_MODULES = [
  'price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'earningsHistory', 'earningsTrend',
  'calendarEvents', 'recommendationTrend', 'upgradeDowngradeHistory', 'assetProfile',
  'majorHoldersBreakdown', 'insiderTransactions', 'netSharePurchaseActivity',
].join(',');

const TS_BASE = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'EBITDA', 'DilutedEPS',
  'OperatingCashFlow', 'CapitalExpenditure', 'FreeCashFlow', 'TotalDebt', 'CashCashEquivalentsAndShortTermInvestments',
  'StockholdersEquity', 'ResearchAndDevelopment', 'RepurchaseOfCapitalStock', 'CashDividendsPaid'];

async function timeseries(sym, prefix) {
  const types = TS_BASE.map((t) => prefix + t).join(',');
  const j = await yahoo(
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}` +
    `?type=${types}&period1=1420070400&period2=${Math.floor(Date.now() / 1000) + 86400}`);
  const out = {};
  for (const r of j.timeseries?.result || []) {
    const t = r.meta.type[0].replace(prefix, '');
    out[t] = (r[r.meta.type[0]] || []).filter(Boolean).map((p) => ({ date: p.asOfDate, v: p.reportedValue?.raw ?? null }));
  }
  return out;
}

async function news(sym) {
  const [search, rss] = await Promise.allSettled([
    yahoo(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&newsCount=40&quotesCount=0`, { crumb: false }),
    fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`, { headers: UA }).then((r) => r.text()),
  ]);
  const items = [];
  if (search.status === 'fulfilled') {
    for (const n of search.value.news || [])
      items.push({ title: n.title, url: n.link, source: n.publisher, ts: (n.providerPublishTime || 0) * 1000 });
  }
  if (rss.status === 'fulfilled') {
    const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
    for (const m of rss.value.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const pick = (tag) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
      items.push({ title: dec(pick('title')), url: dec(pick('link')), source: 'Yahoo Finance', ts: Date.parse(pick('pubDate')) || 0 });
    }
  }
  const seen = new Set();
  return items
    .filter((n) => n.title && !seen.has(n.title.toLowerCase()) && seen.add(n.title.toLowerCase()))
    .sort((a, b) => b.ts - a.ts)
    .map((n) => ({ ...n, tag: classifyHeadline(n.title), sentiment: sentimentLabel(n.title) }));
}

const stock = (sym) => cached('stock:' + sym, 5 * 60e3, async () => {
  const [summary, quarterly, annual, newsItems] = await Promise.allSettled([
    yahoo(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${SUMMARY_MODULES}`),
    timeseries(sym, 'quarterly'),
    timeseries(sym, 'annual'),
    news(sym),
  ]);
  if (summary.status === 'rejected') throw summary.reason;
  const r = summary.value.quoteSummary?.result?.[0];
  if (!r) throw new Error('Unknown ticker');
  return {
    symbol: sym,
    ...unwrap(r),
    quarterly: quarterly.value || {},
    annual: annual.value || {},
    news: newsItems.value || [],
    fetched: Date.now(),
  };
});

const RANGES = { '1d': ['1d', '5m'], '5d': ['5d', '15m'], '1mo': ['1mo', '1d'], '6mo': ['6mo', '1d'], '1y': ['1y', '1d'], '5y': ['5y', '1wk'], '5yd': ['5y', '1d'], max: ['max', '1mo'] };
const chart = (sym, range) => cached(`chart:${sym}:${range}`, 60e3, async () => {
  const [rg, iv] = RANGES[range] || RANGES['1y'];
  const j = await yahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${rg}&interval=${iv}`, { crumb: false });
  const r = j.chart?.result?.[0];
  if (!r) throw new Error('No chart data');
  const q = r.indicators.quote[0], closes = q.close;
  const pts = r.timestamp.map((t, i) => [t * 1000, closes[i]]).filter((p) => p[1] != null);
  // OHLCV bars for the candlestick chart (bars with a missing value are skipped).
  const candles = r.timestamp.map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: closes[i], v: q.volume[i] }))
    .filter((b) => b.o != null && b.h != null && b.l != null && b.c != null);
  return { points: pts, candles, prevClose: r.meta.chartPreviousClose };
});

const search = (q) => cached('search:' + q, 5 * 60e3, async () => {
  const j = await yahoo(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`, { crumb: false });
  return (j.quotes || []).filter((x) => x.quoteType === 'EQUITY').map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname, exchange: x.exchDisp }));
});

// ---------- http ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  // Browsers send ^ and = as %5E / %3D (e.g. /api/chart/%5ETNX); decode once so the route patterns below see the real symbol.
  let pn; try { pn = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  try {
    if (pn === '/api/top50') return json(res, 200, await top50());
    if (pn === '/api/search') return json(res, 200, await search(u.searchParams.get('q') || ''));
    if (pn === '/api/market') {                  // index/rates strip shown above every page
      const MK = [['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^DJI', 'Dow'], ['^VIX', 'VIX (fear)'], ['^IRX', 'US 3-mo yield'], ['^FVX', 'US 5-yr yield'], ['^TNX', 'US 10-yr yield'], ['^TYX', 'US 30-yr yield'], ['DX-Y.NYB', 'US dollar'], ['GC=F', 'Gold'], ['CL=F', 'Oil'], ['BTC-USD', 'Bitcoin']];
      const qs = await cached('market', 30e3, () => getQuotes(MK.map((m) => m[0])));
      return json(res, 200, MK.map(([symbol, name]) => { const q = qs.find((x) => x.symbol === symbol) || {}; return { symbol, name, price: q.regularMarketPrice ?? null, change: q.regularMarketChange ?? null, changePct: q.regularMarketChangePercent ?? null }; }));
    }
    if (pn === '/api/bonds') return json(res, 200, await cached('bonds', 30e3, bonds));
    if (pn === '/api/bondnews') return json(res, 200, await cached('bondnews', 10 * 60e3, bondNews));
    if (pn === '/api/quotes') {
      // Live prices for the browser-side watchlist/alerts: ?symbols=AAPL,MSFT (max 50).
      const syms = (u.searchParams.get('symbols') || '').toUpperCase().split(',').filter((s) => /^[\w.\-^=]{1,12}$/.test(s)).slice(0, 100);
      const qs = syms.length ? await cached('quotes:' + syms.join(','), 30e3, () => getQuotes(syms)) : [];
      return json(res, 200, qs.map((q) => ({ symbol: q.symbol, name: q.shortName || q.longName, price: q.regularMarketPrice, changePct: q.regularMarketChangePercent })));
    }
    let m;
    if ((m = pn.match(/^\/api\/peers\/([\w.\-^=]+)$/))) return json(res, 200, await cached('peers:' + m[1].toUpperCase(), 10 * 60e3, () => peersOf(m[1].toUpperCase())));
    if ((m = pn.match(/^\/api\/signal\/([\w.\-^=]+)$/))) {
      const sym = m[1].toUpperCase(), s = await stock(sym);
      const c = await chart(sym, '1y').catch(() => null);
      return json(res, 200, computeSignal(s, c?.candles?.map((b) => b.c)));
    }
    if ((m = pn.match(/^\/api\/backtest\/([\w.\-^=]+)$/))) {
      const c = await chart(m[1].toUpperCase(), '5yd');
      const all = runBacktests(c.candles.map((b) => ({ t: b.t, c: b.c })));
      return json(res, 200, { symbol: m[1].toUpperCase(), result: all?.current ?? null, ...(u.searchParams.has('all') ? { presets: all } : {}) });
    }
    if ((m = pn.match(/^\/api\/pipeline\/([\w.\-]+)$/))) {
      // Hand-curated forward deals/guidance (edit pipeline.json to add tickers).
      const all = JSON.parse(await fs.readFile(path.join(ROOT, 'pipeline.json'), 'utf8'));
      return json(res, 200, all[m[1].toUpperCase()] || null);
    }
    if ((m = pn.match(/^\/api\/stock\/([\w.\-^=]+)$/))) return json(res, 200, await stock(m[1].toUpperCase()));
    if ((m = pn.match(/^\/api\/chart\/([\w.\-^=]+)$/))) return json(res, 200, await chart(m[1].toUpperCase(), u.searchParams.get('range') || '1y'));
    const file = path.join(ROOT, 'public', pn === '/' ? 'index.html' : path.normalize(pn));
    if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('Not found'); }
    console.error(req.url, e.message);
    json(res, 502, { error: e.message });
  }
}).listen(PORT, () => console.log(`Stock Explorer running → http://localhost:${PORT}`));
