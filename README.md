# TokenWise

Real-time token usage monitor and optimizer for AI chat interfaces. Track, analyze, and reduce your token consumption across **ChatGPT**, **Claude**, and **Gemini** — entirely on your device.

## Features

- **Live token counter** — Floating widget shows current message tokens and full conversation cost with color-coded thresholds
- **Conversation tracker** — Scans chat history via MutationObserver; warns at 8,000 tokens, critical alert at 30,000
- **Prompt optimizer** — Local rule-based analysis detects filler, redundancy, verbosity, and formatting waste with one-click Apply
- **File & media detection** — Estimates token cost for attachments (text, images, PDFs, video) from metadata only
- **URL paste tips** — Classifies YouTube vs general URLs with inline savings suggestions
- **Popup dashboard** — Session stats, per-message mini chart, health indicator, and settings
- **Analytics page** — 7-day bar chart, site breakdown pie chart, savings report, clear-all-data
- **Onboarding** — 3-step welcome tutorial on first install

## Privacy

**All data stays local. Nothing is sent to external servers.**

- Zero network requests — no telemetry, no cloud sync
- Data stored only in `chrome.storage.local` (never `chrome.storage.sync`)
- Session history capped at 90 days with FIFO eviction
- Prompt text is never logged to the console in production builds

## Supported sites

| Site | URL |
|------|-----|
| ChatGPT | `https://chat.openai.com/*`, `https://chatgpt.com/*` |
| Claude | `https://claude.ai/*` |
| Gemini | `https://gemini.google.com/*` |

## Install (unpacked extension)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- Google Chrome or Chromium-based browser

### Build

```bash
cd tokenwise
npm install
npm run build
npm test
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `tokenwise` folder (the one containing `manifest.json`)

### Development

```bash
npm run watch   # Rebuild on file changes
```

## Project structure

```
tokenwise/
├── manifest.json
├── src/
│   ├── content/          # Per-site content scripts
│   ├── background/       # Service worker
│   ├── popup/            # Extension popup UI
│   ├── analytics/        # Analytics dashboard
│   ├── onboarding/       # Welcome tutorial
│   ├── utils/            # Tokenizer, storage, DOM monitor, etc.
│   └── assets/icons/
├── tests/
└── dist/                 # Built output (after npm run build)
```

## Permissions

TokenWise requests only the minimum necessary permissions:

| Permission | Purpose |
|------------|---------|
| `storage` | Save session history and settings locally |
| `activeTab` | Interact with the current chat tab |
| `scripting` | Shadow DOM access for Gemini when needed |

No `tabs`, `webRequest`, `<all_urls>`, `cookies`, or other broad permissions.

## Token counting

| Model family | Method |
|--------------|--------|
| GPT (4, 4o, 3.5) | `js-tiktoken` BPE (`cl100k_base` / `o200k_base`) |
| Claude / Gemini | Heuristic: `Math.ceil(chars / 3.8)` |
| Images | Low: 85 tokens; High: `170 × tiles + 85` |

## License

Private — for personal use.
