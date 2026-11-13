"""Tests for the site v0.2 analyses. Run with:  python -m pytest pipeline -q"""
import re
from datetime import date

import analytics as an
from build_dataset import build, add_extras, keep_latest
from scoring import summarize_findings

BASE = {
    "gaap_results": "unmodified_opinion", "is_going_concern_included": "No",
    "is_internal_control_material_weakness_disclosed": "No", "is_internal_control_deficiency_disclosed": "No",
    "is_material_noncompliance_disclosed": "No", "is_low_risk_auditee": "Yes", "agencies_with_prior_findings": "",
    "auditee_state": "IL", "total_amount_expended": 2_000_000,
}


def audit(rid, year, uei, name="Village A", fye=None, acc=None, **kw):
    return dict(BASE, report_id=rid, audit_year=str(year), auditee_uei=uei, auditee_name=name,
                fy_end_date=fye or f"{year}-06-30", fac_accepted_date=acc or f"{year + 1}-02-01", **kw)


def test_requirement_parsing_ignores_migration_and_unknown_letters():
    assert an.parse_requirements("ABL") == {"A", "B", "L"}
    assert an.parse_requirements("GSA_MIGRATION") == set()
    assert an.parse_requirements("a,b, Z") == {"A", "B"}
    assert an.parse_requirements(None) == set()


def test_requirements_count_each_finding_once_across_awards():
    rows = [{"report_id": "R1", "reference_number": "2025-001", "award_reference": "AWARD-0001", "type_requirement": "AB"},
            {"report_id": "R1", "reference_number": "2025-001", "award_reference": "AWARD-0002", "type_requirement": "B"},
            {"report_id": "R1", "reference_number": "2025-002", "award_reference": "AWARD-0001", "type_requirement": "L",
             "is_repeat_finding": "Y"},
            {"report_id": "OTHER", "reference_number": "2025-001", "type_requirement": "A"}]
    out = an.requirements(rows, {"R1": "IL"})
    nat = {r["code"]: r for r in out["national"]}
    assert nat["A"]["findings"] == 1 and nat["B"]["findings"] == 1 and nat["L"]["repeat_pct"] == 100
    assert out["findings_total"] == 2 and out["by_report"]["R1"] == {"A": 1, "B": 1, "L": 1}


def test_programs_join_findings_to_awards():
    awards = [{"report_id": "R1", "award_reference": "AWARD-0001", "federal_agency_prefix": "14",
               "federal_award_extension": "218", "federal_program_name": "CDBG", "amount_expended": 500000},
              {"report_id": "R2", "award_reference": "AWARD-0001", "federal_agency_prefix": "14",
               "federal_award_extension": "218", "federal_program_name": "CDBG", "amount_expended": 250000},
              {"report_id": "R2", "award_reference": "AWARD-0002", "federal_agency_prefix": "20",
               "federal_award_extension": "205", "federal_program_name": "Highways", "amount_expended": 10}]
    findings = [{"report_id": "R1", "reference_number": "2025-001", "award_reference": "AWARD-0001",
                 "is_questioned_costs": "Y"},
                {"report_id": "R1", "reference_number": "2025-001", "award_reference": "AWARD-0001"}]
    out = an.programs(awards, findings, {"R1": "IL", "R2": "IN"})
    top = out["national"][0]
    assert top["aln"] == "14.218" and top["audits"] == 2 and top["findings"] == 1
    assert top["audits_with_findings"] == 1 and top["finding_rate"] == 50.0 and top["questioned_cost_findings"] == 1
    assert out["agencies"][0]["agency"].startswith("Housing")
    assert out["by_report"]["R1"][0]["findings"] == 1


def test_passthrough_names_are_normalized():
    awards = [{"report_id": "R1", "award_reference": "A1", "amount_expended": 100},
              {"report_id": "R2", "award_reference": "A1", "amount_expended": 50}]
    pts = [{"report_id": "R1", "award_reference": "A1", "passthrough_name": "Illinois Dept. of Transportation"},
           {"report_id": "R2", "award_reference": "A1", "passthrough_name": "ILLINOIS DEPT OF TRANSPORTATION"},
           {"report_id": "R2", "award_reference": "A1", "passthrough_name": "N/A"}]
    findings = [{"report_id": "R1", "reference_number": "2025-001", "award_reference": "A1"}]
    out = an.passthrough(pts, awards, findings, {"R1": "IL", "R2": "IL"})
    assert len(out["national"]) == 1
    row = out["national"][0]
    assert row["local_governments"] == 2 and row["awards_with_findings"] == 1 and row["expended"] == 150


def test_timeliness_median_and_late_share():
    audits = keep_latest([audit("R1", 2023, "U1", acc="2024-02-01"),        # 216 days, on time
                          audit("R2", 2023, "U2", acc="2024-05-01"),        # late (> Mar 30)
                          audit("R3", 2023, "U3", acc="2024-01-01", auditee_state="IN")])
    out = an.timeliness(audits, 2023, 2023)
    us = out["national"][0]
    assert us["audits"] == 3 and us["pct_late"] == 33.3
    assert out["states"]["IL"][0]["audits"] == 2


def test_persistence_streak_stops_at_missing_year_or_clean_year():
    g = [audit("A23", 2023, "U1"), audit("A24", 2024, "U1"), audit("A25", 2025, "U1"),
         audit("B21", 2021, "U2"), audit("B23", 2023, "U2"), audit("B24", 2024, "U2"), audit("B25", 2025, "U2")]
    f = [{"report_id": r, "reference_number": "x-001", "is_repeat_finding": rep}
         for r, rep in (("A23", "N"), ("A24", "Y"), ("A25", "Y"), ("B21", "Y"), ("B24", "N"), ("B25", "N"))]
    audits = keep_latest(g)
    by_entity = {}
    for (ek, yr), row in audits.items():
        by_entity.setdefault(ek, {})[yr] = row
    s = an.persistence(by_entity, summarize_findings(f), 2025)
    assert s["U1"]["findings_streak"] == 3 and s["U1"]["repeat_streak"] == 2 and s["U1"]["since"] == 2023
    assert s["U2"]["findings_streak"] == 2 and s["U2"]["repeat_streak"] == 0   # 2023 had no findings


def test_themes_match_keywords_and_fall_back_to_other():
    assert "Segregation of duties" in an.classify_text("Lack of segregation of duties over cash")
    assert "Reconciliations" in an.classify_text("Bank accounts were not reconciled monthly")
    assert an.classify_text("Something entirely different") == {an.OTHER_THEME}
    rows = [{"report_id": "R1", "finding_ref_number": "2025-001", "finding_text": "No bank reconciliations"},
            {"report_id": "R1", "finding_ref_number": "2025-001", "finding_text": "duplicate row"}]
    out = an.themes(rows, {"R1": "IL"})
    assert out["findings"] == 1 and out["national"][0]["theme"] == "Reconciliations"


def test_peers_use_state_when_enough_and_national_otherwise():
    il = [{"id": f"I{i}", "score": i, "federal_expended": 2_000_000} for i in range(12)]
    wy = [{"id": "W1", "score": 50, "federal_expended": 2_000_000}]
    out = an.peers({"IL": il, "WY": wy})
    assert out["I11"]["scope"] == "state" and out["I11"]["pct"] == 100 and out["I0"]["pct"] == 0
    assert out["W1"]["scope"] == "national" and out["W1"]["n"] == 12


def test_shard_and_slug_are_stable():
    assert an.shard_of("ABC") == (65 + 66 + 67) % 16
    assert an.slugify("Village of St. Anne, IL") == "village-of-st-anne-il"
    assert an.slugify("") == "government"


def _detail(entities=(), stopped=()):
    return {"IL": {"entities": list(entities), "stopped": list(stopped)}}


def test_changes_detect_new_stopped_resolved_and_new_audits():
    meta = {"as_of": "2026-11-19", "assessment_year": 2025}
    prev_meta = {"as_of": "2026-11-12", "assessment_year": 2025}
    e = {"id": "U1", "name": "City B", "city": "X", "tier": "High", "score": 60, "accepted": "2026-11-15",
         "federal_expended": 5, "report_id": "R1"}
    s_old = {"id": "U2", "name": "Village A", "city": "Y", "last_year_filed": 2024, "last_federal_expended": 9,
             "well_above_threshold": True}
    s_new = dict(s_old, id="U3", name="Town C")
    prev = _detail(stopped=[s_old, dict(s_old, id="U1", name="City B")])
    ch = an.changes(prev_meta, prev, meta, _detail(entities=[e], stopped=[s_old, s_new]))
    assert ch["counts"]["new_stopped"] == 1 and ch["new_stopped"][0]["id"] == "U3"
    assert ch["counts"]["resolved_stopped"] == 1 and ch["resolved_stopped"][0]["now_filed"]
    assert ch["counts"]["new_audits"] == 1 and ch["counts"]["new_audits_elevated_or_high"] == 1
    items = an.feed_items(ch)
    assert {i["kind"] for i in items} == {"stopped", "filed", "audit"}
    xml = an.rss("t", "https://x", "d", items)
    assert xml.count("<item>") == 3 and "civicauditlens.org/gov/IL/U3/town-c" in xml


def test_changes_after_year_rollover_do_not_list_everything():
    ch = an.changes({"as_of": "a", "assessment_year": 2024}, _detail(), {"as_of": "b", "assessment_year": 2025},
                    _detail(entities=[{"id": "U1"}]))
    assert ch["rolled_over"] and not ch["counts"]


def test_one_failing_analysis_does_not_stop_the_build():
    today = date(2026, 11, 12)
    g = [audit("R25", 2025, "U1"), audit("R24", 2024, "U1"), audit("S24", 2024, "U9", name="Gone",
                                                                     total_amount_expended=3_000_000)]
    res = build(g, [], today)
    bad_awards = [{"report_id": "R25", "award_reference": "A1", "federal_agency_prefix": "14",
                   "federal_award_extension": "218", "amount_expended": "not a number"}]
    add_extras(res, today, bad_awards, [], [], {"U9": {"amount": 2_500_000, "since": "2025-07-01"}})
    st = res["meta"]["optional"]
    assert st["programs"].startswith("failed") and st["timeliness"] == "ok" and st["peers"] == "ok"
    assert res["detail"]["IL"]["stopped"][0]["usa"]["amount"] == 2_500_000
    assert res["extras"]["usaspending"] == {"checked": 1, "with_new_obligations": 1, "over_1m": 1}


def test_full_history_kept_for_pages_but_lists_stay_short():
    today = date(2026, 11, 12)
    g = [audit(f"R{y}", y, "U1") for y in range(2016, 2026)]
    e = build(g, [], today)["detail"]["IL"]["entities"][0]
    assert [h["year"] for h in e["history"]] == [2023, 2024, 2025]
    assert len(e["history_full"]) == 10


def test_census_era_audits_without_uei_join_the_same_government_by_ein():
    today = date(2026, 11, 12)
    g = [audit("OLD19", 2019, "GSA_MIGRATION", auditee_ein="361111111"),
         audit("R24", 2024, "U1", auditee_ein="361111111"), audit("R25", 2025, "U1", auditee_ein="361111111")]
    res = build(g, [], today)
    e = res["detail"]["IL"]["entities"][0]
    assert e["id"] == "U1" and [h["year"] for h in e["history_full"]] == [2019, 2024, 2025]
    assert not res["detail"]["IL"]["stopped"]


def test_migration_placeholder_is_not_a_prior_finding():
    from scoring import score_audit
    s = score_audit(dict(BASE, report_id="R", fy_end_date="2019-06-30", fac_accepted_date="2020-01-01",
                         agencies_with_prior_findings="GSA_MIGRATION"), None)
    assert "prior_findings_reported" not in s["flags"]


def test_firm_key_groups_spellings_and_is_url_safe():
    same = ["Sikich CPA LLC", "SIKICH LLP", "Sikich, L.L.P."]
    assert {an.firm_key(n) for n in same} == {"sikich"}
    assert an.firm_key("Lauterbach & Amen, LLP") == an.firm_key("LAUTERBACH AND AMEN LLP") == "lauterbachamen"
    assert an.firm_key("Gorenz and Associates, Ltd.") == "gorenzassociates"
    assert an.firm_key("CPA") == "cpa"                      # never empty
    for n in same + ["Office of the Washington State Auditor", "Prado & Renteria CPAS Prof. Corp."]:
        assert re.fullmatch(r"[a-z0-9]+", an.firm_key(n))


def test_auditors_lists_governments_without_rating_firms():
    ent = lambda i, firm, score: {"id": f"U{i}", "name": f"Gov {i}", "city": "X", "score": score, "tier": "Low",
                                  "federal_expended": 1000 * i, "findings": {"count": i, "repeat": 0},
                                  "days_late": 0, "auditor": firm}
    detail = {"IL": {"entities": [ent(1, "Sikich LLP", 10), ent(2, "SIKICH CPA LLC", 20), ent(3, "", 5)], "stopped": []},
              "WI": {"entities": [ent(4, "Sikich LLP", 30), ent(5, "Wipfli LLP", 0)], "stopped": []}}
    out = an.auditors(detail, 2025)
    firms = {f["key"]: f for f in out["firms"]}
    assert set(firms) == {"sikich", "wipfli"}                         # blank auditor skipped
    s = firms["sikich"]
    assert s["name"] == "Sikich LLP" and s["variants"] == ["Sikich LLP", "SIKICH CPA LLC"]
    assert [g[:2] for g in s["govs"]] == [["IL", "U1"], ["IL", "U2"], ["WI", "U4"]]
    assert len(s["govs"][0]) == len(out["cols"])
    assert not any(k in s for k in ("score", "avg_score", "rank", "rate"))   # no firm-level ratings
    assert [f["name"] for f in out["firms"]] == ["Sikich LLP", "Wipfli LLP"]  # alphabetical, not by size
