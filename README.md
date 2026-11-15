# changemynameuk.com

Website for Change My Name UK (run by Avi Arnon as a sole trader until the company is set up). Plain HTML and CSS, no build step. Signups are collected with Netlify Forms.

## Pages

- `/` home (lead generation for research calls), `/check/` free personalised name change checklist (questionnaire and ordered checklist, logic in `check/checklist.js`, runs in the browser; answers and ticks stay in the visitor's localStorage), `/call/` research call sign-up (£7 voucher), `/beta/` beta application for the done-for-you service (`/beta/thanks/` after submit)
- `/guides/` and 10 guides under it
- `/about/`, `/help/`, `privacy.html`, `thanks.html`
- `/pricing/`, `/how-it-works/`, `/free-guide/` and `/terms/` were removed in Nov 2026 while the site is used for research; `netlify.toml` redirects them
- `sitemap.xml` and `robots.txt`

Each page is a folder with an `index.html`, so links end in `/`. The header and footer are repeated in every page, so change them everywhere at once. Netlify forms:

- `waitlist`: no longer on the site (closed Nov 2026); old submissions stay in Netlify.
- `research-call` (`/call/`, linked from the checklist results): first name, email, optional phone, `call_type`, `good_times`, required `call_consent`, optional `launch_updates`, plus hidden `checklist_answers`, `reason`, `stage`, `nation`, `wedding_date`, `item_count` when the visitor came from the checklist. Offers a £7 Amazon voucher for a 15 minute call. After submitting, `/call/thanks/` shows a button to the booking page set in its `data-booking-url` attribute (currently Avi's Google Calendar appointment schedule; empty = a "we'll email you some times" message).
- `beta` (`/beta/`): first name, email, reason, nation, start date, help level, notes, `call_consent`, and `checklist_answers` when the visitor came from the checklist.

Netlify only stores fields that exist in the HTML at deploy time, so add new fields to the markup, not just in JavaScript. The free plan allows 100 form submissions a month across all forms.

To change checklist rules, edit `buildItems()` in `check/checklist.js`. Rules come from the operational map (where to update, proof needed, order).

## Deploy on Netlify (free plan)

1. Sign up at https://app.netlify.com with your GitHub account.
2. **Add new site > Import an existing project > GitHub**, then pick `changemynameuk-site`. Leave the build command empty and the publish directory as `.`, then deploy.
3. In **Site configuration > Forms**, click **Enable form detection**, then trigger a redeploy (Deploys > Trigger deploy). The `waitlist` form appears after that deploy.
4. In **Forms > Form notifications**, add an email notification so each signup reaches your inbox. Export signups as CSV from the Forms page.

## Point the domain at Netlify

In Netlify, go to **Domain management > Add a domain** and enter `changemynameuk.com`. Then choose one of these:

**Option A (simplest): use Netlify DNS.** Netlify shows four nameservers (like `dns1.p01.nsone.net`). At your domain registrar, replace the nameservers with those four. It can take up to 24 hours.

**Option B: keep DNS at your registrar.** Add these records there:

| Type  | Name / Host | Value                         |
|-------|-------------|-------------------------------|
| A     | `@`         | `75.2.60.5`                   |
| CNAME | `www`       | `<your-site-name>.netlify.app` |

Remove any other A or AAAA records on `@` first. Netlify then issues a free HTTPS certificate automatically (Domain management > HTTPS).

If you plan to use an email address on the domain (like hello@changemynameuk.com), keep or add your email provider's MX records. With Option A, add them in Netlify DNS.

## Before going live

- Once the limited company exists, replace "Avi Arnon, a sole trader" in the footers, terms, about page and privacy notice with the company name, number and registered office.
- Add the ICO registration number to `privacy.html`.
- Set up the hello@changemynameuk.com mailbox, or change the address.
- Add the founder section on `/about/` and have a solicitor review `/terms/`.
