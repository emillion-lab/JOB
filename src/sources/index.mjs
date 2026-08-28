import adzuna from './adzuna.mjs';
import remotive from './remotive.mjs';
import arbeitnow from './arbeitnow.mjs';
import feeds from './feeds.mjs';
import nav from './nav.mjs';
import jobtech from './jobtech.mjs';
import arbeitsagentur from './arbeitsagentur.mjs';
import francetravail from './francetravail.mjs';
import { atsSource, vendors } from './ats.mjs';
import { warn, log } from '../lib.mjs';

const REGISTRY = Object.fromEntries(
  [adzuna, remotive, arbeitnow, nav, jobtech, arbeitsagentur, francetravail, feeds, ...vendors.map(atsSource)]
    .map(s => [s.id, s])
);

/** Runs every enabled source. A dead source degrades the run, it does not end it. */
export async function collectAll({ queries, settings }) {
  const results = [];
  const stats = [];

  for (const [id, config] of Object.entries(settings.sources || {})) {
    if (!config?.enabled) continue;
    const source = REGISTRY[id];
    if (!source) { warn(`Unknown source "${id}" in settings.json`); continue; }

    // A source tied to one country is pointless when that country is not in
    // the active markets — otherwise picking "ch" still returns Swedish jobs.
    const countries = (settings.markets || []).map(m => m.country);
    if (source.country && !countries.includes(source.country)) {
      log(`  ${id}: skipped, ${source.country} is not in the active markets`);
      continue;
    }

    const missing = (source.needs || []).filter(k => !process.env[k]);
    if (missing.length) {
      warn(`Skipping ${id}: missing ${missing.join(', ')}`);
      stats.push({ source: id, collected: 0, status: `missing ${missing.join(', ')}` });
      continue;
    }

    try {
      const jobs = await source.collect({ queries, settings, config });
      results.push(...jobs);
      stats.push({ source: id, collected: jobs.length, status: 'ok' });
      log(`  ${id}: ${jobs.length}`);
    } catch (e) {
      warn(`${id} failed: ${e.message}`);
      stats.push({ source: id, collected: 0, status: `error: ${e.message}` });
    }
  }
  return { jobs: results, stats };
}

export const availableSources = Object.keys(REGISTRY);
