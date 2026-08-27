# Universal Career Agent

A provider-neutral job-hunting robot. It turns CV text into a structured career profile,
generates search phrases from that profile, collects vacancies from several sources,
filters them cheaply, ranks the survivors with a language model, and publishes a report
to GitHub Pages. It runs itself on a schedule and remembers what it has already seen.

```
CV ─► profile ─► queries ─► sources ─► dedupe ─► pre-filter ─► LLM match ─► report
                                │                    │             │
                        adzuna, arbeitnow,     keyword score   seen.json:
                        remotive, greenhouse,  from your own   never score
                        lever, ashby, RSS      profile terms   the same ad twice
```

## Sources

Every source is a small adapter in `src/sources/` behind one interface, switched on in
`config/settings.json`. A source that is misconfigured, rate-limited or dead is reported
in the run summary and skipped; it never ends the run.

| Source | Key needed | Covers |
|---|---|---|
| `adzuna` | yes | aggregate boards, ~20 countries |
| `arbeitnow` | no | DACH and EU, whole-board feed |
| `remotive` | no | remote-first roles |
| `greenhouse`, `lever`, `ashby` | no | official public board API of named companies |
| `feeds` | no | any RSS/Atom job feed, including saved-search alerts |

Add a company board by slug, for example `"greenhouse": { "enabled": true, "boards": ["stripe", "figma"] }`.
Add any feed as `"feeds": { "enabled": true, "urls": [{ "url": "https://…/jobs.rss", "company": "Acme" }] }`.

Nothing here scrapes a site, bypasses a login, or defeats an anti-bot control. To add a
board that has no API or feed, ask that company or site for access first.

## Cost control

The language model is the only paid part, so it is used last and on as little as possible:

1. Duplicates across sources collapse into one record by title + company + city.
2. Advertisements older than `maxJobAgeDays` are dropped.
3. `excludedTerms` remove whole categories outright.
4. A keyword score built from **your own profile terms** ranks what is left; only the top
   `prefilterKeep` survive, and at most `maxLlmJobs` reach the model.
5. `data/seen.json` stores each verdict, so a vacancy that reappears tomorrow is reused,
   not re-scored. In a steady state, a daily run scores only genuinely new postings.

If the model call fails, that batch falls back to its keyword score and is labelled
`keyword score only` in the report, rather than disappearing.

## Setup

1. Open `docs/cv.html` (locally or on Pages), load your CV, and copy the Base64 output.
2. Secrets — Settings → Secrets and variables → Actions:
   - `CV_TEXT_B64`
   - `LLM_API_KEY`
   - `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (only if the `adzuna` source is on)
3. Variables, same screen:
   - `LLM_MODEL` — for example `claude-sonnet-4-5` or `gpt-4.1-mini`
   - `LLM_PROVIDER` — `anthropic` or `openai`. Inferred from the model name if unset.
   - `LLM_BASE_URL` — optional, for a gateway or self-hosted endpoint.
4. Edit `config/settings.json`: countries, locations, score threshold, sources.
5. Actions → Career Agent → Run workflow, with `rebuild_profile` ticked the first time.
6. Settings → Pages → deploy from `main` / `/docs`. Pages on a private repository needs
   GitHub Pro; on the free plan the choice is a public repository or no Pages.

Anthropic and OpenAI-compatible endpoints are both supported natively; there is no
gateway requirement.

## Privacy

- `data/cv.txt` and `data/profile.json` are gitignored. The CV lives in a secret; the
  extracted profile stays inside the workflow run as a one-day artifact.
- What does get committed: `latest.json`, `history.json`, `seen.json`. These contain job
  data plus the model's verdicts about you — matched skills, gaps, disqualifiers. Read
  one before making the repository public.
- The dashboard is a static page over `latest.json`. It has no backend and stores nothing.

## Local run

```bash
# put real CV text in data/cv.txt (gitignored), then:
LLM_API_KEY=… LLM_MODEL=claude-sonnet-4-5 ADZUNA_APP_ID=… ADZUNA_APP_KEY=… npm run run
npm test   # offline: normalization, dedupe, pre-filter, state
```

`npm run profile` rebuilds only the profile. `run` rebuilds it automatically whenever
`data/profile.json` is missing or is still the placeholder.

## Honest limitations

- Coverage is the sum of the enabled sources and is nowhere near every vacancy in a
  market. Aggregators lag, and many employers post only on their own site.
- Feeds and APIs often carry an excerpt, not the full advertisement. A high score means
  "worth opening", never "you are qualified".
- Scoring is advisory. It must not be used as an automated hiring or rejection decision,
  and the prompt forbids assessing protected traits.
- The keyword pre-filter can drop a good role described in unusual words. Raise
  `prefilterKeep` if you would rather pay more and see more.
