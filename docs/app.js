/* Plotto site: one button makes every one of Cook's decisions (masterplot, central situation, lead-ups,
 * carry-ons, ending, subplots) and names the characters; the plot prints as a story on a timeline;
 * a second screen hands it to an AI writer. */
(function () {
  "use strict";
  const E = window.Plotto;
  const P = E.data;
  const CONFIG = window.PLOTTO_CONFIG || {}; // config.js: the public writer's address and the newsletter
  const $ = (id) => document.getElementById(id);
  const list = E.list;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs)
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    for (const kid of kids.flat(Infinity))
      if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }

  // Per-viewer convenience only: the page works the same without it. Bump the prefix if the data shape changes.
  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem("plotto2:" + k));
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("plotto2:" + k, JSON.stringify(v));
      } catch (e) {
        /* ignore */
      }
    },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  const clausesOf = (set, ns) => list(ns).map((n) => set.find((x) => x.n === n)).filter(Boolean);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
      return;
    } catch (e) {
      /* fall through */
    }
    const ta = h("textarea", { style: "position:fixed;left:-9999px;top:0", "aria-hidden": "true" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    ta.remove();
    toast(ok ? "Copied" : "Copying is blocked here. Select the text and copy it yourself.");
  }

  // ------------------------------------------------------------------ characters
  const KIN = { F: "father", M: "mother", BR: "brother", SR: "sister", SN: "son", D: "daughter", U: "uncle", AU: "aunt", CN: "cousin", NW: "nephew", NC: "niece", GF: "grandfather", GM: "grandmother", SF: "stepfather", SM: "stepmother", GCH: "grandchild" };
  // Words that show the text already says who someone is ("his friend, A-2"), so no introduction is needed.
  const KNOWN_BY = { 2: ["friend"], 3: ["rival", "enemy"], 4: ["stranger"], 5: ["criminal", "crook", "thief", "outlaw"], 6: ["officer", "police", "detective", "sheriff"], 7: ["employee", "servant", "secretary", "clerk", "butler", "maid", "valet"], 9: ["employer", "superior", "chief", "master"] };
  const article = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;

  /** Who a symbol is, in plain words: "Arthur’s rival", "a stranger". keys: words that already identify them.
   *  Roles are worked out in Cook's sexes, then reversed for a mirrored plot ("Belinda’s father" → "Belinda’s mother"). */
  function person(sym, plot) {
    const names = plot.names || {};
    const lead = plot.lead;
    const own = (who) => (names[who] || who) + "’s";
    const g = E.genderOf(sym);
    const mysterious = /^[AB]X$/.test(sym) || /(?<=\d)X$/.test(sym);
    const s = sym.replace(/^[ab](?=[A-Z])/, "").replace(/(?<=.)X$/, "");
    let role = null;
    let keys = [];
    let m;
    if (/^[AB]X$/.test(sym)) {
      role = `a mysterious ${g === "m" ? "man" : "woman"}`;
      keys = ["mysterious"];
    } else if (s === "A" || s === "B") role = s === (lead || "A") ? "the protagonist" : s === "A" ? "the hero" : "the heroine";
    else if ((m = s.match(/^([AB])-(\d)$/))) {
      const k = +m[2];
      const man = g === "f" ? "woman" : "man";
      role = { 2: `${own(m[1])} friend`, 3: `${own(m[1])} rival`, 4: "a stranger", 5: "a criminal", 6: "an officer of the law", 7: "an employee", 8: `another ${man}`, 9: `a ${man} in authority` }[k];
      keys = KNOWN_BY[k] || [];
    } else if ((m = s.match(/^([A-Z]+)-([AB])$/)) && KIN[m[1]]) {
      role = `${own(m[2])} ${KIN[m[1]]}`;
      keys = [KIN[m[1]]];
    } else if (KIN[s]) {
      role = article(KIN[s]);
      keys = [KIN[s]];
    } else if (/^CH(?:-\d)?$/.test(s)) {
      role = "a child";
      keys = ["child"];
    } else role = E.symbolMeaning(sym) || "a character";
    if (mysterious && !/^[AB]X$/.test(sym)) role = /^an? /.test(role) ? "a mysterious " + role.replace(/^an? /, "") : role.replace(/’s /, "’s mysterious ");
    // Another man / woman says nothing new as an introduction.
    const introduce = !/^(?:the protagonist|the hero|the heroine|another )/.test(role);
    if (plot.mirror) return { role: E.mirrorWords(role), keys: keys.map(E.mirrorWords), introduce };
    return { role, keys, introduce };
  }

  function castOf(plot) {
    const names = plot.names || {};
    return E.cast(plot)
      .filter((p) => names[p.s] || E.isObject(p.s))
      .map((p) => ({ sym: p.s, name: names[p.s] || p.s, role: E.isObject(p.s) ? "an object of mystery" : person(p.s, plot).role }))
      .sort((x, y) => (y.sym === plot.lead) - (x.sym === plot.lead));
  }

  // ------------------------------------------------------------------ the story text
  /**
   * The order in which a reader meets the situations: each subplot sits beside the step it branches
   * from (before it, when the subplot leads into that step). Phases name each step's part in the plot.
   */
  function beats(plot) {
    const last = plot.main.length - 1;
    const ends = E.endsWell(plot);
    const out = [];
    let roman = 0;
    const sub = (s) => out.push({ sub: s, num: E.ROMAN[roman++] || String(roman) });
    plot.main.forEach((item, i) => {
      plot.subs.filter((s) => s.at === i && s.via === "pre").forEach(sub);
      let phase = "development";
      if (i < plot.central) phase = i === 0 ? "beginning" : "leadup";
      else if (i === plot.central) phase = "central";
      else if (i === last && ends) phase = "ending";
      out.push({ item, phase, i, ending: i === last && ends });
      plot.subs.filter((s) => s.at === i && s.via !== "pre").forEach(sub);
    });
    return out;
  }

  const PHASE = { beginning: "Beginning", leadup: "Lead-up", central: "Central situation", development: "Development", ending: "Ending" };
  const LEADS = {
    beginning: ["As the story opens, "],
    leadup: ["Then ", "Before long, ", "Soon ", "In time, "],
    central: ["At the heart of the story, "],
    development: ["After that, ", "Then ", "Things take a turn when ", "Before long, ", "Soon after, "],
    ending: ["In the end, "],
    pre: ["Some time before, "],
    post: ["Meanwhile, "],
    inline: ["Meanwhile, "],
    subnext: ["Then ", "In time, ", "Before long, "],
  };
  const VIA = { pre: "Leads into the next situation", post: "Branches off the situation above", inline: "Grows from a detail above" };
  // A sentence may take a lead-in when it opens with a character or with one of these words.
  const OPENERS = /^(?:The|A|An|His|Her|Their|Its|One|Two|Both|Each|Every|Some|In|On|At|While|When|After|Before|During|Through|Though|Although|If|Because|For|With|Without|By|From|Under|Upon|Unknown|Having|Being|Believing|Learning|Seeking|Discovering|Finding|Fearing|Hoping|Desiring|Thinking)\b/;

  /** Thread: the sub-group Cook files the conflict under ("Revenge", "Love’s Rejection"). */
  const threadOf = (item) => {
    const c = E.conflict(item.n);
    return c ? c.s || c.g : "";
  };

  /** One situation as a paragraph: names in place of symbols, each person introduced the first time we meet them. */
  function paragraph(item, lead, plot, met) {
    const names = plot.names || {};
    let segs = E.textSegs(item);
    const first = segs[0];
    if (lead && first) {
      if (first.t === "y") segs = [{ t: "x", s: lead }].concat(segs);
      else if (OPENERS.test(first.s)) segs = [{ t: "x", s: lead + lcFirst(first.s.replace(/^A /, "a ")) }].concat(segs.slice(1));
    }
    const nodes = [];
    segs.forEach((g, i) => {
      if (g.t === "x") return nodes.push(g.s);
      if (E.isObject(g.cur) || !names[g.cur]) return nodes.push(h("span", { class: "obj", title: "an object of mystery" }, g.cur));
      const who = person(g.cur, plot);
      nodes.push(h("span", { class: "who", title: who.role }, names[g.cur]));
      if (met.has(g.cur)) return;
      const before = segs.slice(Math.max(0, i - 3), i).map((x) => (x.t === "x" ? x.s : names[x.cur] || x.cur)).join("").slice(-48).toLowerCase();
      const after = segs[i + 1] && segs[i + 1].t === "x" ? segs[i + 1].s : "";
      if (/^[’']s\b/.test(after)) return; // a possessive: introduce them next time
      met.add(g.cur);
      if (!who.introduce || /^\s*,/.test(after) || who.keys.some((k) => before.includes(k))) return;
      const closes = !after || /^[\s]*[.,;:!?)—]/.test(after);
      nodes.push(h("span", { class: "appos" }, `, ${who.role}${closes ? "" : ","}`));
    });
    return h("p", { class: "beat-text" }, nodes);
  }

  function beatNode(cls, head, text, i) {
    return h("li", { class: cls, style: `--i:${i}` }, h("span", { class: "node", "aria-hidden": "true" }), h("div", null, head, text));
  }

  /** The story as a timeline: the main line down a spine, each subplot in a lane beside it. */
  function storyList(plot) {
    const met = new Set(["A", "B"]);
    const count = {};
    const leadFor = (key) => {
      const options = LEADS[key];
      count[key] = (count[key] || 0) + 1;
      return options[(count[key] - 1) % options.length];
    };
    let i = 1;
    return h(
      "ol",
      { class: "story" },
      beats(plot).map((b) => {
        if (b.sub) {
          const s = b.sub;
          return h(
            "li",
            { class: "branch" },
            h("p", { class: "beat-head branch-head", style: `--i:${i++}` }, h("span", { class: "phase" }, `Subplot ${b.num}`), h("span", { class: "thread" }, VIA[s.via] || "")),
            h(
              "ol",
              { class: "lane" },
              s.items.map((it, j) =>
                beatNode("beat", h("p", { class: "beat-head" }, h("span", { class: "thread" }, threadOf(it))), paragraph(it, leadFor(j ? "subnext" : s.via), plot, met), i++)
              )
            )
          );
        }
        const cls = ["beat", `is-${b.phase}`, b.ending && b.phase === "central" ? "is-ending" : null].filter(Boolean).join(" ");
        const label = b.ending && b.phase === "central" ? "Central situation and ending" : PHASE[b.phase];
        const lead = b.ending && b.phase === "central" ? "At the heart of the story, and at its end, " : leadFor(b.phase);
        return beatNode(cls, h("p", { class: "beat-head" }, h("span", { class: "phase" }, label), h("span", { class: "thread" }, threadOf(b.item))), paragraph(b.item, lead, plot, met), i++);
      })
    );
  }

  /** Cook’s masterplot sentence with the protagonist’s name: “Arthur, a person in love, …, achieves …” */
  function premise(plot) {
    const names = plot.names || {};
    const sentence = (t) => t.replace(/^An? /, (m) => m.toLowerCase()).replace(/(?<=\s)[A-Z][a-z]+/g, (w) => w.toLowerCase());
    const As = clausesOf(P.A, plot.a).map((x) => sentence(x.t));
    const Bs = clausesOf(P.B, plot.b).map((x) => lcFirst(x.t).replace(/,(”)$/, "$1"));
    const Cs = clausesOf(P.C, plot.c).map((x) => lcFirst(x.t));
    const lead = plot.lead || "A";
    const name = names[lead] ? h("span", { class: "who", title: "the protagonist" }, names[lead]) : lead;
    return h("p", { class: "premise" }, name, `, ${As.join(", ")}, ${Bs.join(", and ")}, ${Cs.join(", and ")}.`);
  }

  function castList(plot) {
    const people = castOf(plot);
    return people.length ? h("dl", { class: "cast" }, people.map((p) => [h("dt", null, p.name), h("dd", null, p.role)])) : null;
  }

  function counts(plot) {
    const n = plot.main.length + plot.subs.reduce((t, s) => t + s.items.length, 0);
    const form = E.FORMS[plot.form];
    return [form && form.label, plural(n, "situation"), plot.subs.length && plural(plot.subs.length, "subplot")].filter(Boolean).join(" · ");
  }

  /** The masterplot's place in Cook's chart: one of 15 × 62 × 15 = 13,950. */
  const chartRef = (plot) => `Masterplot · A ${list(plot.a).join(", ")} · B (${list(plot.b).join(", ")}) · C (${list(plot.c).join(", ")})`;

  /**
   * A plot as the page shows it: the masterplot as a logline, and under it, folded, Cook's Blueprint
   * (the full plot as a story, its characters, and the same plot in Cook's notation).
   * withAction: the opening screen also offers the way on to the AI writer.
   */
  function sheet(plot, withAction) {
    return h(
      "article",
      { class: "sheet", "aria-label": "Your plot" },
      h("header", { class: "sheet-head" }, h("p", { class: "eyebrow" }, chartRef(plot)), premise(plot)),
      h(
        "details",
        { class: "blueprint", style: "--i:1" },
        h("summary", null, h("span", { class: "bp-title" }, "Cook’s Blueprint"), h("span", { class: "bp-meta" }, counts(plot))),
        h(
          "div",
          { class: "sheet-grid" },
          h("section", { "aria-label": "The story" }, h("h3", { class: "part" }, "The story"), storyList(plot)),
          h("section", { class: "cast-col", "aria-label": "Characters" }, h("h3", { class: "part" }, "Characters"), castList(plot))
        ),
        h(
          "details",
          { class: "working" },
          h("summary", null, "In Cook’s notation"),
          h("p", null, "The same plot in Cook’s conflict numbers and character symbols. This is what the AI writer receives."),
          h("pre", { class: "notation" }, E.plotToText(plot))
        )
      ),
      withAction
        ? h("footer", { class: "sheet-foot" }, h("button", { class: "btn primary big", type: "button", id: "to-write", onclick: () => showScreen("write") }, "Interpret with AI →"))
        : null
    );
  }

  // ------------------------------------------------------------------ the plot screen
  // Per-viewer convenience: the last plot is shown again on the next visit.
  const G = Object.assign({ plot: null }, store.get("gen") || {});
  let busy = false;

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function renderResult(printing) {
    const box = $("result");
    box.replaceChildren(G.plot ? sheet(G.plot, true) : "");
    box.classList.toggle("printing", !!printing && !reduceMotion);
  }

  /** What the machine decides, in order, as Cook would note it. */
  function decisions(plot) {
    const steps = [`<b>Form</b> ${E.FORMS[plot.form].label}`, `<b>Masterplot</b> A ${plot.a} · B (${plot.b}) · C (${plot.c})`, `<b>Central situation</b> ${E.label(plot.main[plot.central])}`];
    plot.main.forEach((it, i) => {
      if (i < plot.central) steps.push(`<b>Lead-up</b> ${E.label(it)}`);
      else if (i > plot.central) steps.push(`<b>${i === plot.main.length - 1 && E.endsWell(plot) ? "Ending" : "Carry-on"}</b> ${E.label(it)}`);
    });
    if (plot.cFrom) steps.push(`<b>C clause</b> (${plot.cFrom}) → (${plot.c}) for a linked finale`);
    steps.push(`<b>Sexes</b> ${plot.mirror ? "reversed: A a woman, B a man" : "as Cook wrote them"}`);
    plot.subs.forEach((s, j) => steps.push(`<b>Subplot ${E.ROMAN[j]}</b> ${s.items.map(E.label).join(", ")}`));
    steps.push(`<b>Names</b> ${Object.values(plot.names || {}).join(", ")}`);
    return steps.map((s) => s.replace(/&(?![a-z]+;)/g, "&amp;").replace(/<(?!\/?b>)/g, "&lt;"));
  }

  async function generate() {
    if (busy) return;
    busy = true;
    const btn = $("generate");
    btn.disabled = true;
    const plot = E.randomPlot();
    plot.id = newId();
    G.plot = plot;
    store.set("gen", G);
    resetInterpretation();
    if (!reduceMotion) {
      const tape = $("tape");
      $("result").classList.add("working");
      const steps = decisions(plot);
      const gap = Math.min(130, 1100 / steps.length);
      for (const s of steps) {
        tape.innerHTML = s;
        await sleep(gap);
      }
      tape.textContent = "";
      $("result").classList.remove("working");
    }
    renderResult(true);
    btn.disabled = false;
    busy = false;
    const top = $("result").getBoundingClientRect().top;
    if (top < 0) $("result").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  $("generate").addEventListener("click", generate);

  // ------------------------------------------------------------------ screens
  let screen = store.get("screen") === "write" ? "write" : "plot";
  function showScreen(next, quiet) {
    if (next === "write" && !G.plot) next = "plot";
    screen = next;
    store.set("screen", next);
    $("screen-plot").hidden = next !== "plot";
    $("screen-write").hidden = next !== "write";
    if (next === "write") $("write-plot").replaceChildren(sheet(G.plot, false));
    if (quiet) return;
    window.scrollTo({ top: 0, behavior: "auto" });
    $(next === "write" ? "write-title" : "plot-title").focus({ preventScroll: true });
  }
  $("back").addEventListener("click", () => showScreen("plot"));

  // ------------------------------------------------------------------ interpretation
  const GENRES = ["Noir", "Science fiction", "Fantasy", "Horror", "Romance", "Thriller", "Mystery", "Western", "Historical", "Comedy", "Gothic", "Literary"];
  const I = Object.assign({ genre: "Noir", other: "", notes: "" }, store.get("interpret") || {});

  function renderGenres() {
    const other = h("input", { class: "other", type: "text", id: "genre-other", placeholder: "Other genre…", value: I.other, "aria-label": "Other genre" });
    other.addEventListener("input", () => {
      I.other = other.value;
      I.genre = other.value.trim() ? "" : I.genre || "Noir";
      store.set("interpret", I);
      for (const b of $("genres").querySelectorAll(".chip")) b.setAttribute("aria-checked", b.textContent === I.genre ? "true" : "false");
    });
    $("genres").replaceChildren(
      ...GENRES.map((g) =>
        h(
          "button",
          {
            class: "chip",
            type: "button",
            role: "radio",
            "aria-checked": I.genre === g ? "true" : "false",
            onclick: () => {
              I.genre = g;
              I.other = "";
              store.set("interpret", I);
              renderGenres();
            },
          },
          g
        )
      ),
      other
    );
  }
  const genre = () => (I.other.trim() || I.genre || "Noir").slice(0, 80);

  /**
   * A brief for each genre, so the writer knows what makes it that genre: where and when such stories
   * happen, how they sound, what their readers expect, who opposes the protagonist, how Cook's 1928
   * situations translate into that world, how such stories end, and what to avoid.
   */
  const GENRE_BRIEFS = {
    Noir: {
      world: "A corrupt city, classically the 1940s or 1950s but any era with the same rot: rain, neon, cheap rooms, bars, back offices, precincts, docks. Money and power sit in the same few hands.",
      voice: "Terse and hard-boiled: short declarative sentences, cynical wit, sharp similes, an eye for the seedy detail. Moral weight is shown, never preached.",
      promise: "A flawed protagonist is drawn into crime or compromise by desire, money or loyalty, and every choice tightens the trap. Everyone has a price or a secret, and the law is no safer than the crooks.",
      opposition: "A fatal lover, a crooked cop, a racketeer, a rich patron, a blackmailer, and the protagonist's own weakness.",
      translate: "An inheritance becomes insurance money, a payoff or a stolen roll of bills; a rival becomes a fixer or a crooked cop; a secret becomes leverage; a misunderstanding becomes a frame-up.",
      ending: "Ironic or bitter. Even a win costs something real, whatever the C clause promises.",
      avoid: "Comic relief, tidy justice, explaining the moral, gangster pastiche.",
    },
    "Science fiction": {
      world: "A future, an alternate present or another world, shaped by one or two clear scientific or technological premises (colonies, ships, artificial minds, biotechnology, a changed climate). The premise touches everything.",
      voice: "Clear and concrete. Invented things are specific, and the reader infers the world from detail rather than lectures.",
      promise: "A what-if worked out honestly: the technology or discovery creates the dilemma, and the human conflict and the speculative idea turn out to be the same conflict.",
      opposition: "Institutions and corporations, artificial minds, the environment itself, scarcity, and people who misuse a new power.",
      translate: "A fortune becomes control of a resource, a patent or a ship; a telegram becomes a transmission; a disguise becomes a forged identity or a borrowed body; an estrangement can be distance, time dilation or a mind that has been changed.",
      ending: "The resolution follows from the premise's own rules; the C clause plays out through the consequences of the idea.",
      avoid: "Technobabble, info-dumps, aliens as humans in costume, a technology that solves everything at the last minute.",
    },
    Fantasy: {
      world: "An invented world, or a hidden one beside ours, with its own history, peoples, powers and geography. Magic, where it exists, has rules and costs.",
      voice: "Immersive and confident, with a texture that suits the world (mythic, courtly or earthy). Names and customs feel native, not borrowed.",
      promise: "Wonder and stakes: the protagonist's personal struggle is bound up with something larger (a house, a realm, a bargain with powers), and the world's rules shape every choice.",
      opposition: "Rival heirs, usurpers, oath-bound enemies, curses, prophecies, bargains with powers, monsters, and the price of magic.",
      translate: "An inheritance becomes a throne, a land or a binding oath; a disguise becomes a glamour or a shapechange; a secret becomes a true name or a hidden bloodline; a letter becomes a sending or an omen.",
      ending: "Magic never wins the climax for free; the C clause is paid in the world's own currency of oaths, sacrifice or transformation.",
      avoid: "Generic medieval Europe, chosen-one shortcuts, dark lords without motive, last-minute rescues by unexplained magic.",
    },
    Horror: {
      world: "An ordinary place made wrong: a house, a town, a ship, a body, a family. The familiar is the frame the dread works against.",
      voice: "Controlled and sensory. Unease builds through small wrong details; withhold, then escalate. Fear comes from anticipation more than gore.",
      promise: "Dread that rises steadily: a threat (supernatural, human or psychological) grows, isolation tightens, and the protagonist's own flaw or secret is what lets it in.",
      opposition: "A haunting or entity, a monster, a cult, a contagion, a predator, or the protagonist's own mind and guilt.",
      translate: "A secret becomes something buried that returns; a disappearance becomes a taking; an obligation becomes a curse or a debt to something inhuman; mistaken identity becomes possession or a double.",
      ending: "Survival is costly and the threat may not be gone; even a happy C clause leaves a scar or a doubt.",
      avoid: "Lists of jump scares, explaining the monster away, characters too foolish to be afraid, gore in place of dread.",
    },
    Romance: {
      world: "Any setting, so long as it gives the lovers reasons to keep meeting and reasons they cannot simply be together: class, family, rivalry, work, distance, a secret.",
      voice: "Warm, intimate and emotionally precise, giving both lovers' feelings; tension in every exchange; wit welcome.",
      promise: "The love story is the main plot. The relationship grows through attraction and conflict to a crisis that seems to end it, then to a resolution earned by change in one or both lovers.",
      opposition: "Inner wounds and false beliefs first; then families, rivals, duty, secrets, money and bad timing.",
      translate: "Cook's obstacles to marriage (class, guardians, conditions on an inheritance, rivals) become equivalents with real emotional weight in the chosen setting; misunderstandings must come from character, not mere accident.",
      ending: "Readers expect an emotionally satisfying union. If the C clause is grim, write a tragic or bittersweet romance that still honors the love.",
      avoid: "Love without cause, villains who exist only to part the lovers, a crisis that one honest conversation would have solved.",
    },
    Thriller: {
      world: "A setting with high stakes and a clock running: a city under threat, an institution, a border, a corporation, a family in danger.",
      voice: "Fast, lean and propulsive: short scenes, cliffhanger turns, information released at the moment it does the most damage.",
      promise: "Danger from the first page and a deadline that keeps shrinking. The protagonist is outmatched, hunted or racing a plan, and each reversal raises the stakes.",
      opposition: "A capable antagonist with a plan, a conspiracy, assassins, and betrayers on the protagonist's own side.",
      translate: "A secret becomes evidence someone will kill for; a journey becomes a pursuit; a misunderstanding becomes a frame or a betrayal; an inheritance becomes a target painted on the heir.",
      ending: "A confrontation in which the protagonist's own choice decides the outcome; the C clause sets the price.",
      avoid: "Coincidental rescues, villains who explain their plans, action without stakes.",
    },
    Mystery: {
      world: "A closed or knowable circle (a house, a village, a firm, a ship, a family) where everyone has a link to the crime and something to hide.",
      voice: "Observant and precise, with a quiet intelligence. Details are planted in plain sight.",
      promise: "A puzzle played fair: a crime or riddle, an investigator (amateur or professional), suspects with motive and opportunity, clues and red herrings, and a solution the reader could have reached.",
      opposition: "The culprit, false trails, lies told for other reasons, and the investigator's own blind spots.",
      translate: "Cook's secrets and concealments become the evidence; his mistaken identities become suspects and alibis; his transgressions become the crime or its motive. Decide early who did what, and plant the clues to it in the synopsis.",
      ending: "The solution is revealed and explained by clues already shown; the C clause decides what the truth costs.",
      avoid: "A culprit who appears only at the end, clues withheld from the reader, solutions by confession or luck.",
    },
    Western: {
      world: "The American frontier, roughly 1860 to 1900, or a frontier like it: open range, mining camps, railheads, cattle towns, homesteads, borderlands, with the law thin and far away.",
      voice: "Plain, laconic and weathered. Landscape and weather act as forces; dialogue is spare and to the point.",
      promise: "A test of character where settlement meets the wild: a code of honor under pressure, land, water and justice at stake, and a reckoning.",
      opposition: "Cattle barons, railroad interests, outlaws, crooked lawmen, land grabbers, drought, distance and old debts.",
      translate: "A fortune becomes a claim, a herd, water rights or a strongbox; a rival becomes a rancher or a gunman; a disguise becomes an assumed name out West; letters come by stage or wire.",
      ending: "A reckoning that settles the code; the C clause decides whether it brings peace, exile or a grave.",
      avoid: "Cartoon villains, every problem settled by a quick draw, landscape as mere backdrop, stereotyped Native characters.",
    },
    Historical: {
      world: "A specific, real period and place, chosen to fit the plot (the writer's notes may name one). Its politics, customs, work, class and technology limit what people can do.",
      voice: "Grounded and textured, with period detail woven in rather than listed, and dialogue that suggests the era without pastiche.",
      promise: "People shaped by their time, whose private conflict plays out against real forces of the period (war, reform, plague, migration, law), and who think and believe as people of their age did.",
      opposition: "The period's institutions and limits (law, church, class, the roles allowed to men and women, money, war), and personal rivals.",
      translate: "Keep Cook's situations where they fit the period and replace any that do not with true equivalents; let a real event of the time amplify the central situation. Name the period and place in the World section.",
      ending: "The resolution respects what was possible then; the C clause plays out within the era's limits.",
      avoid: "Modern attitudes dropped into the past without friction, anachronisms, history lectures.",
    },
    Comedy: {
      world: "Any setting with rules, status and appearances to keep up: a family, an office, a small town, society, a wedding, rival firms.",
      voice: "Light, quick and precise. The comedy comes from character, escalation and timing; deadpan narration is welcome.",
      promise: "Characters want something badly and make it worse. Misunderstandings, schemes and lies snowball to a big set piece, then unwind so that everyone gets roughly what they deserve.",
      opposition: "Rivals, busybodies, people in authority, rules, the protagonist's own vanity, and the snowball itself.",
      translate: "Cook's disguises, mistaken identities, pretenses and secret enterprises are already comic engines: escalate them. Grim situations become comic peril, humiliation or farce.",
      ending: "A comic resolution; a grim C clause becomes a fitting comeuppance or a reversal that is both funny and just.",
      avoid: "Jokes that undercut every stake, mean-spiritedness, random gags, winking at the reader.",
    },
    Gothic: {
      world: "An old, isolated house, estate, abbey or town with a long memory: corridors, locked rooms, portraits, storms, ruins, family vaults. The past presses on the present.",
      voice: "Atmospheric, heightened and brooding, with mounting suspense; the setting mirrors the characters' feelings.",
      promise: "Secrets of family, inheritance and transgression; a vulnerable protagonist in a place they do not understand; the uncanny, which may or may not be supernatural; desire and danger bound together.",
      opposition: "A domineering master or mistress of the house, an ancestral curse, a hidden earlier marriage or crime, madness, the house itself.",
      translate: "Cook's inheritances, hidden identities, secret marriages and family obligations fit naturally: make them the house's secrets and reveal them in stages.",
      ending: "The secret comes to light; the C clause decides whether that brings release or ruin.",
      avoid: "Cheap scares, explaining every mystery too soon, a protagonist who only watches.",
    },
    Literary: {
      world: "A precisely observed real setting, chosen for what it reveals about the characters; ordinary life rendered with specificity.",
      voice: "Close and nuanced, attentive to inner life, memory and contradiction; subtext over statement; a distinctive but controlled style.",
      promise: "Character is the plot: the outward events of the masterplot are the occasion for an inner change or revelation, and meaning grows from the specific.",
      opposition: "Mostly internal (self-deception, grief, desire, conscience), meeting real social pressures and other people's needs.",
      translate: "Turn Cook's melodrama into plausible, human-scale events without losing their force: a transgression can be a betrayal of trust, a fortune an opportunity that tests a person's values.",
      ending: "Earned and resonant rather than neat; the C clause lands as a change in understanding, which may stay ambiguous.",
      avoid: "Melodrama played straight, plotless rumination, epiphanies announced instead of shown.",
    },
  };
  const BRIEF_FIELDS = [
    ["world", "World"],
    ["voice", "Voice"],
    ["promise", "What its readers expect"],
    ["opposition", "Who or what opposes the protagonist"],
    ["translate", "Translating Cook's situations"],
    ["ending", "Endings"],
    ["avoid", "Avoid"],
  ];

  /** The genre section of the prompt: the brief, or, for a genre typed in by hand, an instruction to work one out. */
  function genreBrief(genreName) {
    const key = Object.keys(GENRE_BRIEFS).find((k) => k.toLowerCase() === genreName.trim().toLowerCase());
    const brief = key && GENRE_BRIEFS[key];
    if (!brief)
      return [
        `There is no ready-made brief for ${genreName}. Before you write, work out its conventions for yourself, as a specialist would: the world such stories are set in, their voice, what their readers expect, who or what opposes the protagonist, how situations like Cook's translate into that world, how such stories end, and the clichés to avoid. Then follow those conventions as closely as you would a brief.`,
      ];
    return BRIEF_FIELDS.map(([key, name]) => `- ${name}: ${brief[key]}`);
  }

  // The reading rules follow Cook's introduction and his Instruction Manual (Lessons 2, 3, 5 and 6).
  // The genre brief comes last, just before the checks and the format, where a model weighs it most.
  function buildPrompt(plot, genreName, notes) {
    return [
      `You are a story developer who specializes in ${genreName} fiction. Below is a plot built with PLOTTO, William Wallace Cook's 1928 system of plot suggestion. Fashion it into a ${genreName} story that a devoted ${genreName} reader would recognize as theirs from the first lines.`,
      "",
      "Everything in this request is private working material for you. The reader sees only the finished treatment, which must read as an original story, with no trace of how it was made (the last rule below says exactly what to leave out).",
      "",
      "The plot is raw material:",
      "- Treat the masterplot, the situations and any subplot as raw material from which to fashion one story. They were chosen by chance along Cook's cross-references, so as they stand they may not fit together: places, circumstances and relationships can clash from one situation to the next.",
      "- Select, merge, reorder, cut, combine or adapt them as the story needs, and invent the connecting events that let each one follow from the last.",
      "- Keep the masterplot's shape: its protagonist, the action of its B clause and the outcome of its C clause. Keep the situation marked [central situation] at the heart of the story, and let the ending play out the C clause.",
      `- The masterplot decides what happens; the genre decides how it is told. When a situation does not fit ${genreName} as written, translate it into the genre's terms (see the brief below) rather than drop it.`,
      "",
      "How to read the plot:",
      "- The masterplot is one sentence in three clauses: A describes the protagonist, B starts and carries the action, C ends it. The protagonist is the character A unless the plot says it is B.",
      "- The main plot lists Plotto conflicts in story order; a step marked [ending] is a situation Cook marks as a way to end under that C clause. Bracketed codes are Cook's conflict numbers and notation; ignore them in your answer.",
      "- A subplot branches from the main line at the step named and must feed back into it.",
      "- Characters are Plotto symbols (see the cast). Each has a working name, which the writer has already seen; use those names unless the genre or the writer's notes call for others.",
      "",
      "How Cook says to interpret it:",
      "- Every conflict is a Purpose meeting an Obstacle, stated or implied. Find both and dramatize their collision; suspense lives in it.",
      "- Nothing is to be used literally. Concrete details in a conflict (a satchel, a dance hall, a telegram) only illustrate the situation: replace them with original equivalents from the genre's world.",
      "- Let the situations decide the characters: build each person as the logical explanation of their purpose and obstacle, and let the obstacle suggest the antagonist.",
      "- Write simply, and begin in the story rather than before it.",
      "",
      E.plotToText(plot),
      "",
      `The genre: ${genreName}. This brief is guidance for you, not text to copy: show it through the story's own events, people and details, and never repeat its wording.`,
      ...genreBrief(genreName),
      notes ? `\nWriter's notes (follow these; where they differ from the genre brief, the notes win): ${notes}` : null,
      "",
      "Before you write the final answer, check the story and fix anything that fails:",
      "- every event follows from what came before it;",
      "- every character can be where the story puts them, and knows what they act on;",
      "- every character's motive is clear;",
      "- nothing contradicts anything else, including who is related to whom;",
      `- a ${genreName} reader would recognize it as ${genreName}: its world, voice, conflicts and ending all keep the brief;`,
      "- the treatment says nothing about how it was made: none of the words or labels listed in the last rule below appear in it.",
      "Give only the finished treatment, not your checking.",
      "",
      `Write the treatment in Markdown, in the voice of ${genreName}, with these sections, in order:`,
      "1. A level-2 heading with the story's title.",
      "2. **Logline.** One or two sentences.",
      "3. ### World: two or three sentences on where and when the story takes place, and its tone.",
      "4. ### Characters: a bulleted list naming each character, with a one-line sketch.",
      "5. ### Synopsis: the story in order, in short paragraphs, with any secondary storyline woven in.",
      "6. ### Ending: how the story ends, and what it costs or gives the protagonist.",
      "Keep it under 900 words.",
      "",
      "Last rule: never refer to the structure of this request or the mechanics behind the story. The treatment must not mention Plotto or Cook; the masterplot; clauses of any kind (A, B or C clause); the central situation, lead-ups, carry-ons, subplots, steps or their numbers; conflicts by number; Purpose and Obstacle as terms; the genre brief or genre conventions; raw material; working names; character symbols such as A, B or A-3; or anything in square brackets. Speak only of the characters, their world and what happens to them.",
    ]
      .filter((x) => x !== null)
      .join("\n");
  }

  /** Small, safe Markdown: everything is escaped first, then headings, lists, bold and italics. */
  function md(src) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const inline = (s) =>
      esc(s)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(“"])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)”"]|$)/g, "$1<em>$2</em>");
    let html = "";
    let para = [];
    let items = null;
    const flushPara = () => {
      if (para.length) html += `<p>${inline(para.join(" "))}</p>`;
      para = [];
    };
    const flushList = () => {
      if (items) html += `<${items.tag}>${items.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${items.tag}>`;
      items = null;
    };
    for (const raw of src.split("\n")) {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara();
        flushList();
        const lvl = Math.min(4, Math.max(2, m[1].length));
        html += `<h${lvl}>${inline(m[2].replace(/#+\s*$/, ""))}</h${lvl}>`;
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        const tag = /^\s*\d/.test(line) ? "ol" : "ul";
        if (!items || items.tag !== tag) {
          flushList();
          items = { tag, items: [] };
        }
        items.items.push(m[1]);
      } else if (!line.trim() || /^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
    return html;
  }

  // Which writer is available: Claude inside the hosted page, the local server, or none.
  let enginePromise = null;
  function detectEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
      try {
        if (window.claude && typeof window.claude.use === "function") {
          const sampleFn = await window.claude.use("sample");
          if (sampleFn) return { kind: "claude", label: "Claude", sample: sampleFn };
        }
      } catch (e) {
        /* not inside a Claude viewer */
      }
      // The public site: a Google Apps Script web app that writes on the owner's Claude account.
      if (CONFIG.writerUrl) return { kind: "gated", label: "Claude, free, one per email address", url: CONFIG.writerUrl };
      // The local server (python3 server.py) only ever runs on this computer.
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        try {
          const r = await fetch("api/status", { cache: "no-store" });
          if (r.ok) {
            const j = await r.json();
            if (j && j.ok) return { kind: "server", label: j.engine || "local server" };
          }
        } catch (e) {
          /* no local server */
        }
      }
      return null;
    })();
    return enginePromise;
  }

  // The treatment belongs to the plot it was written for (by id), so a new plot starts with a blank page.
  let running = false;
  let ctl = null;
  const saved = store.get("out");
  let outText = saved && G.plot && saved.id === G.plot.id ? saved.text || "" : "";
  const out = $("interpret-out");

  function status(msg, kind) {
    const s = $("interpret-status");
    s.textContent = msg || "";
    s.className = "status" + (kind === "warn" ? " warn" : kind === "busy" ? " thinking" : "");
  }
  function paint() {
    $("output-box").hidden = !outText && !running;
    if (outText) {
      out.className = "output";
      out.innerHTML = md(outText);
    } else {
      out.className = "output idle";
      out.textContent = "Writing…";
    }
    $("out-copy").disabled = !outText;
  }
  function keep(text, plotId) {
    if (!G.plot || G.plot.id !== plotId) return false;
    outText = text;
    store.set("out", { id: plotId, text });
    paint();
    return true;
  }
  function setRunning(on) {
    running = on;
    $("interpret-go").disabled = on;
    paint();
    $("interpret-stop").hidden = !on;
  }
  function resetInterpretation() {
    if (running && ctl) ctl.abort();
    outText = "";
    store.set("out", null);
    status("");
    paint();
  }

  const SAMPLE_ERRORS = {
    not_granted: "Claude isn’t allowed for this page. Allow it from the page’s permissions, or copy the prompt instead.",
    sampling_disabled: "Claude isn’t available for this account. Copy the prompt into another model instead.",
    not_declared: "This page can’t reach Claude. Copy the prompt instead.",
    capability_disabled: "This page can’t reach Claude here. Copy the prompt instead.",
    capability_removed: "This page can’t reach Claude here. Copy the prompt instead.",
    rate_limited: "Too many requests right now. Wait a minute and try again.",
    session_expired: "Your Claude session expired. Sign in again, then retry.",
    refused: "The model declined this plot. Try another genre or different notes.",
    prompt_too_large: "This plot is too long to send. Generate a shorter one and try again.",
    empty_completion: "The model returned nothing. Try again with a different genre.",
    TypeError: "Couldn’t reach the AI writer. Check your connection and try again.",
  };

  // The public writer asks for an email address first. The same practical check runs on the server.
  const EMAIL_RE =
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
  const looksLikeEmail = (s) => s.length <= 254 && EMAIL_RE.test(s) && s.split("@")[0].length <= 64;
  // Recorded with each address, so the sheet shows which wording of the notice the visitor saw.
  const NOTICE_VERSION = "2026-10-12";

  function renderNotice() {
    const name = CONFIG.newsletter || "Solution Space";
    const link = CONFIG.newsletterUrl ? h("a", { href: CONFIG.newsletterUrl, target: "_blank", rel: "noopener" }, name) : name;
    $("email-notice").replaceChildren(
      "Interpretations here run on my Claude account, free, one per email address. Your address is stored privately. By entering it, you agree that it may be added to my newsletter, ",
      link,
      ". You can unsubscribe at any time. Rather not? Use Copy prompt and paste the prompt into any chat model."
    );
  }

  const notes = () => $("notes").value.trim().slice(0, 1500);

  async function interpret() {
    const plot = G.plot;
    if (!plot || running) return;
    const id = plot.id;
    const prompt = buildPrompt(plot, genre(), notes());
    const show = (text) => keep(text, id);

    setRunning(true);
    status("Connecting", "busy");
    const eng = await detectEngine();
    showEngine(eng);
    if (!eng) {
      setRunning(false);
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === "file:";
      status(
        local
          ? "No AI writer is connected here. Use Copy prompt and paste it into any chat model, or run python3 server.py and open the site from it."
          : "The AI writer isn’t available here. Use Copy prompt and paste the prompt into any chat model.",
        "warn"
      );
      return;
    }
    const email = $("writer-email").value.trim();
    if (eng.kind === "gated" && !looksLikeEmail(email)) {
      setRunning(false);
      status(email ? "That doesn’t look like a valid email address." : "Enter your email address first.", "warn");
      $("writer-email").focus();
      return;
    }
    // The public writer can't be stopped once it starts (the visitor's free use would be spent anyway).
    if (eng.kind === "gated") $("interpret-stop").hidden = true;
    ctl = new AbortController();
    let text = "";
    const previous = outText; // put back if this attempt fails, so a refused retry doesn't cost the visitor what they had
    show("");
    status("Thinking", "busy");
    try {
      if (eng.kind === "claude") {
        const res = await eng.sample(prompt, {
          signal: ctl.signal,
          cache: false,
          onText: (u) => {
            text = u.text;
            show(text);
            status("Writing", "busy");
          },
        });
        text = res.text;
        show(text);
        status(res.truncated ? "The answer was cut short. Try a shorter plot." : "", res.truncated ? "warn" : "");
      } else if (eng.kind === "gated") {
        // See apps-script/Code.gs. Sent as text/plain so the browser skips the CORS preflight. The answer
        // arrives whole, not streamed.
        status("Writing. This takes about a minute", "busy");
        const r = await fetch(eng.url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ email, prompt, genre: genre(), notice: NOTICE_VERSION }),
        });
        const j = await r.json().catch(() => null);
        if (!j) throw { code: "server", message: "The AI writer sent an answer this page couldn’t read. Try again." };
        if (!j.ok) throw { code: "writer", message: j.message || "The AI writer couldn’t write this one." };
        text = j.text;
        show(text);
        const left = j.remaining > 0 ? `This address has ${j.remaining} free interpretation${j.remaining === 1 ? "" : "s"} left.` : "That was the free interpretation for this address.";
        status(j.truncated ? "The answer was cut short. " + left : left, j.truncated ? "warn" : "");
      } else {
        const r = await fetch("api/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, genre: genre() }),
          signal: ctl.signal,
        });
        if (!r.ok || !r.body) {
          const j = await r.json().catch(() => ({}));
          throw { code: "server", message: j.error || `The server answered ${r.status}.` };
        }
        // Server protocol (see server.py): "\0RESET\0" drops the text so far, "\0ERROR:msg" ends with an error.
        const RESET = "\u0000RESET\u0000";
        const body = (raw) => {
          const at = raw.lastIndexOf(RESET);
          return at >= 0 ? raw.slice(at + RESET.length) : raw;
        };
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let raw = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          raw += dec.decode(value, { stream: true });
          const b = body(raw);
          const cut = b.indexOf("\u0000");
          text = cut >= 0 ? b.slice(0, cut) : b;
          show(text);
          if (text) status("Writing", "busy");
        }
        raw += dec.decode();
        const b = body(raw);
        const err = b.match(/\u0000ERROR:([\s\S]*)$/);
        text = err ? b.slice(0, err.index) : b;
        show(text);
        status(err ? err[1].trim() : "", err ? "warn" : "");
      }
    } catch (e) {
      const code = e && (e.code || e.name);
      if (e && typeof e.text === "string" && e.text && code !== "refused") show(e.text);
      if (code === "cancelled" || code === "AbortError") status(G.plot && G.plot.id === id ? "Stopped." : "");
      else if (code === "refused") {
        show("");
        status(SAMPLE_ERRORS.refused, "warn");
      } else status(SAMPLE_ERRORS[code] || (e && e.message) || "The interpretation was interrupted. Try again.", "warn");
      if (!outText && previous) show(previous);
    } finally {
      ctl = null;
      setRunning(false);
      paint();
    }
  }

  function showEngine(eng) {
    $("engine").textContent = eng ? `Writer: ${eng.label}` : "No AI writer connected";
    $("email-gate").hidden = !(eng && eng.kind === "gated");
  }

  $("interpret-go").addEventListener("click", interpret);
  $("interpret-stop").addEventListener("click", () => ctl && ctl.abort());
  $("out-copy").addEventListener("click", () => outText && copyText(outText));
  $("prompt-copy").addEventListener("click", () => G.plot && copyText(buildPrompt(G.plot, genre(), notes())));
  $("notes").value = I.notes || "";
  $("notes").addEventListener("input", () => {
    I.notes = $("notes").value;
    store.set("interpret", I);
  });

  // ------------------------------------------------------------------ start
  // The page opens on a plot, so the first view shows what the machine makes.
  if (!G.plot || !G.plot.main || !G.plot.main.length || !E.FORMS[G.plot.form]) {
    G.plot = E.randomPlot();
    G.plot.id = newId();
    store.set("gen", G);
  }
  if (!G.plot.id) G.plot.id = newId();
  if (!G.plot.lead) G.plot.lead = E.protagonistOf(G.plot);
  G.plot.names = E.nameCast(G.plot); // keeps existing names, adds any missing
  renderResult(false);
  renderGenres();
  renderNotice();
  paint();
  showScreen(screen, true);
  $("engine").textContent = "Looking for an AI writer…";
  detectEngine().then(showEngine);
})();
