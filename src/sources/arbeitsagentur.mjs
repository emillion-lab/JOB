import { http, warn, log } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/**
 * Germany. The Bundesagentur für Arbeit runs the country's public job board and
 * exposes this search endpoint. The key below is a fixed public string, not a
 * credential: it is the one their own clients send, documented by the bundesAPI
 * community project. It is not an officially published developer programme, so
 * if you would rather only use sanctioned interfaces, disable this source.
 */
const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs';
const KEY = 'jobboerse-jobsuche';

export default {
  id: 'arbeitsagentur',
  country: 'de',
  async collect({ queries, settings, config }) {
    const size = Math.min(settings.resultsPerQuery ?? 25, 100);
    const cities = (settings.markets || []).filter(m => m.country === 'de').flatMap(m => m.locations || []);
    const places = cities.length ? cities : [''];
    const jobs = [];
    let described = false;

    for (const where of places) {
      for (const what of queries) {
        const u = new URL(BASE);
        u.searchParams.set('was', what);
        if (where) u.searchParams.set('wo', where);
        u.searchParams.set('umkreis', String(config.radiusKm ?? 25));
        u.searchParams.set('size', String(size));
        u.searchParams.set('page', '1');

        const res = await http(u, { headers: { 'X-API-Key': KEY }, label: `arbeitsagentur:${where || 'de'}:${what}` });
        if (!res) continue;

        let data;
        try { data = await res.json(); } catch { warn('arbeitsagentur: not JSON'); continue; }
        const items = data?.stellenangebote || [];
        if (!Array.isArray(items)) { warn(`arbeitsagentur: unexpected shape, keys ${Object.keys(data || {}).join(',')}`); continue; }
        if (!described && items.length) {
          log(`  arbeitsagentur: item keys ${Object.keys(items[0]).slice(0, 10).join(',')}`);
          described = true;
        }

        for (const j of items) {
          const place = j.arbeitsort || {};
          const job = toJob({
            title: j.titel || j.beruf,
            company: j.arbeitgeber,
            location: [place.ort, place.region].filter(Boolean).join(', ') || 'Germany',
            description: j.stellenbeschreibung || j.beruf,
            url: j.refnr ? `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(j.refnr)}` : null,
            posted: j.aktuelleVeroeffentlichungsdatum || j.eintrittsdatum,
            sourceId: j.refnr,
            query: what,
            country: 'de'
          }, 'arbeitsagentur');
          if (job) jobs.push(job);
        }
      }
    }
    log(`  arbeitsagentur: ${jobs.length}`);
    return jobs;
  }
};
