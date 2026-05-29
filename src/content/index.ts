import {
  initPanel,
  togglePanel,
  addTranscription,
  showStatusInPanel,
  notifyModelLoaded,
  notifyModelDeleted,
  notifyModelLoadFailed,
  notifyDownloadProgress,
  setTranscribing,
  showLanguagePromptInPanel,
  addPendingEntry,
  updatePendingEntry,
  removePendingEntry,
} from '../ui/panel';
import { S } from '../shared/strings';
import { STORAGE_KEYS, type ExtensionMessage } from '../shared/types';

// ── Initialise panel (hidden) and start preloading model on page load ──
const panel = initPanel();

// Ask the service worker to start loading the model immediately so it's
// ready before the user first plays a voice message.
void chrome.runtime.sendMessage({ type: 'PRELOAD_MODEL' }).catch(() => {});

// Sync silent mode to injected script
void chrome.storage.local.get(STORAGE_KEYS.silentMode).then(res => {
  window.postMessage({ source: 'WA_TRANSCRIBER_CONTENT', type: 'SYNC_SILENT_MODE', silentMode: !!res[STORAGE_KEYS.silentMode] }, window.location.origin);
}).catch(console.error);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEYS.silentMode]) {
    window.postMessage({ source: 'WA_TRANSCRIBER_CONTENT', type: 'SYNC_SILENT_MODE', silentMode: !!changes[STORAGE_KEYS.silentMode].newValue }, window.location.origin);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────

function float32ToBase64(float32: Float32Array): string {
  const uint8 = new Uint8Array(float32.buffer);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

const processedBlobs = new Set<string>();

// When the user clears the transcription cache, also wipe the in-memory
// blob-URL dedup set so replaying the same voice message re-transcribes it.
window.addEventListener('wa-transcriber:cache-cleared', () => {
  processedBlobs.clear();
  console.log('[WA Transcriber] Blob dedup cache cleared — next play will re-transcribe');
});
// Set to true when TRANSCRIPTION_STOPPED arrives so we don't overwrite the
// "stopped" status with "no text detected" when the pipeline result comes back.
let stoppedByUser = false;

function showStatus(msg: string): void {
  showStatusInPanel(panel, msg);
}

async function getBufferHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Audio interception ─────────────────────────────────────────────────

window.addEventListener('message', (event) => {
  if (event.data?.source !== 'WA_TRANSCRIBER') return;
  if (event.data?.type !== 'AUDIO_SRC_SET') return;

  const { blobUrl } = event.data as { blobUrl: string };
  
  void chrome.storage.local.get(STORAGE_KEYS.isPaused).then(res => {
    if (res[STORAGE_KEYS.isPaused]) {
      console.log('[WA Transcriber] Transcription paused by user.');
      return;
    }

    if (processedBlobs.has(blobUrl)) return;
    processedBlobs.add(blobUrl);
    if (processedBlobs.size > 100) {
      const firstItem = processedBlobs.values().next().value;
      if (firstItem) processedBlobs.delete(firstItem);
    }

    // Fetch immediately — WhatsApp may revoke the blob URL shortly after assigning it
    void handleAudioBlob(blobUrl).catch(console.error);
  }).catch(console.error);
});

// Decode OGG/Opus to 16 kHz mono Float32 PCM here in the content script rather
// than in the offscreen document. The content script runs in the WhatsApp Web
// tab, which has full browser codec support. Chrome MV3 offscreen documents
// lack OGG/Opus support in AudioContext, causing decodeAudioData to throw.
async function decodeAudioToFloat32(
  buffer: ArrayBuffer
): Promise<{ float32: Float32Array; durationS: number; rms: number } | null> {
  try {
    let audioCtx: AudioContext;
    try {
      audioCtx = new AudioContext({ sampleRate: 16000 });
    } catch (e) {
      console.error('[WA Transcriber] AudioContext creation failed (user interaction might be required):', e);
      return null;
    }
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(buffer);
    } finally {
      void audioCtx.close().catch(console.error);
    }
    // .slice() produces an owned Float32Array so its .buffer can be safely transferred
    const float32 = audioBuffer.getChannelData(0).slice();

    const durationS = float32.length / 16000;

    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < float32.length; i++) {
      const v = Math.abs(float32[i]);
      if (v > peak) peak = v;
      sumSq += float32[i] * float32[i];
    }
    const rms = Math.sqrt(sumSq / float32.length);

    // Normalize quiet recordings so Whisper doesn't mistake low amplitude for silence.
    if (peak > 0 && peak < 0.5) {
      const gain = Math.min(1.0 / peak, 4.0);
      for (let i = 0; i < float32.length; i++) float32[i] *= gain;
      console.log('[WA Transcriber] Audio normalized, gain:', gain.toFixed(2));
    }

    console.log('[WA Transcriber] Audio decoded:', {
      durationS: durationS.toFixed(2),
      samples: float32.length,
      peak: peak.toFixed(4),
      rms: rms.toFixed(4),
    });

    return { float32, durationS, rms };
  } catch (err) {
    console.warn('[WA Transcriber] audio decode failed in content script:', err);
    return null;
  }
}

async function handleAudioBlob(blobUrl: string): Promise<void> {
  const prefs = await chrome.storage.local.get([STORAGE_KEYS.selectedLanguage, STORAGE_KEYS.enableTimestamps]);
  const lang = prefs[STORAGE_KEYS.selectedLanguage];
  const returnTimestamps = !!prefs[STORAGE_KEYS.enableTimestamps];
  if (!lang || lang === 'auto') {
    console.warn('[WA Transcriber] Cannot transcribe: language not selected.');
    showLanguagePromptInPanel();
    return;
  }

  let buffer: ArrayBuffer;

  try {
    const response = await fetch(blobUrl);
    buffer = await response.arrayBuffer();
    console.log('[WA Transcriber] Blob fetched:', { byteLength: buffer.byteLength, blobUrl });
  } catch (err) {
    console.warn('[WA Transcriber] fetch blob failed:', err);
    return;
  }

  const hash = await getBufferHash(buffer);

  const cached = await chrome.storage.local.get(hash);
  if (cached[hash]) {
    console.log('[WA Transcriber] Cache hit:', hash.slice(0, 8));
    addTranscription(panel, cached[hash] as string);
    return;
  }

  showStatus(S.decodingAudio);

  const decoded = await decodeAudioToFloat32(buffer);
  if (!decoded) {
    showStatus(S.decodeError);
    return;
  }

  const { float32, durationS, rms } = decoded;

  if (durationS < 0.5) {
    console.log('[WA Transcriber] Audio too short, skipping:', durationS.toFixed(2), 's');
    return;
  }

  const durationLabel = durationS < 60
    ? `${durationS.toFixed(1)}s`
    : `${Math.floor(durationS / 60)}m${Math.floor(durationS % 60)}s`;

  if (rms < 0.001) {
    console.warn('[WA Transcriber] Audio level very low (RMS:', rms, ') — may produce hallucinations');
    showStatus(S.audioQuiet(durationLabel));
  } else {
    showStatus(S.sendingToWhisper(durationLabel));
  }

  const pcmBase64 = float32ToBase64(float32);
  console.log('[WA Transcriber] Sending PCM base64 to SW:', {
    base64Length: pcmBase64.length,
    hash: hash.slice(0, 8),
  });

  // Use a port instead of sendMessage: an open port keeps the service worker
  // alive for the entire duration of the transcription, preventing the
  // "message channel closed" error that kills long transcriptions in MV3.
  stoppedByUser = false;
  setTranscribing(true);
  if (panel) {
    addPendingEntry(panel, hash, S.inQueueBubble(durationLabel));
  }
    const text = await new Promise<string>((resolve) => {
      let settled = false;
      const settle = (result: string) => {
        if (settled) return;
        settled = true;
        setTranscribing(false);
        try { port.disconnect(); } catch { /* already disconnected */ }
        resolve(result);
      };

      const port = chrome.runtime.connect({ name: 'transcriber' });

    port.onMessage.addListener((msg: { type: string; text?: string }) => {
      if (msg.type === 'TRANSCRIBE_RESULT') settle(msg.text ?? '');
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        console.warn('[WA Transcriber] Port disconnected unexpectedly:', chrome.runtime.lastError?.message);
        settle('');
      }
    });

    port.postMessage({ type: 'TRANSCRIBE', pcmBase64, hash, returnTimestamps });
  });

  if (panel) {
    removePendingEntry(panel, hash);
  }

  if (text) {
    stoppedByUser = false;
    addTranscription(panel, text);
  } else if (stoppedByUser) {
    // Status already shows "Transcription stopped." — don't overwrite with "no text".
    stoppedByUser = false;
  } else {
    showStatus(S.noTextInVoice);
  }
}

// ── Extension message listener ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'TOGGLE_PANEL') {
    togglePanel();
  } else if (message.type === 'MODEL_DOWNLOAD_PROGRESS') {
    showStatus(S.downloadingModel(message.progress));
    notifyDownloadProgress(message.progress);
  } else if (message.type === 'STATUS_UPDATE') {
    if (message.hash && panel) {
      updatePendingEntry(panel, message.hash, message.status);
    } else {
      showStatus(message.status);
    }
  } else if (message.type === 'MODEL_LOADED') {
    notifyModelLoaded(message.modelId);
  } else if (message.type === 'MODEL_DELETED') {
    notifyModelDeleted(message.modelId);
  } else if (message.type === 'MODEL_LOAD_FAILED') {
    notifyModelLoadFailed(message.modelId);
  } else if (message.type === 'TRANSCRIPTION_STOPPED') {
    stoppedByUser = true;
    showStatus(S.transcriptionStopped);
  }
});
