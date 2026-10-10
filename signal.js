// "Buy setup" checklist. Not advice: it scores how many of a fixed set of conditions a stock meets
// right now (analyst consensus, headline sentiment short/long term, trend, fundamentals) and shows
// every reason, so the user can judge it. Pure function: no network, easy to test.

const DAY = 864e5;

function rsi14(closes) {
  if (!closes || closes.length < 15) return null;
  let gain = 0, loss = 0, out = null;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= 14) { gain += g; loss += l; if (i === 14) { gain /= 14; loss /= 14; } } else { gain = (gain * 13 + g) / 14; loss = (loss * 13 + l) / 14; }
    if (i >= 14) out = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

const num = (v) => typeof v === 'number' && isFinite(v) ? v : null;

/** @param s stock summary object from /api/stock/:sym  @param closes daily closes (oldest first) */
export function computeSignal(s, closes, now = Date.now()) {
  const fd = s.financialData || {}, sd = s.summaryDetail || {}, ks = s.defaultKeyStatistics || {}, px = num(s.price?.regularMarketPrice);
  const rt = s.recommendationTrend?.trend?.[0];
  const checks = [];
  // pass: true/false, or null when the data isn't available (scores 0 and is shown as "no data")
  const add = (group, label, pass, detail, weight) => checks.push({ group, label, pass, detail, weight });

  // --- analysts (35)
  const total = rt ? rt.strongBuy + rt.buy + rt.hold + rt.sell + rt.strongSell : 0;
  const buyPct = total ? (rt.strongBuy + rt.buy) / total : null;
  add('Analysts', 'Strong analyst consensus (70%+ rate it a Buy)', buyPct == null ? null : buyPct >= 0.7,
    buyPct == null ? 'No analyst ratings' : `${Math.round(buyPct * 100)}% of ${total} analysts say Buy` + (num(fd.recommendationMean) ? ` (mean ${fd.recommendationMean.toFixed(1)} of 5, 1 = Strong buy)` : ''), 20);
  const up = num(fd.targetMeanPrice) && px ? fd.targetMeanPrice / px - 1 : null;
  add('Analysts', 'Average price target is 15%+ above the price', up == null ? null : up >= 0.15,
    up == null ? 'No price target' : `Target $${fd.targetMeanPrice.toFixed(2)} is ${(up * 100).toFixed(1)}% ${up >= 0 ? 'above' : 'below'} the price`, 15);

  // --- news (25): headline wording over the last 7 days, plus the 90-day analyst-action trend
  const recent = (s.news || []).filter((n) => n.ts && now - n.ts <= 7 * DAY);
  const r = { pos: recent.filter((n) => n.sentiment === 'pos').length, neg: recent.filter((n) => n.sentiment === 'neg').length };
  add('News', 'Short-term news (last 7 days) is clearly bullish', recent.length < 3 ? null : r.pos >= 2 * r.neg && r.pos - r.neg >= 3,
    recent.length < 3 ? `Only ${recent.length} recent headlines` : `${r.pos} positive vs ${r.neg} negative of ${recent.length} headlines`, 15);
  // The headline feed only reaches back about a week, so "longer-term news" = what analysts did over 90 days
  // (upgrades vs downgrades); if there were fewer than 2 rating changes, fall back to next-year estimate growth.
  const acts = (s.upgradeDowngradeHistory?.history || []).filter((h) => h.epochGradeDate && now - h.epochGradeDate * 1000 <= 90 * DAY);
  const ups = acts.filter((h) => h.action === 'up').length, downs = acts.filter((h) => h.action === 'down').length;
  const yr = (s.earningsTrend?.trend || []).find((t) => t.period === '+1y'), eGr = num(yr?.earningsEstimate?.growth), rGr = num(yr?.revenueEstimate?.growth);
  let longPass = null, longDetail = 'No rating changes or estimates';
  if (ups + downs >= 2) { longPass = ups > downs && ups >= 2; longDetail = `${ups} analyst upgrades vs ${downs} downgrades in the last 90 days`; }
  else if (eGr != null || rGr != null) { longPass = (eGr ?? 0) > 0.1 && (rGr ?? 0) > 0.05; longDetail = `Next-year estimates: EPS ${eGr == null ? 'n/a' : (eGr * 100).toFixed(0) + '%'}, revenue ${rGr == null ? 'n/a' : (rGr * 100).toFixed(0) + '%'} growth (few recent rating changes)`; }
  add('News', 'Longer-term news (90-day analyst changes) is bullish', longPass, longDetail, 10);

  // --- trend (25)
  const ma50 = num(sd.fiftyDayAverage), ma200 = num(sd.twoHundredDayAverage), rsi = rsi14(closes);
  add('Trend', 'Price is above the 200-day average', ma200 && px ? px > ma200 : null, ma200 && px ? `${px.toFixed(2)} vs 200-day ${ma200.toFixed(2)}` : 'No data', 5);
  const ext = ma200 && px ? px / ma200 - 1 : null;
  add('Trend', 'Not stretched (within 20% of the 200-day average)', ext == null ? null : ext <= 0.20, ext == null ? 'No data' : `Price is ${(ext * 100).toFixed(1)}% ${ext >= 0 ? 'above' : 'below'} the 200-day average`, 5);
  add('Trend', '50-day average is above the 200-day (golden cross)', ma50 && ma200 ? ma50 > ma200 : null, ma50 && ma200 ? `50-day $${ma50.toFixed(2)} vs 200-day $${ma200.toFixed(2)}` : 'No data', 5);
  add('Trend', 'Healthy momentum (RSI between 40 and 65)', rsi == null ? null : rsi >= 40 && rsi <= 65, rsi == null ? 'Not enough price history' : `RSI is ${rsi.toFixed(1)}`, 10);

  // --- fundamentals (15)
  const eg = num(ks.forwardEps) != null && num(ks.trailingEps) > 0 ? ks.forwardEps / ks.trailingEps - 1 : null;
  add('Fundamentals', 'Earnings expected to grow (forward EPS above TTM)', eg == null ? null : eg > 0, eg == null ? 'No data' : `Forward EPS is ${(eg * 100).toFixed(0)}% ${eg >= 0 ? 'above' : 'below'} trailing`, 7);
  const rg = num(fd.revenueGrowth);
  add('Fundamentals', 'Revenue is growing', rg == null ? null : rg > 0, rg == null ? 'No data' : `Revenue growth ${(rg * 100).toFixed(1)}%`, 8);

  const score = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);
  const known = checks.filter((c) => c.pass !== null).length;
  const get = (label) => checks.find((c) => c.label.startsWith(label))?.pass;
  // The user's rule: analysts say buy AND short-term news AND long-term news are bullish (plus a healthy, not-overbought trend).
  const rule = get('Strong analyst') === true && get('Short-term news') === true && get('Longer-term news') === true &&
    get('Price is above') !== false && get('Healthy momentum') !== false;
  const verdict = known < 5 ? 'nodata' : rule && score >= 85 ? 'buy' : score >= 55 ? 'watch' : score >= 35 ? 'neutral' : 'caution';
  return { symbol: s.symbol, price: px, score, verdict, rule, known, checks, asOf: now };
}
