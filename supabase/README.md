# Customer accounts and progress (Supabase)

Customers can sign in with an emailed link (no password) to save their checklist and inbox scanner progress. Avi sees every customer's progress at `/admin/`. Everything is optional: with no keys in `js/account-config.js` the site works exactly as before, from the browser's local storage.

| File | What it does |
|---|---|
| `supabase/schema.sql` | Tables, security rules (row level security), triggers and the admin view. Run in the Supabase SQL editor; safe to run again |
| `js/account-config.js` | Supabase project address and publishable key (both public by design), and `publicSignIn`: while `false`, the checklist's sign-in box only shows on deploy previews and localhost |
| `js/account.js` | Sign-in box, and saving the checklist and scanner to the database |
| `js/vendor/supabase-2.118.0.js` | Supabase's browser library (copied from npm so pages with a strict security policy can load it from this site) |
| `admin/` | The admin page: all customers, then one customer's organisations, status, dates and history |

## The data

- `profiles`: one row per customer, made at first sign-in. Reason, nation, wedding or divorce date, old and new surname, stage (signed up, checklist, scanned, in progress, finished, paused), admin notes.
- `checklists`: the customer's checklist answers.
- `progress`: one row per customer per organisation or checklist step. `status` is `to_do`, `asked`, `done`, `confirmed` or `not_needed`, with `status_on` (date) and `confirmed_how`: `ticked` (customer ticked it), `confirmation_email` or `new_name_in_email` (inbox scanner), `reply_from_org` or `staff` (only an admin can set these). `name_in_use` is what the organisation's latest email calls them (old or new). `org_id` links to the organisation catalogue (ids match `scan/catalogue.json`).
- `events`: dated history of every status change. Written by the database, never by the website.
- `organisations`: the catalogue, with empty columns ready for the guide assistant (who can do the change, methods, proof needed, what to do first, instructions link, step-by-step guide).
- `admins`: who can see everyone. Only added in the SQL editor.

Done means the customer says so. Confirmed means there's evidence (an email, the organisation, or us).

## Setting it up (Avi)

1. Go to https://supabase.com and sign up (with GitHub, or with hello@changemynameuk.com). Choose the Free plan.
2. Click **New project**. Name: `change-my-name-uk`. Make a strong database password and keep it in your password manager (you won't need to share it). **Region: West EU (London)**. Click **Create new project** and wait about two minutes.
3. Open **SQL Editor > New query**, paste all of `supabase/schema.sql`, and click **Run**. You should see "Success. No rows returned".
4. Open **Authentication > URL Configuration**.
   - Site URL: `https://changemynameuk.com`
   - Redirect URLs (add each): `https://changemynameuk.com/**`, `https://neon-dragon-1ac41e.netlify.app/**`, `https://deploy-preview-*--neon-dragon-1ac41e.netlify.app/**`
5. Open **Project Settings > API Keys** and copy two things: the **Project URL** (like `https://abcd1234.supabase.co`) and the **Publishable key** (starts `sb_publishable_`; on older screens it's the `anon` `public` key). These two are safe to share and go in `js/account-config.js`. **Never share the secret key (`sb_secret_` or `service_role`) or the database password.**
6. Once the keys are on the site, open `/admin/`, sign in with your email, then in **SQL Editor** run (with your email):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
   Reload `/admin/` and you'll see every customer.
7. **Sign-in emails for real customers.** Supabase's built-in email only sends to members of your Supabase team, a few an hour. Before real customers sign in, set up your own email sender, for example Resend (free for 3,000 emails a month): sign up at https://resend.com, add the domain `changemynameuk.com`, add the DNS records it shows in GoDaddy (keep the ImprovMX MX records), then in Supabase **Authentication > Emails > SMTP Settings** turn on custom SMTP: host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key, sender `hello@changemynameuk.com`, sender name `Change My Name UK`. In **Authentication > Emails > Templates > Magic Link** you can change the email's wording.
8. When steps 7 and 9 are done, set `publicSignIn: true` in `js/account-config.js` so customers on the live site see the sign-in box.
9. **Paperwork:** sign Supabase's Data Processing Addendum (dashboard, **Organization settings > Legal documents**), and register with the ICO before real customers sign in.

## The inbox scanner

`CMNAccount.syncScan(state, orgFor)` saves the scanner's tracker (one row per organisation; never email text). The scanner page (`/scan/`, PR #8) needs a few small changes to use it: load `/js/account-config.js` and `/js/account.js`, call `CMNAccount.syncScan(state, org)` in its `save()`, add a `<div id="acct-box" class="acct-box">` mounted with `CMNAccount.mount`, and add `https://*.supabase.co` to `connect-src` in its security policy.
