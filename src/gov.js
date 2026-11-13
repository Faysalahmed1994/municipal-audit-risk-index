/**
 * One page per government: /gov/{STATE}/{ID}/{slug}
 *
 * Rendered by the Worker from the sharded files that pipeline/build_dataset.py writes to
 * site/data/gov/{STATE}/{shard}.json, so each government has a real URL that can be shared,
 * cited and found by search engines. No database: everything comes from the static data files.
 */

export const SITE = "https://civicauditlens.org";
export const SHARDS = 16;

// Must match analytics.shard_of / slugify / gov_url in pipeline/analytics.py
export function shardOf(id) {
  let s = 0;
  for (const ch of id) s += ch.codePointAt(0);
  return s % SHARDS;
}
export function slugify(name) {
  const s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 80).replace(/-+$/, "") || "government";
}
export function encId(id) {
  return encodeURIComponent(id).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
// Must match analytics.firm_key in pipeline/analytics.py
const FIRM_DROP = /\b(?:llp|llc|pllc|lllp|pc|pa|sc|ps|ltd|limited|inc|incorporated|corp|corporation|prof|professional|chartered|chtd|co|company|cpa|cpas|certified|public|accountants?|accounting|and|the|of)\b/g;
export function firmKey(name) {
  let s = String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
  return s.replace(FIRM_DROP, " ").split(/\s+/).join("") || s.split(/\s+/).join("") || "unknown";
}
export function govPath(st, id, name) {
  return `/gov/${st}/${encId(id)}/${slugify(name)}`;
}

/** Parse /gov/IL/ID[/slug]. Returns null when the path is not a government page. */
export function parseGovPath(pathname) {
  const m = /^\/gov\/([A-Za-z]{2})\/([^/]+)(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!m) return null;
  let id;
  try {
    id = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  return { st: m[1].toUpperCase(), id, slug: m[3] || "" };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtInt = (n) => Number(n || 0).toLocaleString("en-US");
const fmtMoney = (n) => {
  n = Number(n || 0);
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + n;
};
const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(String(s).slice(0, 10) + "T00:00:00Z");
  return isNaN(d) ? esc(s) : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
};
const pill = (t) => `<span class="pill ${esc(t)}">${esc(t)}</span>`;
const facLink = (rid) => `https://app.fac.gov/dissemination/summary/${encodeURIComponent(rid)}`;
const COMP = { A: "A. Financial statement audit", B: "B. Internal control", C: "C. Federal award compliance", D: "D. Filing discipline" };
const TIER_COLOR = { Low: "#5b8c6b", Moderate: "#d1a73a", Elevated: "#dd7a2e", High: "#b8322a" };

function flagPoints(f, e, P) {
  if (f === "repeat_finding") return Math.min(e.findings.repeat, P.repeat_finding_max_count) * P.repeat_finding_each;
  if (f === "late") return e.days_late > 365 ? P.late_over_365_days : e.days_late > 90 ? P.late_91_to_365_days : P.late_up_to_90_days;
  return P[f] ?? "";
}

function historyChart(hist) {
  if (!hist || hist.length < 2) return "";
  const w = 560, h = 120, pad = 24, bw = Math.min(36, (w - pad * 2) / hist.length - 6);
  const step = (w - pad * 2) / hist.length;
  const top = Math.max(60, ...hist.map((x) => x.score));   // keeps the High tier (55+) in view
  const bars = hist.map((x, i) => {
    const bh = Math.max(2, (x.score / top) * (h - 34));
    const xx = pad + i * step + (step - bw) / 2;
    return `<g><title>${x.year}: score ${x.score} (${esc(x.tier)})</title>` +
      `<rect x="${xx.toFixed(1)}" y="${(h - 18 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${TIER_COLOR[x.tier] || "#1f4e79"}"></rect>` +
      `<text x="${(xx + bw / 2).toFixed(1)}" y="${(h - 22 - bh).toFixed(1)}" text-anchor="middle" font-size="10" fill="#4a5566">${x.score}</text>` +
      `<text x="${(xx + bw / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="10" fill="#7a8494">${x.year}</text></g>`;
  }).join("");
  return `<svg class="hist" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score by audit year (0 to 100)"><line x1="${pad}" x2="${w - pad}" y1="${h - 18}" y2="${h - 18}" stroke="#e2e6ec"></line>${bars}</svg>`;
}

function shell({ title, description, canonical, body, st, stName }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="article">
<link rel="stylesheet" href="/styles.css">
</head><body class="govpage">
<header class="topbar">
  <a class="brand" href="/#home"><span class="brand-mark" aria-hidden="true">◆</span>
  <span><strong>Municipal Financial Risk Score</strong><small>Open screening of local government Single Audits</small></span></a>
  <nav><a href="/#home">National</a><a href="/#state-${esc(st)}">${esc(stName || st)}</a><a href="/#stopped">Stopped filing</a>
  <a href="/#insights">Insights</a><a href="/#changes">What changed</a><a href="/#lookup">Lookup</a><a href="/#compare">Compare</a><a href="/#method">Methodology</a>
  <a href="/#feedback" class="nav-cta">Give feedback</a></nav>
</header>
<main>${body}</main>
<footer class="footer"><p>Source: <a href="https://www.fac.gov/">Federal Audit Clearinghouse</a> (GSA), public domain.
Scores are screening indicators built from what independent auditors reported. They are not audit opinions and not findings of fraud or wrongdoing.</p></footer>
<script>document.querySelectorAll("[data-copy]").forEach(function(b){b.addEventListener("click",function(){navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy).then(function(){b.textContent="Link copied";});});});</script>
</body></html>`;
}

function listCard(title, rows, note) {
  if (!rows) return "";
  return `<div class="card"><h2>${esc(title)}</h2>${rows}${note ? `<p class="small muted">${note}</p>` : ""}</div>`;
}

export function renderGov(rec, summary, canonical) {
  const M = summary.meta, S = summary.states || {};
  const st = rec.state, stName = (S[st] && S[st].name) || st;
  const help = M.flag_help || {}, text = M.flag_text || {}, P = M.points || {};
  const crumbs = `<p class="crumbs small"><a href="/#home">National</a> › <a href="/#state-${esc(st)}">${esc(stName)}</a> › ${esc(rec.name)}</p>`;
  const actions = `<p class="actions">
    <a class="btn" href="${facLink(rec.kind === "a" ? rec.report_id : rec.last_report_id)}" target="_blank" rel="noopener">View the audit on FAC</a>
    <a class="btn" href="/#compare/${esc(st)}:${esc(encodeURIComponent(rec.id))}">Compare with other governments</a>
    <button class="btn" data-copy="${esc(canonical)}">Copy link</button>
    <a class="btn" href="/#feedback">Report a data issue</a></p>`;
  const histRows = (rec.history_full || []).map((h) => `<tr><td>${h.year}</td><td>${pill(h.tier)} ${h.score}</td><td><a href="${facLink(h.report_id)}" target="_blank" rel="noopener">FAC report</a></td></tr>`).join("");
  const historyCard = rec.history_full && rec.history_full.length
    ? `<div class="card"><h2>Score history</h2>${historyChart(rec.history_full)}
       <div class="table-wrap"><table class="plain"><thead><tr><th>Audit year</th><th>Score</th><th>Source</th></tr></thead><tbody>${histRows}</tbody></table></div>
       <p class="small muted">Years before 2023 come from records the GSA migrated from the Census Bureau's clearinghouse; a few fields can be incomplete, so compare early years with care.</p></div>`
    : "";

  if (rec.kind === "s") {
    const u = rec.usa;
    const title = `${rec.name}, ${stName}: apparent stopped Single Audit filer`;
    const desc = `${rec.name} (${rec.city}, ${st}) filed a Single Audit for ${rec.last_year_filed} but has none on file for the latest year, now ${fmtInt(rec.days_overdue)} days past due. Screening flag, not proof of noncompliance.`;
    const body = `${crumbs}
      <h1>${esc(rec.name)}</h1><p class="muted">${esc(rec.city)}, ${esc(stName)} · apparent stopped filer</p>
      <div class="notice">This government filed a Single Audit for ${rec.last_year_filed}, but nothing is on file for the latest year under any entity type, UEI or EIN, and that audit is more than 90 days past due. This is <strong>not</strong> proof of noncompliance.</div>
      <div class="grid-2"><div class="card"><h2>What the data shows</h2><dl class="dl">
        <dt>Last audit filed</dt><dd>Audit year ${rec.last_year_filed}</dd>
        <dt>Federal awards spent then</dt><dd>${fmtMoney(rec.last_federal_expended)}${rec.well_above_threshold ? " (well above the threshold)" : ""}</dd>
        ${rec.last_covid_relief_expended ? `<dt>Of which COVID-19 relief</dt><dd>${fmtMoney(rec.last_covid_relief_expended)}</dd>` : ""}
        <dt>Expected fiscal year end</dt><dd>${fmtDate(rec.expected_fy_end)}</dd>
        <dt>That audit was due</dt><dd>${fmtDate(rec.was_due)} (${fmtInt(rec.days_overdue)} days ago)</dd>
        <dt>Score on last audit</dt><dd>${pill(rec.last_tier)} ${rec.last_score}</dd>
        ${u ? `<dt>New direct federal grants since</dt><dd>${fmtMoney(u.amount)} obligated since ${fmtDate(u.since)} (USAspending)</dd>` : ""}
      </dl>${u ? `<p class="small muted">USAspending shows new direct federal grant obligations, not spending. A large amount makes "no longer receives federal money" an unlikely explanation; money received through a state is not included.</p>` : ""}</div>
      <div class="card"><h2>Possible explanations</h2><ul>
        <li>Federal spending fell below the Single Audit threshold ($1,000,000 for fiscal years beginning on or after October 1, 2024).</li>
        <li>The government filed under a new UEI, EIN or name, or is included in another entity's audit.</li>
        <li>The audit is late and has not been submitted yet.</li></ul>
        <p class="small muted">If you know this listing is wrong, please report it so it can be corrected.</p></div></div>
      ${historyCard}${actions}`;
    return shell({ title, description: desc, canonical, body, st, stName });
  }

  const e = rec;
  const peer = e.peer;
  const peerText = peer
    ? `This score is higher than ${peer.pct}% of ${fmtInt(peer.n)} governments with ${esc(peer.band.replace(" federal spending", ""))} in federal spending ${peer.scope === "state" ? "in " + esc(stName) : "nationally"} (their median score is ${peer.median}).`
    : "";
  const flags = e.flags.length
    ? e.flags.map((f) => `<li><details><summary><span>${esc(text[f] || f)}${f === "late" ? ` (${fmtInt(e.days_late)} days)` : ""}${f === "repeat_finding" ? ` (${e.findings.repeat})` : ""}</span><strong>+${flagPoints(f, e, P)}</strong></summary><p>${esc(help[f] || "")}</p></details></li>`).join("")
    : "<li>No warning signs reported.</li>";
  const streak = e.streak && e.streak.findings_streak > 1
    ? `<p>Federal award findings appear in each of the last <strong>${e.streak.findings_streak}</strong> audits on file${e.streak.since ? ` (since ${e.streak.since})` : ""}${e.streak.repeat_streak ? `, with repeat findings in the last <strong>${e.streak.repeat_streak}</strong>` : ""}.</p>`
    : "";
  const reqLabels = M.requirement_labels || {};
  const req = e.requirements && Object.keys(e.requirements).length
    ? `<div class="table-wrap"><table class="plain"><thead><tr><th>Compliance requirement</th><th class="num">Findings</th></tr></thead><tbody>${Object.entries(e.requirements).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}. ${esc(reqLabels[k] || "")}</td><td class="num">${v}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const progs = e.programs && e.programs.length
    ? `<div class="table-wrap"><table class="plain"><thead><tr><th>Federal program</th><th class="num">Spent</th><th class="num">Findings</th></tr></thead><tbody>${e.programs.map((p) => `<tr><td>${esc(p.name)}<div class="small muted">ALN ${esc(p.aln)}</div></td><td class="num">${fmtMoney(p.expended)}</td><td class="num">${p.findings}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  const pts = e.passthrough && e.passthrough.length ? `<ul>${e.passthrough.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  const th = e.themes && Object.keys(e.themes).length
    ? `<div class="chips">${Object.entries(e.themes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${esc(k)} · ${v}</span>`).join("")}</div>`
    : "";
  const title = `${e.name}, ${stName}: Single Audit screening score ${e.score} (${e.tier})`;
  const desc = `${e.name} (${e.city}, ${st}), audit year ${e.year}: screening score ${e.score}/100 (${e.tier}). ${e.findings.count} federal award findings, ${e.findings.repeat} repeat${e.days_late ? `; accepted ${e.days_late} days after the deadline` : ""}. From the Federal Audit Clearinghouse.`;
  const body = `${crumbs}
    <h1>${esc(e.name)}</h1><p class="muted">${esc(e.city)}, ${esc(stName)} · audit year ${e.year}</p>
    <div class="grid-2">
      <div class="card"><p>${pill(e.tier)} <strong class="bigscore">${e.score}</strong> <span class="muted">/ 100 screening score</span></p>
        ${Object.entries(e.components).map(([k, v]) => `<div class="comp"><span>${COMP[k]}</span><span class="track"><b style="width:${(v / 25) * 100}%"></b></span><span class="num">${v}/25</span></div>`).join("")}
        ${peerText ? `<p class="small">${peerText}</p>` : ""}${streak}</div>
      <div class="card"><h2>Key facts</h2><dl class="dl">
        <dt>Federal awards spent</dt><dd>${fmtMoney(e.federal_expended)}</dd>
        <dt>Findings (federal programs)</dt><dd>${e.findings.count} total · ${e.findings.repeat} repeat · ${e.findings.questioned_costs} with questioned costs</dd>
        <dt>Fiscal year end</dt><dd>${fmtDate(e.fy_end)}</dd>
        <dt>Accepted by FAC</dt><dd>${fmtDate(e.accepted)}${e.days_late ? ` (${fmtInt(e.days_late)} days after the 9-month deadline)` : ""}</dd>
        <dt>Auditor</dt><dd>${e.auditor ? `${esc(e.auditor)}<div class="small"><a href="/#insights-auditors-${esc(st)}-${firmKey(e.auditor)}">Other ${esc(stName)} governments this firm audits</a></div>` : "—"}</dd></dl></div>
    </div>
    <div class="card"><h2>What the auditor reported</h2><p class="small muted">Select a line for a plain-language explanation.</p><ul class="flaglist">${flags}</ul></div>
    ${req || progs ? `<div class="grid-2">${listCard("Findings by compliance requirement", req)}${listCard("Federal programs", progs, "Programs with findings first, then by amount spent.")}</div>` : ""}
    ${pts || th ? `<div class="grid-2">${listCard("Received federal money through", pts, "Pass-through entities named in the audit, most awards first.")}${listCard("Finding themes", th, "Sorted automatically by keywords in the finding text; a finding can match several themes.")}</div>` : ""}
    ${historyCard}${actions}
    <p class="small muted">Screening indicator from the auditor's reported results. Not an audit opinion or a finding of wrongdoing.</p>`;
  return shell({ title, description: desc, canonical, body, st, stName });
}

export function renderNotFound(st, id) {
  const body = `<h1>Government not found</h1><p>No current record for <code>${esc(id)}</code> in ${esc(st)}. The weekly update may have changed it.</p>
    <p><a class="btn" href="/#state-${esc(st)}">Open the ${esc(st)} list</a> <a class="btn" href="/#lookup">Look up a government</a></p>`;
  return shell({ title: "Government not found | Municipal Financial Risk Score", description: "Record not found.", canonical: SITE + "/", body, st, stName: st });
}

/** Worker handler for /gov/... ; assets = env.ASSETS */
export async function handleGov(request, assets) {
  const url = new URL(request.url);
  const p = parseGovPath(url.pathname);
  if (!p) return null;
  const html = (s, status = 200) => new Response(s, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
  const get = async (path) => {
    const r = await assets.fetch(new Request(new URL(path, url.origin)));
    return r.ok ? r.json() : null;
  };
  const [shard, summary] = await Promise.all([get(`/data/gov/${p.st}/${shardOf(p.id)}.json`), get("/data/summary.json")]);
  const rec = shard && shard[p.id];
  if (!rec || !summary) return html(renderNotFound(p.st, p.id), 404);
  const path = govPath(p.st, p.id, rec.name);
  if (url.pathname !== path) return Response.redirect(url.origin + path, 301);
  return html(renderGov(rec, summary, SITE + path));
}
