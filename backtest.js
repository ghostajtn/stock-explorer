// Backtests of price-based rules over daily bars. Analyst ratings and news have no point-in-time
// history in free data, so only price rules can be tested. For every rule ("preset") we mark the
// days it fires, look ahead 21 / 63 / 126 trading days (about 1 / 3 / 6 months) and compare the
// return after those days with the return after ANY day (the buy-and-hold baseline for the stock).
// Consecutive days overlap, so the samples are not independent: treat the numbers as indicative only.

export const HORIZONS = [21, 63, 126];

// Each rule gets the indicator values for day i and says whether the setup is "on".
export const PRESETS = {
  current: { name: 'Current Buy-setup rule', about: 'Above 200-day, golden cross, RSI 40–65, within 20% of the 200-day', test: (x) => x.px > x.ma200 && x.ma50 > x.ma200 && x.rsi >= 40 && x.rsi <= 65 && x.px / x.ma200 - 1 <= 0.20 },
  momentum: { name: 'Strong momentum', about: 'Above 200-day, golden cross, RSI 50–80, within 40% of the 200-day', test: (x) => x.px > x.ma200 && x.ma50 > x.ma200 && x.rsi >= 50 && x.rsi <= 80 && x.px / x.ma200 - 1 <= 0.40 },
  trend: { name: 'Trend only', about: 'Above 200-day and golden cross, no RSI limit', test: (x) => x.px > x.ma200 && x.ma50 > x.ma200 },
  pullback: { name: 'Pullback in an uptrend', about: 'Above 200-day, RSI 30–45 (a dip inside a rising trend)', test: (x) => x.px > x.ma200 && x.rsi >= 30 && x.rsi <= 45 },
  breakout: { name: 'Breakout', about: 'Above 50-day, golden cross, RSI 55–75', test: (x) => x.px > x.ma50 && x.ma50 > x.ma200 && x.rsi >= 55 && x.rsi <= 75 },
  oversold: { name: 'Oversold bounce', about: 'RSI below 30, any trend (mean reversion)', test: (x) => x.rsi < 30 },
};

function rsiSeries(c, n = 14) {
  const out = new Array(c.length).fill(null); let gain = 0, loss = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) { gain += g; loss += l; if (i === n) { gain /= n; loss /= n; } } else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
    if (i >= n) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function smaSeries(c, n) {
  const out = new Array(c.length).fill(null); let sum = 0;
  for (let i = 0; i < c.length; i++) { sum += c[i]; if (i >= n) sum -= c[i - n]; if (i >= n - 1) out[i] = sum / n; }
  return out;
}

const summarize = (list) => {
  if (!list.length) return { n: 0, sum: 0, wins: 0, avg: null, median: null, winRate: null };
  const s = list.slice().sort((a, b) => a - b), sum = list.reduce((a, b) => a + b, 0), wins = list.filter((x) => x > 0).length;
  return { n: list.length, sum, wins, avg: sum / list.length, median: s[s.length >> 1], winRate: wins / list.length };
};

/** Backtest every preset. @param bars [{t (ms), c (close)}] oldest first. Returns null with too little history. */
export function runBacktests(bars) {
  const c = bars.map((b) => b.c), n = c.length;
  if (n < 330) return null;                                   // need 200 days of warm-up plus room to look ahead
  const ma50 = smaSeries(c, 50), ma200 = smaSeries(c, 200), rsi = rsiSeries(c), out = {};
  for (const [key, p] of Object.entries(PRESETS)) {
    const on = c.map((px, i) => i >= 199 && rsi[i] != null && p.test({ px, ma50: ma50[i], ma200: ma200[i], rsi: rsi[i] }));
    const horizons = {};
    for (const h of HORIZONS) {
      const sig = [], all = [];
      for (let i = 199; i + h < n; i++) { const r = c[i + h] / c[i] - 1; all.push(r); if (on[i]) sig.push(r); }
      horizons[h] = { signal: summarize(sig), all: summarize(all) };
    }
    // Honesty check: do the first ~60% of days (train) and the last ~40% (test) tell the same story?
    // Train windows stop 63 days before the split so their look-ahead never reaches into the test period.
    const last = n - 1 - 63, mid = 199 + Math.floor((last - 199) * 0.6), parts = { train: { sig: [], all: [] }, test: { sig: [], all: [] } };
    for (let i = 199; i <= last; i++) {
      const part = i <= mid - 63 ? parts.train : i > mid ? parts.test : null; if (!part) continue;
      const r = c[i + 63] / c[i] - 1; part.all.push(r); if (on[i]) part.sig.push(r);
    }
    const split = { splitDate: bars[mid].t, train: { signal: summarize(parts.train.sig), all: summarize(parts.train.all) }, test: { signal: summarize(parts.test.sig), all: summarize(parts.test.all) } };
    const entries = [];                                       // first day of each run of setup days
    for (let i = 200; i < n; i++) if (on[i] && !on[i - 1]) entries.push({
      t: bars[i].t, price: c[i], r63: i + 63 < n ? c[i + 63] / c[i] - 1 : null, r126: i + 126 < n ? c[i + 126] / c[i] - 1 : null,
    });
    out[key] = { name: p.name, about: p.about, days: n, from: bars[0].t, to: bars[n - 1].t, setupDays: on.filter(Boolean).length, nowInSetup: on[n - 1], horizons, split, entryCount: entries.length, entries: entries.slice(-8).reverse() };
  }
  return out;
}

/** Just the current Buy-setup rule (used by the per-stock card). */
export const runBacktest = (bars) => runBacktests(bars)?.current ?? null;
