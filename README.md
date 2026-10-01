# Live Fact Checker

A Chrome extension that fact-checks YouTube videos and live streams **in real time** using AI. It transcribes speech, identifies verifiable claims, and checks each one against the web — all from the browser side panel.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![Gemini](https://img.shields.io/badge/Powered_by-Gemini_2.0_Flash-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## How It Works

1. **Transcribe** — captures speech via YouTube captions, tab audio (local Whisper), or your microphone
2. **Identify** — Gemini finds specific, verifiable factual claims in the transcript
3. **Verify** — each claim is checked with Gemini's grounded Google Search, rated TRUE / FALSE / UNCERTAIN
4. **Display** — claims are highlighted inline with color-coded results and hover tooltips

## Features

- **Three transcription modes**: YouTube CC (zero-latency), Tab Audio via local Whisper (works on any tab), or Microphone
- **Batch video analysis**: fetch the full transcript of any YouTube video and analyze it all at once with a progress bar
- **Budget-aware rate limiter**: sliding-window tracker that maximizes throughput without ever hitting API limits
- **Rich hover tooltips**: hover over any checked claim to see a mini summary with sources
- **Click for full details**: modal with verdict, explanation, confidence bar, and source links
- **HTML report export**: generates a beautiful, self-contained HTML report you can share
- **Bilingual UI**: full English and Spanish interface (i18n system with ~45 translated strings)
- **Dark theme**: sleek dark UI designed for the Chrome side panel
- **Rigorous fact-checking prompt**: generalizations are UNCERTAIN, demands specific data, actively looks for counterevidence

## Installation

1. **Get a Gemini API Key**
   - Go to [Google AI Studio](https://aistudio.google.com/apikey) and create a free API key
   - The free tier gives you 15 requests/minute and 1,500 requests/day — plenty for real-time checking

2. **Clone this repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/live-fact-checker.git
   ```

3. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top right toggle)
   - Click **Load unpacked** and select the `live-fact-checker` folder

4. **Configure**
   - Click the extension icon to open the side panel
   - Click the ⚙️ gear icon and paste your Gemini API key
   - Choose your language (English / Español)
   - Pick a transcription mode

## Usage

### Live Fact-Checking
1. Open a YouTube video or live stream
2. Open the extension side panel (click the extension icon)
3. Press **Start Fact-Checking**
4. Watch as claims are identified and verified in real time

### Batch Video Analysis
1. Open any YouTube video (non-live)
2. Click the ⚡ **Analyze Video** button
3. The extension fetches the full transcript and processes it in two phases:
   - Phase 1 (0–40%): Identifies all claims
   - Phase 2 (40–100%): Verifies each claim one by one

### Export Report
Click **Export** to download a self-contained HTML report with all claims, verdicts, sources, and the full transcript.

## Architecture

```
live-fact-checker/
├── manifest.json          # Manifest V3 config
├── background.js          # Service worker: message routing, transcript extraction
├── content.js             # Content script: YouTube caption capture (hybrid debounce+window)
├── sidepanel.html         # Side panel UI
├── sidepanel.css          # Dark theme styles
├── sidepanel.js           # Main app logic: state, API calls, rate limiter, i18n
├── whisper-sandbox.html   # Sandboxed iframe for local Whisper transcription
└── icons/                 # Extension icons (16, 48, 128px)
```

### Key Technical Decisions

- **Hybrid caption capture**: combines debounce (for pre-recorded CC) with window-timeout tracking (for rapidly-updating live streams) to never miss text
- **Budget-based rate limiter**: tracks a sliding window of API call timestamps; `acquireSlot()` waits exactly as long as needed, never wastes a slot
- **MAIN world script execution**: transcript extraction uses `chrome.scripting.executeScript` with `world: 'MAIN'` to access the YouTube player API directly, bypassing Content Security Policy restrictions
- **Sequential verification queue**: claims are verified one at a time to avoid burning through the rate limit
- **Adaptive timer**: slows down automatically when the API budget is tight

## Configuration

| Setting | Options | Default |
|---|---|---|
| Check Interval | ~5s, ~10s, ~20s | ~10s |
| Language | English, Español | English |
| Transcription Mode | YouTube CC, Tab Audio (Whisper), Microphone | YouTube CC |

## API Limits (Free Tier)

| Limit | Value |
|---|---|
| Requests per minute | 15 RPM |
| Requests per day | 1,500 RPD |
| Tokens per minute | 1,000,000 TPM |

The extension stays well within these limits. For heavier use, upgrade to [Gemini's paid tier](https://ai.google.dev/pricing).

## Contributing

Contributions are welcome! Some ideas:

- Add more languages to the i18n system
- Support other video platforms (Twitch, etc.)
- Add persistence for fact-check results
- Chrome Web Store packaging

## Credits

Built by [@alandaitch](https://twitter.com/alandaitch)

Powered by:
- [Gemini 2.0 Flash](https://ai.google.dev/) — claim identification and grounded verification
- [Whisper](https://huggingface.co/Xenova/whisper-tiny) via [transformers.js](https://github.com/xenova/transformers.js) — local audio transcription
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

## License

MIT — see [LICENSE](LICENSE)
