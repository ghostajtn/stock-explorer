// Stock Explorer — zero-dependency Node server.
// Proxies + caches Yahoo Finance (cookie/crumb session) and serves ./public.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyHeadline } from './classify.js';
import { sentimentLabel } from './sentiment.js';

const PORT = process.env.PORT || 3456;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

// Candidate universe: ~100 of the largest listed companies. We rank by live market cap
// and keep the top 50, so a name that grows into the top 50 appears automatically.
const UNIVERSE = `AAPL MSFT NVDA GOOGL AMZN META AVGO TSLA BRK-B LLY WMT JPM V ORCL MA XOM NFLX COST JNJ HD PG ABBV BAC
TMUS CVX KO CRM AMD CSCO WFC PLTR IBM MRK PM ABT GE NOW AXP MCD LIN TMO ISRG DIS QCOM INTU CAT UBER TXN BKNG GS
VZ T RTX AMGN PEP ADBE TSM ASML SAP NVO AZN BABA SHEL TM MU LRCX AMAT ANET NEE SPGI PGR BLK SCHW ACN C MS DHR
UNH PFE SYK BSX LOW HON ETN PANW KLAC ARM ADI CRWD APP SHOP COP TJX CMCSA BX SNPS CDNS SPCX`.split(/\s+/);

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

const top50 = () => cached('top50', 60e3, async () => {
  const quotes = await getQuotes([...new Set([...UNIVERSE, ...WATCHLIST])]);
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
      pb: q.priceToBook ?? null,
      divYield: q.trailingAnnualDividendYield ?? null,
      low52: q.fiftyTwoWeekLow,
      high52: q.fiftyTwoWeekHigh,
      ma50: q.fiftyDayAverage ?? null,
      ma200: q.twoHundredDayAverage ?? null,
      earningsTs: q.earningsTimestamp ?? null,
      rating: q.averageAnalystRating ?? null,
      volume: q.regularMarketVolume,
  });
  const rows = quotes
    .filter((q) => q.marketCap && UNIVERSE.includes(q.symbol))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 50)
    .map((q, i) => toRow(q, i + 1));
  const watch = WATCHLIST.map((s) => quotes.find((q) => q.symbol === s)).filter(Boolean)
    .map((q) => ({ ...toRow(q, '★'), watch: true }));
  return { updated: Date.now(), rows, watch };
});

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

const RANGES = { '1d': ['1d', '5m'], '5d': ['5d', '15m'], '1mo': ['1mo', '1d'], '6mo': ['6mo', '1d'], '1y': ['1y', '1d'], '5y': ['5y', '1wk'], max: ['max', '1mo'] };
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
  try {
    if (u.pathname === '/api/top50') return json(res, 200, await top50());
    if (u.pathname === '/api/search') return json(res, 200, await search(u.searchParams.get('q') || ''));
    if (u.pathname === '/api/quotes') {
      // Live prices for the browser-side watchlist/alerts: ?symbols=AAPL,MSFT (max 50).
      const syms = (u.searchParams.get('symbols') || '').toUpperCase().split(',').filter((s) => /^[\w.\-^=]{1,12}$/.test(s)).slice(0, 50);
      const qs = syms.length ? await cached('quotes:' + syms.join(','), 30e3, () => getQuotes(syms)) : [];
      return json(res, 200, qs.map((q) => ({ symbol: q.symbol, name: q.shortName || q.longName, price: q.regularMarketPrice, changePct: q.regularMarketChangePercent })));
    }
    let m;
    if ((m = u.pathname.match(/^\/api\/pipeline\/([\w.\-]+)$/))) {
      // Hand-curated forward deals/guidance (edit pipeline.json to add tickers).
      const all = JSON.parse(await fs.readFile(path.join(ROOT, 'pipeline.json'), 'utf8'));
      return json(res, 200, all[m[1].toUpperCase()] || null);
    }
    if ((m = u.pathname.match(/^\/api\/stock\/([\w.\-^=]+)$/))) return json(res, 200, await stock(m[1].toUpperCase()));
    if ((m = u.pathname.match(/^\/api\/chart\/([\w.\-^=]+)$/))) return json(res, 200, await chart(m[1].toUpperCase(), u.searchParams.get('range') || '1y'));
    const file = path.join(ROOT, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
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
