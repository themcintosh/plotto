/* Plotto engine: reads window.PLOTTO (built by tools/build_data.py) and implements Cook's method.
 *
 * Vocabulary
 *   entry  one lettered situation inside a numbered conflict (1a, 1b ...)
 *   item   a concrete use of an entry in a plot: {n, k, r?, v?, x?, ops?, note?, inherit?}
 *            r        break range (which "*"-parts are used)
 *            v        chosen variant(s) "[1]"
 *            x / ops  Cook's manipulation as printed / parsed ("ch A to B")
 *            inherit  symbol maps carried over from the conflict this one was reached from,
 *                     so every situation stays in the same frame of characters
 *   group  a cross-reference suggestion: steps joined by ";" (a combination), each step a list of
 *          alternatives ("or")
 *   part   one of Cook's break-parts ("*"); the Classification by Character Symbols files every part
 *          under its cast and marks the parts that can end a story with C-clause numbers (entry.t)
 * A plot's a, b and c are clause numbers, or lists of them for a compound masterplot.
 */
(function (global) {
  "use strict";
  const P = global.PLOTTO;
  const C = P.conflicts;
  const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

  // ------------------------------------------------------------------ symbols
  const SYMBOL_CORE =
    "[ab]?(?:GCH|BR|SR|SN|CN|NW|NC|GF|GM|SF|SM|AU|F|M|D|U)-[AB]X?" + // relatives: F-B, SR-A, bCN-A
    "|[ab]?[AB](?:-[2-9])?X?" + //                                   A, B-3, aB-2, A-4X
    "|AX|BX|[ab]?CH(?:-\\d)?|X(?:-\\d)?" + //                           mysteries, children, objects
    "|GCH|SN|BR|SR|CN|NW|NC|D|U(?!\\.\\s*S\\b)"; //                     short forms (not "U. S.")
  const SYMBOL_RE = new RegExp("(?<![\\w’'\\-])(?:" + SYMBOL_CORE + ")(?![\\w\\-])", "g");
  const isSymbol = (w) => new RegExp("^(?:" + SYMBOL_CORE + ")$").test(w);

  function symbolMeaning(sym) {
    if (P.symbols[sym]) return P.symbols[sym];
    const base = sym.replace(/X$/, "");
    if (base !== sym && P.symbols[base]) return P.symbols[base] + " (mysterious)";
    const m = sym.match(/^([ab])(.+)$/);
    if (m && P.symbols[m[2]]) {
      const g = m[1] === "a" ? "male" : "female";
      return P.symbols[m[2]].replace(/^(male|female) /, "") + ` (${g})`;
    }
    return null;
  }

  // ------------------------------------------------------------------ access
  const conflict = (n) => C[n] || null;

  function entry(n, k) {
    const c = C[n];
    if (!c) return null;
    return c.e.find((e) => e.k === (k || "")) || (k ? null : c.e[0]);
  }

  /** Letters a reference points to. Letters this edition lacks fall back to the whole conflict. */
  function keysFor(n, ks) {
    const c = C[n];
    if (!c) return [];
    const all = c.e.map((e) => e.k);
    if (!ks || !ks.length) return all;
    const have = ks.filter((k) => all.includes(k));
    return have.length ? have : all;
  }

  const allEntries = [];
  for (const n of Object.keys(C)) for (const e of C[n].e) allEntries.push({ n: +n, k: e.k });

  /** The conflicts Cook files under a B clause (or under any clause of a compound B). */
  function entriesForB(bs) {
    const seen = new Set();
    const out = [];
    for (const bn of list(bs)) {
      const b = P.B.find((x) => x.n === bn);
      if (!b) continue;
      for (const [lo, hi] of b.ranges)
        for (let n = lo; n <= hi; n++)
          if (C[n] && !seen.has(n)) {
            seen.add(n);
            for (const e of C[n].e) out.push({ n, k: e.k });
          }
    }
    return out;
  }

  // ------------------------------------------------------------------ items from references
  function itemFromRef(ref, k, parent) {
    const it = { n: ref.n, k };
    if (ref.r) it.r = ref.r;
    if (ref.v) it.v = ref.v;
    if (ref.x) it.x = ref.x;
    if (ref.ops) it.ops = ref.ops;
    if (ref.note) it.note = ref.note;
    const inh = parent ? frameOf(parent) : [];
    if (inh.length) it.inherit = inh;
    return it;
  }

  /** Symbol maps that carry an item's text into the plot's frame of characters. */
  function frameOf(item) {
    const own = (item.ops || []).filter((o) => o[0] === "map");
    return own.concat(item.inherit || []);
  }

  /** Expand a group into concrete sequences of items (cross product over alternatives/letters). */
  function expandGroup(group, parent, cap = 12) {
    let seqs = [[]];
    for (const step of group) {
      const cands = [];
      for (const ref of step) {
        if (!C[ref.n]) continue;
        for (const k of keysFor(ref.n, ref.k)) cands.push(itemFromRef(ref, k, parent));
      }
      if (!cands.length) return [];
      const next = [];
      for (const s of seqs) for (const c of cands) if (next.length < cap) next.push(s.concat([c]));
      seqs = next;
    }
    return seqs.filter((s) => s.length);
  }

  /** All concrete options reachable from an item: "pre" (lead-ups), "post" (carry-ons), "inline". */
  function options(item, dir) {
    const e = entry(item.n, item.k);
    if (!e) return [];
    let groups;
    if (dir === "inline") groups = inlineGroups(item);
    else groups = dir === "pre" ? e.pre : e.post;
    const out = [];
    for (const g of groups) for (const seq of expandGroup(g, item)) out.push(seq);
    return out;
  }

  // ------------------------------------------------------------------ text
  /** An entry's tokens split at Cook's break marks, without an empty trailing part. */
  function partsOf(n, k) {
    const e = entry(n, k);
    if (!e) return [];
    const parts = [[]];
    for (const t of e.d) {
      if (t && typeof t === "object" && "S" in t) parts.push([]);
      else parts[parts.length - 1].push(t);
    }
    while (parts.length > 1 && !partHasText(parts[parts.length - 1])) parts.pop();
    return parts;
  }

  /** Indices of the parts an item uses (its break range, or all of them). */
  function usedParts(item) {
    let idx = partsOf(item.n, item.k).map((_, i) => i);
    if (item.r) {
      const want = idx.filter((i) => i >= item.r[0] && i < item.r[1]);
      if (want.length) idx = want;
    }
    return idx;
  }

  /** Split an entry's tokens into the parts and variants an item actually uses. */
  function selectParts(item) {
    const parts = partsOf(item.n, item.k);
    return usedParts(item).map((i) => splitVariants(parts[i], item.v));
  }

  function partHasText(tokens) {
    return tokens.some((t) => typeof t === "string" && t.trim());
  }

  function splitVariants(tokens, want) {
    const pre = [];
    let vars = [];
    let cur = null;
    for (const t of tokens) {
      if (t && typeof t === "object" && "V" in t) {
        cur = { n: t.V, toks: [] };
        vars.push(cur);
      } else (cur ? cur.toks : pre).push(t);
    }
    if (!vars.length) return { pre, vars: null };
    if (want && want.length) {
      const picked = vars.filter((x) => want.includes(x.n));
      if (picked.length) vars = picked;
    }
    return { pre, vars };
  }

  const plain = (tokens) => tokens.filter((t) => typeof t === "string").join("");
  // also mends a few slips in the source text: "X,,into", "seeks,to", a part that opens with "; "
  const tidy = (s) =>
    s
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?”])/g, "$1")
      .replace(/([“(])\s+/g, "$1")
      .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
      .replace(/,(?=[A-Za-z“])/g, ", ")
      .trim()
      .replace(/^[,;:]\s*/, "");
  const tidyVariant = (s) => tidy(s).replace(/(?:[,;:.]|\s+or)+$/i, "").trim();

  function variantCount(n, k) {
    const e = entry(n, k);
    return e ? e.d.filter((t) => t && typeof t === "object" && "V" in t).length : 0;
  }

  // segments: {t:"x", s, ins?} plain text  |  {t:"y", cur, orig, ins?} a character symbol
  function tokenize(str, original) {
    const out = [];
    let last = 0;
    for (const m of str.matchAll(SYMBOL_RE)) {
      if (m.index > last) out.push({ t: "x", s: str.slice(last, m.index) });
      out.push({ t: "y", cur: m[0], orig: original ? m[0] : null });
      last = m.index + m[0].length;
    }
    if (last < str.length) out.push({ t: "x", s: str.slice(last) });
    return out;
  }

  const segText = (g) => (g.t === "y" ? g.cur : g.s);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** Cook writes phrase changes without the commas of the text ("son SN" for "his son, SN,"),
   *  and now and then names a sibling symbol (D-A for D-B), so match loosely on both counts. */
  function phraseRegex(words, anySymbol) {
    const parts = words.map((w) => (anySymbol && isSymbol(w) ? "(?:" + SYMBOL_CORE + ")" : escRe(w)));
    return new RegExp("(?<![\\w’'\\-])" + parts.join("([\\s,]+)") + "(?![\\w\\-])", "g");
  }

  function replacePhrase(segs, from, to) {
    let str = "";
    const starts = segs.map((g) => {
      const at = str.length;
      str += segText(g);
      return at;
    });
    const fromWords = from.split(/\s+/);
    const toWords = to ? to.split(/\s+/) : [];
    let hits = [...str.matchAll(phraseRegex(fromWords, false))];
    if (!hits.length && fromWords.some(isSymbol)) hits = [...str.matchAll(phraseRegex(fromWords, true))];
    if (!hits.length) return segs;
    // keep the text's own separators when the change swaps word for word ("son, SN" -> "brother, A-3")
    const replacement = (h) =>
      toWords.length === fromWords.length ? toWords.map((w, i) => w + (h[i + 1] || "")).join("") : to;
    const out = [];
    const copy = (a, b) =>
      segs.forEach((g, i) => {
        const s0 = starts[i];
        const s1 = s0 + segText(g).length;
        const lo = Math.max(a, s0);
        const hi = Math.min(b, s1);
        if (lo >= hi) return;
        out.push(g.t === "y" ? g : { t: "x", s: g.s.slice(lo - s0, hi - s0), ins: g.ins });
      });
    let pos = 0;
    for (const h of hits) {
      copy(pos, h.index);
      for (const g of tokenize(replacement(h), false)) out.push(Object.assign(g, { ins: true }));
      pos = h.index + h[0].length;
    }
    copy(pos, str.length);
    return out;
  }

  /**
   * The part of a symbol change that is safe here. "ch A-6 to A" is written for a situation without
   * an A; where an A is already present, carrying it out would make two people one. Entries whose
   * target is someone already in the text (and not moving away in the same change) are left out, as
   * is a second entry onto a target already taken, so every character stays distinct.
   */
  function safeMap(segs, map) {
    const present = new Set(segs.filter((g) => g.t === "y").map((g) => g.cur));
    let keep = Object.entries(map).filter(([from]) => present.has(from));
    for (;;) {
      const moving = new Set(keep.map(([from]) => from));
      const targets = new Set();
      const next = keep.filter(([, to]) => (!present.has(to) || moving.has(to)) && !targets.has(to) && targets.add(to));
      if (next.length === keep.length) break;
      keep = next;
    }
    return Object.fromEntries(keep);
  }

  /** Apply an item's changes to all the texts it uses at once (its parts and options), so a change
   *  is judged safe or not against everyone in the situation. */
  function transform(strs, item) {
    let all = strs.map((s) => tokenize(s, true));
    const ops = (item.ops || []).concat(item.inherit || []);
    for (const op of ops) {
      if (op[0] === "map") {
        const map = safeMap(all.flat(), op[1]);
        for (const segs of all) for (const g of segs) if (g.t === "y" && Object.prototype.hasOwnProperty.call(map, g.cur)) g.cur = map[g.cur];
      } else if (op[0] === "ph") all = all.map((segs) => replacePhrase(segs, op[1], op[2]));
      else if (op[0] === "del") all = all.map((segs) => tidySegs(replacePhrase(segs, op[1], "")));
    }
    return all;
  }

  /** After a deletion, rejoin the plain text around the gap and close up stray spaces. */
  function tidySegs(segs) {
    const out = [];
    for (const g of segs) {
      const last = out[out.length - 1];
      if (g.t === "x" && last && last.t === "x" && !last.ins && !g.ins) last.s += g.s;
      else out.push(Object.assign({}, g));
    }
    for (const g of out) if (g.t === "x" && !g.ins) g.s = g.s.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1");
    return out;
  }

  // ------------------------------------------------------------------ pronouns
  const MALE_KIN = /^(?:F|BR|SN|U|NW|GF|SF)$/;
  const FEMALE_KIN = /^(?:M|SR|D|AU|NC|GM|SM)$/;

  /** "m", "f", or null for a child, a grandchild or an object. */
  function genderOf(sym) {
    const pre = /^([ab])(?=[A-Z])/.exec(sym);
    if (pre) return pre[1] === "a" ? "m" : "f";
    const s = sym.replace(/(?<=.)X$/, "");
    if (/^A(?:-\d)?$/.test(s)) return "m";
    if (/^B(?:-\d)?$/.test(s)) return "f";
    const [kin, of] = s.split("-");
    if (MALE_KIN.test(kin)) return "m";
    if (FEMALE_KIN.test(kin)) return "f";
    if (kin === "CN" && of) return of === "A" ? "m" : "f"; // Cook: CN-A a male cousin, CN-B a female one
    return null;
  }

  /**
   * A change such as "ch B to A-6" turns a woman into a man, but Cook's text keeps its pronouns.
   * When every character of one sex in a situation has changed sex, its pronouns of that sex
   * must be theirs, so they follow. Mixed cases are ambiguous and are left alone.
   */
  function genderFlips(segs) {
    const n = { m: [0, 0], f: [0, 0] }; // [kept, changed]
    for (const g of segs) {
      if (g.t !== "y" || !g.orig) continue;
      const was = genderOf(g.orig);
      const now = genderOf(g.cur);
      if (was && now) n[was][was === now ? 0 : 1]++;
    }
    return { m: n.m[1] > 0 && !n.m[0], f: n.f[1] > 0 && !n.f[0] };
  }

  // Words that follow an object pronoun ("tells her to", "lets her go") rather than a noun ("her lover").
  const AFTER_OBJECT = new Set(
    ("a an the to and or but nor in into on onto upon from with without for of by at as that this than so " +
      "away out up down back off over about after before when while if because until though although where " +
      "who whom which whose he she it they them his her him their is was be are were not never again also " +
      "too even only all both alone himself herself go come believe think promise marry leave stay die live " +
      "see know feel become understand realize forget appear").split(" ")
  );
  const SWAP = { she: "he", hers: "his", herself: "himself", he: "she", him: "her", himself: "herself" };

  function swapPronouns(segs, flips) {
    const words = [];
    if (flips.f) words.push("she", "her", "hers", "herself");
    if (flips.m) words.push("he", "his", "him", "himself");
    const re = new RegExp("\\b(?:" + words.join("|") + ")\\b", "gi");
    return segs.map((g, i) => {
      if (g.t !== "x") return g;
      const s = g.s.replace(re, (w, at) => {
        const lower = w.toLowerCase();
        let to = SWAP[lower];
        if (lower === "her" || lower === "his") {
          const rest = g.s.slice(at + w.length) + (segs[i + 1] ? segText(segs[i + 1]) : "");
          const next = (rest.match(/^\s+([A-Za-z][\w’'-]*)/) || [])[1];
          const noun = next && !AFTER_OBJECT.has(next.toLowerCase());
          to = lower === "her" ? (noun ? "his" : "him") : noun ? "her" : "hers";
        }
        return w[0] === w[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
      });
      return s === g.s ? g : Object.assign({}, g, { s });
    });
  }

  // ------------------------------------------------------------------ mirror
  /**
   * Cook writes A as a man and B as a woman, but his clauses suit either sex (Instruction Manual,
   * Lesson 1). A mirrored plot reverses the sex of every character at once, so every romance and
   * marriage stays as Cook wrote it (between a man and a woman) and every pronoun stays unambiguous.
   * Here are the words that change with it.
   */
  const SEX_PAIRS = [
    ["man", "woman"], ["men", "women"], ["boy", "girl"], ["boys", "girls"], ["husband", "wife"], ["husbands", "wives"],
    ["father", "mother"], ["fathers", "mothers"], ["son", "daughter"], ["sons", "daughters"], ["brother", "sister"],
    ["brothers", "sisters"], ["uncle", "aunt"], ["uncles", "aunts"], ["nephew", "niece"], ["nephews", "nieces"],
    ["grandfather", "grandmother"], ["stepfather", "stepmother"], ["grandson", "granddaughter"], ["stepson", "stepdaughter"],
    ["widower", "widow"], ["widowers", "widows"], ["bridegroom", "bride"], ["fiancé", "fiancée"], ["fiance", "fiancee"],
    ["gentleman", "lady"], ["gentlemen", "ladies"], ["actor", "actress"], ["hero", "heroine"], ["duke", "duchess"],
    ["lad", "lass"], ["male", "female"], ["masculine", "feminine"], ["manhood", "womanhood"], ["Mr", "Mrs"],
    ["manly", "womanly"], ["adventurer", "adventuress"], ["adventurers", "adventuresses"],
  ];
  const SEX_WORDS = {};
  for (const [m, f] of SEX_PAIRS) Object.assign(SEX_WORDS, { [m]: f, [f]: m });
  // One way only: words whose opposite Cook never uses.
  Object.assign(SEX_WORDS, {
    maid: "valet", maids: "valets", maiden: "bachelor", spinster: "bachelor", groom: "bride",
    coquette: "flirt", coquettes: "flirts", vamp: "seducer", goddess: "god", beau: "sweetheart",
  });
  const SEX_RE = new RegExp("\\b(?:" + Object.keys(SEX_WORDS).sort((a, b) => b.length - a.length).join("|") + ")\\b(?!-worship)", "gi");

  /** A phrase with its gendered words reversed: "Belinda’s father" → "Belinda’s mother". */
  function mirrorWords(str) {
    return str.replace(SEX_RE, (w) => {
      const to = SEX_WORDS[w] || SEX_WORDS[w.toLowerCase()];
      return w[0] === w[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
    });
  }

  function mirrorSegs(segs) {
    return swapPronouns(segs, { m: true, f: true }).map((g) => (g.t === "x" ? Object.assign({}, g, { s: mirrorWords(g.s) }) : g));
  }

  // Situations whose sexes are fixed: they turn on a woman's body, or on a word ("mistress") with no
  // fitting opposite. A plot that uses one keeps Cook's sexes.
  const FIXED_SEX = /pregnan|childbirth|unborn|bear him a (?:son|daughter|child)|with child|mistress/i;

  /**
   * The readable form of an item: [{pre: segs, vars: [{n, segs}] | null}] per part.
   * Inline references are dropped from the reading text (they become subplot seeds).
   */
  function render(item) {
    const chosen = selectParts(item);
    const texts = chosen.flatMap((p) => [tidy(plain(p.pre))].concat((p.vars || []).map((v) => tidyVariant(plain(v.toks)))));
    const segs = transform(texts, item);
    let at = 0;
    const parts = chosen.map((p) => ({
      pre: segs[at++],
      vars: p.vars && p.vars.map((v) => ({ n: v.n, segs: segs[at++] })),
    }));
    const flips = genderFlips(parts.flatMap((p) => p.pre.concat(...(p.vars || []).map((v) => v.segs))));
    if (flips.m || flips.f)
      for (const p of parts) {
        p.pre = swapPronouns(p.pre, flips);
        if (p.vars) for (const v of p.vars) v.segs = swapPronouns(v.segs, flips);
      }
    if (item.mirror)
      for (const p of parts) {
        p.pre = mirrorSegs(p.pre);
        if (p.vars) for (const v of p.vars) v.segs = mirrorSegs(v.segs);
      }
    return parts;
  }

  function segsToText(segs) {
    return segs.map(segText).join("");
  }

  /** Strip a pattern from the end of the last plain-text segment. */
  function trimEnd(segs, re) {
    const out = segs.slice();
    const last = out[out.length - 1];
    if (last && last.t === "x") out[out.length - 1] = Object.assign({}, last, { s: last.s.replace(re, "") });
    return out;
  }

  /** Join a variant onto the text before it: a new sentence gets a colon (or nothing after a full
   *  stop), a phrase runs on. Several open variants read "(1) … ; or (2) …". */
  function joinVariants(pre, vars) {
    const vs = vars.length > 1 ? vars.flatMap((v, i) => [{ t: "x", s: (i ? "; or " : "") + `(${i + 1}) ` }, ...v]) : vars[0];
    const stem = trimEnd(pre, /[:;,—-]\s*$/);
    const stemText = segsToText(stem).trim();
    if (!stemText) return vs;
    const sep = /[.!?]["”]?$/.test(stemText) ? " " : /^[A-Z“"(]/.test(segsToText(vs)) ? ": " : " ";
    return trimEnd(stem, /\s+$/).concat([{ t: "x", s: sep }], vs);
  }

  /** An item as one run of segments: Cook's "*" parts become consecutive sentences. */
  function textSegs(item) {
    const out = [];
    for (const p of render(item)) {
      let segs = p.vars ? joinVariants(p.pre, p.vars.map((v) => v.segs)) : p.pre;
      segs = trimEnd(segs, /[.;,:]\s*$/);
      if (!segsToText(segs).trim()) continue;
      if (out.length) out.push({ t: "x", s: ". " });
      out.push(...segs);
    }
    if (out.length && !/[.!?]["”’]?$/.test(segsToText(out))) out.push({ t: "x", s: "." });
    return out;
  }

  /** Plain text of an item. */
  const text = (item) => segsToText(textSegs(item));

  function symbolsIn(item) {
    const out = new Set();
    for (const p of render(item)) {
      const all = p.pre.concat(...(p.vars || []).map((v) => v.segs));
      for (const g of all) if (g.t === "y") out.add(g.cur);
    }
    for (const op of item.ops || []) if (op[0] === "add") out.add(op[1]);
    return out;
  }

  /** Inline references inside the parts/variants this item uses. */
  function inlineGroups(item) {
    const groups = [];
    for (const p of selectParts(item)) {
      const toks = p.pre.concat(...(p.vars || []).map((v) => v.toks));
      for (const t of toks) if (t && typeof t === "object" && "L" in t) groups.push(t.L);
    }
    return groups;
  }

  /** Cook's own label: 1461a ch A to B, 2f *-**, 259-1 */
  function label(item) {
    let s = String(item.n) + (item.k || "");
    if (item.v) s += "-" + item.v.join("-");
    if (item.r) s += " " + "*".repeat(item.r[0]) + "-" + "*".repeat(item.r[1]);
    if (item.x) s += " " + item.x;
    else if (item.note) s += ", " + item.note;
    return s;
  }

  const sameEntry = (a, b) => a.n === b.n && (a.k || "") === (b.k || "");
  const keyOf = (it) => it.n + (it.k || "");

  // ------------------------------------------------------------------ masterplot
  const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  const clausesOf = (set, ns) => list(ns).map((n) => set.find((x) => x.n === n)).filter(Boolean);

  /** The masterplot as Cook reads it, one sentence. A compound masterplot (the Instruction Manual,
   *  Lesson 1) lists its A clauses with commas and joins its B and C clauses with "and". */
  function masterplotSentence(a, b, c) {
    const As = clausesOf(P.A, a).map((x, i) => (i ? x.t.replace(/^An? /, (m) => m.toLowerCase()) : x.t));
    const Bs = clausesOf(P.B, b).map((x) => lcFirst(x.t));
    const Cs = clausesOf(P.C, c).map((x) => lcFirst(x.t));
    return [As.join(", "), Bs.join(", and "), Cs.join(", and ")].filter(Boolean).join(", ") + ".";
  }

  // ------------------------------------------------------------------ endings (Classification marks)
  const marksOf = (n, k) => (entry(n, k) || {}).t || [];
  /** The C clauses an ending may satisfy. Cook marks nothing with (15), "meets any fate", since any ending fits it. */
  const wanted = (cs) => (list(cs).includes(15) ? P.C.map((x) => x.n) : list(cs));

  /** C clauses under which an item, as used, can end a story: Cook's marks on its last part. */
  function endsUnder(item) {
    const idx = usedParts(item);
    const m = idx.length && marksOf(item.n, item.k).find(([p]) => p === idx[idx.length - 1]);
    return m ? m[1] : [];
  }

  /** The item, cut short if need be, so that it ends on a part Cook marks for one of these clauses. */
  function cutToEnding(item, cs) {
    const want = wanted(cs);
    const idx = usedParts(item);
    const marks = marksOf(item.n, item.k);
    for (let j = idx.length - 1; j >= 0; j--) {
      const m = marks.find(([p]) => p === idx[j]);
      if (m && m[1].some((c) => want.includes(c)))
        return j === idx.length - 1 ? item : Object.assign({}, item, { r: [idx[0], idx[j] + 1] });
    }
    return null;
  }

  /** Every part of every conflict, as an item, with its cast and ending marks: the material of
   *  Cook's Classification by Character Symbols, computed from the clean text. */
  let partIndex = null;
  function allParts() {
    if (partIndex) return partIndex;
    partIndex = [];
    for (const e of allEntries) {
      const count = partsOf(e.n, e.k).length;
      const marks = marksOf(e.n, e.k);
      for (let p = 0; p < count; p++) {
        const item = count > 1 ? { n: e.n, k: e.k, r: [p, p + 1] } : { n: e.n, k: e.k };
        const m = marks.find(([q]) => q === p);
        partIndex.push({ item, cast: symbolsIn(item), ends: m ? m[1] : [] });
      }
    }
    return partIndex;
  }

  /** How much a symbol matters to a situation, for Cook's "drop one of the lesser symbols". */
  function importance(s) {
    const b = s.replace(/^[ab](?=[A-Z])/, "");
    if (b === "A" || b === "B") return 0;
    if (/^[AB]-3$/.test(b)) return 1; //                                rival
    if (/^[AB]-2$/.test(b)) return 2; //                                friend
    if (/-[AB]$/.test(b) || /^(SN|D|BR|SR|CN|U|NW|NC|GCH)$/.test(b)) return 3; // family
    if (/^[AB]-[569]X?$/.test(b)) return 4; //                         criminal, officer, superior
    if (/^[AB]-[47]X?$/.test(b) || /CH/.test(b)) return 5; //           stranger, inferior, child
    if (/^(AX|BX|[AB]X)$/.test(b)) return 6; //                         mysterious persons
    if (/^[AB]-8X?$/.test(b)) return 7; //                             utility
    return 8; //                                                       objects and the rest
  }
  const castOrder = (syms) => [...syms].sort((x, y) => importance(x) - importance(y) || x.localeCompare(y));
  const castKey = (syms) => [...syms].sort().join(",");

  /** Cook's way of writing a cast: "A", "A & B", "A, B & A-3". */
  function castLabel(syms) {
    const s = castOrder(syms);
    return s.length < 2 ? s.join("") : s.slice(0, -1).join(", ") + " & " + s[s.length - 1];
  }

  /**
   * The Instruction Manual's way to find your own lead-ups and carry-ons (Lesson 5): take the
   * character symbols of the situation you are studying, look for that combination in the
   * Classification, and if it yields too little, drop one of the lesser symbols at a time until
   * only A, B or A and B remain.  Returns [{cast, items}] from the full combination down.
   */
  function sameCast(symbols, used, enough = 12) {
    const order = castOrder(symbols);
    const out = [];
    let found = 0;
    for (let n = order.length; n >= 1 && found < enough; n--) {
      const level = order.slice(0, n);
      const key = castKey(level);
      const items = allParts()
        .filter((x) => castKey(x.cast) === key && !(used && used.has(keyOf(x.item))))
        .map((x) => x.item);
      if (items.length) {
        out.push({ cast: level, items });
        found += items.length;
      }
      if (level.every((s) => s === "A" || s === "B")) break;
    }
    return out;
  }

  function plotCast(plot) {
    const syms = new Set();
    for (const it of plot.main) symbolsIn(it).forEach((s) => syms.add(s));
    for (const sub of plot.subs || []) for (const it of sub.items) symbolsIn(it).forEach((s) => syms.add(s));
    return syms;
  }

  // ------------------------------------------------------------------ names
  // Working names, so the plot reads as a story. A's name starts with A and B's with B, after Cook's
  // symbols. Every list has as many women's names as men's; which one a character draws from depends
  // on the sex the plot gives them (see mirror below).
  const NAMES = {
    A: {
      m: (
        "Abel Abner Adrian Albert Alden Alexander Alfred Alistair Allan Alonzo Alvin Ambrose Amos Andrew " +
        "Angus Anson Anthony Archer Archibald Armand Arnold Arthur Asher Atticus Aubrey August Austin Axel " +
        "Aldous Ansel"
      ).split(" "),
      f: (
        "Abigail Ada Adelaide Adele Agatha Agnes Alberta Alexandra Alice Allegra Alma Althea Amanda Amelia " +
        "Amy Anastasia Angela Angelica Anna Annabel Annette Antonia Arabella Ariadne Astrid Audrey Augusta " +
        "Aurora Ava Avis"
      ).split(" "),
    },
    B: {
      f: (
        "Babette Barbara Beatrice Belinda Bella Belle Benita Berenice Bernadette Bertha Beryl Bess Bethany " +
        "Bettina Beulah Beverly Bianca Billie Birdie Blanche Blossom Blythe Bonnie Brenda Bridget Brigitte " +
        "Briony Bronwen Brooke Benedetta"
      ).split(" "),
      m: (
        "Baldwin Barclay Barnaby Barrett Bartholomew Barton Basil Baxter Beau Benedict Benjamin Bennett " +
        "Benson Bernard Bertram Blaine Boris Boyd Bradley Brandon Brendan Brett Brian Brock Bruce Bruno Buck " +
        "Burgess Burton Byron"
      ).split(" "),
    },
    m: (
      "Calvin Cedric Charles Clement Clifford Conrad Cornelius Cyril Damian Daniel Desmond Dexter Dominic " +
      "Douglas Duncan Edgar Edmund Edwin Elias Elliot Emmett Ernest Everett Ezra Felix Fergus Floyd Francis " +
      "Frank Frederick Garrett George Gideon Gilbert Gordon Graham Gregory Hamish Harold Hector Henry " +
      "Herbert Horace Howard Hugh Irving Isaac Ivan Jacob James Jasper Jerome Joel Jonas Joseph Jude Julian " +
      "Kenneth Lars Laurence Leon Leonard Lewis Lionel Lucas Luther Malcolm Marcus Martin Milton Morris " +
      "Nathan Nelson Neville Nicholas Norman Oscar Otto Owen Patrick Percy Philip Quentin Ralph Raymond " +
      "Reuben Roderick Roger Roland Rupert Russell Samuel Sebastian Seth Silas Simon Stanley Theodore " +
      "Thomas Tobias Vernon Victor Vincent Wallace Walter Warren Wesley Wilfred Xavier Zachary"
    ).split(" "),
    f: (
      "Camille Caroline Cecily Celia Charlotte Clara Constance Cora Daisy Daphne Delia Diana Dinah Dorothy " +
      "Edith Edna Effie Elaine Eleanor Eliza Elsie Emma Estelle Esther Ethel Eva Evelyn Faith Fanny Flora " +
      "Florence Frances Georgia Geraldine Gertrude Gloria Grace Gwen Hannah Harriet Hazel Helen Henrietta " +
      "Hester Hilda Ida Imogen Ingrid Irene Iris Isabel Ivy Jane Janet Josephine Judith Julia June Kate " +
      "Kathleen Laura Leonora Lillian Lois Louisa Lucy Lydia Mabel Mae Marian Margaret Martha Maud Mildred " +
      "Minnie Miriam Myra Nadine Nell Nora Olive Opal Pearl Phoebe Priscilla Rachel Rhoda Rosalind Rose " +
      "Ruth Sadie Sarah Selma Sophia Stella Susan Sylvia Tess Theodora Ursula Valerie Vera Violet Wanda " +
      "Winifred Yvonne Zelda Lorna Marguerite Odette"
    ).split(" "),
    n: (
      "Casey Corey Dana Drew Ellis Hollis Jamie Jody Jordan Kelly Kit Lee Leslie Marion Morgan Quinn Reese " +
      "Remy Riley Robin Rowan Sandy Sasha Shannon Sidney Terry"
    ).split(" "),
  };
  /** Symbols that stand for things rather than people keep their letter. */
  const isObject = (sym) => /^X(?:-\d)?$/.test(sym);

  /** Whose story it is. Cook's clauses suit a protagonist of either sex (Instruction Manual, Lesson 1),
   *  so the protagonist is A unless the central situation is about B alone. */
  function protagonistOf(plot) {
    const central = plot.main[plot.central];
    const cast = central ? symbolsIn(central) : new Set();
    if (cast.has("A")) return "A";
    if (cast.has("B")) return "B";
    const count = (s) => plot.main.filter((it) => symbolsIn(it).has(s)).length;
    return count("B") > count("A") ? "B" : "A";
  }

  /** "m", "f" or null: a character's sex in this plot. */
  function sexOf(sym, plot) {
    const g = genderOf(sym);
    return g && plot && plot.mirror ? (g === "m" ? "f" : "m") : g;
  }

  const plotItems = (plot) => plot.main.concat(...(plot.subs || []).map((s) => s.items));

  /** True when no situation in the plot fixes a character's sex. */
  const canMirror = (plot) => plotItems(plot).every((it) => !FIXED_SEX.test(text(it)));

  function nameCast(plot) {
    const names = Object.assign({}, plot.names);
    const taken = new Set(Object.values(names));
    const initials = new Set([...taken].map((n) => n[0]));
    // The protagonist is named even when the situations never mention them: the masterplot is about them.
    const order = castOrder(new Set([...plotCast(plot), plot.lead || protagonistOf(plot)])).filter((s) => !isObject(s) && !names[s]);
    for (const sym of order) {
      const sex = sexOf(sym, plot) || "n";
      const pool = sym === "A" || sym === "B" ? NAMES[sym][sex] : NAMES[sex];
      const free = pool.filter((n) => !taken.has(n));
      const fresh = free.filter((n) => !initials.has(n[0]));
      const name = pick(fresh.length ? fresh : free.length ? free : pool);
      names[sym] = name;
      taken.add(name);
      initials.add(name[0]);
    }
    return names;
  }

  /**
   * Situations Cook marks as possible endings under the plot's C clause(s), best fit first:
   * reachable from the last situation by Cook's own carry-ons, then those whose characters are
   * already in the story, then those from the central situation's sub-group.
   */
  function endingsFor(plot, used) {
    const want = wanted(plot.c);
    const have = plotCast(plot);
    const last = plot.main[plot.main.length - 1];
    const linked = new Set(last ? options(last, "post").map((s) => keyOf(s[s.length - 1])) : []);
    const central = plot.main[plot.central];
    const home = central && conflict(central.n);
    return allParts()
      .filter((x) => x.ends.some((c) => want.includes(c)) && !(used && used.has(keyOf(x.item))))
      .map((x) => {
        const cast = [...x.cast];
        const c = conflict(x.item.n);
        let score = cast.length ? cast.filter((s) => have.has(s)).length / cast.length : 0;
        if (!cast.some((s) => s === "A" || s === "B")) score -= 0.5;
        if (home && c.s === home.s && c.g === home.g) score += 0.25;
        else if (home && c.g === home.g) score += 0.1;
        if (linked.has(keyOf(x.item))) score += 1;
        return { item: x.item, score, ends: x.ends.filter((n) => want.includes(n)) };
      })
      .sort((p, q) => q.score - p.score);
  }

  /** True when the plot's last situation is one Cook marks as an ending for its C clause(s). */
  function endsWell(plot) {
    const last = plot.main[plot.main.length - 1];
    return !!last && endsUnder(last).some((c) => wanted(plot.c).includes(c));
  }

  // ------------------------------------------------------------------ search
  let searchIndex = null;
  function search(query, within) {
    if (!searchIndex) searchIndex = allEntries.map((e) => ({ e, s: (keyOf(e) + " " + text(e)).toLowerCase() }));
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const allowed = within ? new Set(within.map(keyOf)) : null;
    return searchIndex
      .filter((x) => (!allowed || allowed.has(keyOf(x.e))) && words.every((w) => x.s.includes(w)))
      .map((x) => x.e);
  }

  // ------------------------------------------------------------------ random plots
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];
  const between = ([lo, hi]) => lo + rand(hi - lo + 1);

  /** Story forms from Cook's introduction. A short story is his three conflicts: the main one, the one
   *  leading up to it and the one terminating it (two, when the main one is itself terminal). A
   *  novelette is a longer main line whose purpose takes in one subordinate purpose: one subplot.
   *  The generator picks the form itself. */
  const FORMS = {
    short: { label: "Short story", lead: [1, 1], carry: [0, 0], subs: [0, 0], subLen: [0, 0], hops: 1 },
    novelette: { label: "Novelette", lead: [1, 2], carry: [1, 2], subs: [1, 1], subLen: [2, 2], hops: 2 },
  };

  function withRandomVariant(item) {
    const count = variantCount(item.n, item.k);
    if (count > 1 && !item.v) item.v = [1 + rand(count)];
    return item;
  }

  const isFresh = (used) => (seq) => seq.every((it) => !used.has(keyOf(it)));

  /** Pick one of Cook's printed continuations that avoids repeats and, where possible, dead ends. */
  function choose(seqs, used, dir) {
    const fresh = seqs.filter(isFresh(used));
    if (!fresh.length) return null;
    const lively = fresh.filter((s) => options(s[dir === "pre" ? 0 : s.length - 1], dir).length);
    return pick(lively.length ? lively : fresh).map(withRandomVariant);
  }

  /** When Cook prints nothing more, find "your own" reference (Instruction Manual, Lesson 5): a
   *  situation with the same characters, from the Classification by Character Symbols. */
  function byCast(anchor, used) {
    const groups = sameCast([...symbolsIn(anchor)], used);
    if (!groups.length) return null;
    return [Object.assign(withRandomVariant(Object.assign({}, pick(groups[0].items))), { src: "cast" })];
  }

  /** The next situation backward ("pre") or forward ("post"): Cook's printed reference first, then Lesson 5. */
  function next(anchor, dir, used) {
    return choose(options(anchor, dir), used, dir) || byCast(anchor, used);
  }

  function randomPlot(formKey) {
    const key = FORMS[formKey] ? formKey : pick(Object.keys(FORMS));
    const form = FORMS[key];
    const plot = { form: key, a: pick(P.A).n, b: pick(P.B).n, c: pick(P.C).n, main: [], central: 0, subs: [] };
    const used = new Set();
    const take = (seq) => (seq && seq.forEach((it) => used.add(keyOf(it))), seq);
    const central = withRandomVariant(Object.assign({}, pick(entriesForB(plot.b))));
    plot.main.push(take([central])[0]);

    for (let i = between(form.lead); i > 0; i--) {
      const seq = take(next(plot.main[0], "pre", used));
      if (!seq) break;
      plot.main.unshift(...seq);
      plot.central += seq.length;
    }
    for (let i = between(form.carry); i > 0; i--) {
      const seq = take(next(plot.main[plot.main.length - 1], "post", used));
      if (!seq) break;
      plot.main.push(...seq);
    }
    closeOnEnding(plot, used, form.hops);

    for (let s = between(form.subs); s > 0; s--) {
      const branch = randomBranch(plot, used);
      if (!branch) break;
      const sub = { at: branch.at, via: branch.via, items: take(branch.seq) };
      for (let i = between(form.subLen) - sub.items.length; i > 0; i--) {
        const seq = take(next(sub.items[sub.items.length - 1], "post", used));
        if (!seq) break;
        sub.items.push(...seq);
      }
      plot.subs.push(sub);
    }
    plot.subs.sort((x, y) => x.at - y.at);
    plot.lead = protagonistOf(plot);
    // Half of all plots are told with the sexes reversed, unless a situation fixes them.
    if (canMirror(plot) && Math.random() < 0.5) {
      plot.mirror = true;
      for (const it of plotItems(plot)) it.mirror = true;
    }
    plot.names = nameCast(plot);
    return plot;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Let the main line terminate as the C clause says, keeping to Cook's printed links where he allows:
   *  1. one of his carry-ons that he marks as an ending for the C clause (cut at the marked part);
   *  2. in a novelette, one carry-on more and then such an ending;
   *  3. one of his carry-ons that he marks as an ending for another C clause, which then becomes the
   *     plot's C clause (Lesson 5: "you may change the C clause for a better finale");
   *  4. his Classification note: scan the book for a marked ending that fits, best fit first.
   */
  function closeOnEnding(plot, used, hops) {
    if (endsWell(plot)) return;
    const last = plot.main[plot.main.length - 1];
    const carryOns = (from) => options(from, "post").filter(isFresh(used));
    const endingsAfter = (from, cs) =>
      carryOns(from)
        .map((seq) => {
          const cut = cutToEnding(seq[seq.length - 1], cs);
          return cut && seq.slice(0, -1).concat([cut]);
        })
        .filter(Boolean);
    const anyOf = (seqs) => (seqs.length ? pick(seqs) : null);

    let seq = anyOf(endingsAfter(last, plot.c));
    if (!seq && hops > 1) {
      const two = [];
      for (const first of carryOns(last)) {
        const mid = new Set(first.map(keyOf));
        for (const end of endingsAfter(first[first.length - 1], plot.c)) if (end.every((it) => !mid.has(keyOf(it)))) two.push(first.concat(end));
      }
      seq = anyOf(two);
    }
    if (!seq) {
      seq = anyOf(endingsAfter(last, P.C.map((x) => x.n)));
      if (seq) {
        plot.cFrom = plot.c;
        plot.c = pick(endsUnder(seq[seq.length - 1]));
      }
    }
    if (!seq) {
      // Ties are shuffled so that the scan does not favour the front of the book.
      const fits = shuffle(endingsFor(plot, used)).sort((p, q) => q.score - p.score).slice(0, 8);
      if (fits.length) seq = [Object.assign({}, pick(fits).item, { src: "scan" })];
    }
    if (!seq) return;
    seq = seq.map(withRandomVariant);
    seq.forEach((it) => used.add(keyOf(it)));
    plot.main.push(...seq);
  }

  /** Every unused way to branch a subplot off the main line. */
  function branchPoints(plot, used) {
    const out = [];
    plot.main.forEach((it, at) => {
      for (const via of ["inline", "pre", "post"])
        for (const seq of options(it, via))
          if (seq.every((x) => !used.has(keyOf(x)))) out.push({ at, via, seq });
    });
    return out;
  }

  function randomBranch(plot, used) {
    const all = branchPoints(plot, used);
    if (!all.length) return null;
    const taken = new Set(plot.subs.map((s) => s.at));
    const inline = all.filter((b) => b.via === "inline" && !taken.has(b.at));
    const spread = all.filter((b) => !taken.has(b.at));
    const pool = inline.length && Math.random() < 0.6 ? inline : spread.length ? spread : all;
    const b = pick(pool);
    b.seq = b.seq.map(withRandomVariant);
    return b;
  }

  // ------------------------------------------------------------------ cast and plain text
  function cast(plot) {
    const syms = plotCast(plot);
    const order = (s) => {
      const base = s.replace(/^[ab]/, "");
      const i = ["A", "B"].indexOf(base);
      if (i >= 0) return "0" + i;
      return (/^[AB]-\d/.test(base) ? "1" : /-[AB]$/.test(base) ? "2" : "3") + base;
    };
    return [...syms]
      .map((s) => ({ s, m: symbolMeaning(s) && (plot.mirror ? mirrorWords(symbolMeaning(s)) : symbolMeaning(s)) }))
      .filter((x) => x.m)
      .sort((x, y) => order(x.s).localeCompare(order(y.s)));
  }

  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const VIA = { inline: "Detail of step", pre: "Leads into step", post: "Follows from step", search: "Joins step" };

  function plotToText(plot) {
    const lines = [];
    const form = FORMS[plot.form];
    lines.push("PLOTTO" + (form ? ` · ${form.label}` : ""));
    lines.push("");
    const compound = list(plot.a).length > 1 || list(plot.b).length > 1 || list(plot.c).length > 1;
    lines.push((compound ? "Compound masterplot: " : "Masterplot: ") + masterplotSentence(plot.a, plot.b, plot.c));
    for (const A of clausesOf(P.A, plot.a)) lines.push(`  A ${A.n}. ${A.t}`);
    for (const B of clausesOf(P.B, plot.b)) lines.push(`  B (${B.n}) ${B.t}`);
    for (const Cc of clausesOf(P.C, plot.c)) lines.push(`  C (${Cc.n}) ${Cc.t}`);
    if ((plot.lead || protagonistOf(plot)) === "B") lines.push("  (The protagonist is B: Cook's clauses suit either sex.)");
    if (plot.mirror) lines.push("  (Sexes reversed from Cook's text, as his clauses allow: here A is a woman and B a man.)");
    if (plot.cFrom) {
      const was = clausesOf(P.C, plot.cFrom)[0];
      lines.push(`  (C clause changed from (${plot.cFrom}) ${was ? was.t : ""} to give a finale Cook links to the plot; Instruction Manual, Lesson 5)`);
    }
    lines.push("");
    lines.push("Main plot (in story order):");
    const ending = endsWell(plot) ? plot.main.length - 1 : -1;
    plot.main.forEach((it, i) => {
      const notes = [];
      if (i === plot.central) notes.push("central situation");
      if (i === ending) notes.push(`ending, C (${endsUnder(it).filter((c) => wanted(plot.c).includes(c)).join(", ")})`);
      if (it.src === "cast") notes.push("same characters, found in the Classification");
      if (it.src === "scan") notes.push("ending found in the Classification");
      lines.push(`${i + 1}. [${label(it)}]${notes.length ? ` [${notes.join("; ")}]` : ""} ${text(it)}`);
    });
    if (plot.subs.length) {
      lines.push("");
      lines.push("Subplots:");
      plot.subs.forEach((sub, j) => {
        lines.push(`${ROMAN[j] || j + 1}. ${VIA[sub.via] || "Branches from step"} ${sub.at + 1}:`);
        sub.items.forEach((it, i) => lines.push(`   ${String.fromCharCode(97 + i)}. [${label(it)}]${it.src === "cast" ? " [same characters, found in the Classification]" : ""} ${text(it)}`));
      });
    }
    const people = cast(plot);
    if (people.length) {
      lines.push("");
      lines.push("Cast (Plotto symbols, with working names):");
      const names = plot.names || {};
      for (const p of people) lines.push(`  ${p.s}: ${p.m}${names[p.s] ? ` (${names[p.s]})` : ""}`);
    }
    return lines.join("\n");
  }

  global.Plotto = {
    data: P,
    FORMS,
    ROMAN,
    VIA,
    conflict,
    entry,
    entriesForB,
    allEntries,
    options,
    branchPoints,
    expandGroup,
    render,
    text,
    textSegs,
    label,
    genderOf,
    nameCast,
    protagonistOf,
    sexOf,
    mirrorWords,
    isObject,
    variantCount,
    symbolMeaning,
    keyOf,
    sameEntry,
    masterplotSentence,
    list,
    wanted,
    castOf: symbolsIn,
    endsUnder,
    endsWell,
    endingsFor,
    sameCast,
    castLabel,
    plotCast,
    search,
    randomPlot,
    withRandomVariant,
    cast,
    plotToText,
    pick,
  };
})(window);
