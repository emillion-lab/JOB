import { llm, readCv, writeJson, log, profileIsUsable } from './lib.mjs';

const SYSTEM = `You extract a career profile from CV text. Use only evidence in the CV.
Return JSON with: headline, seniority, years_total, domains[], skills[{name,level,evidence}],
industries[], languages[], certifications[], achievements[], constraints[],
target_roles[{title,reason,queries[]}], transferable_strengths[], unknowns[].
target_roles: 4-8 realistic roles this person could be hired into today, ordered by
plausibility. Each needs 2-3 short search phrases as they appear in job titles in the
candidate's market, not sentences. Include at least one adjacent role that uses the same
strengths in a different function.
Never infer protected traits (age, gender, nationality, health, family status).
Output English.`;

export async function buildProfile() {
  const cv = await readCv();
  const profile = await llm([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: cv }
  ]);
  if (!profileIsUsable(profile)) throw new Error('Profile extraction returned no usable target roles.');
  profile.builtAt = new Date().toISOString();
  await writeJson('data/profile.json', profile);
  log(`Profile: ${profile.headline} — ${profile.target_roles.length} target roles`);
  return profile;
}

if (import.meta.url === `file://${process.argv[1]}`) await buildProfile();
