// Headline sentiment: AFINN-165 word scores (MIT, via the afinn-165 package; the word list is
// by Finn Årup Nielsen) plus finance-specific overrides, since AFINN knows "cut" and "beat"
// as everyday words but not what they mean on a trading desk.
import fs from 'node:fs';

const AFINN = JSON.parse(fs.readFileSync(new URL('./sentiment-afinn165.json', import.meta.url), 'utf8'));

const FINANCE = {
  beat: 3, beats: 3, surge: 3, surges: 3, soar: 3, soars: 3, jump: 2, jumps: 2, rally: 2, rallies: 2, rebound: 2,
  upgrade: 3, upgrades: 3, upgraded: 3, outperform: 2, overweight: 1, record: 2, buyback: 2, raises: 2, raised: 2,
  miss: -3, misses: -3, missed: -3, plunge: -3, plunges: -3, tumble: -3, tumbles: -3, slump: -3, slumps: -3, sink: -2, sinks: -2,
  downgrade: -3, downgrades: -3, downgraded: -3, underperform: -2, underweight: -1, cut: -2, cuts: -2, lawsuit: -2, probe: -2,
  recall: -2, layoffs: -2, bankruptcy: -4, fraud: -4, selloff: -3, warning: -2, warns: -2, delay: -1, delays: -1, fine: -1, fined: -2,
};
const NEGATORS = new Set(['not', 'no', 'never', "isn't", "won't", "doesn't", "didn't", 'without']);

/** Sum of word scores for a headline; a negator flips the next scored word. */
export function sentimentScore(title) {
  let score = 0, flip = false;
  for (const w of title.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean)) {
    if (NEGATORS.has(w)) { flip = true; continue; }
    const v = FINANCE[w] ?? AFINN[w];
    if (v !== undefined) { score += flip ? -v : v; flip = false; }
  }
  return score;
}

/** 'pos' | 'neg' | 'neu' — needs a clear signal (|score| >= 2) so one mild word doesn't colour a headline. */
export function sentimentLabel(title) {
  const s = sentimentScore(title);
  return s >= 2 ? 'pos' : s <= -2 ? 'neg' : 'neu';
}
