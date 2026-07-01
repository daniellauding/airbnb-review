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
    "public  = 3 olika alternativ som visas publikt på gästens profil.",
    "private = 3 olika alternativ för ett privat meddelande som bara gästen ser.",
    "",
    "Regler:",
    "- Behåll gästens namn exakt som angivet.",
    "- Basera tonen på BETYGEN (1–10). Högt = beröm det specifikt; lågt = var artig och diplomatisk PUBLIKT, men du får vara vänligt ärlig/konstruktiv PRIVAT.",
    "- Hitta aldrig på specifika fakta som inte antyds av kontexten/betygen.",
    "- Om ett betyg är lågt (t.ex. städning): hylla det INTE; utelämna det publikt eller formulera det snällt.",
    "- Variera formuleringarna tydligt mellan de tre alternativen (olika inledningar, inte mallat).",
    "- Naturlig värd-röst, inga emojis om inte tonen är väldigt varm/lekfull, inga hashtags."
  ].join("\n") : [
    "You help an Airbnb HOST write short, authentic, English reviews of their GUESTS.",
    "Return ONLY valid JSON, no prose, in this exact shape:",
    '{"public":["opt1","opt2","opt3"],"private":["opt1","opt2","opt3"]}',
    "",
    "public  = 3 distinct options that appear on the guest's public profile.",
    "private = 3 distinct options for a private note sent only to the guest.",
    "",
    "Rules:",
    "- Keep the guest name(s) exactly as given.",
    "- Base the sentiment on the RATINGS provided (1-10). High = praise it specifically; low = stay gracious and diplomatic in PUBLIC, but you may be gently honest/constructive in PRIVATE.",
    "- Never invent specific facts not implied by the context/ratings.",
    "- If a rating is low (e.g. cleanliness), do NOT gush about it; either omit it publicly or phrase it kindly.",
    "- Vary wording clearly across the three options (different openings, not templated).",
    "- Natural host voice, no emojis unless the tone is very warm, no hashtags."
  ].join("\n");

  const lengthHint = lang === "sv"
    ? (length === "detailed" ? "Längd: 3–4 meningar, lite mer detalj."
      : length === "medium" ? "Längd: 2–3 meningar." : "Längd: 1–2 korta meningar.")
    : (length === "detailed" ? "Length: 3-4 sentences, a bit more detail."
      : length === "medium" ? "Length: 2-3 sentences." : "Length: 1-2 short sentences.");

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
async function callOllama({ base, model, messages, temperature, apiKey }) {
  const data = await postJSON(base.replace(/\/+$/, "") + "/api/chat",
    apiKey ? { Authorization: "Bearer " + apiKey } : {},
    { model, messages, stream: false, format: "json", options: { temperature } });
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
async function callGemini({ base, model, messages, temperature, apiKey }) {
  const url = `${base.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const data = await postJSON(url, {}, {
    systemInstruction: { parts: [{ text: sysOf(messages) }] },
    contents: [{ role: "user", parts: [{ text: userOf(messages) }] }],
    generationConfig: { temperature, responseMimeType: "application/json" }
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "generate") return;
  (async () => {
    const settings = await getSettings();
    const messages = buildMessages(msg.payload || {});
    const adapter = ADAPTERS[settings.provider] || callOllama;
    // Ollama can try several endpoints in order; cloud providers use one base URL.
    const bases = settings.provider === "ollama"
      ? settings.endpoints
      : [settings.endpoints[0] || PROVIDER_BASE[settings.provider]].filter(Boolean);

    const errors = [];
    for (const base of bases) {
      try {
        const raw = await adapter({ base, model: settings.model, messages, temperature: settings.temperature, apiKey: settings.apiKey });
        const parsed = safeParse(raw);
        if (parsed) {
          sendResponse({ ok: true, data: parsed, used: { endpoint: base, model: settings.model, provider: settings.provider } });
          return;
        }
        errors.push(`${base}: model returned unparseable output`);
      } catch (e) {
        errors.push(`${base}: ${String(e.message || e)}`);
      }
    }
    sendResponse({ ok: false, error: errors.join("  |  ") });
  })();
  return true; // keep channel open for async response
});
