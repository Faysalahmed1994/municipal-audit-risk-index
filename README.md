# Municipal Financial Risk Score

**Open screening of local government Single Audits** · live at [civicauditlens.org](https://civicauditlens.org)

Free and public. Covers all 50 states, DC and the U.S. territories.

Local governments that spend federal awards above the Single Audit threshold must file an audit with the
[Federal Audit Clearinghouse (FAC)](https://www.fac.gov/). The GAO found that the FAC
[cannot identify entities that should file but do not](https://www.gao.gov/products/gao-24-106173)
(GAO-24-106173), and the findings it does hold are hard for oversight bodies to use at scale.

This project:

1. **Scores** every local government Single Audit on a transparent 0–100 scale built only from what the
   independent auditor reported (going concern, opinion, internal control weaknesses, compliance findings,
   repeat findings, questioned costs, late filing).
2. **Flags apparent stopped filers**: governments that filed in recent years but have no audit on file
   for the latest year that is past due.
3. **Publishes** everything (code, scoring rules, and data as CSV/JSON) so anyone can check, reuse or cite it.
4. **Explains** the findings (site version 0.2): which compliance requirements and federal programs generate findings,
   which pass-through entities fund governments with findings, how late audits arrive since 2016, which governments
   have findings year after year, and common themes in the finding text.
5. **Gives every government its own page** (`/gov/{STATE}/{UEI}/{name}`) that can be shared, cited and found in search,
   plus a printable brief for each state, a batch lookup for pass-through entities, and a weekly "What changed" page
   with RSS feeds.
6. **Compares** up to three governments side by side (`/#compare/IL:UEI1,IL:UEI2`): score and its four parts, peer
   percentile, findings, filing timeliness, warning signs, programs, pass-through entities and score history since 2016,
   with a shareable link, CSV download and suggestions of similar-size governments in the same state.

> Scores are screening indicators, not audit opinions and not findings of fraud or wrongdoing.

## Project components

| Component | What it does | Where |
| --- | --- | --- |
| **Municipal Financial Risk Score** (national) | Scores every U.S. local government Single Audit from FAC data and flags apparent stopped filers; public website | `pipeline/`, `site/` |
| **Illinois fiscal pilot** | Fiscal-stress screening from financial-statement ratios (reserves, operating margin, debt service) for Illinois municipalities | [`illinois-fiscal-pilot/`](illinois-fiscal-pilot/README.md) |

Both share the same aim: open, explainable methods that help oversight bodies find local governments
that may need a closer look, earlier.

## How it works

```
FAC API (api.fac.gov) ──weekly GitHub Action──▶ pipeline/build_dataset.py ──▶ site/data/*.json, *.csv
                                                                                    │
                                              Cloudflare Pages (free) serves site/ ◀┘  → your domain
```

* `pipeline/scoring.py`: the scoring rules (all point values in one place)
* `pipeline/build_dataset.py`: downloads FAC data, scores it, detects stopped filers, writes the data files
* `pipeline/analytics.py`: the additional analyses (requirements, programs, pass-through, timeliness, persistence,
  themes, peers, weekly changes, RSS, sitemap). Each one is optional: if it fails, the scores still publish and the
  site says that analysis is unavailable that week
* `pipeline/test_scoring.py`, `pipeline/test_analytics.py`: tests that lock in the rules
* `src/worker.js`, `src/gov.js`: the Cloudflare Worker (feedback form, one page per government, sitemap and feeds);
  `tests/gov.test.mjs` tests the government pages (`node --test tests/gov.test.mjs`)
* `site/validation.json`: results of manual spot checks of the stopped-filer list (edit by hand; shown on the
  *Data quality* page)
* `pipeline/make_sample_data.py`: fictional data for previews (shows a SAMPLE banner)
* `site/`: the web app (plain HTML/CSS/JS, no build step)

Run it locally (from the repository root):

```bash
pip install pytest && (cd pipeline && python -m pytest -q)
FAC_API_KEY=your_key python pipeline/build_dataset.py   # real data (history from 2016; ~20-30 minutes)
python -m http.server -d site 8000                        # open http://localhost:8000
```

Setup steps for hosting, the API key, your domain and a DOI are in **[SETUP.md](SETUP.md)**.
The methodology is on the app's *Methodology* page and in `pipeline/scoring.py`.

## Feedback

Use the **Give feedback** button in the app, or open an issue. Auditors, oversight agencies, pass-through
entities, finance officers and researchers are especially welcome.

## License

Code: MIT. Data: derived from FAC public-domain data and released under CC0.
