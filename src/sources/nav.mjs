import { getJson, getText, warn, log } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/**
 * Norway. NAV's Arbeidsplassen feed is the official public source and holds most
 * publicly advertised Norwegian vacancies (FINN.no listings are not included).
 * It is a change feed, not a search endpoint, so recent pages are pulled and
 * filtered locally against the profile queries.
 *
 * A stable token is issued on request by nav.team.arbeidsplassen@nav.no; set it
 * as the NAV_TOKEN secret. Without one, the rotating public experiment token is
 * used, which is fine for trying it out and not for relying on.
 */
const BASE = 'https://pam-stilling-feed.nav.no/api/v1';

async function token() {
  if (process.env.NAV_TOKEN) return process.env.NAV_TOKEN;
  const t = (await getText('https://pam-stilling-feed.nav.no/api/publicToken', { label: 'nav:publicToken' }) || '').trim();
  if (t) warn('nav: using the rotating public token. Request your own from nav.team.arbeidsplassen@nav.no');
  return t || null;
}

const text = v => (typeof v === 'string' ? v : '');

export default {
  id: 'nav',
  async collect({ queries, settings, config }) {
    const key = await token();
    if (!key) { warn('nav: no token available, skipping'); return []; }

    const headers = { authorization: `Bearer ${key}` };
    const pages = Math.max(1, Math.min(config.pages ?? 4, 20));
    const terms = queries.map(q => q.toLowerCase());
    const jobs = [];
    let url = `${BASE}/feed?size=100`;

    for (let page = 0; page < pages && url; page++) {
      const data = await getJson(url, { headers, label: `nav:feed:${page}` });
      const items = data?.items || [];
      if (!items.length) break;

      for (const item of items) {
        const ad = item.content?.ad || item.ad || item.content || {};
        const title = text(ad.title);
        if (!title) continue;
        const body = `${title} ${text(ad.description)}`.toLowerCase();
        if (terms.length && !terms.some(t => body.includes(t))) continue;

        const place = ad.workLocations?.[0] || ad.workLocation || {};
        const job = toJob({
          title,
          company: ad.employer?.name || ad.businessName,
          location: [place.city, place.county].filter(Boolean).join(', ') || 'Norway',
          remote: /hjemmekontor|remote/i.test(body),
          description: ad.description,
          url: ad.applicationUrl || ad.sourceurl ||
               (item.uuid ? `https://arbeidsplassen.nav.no/stillinger/stilling/${item.uuid}` : null),
          posted: ad.published || item.published,
          sourceId: item.uuid || ad.uuid,
          country: 'no'
        }, 'nav');
        if (job) jobs.push(job);
      }

      const next = data.next_url || data.nextUrl;
      url = next ? (next.startsWith('http') ? next : `https://pam-stilling-feed.nav.no${next}`) : null;
    }

    log(`  nav: ${jobs.length} after local filtering`);
    return jobs;
  }
};
