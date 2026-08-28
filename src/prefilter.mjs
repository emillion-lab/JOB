import { clean } from './lib.mjs';

const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9+#.\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);

/** Whole-word match. Substring matching finds "it" inside "facility" and "sla" inside "translate". */
const hasWord = (haySet, word) => haySet.has(word);

/** Multi-word terms must appear as a contiguous run, so "service manager" ≠ "Services ... Manager". */
function hasPhrase(hayWords, phraseWords) {
  if (!phraseWords.length) return false;
  if (phraseWords.length === 1) return hayWords.includes(phraseWords[0]);
  outer: for (let i = 0; i + phraseWords.length <= hayWords.length; i++) {
    for (let j = 0; j < phraseWords.length; j++) if (hayWords[i + j] !== phraseWords[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Vocabulary comes from the candidate's own profile, never from a hard-coded
 * taxonomy: skill names, domains, languages, certifications and target titles.
 */
export function profileVocabulary(profile) {
  const push = (list, v) => { const w = words(v); if (w.length && norm(v).length > 2) list.push({ text: norm(v), words: w }); };
  const skills = [];
  const titles = [];

  for (const s of profile.skills || []) push(skills, s?.name ?? s);
  for (const d of profile.domains || []) push(skills, d);
  for (const l of profile.languages || []) push(skills, typeof l === 'string' ? l : l?.name);
  for (const c of profile.certifications || []) push(skills, typeof c === 'string' ? c : c?.name);
  for (const r of profile.target_roles || []) {
    push(titles, r?.title ?? r);
    for (const q of r?.queries || []) push(titles, q);
  }
  const uniq = list => [...new Map(list.map(t => [t.text, t])).values()];
  return { skills: uniq(skills), titles: uniq(titles) };
}

/**
 * Cheap, transparent 0-100 relevance signal. Its job is ranking for triage,
 * not judging fit — that stays with the match stage.
 */
export function prefilterScore(job, vocab, settings) {
  const hayWords = words(`${job.title} ${job.company} ${job.description}`);
  const haySet = new Set(hayWords);
  const titleWords = words(job.title);
  const titleSet = new Set(titleWords);

  const excluded = (settings.excludedTerms || [])
    .map(t => ({ text: norm(t), words: words(t) }))
    .filter(t => t.text && hasPhrase(hayWords, t.words))
    .map(t => t.text);
  if (excluded.length) return { score: 0, hits: [], excluded };

  // How well does the job title match a role the candidate is actually after?
  let titlePoints = 0;
  let bestTitle = null;
  for (const t of vocab.titles) {
    const covered = t.words.filter(w => titleSet.has(w)).length / t.words.length;
    const points = covered === 1 ? (hasPhrase(titleWords, t.words) ? 50 : 35) : covered >= 0.75 ? 12 : 0;
    if (points > titlePoints) { titlePoints = points; bestTitle = t.text; }
  }

  const hits = vocab.skills.filter(s => (s.words.length === 1 ? hasWord(haySet, s.words[0]) : hasPhrase(hayWords, s.words)));
  const preferred = (settings.preferredTerms || [])
    .map(t => ({ text: norm(t), words: words(t) }))
    .filter(t => t.text && hasPhrase(hayWords, t.words));

  const skillRatio = vocab.skills.length ? Math.min(1, hits.length / Math.min(vocab.skills.length, 8)) : 0;
  const score = Math.round(Math.min(100,
    titlePoints +
    skillRatio * 40 +
    Math.min(preferred.length, 3) * 5 +
    (job.description.length > 300 ? 5 : 0)
  ));

  const hitNames = [...new Set([...(bestTitle ? [bestTitle] : []), ...hits.map(h => h.text)])];
  return { score, hits: hitNames.slice(0, 12), excluded: [] };
}

/** Rank by cheap signal, keep the top slice, and report what was dropped and why. */
export function prefilter(jobs, profile, settings) {
  const vocab = profileVocabulary(profile);
  const scored = jobs.map(job => ({ ...job, prefilter: prefilterScore(job, vocab, settings) }));
  const excluded = scored.filter(j => j.prefilter.excluded.length);
  const kept = scored
    .filter(j => !j.prefilter.excluded.length)
    .sort((a, b) => b.prefilter.score - a.prefilter.score)
    .slice(0, settings.prefilterKeep ?? 60);

  return { kept, dropped: scored.length - kept.length, excluded: excluded.length, vocab };
}
