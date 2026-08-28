import { http, getText, warn, log } from '../lib.mjs';
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
  if (process.env.NAV_TOKEN) {
    log('  nav: using NAV_TOKEN');
    return process.env.NAV_TOKEN;
  }
  const raw = await getText('https://pam-stilling-feed.nav.no/api/publicToken', { label: 'nav:publicToken' });
  const t = (raw || '').trim().replace(/^"|"$/g, '');
  if (!t) { warn('nav: could not fetch the public token'); return null; }
  warn(`nav: using the rotating public token (${t.length} chars). Request your own from nav.team.arbeidsplassen@nav.no`);
  return t;
}

const text = v => (typeof v === 'string' ? v : '');

/** The feed has changed shape before; find the ad wherever it is nested. */
const adOf = item => item?.content?.ad || item?.ad || item?.content || item || {};

export default {
  id: 'nav',
  country: 'no',
  async collect({ queries, config }) {
    const key = await token();
    if (!key) return [];

    const headers = { authorization: `Bearer ${key}` };
    const pages = Math.max(1, Math.min(config.pages ?? 4, 20));
    const terms = queries.map(q => q.toLowerCase());
    const jobs = [];
    let url = `${BASE}/feed?size=100`;
    let seen = 0;
    let described = false;

    for (let page = 0; page < pages && url; page++) {
      const res = await http(url, { headers, label: `nav:feed:${page}` });
      if (!res) { warn(`nav: feed page ${page} returned nothing — check the token`); break; }

      let data;
      try { data = await res.json(); } catch { warn('nav: feed did not return JSON'); break; }

      const items = data?.items || data?.entries || data?.content || [];
      if (!Array.isArray(items) || !items.length) {
        warn(`nav: page ${page} had no items; top-level keys were ${Object.keys(data || {}).join(', ') || 'none'}`);
        break;
      }
      seen += items.length;

      // One line, once, so a shape change is visible in the log instead of
      // showing up as a silent zero three runs later.
      if (!described) {
        const ad = adOf(items[0]);
        log(`  nav: item keys ${Object.keys(items[0]).slice(0, 8).join(',')} | ad keys ${Object.keys(ad).slice(0, 10).join(',')}`);
        described = true;
      }

      for (const item of items) {
        const ad = adOf(item);
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

    log(`  nav: ${seen} feed entries seen, ${jobs.length} matched the queries`);
    if (seen && !jobs.length) warn('nav: entries arrived but none matched — the queries may all be English while the feed is Norwegian');
    return jobs;
  }
};
