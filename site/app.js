/* Municipal Financial Risk Score — front end (no build step, no dependencies). */
(() => {
  "use strict";
  const CFG = window.MFRS_CONFIG || {};
  const app = document.getElementById("app");
  const modal = document.getElementById("modal");
  const modalBody = document.getElementById("modal-body");
  const stateCache = {};
  const cache = {};
  let SUMMARY = null;

  const TIER_COLOR = { Low: "#5b8c6b", Moderate: "#d1a73a", Elevated: "#dd7a2e", High: "#b8322a" };
  const ACCENT = "#1f4e79", NATIONAL = "#8a94a3";
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
  const TABS = [
    ["requirements", "Compliance requirements"], ["programs", "Federal programs"], ["passthrough", "Pass-through entities"],
    ["timeliness", "Filing timeliness"], ["persistence", "Persistent findings"], ["themes", "Finding themes"],
  ];

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtInt = (n) => (n ?? 0).toLocaleString("en-US");
  const pl = (n, one, many) => `${fmtInt(n)} ${n === 1 ? one : many}`;
  const fmtPct = (n) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);
  const fmtMoney = (n) => {
    n = n || 0;
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + n;
  };
  const fmtDate = (s) => (s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
  const pill = (t) => `<span class="pill ${esc(t)}">${esc(t)}</span>`;
  const scorebar = (s, t) => `<span class="scorebar"><b style="width:${s}%;background:${TIER_COLOR[t]}"></b></span><strong>${s}</strong>`;
  const facLink = (rid) => `https://app.fac.gov/dissemination/summary/${encodeURIComponent(rid)}`;
  const repoOk = () => CFG.githubRepo && !CFG.githubRepo.startsWith("YOUR-");
  const flagText = (f) => (SUMMARY.meta.flag_text || {})[f] || f;
  const flagHelp = (f) => (SUMMARY.meta.flag_help || {})[f] || "";
  const stName = (st) => (SUMMARY.states[st] && SUMMARY.states[st].name) || st;
  // Must match pipeline/analytics.py and src/gov.js
  const shardOf = (id) => { let s = 0; for (const ch of id) s += ch.codePointAt(0); return s % 16; };
  const slugify = (n) => (String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "government");
  const encId = (id) => encodeURIComponent(id).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const govPath = (st, id, name) => `/gov/${st}/${encId(id)}/${slugify(name)}`;

  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  async function once(key, path) {
    if (!(key in cache)) cache[key] = getJSON(path).catch(() => null);
    return cache[key];
  }
  async function loadState(st) {
    if (!stateCache[st]) stateCache[st] = await getJSON(`data/states/${st}.json`).catch(() => ({ entities: [], stopped: [] }));
    return stateCache[st];
  }
  const insights = () => once("insights", "data/insights.json");
  const govRecord = async (st, id) => ((await once(`gov-${st}-${shardOf(id)}`, `data/gov/${st}/${shardOf(id)}.json`)) || {})[id];

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
  function stateOptions(sel, allLabel) {
    return (allLabel ? `<option value="">${esc(allLabel)}</option>` : "") + Object.entries(SUMMARY.states)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(v.name)}</option>`).join("");
  }
  const smallSample = (n, what) => `<div class="notice">Only ${fmtInt(n)} ${what} here, so percentages can swing a lot from year to year. Compare with care.</div>`;
  const unavailable = (what) => `<div class="notice">${esc(what)} is not available in this week's data. It appears after the next weekly update, or the download from the Federal Audit Clearinghouse failed this week (see <a href="#validation">Data quality</a>).</div>`;

  // ---------- small charts (single hue; values always also in a table) ----------
  function bars(rows, fmt, opts = {}) {
    if (!rows.length) return `<p class="muted">No data.</p>`;
    const max = Math.max(...rows.map((r) => r.value), 1);
    return `<div class="bars" role="list">${rows.map((r) => `
      <div class="bar-row" role="listitem" title="${esc(r.label)}: ${esc(fmt(r.value))}">
        <div class="bar-label">${r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label)}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ""}</div>
        <div class="bar-track"><b style="width:${((100 * r.value) / max).toFixed(1)}%;background:${opts.color || ACCENT}"></b>${r.ref != null ? `<i class="bar-ref" style="left:${Math.min(100, (100 * r.ref) / max).toFixed(1)}%" title="National: ${esc(fmt(r.ref))}"></i>` : ""}</div>
        <div class="bar-val num">${esc(fmt(r.value))}</div>
      </div>`).join("")}</div>${rows.some((r) => r.ref != null) ? `<p class="small muted"><i class="bar-ref-key"></i> national figure for comparison</p>` : ""}`;
  }

  function lineChart(series, fmt, label) {
    const pts = series.flatMap((s) => s.points);
    if (!pts.length) return `<p class="muted">No data.</p>`;
    const W = 680, H = 240, L = 46, R = 120, T = 14, B = 30;
    const years = [...new Set(pts.map((p) => p.year))].sort((a, b) => a - b);
    const dataMax = Math.max(...pts.map((p) => p.value), 1);
    const p10 = Math.pow(10, Math.floor(Math.log10(dataMax / 4)));
    const f = dataMax / 4 / p10;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p10;
    const maxV = Math.ceil(dataMax / step) * step;
    const x = (y) => L + (years.length === 1 ? (W - L - R) / 2 : ((years.indexOf(y)) / (years.length - 1)) * (W - L - R));
    const yv = (v) => T + (1 - v / maxV) * (H - T - B);
    const ticks = [];
    for (let v = 0; v <= maxV + 1e-9; v += step) ticks.push(v);
    const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${yv(v).toFixed(1)}" y2="${yv(v).toFixed(1)}" stroke="#eef0f3"></line><text x="${L - 6}" y="${(yv(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#7a8494">${esc(fmt(v))}</text>`).join("");
    const xl = years.map((y) => `<text x="${x(y).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#7a8494">${y}</text>`).join("");
    const lines = series.map((s) => {
      const p = s.points.filter((q) => years.includes(q.year));
      if (!p.length) return "";
      const d = p.map((q, i) => `${i ? "L" : "M"}${x(q.year).toFixed(1)},${yv(q.value).toFixed(1)}`).join(" ");
      const last = p[p.length - 1];
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ""}></path>` +
        p.map((q) => `<circle cx="${x(q.year).toFixed(1)}" cy="${yv(q.value).toFixed(1)}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"><title>${esc(s.name)}, ${q.year}: ${esc(fmt(q.value))}</title></circle>`).join("") +
        `<text x="${(x(last.year) + 10).toFixed(1)}" y="${(yv(last.value) + 4).toFixed(1)}" font-size="12" fill="#4a5566">${esc(s.name)} ${esc(fmt(last.value))}</text>`;
    }).join("");
    const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
    return `${legend}<svg class="linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${xl}${lines}</svg>`;
  }

  // ---------- global search ----------
  async function loadIndex() {
    const idx = await once("index", "data/index.json");
    return idx ? idx.rows.map((r) => ({ st: r[0], id: r[1], name: r[2], city: r[3], kind: r[4], score: r[5], tier: r[6], ein: r[7] })) : [];
  }
  function searchBox(id, placeholder) {
    return `<div class="search"><input id="${id}" type="search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"><div class="search-results" id="${id}-r" role="listbox"></div></div>`;
  }
  function bindSearch(id) {
    const input = document.getElementById(id), out = document.getElementById(id + "-r");
    let rows = null, t = null;
    input.addEventListener("focus", async () => { if (!rows) rows = await loadIndex(); });
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (!rows) rows = await loadIndex();
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { out.innerHTML = ""; return; }
        const hits = rows.filter((r) => (r.name + " " + r.city + " " + r.id + " " + r.ein).toLowerCase().includes(q)).slice(0, 10);
        out.innerHTML = hits.length ? hits.map((r) => `<a role="option" href="${esc(govPath(r.st, r.id, r.name))}"><strong>${esc(r.name)}</strong> <span class="muted">${esc(r.city)}, ${esc(r.st)}</span> ${r.kind === "s" ? '<span class="chip">apparent stopped filer</span>' : pill(r.tier) + " " + r.score}</a>`).join("") : `<div class="muted small" style="padding:8px">No match. Governments below the Single Audit threshold are not in the FAC.</div>`;
      }, 120);
    });
  }

  // ---------- views ----------
  async function viewHome() {
    setActive("home");
    const N = SUMMARY.national, M = SUMMARY.meta;
    const tiers = N.tiers;
    const total = Object.values(tiers).reduce((a, b) => a + b, 0) || 1;
    app.innerHTML = `
      <h1>Which local governments show audit warning signs?</h1>
      <p class="lede">Every U.S. city, county, town, village and district that spends federal grant money above the threshold must file a Single Audit with the Federal Audit Clearinghouse.
      This tool reads those filings for all states, turns the auditors' own reported findings into a transparent 0–100 screening score, and lists governments that appear to have <strong>stopped filing</strong>, a gap the GAO documented in
      <a href="https://www.gao.gov/products/gao-24-106173" target="_blank" rel="noopener">GAO-24-106173</a>.</p>
      ${searchBox("gsearch", "Find a government by name, city, UEI or EIN…")}
      <div class="kpis">
        <div class="kpi"><div class="v">${fmtInt(N.entities)}</div><div class="l">local governments scored (audit year ${M.assessment_year})</div></div>
        <div class="kpi"><div class="v">${fmtMoney(N.federal_expended)}</div><div class="l">federal awards they spent</div></div>
        <div class="kpi"><div class="v">${fmtInt((tiers.Elevated || 0) + (tiers.High || 0))}</div><div class="l">Elevated or High score</div></div>
        <div class="kpi"><div class="v">${fmtInt(N.stopped_filers)}</div><div class="l">apparent stopped filers (${fmtInt(N.stopped_well_above_threshold)} were well above the threshold)</div></div>
        <div class="kpi"><div class="v">${fmtInt(N.late_filers)}</div><div class="l">filed after the 9-month deadline</div></div>
      </div>
      <div id="home-week"></div>
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
          <p class="small muted">Click a state to open its list. Each state also has a <a href="#brief-IL">printable brief</a>.</p>
        </div>
        <div class="card">
          <h2>National score distribution</h2>
          <div class="tierbar">${["Low", "Moderate", "Elevated", "High"].map((t) => `<div title="${t}: ${fmtInt(tiers[t])}" style="width:${(100 * (tiers[t] || 0)) / total}%;background:${TIER_COLOR[t]}"></div>`).join("")}</div>
          <table><tbody>${["High", "Elevated", "Moderate", "Low"].map((t) => `<tr style="cursor:default"><td>${pill(t)}</td><td class="num">${fmtInt(tiers[t])}</td><td class="num muted">${((100 * (tiers[t] || 0)) / total).toFixed(1)}%</td></tr>`).join("")}</tbody></table>
          <div class="notice">A high score means the auditor reported several warning signs, such as going-concern doubt, material weaknesses, repeat findings or late filing. It is a reason to look closer, not proof of a problem. <a href="#method">How the score works</a>.</div>
        </div>
      </div>
      <div id="home-insights"></div>
      <div class="grid-2">
        <div class="card"><h2>Highest scores nationally</h2>${miniTable(N.top_risk, "risk")}</div>
        <div class="card"><h2>Largest apparent stopped filers</h2>${miniTable(N.top_stopped, "stopped")}
          <p class="small muted">Ranked by federal spending in the last audit they filed, excluding one-time COVID-19 relief.</p></div>
      </div>
      <div class="card">
        <h2>Download the data</h2>
        <p>Free for anyone to use, cite and check. <a class="btn" href="data/scores.csv" download>Scores (CSV)</a> <a class="btn" href="data/stopped_filers.csv" download>Stopped filers (CSV)</a> <a class="btn" href="data/summary.json" download>State summary (JSON)</a> <a class="btn" href="data/insights.json" download>Insights (JSON)</a></p>
      </div>`;
    drawMap("pct");
    app.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => {
      app.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x === b));
      drawMap(b.dataset.m);
    }));
    bindRows();
    bindSearch("gsearch");
    const [ch, ins] = await Promise.all([once("changes", "data/changes.json"), insights()]);
    const wk = document.getElementById("home-week");
    if (wk && ch && ch.counts && Object.keys(ch.counts).length) {
      const c = ch.counts;
      wk.innerHTML = `<div class="card week"><h2>This week (data of ${fmtDate(ch.as_of)})</h2>
        <p>${pl(c.new_audits, "new audit", "new audits")} accepted (${fmtInt(c.new_audits_elevated_or_high)} Elevated or High) · ${pl(c.new_stopped, "new apparent stopped filer", "new apparent stopped filers")} · ${pl((ch.resolved_stopped || []).filter((x) => x.now_filed).length, "government", "governments")} filed again.
        <a href="#changes">See what changed</a> · <a href="/feeds/national.xml">RSS feed</a></p></div>`;
    }
    const hi = document.getElementById("home-insights");
    if (hi && ins) {
      const req = ins.requirements && ins.requirements.national[0];
      const prog = ins.programs && ins.programs.national[0];
      const tl = ins.timeliness && ins.timeliness.national;
      const lastT = tl && tl.length ? tl[tl.length - 2] || tl[tl.length - 1] : null;
      const per = ins.persistence && ins.persistence.national;
      const p3 = per ? ["3", "4", "5+"].reduce((a, k) => a + (per.findings_streak[k] || 0), 0) : null;
      const items = [
        req && [`#insights-requirements`, `${fmtPct(req.share)}`, `of federal award findings involve <strong>${esc(ins.requirements.labels[req.code])}</strong>, the most common compliance area`],
        prog && [`#insights-programs`, fmtInt(prog.findings), `findings on <strong>${esc(prog.name)}</strong>, more than any other federal program`],
        lastT && [`#insights-timeliness`, fmtPct(lastT.pct_late), `of ${lastT.year} audits reached the clearinghouse after the 9-month deadline`],
        p3 != null && [`#insights-persistence`, fmtInt(p3), `governments have had federal findings in each of their last three or more audits`],
      ].filter(Boolean);
      if (items.length) hi.innerHTML = `<div class="card"><h2>Insights</h2><div class="insight-tiles">${items.map(([href, v, t]) => `<a class="insight" href="${href}"><div class="v">${v}</div><div class="l">${t}</div></a>`).join("")}</div>
        <p class="small muted"><a href="#insights">Explore all analyses</a>: compliance requirements, federal programs, pass-through entities, filing timeliness, persistent findings and finding themes.</p></div>`;
    }
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
    const opts = stateOptions(st);
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
        <a class="btn" href="#stopped-${st}">Stopped filers in ${esc(info.name)} (${fmtInt(info.stopped_filers)})</a>
        <a class="btn" href="#brief-${st}">State brief (printable)</a>
        <a class="btn" href="#insights-requirements-${st}">Insights for ${esc(info.name)}</a>
        <a class="btn" href="#changes-${st}">What changed</a>
        <a class="btn" href="/feeds/${st}.xml" title="Weekly changes as an RSS feed">RSS</a></div>
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
    const hasUsa = rows.some((s) => s.usa);
    app.innerHTML = `
      <h1>Governments that appear to have stopped filing</h1>
      <p class="lede">These local governments filed a Single Audit for ${M.assessment_year - 2} or ${M.assessment_year - 1} but have nothing on file for ${M.assessment_year}, under any entity type or identifier, even though that audit is now more than 90 days past due.
      The GAO found that the Federal Audit Clearinghouse <a href="https://www.gao.gov/products/gao-24-106173" target="_blank" rel="noopener">cannot identify entities that should file but do not</a>. This list is a first step toward closing that gap.</p>
      <div class="notice">An entry here is <strong>not</strong> proof of noncompliance. The government may have spent less than the threshold this year (it rose from $750,000 to $1,000,000 for fiscal years beginning on or after October 1, 2024), changed its identifier, filed under a different name, or be part of another entity's audit.
      Many governments crossed the threshold only because of one-time COVID-19 relief (ARPA, ESSER and similar), which is now ending. Entries marked <strong>well above threshold</strong> spent at least $1.5M in their last audit <em>excluding</em> those COVID programs, so dropping below the threshold is a less likely explanation.
      ${hasUsa ? "The <strong>new direct grants</strong> column shows federal grant money obligated directly to the government since the missing year began (USAspending). It is not spending, and money received through a state is not included." : ""}
      See <a href="#validation">Data quality</a> for how this list is checked.</div>
      <div class="card">
        <div class="toolbar"><select id="stpick" aria-label="Choose a state">${opts}</select>
          <a class="btn" href="data/stopped_filers.csv" download>Download all (CSV)</a></div>
        <div class="table-wrap"><table><thead><tr><th>Government</th>${st ? "" : "<th>State</th>"}<th class="num">Last filed</th><th class="num">Federal spent then</th>${hasUsa ? '<th class="num">New direct grants since</th>' : ""}<th class="num">Days past due</th><th>Last score</th></tr></thead>
        <tbody>${rows.map((s) => `<tr data-st="${esc(s.state)}" data-id="${esc(s.id)}" data-kind="stopped">
          <td><strong>${esc(s.name)}</strong><div class="small muted">${esc(s.city || "")}${s.well_above_threshold ? ' · <span class="chip">well above threshold</span>' : ""}</div></td>
          ${st ? "" : `<td>${esc(s.state)}</td>`}<td class="num">${s.last_year_filed}</td><td class="num">${fmtMoney(s.last_federal_expended)}</td>
          ${hasUsa ? `<td class="num">${s.usa ? fmtMoney(s.usa.amount) : "—"}</td>` : ""}
          <td class="num">${fmtInt(s.days_overdue)}</td><td>${pill(s.last_tier)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">None found.</td></tr>`}</tbody></table></div>
      </div>`;
    document.getElementById("stpick").onchange = (e) => (location.hash = e.target.value ? `#stopped-${e.target.value}` : "#stopped");
    bindRows();
  }

  // ---------- insights ----------
  async function viewInsights(tab, st) {
    setActive("insights");
    tab = TABS.some(([k]) => k === tab) ? tab : "requirements";
    st = st && SUMMARY.states[st] ? st : "";
    app.innerHTML = `<p class="loading">Loading insights…</p>`;
    const ins = await insights();
    const scope = st ? stName(st) : "all states";
    app.innerHTML = `
      <h1>Insights from local government Single Audits</h1>
      <p class="lede">What the auditors' findings say across ${esc(scope)}: which compliance areas and federal programs generate findings, where federal money passes through, how late audits arrive and which problems keep coming back.
      ${ins ? `Audit year ${ins.assessment_year}; filing history since ${ins.history_start}. Data of ${fmtDate(ins.as_of)}.` : ""}</p>
      <div class="toolbar"><label class="small muted" for="inst">Scope</label><select id="inst">${stateOptions(st, "All states")}</select>
        <a class="btn" href="data/insights.json" download>Download (JSON)</a>${st ? `<a class="btn" href="#brief-${st}">${esc(stName(st))} brief</a>` : ""}</div>
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" class="tab ${k === tab ? "on" : ""}" aria-selected="${k === tab}" href="#insights-${k}${st ? "-" + st : ""}">${esc(l)}</a>`).join("")}</div>
      <div id="ins-body"></div>`;
    document.getElementById("inst").onchange = (e) => (location.hash = `#insights-${tab}${e.target.value ? "-" + e.target.value : ""}`);
    const body = document.getElementById("ins-body");
    if (!ins) { body.innerHTML = unavailable("This analysis"); return; }
    body.innerHTML = ({
      requirements: insRequirements, programs: insPrograms, passthrough: insPassthrough,
      timeliness: insTimeliness, persistence: insPersistence, themes: insThemes,
    })[tab](ins, st);
    bindRows();
    const tm = document.getElementById("tl-measure");
    if (tm) tm.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      tm.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      document.getElementById("tl-chart").innerHTML = timelinessChart(ins, st, b.dataset.k);
    }));
  }

  function insRequirements(ins, st) {
    const R = ins.requirements;
    if (!R) return unavailable("The compliance requirement analysis");
    const L = R.labels;
    const nat = Object.fromEntries(R.national.map((r) => [r.code, r]));
    const rows = st ? R.states[st] || [] : R.national;
    if (!rows.length) return `<p class="muted">No classified federal award findings for ${esc(stName(st))} in audit year ${ins.assessment_year}.</p>`;
    const top = rows[0];
    const n = st ? (R.state_classified || {})[st] || 0 : R.findings_classified;
    return `${n < 30 ? smallSample(n, "findings") : ""}<div class="card">
      <h2>Which compliance requirements do findings involve?</h2>
      <p>${fmtPct(top.share)} of federal award findings ${st ? "in " + esc(stName(st)) : "nationally"} involve <strong>${esc(L[top.code])}</strong>${rows[1] ? `, followed by ${esc(L[rows[1].code])} (${fmtPct(rows[1].share)})` : ""}.
      Auditors tag each finding with one or more of the compliance requirements in the federal Compliance Supplement.</p>
      ${bars(rows.slice(0, 13).map((r) => ({ label: `${r.code}. ${L[r.code]}`, value: r.share, ref: st && nat[r.code] ? nat[r.code].share : null })), fmtPct)}
      </div>
      <div class="card"><div class="table-wrap"><table class="plain"><thead><tr><th>Requirement</th><th class="num">Findings</th><th class="num">% of findings</th>${st ? '<th class="num">National %</th>' : '<th class="num">Repeat findings</th><th class="num">Audits</th>'}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.code)}. ${esc(L[r.code])}</td><td class="num">${fmtInt(r.findings)}</td><td class="num">${fmtPct(r.share)}</td>${st ? `<td class="num">${nat[r.code] ? fmtPct(nat[r.code].share) : "—"}</td>` : `<td class="num">${fmtPct(r.repeat_pct)}</td><td class="num">${fmtInt(r.audits)}</td>`}</tr>`).join("")}</tbody></table></div>
      <p class="small muted">Audit year ${ins.assessment_year}. Percentages are shares of findings that carry at least one requirement code (${pl(st ? (R.state_classified || {})[st] || 0 : R.findings_classified, "finding", "findings")}); a finding can involve several requirements, so they add up to more than 100%. Codes D and K are retired.</p></div>`;
  }

  function insPrograms(ins, st) {
    const P = ins.programs;
    if (!P) return unavailable("The federal program analysis");
    const rows = st ? P.states[st] || [] : P.national;
    if (!rows.length) return `<p class="muted">No federal program findings for ${esc(stName(st))}.</p>`;
    const table = (rs, full) => `<div class="table-wrap"><table class="plain"><thead><tr><th>Federal program</th><th class="num">Governments</th><th class="num">Findings</th><th class="num">% of governments with findings</th>${full ? '<th class="num">Repeat %</th><th class="num">Questioned-cost findings</th>' : ""}<th class="num">Spent</th></tr></thead>
      <tbody>${rs.map((r) => `<tr><td>${esc(r.name)}<div class="small muted">ALN ${esc(r.aln)} · ${esc(r.agency)}</div></td><td class="num">${fmtInt(r.audits)}</td><td class="num">${fmtInt(r.findings)}</td><td class="num">${fmtPct(r.finding_rate)}</td>${full ? `<td class="num">${fmtPct(r.repeat_pct)}</td><td class="num">${fmtInt(r.questioned_cost_findings)}</td>` : ""}<td class="num">${fmtMoney(r.expended)}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="card"><h2>Federal programs with the most findings</h2>
      <p><strong>${esc(rows[0].name)}</strong> (ALN ${esc(rows[0].aln)}) has the most federal award findings ${st ? "in " + esc(stName(st)) : "nationally"}: ${fmtInt(rows[0].findings)} across ${fmtInt(rows[0].audits_with_findings)} local governments.</p>
      ${bars(rows.slice(0, 12).map((r) => ({ label: r.name, note: `ALN ${r.aln}`, value: r.findings })), fmtInt)}</div>
      <div class="card">${table(rows, !st)}<p class="small muted">Programs are federal Assistance Listings (ALN). "Governments" counts local governments that spent money from the program in audit year ${ins.assessment_year}. A program with many governments will have more findings; the "% of governments with findings" column adjusts for that.</p></div>
      ${!st && P.highest_rate && P.highest_rate.length ? `<div class="card"><h2>Highest finding rates (programs spent by at least 50 governments)</h2>${table(P.highest_rate, true)}</div>` : ""}
      ${!st && P.agencies ? `<div class="card"><h2>By federal agency</h2><div class="table-wrap"><table class="plain"><thead><tr><th>Agency</th><th class="num">Governments</th><th class="num">Findings</th><th class="num">% with findings</th><th class="num">Spent</th></tr></thead>
        <tbody>${P.agencies.map((a) => `<tr><td>${esc(a.agency)}</td><td class="num">${fmtInt(a.audits)}</td><td class="num">${fmtInt(a.findings)}</td><td class="num">${fmtPct(a.finding_rate)}</td><td class="num">${fmtMoney(a.expended)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
  }

  function insPassthrough(ins, st) {
    const P = ins.passthrough;
    if (!P) return unavailable("The pass-through analysis");
    const rows = st ? P.states[st] || [] : P.national;
    if (!rows.length) return `<p class="muted">No pass-through awards recorded for ${esc(stName(st))}.</p>`;
    return `<div class="card"><h2>Federal money received through pass-through entities</h2>
      <p>Much federal money reaches local governments through a state agency or another government (a pass-through entity), which must check its recipients' audits.
      ${esc(rows[0].name)} passed awards to ${fmtInt(rows[0].local_governments)} local governments${st ? " in " + esc(stName(st)) : ""}; ${fmtInt(rows[0].awards_with_findings)} of those awards had findings.</p>
      <div class="table-wrap"><table class="plain"><thead><tr><th>Pass-through entity</th>${st ? "" : "<th>Main state</th>"}<th class="num">Local governments</th><th class="num">Awards</th><th class="num">Awards with findings</th><th class="num">Governments with findings</th><th class="num">Spent</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td>${st ? "" : `<td>${esc(r.state)}</td>`}<td class="num">${fmtInt(r.local_governments)}</td><td class="num">${fmtInt(r.awards)}</td><td class="num">${fmtInt(r.awards_with_findings)}</td><td class="num">${fmtInt(r.govs_with_findings)}</td><td class="num">${fmtMoney(r.expended)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Audit year ${ins.assessment_year}. Names are as written in the audits; spelling variants can split one agency into several rows. Ranked by awards with findings.</p></div>`;
  }

  function timelinessChart(ins, st, k) {
    const T = ins.timeliness;
    const fmt = k === "median_days" ? (v) => `${Math.round(v)} days` : (v) => `${Number(v).toFixed(0)}%`;
    const series = [{ name: "All states", color: st ? NATIONAL : ACCENT, dash: !!st, points: T.national.map((r) => ({ year: r.year, value: r[k] })) }];
    if (st && T.states[st]) series.push({ name: stName(st), color: ACCENT, points: T.states[st].map((r) => ({ year: r.year, value: r[k] })) });
    return lineChart(series, fmt, k === "median_days" ? "Median days from fiscal year end to acceptance" : "Share of audits filed late");
  }

  function insTimeliness(ins, st) {
    const T = ins.timeliness;
    if (!T || !T.national.length) return unavailable("The filing timeliness analysis");
    const rows = st ? T.states[st] || [] : T.national;
    const done = rows.filter((r) => r.year < ins.assessment_year);
    const a = done[0], b = done[done.length - 1];
    const fewest = Math.min(...rows.map((r) => r.audits));
    return `${st && fewest < 30 ? smallSample(fewest, "audits in some years") : ""}<div class="card"><h2>How late do audits arrive?</h2>
      ${a && b && a !== b ? `<p>${fmtPct(b.pct_late)} of ${b.year} audits ${st ? "in " + esc(stName(st)) : ""} reached the clearinghouse after the 9-month deadline, compared with ${fmtPct(a.pct_late)} in ${a.year}. The median audit arrived ${b.median_days} days after fiscal year end.</p>` : ""}
      <div class="map-switch" id="tl-measure"><button class="btn on" data-k="pct_late">% filed late</button><button class="btn" data-k="median_days">Median days after fiscal year end</button></div>
      <div id="tl-chart">${timelinessChart(ins, st, "pct_late")}</div>
      <div class="table-wrap"><table class="plain"><thead><tr><th>Audit year</th><th class="num">Audits on file</th><th class="num">Median days</th><th class="num">% late</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.year}</td><td class="num">${fmtInt(r.audits)}</td><td class="num">${fmtInt(r.median_days)}</td><td class="num">${fmtPct(r.pct_late)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Late means accepted more than nine months after fiscal year end (the federal limit). Only audits on file are counted, so the latest year (${ins.assessment_year}) looks better than it will once late audits arrive. Years before 2023 come from records the GSA migrated from the Census Bureau.</p></div>`;
  }

  function insPersistence(ins, st) {
    const P = ins.persistence;
    if (!P) return unavailable("The persistence analysis");
    const d = st ? P.states[st] : P.national;
    if (!d) return `<p class="muted">No data for ${esc(stName(st))}.</p>`;
    const lab = { 1: "Latest audit only", 2: "Last 2 audits", 3: "Last 3 audits", 4: "Last 4 audits", "5+": "Last 5 or more" };
    const three = ["3", "4", "5+"].reduce((a, k) => a + (d.findings_streak[k] || 0), 0);
    return `<div class="card"><h2>Findings that keep coming back</h2>
      <p>${fmtInt(three)} of ${pl(d.scored, "local government", "local governments")} ${st ? "in " + esc(stName(st)) : ""} had federal award findings in each of their last three or more audits. GAO found findings left unresolved for years (<a href="https://www.gao.gov/products/gao-24-106173" target="_blank" rel="noopener">GAO-24-106173</a>).</p>
      <div class="grid-2"><div><h3>Consecutive audits with findings</h3>${bars(Object.entries(d.findings_streak).map(([k, v]) => ({ label: lab[k], value: v })), fmtInt)}</div>
      <div><h3>Consecutive audits with repeat findings</h3>${bars(Object.entries(d.repeat_streak).map(([k, v]) => ({ label: lab[k], value: v })), fmtInt)}</div></div></div>
      <div class="card"><h2>Longest runs of findings</h2><div class="table-wrap"><table><thead><tr><th>Government</th>${st ? "" : "<th>State</th>"}<th class="num">Audits in a row with findings</th><th class="num">With repeat findings</th><th class="num">Since</th></tr></thead>
      <tbody>${d.top.map((r) => `<tr data-st="${esc(r.state)}" data-id="${esc(r.id)}" data-kind="entity"><td><strong>${esc(r.name)}</strong><div class="small muted">${esc(r.city)}</div></td>${st ? "" : `<td>${esc(r.state)}</td>`}<td class="num">${r.findings_streak}</td><td class="num">${r.repeat_streak}</td><td class="num">${r.since || "—"}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">None.</td></tr>`}</tbody></table></div>
      <p class="small muted">Counts consecutive audits on file, ending with audit year ${ins.assessment_year}; a missing year ends the run. History starts in ${ins.history_start}. "Repeat" uses the auditor's own repeat-finding flag.</p></div>`;
  }

  function insThemes(ins, st) {
    const T = ins.themes;
    if (!T) return unavailable("The finding themes analysis");
    const rows = st ? T.states[st] || [] : T.national;
    if (!rows.length) return `<p class="muted">No finding text for ${esc(stName(st))}.</p>`;
    const known = rows.filter((r) => r.theme !== "Other / not classified");
    return `<div class="card"><h2>What the findings are about</h2>
      ${known[0] ? `<p>The most common theme in the text of ${fmtInt(T.findings)} federal award findings ${st ? "(" + esc(stName(st)) + ")" : ""} is <strong>${esc(known[0].theme.toLowerCase())}</strong> (${fmtPct(known[0].pct)} of findings).</p>` : ""}
      ${bars(rows.map((r) => ({ label: r.theme, value: r.pct })), fmtPct)}
      <p class="small muted">Sorted automatically by simple keyword rules, so treat these as approximate: a finding can match several themes, and some are missed. Audit year ${ins.assessment_year}. AI-assisted classification is planned for a later version.</p>
      <details><summary class="small">See the keyword rules</summary><div class="table-wrap"><table class="plain"><tbody>${(T.rules || []).map((r) => `<tr><td>${esc(r.theme)}</td><td><code>${esc(r.pattern)}</code></td></tr>`).join("")}</tbody></table></div></details></div>`;
  }

  // ---------- state brief (printable) ----------
  async function viewBrief(st) {
    setActive("state");
    st = (st || "IL").toUpperCase();
    const info = SUMMARY.states[st];
    if (!info) { app.innerHTML = `<p>No data for ${esc(st)}.</p>`; return; }
    app.innerHTML = `<p class="loading">Preparing the ${esc(info.name)} brief…</p>`;
    const [ins, d] = await Promise.all([insights(), loadState(st)]);
    const N = SUMMARY.national, M = SUMMARY.meta;
    const natPct = N.entities ? (100 * ((N.tiers.Elevated || 0) + (N.tiers.High || 0))) / N.entities : 0;
    const req = ins && ins.requirements && (ins.requirements.states[st] || []);
    const progs = ins && ins.programs && (ins.programs.states[st] || []);
    const pts = ins && ins.passthrough && (ins.passthrough.states[st] || []);
    const per = ins && ins.persistence && ins.persistence.states[st];
    const tl = ins && ins.timeliness && ins.timeliness.states[st];
    const tlDone = (tl || []).filter((r) => r.year < M.assessment_year);
    const three = per ? ["3", "4", "5+"].reduce((a, k) => a + (per.findings_streak[k] || 0), 0) : null;
    const L = ins && ins.requirements ? ins.requirements.labels : {};
    const sentences = [
      `${pl(info.entities, "local government", "local governments")} in ${info.name} filed Single Audits for ${M.assessment_year}, covering ${fmtMoney(info.federal_expended)} in federal awards.`,
      `${info.pct_elevated_or_high}% scored Elevated or High on the screening score (all states: ${natPct.toFixed(1)}%).`,
      `${pl(info.late_filers, "audit", "audits")} reached the clearinghouse after the 9-month deadline, and ${info.stopped_filers === 1 ? "1 government appears" : fmtInt(info.stopped_filers) + " governments appear"} to have stopped filing (${fmtInt(info.stopped_well_above_threshold)} of them well above the threshold).`,
      req && req.length ? `The compliance areas most often involved in federal findings were ${esc(L[req[0].code])}${req[1] ? ` and ${esc(L[req[1].code])}` : ""}.` : "",
      three ? `${pl(three, "government", "governments")} had findings in each of ${three === 1 ? "its" : "their"} last three or more audits.` : "",
      tlDone.length ? `In ${tlDone[tlDone.length - 1].year}, ${fmtPct(tlDone[tlDone.length - 1].pct_late)} of audits were filed late.` : "",
    ].filter(Boolean).join(" ");
    const highest = d.entities.slice(0, 8);
    const stopped = d.stopped.slice(0, 8);
    app.innerHTML = `<div class="brief">
      <div class="toolbar noprint"><select id="stpick" aria-label="Choose a state">${stateOptions(st)}</select>
        <button class="btn primary" id="print">Print or save as PDF</button><a class="btn" href="#state-${st}">Full ${esc(info.name)} list</a></div>
      <p class="small muted">Municipal Financial Risk Score · civicauditlens.org · data of ${fmtDate(M.as_of)}</p>
      <h1>${esc(info.name)}: local government Single Audits, ${M.assessment_year}</h1>
      <p class="lede">${sentences}</p>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmtInt(info.entities)}</div><div class="l">governments scored</div></div>
        <div class="kpi"><div class="v">${info.pct_elevated_or_high}%</div><div class="l">Elevated or High</div></div>
        <div class="kpi"><div class="v">${fmtInt(info.repeat_findings)}</div><div class="l">with repeat findings</div></div>
        <div class="kpi"><div class="v">${fmtInt(info.late_filers)}</div><div class="l">filed late</div></div>
        <div class="kpi"><div class="v">${fmtInt(info.stopped_filers)}</div><div class="l">apparent stopped filers</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><h2>Filed late, by audit year</h2>${tl && tl.length ? timelinessChart(ins, st, "pct_late") : `<p class="muted">Not available.</p>`}</div>
        <div class="card"><h2>Compliance areas in findings</h2>${req && req.length ? bars(req.slice(0, 6).map((r) => ({ label: `${r.code}. ${L[r.code]}`, value: r.share })), fmtPct) : `<p class="muted">Not available.</p>`}</div>
      </div>
      <div class="grid-2">
        <div class="card"><h2>Highest scores</h2><div class="table-wrap"><table><tbody>${highest.map((e) => `<tr data-st="${st}" data-id="${esc(e.id)}" data-kind="entity"><td>${esc(e.name)}<div class="small muted">${esc(e.city)}</div></td><td class="num">${pill(e.tier)} ${e.score}</td></tr>`).join("") || "<tr><td class='muted'>None.</td></tr>"}</tbody></table></div></div>
        <div class="card"><h2>Largest apparent stopped filers</h2><div class="table-wrap"><table><tbody>${stopped.map((s) => `<tr data-st="${st}" data-id="${esc(s.id)}" data-kind="stopped"><td>${esc(s.name)}<div class="small muted">last filed ${s.last_year_filed}</div></td><td class="num">${fmtMoney(s.last_federal_expended)}</td></tr>`).join("") || "<tr><td class='muted'>None.</td></tr>"}</tbody></table></div></div>
      </div>
      ${progs && progs.length ? `<div class="card"><h2>Federal programs with the most findings</h2><div class="table-wrap"><table class="plain"><thead><tr><th>Program</th><th class="num">Governments</th><th class="num">Findings</th></tr></thead><tbody>${progs.slice(0, 6).map((r) => `<tr><td>${esc(r.name)} <span class="small muted">ALN ${esc(r.aln)}</span></td><td class="num">${fmtInt(r.audits)}</td><td class="num">${fmtInt(r.findings)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${pts && pts.length ? `<div class="card"><h2>Main pass-through entities</h2><div class="table-wrap"><table class="plain"><thead><tr><th>Entity</th><th class="num">Local governments</th><th class="num">Awards with findings</th></tr></thead><tbody>${pts.slice(0, 6).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmtInt(r.local_governments)}</td><td class="num">${fmtInt(r.awards_with_findings)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      <p class="small muted">Source: Federal Audit Clearinghouse (GSA), public domain; method version ${esc(M.method_version)}. Scores and flags are screening indicators built from what independent auditors reported. They are not audit opinions and not findings of fraud or wrongdoing. Each government has its own page at civicauditlens.org.</p>
    </div>`;
    document.getElementById("print").onclick = () => window.print();
    document.getElementById("stpick").onchange = (e) => (location.hash = `#brief-${e.target.value}`);
    bindRows();
  }

  // ---------- what changed ----------
  async function viewChanges(st) {
    setActive("changes");
    st = st && SUMMARY.states[st] ? st : "";
    app.innerHTML = `<p class="loading">Loading…</p>`;
    const [ch, hist] = await Promise.all([once("changes", "data/changes.json"), once("chist", "data/changes_history.json")]);
    const f = (rows) => (rows || []).filter((r) => !st || r.state === st);
    const head = `<h1>What changed this week${st ? " in " + esc(stName(st)) : ""}</h1>
      <p class="lede">Each Thursday the data is rebuilt from the Federal Audit Clearinghouse. This page compares the new build with the previous one.
      Follow it by RSS: <a href="/feeds/national.xml">all states</a>${st ? ` · <a href="/feeds/${st}.xml">${esc(stName(st))}</a>` : ` · or one state, e.g. <a href="/feeds/IL.xml">Illinois</a>`}.</p>
      <div class="toolbar"><select id="chst">${stateOptions(st, "All states")}</select></div>`;
    if (!ch || !ch.counts || !Object.keys(ch.counts).length) {
      app.innerHTML = head + `<div class="notice">${esc((ch && ch.note) || "Weekly comparisons start with the next data update.")}</div>`;
      document.getElementById("chst").onchange = (e) => (location.hash = e.target.value ? `#changes-${e.target.value}` : "#changes");
      return;
    }
    const ns = f(ch.new_stopped), rs = f(ch.resolved_stopped), na = f(ch.new_audits), tc = f(ch.tier_changes);
    const filed = rs.filter((r) => r.now_filed);
    const list = (rows, cols, kind) => rows.length ? `<div class="table-wrap"><table><tbody>${rows.slice(0, 100).map((r) => `<tr data-st="${esc(r.state)}" data-id="${esc(r.id)}" data-kind="${kind}"><td><strong>${esc(r.name)}</strong><div class="small muted">${esc(r.city || "")}, ${esc(r.state)}</div></td>${cols(r)}</tr>`).join("")}</tbody></table></div>${rows.length > 100 ? `<p class="small muted">Showing 100 of ${fmtInt(rows.length)}.</p>` : ""}` : `<p class="muted">None this week.</p>`;
    app.innerHTML = head + `
      <p class="small muted">Data of ${fmtDate(ch.as_of)}, compared with ${fmtDate(ch.compared_to)}.</p>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmtInt(na.length)}</div><div class="l">new audits accepted</div></div>
        <div class="kpi"><div class="v">${fmtInt(na.filter((r) => r.tier === "High" || r.tier === "Elevated").length)}</div><div class="l">of them Elevated or High</div></div>
        <div class="kpi"><div class="v">${fmtInt(ns.length)}</div><div class="l">new apparent stopped filers</div></div>
        <div class="kpi"><div class="v">${fmtInt(filed.length)}</div><div class="l">stopped filers that filed again</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><h2>New apparent stopped filers</h2>${list(ns, (r) => `<td class="num">last filed ${r.last_year_filed}<div class="small muted">${fmtMoney(r.last_federal_expended)}</div></td>`, "stopped")}</div>
        <div class="card"><h2>Filed again</h2>${list(filed, (r) => `<td class="num">${pill(r.tier)} ${r.score}</td>`, "entity")}</div>
      </div>
      <div class="card"><h2>New audits</h2>${list(na, (r) => `<td class="num">${pill(r.tier)} ${r.score}<div class="small muted">accepted ${fmtDate(r.accepted)}</div></td>`, "entity")}</div>
      ${tc.length ? `<div class="card"><h2>Resubmitted audits with a new tier</h2>${list(tc, (r) => `<td class="num">${pill(r.from)} → ${pill(r.to)}</td>`, "entity")}</div>` : ""}
      ${hist && hist.length > 1 ? `<div class="card"><h2>Recent weeks (all states)</h2><div class="table-wrap"><table class="plain"><thead><tr><th>Data of</th><th class="num">New audits</th><th class="num">Elevated or High</th><th class="num">New stopped filers</th><th class="num">No longer listed</th></tr></thead>
        <tbody>${hist.map((h) => `<tr><td>${fmtDate(h.as_of)}</td><td class="num">${fmtInt(h.counts.new_audits)}</td><td class="num">${fmtInt(h.counts.new_audits_elevated_or_high)}</td><td class="num">${fmtInt(h.counts.new_stopped)}</td><td class="num">${fmtInt(h.counts.resolved_stopped)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
    document.getElementById("chst").onchange = (e) => (location.hash = e.target.value ? `#changes-${e.target.value}` : "#changes");
    bindRows();
  }

  // ---------- batch lookup ----------
  function viewLookup() {
    setActive("lookup");
    app.innerHTML = `
      <h1>Look up a list of governments</h1>
      <p class="lede">Paste the UEIs, EINs or names of the governments you oversee or fund (one per line). You get each one's latest audit status, score and warning signs, ready to download.
      Useful for pass-through entities checking subrecipients' Single Audits under 2 CFR 200.332.</p>
      <div class="card"><textarea id="lk-in" rows="8" placeholder="UEI, EIN or name — one per line&#10;e.g. N7DKJNBTYGE3&#10;36-6005912&#10;Village of Example"></textarea>
        <p><button class="btn primary" id="lk-go">Look up</button> <span class="small muted">Runs in your browser; nothing you paste is sent anywhere. Only local governments are covered for now.</span></p></div>
      <div id="lk-out"></div>`;
    document.getElementById("lk-go").onclick = async () => {
      const out = document.getElementById("lk-out");
      out.innerHTML = `<p class="loading">Loading the index…</p>`;
      const rows = await loadIndex();
      const byId = new Map(rows.map((r) => [r.id.toUpperCase(), r]));
      const byEin = new Map(rows.filter((r) => r.ein).map((r) => [r.ein.replace(/\D/g, ""), r]));
      const lines = document.getElementById("lk-in").value.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 2000);
      const res = lines.map((q) => {
        const up = q.toUpperCase(), digits = q.replace(/\D/g, "");
        let hit = byId.get(up) || (digits.length === 9 ? byEin.get(digits) : null), how = hit ? (byId.get(up) ? "UEI" : "EIN") : "";
        if (!hit && q.length >= 3) {
          const m = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
          if (m.length === 1) { hit = m[0]; how = "name"; } else if (m.length > 1) return { q, many: m.length };
        }
        return { q, hit, how };
      });
      const det = await Promise.all(res.map((r) => (r.hit ? govRecord(r.hit.st, r.hit.id) : null)));
      const csv = [["input", "match", "matched_by", "state", "status", "score", "tier", "fac_accepted", "days_late", "findings", "repeat_findings", "warning_signs", "page"]];
      const body = res.map((r, i) => {
        const h = r.hit, d = det[i];
        if (!h) {
          csv.push([r.q, "", "", "", r.many ? `${r.many} possible matches` : "not found", "", "", "", "", "", "", "", ""]);
          return `<tr><td>${esc(r.q)}</td><td colspan="4" class="muted">${r.many ? `${fmtInt(r.many)} possible matches; use the UEI or EIN` : "Not found (below the threshold, not a local government, or not on file)"}</td></tr>`;
        }
        const status = h.kind === "s" ? "Apparent stopped filer" : `Audit year ${SUMMARY.meta.assessment_year} on file`;
        const signs = d && d.flags ? d.flags.filter((f) => f !== "not_low_risk_auditee").map(shortFlag).join("; ") : "";
        const url = "https://civicauditlens.org" + govPath(h.st, h.id, h.name);
        csv.push([r.q, h.name, r.how, h.st, status, h.score, h.tier, d && d.accepted || "", d && d.days_late || "", d && d.findings ? d.findings.count : "", d && d.findings ? d.findings.repeat : "", signs, url]);
        return `<tr><td>${esc(r.q)}</td><td><a href="${esc(govPath(h.st, h.id, h.name))}">${esc(h.name)}</a><div class="small muted">${esc(h.city)}, ${esc(h.st)} · matched by ${r.how}</div></td><td>${h.kind === "s" ? '<span class="chip">apparent stopped filer</span>' : esc(status)}</td><td class="num">${pill(h.tier)} ${h.score}</td><td><div class="chips">${esc(signs).split("; ").filter(Boolean).map((s) => `<span class="chip">${s}</span>`).join("")}</div></td></tr>`;
      }).join("");
      const blob = new Blob([csv.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
      out.innerHTML = `<div class="card"><div class="toolbar"><strong>${fmtInt(res.filter((r) => r.hit).length)} of ${fmtInt(res.length)} found</strong>
        <a class="btn" id="lk-csv" download="single-audit-lookup.csv">Download results (CSV)</a></div>
        <div class="table-wrap"><table class="plain"><thead><tr><th>You entered</th><th>Government</th><th>Status</th><th class="num">Score</th><th>Warning signs</th></tr></thead><tbody>${body}</tbody></table></div>
        <p class="small muted">"Score" is the latest audit's screening score; for stopped filers it is the score of the last audit they filed.</p></div>`;
      document.getElementById("lk-csv").href = URL.createObjectURL(blob);
    };
  }

  // ---------- data quality / validation ----------
  async function viewValidation() {
    setActive("method");
    const M = SUMMARY.meta, N = SUMMARY.national;
    const [ins, val] = await Promise.all([insights(), once("validation", "validation.json")]);
    const status = Object.assign({}, M.optional || {}, (ins && ins.status) || {});
    const NAMES = { requirements: "Compliance requirements", programs: "Federal programs", passthrough: "Pass-through entities", themes: "Finding themes", timeliness: "Filing timeliness", persistence: "Persistent findings", persistence_summary: "Persistence summary", peers: "Peer comparison", usaspending: "USAspending cross-check", changes: "Weekly changes" };
    const U = ins && ins.usaspending;
    const checks = (val && val.spot_checks) || [];
    app.innerHTML = `<div class="method">
      <h1>Data quality and validation</h1>
      <p class="lede">How the data is built, what was checked, and what is still open. Errors reported by users are corrected in the next weekly update.</p>
      <div class="card"><h2>This build</h2><dl class="dl">
        <dt>Data generated</dt><dd>${esc(new Date(M.generated_at).toLocaleString())}</dd>
        <dt>Audit year scored</dt><dd>${M.assessment_year}</dd>
        <dt>Audit years loaded</dt><dd>${esc((M.years_loaded || []).join(", "))}</dd>
        <dt>Governments scored</dt><dd>${fmtInt(N.entities)} · apparent stopped filers ${fmtInt(N.stopped_filers)}</dd>
        <dt>Versions</dt><dd>Score method ${esc(M.method_version)} · site ${esc(M.site_version || "0.1")}</dd>
        <dt>Citation</dt><dd>${CFG.doi ? `DOI <a href="https://doi.org/${esc(CFG.doi)}">${esc(CFG.doi)}</a>` : "DOI forthcoming"}</dd></dl>
        ${Object.keys(status).length ? `<h3>Analyses in this build</h3><div class="table-wrap"><table class="plain"><tbody>${Object.entries(status).map(([k, v]) => `<tr><td>${esc(NAMES[k] || k)}</td><td>${v === "ok" ? "✓ updated" : `<span class="muted">not available: ${esc(v)}</span>`}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>
      <div class="card"><h2>Checks on the stopped-filer list</h2><ul>
        <li><strong>Automatic:</strong> a government is not listed if it filed for the scored year or later under any entity type, its UEI or its EIN, or if its audit is less than 90 days past due. One-time COVID-19 relief is excluded from the "well above threshold" test.</li>
        <li><strong>USAspending cross-check:</strong> ${U ? `${fmtInt(U.checked)} of the largest stopped filers were checked; ${fmtInt(U.with_new_obligations)} received new direct federal grant obligations since the missing year began, ${fmtInt(U.over_1m)} of them $1 million or more. That makes "no longer receives federal money" an unlikely explanation for those governments.` : "not available in this build."}</li>
        <li><strong>Manual spot checks:</strong> ${checks.length ? "results below." : "not yet published. Samples of listed governments are being checked by hand against FAC searches and state records; results will appear here with the error rate."}</li></ul>
        ${checks.length ? `<div class="table-wrap"><table class="plain"><thead><tr><th>Date</th><th>State</th><th class="num">Checked</th><th class="num">Confirmed missing</th><th class="num">Listed in error</th><th>Notes</th></tr></thead><tbody>${checks.map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(c.state)}</td><td class="num">${fmtInt(c.checked)}</td><td class="num">${fmtInt(c.confirmed)}</td><td class="num">${fmtInt(c.errors)}</td><td>${esc(c.notes || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>
      <div class="card"><h2>Known limits</h2><ul>
        <li>Years before 2023 come from records the GSA migrated from the Census Bureau's clearinghouse; some fields are incomplete.</li>
        <li>Names of pass-through entities are as typed in each audit, so one agency can appear under several spellings.</li>
        <li>Finding themes come from keyword rules and are approximate.</li>
        <li>Only governments that file Single Audits (federal spending above the threshold) are covered.</li></ul></div>
      <div class="card"><h2>Report an error</h2><p>Use <a href="#feedback">the feedback form</a> or the <em>Report a data issue</em> button on any government.
        ${repoOk() ? `Public corrections are tracked as <a href="https://github.com/${esc(CFG.githubRepo)}/issues?q=label%3Adata-issue" target="_blank" rel="noopener">GitHub issues labeled data-issue</a>.` : ""}</p></div></div>`;
  }

  function viewMethod() {
    setActive("method");
    const M = SUMMARY.meta, P = M.points;
    const row = (comp, label, pts) => `<tr><td>${comp}</td><td>${label}</td><td class="num">${pts}</td></tr>`;
    app.innerHTML = `<div class="method">
      <h1>How the score works</h1>
      <p class="lede">Version ${esc(M.method_version)}. The score uses only public fields from Single Audits in the Federal Audit Clearinghouse. It is rule-based, so the same audit always gets the same score and anyone can recompute it from the <a href="${repoOk() ? `https://github.com/${CFG.githubRepo}` : "#feedback"}">open source code</a>. See also <a href="#validation">Data quality and validation</a>.</p>
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
      ${M.flag_help ? `<div class="card"><h2>What each warning sign means</h2><dl class="dl wide">${Object.keys(M.flag_text).map((f) => `<dt>${esc(M.flag_text[f])}</dt><dd>${esc(flagHelp(f))}</dd>`).join("")}</dl></div>` : ""}
      <div class="card">
        <h2>Data and rules</h2>
        <ul>
          <li><strong>Who is included:</strong> audits with entity type "local" (cities, counties, towns, townships, villages, school and special districts) in every state, DC and the territories.</li>
          <li><strong>Year scored:</strong> audit year ${M.assessment_year}, the latest year whose filing deadline (nine months after fiscal year end) has passed for every fiscal year end, plus a ${30}-day grace period. Earlier years appear as history.</li>
          <li><strong>One audit per government per year:</strong> superseded resubmissions are dropped and the most recently accepted version is kept. Governments are matched by UEI, then EIN, then name.</li>
          <li><strong>Lateness</strong> is measured from fiscal year end + 9 months to the date the FAC accepted the audit. Federal rules require the earlier of 30 days after the auditor's report or 9 months, and the FAC does not publish the report date, so this measure is lenient.</li>
          <li><strong>Stopped filers:</strong> filed for one of the two prior years, nothing on file for the scored year or later under any entity type, UEI or EIN, and the missing audit is more than 90 days past due. "Well above threshold" means at least $1.5M of federal spending in the last audit, excluding one-time COVID-19 relief programs (ALN 21.019, 21.023, 21.026, 21.027, 21.029, 21.032 and 84.425).</li>
          <li><strong>Updated</strong> weekly from <code>api.fac.gov</code>. Data last generated ${esc(new Date(M.generated_at).toLocaleString())}.</li>
        </ul>
      </div>
      <div class="card">
        <h2>Additional analyses</h2>
        <p>These use the same public data and do not change the score.</p>
        <ul>
          <li><strong>Compliance requirements:</strong> the requirement codes (A–N, P) auditors attach to each federal award finding, counted once per finding.</li>
          <li><strong>Federal programs and agencies:</strong> findings joined to the federal award (Assistance Listing) they relate to.</li>
          <li><strong>Pass-through entities:</strong> the entity named as having passed each award to the government, with the awards that carried findings.</li>
          <li><strong>Filing timeliness:</strong> days from fiscal year end to FAC acceptance, for every audit year since ${esc(M.history_start || 2016)}.</li>
          <li><strong>Persistent findings:</strong> consecutive audits on file with findings, and with findings the auditor flagged as repeats.</li>
          <li><strong>Finding themes:</strong> public keyword rules applied to the text of each finding; approximate.</li>
          <li><strong>Peer comparison:</strong> each score's percentile among governments with similar federal spending in the same state (or nationally when a state has fewer than 10 such peers).</li>
          <li><strong>USAspending cross-check:</strong> new direct federal grant obligations to the largest apparent stopped filers since their missing year began.</li>
          <li><strong>Weekly changes:</strong> each update is compared with the previous one; changes are published on the <a href="#changes">What changed</a> page and as RSS feeds.</li>
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
      const page = govPath(st, s.id, s.name);
      modalBody.innerHTML = `
        <h2 id="modal-title">${esc(s.name)}</h2><p class="muted">${esc(s.city)}, ${esc(st)} · apparent stopped filer</p>
        <dl class="dl">
          <dt>Last audit filed</dt><dd>Audit year ${s.last_year_filed} · <a href="${facLink(s.last_report_id)}" target="_blank" rel="noopener">view on FAC</a></dd>
          <dt>Federal spent then</dt><dd>${fmtMoney(s.last_federal_expended)}${s.well_above_threshold ? " (well above threshold)" : ""}</dd>
          ${s.last_covid_relief_expended ? `<dt>Of which COVID-19 relief</dt><dd>${fmtMoney(s.last_covid_relief_expended)}</dd>` : ""}
          <dt>Expected fiscal year end</dt><dd>${fmtDate(s.expected_fy_end)}</dd>
          <dt>That audit was due</dt><dd>${fmtDate(s.was_due)} (${fmtInt(s.days_overdue)} days ago)</dd>
          <dt>Score on last audit</dt><dd>${pill(s.last_tier)} ${s.last_score}</dd>
          ${s.usa ? `<dt>New direct federal grants since</dt><dd>${fmtMoney(s.usa.amount)} obligated since ${fmtDate(s.usa.since)} (USAspending)</dd>` : ""}
        </dl>
        <div class="notice">Possible reasons other than noncompliance: federal spending fell below the threshold, a new identifier, or inclusion in another entity's audit.</div>
        <p><a class="btn primary" href="${esc(page)}">Open full page</a> <button class="btn" id="copy-link">Copy link</button> <button class="btn" id="report-issue">Report a data issue</button></p>`;
      modalBody.querySelector("#report-issue").onclick = () => reportIssue(`${s.name} (${st})`, `Entity ID: ${s.id}\nListed as stopped filer (last filed ${s.last_year_filed}).\n\nWhat looks wrong:\n`);
      bindCopy(page);
    } else {
      const e = d.entities.find((x) => x.id === id);
      if (!e) return;
      const page = govPath(st, e.id, e.name);
      const pts = SUMMARY.meta.points;
      const flagPts = (f) => ({ repeat_finding: Math.min(e.findings.repeat, pts.repeat_finding_max_count) * pts.repeat_finding_each,
        late: e.days_late > 365 ? pts.late_over_365_days : e.days_late > 90 ? pts.late_91_to_365_days : pts.late_up_to_90_days }[f] ?? pts[f] ?? "");
      modalBody.innerHTML = `
        <h2 id="modal-title">${esc(e.name)}</h2><p class="muted">${esc(e.city)}, ${esc(st)} · audit year ${e.year}</p>
        <p>${pill(e.tier)} <strong style="font-size:1.4rem">${e.score}</strong> <span class="muted">/ 100</span></p>
        ${Object.entries(e.components).map(([k, v]) => `<div class="comp"><span>${COMP_NAME[k]}</span><span class="track"><b style="width:${(v / 25) * 100}%"></b></span><span class="num">${v}/25</span></div>`).join("")}
        <p class="small" id="peer-line"></p>
        <h3 style="margin-top:16px">What the auditor reported</h3>
        <ul class="flaglist">${e.flags.length ? e.flags.map((f) => `<li>${flagHelp(f) ? `<details><summary><span>${esc(flagText(f))}${f === "late" ? ` (${fmtInt(e.days_late)} days)` : ""}${f === "repeat_finding" ? ` (${e.findings.repeat})` : ""}</span><strong>+${flagPts(f)}</strong></summary><p>${esc(flagHelp(f))}</p></details>` : `<span>${esc(flagText(f))}</span><strong>+${flagPts(f)}</strong>`}</li>`).join("") : "<li>No warning signs reported.</li>"}</ul>
        <dl class="dl">
          <dt>Federal awards spent</dt><dd>${fmtMoney(e.federal_expended)}</dd>
          <dt>Findings (federal programs)</dt><dd>${e.findings.count} total · ${e.findings.repeat} repeat · ${e.findings.questioned_costs} with questioned costs</dd>
          <dt>Fiscal year end</dt><dd>${fmtDate(e.fy_end)}</dd>
          <dt>Accepted by FAC</dt><dd>${fmtDate(e.accepted)}</dd>
          <dt>Auditor</dt><dd>${esc(e.auditor) || "—"}</dd>
          <dt>Score history</dt><dd>${e.history.map((h) => `${h.year}: ${pill(h.tier)} ${h.score}`).join(" &nbsp; ")}</dd>
        </dl>
        <div id="more"></div>
        <p><a class="btn primary" href="${esc(page)}">Open full page</a> <a class="btn" href="${facLink(e.report_id)}" target="_blank" rel="noopener">View the audit on FAC</a>
        <button class="btn" id="copy-link">Copy link</button> <button class="btn" id="report-issue">Report a data issue</button></p>
        <p class="small muted">Screening indicator from the auditor's reported results. Not an audit opinion or a finding of wrongdoing.</p>`;
      modalBody.querySelector("#report-issue").onclick = () => reportIssue(`${e.name} (${st})`, `Entity ID: ${e.id}\nReport: ${e.report_id}\nScore shown: ${e.score}\n\nWhat looks wrong:\n`);
      bindCopy(page);
      govRecord(st, id).then((r) => {
        if (!r || modal.hidden) return;
        if (r.peer) document.getElementById("peer-line").textContent = `Higher than ${r.peer.pct}% of ${fmtInt(r.peer.n)} governments with ${r.peer.band.replace(" federal spending", "")} in federal spending ${r.peer.scope === "state" ? "in " + stName(st) : "nationally"} (median ${r.peer.median}).`;
        const L = SUMMARY.meta.requirement_labels || {};
        const parts = [];
        if (r.streak && r.streak.findings_streak > 1) parts.push(`<p>Federal findings in each of the last <strong>${r.streak.findings_streak}</strong> audits${r.streak.since ? ` (since ${r.streak.since})` : ""}${r.streak.repeat_streak ? `; repeat findings in the last ${r.streak.repeat_streak}` : ""}.</p>`);
        if (r.requirements && Object.keys(r.requirements).length) parts.push(`<h3>Compliance areas in findings</h3><div class="chips">${Object.entries(r.requirements).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${esc(k)}. ${esc(L[k] || "")} · ${v}</span>`).join("")}</div>`);
        if (r.programs && r.programs.length) parts.push(`<h3>Federal programs</h3><div class="table-wrap"><table class="plain"><tbody>${r.programs.map((p) => `<tr><td>${esc(p.name)} <span class="small muted">ALN ${esc(p.aln)}</span></td><td class="num">${fmtMoney(p.expended)}</td><td class="num">${p.findings ? p.findings + " findings" : ""}</td></tr>`).join("")}</tbody></table></div>`);
        if (r.passthrough && r.passthrough.length) parts.push(`<h3>Received money through</h3><p class="small">${r.passthrough.map(esc).join(" · ")}</p>`);
        if (r.themes && Object.keys(r.themes).length) parts.push(`<h3>Finding themes</h3><div class="chips">${Object.entries(r.themes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${esc(k)} · ${v}</span>`).join("")}</div>`);
        document.getElementById("more").innerHTML = parts.join("");
      });
    }
    modal.hidden = false;
    modal.querySelector(".modal-close").focus();
  }
  function bindCopy(page) {
    const b = modalBody.querySelector("#copy-link");
    if (b) b.onclick = () => navigator.clipboard && navigator.clipboard.writeText("https://civicauditlens.org" + page).then(() => (b.textContent = "Link copied"));
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
    // routes: #home, #state-IL, #stopped, #stopped-IL, #insights-<tab>[-IL], #brief-IL, #changes[-IL], #lookup,
    //         #validation, #method, #feedback
    const parts = location.hash.replace(/^#\/?/, "").split(/[-/]/);
    try {
      if (parts[0] === "state") await viewState(parts[1]);
      else if (parts[0] === "stopped") await viewStopped(parts[1]);
      else if (parts[0] === "insights") await viewInsights(parts[1], (parts[2] || "").toUpperCase());
      else if (parts[0] === "brief") await viewBrief(parts[1]);
      else if (parts[0] === "changes") await viewChanges((parts[1] || "").toUpperCase());
      else if (parts[0] === "lookup") viewLookup();
      else if (parts[0] === "validation") await viewValidation();
      else if (parts[0] === "method") viewMethod();
      else if (parts[0] === "feedback") viewFeedback();
      else await viewHome();
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
