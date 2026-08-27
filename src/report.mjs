import fs from 'node:fs/promises';
import { writeJson } from './lib.mjs';

const esc = s => String(s || '').replace(/\|/g, '\\|');

/** latest.json is the contract the dashboard reads; everything else is derived from it. */
export async function writeReport(report) {
  await writeJson('data/latest.json', report);
  await fs.mkdir('docs', { recursive: true });
  await fs.copyFile('data/latest.json', 'docs/latest.json');

  const history = 'data/history.json';
  const past = await fs.readFile(history, 'utf8').then(JSON.parse).catch(() => []);
  past.push({
    at: report.generatedAt, collected: report.totalCollected,
    matched: report.totalMatched, new: report.totalNew,
    llmCalls: report.llmScored, sources: report.sources
  });
  await writeJson(history, past.slice(-180));
}

export function digest(report) {
  const top = report.jobs.slice(0, 15);
  const lines = [
    `## ${report.totalMatched} matches from ${report.totalCollected} advertisements`,
    '',
    `Profile: **${report.profileSummary.headline}**`,
    `Sources: ${report.sources.map(s => `${s.source} ${s.collected}`).join(' · ')}`,
    `New since last run: **${report.totalNew}**`,
    ''
  ];
  if (!top.length) {
    lines.push('_Nothing cleared the score threshold. Lower `minimumScore` or widen the sources._');
    return lines.join('\n');
  }
  lines.push('| Score | Role | Company | Where | New |', '|---:|---|---|---|:--:|');
  for (const j of top) {
    lines.push(`| ${j.score} | [${esc(j.title)}](${j.url}) | ${esc(j.company)} | ${esc(j.location || (j.remote ? 'Remote' : '—'))} | ${j.isNew ? '●' : ''} |`);
  }
  return lines.join('\n');
}
