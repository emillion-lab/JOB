import { getJson, warn, log } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

const MAX_REQUESTS = 60; // free-tier courtesy; a run that needs more is misconfigured

/** Adzuna aggregate API, one index per country. Needs ADZUNA_APP_ID / ADZUNA_APP_KEY. */
export default {
  id: 'adzuna',
  needs: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  async collect({ queries, settings, config }) {
    const app_id = process.env.ADZUNA_APP_ID;
    const app_key = process.env.ADZUNA_APP_KEY;
    const budget = Math.min(config.maxRequests ?? MAX_REQUESTS, MAX_REQUESTS);
    const jobs = [];
    let spent = 0;

    for (const market of settings.markets || []) {
      const places = market.locations?.length ? market.locations : [''];
      for (const where of places) {
        for (const what of queries) {
          if (spent >= budget) {
            warn(`adzuna: stopped at ${budget} requests; narrow markets, cities or queries`);
            return jobs;
          }
          const u = new URL(`https://api.adzuna.com/v1/api/jobs/${market.country}/search/1`);
          const params = {
            app_id, app_key, what,
            results_per_page: Math.min(settings.resultsPerQuery ?? 25, 50),
            max_days_old: settings.maxJobAgeDays ?? 30,
            'content-type': 'application/json'
          };
          if (where) params.where = where;
          Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));

          spent++;
          const data = await getJson(u, { label: `adzuna:${market.country}:${what}` });
          if (!data) continue; // one bad query must not kill the run
          for (const j of data.results || []) {
            const job = toJob({
              title: j.title,
              company: j.company?.display_name,
              location: j.location?.display_name,
              description: j.description,
              url: j.redirect_url,
              salary_min: j.salary_min,
              salary_max: j.salary_max,
              posted: j.created,
              sourceId: j.id,
              query: what,
              country: market.country
            }, 'adzuna');
            if (job) jobs.push(job);
          }
        }
      }
    }
    log(`  adzuna used ${spent} of ${budget} requests`);
    return jobs;
  }
};
