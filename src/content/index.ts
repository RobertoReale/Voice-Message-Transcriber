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
} from '../ui/panel';
import { S } from '../shared/strings';
import type { ExtensionMessage } from '../shared/types';

// ── Initialise panel (hidden) and start preloading model on page load ──
const panel = initPanel();

// Ask the service worker to start loading the model immediately so it's
// ready before the user first plays a voice message.
void chrome.runtime.sendMessage({ type: 'PRELOAD_MODEL' }).catch(() => {});

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
  if (processedBlobs.has(blobUrl)) return;
  processedBlobs.add(blobUrl);
  if (processedBlobs.size > 100) {
    const firstItem = processedBlobs.values().next().value;
    if (firstItem) processedBlobs.delete(firstItem);
  }

  // Fetch immediately — WhatsApp may revoke the blob URL shortly after assigning it
  void handleAudioBlob(blobUrl);
});

// Decode OGG/Opus to 16 kHz mono Float32 PCM here in the content script rather
// than in the offscreen document. The content script runs in the WhatsApp Web
// tab, which has full browser codec support. Chrome MV3 offscreen documents
// lack OGG/Opus support in AudioContext, causing decodeAudioData to throw.
async function decodeAudioToFloat32(
  buffer: ArrayBuffer
): Promise<{ float32: Float32Array; durationS: number; rms: number } | null> {
  try {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(buffer);
    } finally {
      void audioCtx.close();
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
  const text = await new Promise<string>((resolve) => {
    let settled = false;
    const settle = (result: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setTranscribing(false);
      try { port.disconnect(); } catch { /* already disconnected */ }
      resolve(result);
    };

    const port = chrome.runtime.connect({ name: 'transcriber' });
    const timer = setTimeout(() => {
      console.warn('[WA Transcriber] transcription timed out');
      settle('');
    }, 180_000);

    port.onMessage.addListener((msg: { type: string; text?: string }) => {
      if (msg.type === 'TRANSCRIBE_RESULT') settle(msg.text ?? '');
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        console.warn('[WA Transcriber] Port disconnected unexpectedly:', chrome.runtime.lastError?.message);
        settle('');
      }
    });

    port.postMessage({ type: 'TRANSCRIBE', pcmBase64, hash });
  });

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
    showStatus(message.status);
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
