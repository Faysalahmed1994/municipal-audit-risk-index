# Methodology — v0.1 (unvalidated research prototype)

**Design:** Exploratory financial-risk screening of 50–100 Illinois municipalities for FY2022–FY2024, one municipality-year per row. This is neither an audit opinion nor a proven insolvency or fraud predictor.

## Financial indicators

| Indicator | Formula | Weight | Risk direction |
| --- | --- | --- | --- |
| General Fund reserves | Unassigned General Fund fund balance / General Fund expenditures | 40% | Lower is worse |
| General Fund operating margin | (General Fund revenues - General Fund expenditures) / General Fund revenues | 35% | Lower is worse |
| Governmental debt service | Governmental-funds debt service expenditures / governmental-funds expenditures | 25% | Higher is worse |

Fiscal measures must be consistently defined. Do not substitute government-wide accrual amounts for the governmental-fund denominators or total fund balance for unassigned fund balance. Operating margin excludes transfers and other financing items; large capital outlays can distort debt-service ratios.

## Normalization

Ratio values are linearly interpolated to a 0–100 severity scale and clipped outside anchor ranges. Anchors are **initial assumptions**, not an external standard or empirical calibration.

- Reserve (ratio : severity): -10%:100, 0%:85, 10%:50, 25%:10, 40%:0.
- Operating margin: -10%:100, -5%:85, 0%:50, 5%:10, 10%:0.
- Debt service: 0%:0, 5%:10, 10%:35, 20%:75, 30%:100.

Composite risk = 0.40 reserve severity + 0.35 operating severity + 0.25 debt-service severity.
Higher scores imply worse modeled financial conditions. Provisional risk bands: Low <35; Medium ≥35 and <65; High ≥65. These bands are descriptive, not validated regulatory or predictive classifications.

## Data quality and missingness

Each of the three ratios is required. Zero or missing denominators make the respective indicator unscorable. Missing ratios lead to blank composite and a missingness flag; **do not** impute missing values or reassign weights. Negative unassigned balance is allowed. Negative revenue, debt service, or expenditure figures are not. Duplicate municipality/year identifiers fail validation.

Audit-report lag, where available, is calculated from reported audit date and actual fiscal year-end; it is presented **separately** from financial health. No filing lateness or legal noncompliance should be inferred without the applicable rule, extension or exception.

## Validation roadmap (not complete)

1. Extract independently traceable financial reports with page numbers, preserve financial reporting basis and restatements.
2. Define inclusion rules, population coverage and missingness; check selection and survivorship bias.
3. Compare results by fiscal year and peer-size group, inspect outliers and ratio correlations.
4. Test robustness under alternative scoring anchors and weights, including leave-one-indicator-out.
5. Evaluate against independent *later-period* outcomes or documented audit signals, explicitly avoiding target leakage.
6. Without reliable outcomes, publish only descriptive/exploratory findings and do not make claims of predictive accuracy.

All screening outputs must be interpreted with professional judgment.
