import { readJson, writeJson } from './lib.mjs';

const PATH = 'data/seen.json';
const KEEP_DAYS = 120;

/**
 * Memory between runs. Two jobs it does: never pay the LLM twice for the same
 * vacancy, and know which results are actually new since yesterday.
 */
export async function loadState() {
  const raw = await readJson(PATH, {});
  return raw && typeof raw === 'object' ? raw : {};
}

export function splitSeen(jobs, state) {
  const fresh = [];
  const known = [];
  for (const job of jobs) (state[job.id] ? known : fresh).push(job);
  return { fresh, known };
}

/** Reuse a stored verdict so a repeat sighting still shows up ranked. */
export function rehydrate(job, state) {
  const prev = state[job.id];
  return prev?.match ? { ...job, ...prev.match, firstSeen: prev.firstSeen, isNew: false } : null;
}

export async function saveState(state, scored, { redact = false } = {}) {
  const now = new Date().toISOString();
  for (const job of scored) {
    const prev = state[job.id];
    state[job.id] = {
      firstSeen: prev?.firstSeen || now,
      lastSeen: now,
      title: job.title,
      company: job.company,
      // seen.json is committed too, so it is redacted on the same rule as the report.
      match: redact
        ? { score: job.score ?? null, fit: job.fit ?? null, matched: [], gaps: [], disqualifiers: [], reason: '', next_action: '' }
        : {
            score: job.score ?? null, fit: job.fit ?? null,
            matched: job.matched || [], gaps: job.gaps || [],
            disqualifiers: job.disqualifiers || [], reason: job.reason || '',
            next_action: job.next_action || ''
          }
    };
  }
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const [id, entry] of Object.entries(state)) {
    if (new Date(entry.lastSeen || 0).getTime() < cutoff) delete state[id];
  }
  await writeJson(PATH, state);
  return state;
}
