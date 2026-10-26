# Municipal Financial Risk Index — Illinois Pilot

**Stage:** Working prototype; financial thresholds not yet calibrated, no verified municipality financial results published.

This open-source project develops a reproducible, explainable municipal fiscal-stress screening model for 50–100 Illinois municipalities (FY2022–FY2024).

## Current prototype

- Three transparent fiscal indicators and provisional 0–100 severity conversion.
- Weighted overall score and provisional Low / Medium / High bands.
- Missingness and duplicate municipality-year checks.
- Audit lag displayed separately as a transparency observation, not evidence of statutory lateness.
- Streamlit dashboard, CSV input/output, synthetic test dataset, unit tests and CI.

## Run on a laptop

Install Python 3.11+, then run:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
streamlit run app.py
```

CLI on macOS/Linux:

```bash
PYTHONPATH=src python -m municipal_risk.cli --input examples/synthetic_data.csv --output outputs/example_scores.csv
```

CLI on Windows PowerShell:

```powershell
$env:PYTHONPATH="src"
python -m municipal_risk.cli --input examples/synthetic_data.csv --output outputs/example_scores.csv
```

**Important:** The default demo uses entirely fictional/synthetic examples, not real municipality data. To score verified data, use [data/input_template.csv](data/input_template.csv) and follow the [data dictionary](docs/data_dictionary.md).

## Sources for the real-data phase

- [Illinois Comptroller Local Government Warehouse](https://illinoiscomptroller.gov/constituent-services/local-government/local-government-warehouse)
- [Illinois Comptroller Financial Databases](https://www.illinoiscomptroller.gov/constituent-services/local-government/local-government-division/financial-databases/)

[Research methodology and limitations](docs/methodology.md).

## Before describing the project as complete

Collect and independently verify the 2022–2024 municipality-year inputs; document inclusion and extraction procedures, peer comparability, and missing data. Perform sensitivity and independent-outcome validation. A score is **not** an audit finding, legal conclusion, credit rating, or validated distress prediction. Do not commit confidential audit client documents.
