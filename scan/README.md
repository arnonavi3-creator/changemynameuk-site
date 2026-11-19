# Inbox scanner (private beta)

Finds the organisations that have a person's name from their Gmail, shows which name each one uses (old or new), and ticks them off when they confirm the change. Everything runs in the browser.

| File | What it does |
|---|---|
| `index.html` | The page (`/scan/`, noindex, not linked from the site) |
| `config.js` | Google OAuth web client ID for the beta Google Cloud project. Empty = sample inbox only |
| `engine.js` | Pure logic: parse From/To headers, match sender domains, spot confirmation subjects, read the name in an email's text |
| `gmail.js` | Gmail API reader (`gmail.readonly`): searches `from:(domains) after:date` in groups of 30 domains, reads headers of matches, opens the latest email per organisation |
| `demo.js` | Made-up inbox that answers like the Gmail API (the "Try a sample inbox" button and tests) |
| `app.js` | Page logic: Google sign-in, first scan, tracker, "Check for confirmations" |
| `catalogue.json` | Organisation names, categories, phases and sender domains. Built from the private database |
| `tools/build_catalogue.py` | Builds `catalogue.json`. `--sample` keeps a short public list |
| `tests/engine.test.js` | `node --test scan/tests/engine.test.js` |

## Privacy design
- The access token stays in memory (about 1 hour) and is never stored or sent to our server.
- Only emails from catalogue domains are ever downloaded (Gmail search). Nothing leaves the browser. Saved in localStorage: organisation list, counts, dates, surnames, the name/greeting each organisation uses (max 60 chars), ticks, and the subject of a confirming email. Email text is never saved.
- `netlify.toml` sets a Content Security Policy on `/scan/*` so the page can only connect to this site and Google.
- No analytics script on this page.

## Google setup (beta project, Testing mode)
External audience in Testing, up to 100 named test users for the life of the project, access ends 7 days after consent. Scope `https://www.googleapis.com/auth/gmail.readonly` (Avi chose reading bodies for the name check, 19 Nov 2026). Project "Change My Name UK beta", web client "Scanner web" with JavaScript origins `https://changemynameuk.com`, `https://neon-dragon-1ac41e.netlify.app` and `https://deploy-preview-8--neon-dragon-1ac41e.netlify.app` (add `http://localhost:8765` for local testing). Client ID is in `config.js` (public by design; the client secret is not used and must never be committed).

## Updating the organisation list
```
python3 scan/tools/build_catalogue.py <private>/organisations.json <private>/categories.json --sample
```
Drop `--sample` to publish every organisation's name and sender domains (no how-to steps, proof rules or sources are copied).

## Known limits
- The first scan stops at 8,000 matching emails.
- The name check reads only the latest email per organisation, and needs the surnames entered on the first screen.
- Organisations that email from a third-party domain (a mailing provider) aren't matched yet.
