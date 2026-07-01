# Airbnb Review Helper

A small, privacy-first Chrome extension that helps **hosts draft guest reviews** on Airbnb.
It reads the guest name, your rating choices, and (optionally) the message thread, then asks
**your own LLM** to write the public review and the private note. Bring your own model —
run it **locally with [Ollama](https://ollama.com)** or point it at a cloud provider with your own key.

- **Local by default.** Out of the box it talks only to `http://localhost:11434`. Nothing leaves your machine.
- **No accounts, no telemetry, no server.** The whole extension is a few static files.
- **You stay in control.** Every draft is editable; you choose what to insert.

> Not affiliated with Airbnb. This is a personal productivity tool — use it in line with Airbnb's Terms of Service.

## What it does

On `…/hosting/reviews/<id>/edit` and `…/hosting/messages/<id>`, a floating panel (bottom-right) lets you:

- **Guest** — auto-detected from the page and remembered across the multi-step flow. Optional "mention the name" toggle.
- **Ratings** — quick segmented buttons (Poor → Great) for overall, communication, cleanliness, house rules.
- **Style** — tone (Neutral / Warm / Playful), length, and output language (EN / SV).
- **Source (optional)** — capture the message thread and/or read your selections on each Airbnb step; both are folded into the prompt so the text matches what actually happened.
- **Generate** — 3 public options + 3 private options. **Use** inserts the text into the current field (React-safe); **Copy** puts it on the clipboard.

## Install (unpacked)

1. `git clone https://github.com/daniellauding/airbnb-review.git`
2. Open `chrome://extensions` and enable **Developer mode** (top-right).
3. **Load unpacked** → select the cloned folder.
4. Open an Airbnb hosting review/message page and click the pen button (bottom-right).

## Configure your model

Click the toolbar icon, or the gear in the panel.

| Provider | Endpoint / base URL | Notes |
|----------|---------------------|-------|
| **Ollama (local)** | `http://localhost:11434` | Default. Private. See setup below. |
| **OpenAI** | `https://api.openai.com/v1` | Needs an API key. Model e.g. `gpt-4o-mini`. |
| **OpenAI-compatible** | your base URL | Groq, OpenRouter, Together, LM Studio, Ollama `/v1`, … |
| **Anthropic** | `https://api.anthropic.com` | Needs an API key. |
| **Google Gemini** | `https://generativelanguage.googleapis.com` | Needs an API key. Model e.g. `gemini-1.5-flash`. |

- Leave the endpoint blank to use the provider default.
- The **API key is stored in `chrome.storage.local`** (this browser only, never synced, never committed).
- Choosing a **non-localhost** endpoint prompts Chrome for host permission at save time (see Permissions).

### Ollama setup (local)

```bash
ollama pull qwen2.5:14b
# Allow the extension's origin, then (re)start Ollama:
OLLAMA_ORIGINS="*" ollama serve
```

Any model works — `qwen2.5:14b` is a good default; `qwen2.5:7b` or `llama3.2` are faster.

## Privacy & security

- **Local (Ollama) = fully private.** Guest names and message threads never leave your machine.
- **Cloud providers = data leaves your machine.** If you pick OpenAI/Anthropic/Gemini/etc., the guest
  name and any captured message thread are sent to that provider under your own key. The Settings screen
  says so, per provider. Choose accordingly — this data can include personal information about guests.
- **Least privilege.** The extension only runs on `www.airbnb.com/hosting/reviews/*` and `…/messages/*`.
  It ships with host access to `localhost` only; access to any other host is requested at runtime via
  `optional_host_permissions` when you add an endpoint, and can be revoked in `chrome://extensions`.
- **No bundled secrets.** There are no keys or private endpoints in this repo.

### Permissions explained

| Permission | Why |
|------------|-----|
| `storage` | Save your settings and captured context locally. |
| host: `www.airbnb.com/*` | Inject the panel and read the current page. |
| host: `localhost:11434` | Call your local Ollama. |
| `optional_host_permissions` | Requested only if/when you add a remote endpoint. |

## Notes

- Thread scraping and step reading are best-effort against Airbnb's (obfuscated, changing) DOM. Everything
  is shown in an editable box first, so you can always correct it.
- The message thread is captured on the messages page and reused on the review page (Airbnb writes the
  review on a different URL than the chat).

## Contributing

Issues and PRs welcome. It's intentionally tiny and dependency-free — plain MV3 + vanilla JS.

## License

[MIT](./LICENSE) © Daniel Lauding
