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
  6. Site version 0.2 extras (see analytics.py): history back to 2016,
     compliance requirements, federal programs, pass-through entities, finding
     themes, filing timeliness, persistence, peers, a USAspending cross-check
     for stopped filers, weekly changes with RSS feeds, a sitemap and one page
     per government. Each extra is optional: if one fails, the core scores
     are still published and the site says that analysis is unavailable.
"""

from __future__ import annotations

import csv
import json
import os
import shutil
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from http.client import IncompleteRead

sys.path.insert(0, str(Path(__file__).parent))
from scoring import (  # noqa: E402
    METHOD_VERSION, POINTS, TIERS, FLAG_TEXT, COMPONENT_CAP,
    summarize_findings, score_audit, parse_date, add_months,
)
import analytics  # noqa: E402

SITE_VERSION = "0.2.0"

API = os.environ.get("FAC_API_URL", "https://api.fac.gov")
KEY = os.environ.get("FAC_API_KEY", "")
OUT = Path(os.environ.get("OUT_DIR", Path(__file__).resolve().parent.parent / "site" / "data"))
PAGE = 5000
GRACE_DAYS = 30            # FAC acceptance can trail submission by a few weeks
STOPPED_GRACE_DAYS = 90    # flag a stopped filer only when the missing audit is 90+ days past due
YEARS_OF_HISTORY = 3       # assessment year + 2 prior years (stopped-filer window, history shown in lists)
HISTORY_START = int(os.environ.get("HISTORY_START", "2016"))  # first year of the GSA FAC schema
CHUNK = 150                # report_ids per request when fetching award-level tables
USASPENDING_API = os.environ.get("USASPENDING_API", "https://api.usaspending.gov")
USASPENDING_MAX = 400      # stopped filers checked per run (largest first)

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
    "is_modified_opinion", "type_requirement",
]
AWARD_FIELDS = [
    "report_id", "award_reference", "federal_agency_prefix", "federal_award_extension",
    "federal_program_name", "amount_expended", "is_major", "is_direct", "findings_count",
]
PASSTHROUGH_FIELDS = ["report_id", "award_reference", "passthrough_name"]
TEXT_FIELDS = ["report_id", "finding_ref_number", "finding_text"]


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
            except (URLError, TimeoutError, ConnectionError, IncompleteRead, ValueError):
                if attempt < 5:
                    time.sleep(10 * (attempt + 1))
                    continue
                raise
        rows.extend(batch)
        if len(batch) < PAGE:  # last page (the FAC caps responses at 20,000 rows, well above PAGE)
            return rows
        print(f"  {endpoint}: {len(rows):,} rows", flush=True)
        offset += len(batch)
        time.sleep(0.5)


def get_chunked(endpoint: str, report_ids: list[str], fields: list[str], extra: dict | None = None) -> list[dict]:
    """Fetch rows for a list of report_ids, CHUNK ids per request (keeps URLs short)."""
    rows: list[dict] = []
    ids = sorted(set(report_ids))
    for i in range(0, len(ids), CHUNK):
        part = ids[i:i + CHUNK]
        params = {"report_id": f"in.({','.join(part)})", "select": ",".join(fields), **(extra or {})}
        rows.extend(get(endpoint, params))
        time.sleep(0.2)
        if (i // CHUNK) % 20 == 0:
            print(f"  {endpoint}: {len(rows):,} rows after {min(i + CHUNK, len(ids)):,} of {len(ids):,} reports",
                  flush=True)
    print(f"  {endpoint}: {len(rows):,} rows for {len(ids):,} reports", flush=True)
    return rows


def usaspending_check(stopped: list[dict], today: date, budget_s: int = 900) -> dict[str, dict]:
    """For the largest apparent stopped filers (by UEI), total NEW direct federal grant obligations
    (award types 02-05) since the missing fiscal year began, from USAspending. Obligations are not
    spending, but a large amount makes "no longer receives federal money" an unlikely explanation."""
    out: dict[str, dict] = {}
    cand = [s for s in stopped if s["well_above_threshold"] and not s["id"].startswith(("EIN-", "NAME-"))]
    cand.sort(key=lambda s: -(s["last_federal_expended"] - s["last_covid_relief_expended"]))
    started = time.time()
    for s in cand[:USASPENDING_MAX]:
        if time.time() - started > budget_s:
            print("  usaspending: time budget reached", flush=True)
            break
        fye = parse_date(s["expected_fy_end"])
        start = (add_months(fye, -12) + timedelta(days=1)) if fye else date(today.year - 1, 1, 1)
        body = {"filters": {"recipient_search_text": [s["id"]],
                            "time_period": [{"start_date": start.isoformat(), "end_date": today.isoformat()}],
                            "award_type_codes": ["02", "03", "04", "05"]},
                "category": "recipient", "limit": 10, "page": 1}
        req = Request(f"{USASPENDING_API}/api/v2/search/spending_by_category/recipient/",
                      data=json.dumps(body).encode(), method="POST",
                      headers={"Content-Type": "application/json", "Accept": "application/json"})
        for attempt in range(3):
            try:
                with urlopen(req, timeout=60) as r:
                    res = json.load(r)
                break
            except HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise
        amounts = [float(x.get("amount") or 0) for x in res.get("results", [])]
        out[s["id"]] = {"amount": int(max(amounts)) if amounts else 0, "since": start.isoformat()}
        time.sleep(0.25)
    print(f"  usaspending: checked {len(out):,} stopped filers", flush=True)
    return out


def assessment_year(today: date) -> int:
    """Latest audit year whose every fiscal year end (up to Dec 31) is past due."""
    y = today.year
    while True:
        if (today - add_months(date(y, 12, 31), 9)).days >= GRACE_DAYS:
            return y
        y -= 1


def is_out_of_scope(row: dict) -> bool:
    """Drop filings the FAC labels 'local' that are clearly not U.S. local governments:
    freely associated states (FM, MH, PW) and the state or territory government itself
    (e.g. 'State of Arizona'). Narrow on purpose: names merely containing 'State' are kept."""
    st = (row.get("auditee_state") or "").upper()
    if st not in STATES:
        return True
    name = " ".join((row.get("auditee_name") or "").lower().replace(",", " ").split())
    full = STATES[st].lower()
    return name in {f"state of {full}", f"commonwealth of {full}", f"government of {full}",
                    f"territory of {full}", full}


def _real_uei(row: dict) -> str:
    uei = (row.get("auditee_uei") or "").strip()
    return uei if uei and uei.upper() not in {"GSA_MIGRATION", "N/A"} else ""


def ein_to_uei(rows: list[dict]) -> dict[str, str]:
    """Audits migrated from the Census clearinghouse (mostly before 2022) carry no UEI. Link them to the
    government's UEI through the EIN it reported in later years (latest year wins)."""
    out: dict[str, str] = {}
    for r in sorted(rows, key=lambda r: str(r.get("audit_year") or "")):
        uei, ein = _real_uei(r), (r.get("auditee_ein") or "").strip()
        if uei and ein:
            out[ein] = uei
    return out


def entity_key(row: dict, ein_map: dict[str, str] | None = None) -> str:
    uei = _real_uei(row)
    if uei:
        return uei
    ein = (row.get("auditee_ein") or "").strip()
    if ein:
        return (ein_map or {}).get(ein) or f"EIN-{ein}"
    return f"NAME-{row.get('auditee_state')}-{(row.get('auditee_name') or '').upper().strip()}"


def keep_latest(rows: list[dict], ein_map: dict[str, str] | None = None) -> dict[tuple[str, int], dict]:
    """One audit per (government, audit year): skip superseded resubmissions,
    then keep the most recently accepted one."""
    best: dict[tuple[str, int], dict] = {}
    for r in rows:
        if is_out_of_scope(r):
            continue
        status = str(r.get("resubmission_status") or "").lower()
        if "deprecated" in status or status == "resubmitted":
            continue
        try:
            yr = int(r["audit_year"])
        except (KeyError, TypeError, ValueError):
            continue
        k = (entity_key(r, ein_map), yr)
        cur = best.get(k)
        if cur is None or str(r.get("fac_accepted_date") or "") > str(cur.get("fac_accepted_date") or ""):
            best[k] = r
    return best


def build(general_rows: list[dict], finding_rows: list[dict], today: date, sample: bool = False,
          filed_any: set[str] | None = None, covid_by_report: dict[str, int] | None = None) -> dict:
    """filed_any: UEIs and EINs ("EIN-<ein>") that filed for the assessment year or later under ANY
    entity type. A government that switched entity type (e.g. local -> state or non-profit) or
    filed under its EIN is then not reported as a stopped filer."""
    filed_any = filed_any or set()
    covid_by_report = covid_by_report or {}
    A = assessment_year(today)
    audits = keep_latest(general_rows, ein_to_uei(general_rows))
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
        recent = [h for h in hist if h["year"] >= A - (YEARS_OF_HISTORY - 1)]

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
                "ein": (r.get("auditee_ein") or "").strip(),
                **s,
                "history": recent,
                "history_full": hist,
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
            if (today - exp_due).days < STOPPED_GRACE_DAYS:
                continue  # not overdue long enough
            uei = (r.get("auditee_uei") or "").strip()
            ein = (r.get("auditee_ein") or "").strip()
            if (uei and uei in filed_any) or (ein and f"EIN-{ein}" in filed_any):
                continue  # filed under another entity type or identifier
            expended = int(r.get("total_amount_expended") or 0)
            covid = min(expended, int(covid_by_report.get(r["report_id"], 0)))
            states[st]["stopped"].append({
                "id": ek,
                "ein": ein,
                "name": (r.get("auditee_name") or "").strip(),
                "city": (r.get("auditee_city") or "").strip().title(),
                "last_year_filed": last_year,
                "last_report_id": r["report_id"],
                "last_federal_expended": expended,
                "last_covid_relief_expended": covid,
                "expected_fy_end": exp_fye.isoformat(),
                "was_due": exp_due.isoformat(),
                "days_overdue": (today - exp_due).days,
                # Spending well above the $1M threshold, EXCLUDING one-time COVID-19
                # relief programs, makes "no longer required to file" less likely.
                "well_above_threshold": expended - covid >= 1_500_000,
                "last_score": hist[-1]["score"],
                "last_tier": hist[-1]["tier"],
                "history_full": hist,
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
        d["stopped"].sort(key=lambda s: (-(s["last_federal_expended"] - s["last_covid_relief_expended"])))

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
        "flag_help": analytics.FLAG_HELP,
        "requirement_labels": analytics.REQUIREMENTS,
        "site_version": SITE_VERSION,
        "history_start": min((y for (_, y) in audits), default=A),
        "optional": {},
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
                                             "last_covid_relief_expended", "well_above_threshold",
                                             "days_overdue", "last_tier"))
                               for st, s in sorted(all_stop, key=lambda x: -(x[1]["last_federal_expended"]
                                                                  - x[1]["last_covid_relief_expended"]))[:25]]
    return {"meta": meta, "national": national, "states": summary_states, "detail": dict(states),
            "_ctx": {"audits": audits, "fsum": fsum, "by_entity": by_entity, "findings": finding_rows}}


def add_extras(result: dict, today: date, award_rows: list[dict] | None = None,
               pt_rows: list[dict] | None = None, text_rows: list[dict] | None = None,
               usaspending: dict[str, dict] | None = None, status: dict | None = None) -> dict:
    """Site version 0.2 analyses. Each one is isolated: a failure is recorded in meta.optional
    and the rest still run. Returns result with result["extras"] filled in."""
    status = dict(status or {})
    meta, detail, ctx = result["meta"], result["detail"], result["_ctx"]
    A = meta["assessment_year"]
    report_state = {e["report_id"]: st for st, d in detail.items() for e in d["entities"]}
    findings_A = [f for f in ctx["findings"] if f.get("report_id") in report_state]
    ex: dict = {}

    def run(name, fn):
        if status.get(name, "").startswith("failed"):
            return None
        try:
            out = fn()
            status[name] = "ok"
            return out
        except Exception as e:  # noqa: BLE001 - one analysis must never break the build
            status[name] = f"failed: {type(e).__name__}: {str(e)[:200]}"
            print(f"  ! {name} failed: {e}", flush=True)
            return None

    ex["requirements"] = run("requirements", lambda: analytics.requirements(findings_A, report_state))
    if award_rows is not None:
        ex["programs"] = run("programs", lambda: analytics.programs(award_rows, findings_A, report_state))
        if pt_rows is not None:
            ex["passthrough"] = run("passthrough", lambda: analytics.passthrough(pt_rows, award_rows, findings_A,
                                                                                    report_state))
    if text_rows is not None:
        ex["themes"] = run("themes", lambda: analytics.themes(text_rows, report_state))
    ex["timeliness"] = run("timeliness", lambda: analytics.timeliness(ctx["audits"], meta["history_start"], A))
    streaks = run("persistence", lambda: analytics.persistence(ctx["by_entity"], ctx["fsum"], A)) or {}
    ent_state = {e["id"]: st for st, d in detail.items() for e in d["entities"]}
    ent_name = {e["id"]: (e["name"], e["city"]) for d in detail.values() for e in d["entities"]}
    if streaks:
        ex["persistence"] = run("persistence_summary",
                                lambda: analytics.persistence_summary(streaks, ent_state, ent_name))
    ex["streaks"] = streaks
    ex["peers"] = run("peers", lambda: analytics.peers({st: d["entities"] for st, d in detail.items()})) or {}
    usaspending = usaspending or {}
    if usaspending:
        for d in detail.values():
            for s_ in d["stopped"]:
                if s_["id"] in usaspending:
                    s_["usa"] = usaspending[s_["id"]]
        checked = list(usaspending.values())
        ex["usaspending"] = {"checked": len(checked),
                             "with_new_obligations": sum(1 for v in checked if v["amount"] > 0),
                             "over_1m": sum(1 for v in checked if v["amount"] >= 1_000_000)}
    meta["optional"] = status
    result["extras"] = ex
    return result


def _shard_record(st: str, e: dict, kind: str, ex: dict) -> dict:
    rec = {k: v for k, v in e.items() if k not in ("history",)}
    rec["kind"] = kind
    rec["state"] = st
    if kind == "a":
        rid = e["report_id"]
        for key, src in (("requirements", "requirements"), ("programs", "programs"),
                         ("passthrough", "passthrough"), ("themes", "themes")):
            if ex.get(src) and rid in ex[src].get("by_report", {}):
                rec[key] = ex[src]["by_report"][rid]
        if e["id"] in ex.get("peers", {}):
            rec["peer"] = ex["peers"][e["id"]]
        if e["id"] in ex.get("streaks", {}):
            rec["streak"] = ex["streaks"][e["id"]]
    return rec


def _load_previous() -> tuple[dict | None, dict[str, dict]]:
    prev_meta, prev_states = None, {}
    try:
        prev_meta = json.loads((OUT / "summary.json").read_text())["meta"]
        for f in (OUT / "states").glob("*.json"):
            prev_states[f.stem] = json.loads(f.read_text())
    except (OSError, ValueError, KeyError):
        pass
    return prev_meta, prev_states


def write(result: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    prev_meta, prev_states = _load_previous()
    (OUT / "states").mkdir(exist_ok=True)
    for old in (OUT / "states").glob("*.json"):
        old.unlink()
    meta = result["meta"]
    ex = result.get("extras") or {}

    # --- weekly changes (compared with the build being replaced) ---------
    lean = {st: {"entities": [{k: v for k, v in e.items() if k != "history_full"} for e in d["entities"]],
                 "stopped": [{k: v for k, v in s.items() if k != "history_full"} for s in d["stopped"]]}
            for st, d in result["detail"].items()}
    try:
        ch = analytics.changes(prev_meta, prev_states, meta, lean)
        meta["optional"]["changes"] = "ok"
    except Exception as e:  # noqa: BLE001
        ch = {"as_of": meta["as_of"], "note": f"Changes unavailable: {e}", "counts": {}}
        meta["optional"]["changes"] = f"failed: {e}"
    hist_path = OUT / "changes_history.json"
    try:
        history = json.loads(hist_path.read_text())
    except (OSError, ValueError):
        history = []
    history = [h for h in history if h.get("as_of") != ch["as_of"]]
    week_items = analytics.feed_items(ch) if ch.get("counts") else []
    history.insert(0, {"as_of": ch["as_of"], "counts": ch.get("counts", {}), "items": week_items[:400]})
    history = history[:26]

    # --- audit firms: which firm signed each government's latest audit (lookup only, no firm ratings) ---
    try:
        aud = analytics.auditors(result["detail"], meta["assessment_year"])
        aud["as_of"] = meta["as_of"]
        meta["optional"]["auditors"] = "ok"
    except Exception as e:  # noqa: BLE001
        aud = None
        meta["optional"]["auditors"] = f"failed: {e}"

    summary = {k: result[k] for k in ("meta", "national", "states")}
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))
    if aud is not None:
        (OUT / "auditors.json").write_text(json.dumps(aud, separators=(",", ":")))
    for st, d in lean.items():
        (OUT / "states" / f"{st}.json").write_text(json.dumps(d, separators=(",", ":")))
    (OUT / "changes.json").write_text(json.dumps(ch, separators=(",", ":")))
    hist_path.write_text(json.dumps(history, separators=(",", ":")))

    # --- insights (national and state summaries; per-report detail goes to the shards) ---
    insights = {"as_of": meta["as_of"], "assessment_year": meta["assessment_year"],
                "history_start": meta.get("history_start"), "status": meta.get("optional", {})}
    for k in ("requirements", "programs", "passthrough", "themes", "timeliness", "persistence", "usaspending"):
        v = ex.get(k)
        if isinstance(v, dict):
            v = {kk: vv for kk, vv in v.items() if kk != "by_report"}
        insights[k] = v
    (OUT / "insights.json").write_text(json.dumps(insights, separators=(",", ":")))

    # --- one record per government, sharded for the /gov/ pages -----------
    gov = OUT / "gov"
    if gov.exists():
        shutil.rmtree(gov)
    shards: dict[tuple[str, int], dict] = defaultdict(dict)
    index_rows, urls = [], [analytics.SITE + "/"]
    for st, d in sorted(result["detail"].items()):
        for e in d["entities"]:
            shards[(st, analytics.shard_of(e["id"]))][e["id"]] = _shard_record(st, e, "a", ex)
            index_rows.append([st, e["id"], e["name"], e["city"], "a", e["score"], e["tier"], e.get("ein", "")])
            urls.append(analytics.gov_url(st, e["id"], e["name"]))
        for s_ in d["stopped"]:
            shards[(st, analytics.shard_of(s_["id"]))][s_["id"]] = _shard_record(st, s_, "s", ex)
            index_rows.append([st, s_["id"], s_["name"], s_["city"], "s", s_["last_score"], s_["last_tier"],
                               s_.get("ein", "")])
            urls.append(analytics.gov_url(st, s_["id"], s_["name"]))
    for (st, n), recs in shards.items():
        (gov / st).mkdir(parents=True, exist_ok=True)
        (gov / st / f"{n}.json").write_text(json.dumps(recs, separators=(",", ":")))
    (OUT / "index.json").write_text(json.dumps(
        {"cols": ["state", "id", "name", "city", "kind", "score", "tier", "ein"], "rows": index_rows},
        separators=(",", ":")))
    (OUT / "sitemap.xml").write_text(analytics.sitemap(urls, meta["as_of"]))

    # --- RSS feeds: national + one per state, last 12 weeks ---------------
    feeds = OUT / "feeds"
    feeds.mkdir(exist_ok=True)
    for old in feeds.glob("*.xml"):
        old.unlink()
    items = [it for h in history[:12] for it in h["items"]]
    nat_items = [it for it in items if it["kind"] in ("stopped", "filed")][:80]
    (feeds / "national.xml").write_text(analytics.rss(
        "Civic Audit Lens: weekly changes (all states)", analytics.SITE + "/#changes",
        "New apparent stopped filers and governments that filed again, from weekly Federal Audit Clearinghouse "
        "updates.", nat_items))
    for st in sorted(result["states"]):
        st_items = [it for it in items if it["state"] == st][:60]
        name = result["states"][st]["name"]
        (feeds / f"{st}.xml").write_text(analytics.rss(
            f"Civic Audit Lens: {name} weekly changes", f"{analytics.SITE}/#changes-{st}",
            f"New Single Audits with Elevated or High scores, new apparent stopped filers and governments that "
            f"filed again in {name}.", st_items))

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
                    "last_federal_expended", "last_covid_relief_expended", "expected_fy_end", "was_due", "days_overdue",
                    "well_above_threshold", "last_score", "last_tier", "usaspending_new_obligations_since",
                    "usaspending_window_start"])
        for st, d in sorted(result["detail"].items()):
            for s in d["stopped"]:
                u = s.get("usa") or {}
                w.writerow([st, s["id"], s["name"], s["city"], s["last_year_filed"], s["last_report_id"],
                            s["last_federal_expended"], s["last_covid_relief_expended"], s["expected_fy_end"], s["was_due"],
                            s["days_overdue"], s["well_above_threshold"], s["last_score"], s["last_tier"],
                            u.get("amount", ""), u.get("since", "")])
    print(f"Wrote {OUT}")


def main() -> None:
    if not KEY:
        sys.exit("Set FAC_API_KEY (free at https://api.data.gov/signup/).")
    today = date.today()
    A = assessment_year(today)
    first = min(HISTORY_START, A - YEARS_OF_HISTORY + 1)
    years = list(range(first, A + 2))  # +1 catches early next-year filers
    yrs = ",".join(str(y) for y in years)
    print(f"Assessment year {A}; loading audit years {yrs}")
    general = get("general", {"entity_type": "eq.local", "audit_year": f"in.({yrs})",
                              "select": ",".join(GENERAL_FIELDS)})
    wanted = {r["report_id"] for r in general}
    findings = []
    for y in years:  # findings endpoint covers all entity types; filter locally
        rows = get("findings", {"audit_year": f"eq.{y}", "select": ",".join(FINDING_FIELDS)})
        findings.extend(r for r in rows if r.get("report_id") in wanted)
    # Every filer (any entity type) for the assessment year and later, to avoid false stopped filers
    later = ",".join(str(y) for y in years if y >= A)
    anyrows = get("general", {"audit_year": f"in.({later})", "select": "auditee_uei,auditee_ein"})
    filed_any = {r["auditee_uei"].strip() for r in anyrows if r.get("auditee_uei")}
    filed_any |= {f"EIN-{r['auditee_ein'].strip()}" for r in anyrows if r.get("auditee_ein")}
    # One-time COVID-19 relief spending in the prior years (SLFRF/ARPA, CRF, ERA, HAF, CPF, LATCF, ESSER),
    # which pushed many small governments over the threshold temporarily.
    prior = ",".join(str(y) for y in years if A - YEARS_OF_HISTORY < y < A)
    covid_rows = get("federal_awards", {
        "audit_year": f"in.({prior})",
        "or": "(and(federal_agency_prefix.eq.21,federal_award_extension.in.(019,023,026,027,029,032)),"
              "and(federal_agency_prefix.eq.84,federal_award_extension.like.425*))",
        "select": "report_id,amount_expended"})
    covid_by_report: dict[str, int] = defaultdict(int)
    for r in covid_rows:
        covid_by_report[r["report_id"]] += int(r.get("amount_expended") or 0)
    result = build(general, findings, today, filed_any=filed_any, covid_by_report=covid_by_report)

    # --- optional extras: each download may fail without stopping the build ---
    status: dict[str, str] = {}
    scored = [e for d in result["detail"].values() for e in d["entities"]]
    rids = [e["report_id"] for e in scored]
    with_findings = [e["report_id"] for e in scored if e["findings"]["count"]]

    def fetch(name, fn):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            status[name] = f"failed: download: {type(e).__name__}: {str(e)[:200]}"
            print(f"  ! {name} download failed: {e}", flush=True)
            return None

    awards = fetch("programs", lambda: get_chunked("federal_awards", rids, AWARD_FIELDS))
    if awards is None:
        status["passthrough"] = "failed: needs federal_awards"
    pts = fetch("passthrough", lambda: get_chunked("passthrough", rids, PASSTHROUGH_FIELDS)) if awards else None
    texts = fetch("themes", lambda: get_chunked("findings_text", with_findings, TEXT_FIELDS))
    stopped = [s for d in result["detail"].values() for s in d["stopped"]]
    usa = fetch("usaspending", lambda: usaspending_check(stopped, today)) or {}
    if usa:
        status["usaspending"] = "ok"
    add_extras(result, today, awards, pts, texts, usa, status)
    write(result)


if __name__ == "__main__":
    main()
