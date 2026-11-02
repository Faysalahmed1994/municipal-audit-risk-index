# Setup guide: from this folder to a live site on your own domain ($0 except the domain)

Allow about an hour. Do the steps in order.

## 0. Before going public (do this first)
- [ ] Confirm your employment agreement doesn't claim outside open-source work or publications.
- [ ] Keep the tool on **public FAC data only**, with no client engagement data (AICPA Code § 1.700).
- [ ] Some governments your firm audits will appear in the data. They come from public filings, but consider telling your firm before launch.

## 1. Get a free FAC API key (5 minutes)
1. Go to <https://api.data.gov/signup/> and enter your name and email.
2. The key arrives by email. Keep it private and never paste it into the code.

## 2. GitHub settings (10 minutes)
The code already lives in `Faysalahmed1994/municipal-audit-risk-index`.
1. Edit `site/config.js` on GitHub (pencil icon): set `author` to your full name as it should appear publicly.
   Put the same name in `CITATION.cff` (`given-names` / `family-names`).
2. Make sure the repository is set to **Public** (Settings → General → Danger Zone shows "Change visibility").
3. Under the repository's **About** (gear icon on the main page), set Website to `https://civicauditlens.org`.
4. **Settings → Secrets and variables → Actions → New repository secret**. Name: `FAC_API_KEY`. Value: your key.
5. **Settings → Actions → General → Workflow permissions** → choose **Read and write permissions** → Save.
6. **Issues → Labels**: add labels named `feedback`, `data-issue` and `methodology`.

## 3. Load the real data (10–40 minutes, runs by itself)
1. Open **Actions → "Update data from Federal Audit Clearinghouse" → Run workflow**.
2. When it turns green, `site/data/` holds real data and the SAMPLE banner goes away.
   If it fails, open the red run, copy the error and send it to me.
3. After that it runs by itself every Thursday.

## 4. Host it free on Cloudflare Pages (10 minutes)
1. Create a free account at <https://dash.cloudflare.com>.
2. **Workers & Pages → Create → Pages → Connect to Git** → pick your repository.
3. Build settings: Framework preset **None**, Build command **(leave empty)**, Build output directory **`site`**.
4. Click **Save and Deploy**. You get a free address like `mfrs.pages.dev`. Every weekly data commit redeploys automatically.

## 5. Connect your domain (civicauditlens.org, already bought)
1. In Cloudflare, check **Domain Registration → Manage Domains** that `civicauditlens.org` shows **Auto-renew: On**.
2. Go to **Workers & Pages → your project → Custom domains → Set up a custom domain**, enter `civicauditlens.org`,
   then repeat for `www.civicauditlens.org`.
3. Optional: forward `openauditindex.org` to the new site with **Rules → Redirect Rules** on that domain,
   or simply let it expire at renewal.
   Because the domain is also on Cloudflare, DNS and HTTPS are set up for you.
   (If you bought the domain elsewhere, Cloudflare shows the DNS record or nameservers to add at your registrar.)

## 6. Turn on free visitor statistics (2 minutes)
**Analytics & Logs → Web Analytics → Add a site** → choose your Pages project. This gives visitor and page counts
without cookies. Screenshot it monthly for your evidence log.

## 7. Get a permanent DOI (10 minutes)
1. Sign in at <https://zenodo.org> with GitHub → **GitHub** tab → switch your repository **On**.
2. On GitHub: **Releases → Draft a new release**, tag `v0.1.0`, publish.
3. Zenodo mints a DOI within minutes. Put it in `site/config.js` (`doi:`) and in the README.
4. Make a new release for each method change (v0.2.0, …) so every version is archived.

## Updating the app later
Describe the change to Claude, replace the changed files on GitHub, and Cloudflare redeploys in about a minute.
