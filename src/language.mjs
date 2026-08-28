/**
 * Which language is this advertisement written in?
 *
 * Function words are the giveaway: they are frequent, short, and rarely shared
 * across these languages. No dependency, no model, and good enough to separate
 * a German advertisement from an English one. It cannot tell you that an English
 * advertisement demands fluent German — that is stated in the prose, and only
 * the matching stage will catch it.
 */
const MARKERS = {
  en: ['the', 'and', 'you', 'our', 'with', 'for', 'are', 'will', 'your', 'this', 'that', 'have', 'from', 'work', 'team', 'we'],
  de: ['und', 'der', 'die', 'das', 'mit', 'für', 'von', 'sie', 'wir', 'ein', 'eine', 'bei', 'zur', 'den', 'ist', 'im'],
  no: ['og', 'som', 'til', 'med', 'for', 'har', 'vi', 'du', 'av', 'ikke', 'er', 'en', 'et', 'på', 'våre', 'deg'],
  fr: ['le', 'la', 'les', 'des', 'une', 'vous', 'nous', 'pour', 'avec', 'dans', 'est', 'sur', 'aux', 'par', 'que', 'du'],
  it: ['il', 'la', 'di', 'che', 'per', 'con', 'del', 'una', 'sono', 'nel', 'gli', 'alla', 'come', 'più', 'noi', 'anche']
};

const MIN_WORDS = 25;   // below this a verdict is guesswork
const MIN_LEAD = 1.25;  // the winner must be clearly ahead of the runner-up

export function detectLanguage(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-zà-öø-ÿ\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) return 'unknown';

  const counts = new Map(words.map(w => [w, 0]));
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);

  const scores = Object.entries(MARKERS)
    .map(([lang, markers]) => [lang, markers.reduce((n, m) => n + (counts.get(m) || 0), 0)])
    .sort((a, b) => b[1] - a[1]);

  const [best, bestScore] = scores[0];
  const runnerUp = scores[1][1];
  if (bestScore < 3) return 'unknown';
  if (runnerUp > 0 && bestScore / runnerUp < MIN_LEAD) return 'unknown';
  return best;
}

/** Unknown is always kept: silence is not evidence of the wrong language. */
export function languageAllowed(job, allowed) {
  if (!allowed?.length) return true;
  return job.language === 'unknown' || allowed.includes(job.language);
}
