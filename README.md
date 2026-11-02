# Civic Audit Lens

**Live site: [civicauditlens.org](https://civicauditlens.org)** · publishes the **Municipal Financial Risk Score (MFRS)**

**Open, free screening of U.S. local government Single Audits, covering all 50 states, DC and the territories.**

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

> Scores are screening indicators, not audit opinions and not findings of fraud or wrongdoing.

## Project components

| Component | What it does | Where |
| --- | --- | --- |
| **Civic Audit Lens** (national) | Scores every U.S. local government Single Audit from FAC data and flags apparent stopped filers; public website | `pipeline/`, `site/` |
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
* `pipeline/test_scoring.py`: tests that lock in the rules
* `pipeline/make_sample_data.py`: fictional data for previews (shows a SAMPLE banner)
* `site/`: the web app (plain HTML/CSS/JS, no build step)

Run it locally (from the repository root):

```bash
pip install pytest && (cd pipeline && python -m pytest -q)
FAC_API_KEY=your_key python pipeline/build_dataset.py   # real data
python -m http.server -d site 8000                        # open http://localhost:8000
```

Setup steps for hosting, the API key, your domain and a DOI are in **[SETUP.md](SETUP.md)**.
The methodology is on the app's *Methodology* page and in `pipeline/scoring.py`.

## Feedback

Use the **Give feedback** button in the app, or open an issue. Auditors, oversight agencies, pass-through
entities, finance officers and researchers are especially welcome.

## License

Code: MIT. Data: derived from FAC public-domain data and released under CC0.
