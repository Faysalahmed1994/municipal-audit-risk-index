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
from build_dataset import STATES, build, write, add_extras, assessment_year, HISTORY_START  # noqa: E402
from scoring import add_months  # noqa: E402

# varied spellings, so the audit-firm grouping is exercised
SAMPLE_FIRMS = ["Sample CPA Firm", "SAMPLE CPA FIRM, LLP", "Example & Associates, P.C.", "Example and Associates PC",
                "Office of the Sample State Auditor", "Prairie Audit Group, Ltd."]

rng = random.Random(42)
KINDS = ["Village", "City", "Town", "County", "Township", "School District", "Water District"]
PROGRAMS = [  # (prefix, extension, name)
    ("14", "218", "Community Development Block Grants/Entitlement Grants"),
    ("20", "205", "Highway Planning and Construction"),
    ("21", "027", "Coronavirus State and Local Fiscal Recovery Funds"),
    ("93", "600", "Head Start"),
    ("10", "555", "National School Lunch Program"),
    ("84", "010", "Title I Grants to Local Educational Agencies"),
    ("97", "036", "Disaster Grants - Public Assistance"),
    ("16", "738", "Edward Byrne Memorial Justice Assistance Grant Program"),
    ("66", "458", "Clean Water State Revolving Fund"),
    ("20", "507", "Federal Transit Formula Grants"),
]
PASSTHROUGH = ["Sample State Department of Transportation", "Sample State Board of Education",
               "Sample State Emergency Management Agency", "Sample Department of Commerce and Economic Opportunity"]
TEXTS = [
    "The County did not maintain adequate segregation of duties over cash receipts.",
    "Bank reconciliations were not performed timely and contained unreconciled differences.",
    "Material audit adjustments were proposed to correct capital assets and receivables.",
    "The Village did not verify that vendors were not suspended or debarred before procurement.",
    "Costs charged to the program lacked supporting documentation and were questioned.",
    "Federal financial reports (SF-425) were not submitted timely as required.",
    "The schedule of expenditures of federal awards (SEFA) was materially misstated.",
    "Payroll costs were not supported by time and effort certifications.",
    "The District did not monitor its subrecipients as required.",
    "The reporting package was not submitted to the Federal Audit Clearinghouse within nine months.",
]


def yn(p):
    return "Yes" if rng.random() < p else "No"


def make(today: date):
    A = assessment_year(today)
    general, findings, awards, pts, texts = [], [], [], [], []
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
            start = rng.choice([HISTORY_START, HISTORY_START, A - 6, A - 2])
            progs = rng.sample(PROGRAMS, rng.randint(2, 5))
            for yr in range(start, A + 1):
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
                expended = int(base * rng.uniform(0.8, 1.2))
                general.append({
                    "report_id": report, "audit_year": str(yr), "auditee_uei": uei, "auditee_ein": f"36{rid:07d}",
                    "auditee_name": name, "auditee_city": f"Sample City {i + 1}", "auditee_state": st,
                    "entity_type": "local", "fy_end_date": fye.isoformat(),
                    "fac_accepted_date": accepted.isoformat(),
                    "total_amount_expended": expended,
                    "gaap_results": rng.choices(["unmodified_opinion", "qualified_opinion", "disclaimer_of_opinion",
                                                 "unmodified_opinion, qualified_opinion"],
                                                [0.85, 0.08 * risk_bias, 0.02 * risk_bias, 0.05])[0],
                    "is_going_concern_included": yn(p * 0.12),
                    "is_internal_control_material_weakness_disclosed": "Yes" if mw else "No",
                    "is_internal_control_deficiency_disclosed": yn(p * 0.8),
                    "is_material_noncompliance_disclosed": yn(p * 0.2),
                    "is_low_risk_auditee": yn(0.35 * (1 - p)),
                    "agencies_with_prior_findings": "14, 21" if rng.random() < p * 0.7 else "",
                    "auditor_firm_name": SAMPLE_FIRMS[(i + yr) % len(SAMPLE_FIRMS)], "cognizant_agency": "", "oversight_agency": "21",
                    "resubmission_status": "",
                })
                for j, (pre, ext, pname) in enumerate(progs):
                    aref = f"AWARD-{j + 1:04d}"
                    direct = rng.random() < 0.5
                    awards.append({"report_id": report, "award_reference": aref, "federal_agency_prefix": pre,
                                   "federal_award_extension": ext, "federal_program_name": pname,
                                   "amount_expended": int(expended / len(progs)), "is_major": "Y" if j == 0 else "N",
                                   "is_direct": "Y" if direct else "N", "findings_count": 0})
                    if not direct:
                        pts.append({"report_id": report, "award_reference": aref,
                                    "passthrough_name": rng.choice(PASSTHROUGH)})
                nf = rng.choices([0, 1, 2, 3, 5], [0.55, 0.2, 0.12, 0.08, 0.05])[0] if rng.random() < p * 2 else 0
                for k in range(nf):
                    ref = f"{yr}-{k + 1:03d}"
                    findings.append({
                        "report_id": report, "reference_number": ref, "award_reference": f"AWARD-{rng.randint(1, len(progs)):04d}",
                        "is_repeat_finding": "Y" if rng.random() < 0.4 else "N",
                        "is_questioned_costs": "Y" if rng.random() < 0.25 else "N",
                        "is_material_weakness": "Y" if rng.random() < 0.4 else "N",
                        "is_significant_deficiency": "Y" if rng.random() < 0.4 else "N",
                        "is_modified_opinion": "Y" if rng.random() < 0.15 else "N",
                        "type_requirement": "".join(sorted(set(rng.choices("ABCEFGHILMNP", k=rng.randint(1, 3))))),
                    })
                    texts.append({"report_id": report, "finding_ref_number": ref,
                                  "finding_text": " ".join(rng.sample(TEXTS, rng.randint(1, 2)))})
    return general, findings, awards, pts, texts


if __name__ == "__main__":
    today = date.today()
    g, f, a, p, t = make(today)
    result = build(g, f, today, sample=True)
    write(add_extras(result, today, a, p, t, {}))
