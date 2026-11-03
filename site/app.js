/* Municipal Financial Risk Score — front end (no build step, no dependencies). */
(() => {
  "use strict";
  const CFG = window.MFRS_CONFIG || {};
  const app = document.getElementById("app");
  const modal = document.getElementById("modal");
  const modalBody = document.getElementById("modal-body");
  const stateCache = {};
  let SUMMARY = null;

  const TIER_COLOR = { Low: "#5b8c6b", Moderate: "#d1a73a", Elevated: "#dd7a2e", High: "#b8322a" };
  const COMP_NAME = {
    A: "A. Financial statement audit",
    B: "B. Internal control",
    C: "C. Federal award compliance",
    D: "D. Filing discipline",
  };
  // 12-column tile-grid map of the U.S. (col, row)
  const TILES = {
    AK: [0, 0], ME: [11, 0], VT: [10, 1], NH: [11, 1],
    WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], WI: [7, 2], MI: [8, 2], NY: [9, 2], RI: [10, 2], MA: [11, 2],
    OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3],
    CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
    AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5], DC: [9, 5],
    OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
    HI: [0, 7], TX: [4, 7], FL: [9, 7],
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtInt = (n) => (n ?? 0).toLocaleString("en-US");
  const fmtMoney = (n) => {
    n = n || 0;
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + n;
  };
  const fmtDate = (s) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
  const pill = (t) => `<span class="pill ${esc(t)}">${esc(t)}</span>`;
  const scorebar = (s, t) => `<span class="scorebar"><b style="width:${s}%;background:${TIER_COLOR[t]}"></b></span><strong>${s}</strong>`;
  const facLink = (rid) => `https://app.fac.gov/dissemination/summary/${encodeURIComponent(rid)}`;
  const repoOk = () => CFG.githubRepo && !CFG.githubRepo.startsWith("YOUR-");
  const issueUrl = (title, body, labels = "feedback") =>
    repoOk()
      ? `https://github.com/${CFG.githubRepo}/issues/new?labels=${encodeURIComponent(labels)}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
      : "#feedback";
  const flagText = (f) => (SUMMARY.meta.flag_text || {})[f] || f;

  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  async function loadState(st) {
    if (!stateCache[st]) stateCache[st] = await getJSON(`data/states/${st}.json`).catch(() => ({ entities: [], stopped: [] }));
    return stateCache[st];
  }

  // sequential color for share of Elevated+High
  function shade(p, max) {
    const t = Math.max(0, Math.min(1, max ? p / max : 0));
    const a = [235, 241, 247], b = [31, 78, 121];
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return { bg: `rgb(${c})`, fg: t > 0.55 ? "#fff" : "#1b2430" };
  }

  function setActive(name) {
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
  }

  // ---------- views ----------
  function viewHome() {
    setActive("home");
    const N = SUMMARY.national, M = SUMMARY.meta;
    const tiers = N.tiers;
    const total = Object.values(tiers).reduce((a, b) => a + b, 0) || 1;
    app.innerHTML = `
      <h1>Which local governments show audit warning signs?</h1>
      <p class="lede">Every U.S. city, county, town, village and district that spends federal grant money above the threshold must file a Single Audit with the Federal Audit Clearinghouse.
      This tool reads those filings for all states, turns the auditors' own reported findings into a transparent 0–100 screening score, and lists governments that appear to have <strong>stopped filing</strong>, a gap the GAO documented in
      <a href="https://www.gao.gov/products/gao-24-106173" target="_blank" rel="noopener">GAO-24-106173</a>.</p>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmtInt(N.entities)}</div><div class="l">local governments scored (audit year ${M.assessment_year})</div></div>
        <div class="kpi"><div class="v">${fmtMoney(N.federal_expended)}</div><div class="l">federal awards they spent</div></div>
        <div class="kpi"><div class="v">${fmtInt((tiers.Elevated || 0) + (tiers.High || 0))}</div><div class="l">Elevated or High score</div></div>
        <div class="kpi"><div class="v">${fmtInt(N.stopped_filers)}</div><div class="l">apparent stopped filers (${fmtInt(N.stopped_well_above_threshold)} were well above the threshold)</div></div>
        <div class="kpi"><div class="v">${fmtInt(N.late_filers)}</div><div class="l">filed after the 9-month deadline</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <h2>By state</h2>
          <div class="map-switch" role="group" aria-label="Map measure">
            <button class="btn on" data-m="pct">% Elevated or High</button>
            <button class="btn" data-m="stopped">Stopped filers</button>
            <button class="btn" data-m="avg">Average score</button>
          </div>
          <div id="tilemap" class="tilemap"></div>
          <div id="legend" class="legend"></div>
          <p class="small muted">Click a state to open its list.</p>
        </div>
        <div class="card">
          <h2>National score distribution</h2>
          <div class="tierbar">${["Low", "Moderate", "Elevated", "High"].map((t) => `<div title="${t}: ${fmtInt(tiers[t])}" style="width:${(100 * (tiers[t] || 0)) / total}%;background:${TIER_COLOR[t]}"></div>`).join("")}</div>
          <table><tbody>${["High", "Elevated", "Moderate", "Low"].map((t) => `<tr style="cursor:default"><td>${pill(t)}</td><td class="num">${fmtInt(tiers[t])}</td><td class="num muted">${((100 * (tiers[t] || 0)) / total).toFixed(1)}%</td></tr>`).join("")}</tbody></table>
          <div class="notice">A high score means the auditor reported several warning signs, such as going-concern doubt, material weaknesses, repeat findings or late filing. It is a reason to look closer, not proof of a problem. <a href="#method">How the score works</a>.</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card"><h2>Highest scores nationally</h2>${miniTable(N.top_risk, "risk")}</div>
        <div class="card"><h2>Largest apparent stopped filers</h2>${miniTable(N.top_stopped, "stopped")}
          <p class="small muted">Ranked by federal spending in the last audit they filed, excluding one-time COVID-19 relief.</p></div>
      </div>
      <div class="card">
        <h2>Download the data</h2>
        <p>Free for anyone to use, cite and check. <a class="btn" href="data/scores.csv" download>Scores (CSV)</a> <a class="btn" href="data/stopped_filers.csv" download>Stopped filers (CSV)</a> <a class="btn" href="data/summary.json" download>State summary (JSON)</a></p>
      </div>`;
    drawMap("pct");
    app.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => {
      app.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x === b));
      drawMap(b.dataset.m);
    }));
    bindRows();
  }

  function miniTable(rows, kind) {
    if (!rows || !rows.length) return `<p class="muted">None.</p>`;
    if (kind === "risk")
      return `<div class="table-wrap"><table><thead><tr><th>Government</th><th>State</th><th class="num">Score</th></tr></thead><tbody>${rows.slice(0, 10).map((r) =>
        `<tr data-st="${esc(r.state)}" data-id="${esc(r.id)}" data-kind="entity"><td>${esc(r.name)}<div class="small muted">${fmtMoney(r.federal_expended)} federal</div></td><td>${esc(r.state)}</td><td class="num">${pill(r.tier)} ${r.score}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="table-wrap"><table><thead><tr><th>Government</th><th>State</th><th class="num">Last filed</th><th class="num">Federal then</th></tr></thead><tbody>${rows.slice(0, 10).map((r) =>
      `<tr data-st="${esc(r.state)}" data-id="${esc(r.id)}" data-kind="stopped"><td>${esc(r.name)}<div class="small muted">${fmtInt(r.days_overdue)} days past due</div></td><td>${esc(r.state)}</td><td class="num">${r.last_year_filed}</td><td class="num">${fmtMoney(r.last_federal_expended)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function drawMap(measure) {
    const S = SUMMARY.states;
    const val = (st) => (S[st] ? (measure === "pct" ? S[st].pct_elevated_or_high : measure === "stopped" ? S[st].stopped_filers : S[st].avg_score) : null);
    const vals = Object.keys(TILES).map(val).filter((v) => v != null);
    const max = Math.max(1, ...vals);
    const unit = measure === "pct" ? "%" : "";
    const el = document.getElementById("tilemap");
    el.innerHTML = Object.entries(TILES).map(([st, [c, r]]) => {
      const v = val(st);
      const { bg, fg } = v == null ? { bg: "#f0f0f0", fg: "#999" } : shade(v, max);
      const label = S[st] ? `${S[st].name}: ${v}${unit}` : `${st}: no data`;
      return `<a class="tile" href="#state-${st}" style="grid-column:${c + 1};grid-row:${r + 1};background:${bg};color:${fg}" title="${esc(label)}" aria-label="${esc(label)}">${st}<span>${v == null ? "" : v + unit}</span></a>`;
    }).join("");
    const steps = [0, 0.25, 0.5, 0.75, 1].map((t) => shade(t * max, max).bg);
    document.getElementById("legend").innerHTML = `<span>0${unit}</span>${steps.map((c) => `<i style="background:${c}"></i>`).join("")}<span>${Math.round(max)}${unit}</span>`;
  }

  async function viewState(st) {
    setActive("state");
    st = (st || "IL").toUpperCase();
    const S = SUMMARY.states;
    const info = S[st];
    const opts = Object.entries(S).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([k, v]) => `<option value="${k}" ${k === st ? "selected" : ""}>${esc(v.name)}</option>`).join("");
    if (!info) {
      app.innerHTML = `<div class="toolbar"><select id="stpick">${opts}</select></div><p>No local government Single Audits for ${esc(st)} in this dataset.</p>`;
      document.getElementById("stpick").onchange = (e) => (location.hash = `#state-${e.target.value}`);
      return;
    }
    app.innerHTML = `<p class="loading">Loading ${esc(info.name)}…</p>`;
    const data = await loadState(st);
    const t = info.tiers;
    app.innerHTML = `
      <div class="toolbar"><select id="stpick" aria-label="Choose a state">${opts}</select>
        <a class="btn" href="#stopped-${st}">Stopped filers in ${esc(info.name)} (${fmtInt(info.stopped_filers)})</a></div>
      <h1>${esc(info.name)}</h1>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmtInt(info.entities)}</div><div class="l">local governments scored</div></div>
        <div class="kpi"><div class="v">${info.pct_elevated_or_high}%</div><div class="l">Elevated or High (${fmtInt((t.Elevated || 0) + (t.High || 0))})</div></div>
        <div class="kpi"><div class="v">${fmtMoney(info.federal_expended)}</div><div class="l">federal awards spent</div></div>
        <div class="kpi"><div class="v">${fmtInt(info.late_filers)}</div><div class="l">filed late</div></div>
        <div class="kpi"><div class="v">${fmtInt(info.repeat_findings)}</div><div class="l">with repeat findings</div></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <input id="q" type="search" placeholder="Search by name or city…" aria-label="Search">
          <select id="tier" aria-label="Filter by tier"><option value="">All tiers</option><option>High</option><option>Elevated</option><option>Moderate</option><option>Low</option></select>
          <select id="flag" aria-label="Filter by warning sign"><option value="">Any warning sign</option>${Object.entries(SUMMARY.meta.flag_text).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        </div>
        <div class="table-wrap"><table id="tbl"><thead><tr>
          <th data-k="name">Government</th><th data-k="score" class="num">Score</th><th data-k="federal_expended" class="num">Federal spent</th>
          <th data-k="days_late" class="num">Days late</th><th>Warning signs</th></tr></thead><tbody></tbody></table></div>
        <div class="pager" id="pager"></div>
      </div>`;
    document.getElementById("stpick").onchange = (e) => (location.hash = `#state-${e.target.value}`);
    let sortK = "score", dir = -1, page = 0;
    const PER = 50;
    const render = () => {
      const q = document.getElementById("q").value.trim().toLowerCase();
      const tier = document.getElementById("tier").value;
      const flag = document.getElementById("flag").value;
      let rows = data.entities.filter((e) =>
        (!q || (e.name + " " + e.city).toLowerCase().includes(q)) && (!tier || e.tier === tier) && (!flag || e.flags.includes(flag)));
      rows.sort((a, b) => {
        const x = a[sortK] ?? 0, y = b[sortK] ?? 0;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
      });
      const pages = Math.max(1, Math.ceil(rows.length / PER));
      page = Math.min(page, pages - 1);
      document.querySelector("#tbl tbody").innerHTML = rows.slice(page * PER, page * PER + PER).map((e) => `
        <tr data-st="${st}" data-id="${esc(e.id)}" data-kind="entity">
          <td><strong>${esc(e.name)}</strong><div class="small muted">${esc(e.city)}</div></td>
          <td class="num">${pill(e.tier)} ${scorebar(e.score, e.tier)}</td>
          <td class="num">${fmtMoney(e.federal_expended)}</td>
          <td class="num">${e.days_late ? fmtInt(e.days_late) : "—"}</td>
          <td><div class="chips">${e.flags.filter((f) => f !== "not_low_risk_auditee").slice(0, 4).map((f) => `<span class="chip">${esc(shortFlag(f))}</span>`).join("")}</div></td>
        </tr>`).join("") || `<tr><td colspan="5" class="muted">No matches.</td></tr>`;
      document.getElementById("pager").innerHTML = `${fmtInt(rows.length)} governments · page ${page + 1} of ${pages}
        <button class="btn" id="prev" ${page ? "" : "disabled"}>‹ Prev</button><button class="btn" id="next" ${page < pages - 1 ? "" : "disabled"}>Next ›</button>`;
      document.getElementById("prev").onclick = () => { page--; render(); };
      document.getElementById("next").onclick = () => { page++; render(); };
      bindRows();
    };
    ["q", "tier", "flag"].forEach((id) => document.getElementById(id).addEventListener("input", () => { page = 0; render(); }));
    document.querySelectorAll("#tbl th[data-k]").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      dir = sortK === k ? -dir : k === "name" ? 1 : -1;
      sortK = k;
      render();
    }));
    render();
  }

  function shortFlag(f) {
    return ({
      going_concern: "Going concern", fs_opinion_disclaimer_or_adverse: "Adverse/disclaimer", fs_opinion_qualified: "Qualified opinion",
      fs_material_weakness: "Material weakness", fs_significant_deficiency: "Significant deficiency", program_material_weakness: "Program MW",
      fs_material_noncompliance: "Material noncompliance", program_modified_opinion: "Modified compliance opinion", questioned_costs: "Questioned costs",
      repeat_finding: "Repeat finding", late: "Late filing", prior_findings_reported: "Prior findings", not_low_risk_auditee: "Not low-risk",
    })[f] || f;
  }

  async function viewStopped(st) {
    setActive("stopped");
    const S = SUMMARY.states, M = SUMMARY.meta;
    const opts = `<option value="">All states (top 25)</option>` + Object.entries(S).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([k, v]) => `<option value="${k}" ${k === st ? "selected" : ""}>${esc(v.name)} (${v.stopped_filers})</option>`).join("");
    let rows;
    if (st) {
      const d = await loadState(st);
      rows = d.stopped.map((s) => ({ ...s, state: st }));
    } else rows = SUMMARY.national.top_stopped;
    app.innerHTML = `
      <h1>Governments that appear to have stopped filing</h1>
      <p class="lede">These local governments filed a Single Audit for ${M.assessment_year - 2} or ${M.assessment_year - 1} but have nothing on file for ${M.assessment_year}, under any entity type or identifier, even though that audit is now more than 90 days past due.
      The GAO found that the Federal Audit Clearinghouse <a href="https://www.gao.gov/products/gao-24-106173" target="_blank" rel="noopener">cannot identify entities that should file but do not</a>. This list is a first step toward closing that gap.</p>
      <div class="notice">An entry here is <strong>not</strong> proof of noncompliance. The government may have spent less than the threshold this year (it rose from $750,000 to $1,000,000 for fiscal years beginning on or after October 1, 2024), changed its identifier, filed under a different name, or be part of another entity's audit.
      Many governments crossed the threshold only because of one-time COVID-19 relief (ARPA, ESSER and similar), which is now ending. Entries marked <strong>well above threshold</strong> spent at least $1.5M in their last audit <em>excluding</em> those COVID programs, so dropping below the threshold is a less likely explanation.</div>
      <div class="card">
        <div class="toolbar"><select id="stpick" aria-label="Choose a state">${opts}</select>
          <a class="btn" href="data/stopped_filers.csv" download>Download all (CSV)</a></div>
        <div class="table-wrap"><table><thead><tr><th>Government</th>${st ? "" : "<th>State</th>"}<th class="num">Last filed</th><th class="num">Federal spent then</th><th class="num">Days past due</th><th>Last score</th></tr></thead>
        <tbody>${rows.map((s) => `<tr data-st="${esc(s.state)}" data-id="${esc(s.id)}" data-kind="stopped">
          <td><strong>${esc(s.name)}</strong><div class="small muted">${esc(s.city || "")}${s.well_above_threshold ? ' · <span class="chip">well above threshold</span>' : ""}</div></td>
          ${st ? "" : `<td>${esc(s.state)}</td>`}<td class="num">${s.last_year_filed}</td><td class="num">${fmtMoney(s.last_federal_expended)}</td>
          <td class="num">${fmtInt(s.days_overdue)}</td><td>${pill(s.last_tier)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">None found.</td></tr>`}</tbody></table></div>
      </div>`;
    document.getElementById("stpick").onchange = (e) => (location.hash = e.target.value ? `#stopped-${e.target.value}` : "#stopped");
    bindRows();
  }

  function viewMethod() {
    setActive("method");
    const M = SUMMARY.meta, P = M.points;
    const row = (comp, label, pts) => `<tr><td>${comp}</td><td>${label}</td><td class="num">${pts}</td></tr>`;
    app.innerHTML = `<div class="method">
      <h1>How the score works</h1>
      <p class="lede">Version ${esc(M.method_version)}. The score uses only public fields from Single Audits in the Federal Audit Clearinghouse. It is rule-based, so the same audit always gets the same score and anyone can recompute it from the <a href="${repoOk() ? `https://github.com/${CFG.githubRepo}` : "#feedback"}">open source code</a>.</p>
      <div class="card">
        <h2>Four parts, 25 points each</h2>
        <div class="table-wrap"><table><thead><tr><th>Part</th><th>What the auditor reported</th><th class="num">Points</th></tr></thead><tbody>
          ${row("A. Financial statement audit", "Substantial doubt about going concern", P.going_concern)}
          ${row("", "Adverse opinion or disclaimer on the financial statements", P.fs_opinion_disclaimer_or_adverse)}
          ${row("", "Qualified opinion on the financial statements", P.fs_opinion_qualified)}
          ${row("B. Internal control", "Material weakness over financial reporting", P.fs_material_weakness)}
          ${row("", "Significant deficiency over financial reporting", P.fs_significant_deficiency)}
          ${row("", "Material weakness over a federal program (any finding)", P.program_material_weakness)}
          ${row("C. Federal award compliance", "Material noncompliance in the financial statement audit", P.fs_material_noncompliance)}
          ${row("", "Modified opinion on compliance for a major program", P.program_modified_opinion)}
          ${row("", "Questioned costs", P.questioned_costs)}
          ${row("", `Repeat findings (${P.repeat_finding_each} each, up to ${P.repeat_finding_max_count})`, `up to ${P.repeat_finding_each * P.repeat_finding_max_count}`)}
          ${row("D. Filing discipline", "Accepted 1–90 days after the 9-month deadline", P.late_up_to_90_days)}
          ${row("", "Accepted 91–365 days late", P.late_91_to_365_days)}
          ${row("", "Accepted more than a year late", P.late_over_365_days)}
          ${row("", "Federal agencies listed with prior-year findings", P.prior_findings_reported)}
          ${row("", "Did not qualify as a low-risk auditee", P.not_low_risk_auditee)}
        </tbody></table></div>
        <p class="small muted">Each part is capped at ${M.component_cap}. Tiers: ${M.tiers.map((t) => `${t.label} ≥ ${t.min}`).join(", ")}.</p>
      </div>
      <div class="card">
        <h2>Data and rules</h2>
        <ul>
          <li><strong>Who is included:</strong> audits with entity type "local" (cities, counties, towns, townships, villages, school and special districts) in every state, DC and the territories.</li>
          <li><strong>Year scored:</strong> audit year ${M.assessment_year}, the latest year whose filing deadline (nine months after fiscal year end) has passed for every fiscal year end, plus a ${30}-day grace period. Prior years appear as history.</li>
          <li><strong>One audit per government per year:</strong> superseded resubmissions are dropped and the most recently accepted version is kept. Governments are matched by UEI, then EIN, then name.</li>
          <li><strong>Lateness</strong> is measured from fiscal year end + 9 months to the date the FAC accepted the audit. Federal rules require the earlier of 30 days after the auditor's report or 9 months, and the FAC does not publish the report date, so this measure is lenient.</li>
          <li><strong>Stopped filers:</strong> filed for one of the two prior years, nothing on file for the scored year or later under any entity type, UEI or EIN, and the missing audit is more than 90 days past due. "Well above threshold" means at least $1.5M of federal spending in the last audit, excluding one-time COVID-19 relief programs (ALN 21.019, 21.023, 21.026, 21.027, 21.029, 21.032 and 84.425).</li>
          <li><strong>Updated</strong> weekly from <code>api.fac.gov</code>. Data last generated ${esc(new Date(M.generated_at).toLocaleString())}.</li>
        </ul>
      </div>
      <div class="card">
        <h2>Limits</h2>
        <ul>
          <li>The score reflects what auditors reported. It cannot see problems an audit missed, and it does not judge how serious a specific finding is.</li>
          <li>Governments below the Single Audit threshold are not in the FAC, so they are not covered.</li>
          <li>Validation against later outcomes (for example state fiscal-distress lists and later going-concern opinions) is in progress. Weights may change in future versions, and every version is recorded.</li>
        </ul>
      </div>
      <div class="card">
        <h2>Cite this work</h2>
        <p>${esc(CFG.author || "Author")}. <em>Municipal Financial Risk Score: open screening of local government Single Audits</em>, version ${esc(M.method_version)}. ${CFG.doi ? `DOI: <a href="https://doi.org/${esc(CFG.doi)}">${esc(CFG.doi)}</a>.` : "DOI forthcoming."}</p>
      </div></div>`;
  }

  let pendingFeedback = null; // set when "Report a data issue" is clicked on a government

  function viewFeedback() {
    setActive("feedback");
    const pre = pendingFeedback || {};
    pendingFeedback = null;
    const opened = Date.now();
    const gh = repoOk() ? `https://github.com/${CFG.githubRepo}/issues/new?labels=feedback` : "";
    const roles = ["State or local oversight agency", "Pass-through / grant office", "Auditor or CPA firm",
      "Local government finance officer", "Researcher or student", "Journalist", "Resident", "Other"];
    app.innerHTML = `
      <h1>Help improve this tool</h1>
      <p class="lede">Feedback from auditors, oversight agencies, pass-through entities, finance officers and researchers shapes the next version. Your message goes directly to the project author.</p>
      <div class="card" style="max-width:760px">
        <form id="fb" novalidate>
          <div class="fb-grid">
            <label>What is this about?
              <select name="type">
                <option value="general" ${pre.type === "general" || !pre.type ? "selected" : ""}>General feedback</option>
                <option value="data" ${pre.type === "data" ? "selected" : ""}>Report a data issue</option>
                <option value="method" ${pre.type === "method" ? "selected" : ""}>Suggest a methodology change</option>
              </select></label>
            <label>Your role
              <select name="role"><option value="">Choose (optional)</option>${roles.map((r) => `<option>${esc(r)}</option>`).join("")}</select></label>
            <label>Name (optional)<input name="name" maxlength="120" autocomplete="name"></label>
            <label>Email, if you'd like a reply (optional)<input name="email" type="email" maxlength="200" autocomplete="email"></label>
            <label class="full">Organization (optional)<input name="organization" maxlength="200" autocomplete="organization"></label>
            <label class="full">Subject (optional)<input name="subject" maxlength="200" value="${esc(pre.subject || "")}"></label>
            <label class="full">Message<textarea name="message" rows="7" maxlength="5000" required placeholder="What was useful? What looks wrong or should change? Would you use this in your work?">${esc(pre.message || "")}</textarea></label>
            <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
          </div>
          <p class="small muted">Please don't include confidential or client information. Your email is used only to reply to you.</p>
          <button class="btn primary" type="submit" id="fb-send">Send feedback</button>
          <span id="fb-status" class="small" role="status" style="margin-left:10px"></span>
        </form>
      </div>
      ${gh ? `<p class="small muted">Prefer a public discussion? <a href="${gh}" target="_blank" rel="noopener">Open an issue on GitHub</a> (free account needed).</p>` : ""}`;
    const form = document.getElementById("fb");
    const status = document.getElementById("fb-status");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if ((data.message || "").trim().length < 10) {
        status.textContent = "Please write a short message (at least 10 characters).";
        return;
      }
      data.elapsed_ms = Date.now() - opened;
      data.page = location.href;
      const btn = document.getElementById("fb-send");
      btn.disabled = true;
      status.textContent = "Sending…";
      try {
        const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
        const out = await r.json().catch(() => ({}));
        if (r.ok && out.ok) {
          form.innerHTML = `<h2>Thank you!</h2><p>Your feedback was sent${data.email ? ", and you may get a reply by email" : ""}.</p>`;
        } else {
          status.textContent = out.error || "Sorry, something went wrong. Please try again.";
          btn.disabled = false;
        }
      } catch {
        status.textContent = "Network error. Please try again.";
        btn.disabled = false;
      }
    });
  }

  function reportIssue(subject, message) {
    pendingFeedback = { type: "data", subject, message };
    closeModal();
    if (location.hash === "#feedback") viewFeedback();
    else location.hash = "#feedback";
  }

  // ---------- entity detail ----------
  async function openDetail(st, id, kind) {
    const d = await loadState(st);
    if (kind === "stopped") {
      const s = d.stopped.find((x) => x.id === id);
      if (!s) return;
      modalBody.innerHTML = `
        <h2 id="modal-title">${esc(s.name)}</h2><p class="muted">${esc(s.city)}, ${esc(st)} · apparent stopped filer</p>
        <dl class="dl">
          <dt>Last audit filed</dt><dd>Audit year ${s.last_year_filed} · <a href="${facLink(s.last_report_id)}" target="_blank" rel="noopener">view on FAC</a></dd>
          <dt>Federal spent then</dt><dd>${fmtMoney(s.last_federal_expended)}${s.well_above_threshold ? " (well above threshold)" : ""}</dd>
          ${s.last_covid_relief_expended ? `<dt>Of which COVID-19 relief</dt><dd>${fmtMoney(s.last_covid_relief_expended)}</dd>` : ""}
          <dt>Expected fiscal year end</dt><dd>${fmtDate(s.expected_fy_end)}</dd>
          <dt>That audit was due</dt><dd>${fmtDate(s.was_due)} (${fmtInt(s.days_overdue)} days ago)</dd>
          <dt>Score on last audit</dt><dd>${pill(s.last_tier)} ${s.last_score}</dd>
        </dl>
        <div class="notice">Possible reasons other than noncompliance: federal spending fell below the threshold, a new identifier, or inclusion in another entity's audit.</div>
        <button class="btn" id="report-issue">Report a data issue</button>`;
      modalBody.querySelector("#report-issue").onclick = () => reportIssue(`${s.name} (${st})`, `Entity ID: ${s.id}\nListed as stopped filer (last filed ${s.last_year_filed}).\n\nWhat looks wrong:\n`);
    } else {
      const e = d.entities.find((x) => x.id === id);
      if (!e) return;
      const pts = SUMMARY.meta.points;
      const flagPts = (f) => ({ repeat_finding: Math.min(e.findings.repeat, pts.repeat_finding_max_count) * pts.repeat_finding_each,
        late: e.days_late > 365 ? pts.late_over_365_days : e.days_late > 90 ? pts.late_91_to_365_days : pts.late_up_to_90_days }[f] ?? pts[f] ?? "");
      modalBody.innerHTML = `
        <h2 id="modal-title">${esc(e.name)}</h2><p class="muted">${esc(e.city)}, ${esc(st)} · audit year ${e.year}</p>
        <p>${pill(e.tier)} <strong style="font-size:1.4rem">${e.score}</strong> <span class="muted">/ 100</span></p>
        ${Object.entries(e.components).map(([k, v]) => `<div class="comp"><span>${COMP_NAME[k]}</span><span class="track"><b style="width:${(v / 25) * 100}%"></b></span><span class="num">${v}/25</span></div>`).join("")}
        <h3 style="margin-top:16px">What the auditor reported</h3>
        <ul class="flaglist">${e.flags.length ? e.flags.map((f) => `<li><span>${esc(flagText(f))}${f === "late" ? ` (${fmtInt(e.days_late)} days)` : ""}${f === "repeat_finding" ? ` (${e.findings.repeat})` : ""}</span><strong>+${flagPts(f)}</strong></li>`).join("") : "<li>No warning signs reported.</li>"}</ul>
        <dl class="dl">
          <dt>Federal awards spent</dt><dd>${fmtMoney(e.federal_expended)}</dd>
          <dt>Findings (federal programs)</dt><dd>${e.findings.count} total · ${e.findings.repeat} repeat · ${e.findings.questioned_costs} with questioned costs</dd>
          <dt>Fiscal year end</dt><dd>${fmtDate(e.fy_end)}</dd>
          <dt>Accepted by FAC</dt><dd>${fmtDate(e.accepted)}</dd>
          <dt>Auditor</dt><dd>${esc(e.auditor) || "—"}</dd>
          <dt>Score history</dt><dd>${e.history.map((h) => `${h.year}: ${pill(h.tier)} ${h.score}`).join(" &nbsp; ")}</dd>
        </dl>
        <p><a class="btn" href="${facLink(e.report_id)}" target="_blank" rel="noopener">View the audit on FAC</a>
        <button class="btn" id="report-issue">Report a data issue</button></p>
        <p class="small muted">Screening indicator from the auditor's reported results. Not an audit opinion or a finding of wrongdoing.</p>`;
      modalBody.querySelector("#report-issue").onclick = () => reportIssue(`${e.name} (${st})`, `Entity ID: ${e.id}\nReport: ${e.report_id}\nScore shown: ${e.score}\n\nWhat looks wrong:\n`);
    }
    modal.hidden = false;
    modal.querySelector(".modal-close").focus();
  }
  function closeModal() { modal.hidden = true; }
  modal.addEventListener("click", (ev) => { if (ev.target === modal || ev.target.classList.contains("modal-close")) closeModal(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeModal(); });

  function bindRows() {
    app.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.tabIndex = 0;
      const go = () => openDetail(tr.dataset.st, tr.dataset.id, tr.dataset.kind);
      tr.onclick = go;
      tr.onkeydown = (ev) => { if (ev.key === "Enter") go(); };
    });
  }

  // ---------- router ----------
  async function route() {
    closeModal();
    // routes: #home, #state-IL, #stopped, #stopped-IL, #method, #feedback
    const parts = location.hash.replace(/^#\/?/, "").split(/[-/]/);
    try {
      if (parts[0] === "state") await viewState(parts[1]);
      else if (parts[0] === "stopped") await viewStopped(parts[1]);
      else if (parts[0] === "method") viewMethod();
      else if (parts[0] === "feedback") viewFeedback();
      else viewHome();
    } catch (err) {
      app.innerHTML = `<p>Something went wrong loading this page: ${esc(err.message)}</p>`;
    }
    window.scrollTo(0, 0);
  }

  getJSON("data/summary.json").then((s) => {
    SUMMARY = s;
    document.getElementById("sample-banner").hidden = !s.meta.sample;
    document.getElementById("footer-meta").textContent =
      `Method v${s.meta.method_version} · audit year ${s.meta.assessment_year} · data generated ${new Date(s.meta.generated_at).toLocaleDateString()}`;
    window.addEventListener("hashchange", route);
    route();
  }).catch((err) => {
    app.innerHTML = `<h1>Data not built yet</h1><p>Run <code>python pipeline/build_dataset.py</code> (or the GitHub Action) to create <code>site/data/summary.json</code>.</p><p class="muted">${esc(err.message)}</p>`;
  });
})();
