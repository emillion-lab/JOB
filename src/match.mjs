import { llm, warn, log } from './lib.mjs';

const SYSTEM = `You match one candidate against job advertisements, conservatively.
Return JSON: {"matches":[{"id","score","fit","matched":[],"gaps":[],"disqualifiers":[],"reason","next_action"}]}
Rules:
- score 0-100. fit is one of: strong, plausible, stretch, weak.
- Separate evidence from assumption. Only cite skills the CV profile actually evidences.
- A missing must-have is a major penalty and belongs in disqualifiers.
- Respect the candidate's stated constraints (location, work permit, language, seniority).
- reason: max 2 sentences, concrete. next_action: one imperative sentence.
- Never assess protected traits (age, gender, nationality, health, family status).
- Return one entry per input job id, and nothing else.`;

const BATCH = 10;
const TRIM = 1800;

/** LLM scoring in batches; a failed batch falls back to the deterministic score. */
export async function matchJobs(jobs, profile, { maxJobs = 60 } = {}) {
  const subject = jobs.slice(0, maxJobs);
  const brief = {
    headline: profile.headline,
    seniority: profile.seniority,
    years_total: profile.years_total,
    skills: (profile.skills || []).map(s => (typeof s === 'string' ? s : `${s.name}${s.level ? ` (${s.level})` : ''}`)),
    domains: profile.domains, languages: profile.languages,
    certifications: profile.certifications, constraints: profile.constraints,
    transferable_strengths: profile.transferable_strengths,
    target_roles: (profile.target_roles || []).map(r => r.title)
  };

  const verdicts = new Map();
  for (let i = 0; i < subject.length; i += BATCH) {
    const batch = subject.slice(i, i + BATCH);
    const payload = batch.map(j => ({
      id: j.id, title: j.title, company: j.company, location: j.location,
      remote: j.remote, description: j.description.slice(0, TRIM)
    }));
    try {
      const out = await llm([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify({ candidate: brief, jobs: payload }) }
      ]);
      for (const m of out.matches || []) verdicts.set(String(m.id), m);
      log(`  scored ${Math.min(i + BATCH, subject.length)}/${subject.length}`);
    } catch (e) {
      warn(`batch ${i / BATCH + 1} failed, keeping keyword score: ${e.message}`);
    }
  }

  return subject.map(job => {
    const v = verdicts.get(job.id);
    if (!v) {
      return {
        ...job, score: job.prefilter?.score ?? 0, fit: 'unscored',
        matched: job.prefilter?.hits || [], gaps: [], disqualifiers: [],
        reason: 'Keyword score only — the language model did not return a verdict for this advertisement.',
        next_action: 'Read the advertisement yourself before deciding.', scoredBy: 'prefilter'
      };
    }
    return {
      ...job,
      score: clampScore(v.score), fit: v.fit || 'unrated',
      matched: arr(v.matched), gaps: arr(v.gaps), disqualifiers: arr(v.disqualifiers),
      reason: String(v.reason || ''), next_action: String(v.next_action || ''),
      scoredBy: 'llm'
    };
  });
}

const arr = v => (Array.isArray(v) ? v.map(String) : []);
const clampScore = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
