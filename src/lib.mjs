import fs from 'node:fs/promises';
import crypto from 'node:crypto';

export const log = (...a) => console.log(...a);
export const warn = (...a) => console.warn('!', ...a);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export const clean = s => String(s ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, m => ENTITIES[m] ?? ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const slug = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Stable identity of a vacancy across sources and runs. */
export const fingerprint = job =>
  crypto.createHash('sha1')
    .update([slug(job.title), slug(job.company), slug(String(job.location || '').split(',')[0])].join('|'))
    .digest('hex').slice(0, 16);

/** fetch with timeout, retry and Retry-After handling. Never throws on HTTP errors: returns null. */
export async function http(url, { retries = 3, timeout = 20000, label = '', ...init } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, {
        ...init,
        signal: ac.signal,
        headers: { 'user-agent': 'universal-career-agent/0.6', accept: 'application/json, text/xml, */*', ...(init.headers || {}) }
      });
      if (r.ok) return r;
      if (r.status === 429 || r.status >= 500) {
        const wait = Number(r.headers.get('retry-after')) * 1000 || attempt * 2500;
        warn(`${label || url} -> ${r.status}, retry in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      warn(`${label || url} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
      return null;
    } catch (e) {
      warn(`${label || url} -> ${e.name === 'AbortError' ? 'timeout' : e.message}`);
      if (attempt === retries) return null;
      await sleep(attempt * 1500);
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

export async function getJson(url, opts = {}) {
  const r = await http(url, opts);
  if (!r) return null;
  try { return await r.json(); } catch { warn(`${opts.label || url} -> invalid JSON`); return null; }
}

export async function getText(url, opts = {}) {
  const r = await http(url, opts);
  return r ? r.text() : null;
}

/* ---------------- LLM ---------------- */

const PROVIDERS = {
  anthropic: {
    url: base => `${base || 'https://api.anthropic.com/v1'}/messages`,
    headers: key => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    body: (model, messages) => {
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      return {
        model, max_tokens: 4096, temperature: 0.1,
        ...(system ? { system } : {}),
        messages: messages.filter(m => m.role !== 'system')
      };
    },
    text: d => (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  },
  openai: {
    url: base => `${base || 'https://api.openai.com/v1'}/chat/completions`,
    headers: key => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: (model, messages, json) => ({ model, messages, temperature: 0.1, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    text: d => d.choices?.[0]?.message?.content || ''
  }
};

/** Provider comes from LLM_PROVIDER, or is inferred from the model name. */
export function providerName() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (PROVIDERS[explicit]) return explicit;
  return /^claude/i.test(process.env.LLM_MODEL || '') ? 'anthropic' : 'openai';
}

function extractJson(raw) {
  const stripped = raw.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(stripped); } catch { /* try to salvage below */ }
  const start = stripped.search(/[{[]/);
  const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch { /* give up below */ }
  }
  throw new Error(`LLM did not return JSON: ${stripped.slice(0, 300)}`);
}

export async function llm(messages, { json = true, retries = 3 } = {}) {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('Missing LLM_API_KEY');
  const name = providerName();
  const p = PROVIDERS[name];
  const model = process.env.LLM_MODEL || (name === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4.1-mini');
  const r = await http(p.url(process.env.LLM_BASE_URL?.replace(/\/$/, '')), {
    method: 'POST', retries, timeout: 120000, label: `llm:${name}`,
    headers: p.headers(key),
    body: JSON.stringify(p.body(model, messages, json))
  });
  if (!r) throw new Error(`LLM request failed (${name}/${model})`);
  const text = p.text(await r.json());
  return json ? extractJson(text) : text;
}

/* ---------------- files ---------------- */

export async function readCv() {
  if (process.env.CV_TEXT_B64) return Buffer.from(process.env.CV_TEXT_B64, 'base64').toString('utf8');
  const local = await fs.readFile('data/cv.txt', 'utf8').catch(() => '');
  if (local.trim().length > 400) return local;
  throw new Error('No CV found. Set the CV_TEXT_B64 secret, or put real CV text in data/cv.txt for a local run.');
}

const DEFAULTS = {
  markets: [], remote: true,
  maxQueries: 8, resultsPerQuery: 25, maxJobAgeDays: 30,
  prefilterKeep: 60, minimumScore: 45,
  excludedTerms: [], preferredTerms: [],
  sources: {}
};

/**
 * Settings come from the file; a few knobs can be overridden per run from the
 * workflow dropdowns, so a different market or threshold does not need a commit.
 */
export async function loadSettings() {
  const raw = JSON.parse(await fs.readFile('config/settings.json', 'utf8'));
  const settings = { ...DEFAULTS, ...raw, sources: { ...raw.sources } };

  // Older configs used countries + locations, which searched every city in every
  // country. Markets pair a country with its own cities.
  if (!settings.markets?.length && settings.countries?.length) {
    settings.markets = settings.countries.map(country => ({ country, locations: settings.locations || [] }));
  }
  if (!settings.markets.length) settings.markets = [{ country: 'gb', locations: [] }];

  // GitHub Actions has no ternary, so the sentinel values arrive as-is and are
  // interpreted here. A filter that matches nothing is ignored, never fatal.
  const wanted = (process.env.OVERRIDE_COUNTRIES || '').trim().toLowerCase();
  if (wanted && wanted !== 'all') {
    const only = wanted.split(',').map(s => s.trim()).filter(Boolean);
    const kept = settings.markets.filter(m => only.includes(m.country));
    if (kept.length) settings.markets = kept;
    else warn(`OVERRIDE_COUNTRIES=${wanted} matched no configured market; searching all of them`);
  }
  const num = (env, key) => {
    const v = Number(process.env[env]);
    if (Number.isFinite(v) && v > 0) settings[key] = v;
  };
  num('OVERRIDE_MIN_SCORE', 'minimumScore');
  num('OVERRIDE_MAX_AGE_DAYS', 'maxJobAgeDays');
  const useLlm = (process.env.OVERRIDE_USE_LLM || '').trim().toLowerCase();
  if (useLlm === 'true') settings.useLlm = true;
  if (useLlm === 'false') settings.useLlm = false;

  return settings;
}

export async function readJson(path, fallback = null) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return fallback; }
}

export async function writeJson(path, value) {
  await fs.writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

/** True when the profile is real, not the placeholder committed in the repo. */
export const profileIsUsable = p =>
  !!p && Array.isArray(p.target_roles) && p.target_roles.length > 0 && !!p.headline &&
  !/not built yet|run the workflow/i.test(p.headline);
