// Background service worker: talks to Ollama.
// Cross-origin fetches to hosts in host_permissions bypass page CORS (MV3),
// so the only requirement on the Ollama side is OLLAMA_ORIGINS (see README).

const DEFAULTS = {
  // Local Ollama by default. Add your own remote endpoint in Settings.
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

async function getSettings() {
  const s = await chrome.storage.sync.get(["endpoints", "model", "temperature", "provider"]);
  // API key lives in local storage only (not synced across devices).
  const k = await chrome.storage.local.get("arh_apikey");
  const provider = s.provider || "ollama";
  return {
    provider,
    endpoints: Array.isArray(s.endpoints) && s.endpoints.length ? s.endpoints : DEFAULTS.endpoints,
    model: s.model || DEFAULTS.model,
    temperature: typeof s.temperature === "number" ? s.temperature : DEFAULTS.temperature,
    apiKey: (k.arh_apikey || "").trim()
  };
}

function scoreWord(n, lang) {
  n = Number(n);
  if (lang === "sv") {
    if (n >= 9) return "enastående";
    if (n >= 7) return "mycket bra";
    if (n >= 5) return "okej / acceptabelt";
    if (n >= 3) return "under förväntan";
    return "dåligt";
  }
  if (n >= 9) return "outstanding";
  if (n >= 7) return "very good";
  if (n >= 5) return "okay / acceptable";
  if (n >= 3) return "below expectations";
  return "poor";
}

function buildMessages(p) {
  const r = p.ratings || {};
  const tone = p.tone || "warm";
  const length = p.length || "short";
  const lang = p.lang === "sv" ? "sv" : "en"; // default: English
  const named = p.includeName !== false;      // default: mention the name
  const guestName = p.guest || (lang === "sv" ? "gästen" : "the guest");
  const nameDirective = lang === "sv"
    ? (named
        ? `Nämn gästens namn (${guestName}) naturligt — gärna i inledningen på minst ett alternativ.`
        : `Nämn INTE något namn. Skriv "gästen"/"gästerna" istället.`)
    : (named
        ? `Mention the guest's name (${guestName}) naturally — ideally opening at least one option with it.`
        : `Do NOT mention any name. Write "the guest"/"the guests" instead.`);

  // Combine the (attributed) conversation transcript with any manual notes/flow.
  const ctxParts = [];
  if (p.thread) {
    ctxParts.push((lang === "sv"
      ? "Konversation (Host = jag/värden, Guest = gästen):\n"
      : "Conversation (Host = me, Guest = the guest):\n") + String(p.thread).slice(0, 3500));
  }
  if (p.context) ctxParts.push(String(p.context));
  const ctx = ctxParts.join("\n\n") || (lang === "sv" ? "(ingen)" : "(none)");

  const sys = lang === "sv" ? [
    "Du hjälper en Airbnb-VÄRD att skriva korta, äkta recensioner om sina GÄSTER — på svenska.",
    "Svara ENDAST med giltig JSON, ingen övrig text, exakt i denna form:",
    '{"public":["alt1","alt2","alt3"],"private":["alt1","alt2","alt3"]}',
    "",
    "public  = 3 olika alternativ i TREDJE PERSON om gästen (visas på deras profil, andra värdar läser). T.ex. \"Marcela och Gabriel var enkla att ha som gäster...\"",
    "private = 3 olika alternativ skrivna DIREKT TILL gästen i DU/NI-form — ett personligt meddelande bara de ser (varmt tack, välkommen åter). T.ex. \"Tack för att ni var så lätta att ha som gäster – välkomna tillbaka!\". Beskriv dem INTE i tredje person här.",
    "",
    "Regler:",
    "- Behåll gästens namn exakt som angivet.",
    "- Basera tonen på BETYGEN (1–10). Högt = beröm det specifikt; lågt = var artig och diplomatisk PUBLIKT, men du får vara vänligt ärlig/konstruktiv PRIVAT.",
    "- Hitta aldrig på specifika fakta som inte antyds av kontexten/betygen.",
    "- Om ett betyg är lågt (t.ex. städning): hylla det INTE; utelämna det publikt eller formulera det snällt.",
    "- De tre MÅSTE vara tydligt olika: olika inledningsord, meningsbyggnad och vilken egenskap som lyfts (kommunikation/städ/respekt/helhet). Återanvänd inte samma formuleringar. Håll ALLA tre till längden nedan (variera INTE längden).",
    "- Låt det låta som en riktig värd, inte en reklamtext: jordnära, specifikt, lite återhållet är bra.",
    "- Undvik klyschor och överdrifter: inga 'top-notch', 'kändes som hemma', 'positiv energi', 'ett nöje', 'helt perfekt', 'oförglömlig', inga utropstecken på rad. Beröm bara det betygen/kontexten stödjer.",
    "- Naturlig värd-röst, inga emojis om inte tonen är väldigt varm/lekfull, inga hashtags."
  ].join("\n") : [
    "You help an Airbnb HOST write short, authentic, English reviews of their GUESTS.",
    "Return ONLY valid JSON, no prose, in this exact shape:",
    '{"public":["opt1","opt2","opt3"],"private":["opt1","opt2","opt3"]}',
    "",
    "public  = 3 distinct options in THIRD PERSON about the guest (shown on their profile, read by other hosts). E.g. \"Marcela and Gabriel were easy guests to host...\"",
    "private = 3 distinct options written DIRECTLY TO the guest in second person (\"you\") — a personal note only they can read (a warm thank-you, see-you-again). E.g. \"Thanks for being such easy guests — you'd be welcome back anytime!\". Do NOT describe them in third person here.",
    "",
    "Rules:",
    "- Keep the guest name(s) exactly as given.",
    "- Base the sentiment on the RATINGS provided (1-10). High = praise it specifically; low = stay gracious and diplomatic in PUBLIC, but you may be gently honest/constructive in PRIVATE.",
    "- Never invent specific facts not implied by the context/ratings.",
    "- If a rating is low (e.g. cleanliness), do NOT gush about it; either omit it publicly or phrase it kindly.",
    "- The three MUST be clearly different: different opening words, sentence structure, and which quality they emphasize (communication / cleanliness / respect / overall). Don't reuse the same phrasing. Keep ALL three to the length below (do NOT vary the length).",
    "- Sound like a real host, not a marketing blurb: understated, specific, a little plain is good.",
    "- Avoid clichés and gushing: no 'top-notch', 'felt like home', 'positive energy', 'a pleasure', 'perfect', 'outstanding', 'memorable', stacked exclamation marks. Only praise what the ratings/context support.",
    "- Natural host voice, no emojis unless the tone is very warm, no hashtags."
  ].join("\n");

  const lengthHint = lang === "sv"
    ? (length === "detailed" ? "LÄNGD (obligatorisk): varje alternativ EXAKT 3–4 meningar."
      : length === "medium" ? "LÄNGD (obligatorisk): varje alternativ EXAKT 2–3 meningar."
      : "LÄNGD (obligatorisk): varje alternativ MAX 1–2 korta meningar (≤ ca 25 ord totalt) — håll dem korta.")
    : (length === "detailed" ? "LENGTH (required): every option EXACTLY 3-4 sentences."
      : length === "medium" ? "LENGTH (required): every option EXACTLY 2-3 sentences."
      : "LENGTH (required): every option AT MOST 1-2 short sentences (≤ ~25 words total) — keep them short.");

  const toneHint = lang === "sv"
    ? `Ton: ${tone}. Matcha den (från saklig/neutral till varm/lekfull).`
    : `Tone: ${tone} (0=professional/neutral ... 100=warm/personal). Match it.`;

  const user = lang === "sv" ? [
    `Gästens namn: ${p.guest || "gästen"}`,
    nameDirective,
    toneHint,
    lengthHint,
    "",
    "Betyg (1–10):",
    `- Helhet / skulle rekommendera: ${r.overall ?? "-"} (${scoreWord(r.overall, lang)})`,
    `- Kommunikation: ${r.communication ?? "-"} (${scoreWord(r.communication, lang)})`,
    `- Städning / ordning: ${r.cleanliness ?? "-"} (${scoreWord(r.cleanliness, lang)})`,
    `- Husregler & respekt: ${r.rules ?? "-"} (${scoreWord(r.rules, lang)})`,
    "",
    "Kontext (konversation + anteckningar):",
    ctx.slice(0, 4500)
  ].join("\n") : [
    `Guest name(s): ${p.guest || "the guest"}`,
    nameDirective,
    toneHint,
    lengthHint,
    "",
    "Ratings (1-10):",
    `- Overall / would recommend: ${r.overall ?? "-"} (${scoreWord(r.overall, lang)})`,
    `- Communication: ${r.communication ?? "-"} (${scoreWord(r.communication, lang)})`,
    `- Cleanliness / tidiness: ${r.cleanliness ?? "-"} (${scoreWord(r.cleanliness, lang)})`,
    `- House rules & respect: ${r.rules ?? "-"} (${scoreWord(r.rules, lang)})`,
    "",
    "Context (conversation + notes):",
    ctx.slice(0, 4500)
  ].join("\n");

  return [
    { role: "system", content: sys },
    { role: "user", content: user }
  ];
}

async function postJSON(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${t.slice(0, 160)}`);
  }
  return res.json();
}

const sysOf = (m) => (m.find((x) => x.role === "system") || {}).content || "";
const userOf = (m) => (m.find((x) => x.role === "user") || {}).content || "";

// Ollama native /api/chat
async function callOllama({ base, model, messages, temperature, apiKey, plain }) {
  const body = { model, messages, stream: false, options: { temperature } };
  if (!plain) body.format = "json";
  const data = await postJSON(base.replace(/\/+$/, "") + "/api/chat",
    apiKey ? { Authorization: "Bearer " + apiKey } : {}, body);
  return data.message?.content || "";
}

// OpenAI-compatible /chat/completions (OpenAI, Groq, OpenRouter, Together, LM Studio, Ollama /v1, ...)
async function callOpenAI({ base, model, messages, temperature, apiKey }) {
  const data = await postJSON(base.replace(/\/+$/, "") + "/chat/completions",
    apiKey ? { Authorization: "Bearer " + apiKey } : {},
    { model, messages, temperature });
  return data.choices?.[0]?.message?.content || "";
}

// Anthropic Messages API
async function callAnthropic({ base, model, messages, temperature, apiKey }) {
  const data = await postJSON(base.replace(/\/+$/, "") + "/v1/messages",
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    { model, max_tokens: 1024, temperature, system: sysOf(messages), messages: [{ role: "user", content: userOf(messages) }] });
  return (data.content || []).map((b) => b.text || "").join("") || "";
}

// Google Gemini generateContent
async function callGemini({ base, model, messages, temperature, apiKey, plain }) {
  const url = `${base.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const data = await postJSON(url, {}, {
    systemInstruction: { parts: [{ text: sysOf(messages) }] },
    contents: [{ role: "user", parts: [{ text: userOf(messages) }] }],
    generationConfig: { temperature, responseMimeType: plain ? "text/plain" : "application/json" }
  });
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("") || "";
}

const ADAPTERS = { ollama: callOllama, openai: callOpenAI, "openai-compatible": callOpenAI, anthropic: callAnthropic, gemini: callGemini };

function normalize(obj) {
  const arr = (x) => (Array.isArray(x) ? x.filter(Boolean).map((s) => String(s).trim()) : []);
  const pub = arr(obj.public);
  const priv = arr(obj.private);
  if (!pub.length && !priv.length) return null;
  return { public: pub, private: priv };
}

function safeParse(raw) {
  if (!raw) return null;
  try { return normalize(JSON.parse(raw)); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return normalize(JSON.parse(m[0])); } catch {} }
  return null;
}

// ---------- Regenerate a single option ----------
function buildSingle(p) {
  const lang = p.lang === "sv" ? "sv" : "en";
  const named = p.includeName !== false;
  const guestName = p.guest || (lang === "sv" ? "gästen" : "the guest");
  const priv = p.single === "private";
  const kind = lang === "sv"
    ? (priv ? "ett privat meddelande skrivet DIREKT TILL gästen i du/ni-form (bara de läser)" : "en publik recension i tredje person om gästen")
    : (priv ? "a private note written DIRECTLY TO the guest in second person (\"you\", only they read it)" : "a public review in third person about the guest");
  const r = p.ratings || {};
  const ctxParts = [];
  if (p.thread) ctxParts.push((lang === "sv" ? "Konversation (Host = jag, Guest = gästen):\n" : "Conversation (Host = me, Guest = the guest):\n") + String(p.thread).slice(0, 3500));
  if (p.context) ctxParts.push(String(p.context));
  const ctx = ctxParts.join("\n\n") || (lang === "sv" ? "(ingen)" : "(none)");
  const avoid = (p.avoid || []).filter(Boolean);
  const length = p.length || "short";
  const lengthHint = lang === "sv"
    ? (length === "detailed" ? "LÄNGD (obligatorisk): EXAKT 3–4 meningar."
      : length === "medium" ? "LÄNGD (obligatorisk): EXAKT 2–3 meningar."
      : "LÄNGD (obligatorisk): MAX 1–2 korta meningar (≤ ca 25 ord) — håll det kort.")
    : (length === "detailed" ? "LENGTH (required): EXACTLY 3-4 sentences."
      : length === "medium" ? "LENGTH (required): EXACTLY 2-3 sentences."
      : "LENGTH (required): AT MOST 1-2 short sentences (≤ ~25 words) — keep it short.");
  const sys = (lang === "sv" ? [
    `Du hjälper en Airbnb-VÄRD att skriva ${kind} — på svenska.`,
    'Svara ENDAST med giltig JSON: {"text":"..."} och inget annat.',
    "Jordnära och specifikt, inga klyschor eller överdrifter. Matcha betygen.",
    lengthHint,
    named ? `Nämn namnet (${guestName}) naturligt.` : 'Nämn inte namnet; skriv "gästen".'
  ] : [
    `You help an Airbnb HOST write ${kind}, in English.`,
    'Return ONLY valid JSON: {"text":"..."} and nothing else.',
    "Grounded and specific, no clichés or gushing. Match the ratings.",
    lengthHint,
    named ? `Mention the name (${guestName}) naturally.` : 'Do not mention the name; write "the guest".'
  ]).join("\n");
  const user = [
    (lang === "sv" ? `Gäst: ${guestName}` : `Guest: ${guestName}`),
    (lang === "sv" ? `Ton: ${p.tone}. ${lengthHint}` : `Tone: ${p.tone}. ${lengthHint}`),
    "",
    (lang === "sv" ? "Betyg (1–10):" : "Ratings (1-10):"),
    `- overall ${r.overall} · communication ${r.communication} · cleanliness ${r.cleanliness} · rules ${r.rules}`,
    "",
    (lang === "sv" ? "Kontext:" : "Context:"), ctx.slice(0, 3500),
    avoid.length ? "\n" + (lang === "sv" ? "Skriv något TYDLIGT annorlunda än dessa:" : "Write something CLEARLY different from these:") + "\n" + avoid.map((a) => "- " + a).join("\n") : ""
  ].join("\n");
  return [{ role: "system", content: sys }, { role: "user", content: user }];
}

function parseSingle(raw) {
  if (!raw) return "";
  try { const o = JSON.parse(raw); if (o && typeof o.text === "string") return o.text.trim(); } catch {}
  const m = raw.match(/"text"\s*:\s*"([\s\S]*?)"\s*}/);
  if (m) { try { return JSON.parse('"' + m[1] + '"').trim(); } catch { return m[1].replace(/\\n/g, " ").trim(); } }
  return (raw.split("\n").map((s) => s.trim()).filter((l) => l && !/^[{}]$/.test(l))[0] || "").replace(/^["'\-\d.\s]+/, "").trim();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "generate") return;
  (async () => {
    const settings = await getSettings();
    const single = msg.payload && msg.payload.single;
    const messages = single ? buildSingle(msg.payload) : buildMessages(msg.payload || {});
    const adapter = ADAPTERS[settings.provider] || callOllama;
    // Ollama can try several endpoints in order; cloud providers use one base URL.
    const bases = settings.provider === "ollama"
      ? settings.endpoints
      : [settings.endpoints[0] || PROVIDER_BASE[settings.provider]].filter(Boolean);

    const errors = [];
    for (const base of bases) {
      try {
        const raw = await adapter({ base, model: settings.model, messages, temperature: settings.temperature, apiKey: settings.apiKey });
        const used = { endpoint: base, model: settings.model, provider: settings.provider };
        if (single) {
          const text = parseSingle(raw);
          if (text) { sendResponse({ ok: true, text, used }); return; }
          errors.push(`${base}: empty output`);
        } else {
          const parsed = safeParse(raw);
          if (parsed) { sendResponse({ ok: true, data: parsed, used }); return; }
          errors.push(`${base}: model returned unparseable output`);
        }
      } catch (e) {
        errors.push(`${base}: ${String(e.message || e)}`);
      }
    }
    sendResponse({ ok: false, error: errors.join("  |  ") });
  })();
  return true; // keep channel open for async response
});

// ---------- Cleaning schedule ----------
// Parse an Airbnb iCal export into reservation events.
function parseICal(text) {
  const events = [];
  const blocks = text.split(/BEGIN:VEVENT/).slice(1);
  for (const b of blocks) {
    const body = b.split(/END:VEVENT/)[0].replace(/\r/g, "");
    const start = (body.match(/DTSTART[^:]*:(\d{8})/) || [])[1];
    const end = (body.match(/DTEND[^:]*:(\d{8})/) || [])[1];
    const summary = ((body.match(/SUMMARY:(.*)/) || [])[1] || "").trim();
    if (!start || !end) continue;
    if (/not available/i.test(summary)) continue; // blocked, not a guest stay
    const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    events.push({ start: iso(start), end: iso(end), name: /reserved/i.test(summary) ? "" : summary });
  }
  return events;
}

function buildCleaningEmail(p) {
  const lang = p.lang === "sv" ? "sv" : "en";
  const time = (p.defTime || "13:30").trim();
  const lines = (p.slots || []).map((s) => {
    const nx = s.next
      ? (lang === "sv" ? ` (nästa gäst in ${s.next}${s.sameDay ? " — SAMMA DAG, städ på förmiddagen" : ""})`
        : ` (next guest in ${s.next}${s.sameDay ? " — SAME DAY, morning clean" : ""})`)
      : "";
    const who = s.guest ? ` [${s.guest}]` : "";
    return `- ${s.clean} kl. ${time}${nx}${who}`;
  }).join("\n");
  const sys = lang === "sv"
    ? "Du skriver ett kort, vänligt och tydligt mejl på svenska från en Airbnb-värd till sitt städföretag för att boka städtider. Behåll ALLA datum i listan — sammanfatta inte bort dem. Returnera ENDAST mejltexten (ämnesrad + brödtext), inga förklaringar."
    : "You write a short, friendly, clear email in English from an Airbnb host to their cleaning company to book cleaning slots. Keep EVERY date in the list — do not summarise them away. Return ONLY the email text (subject line + body), no explanations.";
  const user = lang === "sv"
    ? `Standardtid om inget annat anges: ${time}. Föreslagna städtider (städ sker på utcheckningsdagen):\n${lines}\n\nSkriv mejlet: kort hälsning, be dem boka/bekräfta dessa tider, och flagga tydligt de som är SAMMA DAG (gäst ut och ny in samma dag) eftersom de är tighta.`
    : `Default time unless noted: ${time}. Proposed cleaning slots (cleaning happens on the checkout day):\n${lines}\n\nWrite the email: brief greeting, ask them to book/confirm these, and clearly flag the SAME DAY ones (guest out and new guest in on the same day) as tight turnarounds.`;
  return [{ role: "system", content: sys }, { role: "user", content: user }];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "ical") {
    (async () => {
      try {
        const res = await fetch(msg.url);
        if (!res.ok) return sendResponse({ ok: false, error: `HTTP ${res.status}` });
        const text = await res.text();
        sendResponse({ ok: true, events: parseICal(text) });
      } catch (e) { sendResponse({ ok: false, error: String(e.message || e) }); }
    })();
    return true;
  }
  if (msg.type === "cleaningEmail") {
    (async () => {
      const settings = await getSettings();
      const messages = buildCleaningEmail(msg.payload || {});
      const adapter = ADAPTERS[settings.provider] || callOllama;
      const bases = settings.provider === "ollama"
        ? settings.endpoints
        : [settings.endpoints[0] || PROVIDER_BASE[settings.provider]].filter(Boolean);
      const errors = [];
      for (const base of bases) {
        try {
          const raw = await adapter({ base, model: settings.model, messages, temperature: settings.temperature, apiKey: settings.apiKey, plain: true });
          const text = (raw || "").trim();
          if (text) return sendResponse({ ok: true, text, used: { endpoint: base, model: settings.model } });
          errors.push(`${base}: empty`);
        } catch (e) { errors.push(`${base}: ${String(e.message || e)}`); }
      }
      sendResponse({ ok: false, error: errors.join("  |  ") });
    })();
    return true;
  }
});
