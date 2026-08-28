import { getJson } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/**
 * Official public job-board endpoints of the common ATS vendors. Add company
 * board slugs in config/settings.json; nothing is scraped.
 *
 * The slug is visible in a company's careers URL:
 *   boards.greenhouse.io/SLUG, jobs.lever.co/SLUG, jobs.ashbyhq.com/SLUG,
 *   apply.workable.com/SLUG, jobs.smartrecruiters.com/SLUG, SLUG.recruitee.com
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
  workable: {
    url: b => `https://apply.workable.com/api/v1/widget/accounts/${b}?details=true`,
    list: d => d.jobs || [],
    map: (j, b) => ({
      title: j.title, company: j.name || b,
      location: [j.city, j.country].filter(Boolean).join(', '),
      remote: !!j.telecommuting, description: j.description,
      url: j.url || j.application_url, posted: j.published_on, sourceId: j.shortcode
    })
  },
  smartrecruiters: {
    url: b => `https://api.smartrecruiters.com/v1/companies/${b}/postings?limit=100`,
    list: d => d.content || [],
    map: (j, b) => ({
      title: j.name, company: b,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
      remote: !!j.location?.remote, description: j.jobAd?.sections?.jobDescription?.text,
      url: `https://jobs.smartrecruiters.com/${b}/${j.id}`, posted: j.releasedDate, sourceId: j.id
    })
  },
  recruitee: {
    url: b => `https://${b}.recruitee.com/api/offers/`,
    list: d => d.offers || [],
    map: (j, b) => ({
      title: j.title, company: j.company_name || b,
      location: [j.city, j.country].filter(Boolean).join(', '),
      remote: /remote/i.test(j.location || ''), description: j.description,
      url: j.careers_url || j.careers_apply_url, posted: j.published_at, sourceId: j.id
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
