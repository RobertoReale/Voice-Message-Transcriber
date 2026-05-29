import {
  type ModelId,
  MODEL_CONFIGS,
  MODEL_IDS,
  DEFAULT_MODEL,
  DEFAULT_LANGUAGE,
  STORAGE_KEYS,
} from '../shared/types';
import { S } from '../shared/strings';

/** Supported transcription languages shown in the dropdown. */
const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: S.selectLanguagePlaceholder },
  { value: 'italian', label: '🇮🇹 Italiano' },
  { value: 'english', label: '🇬🇧 English' },
  { value: 'spanish', label: '🇪🇸 Español' },
  { value: 'french', label: '🇫🇷 Français' },
  { value: 'german', label: '🇩🇪 Deutsch' },
  { value: 'portuguese', label: '🇵🇹 Português' },
  { value: 'dutch', label: '🇳🇱 Nederlands' },
  { value: 'russian', label: '🇷🇺 Русский' },
  { value: 'polish', label: '🇵🇱 Polski' },
  { value: 'turkish', label: '🇹🇷 Türkçe' },
  { value: 'arabic', label: '🇸🇦 العربية' },
  { value: 'japanese', label: '🇯🇵 日本語' },
  { value: 'chinese', label: '🇨🇳 中文' },
];

export interface SettingsArea {
  /** The container element to insert into the panel DOM. */
  element: HTMLElement;
  /** Toggle visibility. Returns `true` if now visible, `false` if hidden. */
  toggle(forceShow?: boolean): boolean;
  /** Show the language selection prompt banner. */
  showLanguagePrompt(): void;
  /** Called when a model finishes loading — updates the download button state. */
  onModelLoaded(modelId: string): void;
  /** Called with download progress (0-100) so the settings panel shows feedback. */
  onDownloadProgress(pct: number): void;
  /** Called when a model has been deleted from cache — resets download button. */
  onModelDeleted(modelId: string): void;
  /** Called when a model fails to load — re-enables the download button. */
  onModelLoadFailed(modelId: string): void;
}

/**
 * Create the settings panel with model selector, language selector,
 * and a download button. Self-contained — manages its own state.
 */
export function createSettings(): SettingsArea {
  const container = document.createElement('div');
  container.className = 'wa-tr-settings';
  container.hidden = true;

  // ── Language Prompt Banner ───────────────────────────────────────
  const langPromptBanner = document.createElement('div');
  langPromptBanner.className = 'wa-tr-lang-prompt-banner';
  langPromptBanner.textContent = S.promptSelectLanguage;
  langPromptBanner.hidden = true;
  langPromptBanner.style.backgroundColor = '#fff3cd';
  langPromptBanner.style.color = '#856404';
  langPromptBanner.style.padding = '8px';
  langPromptBanner.style.marginBottom = '12px';
  langPromptBanner.style.borderRadius = '4px';
  langPromptBanner.style.fontSize = '13px';
  langPromptBanner.style.fontWeight = '500';

  // ── Model label ──────────────────────────────────────────────────
  const modelLabel = document.createElement('div');
  modelLabel.className = 'wa-tr-settings-label';
  modelLabel.textContent = S.labelModel;

  // ── Model buttons ────────────────────────────────────────────────
  const modelRow = document.createElement('div');
  modelRow.className = 'wa-tr-model-row';

  const modelBtns: Array<{ btn: HTMLButtonElement; id: ModelId }> = [];

  let currentModelId: ModelId = DEFAULT_MODEL;
  const downloadedModelIds = new Set<string>();
  // Populated only when MODEL_LOADED is received in the current session.
  // Prevents stale storage flags from showing "ready" when the browser cache was cleared.
  const sessionReadyModelIds = new Set<string>();
  // True while any model download is in progress — prevents concurrent downloads
  // which would cause a race where the slower model overwrites the in-memory transcriber.
  let isDownloading = false;

  function updateDownloadButton(): void {
    const confirmedReady = sessionReadyModelIds.has(currentModelId);
    const everDownloaded  = downloadedModelIds.has(currentModelId);

    if (confirmedReady) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = S.modelDownloaded;
      downloadBtn.classList.add('wa-tr-download-btn--ready');
    } else if (everDownloaded) {
      // Model was downloaded before but hasn't confirmed ready yet this session
      // (e.g. preload in progress, or browser cache was cleared).
      downloadBtn.disabled = true;
      downloadBtn.textContent = S.loadingModel(MODEL_CONFIGS[currentModelId].label);
      downloadBtn.classList.remove('wa-tr-download-btn--ready');
    } else if (isDownloading) {
      // A different model is currently downloading — block concurrent downloads
      // to avoid a race where the slower download overwrites the in-memory model.
      downloadBtn.disabled = true;
      downloadBtn.textContent = S.anotherModelDownloading;
      downloadBtn.classList.remove('wa-tr-download-btn--ready');
    } else {
      downloadBtn.disabled = false;
      downloadBtn.textContent = S.downloadModel;
      downloadBtn.classList.remove('wa-tr-download-btn--ready');
    }

    deleteBtn.hidden = !confirmedReady && !everDownloaded;
    deleteBtn.disabled = false;
  }

  function setActiveModel(selected: ModelId): void {
    currentModelId = selected;
    for (const { btn, id } of modelBtns) {
      btn.classList.toggle('wa-tr-model-btn--active', id === selected);
    }
    updateDownloadButton();
  }

  const settingsNote = document.createElement('div');
  settingsNote.className = 'wa-tr-settings-note';
  settingsNote.textContent = S.settingsNote;
  settingsNote.hidden = true;

  for (const id of MODEL_IDS) {
    const cfg = MODEL_CONFIGS[id];
    const btn = document.createElement('button');
    btn.className = 'wa-tr-model-btn';
    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'wa-tr-model-badge';
    badgeSpan.textContent = cfg.badge;

    const nameStrong = document.createElement('strong');
    nameStrong.className = 'wa-tr-model-name';
    nameStrong.textContent = cfg.label;

    const descSpan = document.createElement('span');
    descSpan.className = 'wa-tr-model-desc';
    descSpan.textContent = cfg.desc;

    btn.append(badgeSpan, ' ', nameStrong, descSpan);

    btn.addEventListener('click', () => {
      void chrome.storage.local.set({ [STORAGE_KEYS.selectedModel]: id });
      setActiveModel(id);
      settingsNote.hidden = false;
    });

    modelBtns.push({ btn, id });
    modelRow.appendChild(btn);
  }

  // ── Download button ──────────────────────────────────────────────
  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'wa-tr-download-btn';
  downloadBtn.textContent = S.downloadModel;
  downloadBtn.addEventListener('click', () => {
    if (downloadBtn.disabled) return;
    isDownloading = true;
    downloadBtn.disabled = true;
    downloadBtn.textContent = S.downloadingModel(0);
    void chrome.runtime.sendMessage({ type: 'PRELOAD_MODEL' });
  });

  // ── Delete button ────────────────────────────────────────────────
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'wa-tr-delete-model-btn';
  deleteBtn.textContent = S.deleteModel;
  deleteBtn.title = S.deleteModelTitle;
  deleteBtn.hidden = true;
  deleteBtn.addEventListener('click', () => {
    deleteBtn.disabled = true;
    void chrome.runtime.sendMessage({ type: 'DELETE_MODEL', modelId: currentModelId });
  });

  const downloadProgress = document.createElement('div');
  downloadProgress.className = 'wa-tr-download-progress';
  downloadProgress.hidden = true;

  // ── Language label ───────────────────────────────────────────────
  const langLabel = document.createElement('div');
  langLabel.className = 'wa-tr-lang-label';
  langLabel.textContent = S.labelLanguage;

  // ── Language select ──────────────────────────────────────────────
  const langSelect = document.createElement('select');
  langSelect.className = 'wa-tr-lang-select';

  for (const { value, label } of LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === '') opt.disabled = true;
    langSelect.appendChild(opt);
  }

  langSelect.addEventListener('change', () => {
    void chrome.storage.local.set({
      [STORAGE_KEYS.selectedLanguage]: langSelect.value,
    });
    langPromptBanner.hidden = true;
  });

  // ── Load persisted state ─────────────────────────────────────────
  void chrome.storage.local.get([
    STORAGE_KEYS.selectedModel,
    STORAGE_KEYS.selectedLanguage,
    STORAGE_KEYS.downloadedModels,
  ]).then((res) => {
    const rawModel = res[STORAGE_KEYS.selectedModel] as string | undefined;
    const savedModel: ModelId = MODEL_IDS.includes(rawModel as ModelId)
      ? (rawModel as ModelId)
      : DEFAULT_MODEL;
    const savedLang = (res[STORAGE_KEYS.selectedLanguage] as string | undefined) ?? DEFAULT_LANGUAGE;
    const downloaded = (res[STORAGE_KEYS.downloadedModels] as string[] | undefined) ?? [];

    for (const id of downloaded) downloadedModelIds.add(id);
    langSelect.value = savedLang;
    setActiveModel(savedModel); // also calls updateDownloadButton
  });

  // ── Assemble ─────────────────────────────────────────────────────
  container.append(
    langPromptBanner,
    modelLabel,
    modelRow,
    settingsNote,
    langLabel,
    langSelect,
    downloadBtn,
    deleteBtn,
    downloadProgress,
  );

  return {
    element: container,
    toggle(forceShow?: boolean): boolean {
      if (forceShow !== undefined) {
        container.hidden = !forceShow;
      } else {
        container.hidden = !container.hidden;
      }
      return !container.hidden;
    },
    showLanguagePrompt(): void {
      langPromptBanner.hidden = false;
      langSelect.focus();
    },
    onModelLoaded(modelId: string): void {
      isDownloading = false;
      downloadedModelIds.add(modelId);
      sessionReadyModelIds.add(modelId);
      downloadProgress.hidden = true;
      updateDownloadButton(); // always refresh — isDownloading may unblock other models
    },
    onDownloadProgress(pct: number): void {
      downloadBtn.disabled = true;
      downloadBtn.textContent = S.downloadingModel(pct);
      downloadProgress.textContent = `${pct}%`;
      downloadProgress.hidden = false;
    },
    onModelDeleted(modelId: string): void {
      downloadedModelIds.delete(modelId);
      sessionReadyModelIds.delete(modelId);
      if (modelId === currentModelId) updateDownloadButton();
    },
    onModelLoadFailed(modelId: string): void {
      isDownloading = false;
      // Also remove from downloadedModels in case reconciliation added it (e.g. incomplete cache)
      downloadedModelIds.delete(modelId);
      downloadProgress.hidden = true;
      updateDownloadButton();
    },
  };
}
