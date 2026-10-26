"""Regression checks for transparent, provisional risk scores."""
import sys
import unittest
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from municipal_risk.scoring import score_municipalities


class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.df = pd.DataFrame([
            dict(municipality_id="001", municipality_name="Example A (SYNTHETIC)",
                 fiscal_year=2024, general_fund_revenues=120,
                 general_fund_expenditures=100,
                 general_fund_unassigned_fund_balance=40,
                 governmental_funds_debt_service=5,
                 governmental_funds_expenditures=100, source_url="synthetic"),
            dict(municipality_id="002", municipality_name="Example B (SYNTHETIC)",
                 fiscal_year=2024, general_fund_revenues=70,
                 general_fund_expenditures=100,
                 general_fund_unassigned_fund_balance=-10,
                 governmental_funds_debt_service=40,
                 governmental_funds_expenditures=100, source_url="synthetic"),
        ])

    def test_healthier_entity_scores_lower(self):
        a = score_municipalities(self.df)
        self.assertLess(a.loc[0, "risk_score"], a.loc[1, "risk_score"])
        self.assertEqual(str(a.loc[0, "risk_level"]), "Low")
        self.assertEqual(str(a.loc[1, "risk_level"]), "High")

    def test_missing_metric_not_assigned_score(self):
        x = self.df.copy()
        x.loc[0, "governmental_funds_debt_service"] = None
        a = score_municipalities(x)
        self.assertFalse(bool(a.loc[0, "data_complete"]))
        self.assertTrue(pd.isna(a.loc[0, "risk_score"]))

    def test_zero_denominator_unscored(self):
        x = self.df.copy()
        x.loc[0, "general_fund_revenues"] = 0
        self.assertTrue(pd.isna(score_municipalities(x).loc[0, "risk_score"]))

    def test_duplicate_year_rejected(self):
        x = pd.concat([self.df, self.df.iloc[[0]]], ignore_index=True)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            score_municipalities(x)

    def test_negative_expenditure_rejected(self):
        x = self.df.copy()
        x.loc[0, "general_fund_expenditures"] = -1
        with self.assertRaisesRegex(ValueError, "cannot be negative"):
            score_municipalities(x)

    def test_missing_column_rejected(self):
        with self.assertRaisesRegex(ValueError, "Missing required"):
            score_municipalities(self.df.drop(columns="source_url"))

    def test_audit_lag_is_unscored(self):
        x = self.df.copy()
        x["fiscal_year_end"] = "2024-12-31"
        x["audit_report_date"] = "2025-04-10"
        a = score_municipalities(x)
        b = score_municipalities(self.df)
        self.assertEqual(a.loc[0, "audit_lag_days"], 100)
        self.assertEqual(a["risk_score"].tolist(), b["risk_score"].tolist())


if __name__ == "__main__":
    unittest.main()
