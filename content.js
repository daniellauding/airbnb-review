// Injects a floating "Review Helper" panel on Airbnb host review / message pages.
(() => {
  if (window.__arhInjected) return;
  window.__arhInjected = true;

  const $ = (sel, root = document) => root.querySelector(sel);
  const onMessages = () => location.pathname.includes("/hosting/messages/");

  // Minimal inline icons (no emoji) — Feather-style strokes.
  const IC = {
    pen: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    cog: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  // ---------- Scraping ----------
  function normalizeNames(s) {
    return s.replace(/\s*,\s*/g, " and ").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
  }
  // A real person-name: capitalized tokens joined by comma / "and" / "&", no digits or noise words.
  function looksLikeName(t) {
    if (!t || t.length < 2 || t.length > 44) return false;
    if (/\d/.test(t) || /[·•:@/]/.test(t)) return false;
    if (/\b(group|guest|guests|reservation|review|leave|cancellation|policy|total|code|notes?|add|suggested|check|checkout|translation|translate|verified|superhost|enjoys|messages|inbox|host|booker|nights?|other|others)\b/i.test(t)) return false;
    return /^[\p{Lu}][\p{L}'’.-]+(?:\s*(?:,|&|and)\s*[\p{Lu}][\p{L}'’.-]+)*$/u.test(t);
  }
  // On a message thread the guest name is in the conversation header ("Marcela, Gabriel").
  function scrapeGuestFromThread() {
    const region = document.querySelector('[data-testid*="thread" i]') ||
                   document.querySelector('[role="main"]') || document;
    const heads = [...region.querySelectorAll('h1,h2,h3,[role="heading"]')].map((el) => (el.innerText || "").trim());
    const multi = heads.find((t) => looksLikeName(t) && /(,|&|\band\b)/i.test(t)); // prefer "Name, Name"
    if (multi) return normalizeNames(multi);
    const single = heads.find(looksLikeName);
    if (single) return normalizeNames(single);
    // Fallback: guest first name(s) from the "Name · Booker" message labels.
    const marks = [...(document.body.innerText || "").matchAll(/^(.+?)\s[·•]\s(?:Booker|Guest)$/gim)]
      .map((m) => m[1].trim()).filter(looksLikeName);
    const uniq = [...new Set(marks)];
    return uniq.length ? normalizeNames(uniq.join(" and ")) : "";
  }
  function scrapeGuest() {
    const re = /(?:write a review for|skriv (?:en )?recension (?:för|om))\s+(.+?)[.!]?$/i;
    for (const n of document.querySelectorAll("h1, h2, h3, span, div")) {
      const t = (n.textContent || "").trim();
      if (t.length < 120 && re.test(t)) {
        const m = t.match(re);
        if (m) return m[1].trim();
      }
    }
    if (onMessages()) {
      const g = scrapeGuestFromThread();
      if (g) return g;
    }
    const mt = document.title.match(/(?:review|recension) (?:for|för)\s+(.+?)\s*[|·-]/i);
    return mt ? mt[1].trim() : "";
  }

  // ---------- Conversation capture (as attributed turns: guest vs host) ----------
  const NOISE = [
    /^all$/i, /^unread$/i, /^skip to last message.*/i, /^translation on$/i, /^translate$/i,
    /^read by everyone$/i, /^read$/i, /^delivered$/i, /^sent$/i, /^requested$/i, /^confirmed$/i,
    /^show details$/i, /^show more$/i, /^show less$/i, /^messages$/i, /^superhost$/i,
    /^take a moment.*/i, /^leave a review.*/i, /^write a message.*/i, /^return to inbox$/i,
    /^airbnb update.*/i, /^automated message.*/i, /^reservation.*/i, /^cancellation policy.*/i,
    /^your notes$/i, /^guests$/i, /^check-?in$/i, /^check-?out$/i, /^total for.*/i, /^firm$/i,
    /^read by\b.*/i, /^yesterday$/i, /^today$/i, /^add a note.*/i, /^suggested door code.*/i, /^switch to.*/i,
    /^\d{1,2}:\d{2}\s*(am|pm)?$/i,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d{1,2}(,\s*\d{4})?$/i,
    /^\w{3,4},?\s+\w{3}\s+\d{1,2}.*$/i,
    /^\w{3}\s+\d{1,2}\s*[–-]\s*(\w{3}\s+)?\d{1,2}.*$/i,
    /^kr\s?[\d,. ]+$/i, /^[·•]$/
  ];
  const isNoise = (t) => NOISE.some((re) => re.test(t));
  const redact = (t) => t
    .replace(/(password|wifi|pass|code)\s*[:=]\s*\S+/gi, "$1: [redacted]")
    .replace(/\+?\d[\d ()\-]{7,}\d/g, "[phone]");

  // Pick the visible container that holds the most conversation text.
  function bestThreadContainer() {
    const cands = [...document.querySelectorAll('[data-testid*="thread" i], [role="main"], main')]
      .filter((el) => !panel.contains(el));
    let best = null, len = 0;
    for (const el of cands) {
      const l = (el.innerText || "").length;
      if (l > len) { best = el; len = l; }
    }
    return best || document.body;
  }

  // Find leaf-ish text blocks (message bubbles) regardless of Airbnb's class names.
  function textLeaves(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (panel.contains(el)) return NodeFilter.FILTER_REJECT;
        const t = (el.innerText || "").trim();
        if (!t || t.length < 2 || t.length > 2000) return NodeFilter.FILTER_SKIP;
        for (const c of el.children) {
          if ((c.innerText || "").trim().length > t.length * 0.8) return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  const isSenderLabel = (t) => /[·•]\s*(booker|host|guest)\b/i.test(t);

  // Primary: bubbles classified by horizontal position (host = right, guest = left).
  function scrapeThreadDOM() {
    const container = bestThreadContainer();
    const cr = container.getBoundingClientRect();
    if (!cr.width) return [];
    const mid = cr.left + cr.width / 2;
    const turns = [];
    for (const el of textLeaves(container)) {
      let t = (el.innerText || "").trim();
      if (isNoise(t) || isSenderLabel(t)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.width > cr.width * 0.95) continue; // skip full-width chrome
      t = redact(t);
      const who = (r.left + r.width / 2) > mid ? "host" : "guest";
      const last = turns[turns.length - 1];
      if (last && last.who === who) last.text += "\n" + t;
      else turns.push({ who, text: t });
    }
    return turns;
  }

  // Fallback: parse the flat text using "Name · Booker" labels (may include a trailing time).
  function scrapeThreadText() {
    const raw = (bestThreadContainer().innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const turns = [];
    const seen = new Set();
    let cur = null;
    for (const line of raw) {
      if (isNoise(line)) continue;
      const m = line.match(/^(.+?)\s[·•]\s(Booker|Guest|Host)\b/i);
      if (m) { cur = { who: /host/i.test(m[2]) ? "host" : "guest", text: "" }; turns.push(cur); continue; }
      if (line.length > 20) { if (seen.has(line)) continue; seen.add(line); }
      if (!cur) { cur = { who: "guest", text: "" }; turns.push(cur); }
      cur.text += (cur.text ? "\n" : "") + redact(line);
    }
    return turns.filter((t) => t.text);
  }

  function scrapeThread() {
    if (!onMessages()) return [];
    let turns = scrapeThreadDOM();
    if (turns.length < 2) turns = scrapeThreadText();
    return turns.slice(-24); // keep the most recent turns
  }

  // Attributed transcript for the model (Host = me, Guest = the reviewee).
  function toTranscript(turns) {
    if (!turns || !turns.length) return "";
    return turns
      .map((t) => `${t.who === "host" ? "Host (me)" : "Guest"}: ${t.text.replace(/\s*\n\s*/g, " ").slice(0, 400)}`)
      .join("\n").slice(-3500);
  }

  // ---------- Persistence (survives Airbnb's client-side navigation) ----------
  async function getSavedThread() {
    try { return (await chrome.storage.local.get("arh_thread")).arh_thread || null; }
    catch { return null; }
  }
  async function saveThread(turns, guest) {
    const rec = { turns: turns || [], guest: guest || "", ts: Date.now(), url: location.href };
    try { await chrome.storage.local.set({ arh_thread: rec }); } catch {}
    return rec;
  }
  // The guest name only appears on the intro step — persist it for every later step.
  async function getSavedGuest() {
    try { return (await chrome.storage.local.get("arh_guest")).arh_guest || ""; }
    catch { return ""; }
  }
  async function saveGuest(name) {
    if (!name) return;
    try { await chrome.storage.local.set({ arh_guest: name }); } catch {}
  }
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  }

  // ---------- Read the host's own choices in the multi-step review flow ----------
  const CATS = [
    [/communicat/i, "Communication"],
    [/clean/i, "Cleanliness"],
    [/rule/i, "House rules"],
    [/recommend/i, "Recommend"],
    [/public review|say a few words|other guests|other hosts/i, "Overall (public)"],
    [/private|only.*guest|won't be shared|not be shared/i, "Private feedback"]
  ];
  function categoryOf(q) {
    for (const [re, name] of CATS) if (re.test(q)) return name;
    return q ? q.slice(0, 40) : "Other";
  }
  function scrapeStep() {
    const heads = [...document.querySelectorAll("h1,h2,h3")]
      .map((h) => (h.innerText || "").trim()).filter(Boolean);
    const question = heads.find((t) =>
      /how (well|clean|did|would)|follow your house rules|write a (public|private)|private|say a few words|recommend/i.test(t)
    ) || heads[0] || "";

    const selected = [];
    document.querySelectorAll('[aria-pressed="true"],[aria-checked="true"],[aria-selected="true"],input:checked')
      .forEach((el) => {
        if (panel.contains(el)) return;
        let label = (el.getAttribute("aria-label") || el.innerText || "").trim();
        if (!label && el.id) {
          const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (l) label = (l.innerText || "").trim();
        }
        if (label && label.length < 80 && !/^(next|back|save|save and exit|continue|previous)$/i.test(label)) {
          selected.push(label);
        }
      });

    const notes = [...document.querySelectorAll("textarea")]
      .filter((t) => !panel.contains(t)).map((t) => t.value.trim()).filter(Boolean);

    return { category: categoryOf(question), question, selected: [...new Set(selected)], notes };
  }

  async function getFlow() {
    try { return (await chrome.storage.local.get("arh_flow")).arh_flow || { cats: {} }; }
    catch { return { cats: {} }; }
  }
  async function mergeStep(step) {
    const flow = await getFlow();
    if (!flow.cats) flow.cats = {};
    const c = flow.cats[step.category] || { items: [], note: "" };
    c.items = [...new Set([...(c.items || []), ...step.selected])];
    if (step.notes.length) c.note = step.notes.join(" / ");
    flow.cats[step.category] = c;
    flow.ts = Date.now();
    try { await chrome.storage.local.set({ arh_flow: flow }); } catch {}
    return flow;
  }
  function flowToText(flow) {
    const lines = [];
    for (const [cat, c] of Object.entries(flow.cats || {})) {
      let line = `- ${cat}: ${(c.items || []).join(", ")}`;
      if (c.note) line += ` — note: ${c.note}`;
      lines.push(line);
    }
    return lines.length ? "Host's selections in the review flow:\n" + lines.join("\n") : "";
  }

  // Managed block at the top of the context box; never clobbers manual notes below it.
  const F0 = "-- review flow --", F1 = "-- end --";
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function upsertFlowBlock(text) {
    const ta = $("#arh-context");
    const block = text ? `${F0}\n${text}\n${F1}` : "";
    const re = new RegExp(escRe(F0) + "[\\s\\S]*?" + escRe(F1));
    if (re.test(ta.value)) ta.value = ta.value.replace(re, block);
    else if (block) ta.value = block + (ta.value.trim() ? "\n\n" + ta.value.trim() : "");
    ta.value = ta.value.trim();
  }

  // ---------- UI data ----------
  const RLEVELS = [
    { t: "Poor", v: 2 }, { t: "Meh", v: 4 }, { t: "OK", v: 6 },
    { t: "Good", v: 8 }, { t: "Great", v: 10 }
  ];
  const TONES = [{ t: "Neutral", v: "neutral" }, { t: "Warm", v: "warm" }, { t: "Playful", v: "playful" }];
  const LENS = [{ t: "Short", v: "short" }, { t: "Medium", v: "medium" }, { t: "Long", v: "detailed" }];
  const LANGS = [{ t: "EN", v: "en" }, { t: "SV", v: "sv" }];
  const rows = [
    ["overall", "Overall / recommend", 3],
    ["communication", "Communication", 3],
    ["cleanliness", "Cleanliness", 3],
    ["rules", "House rules & respect", 3]
  ];
  // Segmented control: pill buttons; the selected value lives on the wrapper's data-val.
  function seg(id, opts, defIdx, cls) {
    return `<div class="arh-seg ${cls || ""}" id="${id}" data-val="${opts[defIdx].v}">` +
      opts.map((o, i) => `<button type="button" class="arh-segb${i === defIdx ? " on" : ""}" data-val="${o.v}">${o.t}</button>`).join("") +
      `</div>`;
  }

  // ---------- Panel ----------
  const panel = document.createElement("div");
  panel.id = "arh-panel";
  panel.innerHTML = `
    <div id="arh-fab" title="Review Helper">${IC.pen}</div>
    <div id="arh-card" hidden>
      <div class="arh-head">
        <strong>Review Helper</strong>
        <span class="arh-sp"></span>
        <button id="arh-gear" class="arh-icon" title="Settings" aria-label="Settings">${IC.cog}</button>
        <button id="arh-x" class="arh-icon" title="Close" aria-label="Close">${IC.x}</button>
      </div>

      <div id="arh-step" class="arh-step" hidden></div>

      <div class="arh-sec">
        <div class="arh-sech">1 · Guest</div>
        <input id="arh-guest" class="arh-in" type="text" placeholder="e.g. Nikoloz and Christina">
        <label class="arh-check"><input type="checkbox" id="arh-named" checked> Mention the name in the text</label>
      </div>

      <div class="arh-sec">
        <div class="arh-sech">2 · How were they?</div>
        ${rows.map(([k, label, defIdx]) => `
          <div class="arh-rate">
            <span class="arh-ratel">${label}</span>
            ${seg(`seg-${k}`, RLEVELS, defIdx, "arh-seg-rate")}
          </div>`).join("")}
      </div>

      <div class="arh-sec">
        <div class="arh-sech">3 · Style</div>
        <div class="arh-field"><span class="arh-fl">Tone</span>${seg("seg-tone", TONES, 1)}</div>
        <div class="arh-field"><span class="arh-fl">Length</span>${seg("seg-length", LENS, 0)}</div>
        <div class="arh-field"><span class="arh-fl">Lang</span>${seg("seg-lang", LANGS, 0)}</div>
      </div>

      <div class="arh-sec">
        <div class="arh-sech">4 · Source <span class="arh-sechhint">optional — makes the text more accurate</span></div>
        <div class="arh-capbtns">
          <button id="arh-readstep" class="arh-mini" type="button" title="Read your choices on this step">Read step</button>
          <button id="arh-capture" class="arh-mini" type="button">Capture thread</button>
          <button id="arh-clearctx" class="arh-mini arh-mini-x" type="button" title="Clear name, thread &amp; step choices">Clear</button>
        </div>
        <div id="arh-caphint" class="arh-caphint"></div>
        <div id="arh-chat" class="arh-chat" hidden></div>
        <textarea id="arh-context" class="arh-in" rows="3" placeholder="Extra notes for the model (optional)"></textarea>
      </div>

      <button id="arh-gen" class="arh-gen">Generate review</button>
      <div id="arh-status" class="arh-status"></div>
      <div id="arh-results"></div>
    </div>

    <div id="arh-settings" class="arh-card" hidden>
      <div class="arh-head"><strong>Settings</strong><span class="arh-sp"></span><button id="arh-sx" class="arh-icon" title="Back" aria-label="Back">${IC.x}</button></div>
      <label class="arh-l">Provider</label>
      <select id="arh-provider" class="arh-in">
        <option value="ollama">Ollama (local)</option>
        <option value="openai">OpenAI</option>
        <option value="openai-compatible">OpenAI-compatible</option>
        <option value="anthropic">Anthropic</option>
        <option value="gemini">Google Gemini</option>
      </select>
      <label class="arh-l">Endpoint / base URL <span class="arh-sechhint">blank = provider default; Ollama can list several</span></label>
      <textarea id="arh-endpoints" class="arh-in" rows="2"></textarea>
      <label class="arh-l">Model</label>
      <input id="arh-model" class="arh-in" type="text" placeholder="e.g. qwen2.5:14b · gpt-4o-mini · claude-... · gemini-1.5-flash">
      <label class="arh-l">API key <span class="arh-sechhint">optional; stored locally, not synced</span></label>
      <input id="arh-apikey" class="arh-in" type="password" placeholder="only if your endpoint needs auth">
      <label class="arh-l">Creativity (temperature): <b id="arh-tempv">0.9</b></label>
      <input type="range" min="0" max="100" value="90" id="arh-temp" class="arh-full">
      <button id="arh-save" class="arh-gen">Save</button>
      <div id="arh-privacy" class="arh-hint"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const card = $("#arh-card");
  const settings = $("#arh-settings");
  const statusEl = $("#arh-status");
  const results = $("#arh-results");

  function setCapHint(msg) { $("#arh-caphint").textContent = msg || ""; }
  function setStatus(html, isErr) {
    statusEl.innerHTML = html || "";
    statusEl.className = "arh-status" + (isErr ? " err" : "");
  }

  // ---------- Conversation preview (chat bubbles) ----------
  let threadTurns = [];
  const escHTML = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  function renderChat(turns) {
    threadTurns = Array.isArray(turns) ? turns : [];
    const box = $("#arh-chat");
    if (!threadTurns.length) { box.hidden = true; box.innerHTML = ""; box.dataset.all = "0"; return; }
    const N = 6;
    const showAll = box.dataset.all === "1";
    const start = showAll ? 0 : Math.max(0, threadTurns.length - N);
    const hiddenCount = start;
    const rows = [];
    if (hiddenCount > 0) rows.push(`<button class="arh-chatmore" data-act="all">Show ${hiddenCount} earlier messages</button>`);
    for (let i = start; i < threadTurns.length; i++) {
      const t = threadTurns[i];
      const full = escHTML(t.text.replace(/\n/g, " "));
      const long = full.length > 160;
      const body = long ? full.slice(0, 160) + "…" : full;
      rows.push(
        `<div class="arh-bub ${t.who}" data-i="${i}">` +
        `<span class="arh-bub-who">${t.who === "host" ? "Me" : "Guest"}</span>${body}` +
        (long ? ` <button class="arh-chatmore" data-more="${i}">more</button>` : "") +
        `</div>`
      );
    }
    if (showAll && threadTurns.length > N) rows.push(`<button class="arh-chatmore" data-act="less">Show less</button>`);
    box.innerHTML = rows.join("");
    box.hidden = false;
  }
  $("#arh-chat").addEventListener("click", (e) => {
    const b = e.target.closest(".arh-chatmore");
    if (!b) return;
    const box = $("#arh-chat");
    if (b.dataset.act === "all") { box.dataset.all = "1"; renderChat(threadTurns); }
    else if (b.dataset.act === "less") { box.dataset.all = "0"; renderChat(threadTurns); }
    else if (b.dataset.more != null) {
      const i = +b.dataset.more, t = threadTurns[i];
      const bub = box.querySelector(`[data-i="${i}"]`);
      if (bub && t) bub.innerHTML = `<span class="arh-bub-who">${t.who === "host" ? "Me" : "Guest"}</span>${escHTML(t.text.replace(/\n/g, " "))}`;
    }
  });

  async function openCard() {
    settings.hidden = true;
    card.hidden = false;

    // Guest name: scrape (intro step only) -> otherwise the saved name.
    if (!$("#arh-guest").value) {
      const scraped = scrapeGuest();
      if (scraped) { $("#arh-guest").value = scraped; saveGuest(scraped); }
      else { $("#arh-guest").value = await getSavedGuest(); }
    }

    // Conversation: capture live on a thread; elsewhere reuse the last captured thread.
    if (onMessages()) {
      const turns = scrapeThread();
      renderChat(turns);
      if (turns.length) {
        const guest = $("#arh-guest").value.trim() || scrapeGuest();
        await saveThread(turns, guest);
        setCapHint(`Captured ${turns.length} messages`);
      }
    } else {
      const saved = await getSavedThread();
      if (saved && saved.turns && saved.turns.length) {
        renderChat(saved.turns);
        setCapHint(`Thread from ${fmtTime(saved.ts)}${saved.guest ? " · " + saved.guest : ""} · ${saved.turns.length} messages`);
      } else {
        renderChat([]);
      }
    }

    $("#arh-readstep").style.display = onMessages() ? "none" : "";
    $("#arh-capture").textContent = onMessages() ? "Capture thread" : "Reload thread";

    const stepEl = $("#arh-step");
    if (onMessages()) {
      stepEl.textContent = "Message thread — capture the conversation below";
      stepEl.hidden = false;
    } else {
      const step = scrapeStep();
      let flow = await getFlow();
      if (step.selected.length || step.notes.length) {
        flow = await mergeStep(step);
        setCapHint(`Read "${step.category}" · ${Object.keys(flow.cats).length} steps saved`);
      }
      if (flow.cats && Object.keys(flow.cats).length) upsertFlowBlock(flowToText(flow));
      if (step.category && step.category !== "Other") {
        stepEl.textContent = `Airbnb step: ${step.category}`;
        stepEl.hidden = false;
      } else {
        stepEl.hidden = true;
      }
    }
  }

  $("#arh-fab").addEventListener("click", () => {
    const isOpen = !card.hidden || !settings.hidden;
    if (isOpen) { card.hidden = true; settings.hidden = true; }
    else { openCard(); }
  });
  $("#arh-x").addEventListener("click", () => (card.hidden = true));
  $("#arh-gear").addEventListener("click", () => { card.hidden = true; loadSettings(); settings.hidden = false; });
  $("#arh-sx").addEventListener("click", () => { settings.hidden = true; card.hidden = false; });

  $("#arh-readstep").addEventListener("click", async () => {
    const step = scrapeStep();
    if (!step.selected.length && !step.notes.length) {
      setCapHint(`Nothing selected on "${step.category}" yet — make your choices on the page first.`);
      return;
    }
    const flow = await mergeStep(step);
    if (!$("#arh-guest").value) $("#arh-guest").value = scrapeGuest();
    upsertFlowBlock(flowToText(flow));
    setCapHint(`Read "${step.category}" (${step.selected.length} selected) · ${Object.keys(flow.cats).length} steps saved`);
  });

  $("#arh-clearctx").addEventListener("click", async () => {
    try { await chrome.storage.local.remove(["arh_thread", "arh_flow", "arh_guest"]); } catch {}
    upsertFlowBlock("");
    $("#arh-guest").value = "";
    renderChat([]);
    setCapHint("Cleared (name, thread & step choices).");
  });

  $("#arh-capture").addEventListener("click", async () => {
    if (onMessages()) {
      const turns = scrapeThread();
      if (!turns.length) { setCapHint("No thread found to capture on this page."); return; }
      renderChat(turns);
      const guest = $("#arh-guest").value.trim() || scrapeGuest();
      const rec = await saveThread(turns, guest);
      setCapHint(`Captured ${turns.length} messages ${fmtTime(rec.ts)} (saved — works on the review page)`);
    } else {
      const saved = await getSavedThread();
      if (saved && saved.turns && saved.turns.length) {
        renderChat(saved.turns);
        setCapHint(`Loaded ${saved.turns.length} messages from ${fmtTime(saved.ts)}`);
      } else {
        setCapHint("No thread captured yet — open a message thread and click Capture thread.");
      }
    }
  });

  // Segmented controls: click a pill to select; value stored on the wrapper's data-val.
  card.addEventListener("click", (e) => {
    const b = e.target.closest(".arh-segb");
    if (!b) return;
    const wrap = b.parentElement;
    wrap.querySelectorAll(".arh-segb").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    wrap.dataset.val = b.dataset.val;
  });

  // Persist a manually typed guest name so later steps keep it.
  $("#arh-guest").addEventListener("change", (e) => saveGuest(e.target.value.trim()));

  // ---------- Settings ----------
  const DEFAULTS = {
    endpoints: ["http://localhost:11434"],
    model: "qwen2.5:14b",
    temperature: 0.9
  };
  const PROVIDER_BASE = {
    ollama: "http://localhost:11434",
    openai: "https://api.openai.com/v1",
    "openai-compatible": "",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com"
  };
  function updatePrivacyHint() {
    const p = $("#arh-provider").value;
    const el = $("#arh-privacy");
    if (p === "ollama") {
      el.innerHTML = 'Local &amp; private — nothing leaves your machine. Start Ollama with <code>OLLAMA_ORIGINS=*</code> so the extension may call it. A non-localhost endpoint will ask for host permission.';
    } else {
      el.innerHTML = `Heads up: this sends the guest name and any captured message thread to <b>${p}</b>. Use only with your own API key and a provider you trust.`;
    }
  }
  async function loadSettings() {
    const s = await chrome.storage.sync.get(["endpoints", "model", "temperature", "provider"]);
    const k = await chrome.storage.local.get("arh_apikey");
    $("#arh-provider").value = s.provider || "ollama";
    $("#arh-endpoints").value = (s.endpoints && s.endpoints.length ? s.endpoints : DEFAULTS.endpoints).join("\n");
    $("#arh-model").value = s.model || DEFAULTS.model;
    $("#arh-apikey").value = k.arh_apikey || "";
    const t = typeof s.temperature === "number" ? s.temperature : DEFAULTS.temperature;
    $("#arh-temp").value = Math.round(t * 100);
    $("#arh-tempv").textContent = t.toFixed(2);
    updatePrivacyHint();
  }
  $("#arh-provider").addEventListener("change", updatePrivacyHint);
  $("#arh-temp").addEventListener("input", (e) => ($("#arh-tempv").textContent = (e.target.value / 100).toFixed(2)));

  // Ask for host permission for any non-localhost endpoint (runtime, on a user gesture).
  async function ensureEndpointPermissions(endpoints) {
    if (!chrome.permissions || !chrome.permissions.request) return true;
    const origins = [];
    for (const e of endpoints) {
      try {
        const u = new URL(e);
        if (/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) continue;
        origins.push(u.origin + "/*");
      } catch {}
    }
    if (!origins.length) return true;
    try { return await chrome.permissions.request({ origins }); } catch { return false; }
  }

  $("#arh-save").addEventListener("click", async () => {
    const provider = $("#arh-provider").value;
    const endpoints = $("#arh-endpoints").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const list = endpoints.length ? endpoints : (provider === "ollama" ? DEFAULTS.endpoints : []);
    const permTargets = [...list];
    if (provider !== "ollama" && PROVIDER_BASE[provider]) permTargets.push(PROVIDER_BASE[provider]);
    const granted = await ensureEndpointPermissions(permTargets);
    await chrome.storage.sync.set({
      provider,
      endpoints: list,
      model: $("#arh-model").value.trim() || DEFAULTS.model,
      temperature: (+$("#arh-temp").value) / 100
    });
    await chrome.storage.local.set({ arh_apikey: $("#arh-apikey").value.trim() });
    settings.hidden = true;
    card.hidden = false;
    setStatus(granted ? "Settings saved." : "Saved, but host permission was denied.");
  });

  // ---------- Generate ----------
  function cardHTML(text) {
    const esc = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const enc = encodeURIComponent(text);
    return `<div class="arh-opt"><div class="arh-opt-t">${esc}</div>
      <div class="arh-optbtns">
        <button class="arh-use" data-txt="${enc}">Use</button>
        <button class="arh-copy" data-copy="${enc}">Copy</button>
      </div></div>`;
  }
  function render(data) {
    results.innerHTML = `
      <div class="arh-group">Public review</div>
      ${data.public.map((t) => cardHTML(t)).join("")}
      <div class="arh-group">Private note</div>
      ${data.private.map((t) => cardHTML(t)).join("")}
    `;
    results.querySelectorAll(".arh-copy").forEach((b) =>
      b.addEventListener("click", async () => {
        await navigator.clipboard.writeText(decodeURIComponent(b.dataset.copy));
        b.textContent = "Copied";
        setTimeout(() => (b.textContent = "Copy"), 1200);
      })
    );
    results.querySelectorAll(".arh-use").forEach((b) =>
      b.addEventListener("click", () => {
        const ok = fillIntoPage(decodeURIComponent(b.dataset.txt));
        b.textContent = ok ? "Inserted" : "No text field";
        setTimeout(() => (b.textContent = "Use"), 1400);
      })
    );
  }

  // Fill the current page's review textarea in a React-safe way.
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.offsetParent !== null;
  }
  function findReviewField() {
    const active = document.activeElement;
    if (active && /^(TEXTAREA|INPUT)$/.test(active.tagName) && !panel.contains(active)) return active;
    const fields = [...document.querySelectorAll("textarea, input[type=text]")]
      .filter((el) => !panel.contains(el) && isVisible(el));
    fields.sort((a, b) => (a.tagName === "TEXTAREA" ? -1 : 1) - (b.tagName === "TEXTAREA" ? -1 : 1));
    return fields[0] || null;
  }
  function fillIntoPage(text) {
    const el = findReviewField();
    if (!el) return false;
    el.focus();
    setNativeValue(el, text);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  $("#arh-gen").addEventListener("click", () => {
    const payload = {
      guest: $("#arh-guest").value.trim(),
      context: $("#arh-context").value.trim(),
      thread: toTranscript(threadTurns),
      tone: $("#seg-tone").dataset.val,
      lang: $("#seg-lang").dataset.val,
      includeName: $("#arh-named").checked,
      length: $("#seg-length").dataset.val,
      ratings: {
        overall: +$("#seg-overall").dataset.val,
        communication: +$("#seg-communication").dataset.val,
        cleanliness: +$("#seg-cleanliness").dataset.val,
        rules: +$("#seg-rules").dataset.val
      }
    };
    results.innerHTML = "";
    const gen = $("#arh-gen");
    gen.disabled = true;
    const orig = gen.textContent;
    const t0 = Date.now();
    const tick = () => { gen.textContent = `Generating... ${((Date.now() - t0) / 1000).toFixed(0)}s`; };
    tick();
    const timer = setInterval(tick, 500);

    const QUIPS = [
      "Reading the conversation…",
      "Weighing your ratings…",
      "Finding the right words…",
      "Honest, but kind…",
      "Matching your tone…",
      "Drafting the public review…",
      "Writing the private note…",
      "Polishing the phrasing…",
      "Almost there…"
    ];
    let qi = 0;
    setStatus(`<span class="arh-spin"></span> ${QUIPS[0]}`);
    const quips = setInterval(() => {
      qi = (qi + 1) % QUIPS.length;
      setStatus(`<span class="arh-spin"></span> ${QUIPS[qi]}`);
    }, 2400);
    const finish = (fn) => { clearInterval(timer); clearInterval(quips); gen.disabled = false; gen.textContent = orig; fn(); };

    chrome.runtime.sendMessage({ type: "generate", payload }, (resp) => {
      if (chrome.runtime.lastError) return finish(() => setStatus(chrome.runtime.lastError.message, true));
      if (!resp) return finish(() => setStatus("No response from background.", true));
      if (!resp.ok) return finish(() => setStatus("Failed: " + resp.error, true));
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      finish(() => setStatus(`Done in ${secs}s · ${resp.used.endpoint.replace(/^https?:\/\//, "")} · ${resp.used.model}`));
      render(resp.data);
    });
  });

  // ---------- Keep the panel alive through Airbnb's SPA re-renders / navigation ----------
  let ensureQueued = false;
  function ensurePanel() {
    if (document.body && !document.body.contains(panel)) document.body.appendChild(panel);
  }
  function queueEnsure() {
    if (ensureQueued) return;
    ensureQueued = true;
    setTimeout(() => { ensureQueued = false; ensurePanel(); }, 250);
  }
  try {
    new MutationObserver(queueEnsure).observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
  const _ps = history.pushState, _rs = history.replaceState;
  history.pushState = function () { const r = _ps.apply(this, arguments); queueEnsure(); return r; };
  history.replaceState = function () { const r = _rs.apply(this, arguments); queueEnsure(); return r; };
  window.addEventListener("popstate", queueEnsure);
})();
