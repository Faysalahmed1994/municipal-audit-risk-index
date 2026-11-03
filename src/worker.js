/**
 * Cloudflare Worker for civicauditlens.org
 *
 * - Every normal page and data file is served from site/ (static assets).
 * - POST /api/feedback receives the website's feedback form and emails it to the owner
 *   using Cloudflare Email Routing (free). The destination address is NOT in this code:
 *   it is stored in the Cloudflare dashboard as the secret FEEDBACK_TO.
 *
 * One-time setup (Cloudflare dashboard):
 *   1. civicauditlens.org -> Email -> Email Routing -> enable, and verify your inbox
 *      under "Destination addresses".
 *   2. Workers & Pages -> municipal-financial-risk-score -> Settings -> Variables and Secrets
 *      -> add secret FEEDBACK_TO = the verified inbox address.
 */
import { EmailMessage } from "cloudflare:email";

const FROM = "feedback@civicauditlens.org";
const TYPES = { general: "General feedback", data: "Data issue", method: "Methodology suggestion" };
const LIMITS = { name: 120, email: 200, role: 120, organization: 200, subject: 200, message: 5000 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/feedback") {
      if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
      return handleFeedback(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

export async function handleFeedback(request, env, Message = EmailMessage) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the form." }, 400);
  }
  // Spam guards: hidden "website" field must stay empty, and the form must not be submitted instantly.
  if (body.website) return json({ ok: true });
  if (Number(body.elapsed_ms || 0) < 2500) return json({ ok: false, error: "Please take a moment and try again." }, 400);

  const f = {};
  for (const [k, max] of Object.entries(LIMITS)) f[k] = clean(body[k], max);
  const type = TYPES[body.type] ? body.type : "general";
  if (f.message.length < 10) return json({ ok: false, error: "Please write a short message (at least 10 characters)." }, 400);
  if (f.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(f.email)) {
    return json({ ok: false, error: "That email address doesn't look right." }, 400);
  }
  if (!env.FEEDBACK_TO || !env.FEEDBACK_EMAIL) {
    return json({ ok: false, error: "Feedback by email isn't set up yet. Please use the GitHub option below." }, 503);
  }

  const subject = `[MFRS] ${TYPES[type]}${f.subject ? ": " + f.subject : ""}`;
  const text = [
    `Type: ${TYPES[type]}`,
    `Name: ${f.name || "(not given)"}`,
    `Email: ${f.email || "(not given)"}`,
    `Role: ${f.role || "(not given)"}`,
    `Organization: ${f.organization || "(not given)"}`,
    `Page: ${clean(body.page, 300) || "(unknown)"}`,
    `Sent: ${new Date().toISOString()}`,
    "",
    f.message,
  ].join("\n");

  const raw = mime({ from: FROM, to: env.FEEDBACK_TO, replyTo: f.email, subject, text });
  try {
    await env.FEEDBACK_EMAIL.send(new Message(FROM, env.FEEDBACK_TO, raw));
  } catch (err) {
    console.error("feedback email failed", err && err.message);
    return json({ ok: false, error: "Sorry, the message could not be sent. Please try again later." }, 502);
  }
  return json({ ok: true });
}

function clean(v, max) {
  return String(v ?? "").replace(/[\r\0]/g, "").trim().slice(0, max);
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function mime({ from, to, replyTo, subject, text }) {
  const headers = [
    `From: Municipal Financial Risk Score <${from}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo.replace(/[\n<>]/g, "")}>` : null,
    `Subject: =?UTF-8?B?${b64(subject.replace(/\n/g, " "))}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@civicauditlens.org>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = b64(text).replace(/(.{76})/g, "$1\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + body + "\r\n";
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
