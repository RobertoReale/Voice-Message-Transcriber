/**
 * All user-facing strings, centralised for easy maintenance and future i18n.
 */
export const S = {
  // Panel header
  title: '🎙 Transcriptions',
  titleWithCount: (n: number) => `🎙 Transcriptions (${n})`,

  // Empty state
  emptyTitle: 'No transcriptions yet',
  emptyHint: 'Play a voice message',
  emptyHint2: 'to see it transcribed here',

  // Header button tooltips
  tipExport: 'Export transcriptions to file',
  tipCopyAll: 'Copy all transcriptions',
  tipClearList: 'Clear visible transcriptions (cache is preserved)',
  tipClearCache: 'Clear cache — allows re-transcribing the same audio',
  tipSettings: 'Model settings',
  tipClose: 'Hide panel (reopen from extension icon)',
  tipStop: 'Stop transcription',

  // Settings
  labelModel: 'WHISPER MODEL',
  labelLanguage: 'TRANSCRIPTION LANGUAGE',
  labelTimestamps: 'Show timestamps in transcription',
  labelSilentMode: 'Silent Mode (mute audio while transcribing)',
  settingsNote: 'ℹ The new model will be used from the next transcription',
  downloadModel: '⬇ Download / load selected model',
  modelDownloaded: '✓ Model ready',
  autoDetect: '🌐 Auto (detect language)',
  promptSelectLanguage: 'Please select a language to enable transcriptions.',
  selectLanguagePlaceholder: 'Select a language...',

  // Content-script status messages
  decodingAudio: 'Decoding audio...',
  decodeError: 'Unable to decode audio (unsupported format?)',
  audioQuiet: (dur: string) =>
    `Audio is very quiet (${dur}) — transcription may be inaccurate`,
  sendingToWhisper: (dur: string) => `Audio ${dur} — sending to Whisper...`,
  modelNotReady: 'Model not ready — open settings to download it first',
  noTextInVoice: 'No text detected in voice message',
  transcriptionFailed: 'Transcription failed',
  downloadingModel: (pct: number) => `Downloading Whisper model: ${pct}%`,

  // Whisper offscreen status messages
  loadingModel: (label: string) => `Loading ${label}...`,
  modelReady: 'Model ready ✓',
  downloadError: (msg: string) => `Download error: ${msg}`,
  transcribing: (label: string) =>
    `Transcribing with ${label} (this may take a minute)...`,
  noiseOnly: (text: string) =>
    `Whisper detected only noise: "${text}" — try with a clearer voice message`,
  noText: 'No text detected',
  whisperError: (msg: string) => `Whisper error: ${msg}`,
  transcriptionStopped: 'Transcription stopped.',

  // Model deletion / download state
  deleteModel: '🗑 Delete model from device',
  deleteModelTitle: 'Remove downloaded model files from browser cache',
  anotherModelDownloading: '⏳ Another model is downloading…',

  // Copy interaction
  clickToCopy: 'Click to copy',
  copied: '✓ Copied!',
} as const;
