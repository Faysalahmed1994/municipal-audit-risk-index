"""
Build the public dataset for the web app from the Federal Audit Clearinghouse.

    FAC_API_KEY=xxxx python pipeline/build_dataset.py

Get a free key (email only) at https://api.data.gov/signup/ .
Writes JSON + CSV into site/data/. Runs weekly in GitHub Actions.

Steps
  1. Download every LOCAL GOVERNMENT Single Audit (entity_type = local)
     for the last few audit years, all states + DC + territories.
  2. Download the findings for those audits.
  3. Keep one audit per government per year (latest resubmission).
  4. Score the latest assessed year (see scoring.py).
  5. Flag "stopped filers": governments that filed for one of the two prior
     years but have nothing on file for the assessment year, even though the
     deadline has passed. This targets the gap in GAO-24-106173 (the FAC
     cannot identify governments that should file but do not).
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parent))
from scoring import (  # noqa: E402
    METHOD_VERSION, POINTS, TIERS, FLAG_TEXT, COMPONENT_CAP,
    summarize_findings, score_audit, parse_date, add_months,
)

API = os.environ.get("FAC_API_URL", "https://api.fac.gov")
KEY = os.environ.get("FAC_API_KEY", "")
OUT = Path(os.environ.get("OUT_DIR", Path(__file__).resolve().parent.parent / "site" / "data"))
PAGE = 5000
GRACE_DAYS = 30            # FAC acceptance can trail submission by a few weeks
YEARS_OF_HISTORY = 3       # assessment year + 2 prior years

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "PR": "Puerto Rico", "GU": "Guam", "VI": "U.S. Virgin Islands", "AS": "American Samoa",
    "MP": "Northern Mariana Islands",
}

GENERAL_FIELDS = [
    "report_id", "audit_year", "auditee_uei", "auditee_ein", "auditee_name", "auditee_city",
    "auditee_state", "entity_type", "fy_end_date", "fac_accepted_date", "submitted_date",
    "total_amount_expended", "gaap_results", "is_going_concern_included",
    "is_internal_control_material_weakness_disclosed", "is_internal_control_deficiency_disclosed",
    "is_material_noncompliance_disclosed", "is_low_risk_auditee", "agencies_with_prior_findings",
    "auditor_firm_name", "cognizant_agency", "oversight_agency", "resubmission_status",
]
FINDING_FIELDS = [
    "report_id", "reference_number", "award_reference", "is_repeat_finding",
    "is_questioned_costs", "is_material_weakness", "is_significant_deficiency",
    "is_modified_opinion",
]


# --------------------------------------------------------------------------
def get(endpoint: str, params: dict) -> list[dict]:
    """Page through a PostgREST endpoint until it returns no more rows."""
    rows: list[dict] = []
    offset = 0
    while True:
        q = dict(params, limit=PAGE, offset=offset)
        url = f"{API}/{endpoint}?{urlencode(q, safe='(),.')}"
        for attempt in range(6):
            try:
                req = Request(url, headers={"X-Api-Key": KEY, "Accept": "application/json"})
                with urlopen(req, timeout=120) as r:
                    batch = json.load(r)
                break
            except HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                    time.sleep(10 * (attempt + 1))
                    continue
                raise
        rows.extend(batch)
        print(f"  {endpoint}: {len(rows):,} rows", flush=True)
        if not batch:
            return rows
        offset += len(batch)
        time.sleep(0.5)


def assessment_year(today: date) -> int:
    """Latest audit year whose every fiscal year end (up to Dec 31) is past due."""
    y = today.year
    while True:
        if (today - add_months(date(y, 12, 31), 9)).days >= GRACE_DAYS:
            return y
        y -= 1


def entity_key(row: dict) -> str:
    uei = (row.get("auditee_uei") or "").strip()
    if uei and uei.upper() not in {"GSA_MIGRATION", "N/A"}:
        return uei
    ein = (row.get("auditee_ein") or "").strip()
    if ein:
        return f"EIN-{ein}"
    return f"NAME-{row.get('auditee_state')}-{(row.get('auditee_name') or '').upper().strip()}"


def keep_latest(rows: list[dict]) -> dict[tuple[str, int], dict]:
    """One audit per (government, audit year): skip superseded resubmissions,
    then keep the most recently accepted one."""
    best: dict[tuple[str, int], dict] = {}
    for r in rows:
        status = str(r.get("resubmission_status") or "").lower()
        if "deprecated" in status or status == "resubmitted":
            continue
        try:
            yr = int(r["audit_year"])
        except (KeyError, TypeError, ValueError):
            continue
        k = (entity_key(r), yr)
        cur = best.get(k)
        if cur is None or str(r.get("fac_accepted_date") or "") > str(cur.get("fac_accepted_date") or ""):
            best[k] = r
    return best


def build(general_rows: list[dict], finding_rows: list[dict], today: date, sample: bool = False) -> dict:
    A = assessment_year(today)
    audits = keep_latest(general_rows)
    fsum = summarize_findings(finding_rows)

    by_entity: dict[str, dict[int, dict]] = defaultdict(dict)
    for (ek, yr), row in audits.items():
        by_entity[ek][yr] = row

    states: dict[str, dict] = defaultdict(lambda: {"entities": [], "stopped": []})

    for ek, years in by_entity.items():
        latest_any = years[max(years)]
        st = (latest_any.get("auditee_state") or "??").upper()
        hist = []
        for yr in sorted(years):
            r = years[yr]
            s = score_audit(r, fsum.get(r["report_id"]))
            hist.append({"year": yr, "score": s["score"], "tier": s["tier"], "report_id": r["report_id"]})

        if A in years:
            r = years[A]
            s = score_audit(r, fsum.get(r["report_id"]))
            states[st]["entities"].append({
                "id": ek,
                "name": (r.get("auditee_name") or "").strip(),
                "city": (r.get("auditee_city") or "").strip().title(),
                "year": A,
                "report_id": r["report_id"],
                "fy_end": r.get("fy_end_date"),
                "accepted": r.get("fac_accepted_date"),
                "federal_expended": int(r.get("total_amount_expended") or 0),
                "auditor": (r.get("auditor_firm_name") or "").strip(),
                "cognizant": r.get("cognizant_agency") or r.get("oversight_agency") or "",
                **s,
                "history": hist,
            })
        else:
            prior = [y for y in years if A - 2 <= y < A]
            if not prior or any(y > A for y in years):
                continue  # never in window, or already filed a later year
            last_year = max(prior)
            r = years[last_year]
            fy_end = parse_date(r.get("fy_end_date"))
            # expected next fiscal year end, and when that audit was due
            exp_fye = add_months(fy_end, 12 * (A - last_year)) if fy_end else date(A, 12, 31)
            exp_due = add_months(exp_fye, 9)
            if (today - exp_due).days < GRACE_DAYS:
                continue  # not overdue yet
            expended = int(r.get("total_amount_expended") or 0)
            states[st]["stopped"].append({
                "id": ek,
                "name": (r.get("auditee_name") or "").strip(),
                "city": (r.get("auditee_city") or "").strip().title(),
                "last_year_filed": last_year,
                "last_report_id": r["report_id"],
                "last_federal_expended": expended,
                "expected_fy_end": exp_fye.isoformat(),
                "was_due": exp_due.isoformat(),
                "days_overdue": (today - exp_due).days,
                # Spending well above the $1M threshold makes "no longer
                # required to file" a less likely explanation.
                "well_above_threshold": expended >= 1_500_000,
                "last_score": hist[-1]["score"],
                "last_tier": hist[-1]["tier"],
            })

    # --- summaries ---------------------------------------------------------
    summary_states = {}
    for st, d in states.items():
        ents = d["entities"]
        tiers = {label: 0 for _, label in TIERS}
        for e in ents:
            tiers[e["tier"]] += 1
        n = len(ents)
        hi = [e for e in ents if e["tier"] in ("High", "Elevated")]
        summary_states[st] = {
            "name": STATES.get(st, st),
            "entities": n,
            "tiers": tiers,
            "pct_elevated_or_high": round(100 * len(hi) / n, 1) if n else 0,
            "avg_score": round(sum(e["score"] for e in ents) / n, 1) if n else 0,
            "federal_expended": sum(e["federal_expended"] for e in ents),
            "federal_expended_elevated_or_high": sum(e["federal_expended"] for e in hi),
            "stopped_filers": len(d["stopped"]),
            "stopped_well_above_threshold": sum(s["well_above_threshold"] for s in d["stopped"]),
            "late_filers": sum(1 for e in ents if "late" in e["flags"]),
            "going_concern": sum(1 for e in ents if "going_concern" in e["flags"]),
            "repeat_findings": sum(1 for e in ents if "repeat_finding" in e["flags"]),
        }
        ents.sort(key=lambda e: (-e["score"], -e["federal_expended"]))
        d["stopped"].sort(key=lambda s: (-s["last_federal_expended"]))

    def total(k):
        return sum(v[k] for v in summary_states.values())

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": today.isoformat(),
        "assessment_year": A,
        "years_loaded": sorted({y for (_, y) in audits}),
        "method_version": METHOD_VERSION,
        "source": "Federal Audit Clearinghouse (GSA), api.fac.gov, entity_type = local",
        "sample": sample,
        "points": POINTS,
        "component_cap": COMPONENT_CAP,
        "tiers": [{"min": m, "label": l} for m, l in TIERS],
        "flag_text": FLAG_TEXT,
    }
    national = {
        "entities": total("entities"),
        "federal_expended": total("federal_expended"),
        "federal_expended_elevated_or_high": total("federal_expended_elevated_or_high"),
        "stopped_filers": total("stopped_filers"),
        "stopped_well_above_threshold": total("stopped_well_above_threshold"),
        "late_filers": total("late_filers"),
        "going_concern": total("going_concern"),
        "repeat_findings": total("repeat_findings"),
        "tiers": {label: sum(v["tiers"][label] for v in summary_states.values()) for _, label in TIERS},
    }
    def brief(e, st, keys):
        return {"state": st, **{k: e[k] for k in keys}}

    all_ents = [(st, e) for st, d in states.items() for e in d["entities"]]
    all_stop = [(st, s) for st, d in states.items() for s in d["stopped"]]
    national["top_risk"] = [brief(e, st, ("id", "name", "city", "score", "tier", "federal_expended", "flags"))
                            for st, e in sorted(all_ents, key=lambda x: (-x[1]["score"], -x[1]["federal_expended"]))[:25]]
    national["top_stopped"] = [brief(s, st, ("id", "name", "city", "last_year_filed", "last_federal_expended",
                                             "days_overdue", "last_tier"))
                               for st, s in sorted(all_stop, key=lambda x: -x[1]["last_federal_expended"])[:25]]
    return {"meta": meta, "national": national, "states": summary_states, "detail": dict(states)}


def write(result: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "states").mkdir(exist_ok=True)
    for old in (OUT / "states").glob("*.json"):
        old.unlink()
    summary = {k: result[k] for k in ("meta", "national", "states")}
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))
    for st, d in result["detail"].items():
        (OUT / "states" / f"{st}.json").write_text(json.dumps(d, separators=(",", ":")))

    # flat CSVs for researchers / Zenodo deposits
    with open(OUT / "scores.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["state", "entity_id", "name", "city", "audit_year", "report_id", "fy_end",
                    "fac_accepted", "federal_expended", "score", "tier", "A", "B", "C", "D",
                    "days_late", "findings", "repeat_findings", "flags"])
        for st, d in sorted(result["detail"].items()):
            for e in d["entities"]:
                c = e["components"]
                w.writerow([st, e["id"], e["name"], e["city"], e["year"], e["report_id"], e["fy_end"],
                            e["accepted"], e["federal_expended"], e["score"], e["tier"],
                            c["A"], c["B"], c["C"], c["D"], e["days_late"],
                            e["findings"]["count"], e["findings"]["repeat"], ";".join(e["flags"])])
    with open(OUT / "stopped_filers.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["state", "entity_id", "name", "city", "last_year_filed", "last_report_id",
                    "last_federal_expended", "expected_fy_end", "was_due", "days_overdue",
                    "well_above_threshold", "last_score", "last_tier"])
        for st, d in sorted(result["detail"].items()):
            for s in d["stopped"]:
                w.writerow([st, s["id"], s["name"], s["city"], s["last_year_filed"], s["last_report_id"],
                            s["last_federal_expended"], s["expected_fy_end"], s["was_due"],
                            s["days_overdue"], s["well_above_threshold"], s["last_score"], s["last_tier"]])
    print(f"Wrote {OUT}")


def main() -> None:
    if not KEY:
        sys.exit("Set FAC_API_KEY (free at https://api.data.gov/signup/).")
    today = date.today()
    A = assessment_year(today)
    years = list(range(A - YEARS_OF_HISTORY + 1, A + 2))  # +1 catches early next-year filers
    yrs = ",".join(str(y) for y in years)
    print(f"Assessment year {A}; loading audit years {yrs}")
    general = get("general", {"entity_type": "eq.local", "audit_year": f"in.({yrs})",
                              "select": ",".join(GENERAL_FIELDS)})
    wanted = {r["report_id"] for r in general}
    findings = []
    for y in years:  # findings endpoint covers all entity types; filter locally
        rows = get("findings", {"audit_year": f"eq.{y}", "select": ",".join(FINDING_FIELDS)})
        findings.extend(r for r in rows if r.get("report_id") in wanted)
    write(build(general, findings, today))


if __name__ == "__main__":
    main()
