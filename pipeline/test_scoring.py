"""Run with:  python -m pytest pipeline -q"""
from datetime import date

from scoring import score_audit, summarize_findings, due_date, tier_for
from build_dataset import build, assessment_year

CLEAN = {
    "report_id": "R1", "audit_year": "2024", "fy_end_date": "2024-06-30",
    "fac_accepted_date": "2025-02-01", "gaap_results": "unmodified_opinion",
    "is_going_concern_included": "No", "is_internal_control_material_weakness_disclosed": "No",
    "is_internal_control_deficiency_disclosed": "No", "is_material_noncompliance_disclosed": "No",
    "is_low_risk_auditee": "Yes", "agencies_with_prior_findings": "",
}


def test_clean_audit_scores_zero():
    s = score_audit(CLEAN, None)
    assert s["score"] == 0 and s["tier"] == "Low" and s["flags"] == []


def test_due_date_is_nine_months():
    assert due_date(date(2024, 6, 30)) == date(2025, 3, 30)
    assert due_date(date(2024, 5, 31)) == date(2025, 2, 28)


def test_worst_case_caps_at_100():
    bad = dict(CLEAN, is_going_concern_included="Yes", gaap_results="disclaimer_of_opinion",
               is_internal_control_material_weakness_disclosed="Yes",
               is_internal_control_deficiency_disclosed="Yes", is_material_noncompliance_disclosed="Yes",
               is_low_risk_auditee="No", agencies_with_prior_findings="14",
               fac_accepted_date="2026-06-01")
    f = summarize_findings([{"report_id": "R1", "reference_number": str(i), "is_repeat_finding": "Y",
                             "is_questioned_costs": "Y", "is_material_weakness": "Y",
                             "is_modified_opinion": "Y"} for i in range(5)])
    s = score_audit(bad, f["R1"])
    assert s["components"] == {"A": 25, "B": 25, "C": 25, "D": 25}
    assert s["score"] == 100 and s["tier"] == "High"


def test_qualified_not_confused_with_unmodified():
    s = score_audit(dict(CLEAN, gaap_results="unmodified_opinion, qualified_opinion"), None)
    assert "fs_opinion_qualified" in s["flags"]
    assert "fs_opinion_qualified" not in score_audit(CLEAN, None)["flags"]


def test_late_bands():
    s = score_audit(dict(CLEAN, fac_accepted_date="2025-05-01"), None)  # 32 days late
    assert s["components"]["D"] == 8 and s["days_late"] == 32


def test_duplicate_finding_rows_count_once():
    rows = [{"report_id": "R1", "reference_number": "2024-001", "award_reference": "A1", "is_repeat_finding": "Y"}] * 3
    assert summarize_findings(rows)["R1"].repeat == 1


def test_tiers():
    assert [tier_for(x) for x in (0, 15, 35, 55)] == ["Low", "Moderate", "Elevated", "High"]


def test_assessment_year():
    assert assessment_year(date(2026, 11, 1)) == 2025
    assert assessment_year(date(2026, 10, 15)) == 2024


def test_stopped_filer_detected_and_resubmission_ignored():
    today = date(2027, 1, 15)  # missing Dec-2025 audit is 107 days past due
    g = [
        dict(CLEAN, report_id="X23", audit_year="2023", fy_end_date="2023-12-31",
             fac_accepted_date="2024-08-01", auditee_uei="U1", auditee_state="IL",
             auditee_name="Village A", total_amount_expended=3_000_000),
        dict(CLEAN, report_id="Y25", audit_year="2025", fy_end_date="2025-06-30",
             fac_accepted_date="2026-02-01", auditee_uei="U2", auditee_state="IL",
             auditee_name="City B", total_amount_expended=900_000),
        dict(CLEAN, report_id="Y25old", audit_year="2025", fy_end_date="2025-06-30",
             fac_accepted_date="2026-01-01", auditee_uei="U2", auditee_state="IL",
             auditee_name="City B", resubmission_status="deprecated_via_resubmission",
             is_going_concern_included="Yes"),
    ]
    r = build(g, [], today)
    il = r["detail"]["IL"]
    assert [e["report_id"] for e in il["entities"]] == ["Y25"]
    assert il["stopped"][0]["name"] == "Village A" and il["stopped"][0]["well_above_threshold"]
    assert r["states"]["IL"]["stopped_filers"] == 1


def test_stopped_filer_skipped_if_filed_under_other_type_or_recent():
    today = date(2026, 11, 1)
    base = dict(CLEAN, audit_year="2024", fy_end_date="2024-06-30", fac_accepted_date="2025-02-01",
                auditee_state="IL", total_amount_expended=5_000_000)
    g = [dict(base, report_id="A", auditee_uei="U1", auditee_name="Moved to state type"),
         dict(base, report_id="B", auditee_uei="U2", auditee_ein="361234567", auditee_name="New UEI same EIN"),
         dict(base, report_id="C", auditee_uei="U3", auditee_name="Really missing"),
         dict(base, report_id="D", auditee_uei="U4", auditee_name="Dec FYE, only 31 days late",
              fy_end_date="2024-12-31")]
    r = build(g, [], today, filed_any={"U1", "EIN-361234567"})
    assert [s["name"] for s in r["detail"]["IL"]["stopped"]] == ["Really missing"]


def test_covid_relief_excluded_from_threshold_test():
    today = date(2026, 11, 1)
    g = [dict(CLEAN, report_id="R", audit_year="2024", fy_end_date="2024-06-30", fac_accepted_date="2025-02-01",
              auditee_uei="U9", auditee_state="IL", auditee_name="Village", total_amount_expended=2_000_000)]
    s = build(g, [], today, covid_by_report={"R": 1_200_000})["detail"]["IL"]["stopped"][0]
    assert s["last_covid_relief_expended"] == 1_200_000 and not s["well_above_threshold"]


def test_state_government_and_freely_associated_states_excluded():
    from build_dataset import is_out_of_scope
    assert is_out_of_scope({"auditee_state": "AZ", "auditee_name": "State of Arizona"})
    assert is_out_of_scope({"auditee_state": "FM", "auditee_name": "FSM National Government"})
    assert not is_out_of_scope({"auditee_state": "PA", "auditee_name": "State College Area School District"})
    assert not is_out_of_scope({"auditee_state": "NM", "auditee_name": "State of New Mexico Bernalillo County"})
