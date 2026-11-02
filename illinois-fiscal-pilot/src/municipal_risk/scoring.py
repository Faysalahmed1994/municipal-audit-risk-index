"""Prototype municipal financial-risk index (heuristic, not validated)."""
from __future__ import annotations

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = (
    "municipality_id", "municipality_name", "fiscal_year",
    "general_fund_revenues", "general_fund_expenditures",
    "general_fund_unassigned_fund_balance",
    "governmental_funds_debt_service",
    "governmental_funds_expenditures", "source_url",
)
NUMERIC_COLUMNS = (
    "general_fund_revenues", "general_fund_expenditures",
    "general_fund_unassigned_fund_balance",
    "governmental_funds_debt_service", "governmental_funds_expenditures",
)
NONNEGATIVE = (
    "general_fund_revenues", "general_fund_expenditures",
    "governmental_funds_debt_service", "governmental_funds_expenditures",
)
WEIGHTS = {"reserve_risk": 0.40, "operating_risk": 0.35, "debt_service_risk": 0.25}
# Ratio to severity interpolation anchors; provisional and unvalidated.
ANCHORS = {
    "reserve_risk": [(-0.10, 100), (0.00, 85), (0.10, 50), (0.25, 10), (0.40, 0)],
    "operating_risk": [(-0.10, 100), (-0.05, 85), (0.00, 50), (0.05, 10), (0.10, 0)],
    "debt_service_risk": [(0.00, 0), (0.05, 10), (0.10, 35), (0.20, 75), (0.30, 100)],
}


def _severity(ratios: pd.Series, risk_key: str) -> pd.Series:
    anchors = ANCHORS[risk_key]
    result = np.interp(ratios.to_numpy(dtype=float),
                       [p[0] for p in anchors], [p[1] for p in anchors])
    return pd.Series(result, index=ratios.index).where(ratios.notna())


def score_municipalities(frame: pd.DataFrame) -> pd.DataFrame:
    """Return ratios, indicator severities, overall score, and data-quality flags.

    A row must have all three ratio indicators to receive a composite score.
    No imputation, weight redistribution, or false missing=healthy assumptions.
    """
    absent = sorted(set(REQUIRED_COLUMNS) - set(frame.columns))
    if absent:
        raise ValueError("Missing required columns: " + ", ".join(absent))
    out = frame.copy()
    for key in ("municipality_id", "municipality_name"):
        if out[key].isna().any() or out[key].astype(str).str.strip().eq("").any():
            raise ValueError(f"Missing {key} values")
    yr = pd.to_numeric(out["fiscal_year"], errors="coerce")
    if yr.isna().any() or not yr.between(1900, 2100).all() or not yr.mod(1).eq(0).all():
        raise ValueError("fiscal_year must contain valid four-digit integer years")
    out["fiscal_year"] = yr.astype(int)
    if out.duplicated(subset=["municipality_id", "fiscal_year"]).any():
        raise ValueError("Duplicate municipality_id and fiscal_year combinations")

    for key in NUMERIC_COLUMNS:
        out[key] = pd.to_numeric(out[key], errors="coerce")
    for key in NONNEGATIVE:
        if (out[key].dropna() < 0).any():
            raise ValueError(f"{key} cannot be negative")

    gf_exp = out["general_fund_expenditures"].replace(0, np.nan)
    gf_rev = out["general_fund_revenues"].replace(0, np.nan)
    gov_exp = out["governmental_funds_expenditures"].replace(0, np.nan)
    out["reserve_ratio"] = out["general_fund_unassigned_fund_balance"] / gf_exp
    out["operating_margin"] = (
        out["general_fund_revenues"] - out["general_fund_expenditures"]
    ) / gf_rev
    out["debt_service_ratio"] = out["governmental_funds_debt_service"] / gov_exp

    measures = {"reserve_risk": "reserve_ratio",
                "operating_risk": "operating_margin",
                "debt_service_risk": "debt_service_ratio"}
    for key, ratio in measures.items():
        out[key] = _severity(out[ratio], key)
    out["missing_indicators"] = out.apply(
        lambda row: ", ".join(k for k in measures.values() if pd.isna(row[k])), axis=1
    )
    out["data_complete"] = out["missing_indicators"].eq("")
    out["risk_score"] = sum(out[key] * weight for key, weight in WEIGHTS.items())
    out.loc[~out["data_complete"], "risk_score"] = np.nan
    out["risk_score"] = out["risk_score"].round(1)
    out["risk_level"] = pd.cut(
        out["risk_score"], [-0.01, 35, 65, 100.01],
        labels=["Low", "Medium", "High"], right=False
    )

    # Audit lag is descriptive only: it does not establish legal lateness.
    if {"fiscal_year_end", "audit_report_date"}.issubset(out.columns):
        end = pd.to_datetime(out["fiscal_year_end"], errors="coerce")
        report = pd.to_datetime(out["audit_report_date"], errors="coerce")
        lag = (report - end).dt.days.astype("float")
        out["audit_lag_days"] = lag.where(lag >= 0)
    else:
        out["audit_lag_days"] = np.nan
    return out
