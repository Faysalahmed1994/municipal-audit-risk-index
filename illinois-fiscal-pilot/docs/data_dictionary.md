# Pilot municipality-year data dictionary

One row per municipality and fiscal year, nominal US dollars (not thousands). Source material must be publicly available and independently traceable.

| Field | Meaning |
| --- | --- |
| municipality_id | Stable municipality ID; preserve leading zeroes |
| municipality_name | Municipality name |
| fiscal_year | Actual municipal fiscal year |
| general_fund_revenues | General Fund revenues, excluding other financing sources |
| general_fund_expenditures | General Fund expenditures, excluding other financing uses |
| general_fund_unassigned_fund_balance | Year-end **unassigned** General Fund balance; may be negative |
| governmental_funds_debt_service | Principal plus interest expenditures in governmental funds, counted once |
| governmental_funds_expenditures | Expenditures across the same governmental funds as debt service |
| fiscal_year_end | Optional date: YYYY-MM-DD |
| audit_report_date | Optional audit report date: YYYY-MM-DD |
| source_url | Public report or dataset citation |

All fields except the two dates are mandatory columns; missing numerical measurements result in an unscored observation. Store a separate provenance log with report name, page reference, extraction date, basis, and restatements. Confirm that financial lines refer to the same fiscal year and reporting basis.

Official starting points (verify page availability and field definitions):
- https://illinoiscomptroller.gov/constituent-services/local-government/local-government-warehouse
- https://www.illinoiscomptroller.gov/constituent-services/local-government/local-government-division/financial-databases/

The public repository must **not** include confidential employer/client working papers.
