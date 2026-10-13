/**
 * Plotto AI writer for the public site: a Google Apps Script web app bound to a private Google Sheet.
 *
 * It lets visitors use the site owner's Claude account, one free interpretation per email address.
 * Each request:
 *   1. checks that the email address looks valid, that its domain receives mail, and that it is not
 *      a throwaway address;
 *   2. under a lock, so that visitors arriving at the same moment are handled one at a time, checks
 *      the sheet: the address must not already be listed, and today's spending plus this request's
 *      most it could cost must stay within the daily budget; then lists the address as "pending",
 *      with that most-it-could-cost reserved in the Cost column;
 *   3. asks Claude for the treatment, with the owner's API key;
 *   4. marks the row "done", or "failed" / "refused" so the visitor can try again (only "done" rows,
 *      and "pending" rows still in progress, count against an address), and replaces the reserved
 *      cost with the actual cost, from the tokens Claude reports.
 *
 * Setup: see "Putting it on the web" in README.md.
 *
 * Script properties (Project Settings > Script properties)
 *   ANTHROPIC_API_KEY   required
 *   MODEL               default claude-sonnet-4-6 (Claude Sonnet 4.6)
 *   EFFORT              low | medium | high | xhigh | max (default medium)
 *   MAX_TOKENS          cap on one answer, thinking included (default 8000)
 *   USES_PER_EMAIL      free interpretations per address (default 1)
 *   DAILY_BUDGET_USD    spending cap per day, all visitors together, in US dollars (default 1)
 *   PRICE_INPUT, PRICE_OUTPUT
 *                       US dollars per million tokens, if MODEL isn't in PRICES below
 *
 * Days follow the script's time zone (Project Settings > Time zone).
 *
 * Protocol. POST a JSON body, sent as text/plain so that browsers skip the CORS preflight:
 *   {"email": "...", "prompt": "...", "genre": "Noir", "notice": "2026-10-12"}
 * Answer: {"ok": true, "text": "...", "truncated": false, "remaining": 0}
 *      or {"ok": false, "code": "used", "message": "..."}
 */

const SHEET_NAME = "Emails";
const HEADER = ["Time", "Email", "Normalized email", "Status", "Genre", "Model", "Input tokens", "Output tokens", "Cost (USD)", "Notice shown", "Detail", "Request"];
const COL = { time: 0, email: 1, normalized: 2, status: 3, genre: 4, model: 5, inTokens: 6, outTokens: 7, cost: 8, notice: 9, detail: 10, id: 11 };
const PENDING_MINUTES = 10; // a pending row older than this never finished, and no longer counts
const MAX_PROMPT_CHARS = 40000;
const PROMPT_START = "You are a story developer who specializes in ";
const LIMIT_MESSAGE = "AI use is at its limit for today. Please try again tomorrow.";

// US dollars per million tokens, [input, output], from Anthropic's price list (prompts up to 100K tokens).
// A model not listed here needs PRICE_INPUT and PRICE_OUTPUT; without them it is costed at the top rate.
const PRICES = {
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
const TOP_PRICE = [10, 50];
// Models that take the server-side fallback (a declined request re-runs on another model). Sonnet 4.6
// and Haiku don't.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const SYSTEM =
  "You are a story developer. You interpret plot outlines made with PLOTTO, William Wallace Cook's 1928 " +
  "plot-suggestion system, as genre story treatments, in the format the user asks for.";

// Common throwaway-address services. Extend as needed.
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "temp-mail.org", "tempmail.com", "tempmailo.com", "yopmail.com", "trashmail.com", "getnada.com",
  "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mailnesia.com",
  "mintemail.com", "emailondeck.com", "spamgourmet.com", "mohmal.com",
]);

// A practical check, not the full RFC 5322 grammar: a dot-separated local part, then a domain with a
// real top-level domain.
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

function doGet() {
  return json({ ok: true, service: "plotto-writer" });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return fail("bad_request", "The request was not readable.");
  }

  const prompt = String(req.prompt || "");
  if (!prompt.startsWith(PROMPT_START) || prompt.length > MAX_PROMPT_CHARS)
    return fail("bad_request", "This request didn't come from the Plotto site.");

  const email = String(req.email || "").trim();
  const problem = checkEmail(email);
  if (problem) return fail(problem.code, problem.message);

  const props = settings();
  if (!props.key) return fail("not_configured", "The AI writer isn't set up yet. Use Copy prompt instead.");

  const claim = claimRow(email, normalizeEmail(email), oneLine(req.genre, 80), oneLine(req.notice, 40), mostItCouldCost(prompt.length, props), props);
  if (claim.error) return fail(claim.error.code, claim.error.message);

  const result = askClaude(prompt, oneLine(req.genre, 80), props);
  finishRow(claim, result);
  if (!result.ok) return fail(result.code, result.message);
  return json({ ok: true, text: result.text, truncated: result.truncated, remaining: Math.max(0, props.usesPerEmail - claim.used - 1) });
}

// ------------------------------------------------------------------ email checks
function checkEmail(email) {
  if (!email || email.length > 254 || !EMAIL_RE.test(email) || email.split("@")[0].length > 64)
    return { code: "invalid_email", message: "That doesn't look like a valid email address." };
  const domain = email.split("@")[1].toLowerCase();
  if (DISPOSABLE.has(domain)) return { code: "disposable", message: "Please use a permanent email address, not a throwaway one." };
  if (!domainReceivesMail(domain)) return { code: "no_mail", message: `${domain} doesn't seem to receive email. Check the address.` };
  return null;
}

/** True when the domain publishes a mail server (MX), or an address record mail can fall back to.
 *  Asks Google's public DNS; if that lookup itself fails, the visitor is not turned away. */
function domainReceivesMail(domain) {
  const cache = CacheService.getScriptCache();
  const known = cache.get("mx:" + domain);
  if (known) return known === "1";
  const lookup = (type) =>
    JSON.parse(UrlFetchApp.fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`, { muteHttpExceptions: true }).getContentText());
  let ok;
  try {
    const mx = lookup("MX");
    const records = (mx.Answer || []).filter((a) => a.type === 15);
    if (mx.Status === 3) ok = false; // no such domain
    else if (records.some((a) => /^0 \.$/.test(String(a.data).trim()))) ok = false; // "null MX": the domain accepts no mail
    else if (records.length) ok = true;
    else ok = (lookup("A").Answer || []).some((a) => a.type === 1);
  } catch (err) {
    return true;
  }
  cache.put("mx:" + domain, ok ? "1" : "0", 21600);
  return ok;
}

/** The form an address is counted under: case, "+tags" and Gmail's ignored dots don't make a new address. */
function normalizeEmail(email) {
  let [local, domain] = email.toLowerCase().split("@");
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local + "@" + domain;
}

// ------------------------------------------------------------------ the sheet
function emailSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Whether a row counts against its address and the daily limit. */
function counts(row, now) {
  if (row[COL.status] === "done") return true;
  return row[COL.status] === "pending" && row[COL.time] instanceof Date && now - row[COL.time] < PENDING_MINUTES * 60000;
}

/** Check the address and the daily budget, then list the address as pending, all under one lock. */
function claimRow(email, normalized, genre, notice, reserve, props) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { error: { code: "busy", message: "The writer is busy. Try again in a moment." } };
  try {
    const sheet = emailSheet();
    const now = new Date();
    const last = sheet.getLastRow();
    const rows = last > 1 ? sheet.getRange(2, 1, last - 1, HEADER.length).getValues() : [];
    const zone = Session.getScriptTimeZone();
    const day = (d) => Utilities.formatDate(d, zone, "yyyy-MM-dd");
    let used = 0;
    let spent = 0; // today's actual costs, plus what requests still running have reserved
    for (const row of rows) {
      if (row[COL.time] instanceof Date && day(row[COL.time]) === day(now)) spent += Number(row[COL.cost]) || 0;
      if (counts(row, now) && row[COL.normalized] === normalized) used++;
    }
    if (used >= props.usesPerEmail)
      return {
        error: {
          code: "used",
          message:
            props.usesPerEmail === 1
              ? "This email address has already had its free interpretation. Use Copy prompt to run the prompt in any chat model."
              : `This email address has had its ${props.usesPerEmail} free interpretations. Use Copy prompt to run the prompt in any chat model.`,
        },
      };
    if (spent + reserve > props.dailyBudget) return { error: { code: "daily_limit", message: LIMIT_MESSAGE } };
    const id = Utilities.getUuid();
    sheet.appendRow([now, cell(email), cell(normalized), "pending", cell(genre), props.model, "", "", round(reserve), cell(notice), "", id]);
    return { row: sheet.getLastRow(), id, used, props };
  } finally {
    lock.releaseLock();
  }
}

/** Record how the request ended, on the row it claimed (found again by its id if rows have moved). */
function finishRow(claim, result) {
  const sheet = emailSheet();
  let row = claim.row;
  const width = HEADER.length;
  let values = sheet.getRange(row, 1, 1, width).getValues()[0];
  if (values[COL.id] !== claim.id) {
    const ids = sheet.getRange(1, COL.id + 1, sheet.getLastRow(), 1).getValues().map((r) => r[0]);
    row = ids.indexOf(claim.id) + 1;
    if (row < 1) return;
    values = sheet.getRange(row, 1, 1, width).getValues()[0];
  }
  const usage = result.usage || {};
  values[COL.status] = result.ok ? "done" : result.code === "refused" ? "refused" : "failed";
  values[COL.inTokens] = usage.input_tokens || "";
  values[COL.outTokens] = usage.output_tokens || "";
  values[COL.cost] = round(costOf(usage, claim.props));
  values[COL.detail] = cell(result.detail || (result.truncated ? "cut short at MAX_TOKENS" : ""));
  sheet.getRange(row, 1, 1, width).setValues([values]);
}

/** Text a visitor typed is stored as text: a leading = + - or @ would otherwise make it a formula. */
function cell(value) {
  const s = String(value == null ? "" : value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ------------------------------------------------------------------ Claude
function settings() {
  const p = PropertiesService.getScriptProperties();
  const num = (name, fallback) => {
    const v = parseInt(p.getProperty(name), 10);
    return v > 0 ? v : fallback;
  };
  return {
    key: p.getProperty("ANTHROPIC_API_KEY"),
    model: p.getProperty("MODEL") || "claude-sonnet-4-6",
    effort: p.getProperty("EFFORT") || "medium",
    maxTokens: num("MAX_TOKENS", 8000),
    usesPerEmail: num("USES_PER_EMAIL", 1),
    dailyBudget: dollars(p.getProperty("DAILY_BUDGET_USD"), 1),
    price: [dollars(p.getProperty("PRICE_INPUT"), 0), dollars(p.getProperty("PRICE_OUTPUT"), 0)],
  };
}

function dollars(value, fallback) {
  const v = parseFloat(value);
  return v > 0 ? v : fallback;
}

/** US dollars per million tokens for the configured model, [input, output]. */
function priceOf(props) {
  if (props.price[0] && props.price[1]) return props.price;
  return PRICES[props.model] || TOP_PRICE;
}

/** What one request could cost at most: its prompt (about 3 characters a token, generously) and a
 *  full MAX_TOKENS answer. Reserved against the day's budget while the request runs. */
function mostItCouldCost(promptChars, props) {
  const [inPrice, outPrice] = priceOf(props);
  return (Math.ceil(promptChars / 3) * inPrice + props.maxTokens * outPrice) / 1e6;
}

/** What a finished request cost, from the tokens Claude reports (thinking is billed as output). */
function costOf(usage, props) {
  const [inPrice, outPrice] = priceOf(props);
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  return (input * inPrice + (usage.output_tokens || 0) * outPrice) / 1e6;
}

function round(usd) {
  return Math.round(usd * 1e6) / 1e6;
}

/** One request to the Messages API. Apps Script has no Anthropic SDK, so this is raw HTTP. */
function askClaude(prompt, genre, props) {
  const notUsed = " Your free interpretation wasn't used.";
  const body = {
    model: props.model,
    max_tokens: props.maxTokens,
    system: genre ? `${SYSTEM} This one is ${genre}: write as a specialist in ${genre} fiction would, keeping to the genre brief in the request.` : SYSTEM,
    messages: [{ role: "user", content: prompt }],
    // Adaptive thinking lets the model plan the story and run the prompt's logic check before it writes;
    // effort sets how much. (Models older than the 4.6 generation don't accept this.)
    thinking: { type: "adaptive" },
    output_config: { effort: props.effort },
  };
  const headers = { "x-api-key": props.key, "anthropic-version": "2023-06-01" };
  if (FALLBACK_MODELS.has(props.model)) {
    // If a safety classifier declines, the API re-runs the request on Anthropic's recommended fallback model.
    body.fallbacks = "default";
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  }
  let res;
  try {
    res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers,
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      timeoutSeconds: 300,
    });
  } catch (err) {
    return { ok: false, code: "writer_failed", message: "Couldn't reach the AI writer." + notUsed + " Try again.", detail: String(err).slice(0, 300) };
  }
  const status = res.getResponseCode();
  let data = {};
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    data = {};
  }
  if (status !== 200) {
    const error = data.error || {};
    const detail = `${status} ${error.type || ""}: ${error.message || ""}`.slice(0, 300);
    if (status === 429 || status >= 500)
      return { ok: false, code: "busy", message: "The AI writer is busy right now." + notUsed + " Try again in a minute.", detail };
    return { ok: false, code: "writer_failed", message: "The AI writer couldn't take this request." + notUsed, detail };
  }
  const usage = data.usage || {};
  if (data.stop_reason === "refusal")
    return {
      ok: false,
      code: "refused",
      message: "The model declined this plot." + notUsed + " Try another genre.",
      usage,
      detail: "refusal " + ((data.stop_details && data.stop_details.category) || ""),
    };
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text.trim()) return { ok: false, code: "empty", message: "The model returned nothing." + notUsed + " Try again.", usage };
  return { ok: true, text, truncated: data.stop_reason === "max_tokens", usage };
}

// ------------------------------------------------------------------ answers
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail(code, message) {
  return json({ ok: false, code, message });
}

function oneLine(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}
