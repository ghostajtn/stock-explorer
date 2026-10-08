// Tags a news headline so the UI can split "Deals" from plain news.
// Returned tag is one of: 'deal' | 'analyst' | 'earnings' | 'news'

/**
 * Does this headline describe a business deal — M&A, partnership, supply
 * contract, investment, financing, licensing — i.e. something that moves
 * future revenue or ownership?
 *
 * TODO(human): implement this (roughly 5-10 lines). Return true/false.
 */
function isDealHeadline(title) {
  const t = title.toLowerCase();
  // Placeholder: nothing is a deal until you decide what counts.
  return false;
}

export function classifyHeadline(title) {
  const t = title.toLowerCase();
  if (isDealHeadline(title)) return 'deal';
  if (/price target|upgrade|downgrade|initiates|reiterates|raises target|cuts target|outperform|overweight|rating/.test(t)) return 'analyst';
  if (/earnings|eps|revenue|guidance|quarter|q[1-4]\b|results|forecast/.test(t)) return 'earnings';
  return 'news';
}
