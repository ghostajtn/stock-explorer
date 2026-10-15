// Tags a news headline so the UI can split "Deals" from plain news.
// Returned tag is one of: 'deal' | 'analyst' | 'earnings' | 'news'

/**
 * Does this headline describe a business deal — M&A, partnership, supply
 * contract, investment, financing, licensing — i.e. something that moves
 * future revenue or ownership?
 */
const DEAL_WORDS = [
  'acqui(?:re|res|red|sition|sitions)', 'merger', 'merge(?:s|d)? with', 'buyout', 'takeover', 'take(?:s)? private',
  'to buy\\b', 'buys\\b', 'bought\\b', 'agrees? to (?:buy|sell|acquire)', 'divest', 'spin-?off', 'carve-?out',
  'partner(?:s|ed|ship|ships)?\\b', 'joint venture', 'strategic (?:alliance|investment)', 'collaborat(?:es|ion|ing)',
  'signs?\\b.*\\b(?:deal|contract|agreement)', 'inks?\\b', 'lands?\\b.*\\b(?:contract|order|deal)', 'wins?\\b.*\\b(?:contract|order|award)',
  'awarded', 'supply (?:deal|agreement|contract)', 'licens(?:e|es|ing) (?:deal|agreement)', 'offtake',
  'invests? \\$?[\\d.]+', 'investment of \\$?[\\d.]+', 'stake in', 'funding round', 'raises? \\$[\\d.]+',
  'notes offering', 'debt offering', 'private placement', 'secures? (?:financing|funding|\\$[\\d.]+)',
];
// Word patterns must start at a word boundary ("inks" must not match inside "Starlink").
const DEAL_RE = new RegExp(`\\b(?:${DEAL_WORDS.join('|')})|\\$[\\d.,]+\\s?(?:billion|million|b|m)\\b.*\\b(?:deal|contract|agreement|investment|order)`, 'i');
// Consumer "deals" (sales, discounts, shopping events) are not business deals.
const NOT_DEAL_RE = /black friday|cyber monday|prime day|best deals?|top deals?|deals? of the day|discount|coupon|promo code|on sale\b/i;

function isDealHeadline(title) {
  return DEAL_RE.test(title) && !NOT_DEAL_RE.test(title);
}

export function classifyHeadline(title) {
  const t = title.toLowerCase();
  if (isDealHeadline(title)) return 'deal';
  if (/price target|upgrade|downgrade|initiates|reiterates|raises target|cuts target|outperform|overweight|rating/.test(t)) return 'analyst';
  if (/earnings|eps|revenue|guidance|quarter|q[1-4]\b|results|forecast/.test(t)) return 'earnings';
  return 'news';
}
