import { clean, fingerprint } from './lib.mjs';
import { detectLanguage } from './language.mjs';

const MAX_DESCRIPTION = 4000;

/**
 * One shape for every source. Sources return raw records; this is the only
 * place that decides what a "job" looks like downstream.
 */
export function toJob(raw, source) {
  const title = clean(raw.title);
  const company = clean(raw.company) || 'Unknown company';
  if (!title || !raw.url) return null;

  const job = {
    title,
    company,
    location: clean(raw.location) || (raw.remote ? 'Remote' : ''),
    remote: !!raw.remote || /\bremote\b|home ?office|telearbeit/i.test(`${title} ${clean(raw.location)}`),
    description: clean(raw.description).slice(0, MAX_DESCRIPTION),
    url: String(raw.url),
    salary_min: numeric(raw.salary_min),
    salary_max: numeric(raw.salary_max),
    salary_text: clean(raw.salary_text) || null,
    posted: isoDate(raw.posted),
    language: detectLanguage(`${title} ${clean(raw.description)}`),
    country: raw.country || null,
    source,
    sourceId: raw.sourceId ? String(raw.sourceId) : null,
    query: raw.query || null
  };
  job.id = fingerprint(job);
  return job;
}

const numeric = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function isoDate(v) {
  if (!v) return null;
  const d = new Date(typeof v === 'number' ? v * (v < 1e12 ? 1000 : 1) : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Same vacancy from several sources: keep the richest record, remember all origins. */
export function dedupe(jobs) {
  const byId = new Map();
  for (const job of jobs) {
    const existing = byId.get(job.id);
    if (!existing) {
      byId.set(job.id, { ...job, sources: [job.source] });
      continue;
    }
    if (!existing.sources.includes(job.source)) existing.sources.push(job.source);
    if ((job.description || '').length > (existing.description || '').length) {
      existing.description = job.description;
    }
    existing.salary_min ??= job.salary_min;
    existing.salary_max ??= job.salary_max;
    existing.salary_text ??= job.salary_text;
    existing.posted ??= job.posted;
    if (existing.language === 'unknown') existing.language = job.language;
  }
  return [...byId.values()];
}

export function isFresh(job, maxAgeDays) {
  if (!maxAgeDays || !job.posted) return true;
  return Date.now() - new Date(job.posted).getTime() <= maxAgeDays * 86400000;
}
