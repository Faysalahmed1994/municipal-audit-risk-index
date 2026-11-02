"""
Generate FAKE data so the web app can be previewed without an API key.

    python pipeline/make_sample_data.py

Every government name starts with "Sample" and the app shows a SAMPLE DATA
banner. Never publish this output as real results. The weekly GitHub Action
replaces it with real FAC data.
"""

from __future__ import annotations

import random
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_dataset import STATES, build, write, assessment_year  # noqa: E402
from scoring import add_months  # noqa: E402

rng = random.Random(42)
KINDS = ["Village", "City", "Town", "County", "Township", "School District", "Water District"]


def yn(p):
    return "Yes" if rng.random() < p else "No"


def make(today: date):
    A = assessment_year(today)
    general, findings = [], []
    rid = 0
    for st in list(STATES)[:51]:  # 50 states + DC
        n = rng.randint(15, 60)
        risk_bias = rng.uniform(0.6, 1.6)
        for i in range(n):
            name = f"Sample {rng.choice(KINDS)} {st}-{i + 1:03d}"
            uei = f"SAMPLE{st}{i:04d}"
            base = rng.lognormvariate(14.6, 1.1)  # ~ $2M median federal spending
            p = min(0.9, 0.12 * risk_bias * rng.uniform(0.3, 2.5))
            stops = rng.random() < 0.06
            for yr in range(A - 2, A + 1):
                if stops and yr == A:
                    continue
                if rng.random() < 0.03:
                    continue
                rid += 1
                fye = date(yr, rng.choice([6, 9, 12]), 30 if rng.random() < .5 else 28)
                due = add_months(fye, 9)
                late = rng.random() < p * 0.8
                accepted = due + timedelta(days=rng.randint(5, 420)) if late else due - timedelta(days=rng.randint(5, 200))
                if accepted > today:
                    accepted = today - timedelta(days=3)
                report = f"{yr}-SAMPLE-{rid:07d}"
                mw = rng.random() < p
                general.append({
                    "report_id": report, "audit_year": str(yr), "auditee_uei": uei, "auditee_ein": "",
                    "auditee_name": name, "auditee_city": f"Sample City {i + 1}", "auditee_state": st,
                    "entity_type": "local", "fy_end_date": fye.isoformat(),
                    "fac_accepted_date": accepted.isoformat(),
                    "total_amount_expended": int(base * rng.uniform(0.8, 1.2)),
                    "gaap_results": rng.choices(["unmodified_opinion", "qualified_opinion", "disclaimer_of_opinion",
                                                 "unmodified_opinion, qualified_opinion"],
                                                [0.85, 0.08 * risk_bias, 0.02 * risk_bias, 0.05])[0],
                    "is_going_concern_included": yn(p * 0.12),
                    "is_internal_control_material_weakness_disclosed": "Yes" if mw else "No",
                    "is_internal_control_deficiency_disclosed": yn(p * 0.8),
                    "is_material_noncompliance_disclosed": yn(p * 0.2),
                    "is_low_risk_auditee": yn(0.35 * (1 - p)),
                    "agencies_with_prior_findings": "14, 21" if rng.random() < p * 0.7 else "",
                    "auditor_firm_name": "Sample CPA Firm", "cognizant_agency": "", "oversight_agency": "21",
                    "resubmission_status": "",
                })
                for k in range(rng.choices([0, 1, 2, 3, 5], [0.55, 0.2, 0.12, 0.08, 0.05])[0] if rng.random() < p * 2 else 0):
                    findings.append({
                        "report_id": report, "reference_number": f"{yr}-{k + 1:03d}", "award_reference": f"AWARD-{k}",
                        "is_repeat_finding": "Y" if rng.random() < 0.4 else "N",
                        "is_questioned_costs": "Y" if rng.random() < 0.25 else "N",
                        "is_material_weakness": "Y" if rng.random() < 0.4 else "N",
                        "is_significant_deficiency": "Y" if rng.random() < 0.4 else "N",
                        "is_modified_opinion": "Y" if rng.random() < 0.15 else "N",
                    })
    return general, findings


if __name__ == "__main__":
    today = date.today()
    g, f = make(today)
    write(build(g, f, today, sample=True))
