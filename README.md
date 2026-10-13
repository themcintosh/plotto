# Plotto

A plot machine after William Wallace Cook's *Plotto: A New Method of Plot Suggestion for Writers of
Creative Fiction* (1928).

Press **Generate random plot** and the machine picks one of the 13,950 masterplots in Cook's chart and
shows it as a one-sentence logline. Behind it, the machine builds a fuller story from Cook's own
blueprints: a short story or a novelette, with the central situation, what leads up to it and follows
from it, an ending Cook marks for the masterplot, any subplot, and the characters' names. Open
**Cook's Blueprint** under the logline to read it.

For the full experience, choose **Interpret with AI**. An AI writer (Claude) takes the plot as raw
material and, in the genre you pick, writes a plain story treatment: title, logline, world, characters
and a mechanical synopsis that ends on the outcome. Interpretations are free, one per email address.

[SYSTEM-MAP.md](SYSTEM-MAP.md) explains how Plotto works and how the machine follows Cook's method.

## What's here

| Path | What it is |
|---|---|
| `docs/` | the website, published by GitHub Pages |
| `docs/index.html` | page layout and styles |
| `docs/engine.js` | Cook's method: references, break-parts, symbol changes, endings, random plots, working names |
| `docs/app.js` | the plot screen and the AI writer screen, including the genre briefs sent to the writer |
| `docs/plotto-data.js` | Cook's chart and his 1,462 conflicts, with their references and ending marks |
| `docs/config.js` | settings: the AI writer's address and the newsletter |
| `apps-script/Code.gs` | the AI writer: a Google Apps Script web app with the email check and a private sheet |

## How the AI writer works

The website is static, so it can't hold a Claude API key. Instead, a small Google Apps Script web app
holds the key, keeps visitors' email addresses in a private Google Sheet, and calls Claude for them.

On the AI writer screen, a visitor enters an email address under a notice that it may be added to the
newsletter *Solution Space*. Before anything is sent to Claude, the script:

1. checks that the address looks valid, that its domain receives mail, and that it isn't a throwaway
   address;
2. under a lock, so visitors arriving at the same moment are handled one at a time, checks the sheet:
   the address must not already be listed, and the day's spending must leave room for this request
   within the daily budget ($1 by default);
3. lists the address as *pending*, calls Claude, and marks the row *done* with what it cost.

If Claude fails or declines, the visitor can try again; only finished interpretations count. Addresses
are compared case-insensitively, without `+tags`, and without Gmail's ignored dots. When the day's
budget is spent, visitors see: "AI use is at its limit for today. Please try again tomorrow."

The writer uses Claude Sonnet 4.6 at medium effort, with adaptive thinking. One interpretation costs
about 3–8 cents, so the $1 daily budget allows roughly 11–31 a day, typically about 16.

## Setting it up

### 1. The sheet and the script

1. Create a new Google Sheet (it stays private to you).
2. In the sheet, open **Extensions > Apps Script**. Replace the contents of `Code.gs` with
   `apps-script/Code.gs` from this repository, and save.
3. Open **Project Settings** (the gear). Under **Script properties**, add:

   | Property | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key from the Claude Console (required) |
   | `MODEL` | optional; default `claude-sonnet-4-6` |
   | `EFFORT` | optional; `low`, `medium` (default), `high` or `max` |
   | `MAX_TOKENS` | optional cap on one answer, thinking included; default `8000` |
   | `USES_PER_EMAIL` | optional; default `1` |
   | `DAILY_BUDGET_USD` | optional spending cap per day, for all visitors together; default `1` |

   On the same page, set **Time zone** to yours: the daily budget resets at midnight there.
4. Click **Deploy > New deployment**, choose **Web app**, and set **Execute as: Me** and **Who has
   access: Anyone**. Deploy, and approve the permissions it asks for. Google warns that the app isn't
   verified; that is normal for your own script (choose **Advanced**, then go to the project).
5. Copy the web app URL (it ends in `/exec`). Opening it in a browser shows
   `{"ok":true,"service":"plotto-writer"}`.

The first visitor creates an **Emails** tab with a header row. Deleting an address's rows lets it use
the writer again. After changing `Code.gs`, use **Deploy > Manage deployments > Edit > New version**;
the URL stays the same.

### 2. The site

1. In `docs/config.js`, set `writerUrl` to the web app URL.
2. In the repository's **Settings > Pages**, set **Source** to **Deploy from a branch**, the branch to
   `main` and the folder to `/docs`, and save. The site appears at
   `https://<your-username>.github.io/<repository>/` within a few minutes.

Without `writerUrl`, the site still generates plots; the AI writer then offers **Copy prompt**, which
copies the full prompt for any chat model.

### Costs and limits

- Claude Sonnet 4.6 costs $3 per million input tokens and $15 per million output tokens, thinking
  included. A prompt is about 2,000 tokens; an answer is usually 1,500–5,000.
- Before each request the script reserves the most it could cost (about 13 cents with an 8,000-token
  answer) and turns the request away if that would pass the daily budget; the actual cost then replaces
  the reservation. A monthly spend limit in the Claude Console adds a second cap.
- The answer arrives whole, after a short wait, rather than streaming in.
- The email checks show that an address looks real and its domain takes mail, not that the visitor
  owns it. The daily budget is what protects the bill.

## Credits

*Plotto* by William Wallace Cook was published in 1928 and is in the public domain in the United
States. The text used here was obtained from Project Gutenberg.
