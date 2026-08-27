import { getJson } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/** Adzuna aggregate API. Needs ADZUNA_APP_ID / ADZUNA_APP_KEY. */
export default {
  id: 'adzuna',
  needs: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  async collect({ queries, settings }) {
    const app_id = process.env.ADZUNA_APP_ID;
    const app_key = process.env.ADZUNA_APP_KEY;
    const countries = settings.countries?.length ? settings.countries : ['gb'];
    const places = settings.locations?.length ? settings.locations : [''];
    const jobs = [];

    for (const country of countries) {
      for (const where of places) {
        for (const what of queries) {
          const u = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
          const params = {
            app_id, app_key, what,
            results_per_page: Math.min(settings.resultsPerQuery ?? 25, 50),
            max_days_old: settings.maxJobAgeDays ?? 30,
            'content-type': 'application/json'
          };
          if (where) params.where = where;
          Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));

          const data = await getJson(u, { label: `adzuna:${country}:${what}` });
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
              query: what
            }, 'adzuna');
            if (job) jobs.push(job);
          }
        }
      }
    }
    return jobs;
  }
};
