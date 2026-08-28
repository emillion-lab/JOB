import { http, warn, log } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/**
 * Sweden. JobTech is the open API of Arbetsförmedlingen, the Swedish public
 * employment service: every ad on Platsbanken, no key and no registration.
 *
 * It is a real search endpoint, so unlike the Norwegian feed the queries are
 * sent to the server rather than filtered locally.
 */
const BASE = 'https://jobsearch.api.jobtechdev.se/search';

const text = v => (typeof v === 'string' ? v : v?.text || '');

export default {
  id: 'jobtech',
  country: 'se',
  async collect({ queries, settings, config }) {
    const limit = Math.min(settings.resultsPerQuery ?? 25, 100);
    const jobs = [];
    let described = false;

    for (const q of queries) {
      const u = new URL(BASE);
      u.searchParams.set('q', q);
      u.searchParams.set('limit', String(limit));
      if (config.municipality) u.searchParams.set('municipality', config.municipality);

      const res = await http(u, { label: `jobtech:${q}` });
      if (!res) continue;

      let data;
      try { data = await res.json(); } catch { warn(`jobtech: ${q} did not return JSON`); continue; }

      const hits = data?.hits || [];
      if (!Array.isArray(hits)) { warn(`jobtech: unexpected shape, keys ${Object.keys(data || {}).join(',')}`); continue; }
      if (!described && hits.length) {
        log(`  jobtech: hit keys ${Object.keys(hits[0]).slice(0, 10).join(',')}`);
        described = true;
      }

      for (const h of hits) {
        const place = h.workplace_address || {};
        const job = toJob({
          title: h.headline,
          company: h.employer?.name || h.employer?.workplace,
          location: [place.city || place.municipality, place.region].filter(Boolean).join(', ') || 'Sweden',
          remote: !!h.remote_work,
          description: text(h.description),
          url: h.webpage_url || h.application_details?.url || h.source_links?.[0]?.url,
          posted: h.publication_date,
          sourceId: h.id,
          query: q,
          country: 'se'
        }, 'jobtech');
        if (job) jobs.push(job);
      }
    }
    log(`  jobtech: ${jobs.length} from ${queries.length} queries`);
    return jobs;
  }
};
