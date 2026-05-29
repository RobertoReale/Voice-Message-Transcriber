import { pipeline, env } from '@huggingface/transformers';
import { type ModelId, MODEL_CONFIGS, DEFAULT_MODEL } from '../shared/types';
import { S } from '../shared/strings';

window.addEventListener('unhandledrejection', (event) => {
  console.error('[WA Transcriber] Unhandled Rejection Caught:', event.reason);
  // Prevent Chrome from terminating the offscreen document due to the uncaught error
  event.preventDefault(); 
});

const wasmBase = chrome.runtime.getURL('wasm/');
(env as any).backends.onnx.wasm.wasmPaths = wasmBase;
(env as any).backends.onnx.logLevel = 'fatal';

function isOnnxNoise(msg: string): boolean {
  return msg.includes('VerifyEachNodeIsAssignedToAnEp')
    || msg.includes('Unable to determine content-length')
    || msg.includes('The powerPreference option is currently ignored');
}

const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && isOnnxNoise(args[0])) return;
  originalWarn(...args);
};

const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && isOnnxNoise(args[0])) return;
  originalError(...args);
};

// Use as many threads as available when SharedArrayBuffer is accessible
// (Chrome extension offscreen documents are cross-origin isolated).
// Fall back to 1 thread if SharedArrayBuffer is unavailable for any reason.
const wasmThreads = typeof SharedArrayBuffer !== 'undefined'
  ? Math.min(navigator.hardwareConcurrency || 2, 4)
  : 1;
(env as any).backends.onnx.wasm.numThreads = wasmThreads;
console.log('[WA Transcriber] WASM threads:', wasmThreads);

type TranscriberPipeline = any;
let transcriber: TranscriberPipeline | null = null;
let loadedModelId: ModelId | null = null;
// Tracks an in-progress model load so concurrent calls for the same model share one promise.
let loadingPromise: Promise<TranscriberPipeline> | null = null;
let loadingForModelId: ModelId | null = null;

async function getTranscriber(modelId: ModelId): Promise<TranscriberPipeline> {
  if (transcriber && loadedModelId === modelId) return transcriber;

  // If a load for this exact model is already in flight, piggyback on it.
  if (loadingPromise && loadingForModelId === modelId) return loadingPromise;

  // A different model was requested — discard any previous instance.
  transcriber = null;
  loadedModelId = null;
  loadingForModelId = modelId;

  loadingPromise = (async () => {
    const config = MODEL_CONFIGS[modelId] ?? MODEL_CONFIGS[DEFAULT_MODEL];

    let useWebGPU = false;
    try {
      // ONNX Runtime Web WebGPU backend produces silently wrong outputs for
      // q4 models on Windows (numerical overflow → Whisper hallucinates "[Music]")
      // and crashes with "Can't perform where op" for q8 models.
      // Force WASM for both until ONNX Runtime WebGPU fixes these (tracked at
      // github.com/microsoft/onnxruntime/issues/26732).
      if ((navigator as any).gpu && !['q4', 'q8'].includes(config.dtype)) {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          const crashFlag = localStorage.getItem('webgpu_crash_flag');
          if (crashFlag === modelId) {
            console.warn('[WA Transcriber] Skipping WebGPU because it crashed on the last attempt for model:', modelId);
          } else {
            useWebGPU = true;
          }
        }
      }
    } catch (e) {
      console.warn('[WA Transcriber] WebGPU check failed:', e);
    }
    const deviceType = useWebGPU ? 'webgpu' : 'wasm';

    if (deviceType === 'wasm') {
      // Transformers.js v3 sometimes still tries to compile WebGPU shaders internally 
      // even when device: 'wasm' is passed, crashing the offscreen document.
      // We physically hide navigator.gpu to absolutely guarantee WASM is used.
      try {
        Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true });
      } catch (e) {}
    }

    console.log('[WA Transcriber] Loading model:', { model: modelId, device: deviceType, dtype: config.dtype });
    void chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: S.loadingModel(config.label),
    });

    let filesProgress: Record<string, { loaded: number; total: number }> = {};

    const createPipeline = (device: string) => pipeline('automatic-speech-recognition', modelId, {
      device,
      dtype: config.dtype,
      progress_callback: (info: any) => {
        if (info.status === 'progress') {
          filesProgress[info.file] = { loaded: info.loaded, total: info.total };
          let loaded = 0, total = 0;
          for (const s of Object.values(filesProgress)) { loaded += s.loaded; total += s.total; }
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          void chrome.runtime.sendMessage({ type: 'MODEL_DOWNLOAD_PROGRESS', progress: pct });
        } else if (info.status === 'ready') {
          console.log(`[WA Transcriber] Model ready (${device}):`, modelId);
          void chrome.runtime.sendMessage({ type: 'MODEL_DOWNLOAD_PROGRESS', progress: 100 });
        }
      },
    } as Parameters<typeof pipeline>[2]);

    if (useWebGPU) {
      localStorage.setItem('webgpu_crash_flag', modelId);
    }

    let result: TranscriberPipeline;
    try {
      result = await createPipeline(deviceType);
      if (useWebGPU) {
        localStorage.removeItem('webgpu_crash_flag');
      }
    } catch (err) {
      if (deviceType === 'webgpu') {
        console.warn('[WA Transcriber] WebGPU pipeline failed, falling back to WASM', err);
        filesProgress = {};
        localStorage.removeItem('webgpu_crash_flag');
        result = await createPipeline('wasm');
      } else {
        throw err;
      }
    }

    transcriber = result;
    loadedModelId = modelId;

    void chrome.runtime.sendMessage({ type: 'MODEL_LOADED', modelId });
    void chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status: S.modelReady });

    return transcriber;
  })().finally(() => {
    if (loadingForModelId === modelId) {
      loadingPromise = null;
      loadingForModelId = null;
    }
  });

  return loadingPromise;
}

const HALLUCINATION_RE =
  /^[\s\[\(]*((music|musica|applause|applausi|laughter|risate|silence|silenzio|noise|rumore|sfondo|background)[^\])\w]*)[\s\]\)]*$/i;

function extractText(result: unknown): string {
  const raw = Array.isArray(result)
    ? (result as { text: string }[]).map((r) => r.text).join(' ')
    : (result as { text: string }).text;
  return raw.trim();
}

function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const uint8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  return new Float32Array(uint8.buffer);
}

// Whisper loops always manifest as the SAME phrase repeated CONSECUTIVELY.
// We detect runs of ≥3 identical adjacent segments and cut there.
function deduplicateRepetitions(text: string): string {
  const parts = text.split(/([.!?;]\s+|\s+-\s+)/);
  if (parts.length < 3) return text;

  const segs: string[] = [];
  const puncts: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i].trim().length > 0) {
      segs.push(parts[i]);
      puncts.push(parts[i + 1] || '');
    }
  }

  if (segs.length < 3) return text;

  let runKey = '';
  let runCount = 0;
  let loopStart = -1;
  for (let i = 0; i < segs.length; i++) {
    const key = segs[i].toLowerCase().replace(/\s+/g, ' ').trim();
    if (key === runKey && key.length > 2) {
      runCount++;
      if (runCount >= 3) {
        loopStart = i - (runCount - 1) + 1;
        break;
      }
    } else {
      runKey = key;
      runCount = 1;
    }
  }

  if (loopStart < 0) return text;

  let result = '';
  for (let i = 0; i < loopStart; i++) {
    result += segs[i] + puncts[i];
  }
  return result.trim();
}

function logFloat32Stats(float32: Float32Array): void {
  let min = Infinity, max = -Infinity, sumSq = 0;
  for (let i = 0; i < float32.length; i++) {
    const v = float32[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / float32.length);
  console.log('[WA Transcriber] Float32 stats:', {
    samples: float32.length,
    durationS: (float32.length / 16000).toFixed(2),
    min: min.toFixed(4),
    max: max.toFixed(4),
    rms: rms.toFixed(4),
    isSilent: rms < 0.001,
  });
}

// Serialize transcriptions: if two voice messages arrive before the first finishes,
// the second waits in this chain rather than calling the pipeline concurrently.
let transcribeChain: Promise<unknown> = Promise.resolve();

// Set to true by WHISPER_STOP; reset at the start of each new transcription.
// Allows the pipeline to finish its current forward pass while discarding the result,
// so the loaded model stays in memory for the next use.
let stopRequested = false;

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; pcmBase64?: string; model?: string; language?: string; modelId?: string },
    _sender,
    sendResponse
  ) => {
    if (message.type === 'WHISPER_STOP') {
      stopRequested = true;
      return false;
    }

    if (message.type === 'WHISPER_UNLOAD') {
      if (loadedModelId === message.modelId) {
        transcriber = null;
        loadedModelId = null;
      }
      return false;
    }

    if (message.type === 'WHISPER_PRELOAD') {
      const modelId: ModelId = (message.model as ModelId | undefined) ?? DEFAULT_MODEL;
      void getTranscriber(modelId)
        .catch((err: unknown) => {
          void chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            status: S.downloadError(err instanceof Error ? err.message : String(err)),
          });
          void chrome.runtime.sendMessage({ type: 'MODEL_LOAD_FAILED', modelId });
        });
      return false;
    }

    if (message.type !== 'WHISPER_TRANSCRIBE') return false;

    const sr = sendResponse;
    const pcmBase64 = message.pcmBase64!;
    const modelId: ModelId = (message.model as ModelId | undefined) ?? DEFAULT_MODEL;
    const language: string | undefined =
      message.language && message.language !== 'auto' ? message.language : undefined;

    transcribeChain = transcribeChain
      .then(async () => {
        stopRequested = false;
        try {
          const t = await getTranscriber(modelId);
          const config = MODEL_CONFIGS[modelId] ?? MODEL_CONFIGS[DEFAULT_MODEL];

          const float32 = base64ToFloat32(pcmBase64);
          console.log('[WA Transcriber] pcmBase64 received, decoded length:', float32.length);
          logFloat32Stats(float32);

          const durationS = float32.length / 16000;
          const chunkingOptions: Record<string, number> =
            durationS > 25 ? { chunk_length_s: 30, stride_length_s: 5 } : {};

          void chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            status: S.transcribing(config.label),
          });

          const startMs = Date.now();
          const result = await t(float32, {
            ...(language ? { language } : {}),
            ...chunkingOptions,
            task: 'transcribe',
            return_timestamps: false,
            condition_on_prev_tokens: false,
            num_beams: 1,
            temperature: 0,
            repetition_penalty: 1.1,
            compression_ratio_threshold: 2.4,
            no_speech_threshold: 0.5,
          } as Parameters<TranscriberPipeline>[1]);

          const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
          console.log('[WA Transcriber] Whisper raw result:', result, `(${elapsed}s)`);

          if (stopRequested) {
            console.log('[WA Transcriber] Transcription discarded (user stopped).');
            try { sr(''); } catch { /* channel already closed */ }
            return;
          }

          const text = deduplicateRepetitions(extractText(result));
          console.log('[WA Transcriber] Extracted text:', JSON.stringify(text));

          if (!text || HALLUCINATION_RE.test(text)) {
            console.warn('[WA Transcriber] Hallucination or empty:', JSON.stringify(text));
            void chrome.runtime.sendMessage({
              type: 'STATUS_UPDATE',
              status: text ? S.noiseOnly(text) : S.noText,
            });
            try { sr(''); } catch { /* channel already closed */ }
          } else {
            try { sr(text); } catch { /* channel already closed */ }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[WA Transcriber] Whisper error:', err);
          void chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            status: S.whisperError(errMsg),
          });
          try { sr(''); } catch { /* channel already closed */ }
        }
      })
      .catch(() => { try { sr(''); } catch { /* channel already closed */ } });

    return true;
  }
);
