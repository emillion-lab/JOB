import { getJson } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/**
 * Official public job-board endpoints of the three common ATS vendors.
 * Add company board slugs in config/settings.json; nothing is scraped.
 */
const VENDORS = {
  greenhouse: {
    url: b => `https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`,
    list: d => d.jobs || [],
    map: (j, b) => ({
      title: j.title, company: j.company_name || b, location: j.location?.name,
      description: j.content, url: j.absolute_url, posted: j.updated_at, sourceId: j.id
    })
  },
  lever: {
    url: b => `https://api.lever.co/v0/postings/${b}?mode=json`,
    list: d => (Array.isArray(d) ? d : []),
    map: (j, b) => ({
      title: j.text, company: b, location: j.categories?.location,
      description: j.descriptionPlain || j.description, url: j.hostedUrl,
      posted: j.createdAt, sourceId: j.id
    })
  },
  ashby: {
    url: b => `https://api.ashbyhq.com/posting-api/job-board/${b}`,
    list: d => d.jobs || [],
    map: (j, b) => ({
      title: j.title, company: b, location: j.location, remote: j.isRemote,
      description: j.descriptionPlain || j.descriptionHtml, url: j.jobUrl,
      posted: j.publishedAt, sourceId: j.id
    })
  }
};

export function atsSource(vendor) {
  const v = VENDORS[vendor];
  return {
    id: vendor,
    async collect({ config }) {
      const jobs = [];
      for (const board of config.boards || []) {
        const data = await getJson(v.url(board), { label: `${vendor}:${board}` });
        if (!data) continue;
        for (const raw of v.list(data)) {
          const job = toJob(v.map(raw, board), vendor);
          if (job) jobs.push(job);
        }
      }
      return jobs;
    }
  };
}

export const vendors = Object.keys(VENDORS);
