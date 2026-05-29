// ── Model configuration ────────────────────────────────────────────────

export type ModelId =
  | 'onnx-community/whisper-tiny'
  | 'onnx-community/whisper-small'
  | 'onnx-community/whisper-large-v3-turbo';

export interface ModelConfig {
  dtype: string;
  label: string;
  badge: string;
  desc: string;
}

export const MODEL_CONFIGS: Record<ModelId, ModelConfig> = {
  'onnx-community/whisper-tiny': {
    dtype: 'q4',
    label: 'Whisper Tiny',
    badge: '🚀',
    desc: '~40 MB · fastest',
  },
  'onnx-community/whisper-small': {
    dtype: 'q4',
    label: 'Whisper Small',
    badge: '⚡',
    desc: '~130 MB · fast',
  },
  'onnx-community/whisper-large-v3-turbo': {
    dtype: 'q4',
    label: 'Whisper Large v3 Turbo',
    badge: '🎯',
    desc: '~800 MB · more accurate',
  },
};

export const MODEL_IDS = Object.keys(MODEL_CONFIGS) as ModelId[];

export const DEFAULT_MODEL: ModelId = 'onnx-community/whisper-small';
export const DEFAULT_LANGUAGE = '';

// ── Storage keys (avoids magic strings) ────────────────────────────────

export const STORAGE_KEYS = {
  selectedModel: 'selectedModel',
  selectedLanguage: 'selectedLanguage',
  /** Array of model IDs that have been successfully loaded at least once. */
  downloadedModels: 'downloadedModels',
  /** Last known panel position { left: string, top: string } in CSS px values. */
  panelPosition: 'panelPosition',
  enableTimestamps: 'enableTimestamps',
  silentMode: 'silentMode',
  isPaused: 'isPaused',
} as const;

// ── Extension messages (discriminated union) ───────────────────────────

export type ExtensionMessage =
  | { type: 'TOGGLE_PANEL' }
  | { type: 'TRANSCRIBE'; pcmBase64: string; hash: string; returnTimestamps?: boolean }
  | { type: 'WHISPER_TRANSCRIBE'; pcmBase64: string; model: string; language?: string; returnTimestamps?: boolean }
  | { type: 'WHISPER_PRELOAD'; model: string }
  | { type: 'WHISPER_STOP' }
  | { type: 'WHISPER_UNLOAD'; modelId: string }
  | { type: 'STOP_TRANSCRIPTION' }
  /** Broadcast to all WA tabs when user clicks Stop — lets content script suppress the "no text" fallback. */
  | { type: 'TRANSCRIPTION_STOPPED' }
  | { type: 'MODEL_DOWNLOAD_PROGRESS'; progress: number }
  | { type: 'STATUS_UPDATE'; status: string; hash?: string }
  | { type: 'PRELOAD_MODEL' }
  /** Sent by offscreen when a model finishes loading (downloaded + in memory). */
  | { type: 'MODEL_LOADED'; modelId: string }
  /** Sent by content script to request model deletion from cache. */
  | { type: 'DELETE_MODEL'; modelId: string }
  /** Broadcast to all WA tabs after a model has been deleted from cache. */
  | { type: 'MODEL_DELETED'; modelId: string }
  /** Broadcast to all WA tabs when a model fails to load (download error, etc.). */
  | { type: 'MODEL_LOAD_FAILED'; modelId: string };
