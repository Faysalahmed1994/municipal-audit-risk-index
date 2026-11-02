"""
Municipal Financial Risk Score (MFRS) -- scoring rules, version 0.1.

Every point in the score comes from a public field in a Single Audit filed
with the Federal Audit Clearinghouse (FAC). Nothing is estimated or learned:
the same inputs always give the same score, and anyone can recompute it.

Score = A + B + C + D, each part capped at 25, total 0-100.

  A. Financial statement audit   (going concern, modified opinion)
  B. Internal control            (material weaknesses, significant deficiencies)
  C. Federal award compliance    (noncompliance, questioned costs, repeat findings)
  D. Filing discipline           (late filing, prior-year findings, not low-risk)

The score is a SCREENING indicator built from what auditors already reported.
It is not an audit opinion and not a finding of fraud or wrongdoing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
import calendar

METHOD_VERSION = "0.1.0"

# --- point values (kept in one place so the methodology page can show them) --
POINTS = {
    # A. Financial statement audit
    "going_concern": 15,
    "fs_opinion_disclaimer_or_adverse": 10,
    "fs_opinion_qualified": 7,
    # B. Internal control
    "fs_material_weakness": 15,
    "fs_significant_deficiency": 6,
    "program_material_weakness": 4,
    # C. Federal award compliance
    "fs_material_noncompliance": 5,
    "program_modified_opinion": 6,
    "questioned_costs": 5,
    "repeat_finding_each": 3,       # per repeat finding, up to 3 findings
    "repeat_finding_max_count": 3,
    # D. Filing discipline
    "late_up_to_90_days": 8,
    "late_91_to_365_days": 12,
    "late_over_365_days": 16,
    "prior_findings_reported": 5,
    "not_low_risk_auditee": 4,
}
COMPONENT_CAP = 25

TIERS = [  # (minimum score, label)
    (55, "High"),
    (35, "Elevated"),
    (15, "Moderate"),
    (0, "Low"),
]

FLAG_TEXT = {
    "going_concern": "Auditor raised substantial doubt about going concern",
    "fs_opinion_disclaimer_or_adverse": "Adverse or disclaimer opinion on financial statements",
    "fs_opinion_qualified": "Qualified opinion on financial statements",
    "fs_material_weakness": "Material weakness in internal control over financial reporting",
    "fs_significant_deficiency": "Significant deficiency in internal control over financial reporting",
    "program_material_weakness": "Material weakness over a federal program",
    "fs_material_noncompliance": "Material noncompliance disclosed in the financial statement audit",
    "program_modified_opinion": "Modified opinion on compliance for a major federal program",
    "questioned_costs": "Auditor questioned federal costs",
    "repeat_finding": "Finding repeated from a prior year",
    "late": "Single Audit accepted after the 9-month deadline",
    "prior_findings_reported": "Federal agencies listed with prior-year findings",
    "not_low_risk_auditee": "Did not qualify as a low-risk auditee",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def yes(value) -> bool:
    """FAC uses 'Yes'/'No' in general and 'Y'/'N' in findings. Accept both."""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"yes", "y", "true", "t", "1"}


def parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def due_date(fy_end: date) -> date:
    """2 CFR 200.512(a): due the earlier of 30 days after the auditor's report
    or nine months after fiscal year end. The FAC does not publish the report
    date, so we use the nine-month limit (the more lenient of the two)."""
    return add_months(fy_end, 9)


def tier_for(score: int) -> str:
    for minimum, label in TIERS:
        if score >= minimum:
            return label
    return "Low"


# --------------------------------------------------------------------------
# findings roll-up (one Single Audit can have many findings)
# --------------------------------------------------------------------------
@dataclass
class FindingSummary:
    count: int = 0
    repeat: int = 0
    questioned_costs: int = 0
    material_weakness: int = 0
    significant_deficiency: int = 0
    modified_opinion: int = 0
    _refs: set = field(default_factory=set, repr=False)

    def add(self, row: dict) -> None:
        ref = row.get("reference_number") or f"row{self.count}"
        key = (ref, row.get("award_reference"))
        if key in self._refs:
            return
        self._refs.add(key)
        self.count += 1
        self.repeat += yes(row.get("is_repeat_finding"))
        self.questioned_costs += yes(row.get("is_questioned_costs"))
        self.material_weakness += yes(row.get("is_material_weakness"))
        self.significant_deficiency += yes(row.get("is_significant_deficiency"))
        self.modified_opinion += yes(row.get("is_modified_opinion"))

    def as_dict(self) -> dict:
        return {
            "count": self.count,
            "repeat": self.repeat,
            "questioned_costs": self.questioned_costs,
            "material_weakness": self.material_weakness,
            "significant_deficiency": self.significant_deficiency,
            "modified_opinion": self.modified_opinion,
        }


def summarize_findings(rows) -> dict[str, FindingSummary]:
    out: dict[str, FindingSummary] = {}
    for row in rows:
        rid = row.get("report_id")
        if not rid:
            continue
        out.setdefault(rid, FindingSummary()).add(row)
    return out


# --------------------------------------------------------------------------
# the score
# --------------------------------------------------------------------------
def score_audit(general: dict, findings: FindingSummary | None) -> dict:
    """Score one Single Audit. Returns score, tier, components and flags."""
    f = findings or FindingSummary()
    flags: list[str] = []

    # A. Financial statement audit --------------------------------------
    a = 0
    if yes(general.get("is_going_concern_included")):
        a += POINTS["going_concern"]
        flags.append("going_concern")
    opinions = str(general.get("gaap_results") or "").lower()
    if "adverse" in opinions or "disclaimer" in opinions:
        a += POINTS["fs_opinion_disclaimer_or_adverse"]
        flags.append("fs_opinion_disclaimer_or_adverse")
    elif "qualified" in opinions.replace("unmodified", ""):
        a += POINTS["fs_opinion_qualified"]
        flags.append("fs_opinion_qualified")
    a = min(a, COMPONENT_CAP)

    # B. Internal control ------------------------------------------------
    b = 0
    if yes(general.get("is_internal_control_material_weakness_disclosed")):
        b += POINTS["fs_material_weakness"]
        flags.append("fs_material_weakness")
    if yes(general.get("is_internal_control_deficiency_disclosed")):
        b += POINTS["fs_significant_deficiency"]
        flags.append("fs_significant_deficiency")
    if f.material_weakness:
        b += POINTS["program_material_weakness"]
        flags.append("program_material_weakness")
    b = min(b, COMPONENT_CAP)

    # C. Federal award compliance ----------------------------------------
    c = 0
    if yes(general.get("is_material_noncompliance_disclosed")):
        c += POINTS["fs_material_noncompliance"]
        flags.append("fs_material_noncompliance")
    if f.modified_opinion:
        c += POINTS["program_modified_opinion"]
        flags.append("program_modified_opinion")
    if f.questioned_costs:
        c += POINTS["questioned_costs"]
        flags.append("questioned_costs")
    if f.repeat:
        c += POINTS["repeat_finding_each"] * min(f.repeat, POINTS["repeat_finding_max_count"])
        flags.append("repeat_finding")
    c = min(c, COMPONENT_CAP)

    # D. Filing discipline -----------------------------------------------
    d = 0
    fy_end = parse_date(general.get("fy_end_date"))
    accepted = parse_date(general.get("fac_accepted_date"))
    days_late = None
    if fy_end and accepted:
        days_late = (accepted - due_date(fy_end)).days
        if days_late > 365:
            d += POINTS["late_over_365_days"]
        elif days_late > 90:
            d += POINTS["late_91_to_365_days"]
        elif days_late > 0:
            d += POINTS["late_up_to_90_days"]
        if days_late > 0:
            flags.append("late")
    if str(general.get("agencies_with_prior_findings") or "").strip() not in {"", "N/A", "None", "[]"}:
        d += POINTS["prior_findings_reported"]
        flags.append("prior_findings_reported")
    if not yes(general.get("is_low_risk_auditee")):
        d += POINTS["not_low_risk_auditee"]
        flags.append("not_low_risk_auditee")
    d = min(d, COMPONENT_CAP)

    total = a + b + c + d
    return {
        "score": total,
        "tier": tier_for(total),
        "components": {"A": a, "B": b, "C": c, "D": d},
        "flags": flags,
        "days_late": days_late if days_late is None or days_late > 0 else 0,
        "findings": f.as_dict(),
    }
