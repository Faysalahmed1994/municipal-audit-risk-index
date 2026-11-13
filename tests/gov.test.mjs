// Run with: node --test tests/
// Checks that the Worker's government pages agree with the Python pipeline and render safely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { shardOf, slugify, encId, govPath, parseGovPath, renderGov, renderNotFound, handleGov } from "../src/gov.js";

// Reference values computed with pipeline/analytics.py (shard_of, slugify, urllib quote)
const REF = [
  ["ABC123XYZ789", 15, "abc123xyz789", "ABC123XYZ789"],
  ["EIN-361234567", 14, "ein-361234567", "EIN-361234567"],
  ["NAME-IL-VILLAGE OF O'FALLON (EAST)", 9, "name-il-village-of-o-fallon-east", "NAME-IL-VILLAGE%20OF%20O%27FALLON%20%28EAST%29"],
  ["Ünïcode-ID", 14, "n-code-id", "%C3%9Cn%C3%AFcode-ID"],
];

test("shard, slug and id encoding match the Python pipeline", () => {
  for (const [id, shard, slug, enc] of REF) {
    assert.equal(shardOf(id), shard, id);
    assert.equal(slugify(id), slug, id);
    assert.equal(encId(id), enc, id);
  }
});

test("government paths parse and round-trip", () => {
  const id = "NAME-IL-VILLAGE OF O'FALLON (EAST)";
  const path = govPath("IL", id, "Village of O'Fallon");
  assert.deepEqual(parseGovPath(path), { st: "IL", id, slug: "village-of-o-fallon" });
  assert.equal(parseGovPath("/gov/il/ABC").st, "IL");
  assert.equal(parseGovPath("/gov/IL/ABC").st, "IL");
  assert.equal(parseGovPath("/states/IL"), null);
  assert.equal(parseGovPath("/gov/IL/%E0%A4%A"), null);
});

const SAMPLE = process.env.SAMPLE_DIR || "/tmp/sample";

test("renders an audit page and a stopped-filer page from sample data, escaping text", { skip: !existsSync(SAMPLE + "/summary.json") }, () => {
  const summary = JSON.parse(readFileSync(SAMPLE + "/summary.json", "utf8"));
  const dir = SAMPLE + "/gov/IL";
  let audit, stopped;
  for (const f of readdirSync(dir)) {
    for (const rec of Object.values(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")))) {
      if (rec.kind === "a" && !audit && rec.flags.length > 2) audit = rec;
      if (rec.kind === "s" && !stopped) stopped = rec;
    }
  }
  assert.ok(audit && stopped);
  const html = renderGov({ ...audit, name: audit.name + " <script>x</script>" }, summary, "https://civicauditlens.org/x");
  assert.match(html, /<link rel="canonical" href="https:\/\/civicauditlens.org\/x">/);
  assert.ok(!html.includes("<script>x</script>"));
  assert.match(html, /What the auditor reported/);
  assert.match(html, /Score history/);
  assert.ok(html.includes(`href="/#compare/${audit.state}:${encodeURIComponent(audit.id)}"`), "audit page links to the compare page");
  const s = renderGov(stopped, summary, "https://civicauditlens.org/y");
  assert.match(s, /apparent stopped filer/);
  assert.ok(s.includes(`href="/#compare/${stopped.state}:${encodeURIComponent(stopped.id)}"`), "stopped-filer page links to the compare page");
  // ids that are not plain UEIs stay safe inside the link
  const odd = renderGov({ ...audit, id: 'EIN-12"3/4' }, summary, "https://civicauditlens.org/z");
  assert.ok(odd.includes('href="/#compare/' + audit.state + ':EIN-12%223%2F4"'));
  assert.match(renderNotFound("IL", "<b>"), /&lt;b&gt;/);
});

test("handleGov serves, redirects to the canonical path, and 404s", { skip: !existsSync(SAMPLE + "/summary.json") }, async () => {
  const assets = {
    fetch: async (req) => {
      const p = new URL(req.url).pathname.replace(/^\/data/, SAMPLE);
      return existsSync(p) ? new Response(readFileSync(p)) : new Response("nf", { status: 404 });
    },
  };
  const summary = JSON.parse(readFileSync(SAMPLE + "/summary.json", "utf8"));
  const st = Object.keys(summary.states)[0];
  const shardFile = readdirSync(`${SAMPLE}/gov/${st}`)[0];
  const rec = Object.values(JSON.parse(readFileSync(`${SAMPLE}/gov/${st}/${shardFile}`, "utf8")))[0];
  const canonical = govPath(st, rec.id, rec.name);
  const ok = await handleGov(new Request("https://civicauditlens.org" + canonical), assets);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), new RegExp(rec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const redirect = await handleGov(new Request(`https://civicauditlens.org/gov/${st.toLowerCase()}/${encId(rec.id)}`), assets);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "https://civicauditlens.org" + canonical);
  const missing = await handleGov(new Request(`https://civicauditlens.org/gov/${st}/NOPE`), assets);
  assert.equal(missing.status, 404);
  assert.equal(await handleGov(new Request("https://civicauditlens.org/other"), assets), null);
});
