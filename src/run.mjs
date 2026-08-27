import fs from 'node:fs/promises';
import { loadSettings, readJson, log, warn, profileIsUsable } from './lib.mjs';
import { buildProfile } from './profile.mjs';
import { collectAll } from './sources/index.mjs';
import { dedupe, isFresh } from './normalize.mjs';
import { prefilter } from './prefilter.mjs';
import { matchJobs } from './match.mjs';
import { loadState, splitSeen, rehydrate, saveState } from './state.mjs';
import { writeReport, digest } from './report.mjs';

const settings = await loadSettings();

// A scheduled run must be able to build its own profile. The placeholder that
// ships with the repository is not a profile, and parsing it is not a success.
let profile = await readJson('data/profile.json');
if (process.env.REBUILD_PROFILE === 'true' || !profileIsUsable(profile)) {
  log(profileIsUsable(profile) ? 'Rebuilding profile from CV.' : 'No usable profile on disk, building one from the CV.');
  profile = await buildProfile();
}

const queries = [...new Set(
  (profile.target_roles || []).flatMap(r => (r.queries?.length ? r.queries : [r.title])).map(q => String(q).trim()).filter(Boolean)
)].slice(0, settings.maxQueries);

if (!queries.length) throw new Error('Profile produced no search queries. Check data/profile.json.');
log(`Queries: ${queries.join(' | ')}`);

log('Collecting:');
const { jobs: raw, stats } = await collectAll({ queries, settings });
const collected = dedupe(raw).filter(j => isFresh(j, settings.maxJobAgeDays));
log(`Collected ${raw.length} records -> ${collected.length} unique, in-date vacancies`);

const { kept, dropped, excluded } = prefilter(collected, profile, settings);
log(`Pre-filter kept ${kept.length} (dropped ${dropped}, ${excluded} on excluded terms)`);

const state = await loadState();
const { fresh, known } = splitSeen(kept, state);
const reused = known.map(j => rehydrate(j, state)).filter(Boolean);
const rescore = known.filter(j => !rehydrate(j, state));
log(`${fresh.length} new to score, ${reused.length} reused from previous runs`);

const scored = await matchJobs(
  [...fresh, ...rescore].map(j => ({ ...j, isNew: !state[j.id] })),
  profile,
  { maxJobs: settings.maxLlmJobs ?? settings.prefilterKeep ?? 60 }
);

await saveState(state, scored);

const all = [...scored, ...reused]
  .filter(j => (j.score || 0) >= settings.minimumScore)
  .sort((a, b) => (b.isNew === a.isNew ? 0 : b.isNew ? 1 : -1) || (b.score || 0) - (a.score || 0));

const report = {
  generatedAt: new Date().toISOString(),
  settings: { countries: settings.countries, locations: settings.locations, minimumScore: settings.minimumScore, maxJobAgeDays: settings.maxJobAgeDays },
  profileSummary: {
    headline: profile.headline, seniority: profile.seniority ?? null,
    target_roles: (profile.target_roles || []).map(r => r.title)
  },
  searchedQueries: queries,
  sources: stats,
  totalCollected: collected.length,
  totalScored: scored.length,
  llmScored: scored.filter(j => j.scoredBy === 'llm').length,
  totalMatched: all.length,
  totalNew: all.filter(j => j.isNew).length,
  jobs: all.map(({ prefilter: pf, ...j }) => ({ ...j, keywordScore: pf?.score ?? null }))
};

await writeReport(report);
log(`Kept ${all.length} above score ${settings.minimumScore}; ${report.totalNew} are new.`);

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, digest(report) + '\n');
}
if (!all.length) warn('No matches above threshold. Consider lowering minimumScore or adding sources.');
