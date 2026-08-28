import { http, getJson, warn, log } from '../lib.mjs';
import { toJob } from '../normalize.mjs';

/**
 * France. France Travail (formerly Pôle emploi) publishes an official partner
 * API. Registration is free at francetravail.io; it issues a client id and
 * secret, which go in the FRANCETRAVAIL_ID and FRANCETRAVAIL_SECRET secrets.
 */
const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

async function accessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FRANCETRAVAIL_ID,
    client_secret: process.env.FRANCETRAVAIL_SECRET,
    scope: 'api_offresdemploiv2 o2dsoffre'
  });
  const res = await http(TOKEN_URL, {
    method: 'POST', label: 'francetravail:token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res) return null;
  const data = await res.json().catch(() => null);
  return data?.access_token || null;
}

export default {
  id: 'francetravail',
  needs: ['FRANCETRAVAIL_ID', 'FRANCETRAVAIL_SECRET'],
  async collect({ queries, settings }) {
    const token = await accessToken();
    if (!token) { warn('francetravail: could not get an access token'); return []; }
    const headers = { authorization: `Bearer ${token}` };
    const range = `0-${Math.min(settings.resultsPerQuery ?? 25, 99) - 1}`;
    const jobs = [];

    for (const what of queries) {
      const u = new URL(SEARCH);
      u.searchParams.set('motsCles', what);
      u.searchParams.set('range', range);
      const data = await getJson(u, { headers, label: `francetravail:${what}` });
      for (const o of data?.resultats || []) {
        const job = toJob({
          title: o.intitule,
          company: o.entreprise?.nom,
          location: o.lieuTravail?.libelle,
          description: o.description,
          url: o.origineOffre?.urlOrigine,
          salary_text: o.salaire?.libelle,
          posted: o.dateCreation,
          sourceId: o.id,
          query: what,
          country: 'fr'
        }, 'francetravail');
        if (job) jobs.push(job);
      }
    }
    log(`  francetravail: ${jobs.length}`);
    return jobs;
  }
};
