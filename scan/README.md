# Inbox scanner (private beta)

Finds the organisations that have a person's name from their Gmail headers, and ticks them off when a confirmation email arrives. Everything runs in the browser.

| File | What it does |
|---|---|
| `index.html` | The page (`/scan/`, noindex, not linked from the site) |
| `config.js` | Google OAuth web client ID for the beta Google Cloud project. Empty = sample inbox only |
| `engine.js` | Pure matching: parse From headers, match sender domains, spot confirmation subjects |
| `gmail.js` | Gmail API reader (`gmail.metadata` scope: headers only, no search, pages newest first) |
| `demo.js` | Made-up inbox that answers like the Gmail API (the "Try a sample inbox" button and tests) |
| `app.js` | Page logic: Google sign-in, first scan, tracker, "Check for confirmations" |
| `catalogue.json` | Organisation names, categories, phases and sender domains. Built from the private database |
| `tools/build_catalogue.py` | Builds `catalogue.json`. `--sample` keeps a short public list |
| `tests/engine.test.js` | `node --test scan/tests/engine.test.js` |

## Privacy design
- The access token stays in memory (about 1 hour) and is never stored or sent to our server.
- Headers never leave the browser. Only the organisation list, counts, dates, the person's ticks and the subject of a confirming email are saved, in localStorage.
- `netlify.toml` sets a Content Security Policy on `/scan/*` so the page can only connect to this site and Google.
- No analytics script on this page.

## Google setup (beta project, Testing mode)
External audience in Testing, up to 100 named test users for the life of the project, access ends 7 days after consent. Scope `https://www.googleapis.com/auth/gmail.metadata`. Web client with JavaScript origins `https://changemynameuk.com` and `https://neon-dragon-1ac41e.netlify.app` (add `http://localhost:8765` for local testing). Put the client ID in `config.js`.

## Updating the organisation list
```
python3 scan/tools/build_catalogue.py <private>/organisations.json <private>/categories.json --sample
```
Drop `--sample` to publish every organisation's name and sender domains (no how-to steps, proof rules or sources are copied).

## Known limits
- `gmail.metadata` can't use Gmail search, so a busy inbox takes a few minutes (about 50 emails a second under Google's per-user limit). The first scan stops at 6,000 emails.
- Organisations that email from a third-party domain (a mailing provider) aren't matched yet.
