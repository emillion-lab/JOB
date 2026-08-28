import fs from 'node:fs/promises';
import { writeJson, warn } from './lib.mjs';

const esc = s => String(s || '').replace(/\|/g, '\\|');

/** latest.json is the contract the dashboard reads; everything else is derived from it. */
export async function writeReport(report) {
  await writeJson('data/latest.json', report);
  await fs.mkdir('docs', { recursive: true });
  await fs.copyFile('data/latest.json', 'docs/latest.json');

  await writeStandalone(report);

  // Pages serves /docs only, so the editor page needs its own copy of the
  // hand-written profile. The CV-derived one is never published.
  await fs.copyFile('config/profile.json', 'docs/profile.json').catch(() => {});

  const history = 'data/history.json';
  const past = await fs.readFile(history, 'utf8').then(JSON.parse).catch(() => []);
  past.push({
    at: report.generatedAt, collected: report.totalCollected,
    matched: report.totalMatched, new: report.totalNew,
    llmCalls: report.llmScored, sources: report.sources
  });
  await writeJson(history, past.slice(-180));
}

/**
 * A single file with the data baked in. GitHub Pages is not available on a
 * private repository, and index.html opened from disk cannot fetch latest.json
 * because the browser blocks it. This one just opens.
 */
async function writeStandalone(report) {
  try {
    const template = await fs.readFile('docs/index.html', 'utf8');
    const payload = JSON.stringify(report).replace(/</g, '\\u003c');
    const tag = `<script id="report-data" type="application/json">${payload}</script>\n<script type="module">`;
    await fs.writeFile('docs/report.html', template.replace('<script type="module">', tag));
  } catch (e) {
    warn(`Could not write the standalone report: ${e.message}`);
  }
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
