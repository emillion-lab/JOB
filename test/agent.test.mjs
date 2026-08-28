import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJob, dedupe, isFresh } from '../src/normalize.mjs';
import { prefilter, profileVocabulary } from '../src/prefilter.mjs';
import { splitSeen, rehydrate } from '../src/state.mjs';
import { clean, fingerprint, profileIsUsable } from '../src/lib.mjs';

const profile = {
  headline: 'Service delivery manager',
  target_roles: [{ title: 'Service Delivery Manager', queries: ['service delivery manager'] }],
  skills: [{ name: 'ITIL' }, { name: 'ServiceNow' }, { name: 'stakeholder management' }],
  domains: ['managed services'], languages: ['English']
};

const ad = (over = {}) => toJob({
  title: 'Service Delivery Manager', company: 'Acme AG', location: 'Zurich',
  description: 'ITIL, ServiceNow and stakeholder management in managed services.',
  url: 'https://example.com/1', posted: new Date().toISOString(), ...over
}, 'adzuna');

test('html and entities are stripped from source text', () => {
  assert.equal(clean('<p>Team&nbsp;lead &amp; owner</p>'), 'Team lead & owner');
});

test('a job without a url is rejected', () => {
  assert.equal(toJob({ title: 'X', url: '' }, 'feeds'), null);
});

test('the same vacancy from two sources collapses to one record', () => {
  const merged = dedupe([ad(), ad({ description: 'A much longer advertisement body for exactly the same role, repeated here so it clearly wins on length.', url: 'https://other/1' })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sources.length, 1);
  assert.match(merged[0].description, /much longer/);
});

test('fingerprints ignore formatting differences', () => {
  assert.equal(fingerprint({ title: 'Service Delivery Manager', company: 'Acme AG', location: 'Zurich, ZH' }),
               fingerprint({ title: 'service delivery  manager', company: 'ACME AG', location: 'zurich' }));
});

test('stale advertisements are dropped', () => {
  assert.equal(isFresh(ad({ posted: '2019-01-01' }), 30), false);
  assert.equal(isFresh(ad(), 30), true);
});

test('vocabulary is taken from the profile, not a fixed taxonomy', () => {
  const v = profileVocabulary(profile);
  assert.ok(v.skills.includes('itil'));
  assert.ok(v.titles.includes('service delivery manager'));
});

test('excluded terms remove a job outright', () => {
  const { kept } = prefilter([ad({ title: 'Internship Service Delivery' })], profile, { excludedTerms: ['internship'], prefilterKeep: 10 });
  assert.equal(kept.length, 0);
});

test('a matching job outranks an unrelated one', () => {
  const other = ad({ title: 'Pastry Chef', company: 'Bakery', description: 'Croissants and early mornings.', url: 'https://example.com/2' });
  const { kept } = prefilter([other, ad()], profile, { prefilterKeep: 10 });
  assert.equal(kept[0].title, 'Service Delivery Manager');
  assert.ok(kept[0].prefilter.score > kept[1].prefilter.score);
});

test('a title match alone clears the default threshold', () => {
  const { kept } = prefilter([ad()], profile, { prefilterKeep: 10 });
  assert.ok(kept[0].prefilter.score >= 45);
});

test('a job already scored is not sent to the model again', () => {
  const job = ad();
  const state = { [job.id]: { firstSeen: '2026-01-01', lastSeen: '2026-01-02', by: 'llm', match: { score: 71, fit: 'plausible', matched: ['itil'] } } };
  const { fresh, known } = splitSeen([job], state);
  assert.equal(fresh.length, 0);
  assert.equal(rehydrate(known[0], state).score, 71);
});

test('the shipped placeholder is not treated as a profile', () => {
  assert.equal(profileIsUsable({ headline: 'Profile not built yet', target_roles: [] }), false);
  assert.equal(profileIsUsable(profile), true);
});

test('a stale keyword score is not reused after the formula changes', () => {
  const job = ad();
  const state = { [job.id]: { firstSeen: '2026-01-01', lastSeen: '2026-01-02', by: 'prefilter', v: 1, match: { score: 12, fit: 'unscored' } } };
  assert.equal(rehydrate(job, state), null);
});

test('a paid model verdict survives a scoring-formula change', () => {
  const job = ad();
  const state = { [job.id]: { firstSeen: '2026-01-01', lastSeen: '2026-01-02', by: 'llm', v: 1, match: { score: 88, fit: 'strong' } } };
  assert.equal(rehydrate(job, state).score, 88);
});
