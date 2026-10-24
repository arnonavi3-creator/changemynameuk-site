# changemynameuk.com

Website for Change My Name UK (Paperlight Ltd). Plain HTML and CSS, no build step. Signups are collected with Netlify Forms.

## Pages

- `/` home, `/check/` free name change checker (runs in the browser, sends nothing unless the visitor joins the waitlist), `/pricing/`, `/how-it-works/`, `/free-guide/`
- `/guides/` and 10 guides under it
- `/about/`, `/help/`, `/terms/` (draft, noindex), `privacy.html`, `thanks.html`
- `sitemap.xml` and `robots.txt`

Each page is a folder with an `index.html`, so links end in `/`. The header, footer and free DIY banner are repeated in every page, so change them everywhere at once. Both the home page and the checker post to the same `waitlist` form with the same fields (`source`, `checker_result` and `suggested_plan` are hidden).

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

- Add the Paperlight Ltd company number in the footers and privacy notice once registered.
- Add the ICO registration number to `privacy.html`.
- Set up the hello@changemynameuk.com mailbox, or change the address.
- Add the founder section on `/about/` and have a solicitor review `/terms/`.
