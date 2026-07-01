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

const $ = (id) => document.getElementById(id);

// Ask for host permission for any non-localhost origin (runtime, on the Save gesture).
async function ensurePermissions(urls) {
  if (!chrome.permissions || !chrome.permissions.request) return true;
  const origins = [];
  for (const e of urls) {
    try {
      const u = new URL(e);
      if (/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) continue;
      origins.push(u.origin + "/*");
    } catch {}
  }
  if (!origins.length) return true;
  try { return await chrome.permissions.request({ origins }); } catch { return false; }
}

function updatePrivacy() {
  const p = $("provider").value;
  $("privacy").innerHTML = p === "ollama"
    ? 'Local & private — nothing leaves your machine. Start Ollama with <code>OLLAMA_ORIGINS=*</code>.'
    : `Heads up: this sends the guest name and any captured message thread to <b>${p}</b>.`;
}

(async function init() {
  const s = await chrome.storage.sync.get(["endpoints", "model", "temperature", "provider"]);
  const k = await chrome.storage.local.get("arh_apikey");
  $("provider").value = s.provider || "ollama";
  $("endpoints").value = (s.endpoints && s.endpoints.length ? s.endpoints : DEFAULTS.endpoints).join("\n");
  $("model").value = s.model || DEFAULTS.model;
  $("apikey").value = k.arh_apikey || "";
  const t = typeof s.temperature === "number" ? s.temperature : DEFAULTS.temperature;
  $("temp").value = Math.round(t * 100);
  $("tempv").textContent = t.toFixed(2);
  updatePrivacy();
})();

$("provider").addEventListener("change", updatePrivacy);
$("temp").addEventListener("input", (e) => ($("tempv").textContent = (e.target.value / 100).toFixed(2)));

$("save").addEventListener("click", async () => {
  const provider = $("provider").value;
  const endpoints = $("endpoints").value.split("\n").map((x) => x.trim()).filter(Boolean);
  const list = endpoints.length ? endpoints : (provider === "ollama" ? DEFAULTS.endpoints : []);
  const targets = [...list];
  if (provider !== "ollama" && PROVIDER_BASE[provider]) targets.push(PROVIDER_BASE[provider]);
  const granted = await ensurePermissions(targets);
  await chrome.storage.sync.set({
    provider,
    endpoints: list,
    model: $("model").value.trim() || DEFAULTS.model,
    temperature: (+$("temp").value) / 100
  });
  await chrome.storage.local.set({ arh_apikey: $("apikey").value.trim() });
  $("ok").textContent = granted ? "Saved" : "Saved (remote host permission denied)";
  setTimeout(() => ($("ok").textContent = ""), 2000);
});
