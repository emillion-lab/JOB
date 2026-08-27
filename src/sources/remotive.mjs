import { getJson } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/** Remotive public API: remote-only roles, no key required. */
export default {
  id: 'remotive',
  async collect({ queries, settings }) {
    const jobs = [];
    for (const search of queries) {
      const u = new URL('https://remotive.com/api/remote-jobs');
      u.searchParams.set('search', search);
      u.searchParams.set('limit', String(Math.min(settings.resultsPerQuery ?? 25, 50)));
      const data = await getJson(u, { label: `remotive:${search}` });
      for (const j of data?.jobs || []) {
        const job = toJob({
          title: j.title, company: j.company_name,
          location: j.candidate_required_location, remote: true,
          description: j.description, url: j.url,
          salary_text: j.salary, posted: j.publication_date,
          sourceId: j.id, query: search
        }, 'remotive');
        if (job) jobs.push(job);
      }
    }
    return jobs;
  }
};
