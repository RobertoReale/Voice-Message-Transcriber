# Voice Message Transcriber

Chrome extension that transcribes voice messages on WhatsApp Web, Telegram Web and Discord — entirely in the browser, with no audio sent anywhere.

Transcription runs locally using [Whisper](https://openai.com/research/whisper) via [transformers.js](https://github.com/huggingface/transformers.js) and ONNX Runtime WebAssembly. No API key or account required.

---

## Supported platforms

| Platform | URL |
|---|---|
| WhatsApp Web | web.whatsapp.com |
| Telegram Web | web.telegram.org |
| Discord | discord.com |

---

## Features

- **100% local** — no API key, no server, no audio sent anywhere
- **Automatic** — triggers when a voice message starts playing
- **Cached** — the same audio is never transcribed twice (SHA-256 hash stored in `chrome.storage.local`)
- **Three Whisper models** — Tiny (~40 MB), Small (~130 MB, default), Large v3 Turbo (~800 MB)
- **14 languages** — plus auto-detect
- **Model management** — download and delete models directly from the settings panel
- **Visual Queue** — placeholder bubbles indicate which queued voice messages are waiting to be processed
- **Pause** — temporarily disable the extension from processing new voice messages, while keeping it active
- **Silent Mode** — automatically mute the voice message while transcribing
- **Export** — save all transcriptions to a text file
- **Timestamps** — optional [MM:SS] markers in the text
- **Floating panel** — draggable, persistent across navigation, close and reopen any time
- **Copy** — click any entry to copy it, or use "Copy all"
- **Stop** — cancel an in-progress transcription without unloading the model from memory

---

## Requirements

- Chrome 112 or later (Manifest V3 + Offscreen Documents API)
- Node.js 18 or later (build only)

---

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/whatsapp-web-transcriber.git
cd whatsapp-web-transcriber
npm install
npm run build
```

Then load the extension in Chrome:

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder

---

## Usage

1. Open any supported platform
2. Play a voice message — the extension captures it automatically
3. **First run only**: the selected Whisper model downloads and caches in the browser; a progress bar appears in the panel
4. The transcription panel (bottom-right) shows the result
5. Click any entry to copy it to the clipboard

### Panel buttons

| Button | Action |
|--------|--------|
| ⚙️ | Settings — model, language, timestamps and silent mode selector |
| 💾 | Export all transcriptions to a text file |
| ⏸️/▶️ | Pause/Resume automatic transcription (saves CPU when you only want to listen) |
| 📋 | Copy all transcriptions |
| 🔊/🔇 | Toggle Silent Mode (mutes the audio of the voice message when played) |
| 🗑 | Clear the list (cache preserved — same audio won't re-transcribe) |
| ↺ | Clear cache — forces re-transcription on next play |
| ⏹ | Stop current transcription |
| ✕ | Hide panel (reopen from extension icon) |

---

## Architecture

```
src/
├── injected/interceptor.ts       — HTMLMediaElement.src patch (world: MAIN, document_start)
├── content/index.ts              — fetch, OGG/Opus decode, cache check, port to SW
├── background/service-worker.ts — port router, offscreen lifecycle, model cache reconciliation
├── offscreen/whisper.ts          — Whisper pipeline (transformers.js + ONNX WASM)
└── ui/                           — floating panel, settings, styles, drag
```

### Audio interception

`injected/interceptor.ts` runs in the page context (`world: "MAIN"`) at `document_start`, before any site JS. It patches `HTMLMediaElement.prototype.src`. Two patterns are captured:

- **Blob URLs** (`blob:https://...`): WhatsApp Web and Telegram Web download audio to memory before playing it, producing a blob URL.
- **Discord CDN URLs** (`cdn.discordapp.com/.../voice-message*`): Discord voice messages are served directly from the CDN as signed HTTPS URLs.

The manifest restricts which origins the script is injected on, so the patch is a no-op on every other site.

### Message flow

```
Site assigns audio URL (blob or CDN)
  → injected script (.src setter fires → postMessage to content script)
    → content script
        fetch(url)  →  ArrayBuffer
        AudioContext.decodeAudioData()  →  16 kHz Float32 PCM
        SHA-256 hash  →  check chrome.storage.local
        [cache hit]  →  display immediately
        [cache miss] →  open port to service worker
          → service worker
              chrome.runtime.sendMessage(WHISPER_TRANSCRIBE)
              → offscreen document
                  load / reuse Whisper model (ONNX WASM)
                  run inference
              ← text
            store in chrome.storage.local
          ← TRANSCRIBE_RESULT via port
      display in panel
```

OGG/Opus decoding happens in the content script (not the offscreen document) because Chrome MV3 offscreen documents lack the codec in `AudioContext`.

The content-script ↔ service-worker channel is a long-lived port (`chrome.runtime.connect`), which keeps the MV3 service worker alive for the entire duration of the transcription.

### Models

Models are fetched from Hugging Face via transformers.js and stored in the browser's Cache API (`caches.open('transformers-cache')`). After the first download no network request is made.

| Model | Quantization | Size | Notes |
|---|---|---|---|
| `onnx-community/whisper-tiny` | q4 | ~40 MB | fastest |
| `onnx-community/whisper-small` | q4 | ~130 MB | default |
| `onnx-community/whisper-large-v3-turbo` | q4 | ~800 MB | most accurate |

WebGPU is intentionally disabled — ONNX Runtime WebGPU has numerical overflow issues with q4 models on Windows, causing Whisper to hallucinate `[Music]` instead of speech. WASM inference uses up to 4 threads when `SharedArrayBuffer` is available.
*(Note: You can track the progress of the WebGPU fix in the [Transformers.js issue tracker](https://github.com/huggingface/transformers.js/issues). Once resolved, the extension can be updated to support WebGPU for a massive speed boost).*

Key inference settings that reduce hallucinations and repetition loops:

- `num_beams: 1`, `temperature: 0` — fast deterministic decoding
- `repetition_penalty: 1.1` — discourages repeating tokens
- `condition_on_prev_tokens: false` — prevents chunk-boundary repetition
- `compression_ratio_threshold: 2.4`, `no_speech_threshold: 0.5` — discard non-speech chunks
- Post-processing: consecutive identical segments are stripped before display

---

## Privacy

- No audio leaves the browser
- No telemetry or analytics
- No external network requests after the one-time model download from Hugging Face
- Transcription cache stored in `chrome.storage.local`, clearable from the panel at any time

---

## Roadmap / Future Ideas

- **Summarization:** Use a local SLM (Small Language Model) via WebGPU to summarize very long voice messages into bullet points.
- **Built-in Translation:** Use Whisper's native `task: "translate"` to automatically translate foreign language voice messages to English (or your native language) on the fly.
- **Speaker Diarization:** Separate and label text by different speakers (e.g., "Speaker 1", "Speaker 2") for group audio or calls.

---

## Development

```bash
npm run build   # production build → dist/
npm run dev     # same as build (reload extension manually in chrome://extensions after each build)
npm run lint    # TypeScript type check (tsc --noEmit)
```

---

## License

MIT

---

## Credits

- [transformers.js](https://github.com/huggingface/transformers.js) — in-browser Whisper via ONNX Runtime
- [onnx-community](https://huggingface.co/onnx-community) — quantized Whisper ONNX models
