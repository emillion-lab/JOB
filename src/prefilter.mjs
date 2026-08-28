import { clean } from './lib.mjs';

const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9+#.\-\s]/g, ' ').replace(/\s+/g, ' ');

/**
 * Vocabulary comes from the candidate's own profile, never from a hard-coded
 * taxonomy: skill names, domains, languages, certifications and target titles.
 */
export function profileVocabulary(profile) {
  const push = (set, v) => { const t = norm(v); if (t.length > 2) set.add(t); };
  const skills = new Set();
  const titles = new Set();

  for (const s of profile.skills || []) push(skills, s?.name ?? s);
  for (const d of profile.domains || []) push(skills, d);
  for (const l of profile.languages || []) push(skills, typeof l === 'string' ? l : l?.name);
  for (const c of profile.certifications || []) push(skills, typeof c === 'string' ? c : c?.name);
  for (const r of profile.target_roles || []) {
    push(titles, r?.title ?? r);
    for (const q of r?.queries || []) push(titles, q);
  }
  return { skills: [...skills], titles: [...titles] };
}

/**
 * Cheap, transparent 0-100 relevance signal. Its job is ranking for triage,
 * not judging fit — that stays with the match stage.
 */
export function prefilterScore(job, vocab, settings) {
  const haystack = norm(`${job.title} ${job.company} ${job.description}`);
  const titleHay = norm(job.title);

  const excluded = (settings.excludedTerms || []).map(norm).filter(t => t && haystack.includes(t));
  if (excluded.length) return { score: 0, hits: [], excluded };

  const hits = vocab.skills.filter(t => haystack.includes(t));
  const titleHits = vocab.titles.filter(t => titleHay.includes(t) || t.split(' ').every(w => titleHay.includes(w)));
  const preferred = (settings.preferredTerms || []).map(norm).filter(t => t && haystack.includes(t));

  // A job title that matches what you are looking for is the strongest single
  // signal there is, so it carries the most weight. Requiring hits across the
  // whole skill list was too harsh: a handful of them already means a lot.
  const skillRatio = vocab.skills.length ? hits.length / Math.min(vocab.skills.length, 8) : 0;
  const score = Math.round(Math.min(100,
    Math.min(titleHits.length, 2) * 20 +
    Math.min(1, skillRatio) * 45 +
    Math.min(preferred.length, 3) * 5 +
    (job.description.length > 300 ? 5 : 0)
  ));

  return { score, hits: [...new Set([...titleHits, ...hits])].slice(0, 12), excluded: [] };
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
