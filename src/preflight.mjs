import { loadSettings, readJson, profileIsUsable, log } from './lib.mjs';

/**
 * Fails fast with a message that names the missing thing, instead of dying
 * three steps later inside an API call. Also prints the plan for this run.
 */
const settings = await loadSettings();
const profile = await readJson('data/profile.json') || await readJson('config/profile.json');
const haveProfile = profileIsUsable(profile);
const willUseLlm = settings.useLlm !== false;
const problems = [];

if (!haveProfile && !process.env.CV_TEXT_B64) {
  problems.push('No usable profile in data/profile.json or config/profile.json, and no CV_TEXT_B64 secret to build one from.');
}
if (!haveProfile && !willUseLlm) {
  problems.push('useLlm is false, so the profile cannot be built from a CV. Fill in config/profile.json by hand.');
}
if (willUseLlm && !process.env.LLM_API_KEY) {
  problems.push('useLlm is true but LLM_API_KEY is not set. Add the secret, or set "useLlm": false in config/settings.json for keyword-only scoring.');
}

const sources = Object.entries(settings.sources || {}).filter(([, c]) => c?.enabled).map(([id]) => id);
if (!sources.length) problems.push('No sources are enabled in config/settings.json.');
if (!settings.markets?.length) problems.push('No markets configured.');
if (settings.sources?.adzuna?.enabled && !process.env.ADZUNA_APP_ID) {
  log('! adzuna is enabled but ADZUNA_APP_ID is missing — that source will be skipped.');
}
if (settings.sources?.nav?.enabled && !process.env.NAV_TOKEN) {
  log('! nav is enabled without NAV_TOKEN — the rotating public token will be used. Request your own from nav.team.arbeidsplassen@nav.no');
}

const requests = (settings.markets || [])
  .reduce((n, m) => n + Math.max(1, (m.locations || []).length) * (settings.maxQueries ?? 8), 0);
if (settings.sources?.adzuna?.enabled && requests > (settings.sources.adzuna.maxRequests ?? 60)) {
  log(`! adzuna would need ${requests} requests but is capped; later markets will be cut short.`);
}

log(`Profile: ${haveProfile ? profile.headline : 'to be built from CV'}`);
log(`Scoring: ${willUseLlm ? `model above keyword ${settings.llmMinKeywordScore ?? 0}, max ${settings.maxLlmJobs ?? 40}/run` : 'keyword only, no API calls'}`);
log(`Markets: ${(settings.markets || []).map(m => `${m.country}(${(m.locations || []).length})`).join(' ')}`);
log(`Sources: ${sources.join(', ')}`);
log(`Report: ${settings.publicReport === true ? 'redacted for a public repository' : 'full detail'}`);

if (problems.length) {
  console.error('\nCannot run:\n' + problems.map(p => `  - ${p}`).join('\n'));
  process.exit(1);
}
