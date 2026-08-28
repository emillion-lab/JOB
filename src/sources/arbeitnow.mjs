import { getJson } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/** Arbeitnow free job board API: strong DACH coverage, no key required. */
export default {
  id: 'arbeitnow',
  async collect({ settings, config }) {
    const pages = Math.max(1, Math.min(config.pages ?? 3, 10));
    const jobs = [];
    for (let page = 1; page <= pages; page++) {
      const u = new URL('https://www.arbeitnow.com/api/job-board-api');
      u.searchParams.set('page', String(page));
      const data = await getJson(u, { label: `arbeitnow:p${page}` });
      if (!data?.data?.length) break;
      for (const j of data.data) {
        const job = toJob({
          title: j.title, company: j.company_name, location: j.location,
          remote: j.remote, description: j.description, url: j.url,
          posted: j.created_at, sourceId: j.slug,
          // This feed states a city, not a country, so it is inferred for the
          // dashboard filter. Unknown stays null rather than guessing.
          country: /schweiz|switzerland|zurich|zürich|basel|bern|zug|luzern/i.test(j.location || '') ? 'ch'
                 : /österreich|austria|wien|vienna|graz|linz/i.test(j.location || '') ? 'at'
                 : /deutschland|germany|münchen|munich|berlin|hamburg|stuttgart/i.test(j.location || '') ? 'de'
                 : null
        }, 'arbeitnow');
        if (job) jobs.push(job);
      }
    }
    // Board-wide feed, so it must be narrowed to the configured markets. The
    // cities come from markets; without them this source returns all of Europe.
    const wanted = (settings.markets || []).flatMap(m => m.locations || []).map(x => x.toLowerCase());
    return wanted.length
      ? jobs.filter(j => j.remote || wanted.some(w => `${j.location}`.toLowerCase().includes(w)))
      : jobs;
  }
};
