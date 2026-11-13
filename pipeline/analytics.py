"""
Extra analyses for the public site (site version 0.2).

Everything here is pure Python on rows already downloaded from the Federal Audit
Clearinghouse (FAC), so it can be unit tested without network access. Each analysis
is optional: build_dataset.py runs it inside a try/except, and the site shows
"not available this week" if one fails. The core score never depends on this file.

Analyses
  requirements  - which compliance requirement types (A-N, P) federal findings involve
  programs      - findings by federal program (Assistance Listing) and agency
  passthrough   - findings on awards received through pass-through entities
  timeliness    - days from fiscal year end to FAC acceptance, by audit year
  persistence   - consecutive years with findings / repeat findings per government
  themes        - keyword themes in the text of federal award findings
  peers         - score percentile among similar-size governments
  changes       - what changed since the previous weekly build (plus RSS feeds)
"""

from __future__ import annotations

import re
from urllib.parse import quote
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from datetime import date
from statistics import median
from xml.sax.saxutils import escape as xml_escape

from scoring import add_months, parse_date, yes

SITE = "https://civicauditlens.org"
SHARDS = 16

# --------------------------------------------------------------------------
# reference lists
# --------------------------------------------------------------------------
REQUIREMENTS = {
    "A": "Activities allowed or unallowed",
    "B": "Allowable costs / cost principles",
    "C": "Cash management",
    "D": "Davis-Bacon Act (reserved)",
    "E": "Eligibility",
    "F": "Equipment and real property management",
    "G": "Matching, level of effort, earmarking",
    "H": "Period of performance",
    "I": "Procurement, suspension and debarment",
    "J": "Program income",
    "K": "Real property acquisition (reserved)",
    "L": "Reporting",
    "M": "Subrecipient monitoring",
    "N": "Special tests and provisions",
    "P": "Other",
}

AGENCIES = {
    "10": "Agriculture (USDA)", "11": "Commerce", "12": "Defense", "14": "Housing and Urban Development (HUD)",
    "15": "Interior", "16": "Justice (DOJ)", "17": "Labor (DOL)", "19": "State", "20": "Transportation (DOT)",
    "21": "Treasury", "23": "Appalachian Regional Commission", "39": "General Services Administration",
    "43": "NASA", "45": "National Endowment for the Arts / Humanities", "47": "National Science Foundation",
    "59": "Small Business Administration", "64": "Veterans Affairs", "66": "Environmental Protection Agency (EPA)",
    "81": "Energy (DOE)", "84": "Education", "90": "Regional commissions and other", "93": "Health and Human Services (HHS)",
    "94": "AmeriCorps", "96": "Social Security Administration", "97": "Homeland Security (DHS / FEMA)",
    "98": "USAID",
}

# Keyword themes for finding text. Rules are deliberately simple and public;
# a finding can match several themes. Order = display order.
THEMES: list[tuple[str, str]] = [
    ("Segregation of duties", r"segregat"),
    ("Reconciliations", r"reconcil"),
    ("Audit adjustments / financial reporting", r"audit adjust|material adjust|proposed adjust|adjusting (journal )?entr|"
                                                 r"prepar\w* (of )?the financial statements|financial statement preparation|restat"),
    ("Schedule of federal awards (SEFA)", r"schedule of expenditures of federal awards|\bsefa\b"),
    ("Procurement / suspension and debarment", r"procure|debar|competitive bid|sam\.gov|excluded part"),
    ("Allowable costs / supporting documentation", r"unallowab|allowable cost|cost principle|support\w* documentation|"
                                                    r"lack\w* (of )?(adequate )?documentation|not (adequately )?(supported|documented)"),
    ("Eligibility", r"eligib"),
    ("Federal reporting", r"\bffata\b|federal financial report|sf-425|reporting requirement|"
                          r"report\w* (was|were) not (submitted|filed)|not submitted timely"),
    ("Subrecipient monitoring", r"subrecipient"),
    ("Cash management / drawdowns", r"cash management|drawdown|draw down|advance\w* of (federal )?funds"),
    ("Equipment / inventory", r"equipment|inventor|capital asset"),
    ("Payroll / time and effort", r"payroll|time ?sheet|timecard|time and effort|personnel activit"),
    ("Prevailing wage (Davis-Bacon)", r"davis[- ]bacon|prevailing wage|certified payroll"),
    ("Period of performance", r"period of performance"),
    ("Late audit submission", r"federal audit clearinghouse|data collection form|reporting package|"
                              r"audit (was )?not (completed|submitted)"),
    ("Information technology controls", r"information technology|user access|password|cyber"),
    ("Matching / earmarking", r"matching|level of effort|earmark"),
]
_THEME_RE = [(name, re.compile(rx, re.I)) for name, rx in THEMES]
OTHER_THEME = "Other / not classified"

SIZE_BANDS = [  # (upper bound of federal spending, label)
    (1_500_000, "under $1.5M federal spending"),
    (5_000_000, "$1.5M–$5M federal spending"),
    (25_000_000, "$5M–$25M federal spending"),
    (100_000_000, "$25M–$100M federal spending"),
    (float("inf"), "over $100M federal spending"),
]

FLAG_HELP = {
    "going_concern": "The auditor doubts the government can keep meeting its obligations for the next year without "
                     "new revenue, borrowing or cuts. It is the strongest warning sign an auditor can report.",
    "fs_opinion_disclaimer_or_adverse": "The auditor could not form an opinion (disclaimer) or found the financial "
                                        "statements materially wrong (adverse). Readers cannot rely on them.",
    "fs_opinion_qualified": "The statements are fair except for a specific area the auditor flagged, often missing "
                            "records or an unsupported balance.",
    "fs_material_weakness": "A control gap serious enough that a material error in the books could happen and not be "
                            "caught in time, such as no review of journal entries or no bank reconciliations.",
    "fs_significant_deficiency": "A control gap less serious than a material weakness but important enough to report "
                                 "to the governing board.",
    "program_material_weakness": "A serious control gap over how federal grant money is spent or tracked.",
    "fs_material_noncompliance": "The government broke a law, contract or grant term in a way that matters to its "
                                 "financial statements.",
    "program_modified_opinion": "The auditor could not give a clean opinion on whether a major federal program "
                                "followed its rules.",
    "questioned_costs": "The auditor found federal spending that may be unallowable or unsupported. The awarding "
                        "agency decides whether money must be repaid.",
    "repeat_finding": "The same problem was reported in an earlier audit and is still not fixed.",
    "late": "The audit reached the Federal Audit Clearinghouse after the 9-month deadline. Late audits delay "
            "oversight by the agencies that fund the government.",
    "prior_findings_reported": "Federal agencies are listed as having findings from the prior audit still to follow up.",
    "not_low_risk_auditee": "The government did not meet the federal tests for a 'low-risk auditee' (for example "
                            "clean opinions and no material weaknesses in the last two years), so more of its federal "
                            "programs must be audited.",
}


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def shard_of(entity_id: str) -> int:
    """Must match shardOf() in site/app.js and src/gov.js."""
    return sum(ord(c) for c in entity_id) % SHARDS


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s[:80].rstrip("-") or "government"


def gov_url(st: str, entity_id: str, name: str) -> str:
    """Must match govPath() in site/app.js and src/gov.js."""
    return f"{SITE}/gov/{st}/{quote(entity_id, safe='')}/{slugify(name)}"


def parse_requirements(value) -> set[str]:
    """'ABL' -> {'A','B','L'}. GSA_MIGRATION or blank -> empty set."""
    s = str(value or "").upper()
    if not s or "MIGRATION" in s or s in {"N/A", "NONE"}:
        return set()
    return {c for c in s if c in REQUIREMENTS}


def aln_of(prefix, extension) -> str:
    p = str(prefix or "").strip()
    e = str(extension or "").strip().upper()
    if not p:
        return ""
    if not e or "MIGRATION" in e or e.startswith(("U", "RD")):
        return f"{p}.unknown"
    return f"{p}.{e}"


def normalize_name(value: str) -> str:
    s = re.sub(r"[^A-Z0-9 ]+", " ", str(value or "").upper())
    s = re.sub(r"\bTHE\b", " ", s)
    return " ".join(s.split())


def classify_text(text: str) -> set[str]:
    hits = {name for name, rx in _THEME_RE if rx.search(text or "")}
    return hits or {OTHER_THEME}


def size_band(expended: int) -> str:
    for upper, label in SIZE_BANDS:
        if expended < upper:
            return label
    return SIZE_BANDS[-1][1]


def finding_key(row: dict) -> tuple:
    ref = str(row.get("reference_number") or "")
    if not ref or "MIGRATION" in ref.upper():
        return (row.get("report_id"), ref, row.get("award_reference"))
    return (row.get("report_id"), ref)


def _top(counter: Counter, n: int) -> list:
    return counter.most_common(n)


# --------------------------------------------------------------------------
# 1. compliance requirement types
# --------------------------------------------------------------------------
def requirements(finding_rows: list[dict], report_state: dict[str, str]) -> dict:
    """Count distinct findings by requirement letter, nationally, by state and per report.
    finding_rows must already be limited to the reports of interest (one audit year)."""
    letters_by_finding: dict[tuple, set] = defaultdict(set)
    repeat_by_finding: dict[tuple, bool] = {}
    for r in finding_rows:
        rid = r.get("report_id")
        if rid not in report_state:
            continue
        k = finding_key(r)
        letters_by_finding[k] |= parse_requirements(r.get("type_requirement"))
        repeat_by_finding[k] = repeat_by_finding.get(k, False) or yes(r.get("is_repeat_finding"))

    nat, nat_rep = Counter(), Counter()
    by_state: dict[str, Counter] = defaultdict(Counter)
    by_report: dict[str, Counter] = defaultdict(Counter)
    audits_nat: dict[str, set] = defaultdict(set)
    classified: Counter = Counter()   # findings with at least one requirement letter, by state
    for k, letters in letters_by_finding.items():
        rid = k[0]
        st = report_state[rid]
        if letters:
            classified[st] += 1
        for L in letters:
            nat[L] += 1
            nat_rep[L] += repeat_by_finding.get(k, False)
            by_state[st][L] += 1
            by_report[rid][L] += 1
            audits_nat[L].add(rid)
    total_classified = sum(classified.values())

    def rows(counter: Counter, denom: int, rep: Counter | None = None, aud: dict | None = None) -> list[dict]:
        """share = % of classified findings that involve the requirement (a finding can involve several)."""
        out = []
        for L, n in counter.most_common():
            row = {"code": L, "findings": n, "share": round(100 * n / denom, 1) if denom else 0}
            if rep is not None:
                row["repeat_pct"] = round(100 * rep[L] / n, 1) if n else 0
            if aud is not None:
                row["audits"] = len(aud[L])
            out.append(row)
        return out

    return {
        "labels": REQUIREMENTS,
        "findings_total": len(letters_by_finding),
        "findings_classified": total_classified,
        "national": rows(nat, total_classified, nat_rep, audits_nat),
        "states": {st: rows(c, classified[st]) for st, c in by_state.items()},
        "state_classified": dict(classified),
        "by_report": {rid: dict(c) for rid, c in by_report.items()},
    }


# --------------------------------------------------------------------------
# 2. federal programs and agencies
# --------------------------------------------------------------------------
def programs(award_rows: list[dict], finding_rows: list[dict], report_state: dict[str, str],
             top_n: int = 40, state_top_n: int = 12) -> dict:
    award_aln: dict[tuple, str] = {}
    names: dict[str, Counter] = defaultdict(Counter)
    expended: Counter = Counter()
    audits: dict[str, set] = defaultdict(set)
    st_audits: dict[tuple, set] = defaultdict(set)
    st_exp: Counter = Counter()
    rep_prog: dict[str, Counter] = defaultdict(Counter)        # report -> aln -> expended
    for a in award_rows:
        rid = a.get("report_id")
        if rid not in report_state:
            continue
        aln = aln_of(a.get("federal_agency_prefix"), a.get("federal_award_extension"))
        if not aln:
            continue
        award_aln[(rid, a.get("award_reference"))] = aln
        names[aln][(a.get("federal_program_name") or "").strip()] += 1
        amt = int(float(a.get("amount_expended") or 0))
        expended[aln] += amt
        audits[aln].add(rid)
        st = report_state[rid]
        st_audits[(st, aln)].add(rid)
        st_exp[(st, aln)] += amt
        rep_prog[rid][aln] += amt

    seen: set = set()
    f_count, f_repeat, f_qc = Counter(), Counter(), Counter()
    f_audits: dict[str, set] = defaultdict(set)
    st_f: Counter = Counter()
    st_f_audits: dict[tuple, set] = defaultdict(set)
    rep_f: dict[str, Counter] = defaultdict(Counter)
    for r in finding_rows:
        rid = r.get("report_id")
        aln = award_aln.get((rid, r.get("award_reference")))
        if not aln:
            continue
        k = (finding_key(r), aln)
        if k in seen:
            continue
        seen.add(k)
        f_count[aln] += 1
        f_repeat[aln] += yes(r.get("is_repeat_finding"))
        f_qc[aln] += yes(r.get("is_questioned_costs"))
        f_audits[aln].add(rid)
        st = report_state[rid]
        st_f[(st, aln)] += 1
        st_f_audits[(st, aln)].add(rid)
        rep_f[rid][aln] += 1

    def name_of(aln):
        n = names[aln].most_common(1)
        return n[0][0] if n and n[0][0] else aln

    def row(aln, n_aud, n_exp, n_f, n_faud, n_rep=None, n_qc=None):
        d = {"aln": aln, "name": name_of(aln), "agency": AGENCIES.get(aln.split(".")[0], f"Agency {aln.split('.')[0]}"),
             "audits": n_aud, "expended": n_exp, "findings": n_f, "audits_with_findings": n_faud,
             "finding_rate": round(100 * n_faud / n_aud, 1) if n_aud else 0}
        if n_rep is not None:
            d["repeat_pct"] = round(100 * n_rep / n_f, 1) if n_f else 0
        if n_qc is not None:
            d["questioned_cost_findings"] = n_qc
        return d

    ranked = sorted(audits, key=lambda a: (-f_count[a], -expended[a]))
    national = [row(a, len(audits[a]), expended[a], f_count[a], len(f_audits[a]), f_repeat[a], f_qc[a])
                for a in ranked if f_count[a]][:top_n]
    by_rate = sorted((a for a in audits if len(audits[a]) >= 50),
                     key=lambda a: -(len(f_audits[a]) / len(audits[a])))
    highest_rate = [row(a, len(audits[a]), expended[a], f_count[a], len(f_audits[a]), f_repeat[a], f_qc[a])
                    for a in by_rate if f_count[a]][:15]

    states: dict[str, list] = defaultdict(list)
    st_keys: dict[str, list] = defaultdict(list)
    for (st, aln) in st_audits:
        st_keys[st].append(aln)
    for st, alns in st_keys.items():
        alns.sort(key=lambda a: (-st_f[(st, a)], -st_exp[(st, a)]))
        states[st] = [row(a, len(st_audits[(st, a)]), st_exp[(st, a)], st_f[(st, a)], len(st_f_audits[(st, a)]))
                      for a in alns if st_f[(st, a)]][:state_top_n]

    # agencies
    ag_aud, ag_exp, ag_f, ag_faud = defaultdict(set), Counter(), Counter(), defaultdict(set)
    for aln, rids in audits.items():
        p = aln.split(".")[0]
        ag_aud[p] |= rids
        ag_exp[p] += expended[aln]
        ag_f[p] += f_count[aln]
        ag_faud[p] |= f_audits[aln]
    agencies = [{"prefix": p, "agency": AGENCIES.get(p, f"Agency {p}"), "audits": len(ag_aud[p]), "expended": ag_exp[p],
                 "findings": ag_f[p], "audits_with_findings": len(ag_faud[p]),
                 "finding_rate": round(100 * len(ag_faud[p]) / len(ag_aud[p]), 1) if ag_aud[p] else 0}
                for p in sorted(ag_aud, key=lambda p: (-ag_f[p], -ag_exp[p]))]

    by_report = {}
    for rid, progs in rep_prog.items():
        items = sorted(progs, key=lambda a: (-rep_f[rid][a], -progs[a]))[:6]
        by_report[rid] = [{"aln": a, "name": name_of(a), "expended": progs[a], "findings": rep_f[rid][a]} for a in items]
    return {"national": national, "highest_rate": highest_rate, "agencies": agencies[:25],
            "states": dict(states), "by_report": by_report}


# --------------------------------------------------------------------------
# 3. pass-through entities
# --------------------------------------------------------------------------
def passthrough(pt_rows: list[dict], award_rows: list[dict], finding_rows: list[dict],
                report_state: dict[str, str], top_n: int = 40, state_top_n: int = 15) -> dict:
    """For each pass-through entity (often a state agency): how many local governments received
    awards through it, and how many of those awards carried findings."""
    award_findings: Counter = Counter()
    seen = set()
    for r in finding_rows:
        k = (finding_key(r), r.get("award_reference"))
        if r.get("report_id") in report_state and k not in seen:
            seen.add(k)
            award_findings[(r.get("report_id"), r.get("award_reference"))] += 1
    award_exp = {(a.get("report_id"), a.get("award_reference")): int(float(a.get("amount_expended") or 0))
                 for a in award_rows if a.get("report_id") in report_state}

    display: dict[str, Counter] = defaultdict(Counter)
    govs: dict[str, set] = defaultdict(set)
    awards: dict[str, set] = defaultdict(set)
    gov_states: dict[str, Counter] = defaultdict(Counter)
    by_report: dict[str, Counter] = defaultdict(Counter)
    st_awards: dict[tuple, set] = defaultdict(set)
    st_govs: dict[tuple, set] = defaultdict(set)
    for p in pt_rows:
        rid = p.get("report_id")
        if rid not in report_state:
            continue
        raw = (p.get("passthrough_name") or "").strip()
        key = normalize_name(raw)
        if not key or key in {"N A", "NA", "NONE", "GSA MIGRATION"}:
            continue
        display[key][raw] += 1
        ak = (rid, p.get("award_reference"))
        govs[key].add(rid)
        awards[key].add(ak)
        st = report_state[rid]
        gov_states[key][st] += 1
        by_report[rid][key] += 1
        st_awards[(st, key)].add(ak)
        st_govs[(st, key)].add(rid)

    def name(key):
        return display[key].most_common(1)[0][0] if display[key] else key.title()

    def row(key, aw, gv):
        with_f = {a for a in aw if award_findings.get(a)}
        return {"name": name(key), "state": gov_states[key].most_common(1)[0][0] if gov_states[key] else "",
                "local_governments": len(gv), "awards": len(aw), "expended": sum(award_exp.get(a, 0) for a in aw),
                "awards_with_findings": len(with_f), "findings": sum(award_findings[a] for a in with_f),
                "govs_with_findings": len({a[0] for a in with_f})}

    keys = sorted(awards, key=lambda k: (-len({a for a in awards[k] if award_findings.get(a)}), -len(govs[k])))
    national = [row(k, awards[k], govs[k]) for k in keys[:top_n]]
    states: dict[str, list] = defaultdict(list)
    per_state_keys: dict[str, list] = defaultdict(list)
    for (st, key) in st_awards:
        per_state_keys[st].append(key)
    for st, ks in per_state_keys.items():
        ks.sort(key=lambda k: (-len({a for a in st_awards[(st, k)] if award_findings.get(a)}), -len(st_govs[(st, k)])))
        states[st] = [row(k, st_awards[(st, k)], st_govs[(st, k)]) for k in ks[:state_top_n]]
    reports = {rid: [name(k) for k, _ in c.most_common(5)] for rid, c in by_report.items()}
    return {"national": national, "states": dict(states), "by_report": reports,
            "entities_total": len(awards)}


# --------------------------------------------------------------------------
# 4. filing timeliness by audit year
# --------------------------------------------------------------------------
def timeliness(audits: dict[tuple[str, int], dict], first_year: int, last_year: int) -> dict:
    """audits: keep_latest() output. Days from fiscal year end to FAC acceptance."""
    per: dict[tuple, list] = defaultdict(list)
    for (_, yr), r in audits.items():
        if not first_year <= yr <= last_year:
            continue
        fye, acc = parse_date(r.get("fy_end_date")), parse_date(r.get("fac_accepted_date"))
        if not fye or not acc or acc < fye:
            continue
        days = (acc - fye).days
        late = acc > add_months(fye, 9)
        st = (r.get("auditee_state") or "??").upper()
        per[("US", yr)].append((days, late))
        per[(st, yr)].append((days, late))

    def series(scope):
        out = []
        for yr in range(first_year, last_year + 1):
            v = per.get((scope, yr), [])
            if not v:
                continue
            out.append({"year": yr, "audits": len(v), "median_days": int(median(d for d, _ in v)),
                        "pct_late": round(100 * sum(1 for _, l in v if l) / len(v), 1)})
        return out

    scopes = {s for s, _ in per if s != "US"}
    return {"national": series("US"), "states": {s: series(s) for s in sorted(scopes)},
            "first_year": first_year, "last_year": last_year}


# --------------------------------------------------------------------------
# 5. persistence of findings
# --------------------------------------------------------------------------
def persistence(by_entity: dict[str, dict[int, dict]], fsum: dict, A: int) -> dict[str, dict]:
    """Per scored government: consecutive audit years, ending with year A, that had findings
    and that had repeat findings. A missing year ends the run."""
    out = {}
    for ek, years in by_entity.items():
        if A not in years:
            continue
        f_streak = r_streak = 0
        y = A
        f_open = r_open = True
        first_with_findings = None
        while y in years:
            s = fsum.get(years[y]["report_id"])
            has_f = bool(s and s.count)
            has_r = bool(s and s.repeat)
            if f_open and has_f:
                f_streak += 1
                first_with_findings = y
            else:
                f_open = False
            if r_open and has_r:
                r_streak += 1
            else:
                r_open = False
            if not f_open and not r_open:
                break
            y -= 1
        yrs = sorted(years)
        with_f = sum(1 for yy in yrs if fsum.get(years[yy]["report_id"]) and fsum[years[yy]["report_id"]].count)
        out[ek] = {"findings_streak": f_streak, "repeat_streak": r_streak, "since": first_with_findings,
                   "years_on_file": len(yrs), "years_with_findings": with_f, "first_year_on_file": yrs[0]}
    return out


def persistence_summary(streaks: dict[str, dict], entity_state: dict[str, str], entity_name: dict[str, tuple],
                        top_n: int = 30) -> dict:
    def bucket(n):
        return "5+" if n >= 5 else str(n)

    def dist(ids, key):
        c = Counter(bucket(streaks[i][key]) for i in ids if streaks[i][key] > 0)
        return {b: c.get(b, 0) for b in ("1", "2", "3", "4", "5+")}

    def top(ids):
        ranked = sorted((i for i in ids if streaks[i]["findings_streak"] >= 2),
                        key=lambda i: (-streaks[i]["findings_streak"], -streaks[i]["repeat_streak"]))
        return [{"state": entity_state[i], "id": i, "name": entity_name[i][0], "city": entity_name[i][1],
                 **{k: streaks[i][k] for k in ("findings_streak", "repeat_streak", "since")}} for i in ranked[:top_n]]

    all_ids = list(streaks)
    per_state: dict[str, list] = defaultdict(list)
    for i in all_ids:
        per_state[entity_state[i]].append(i)
    return {
        "national": {"findings_streak": dist(all_ids, "findings_streak"), "repeat_streak": dist(all_ids, "repeat_streak"),
                     "scored": len(all_ids), "top": top(all_ids)},
        "states": {st: {"findings_streak": dist(ids, "findings_streak"), "repeat_streak": dist(ids, "repeat_streak"),
                        "scored": len(ids), "top": top(ids)[:10]} for st, ids in per_state.items()},
    }


# --------------------------------------------------------------------------
# 6. themes in finding text
# --------------------------------------------------------------------------
def themes(text_rows: list[dict], report_state: dict[str, str]) -> dict:
    seen = set()
    nat: Counter = Counter()
    st_c: dict[str, Counter] = defaultdict(Counter)
    rep: dict[str, Counter] = defaultdict(Counter)
    n = 0
    for r in text_rows:
        rid = r.get("report_id")
        if rid not in report_state:
            continue
        k = (rid, r.get("finding_ref_number"))
        if k in seen:
            continue
        seen.add(k)
        n += 1
        for t in classify_text(r.get("finding_text") or ""):
            nat[t] += 1
            st_c[report_state[rid]][t] += 1
            rep[rid][t] += 1

    def rows(c: Counter, total: int):
        return [{"theme": t, "findings": v, "pct": round(100 * v / total, 1) if total else 0} for t, v in c.most_common()]

    st_totals = Counter(report_state[rid] for rid, _ in seen)
    return {"findings": n, "national": rows(nat, n),
            "states": {st: rows(c, st_totals[st]) for st, c in st_c.items()},
            "by_report": {rid: dict(c) for rid, c in rep.items()},
            "rules": [{"theme": name, "pattern": rx} for name, rx in THEMES]}


# --------------------------------------------------------------------------
# 7. peers
# --------------------------------------------------------------------------
def peers(entities_by_state: dict[str, list[dict]], min_peers: int = 10) -> dict[str, dict]:
    """Score percentile among governments of similar federal spending: same state when at least
    `min_peers` peers exist, otherwise nationally."""
    groups: dict[tuple, list] = defaultdict(list)
    for st, ents in entities_by_state.items():
        for e in ents:
            b = size_band(e["federal_expended"])
            groups[(st, b)].append(e["score"])
            groups[("US", b)].append(e["score"])
    for v in groups.values():
        v.sort()
    out = {}
    for st, ents in entities_by_state.items():
        for e in ents:
            b = size_band(e["federal_expended"])
            scope = (st, b) if len(groups[(st, b)]) - 1 >= min_peers else ("US", b)
            arr = groups[scope]
            n = len(arr) - 1
            if n <= 0:
                continue
            lo = bisect_left(arr, e["score"])
            hi = bisect_right(arr, e["score"])
            ties = hi - lo - 1
            pct = round(100 * (lo + 0.5 * ties) / n)
            out[e["id"]] = {"scope": "state" if scope[0] != "US" else "national", "band": b, "n": n,
                            "median": median(arr), "pct": pct}
    return out


# --------------------------------------------------------------------------
# 8. weekly changes, RSS and sitemap
# --------------------------------------------------------------------------
TIER_RANK = {"Low": 0, "Moderate": 1, "Elevated": 2, "High": 3}


def changes(prev_meta: dict | None, prev_states: dict[str, dict], meta: dict, detail: dict[str, dict],
            cap: int = 300) -> dict:
    out = {"as_of": meta["as_of"], "assessment_year": meta["assessment_year"], "compared_to": None,
           "rolled_over": False, "counts": {}, "new_stopped": [], "resolved_stopped": [], "new_audits": [],
           "tier_changes": []}
    if not prev_meta or not prev_states:
        out["note"] = "No previous build to compare with."
        return out
    out["compared_to"] = prev_meta.get("as_of")
    if prev_meta.get("assessment_year") != meta["assessment_year"]:
        out["rolled_over"] = True
        out["note"] = (f"The scored audit year moved from {prev_meta.get('assessment_year')} to "
                       f"{meta['assessment_year']}, so this week starts a new comparison.")
        return out
    prev_e = {(st, e["id"]): e for st, d in prev_states.items() for e in d.get("entities", [])}
    prev_s = {(st, s["id"]): s for st, d in prev_states.items() for s in d.get("stopped", [])}
    new_e = {(st, e["id"]): e for st, d in detail.items() for e in d["entities"]}
    new_s = {(st, s["id"]): s for st, d in detail.items() for s in d["stopped"]}

    for (st, i), s in new_s.items():
        if (st, i) not in prev_s and (st, i) not in prev_e:
            out["new_stopped"].append({"state": st, "id": i, "name": s["name"], "city": s.get("city", ""),
                                       "last_year_filed": s["last_year_filed"],
                                       "last_federal_expended": s["last_federal_expended"],
                                       "well_above_threshold": s["well_above_threshold"]})
    for (st, i), s in prev_s.items():
        if (st, i) not in new_s:
            filed = new_e.get((st, i))
            out["resolved_stopped"].append({"state": st, "id": i, "name": s["name"], "city": s.get("city", ""),
                                            "now_filed": bool(filed), "tier": filed["tier"] if filed else None,
                                            "score": filed["score"] if filed else None})
    for (st, i), e in new_e.items():
        p = prev_e.get((st, i))
        if p is None:
            out["new_audits"].append({"state": st, "id": i, "name": e["name"], "city": e["city"], "tier": e["tier"],
                                      "score": e["score"], "accepted": e["accepted"],
                                      "federal_expended": e["federal_expended"]})
        elif p.get("report_id") != e["report_id"] and p.get("tier") != e["tier"]:
            out["tier_changes"].append({"state": st, "id": i, "name": e["name"], "city": e["city"],
                                        "from": p.get("tier"), "to": e["tier"], "score": e["score"]})
    out["new_stopped"].sort(key=lambda x: -x["last_federal_expended"])
    out["new_audits"].sort(key=lambda x: (-TIER_RANK[x["tier"]], -x["score"]))
    out["resolved_stopped"].sort(key=lambda x: (not x["now_filed"], x["name"]))
    out["counts"] = {k: len(out[k]) for k in ("new_stopped", "resolved_stopped", "new_audits", "tier_changes")}
    out["counts"]["new_audits_elevated_or_high"] = sum(1 for x in out["new_audits"] if TIER_RANK[x["tier"]] >= 2)
    for k in ("new_stopped", "resolved_stopped", "new_audits", "tier_changes"):
        out[k] = out[k][:cap]
    return out


def feed_items(ch: dict) -> list[dict]:
    """Turn one week's changes into feed items (newest week only)."""
    d = ch["as_of"]
    items = []
    for x in ch.get("new_stopped", []):
        items.append({"date": d, "state": x["state"], "id": x["id"], "name": x["name"], "kind": "stopped",
                      "title": f"Apparent stopped filer: {x['name']} ({x['state']})",
                      "text": f"Last Single Audit filed for {x['last_year_filed']}; nothing on file for the latest "
                              f"year, which is now past due. Not proof of noncompliance."})
    for x in ch.get("resolved_stopped", []):
        if x["now_filed"]:
            items.append({"date": d, "state": x["state"], "id": x["id"], "name": x["name"], "kind": "filed",
                          "title": f"Now filed: {x['name']} ({x['state']})",
                          "text": f"Previously listed as an apparent stopped filer; its audit is now on file "
                                  f"(score {x['score']}, {x['tier']})."})
    for x in ch.get("new_audits", []):
        if TIER_RANK[x["tier"]] >= 2:
            items.append({"date": d, "state": x["state"], "id": x["id"], "name": x["name"], "kind": "audit",
                          "title": f"New audit, {x['tier']} score {x['score']}: {x['name']} ({x['state']})",
                          "text": "A newly accepted Single Audit shows several reported warning signs."})
    return items


def rss(title: str, link: str, description: str, items: list[dict]) -> str:
    def rfc822(iso):
        dt = date.fromisoformat(iso)
        return dt.strftime("%a, %d %b %Y 12:00:00 +0000")
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0"><channel>',
             f"<title>{xml_escape(title)}</title>", f"<link>{xml_escape(link)}</link>",
             f"<description>{xml_escape(description)}</description>", "<language>en-us</language>"]
    for it in items:
        url = gov_url(it["state"], it["id"], it["name"])
        parts.append("<item>"
                     f"<title>{xml_escape(it['title'])}</title>"
                     f"<link>{xml_escape(url)}</link>"
                     f"<guid isPermaLink=\"false\">{xml_escape(it['date'] + '-' + it['kind'] + '-' + it['id'])}</guid>"
                     f"<pubDate>{rfc822(it['date'])}</pubDate>"
                     f"<description>{xml_escape(it['text'])}</description>"
                     "</item>")
    parts.append("</channel></rss>")
    return "\n".join(parts)


def sitemap(urls: list[str], lastmod: str) -> str:
    body = "".join(f"<url><loc>{xml_escape(u)}</loc><lastmod>{lastmod}</lastmod></url>\n" for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")
