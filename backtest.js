// Backtest of the *technical* half of the Buy-setup rule over daily bars. Analyst ratings and news
// have no point-in-time history in free data, so they cannot be tested. A day is a "setup day" when:
//   price > 200-day average, 50-day > 200-day, RSI(14) between 40 and 65, price within 20% of the 200-day.
// For every day we look ahead 21 / 63 / 126 trading days (about 1 / 3 / 6 months) and compare the
// return after setup days with the return after ANY day (the buy-and-hold baseline for the same stock).
// Consecutive days overlap, so the samples are not independent: treat the numbers as indicative only.

export const HORIZONS = [21, 63, 126];

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

/** @param bars [{t (ms), c (close)}] oldest first */
export function runBacktest(bars) {
  const c = bars.map((b) => b.c), n = c.length;
  if (n < 330) return null;                                   // need 200 days of warm-up plus room to look ahead
  const ma50 = smaSeries(c, 50), ma200 = smaSeries(c, 200), rsi = rsiSeries(c);
  const setup = c.map((px, i) => i >= 199 && rsi[i] != null && px > ma200[i] && ma50[i] > ma200[i] && rsi[i] >= 40 && rsi[i] <= 65 && px / ma200[i] - 1 <= 0.20);
  const horizons = {};
  for (const h of HORIZONS) {
    const sig = [], all = [];
    for (let i = 199; i + h < n; i++) { const r = c[i + h] / c[i] - 1; all.push(r); if (setup[i]) sig.push(r); }
    horizons[h] = { signal: summarize(sig), all: summarize(all) };
  }
  const entries = [];                                           // first day of each run of setup days
  for (let i = 200; i < n; i++) if (setup[i] && !setup[i - 1]) entries.push({
    t: bars[i].t, price: c[i], r63: i + 63 < n ? c[i + 63] / c[i] - 1 : null, r126: i + 126 < n ? c[i + 126] / c[i] - 1 : null,
  });
  return { days: n, from: bars[0].t, to: bars[n - 1].t, setupDays: setup.filter(Boolean).length, nowInSetup: setup[n - 1], horizons, entryCount: entries.length, entries: entries.slice(-8).reverse() };
}
