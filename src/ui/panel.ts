import { injectStyles } from './styles';
import { makeDraggable } from './drag';
import { createSettings, type SettingsArea } from './settings';
import {
  createContentArea,
  addTranscription as addEntry,
  showStatusInPanel as showStatus,
  clearEntries,
  copyAllTexts,
} from './transcriptions';
import { S } from '../shared/strings';
import { STORAGE_KEYS } from '../shared/types';

let panel: HTMLElement | null = null;
let settingsInstance: SettingsArea | null = null;
let dragController: AbortController | null = null;
let stopBtnEl: HTMLButtonElement | null = null;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Create the panel (hidden) and attach it to the document body.
 * Safe to call multiple times — returns the existing panel if already present.
 * The panel starts hidden; use togglePanel() to show it.
 */
export function initPanel(): HTMLElement {
  if (panel && document.contains(panel)) return panel;

  dragController?.abort();
  injectStyles();

  panel = document.createElement('div');
  panel.id = 'wa-transcriber-panel';
  panel.style.left = `${Math.max(10, window.innerWidth - 360)}px`;
  panel.style.top  = `${Math.max(10, window.innerHeight - 520)}px`;
  // Panel starts hidden — only shown when user clicks the extension icon.
  panel.style.display = 'none';

  // Restore saved position asynchronously, clamped to current viewport.
  // Also check if language is selected on load.
  void chrome.storage.local.get([STORAGE_KEYS.panelPosition, STORAGE_KEYS.selectedLanguage]).then((res) => {
    const saved = res[STORAGE_KEYS.panelPosition] as { left: string; top: string } | undefined;
    if (saved && panel) {
      const leftPx = Math.min(Math.max(0, parseInt(saved.left, 10)), window.innerWidth - 240);
      const topPx  = Math.min(Math.max(0, parseInt(saved.top,  10)), window.innerHeight - 60);
      panel.style.left = `${leftPx}px`;
      panel.style.top  = `${topPx}px`;
    }

    const savedLang = res[STORAGE_KEYS.selectedLanguage];
    if (!savedLang || savedLang === 'auto') {
      panel!.style.display = '';
      settingsInstance?.toggle(true);
      settingsInstance?.showLanguagePrompt();
      const contentEl = panel!.querySelector<HTMLElement>('#wa-tr-content');
      if (contentEl) contentEl.style.display = 'none';
      // Highlight the settings button by finding it in the DOM
      const settingsBtn = panel!.querySelector('.wa-tr-btn-group button[title="' + S.tipSettings + '"]');
      if (settingsBtn) settingsBtn.classList.add('wa-tr-icon-btn--active');
    }
  });

  // ── Header ─────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'wa-tr-header';

  const title = document.createElement('span');
  title.id = 'wa-tr-title';
  title.className = 'wa-tr-title';
  title.textContent = S.title;

  const exportBtn   = iconBtn('💾', S.tipExport);
  const copyAllBtn  = iconBtn('📋', S.tipCopyAll);
  const clearListBtn = iconBtn('🗑', S.tipClearList);
  const clearCacheBtn = iconBtn('↺', S.tipClearCache);
  clearCacheBtn.style.fontSize = '16px';
  const settingsBtn = iconBtn('⚙', S.tipSettings);
  settingsBtn.style.fontSize = '14px';
  const closeBtn = iconBtn('✕', S.tipClose);
  closeBtn.style.fontSize = '12px';

  stopBtnEl = iconBtn('⏹', S.tipStop);
  stopBtnEl.style.fontSize = '12px';
  stopBtnEl.disabled = true;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'wa-tr-btn-group';
  btnGroup.append(stopBtnEl, exportBtn, copyAllBtn, clearListBtn, clearCacheBtn, settingsBtn, closeBtn);

  header.append(title, btnGroup);

  // ── Settings & Content ─────────────────────────────────────────
  settingsInstance = createSettings();
  const contentEl = createContentArea();

  panel.append(header, settingsInstance.element, contentEl);
  document.body.appendChild(panel);
  dragController = makeDraggable(panel, header, (left, top) => {
    void chrome.storage.local.set({ [STORAGE_KEYS.panelPosition]: { left, top } });
  });

  // ── Event wiring ───────────────────────────────────────────────
  closeBtn.addEventListener('click', () => {
    panel!.style.display = 'none';
  });

  stopBtnEl.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'STOP_TRANSCRIPTION' });
    flashButton(stopBtnEl!, '✓', 'wa-tr-icon-btn--success', 1000);
  });

  settingsBtn.addEventListener('click', () => {
    const visible = settingsInstance!.toggle();
    settingsBtn.classList.toggle('wa-tr-icon-btn--active', visible);
    const contentEl = panel!.querySelector<HTMLElement>('#wa-tr-content');
    if (contentEl) {
      contentEl.style.display = visible ? 'none' : '';
    }
  });

  exportBtn.addEventListener('click', () => {
    const texts = copyAllTexts(panel!);
    if (texts.length === 0) return;
    const blob = new Blob([texts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcriptions-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flashButton(exportBtn, '✓', 'wa-tr-icon-btn--success', 1500);
  });

  copyAllBtn.addEventListener('click', () => {
    const texts = copyAllTexts(panel!);
    if (texts.length === 0) return;
    void navigator.clipboard.writeText(texts.join('\n\n')).then(() => {
      flashButton(copyAllBtn, '✓', 'wa-tr-icon-btn--success', 1500);
    });
  });

  clearListBtn.addEventListener('click', () => {
    clearEntries(panel!);
  });

  clearCacheBtn.addEventListener('click', () => {
    void (async () => {
      // Preserve user preferences and downloaded-model flags across cache wipe.
      const prefs = await chrome.storage.local.get([
        STORAGE_KEYS.selectedModel,
        STORAGE_KEYS.selectedLanguage,
        STORAGE_KEYS.downloadedModels,
      ]);
      await chrome.storage.local.clear();
      const restore: Record<string, unknown> = {};
      if (prefs[STORAGE_KEYS.selectedModel])
        restore[STORAGE_KEYS.selectedModel] = prefs[STORAGE_KEYS.selectedModel];
      if (prefs[STORAGE_KEYS.selectedLanguage])
        restore[STORAGE_KEYS.selectedLanguage] = prefs[STORAGE_KEYS.selectedLanguage];
      if (prefs[STORAGE_KEYS.downloadedModels])
        restore[STORAGE_KEYS.downloadedModels] = prefs[STORAGE_KEYS.downloadedModels];
      if (Object.keys(restore).length > 0)
        await chrome.storage.local.set(restore);

      flashButton(clearCacheBtn, '✓', 'wa-tr-icon-btn--active', 1800);
      // Tell the content script to clear its in-memory blob-URL dedup set so
      // replaying the same voice message re-triggers transcription.
      window.dispatchEvent(new CustomEvent('wa-transcriber:cache-cleared'));
    })();
  });

  return panel;
}

/**
 * Toggle the panel visibility.
 * If the panel hasn't been created yet, creates it and makes it visible.
 */
export function togglePanel(): void {
  if (!panel || !document.contains(panel)) {
    initPanel();
    panel!.style.display = '';
    return;
  }
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

/**
 * Force show the panel, open the settings, and display the language prompt.
 */
export function showLanguagePromptInPanel(): void {
  if (!panel || !document.contains(panel)) {
    initPanel();
  }
  panel!.style.display = '';
  settingsInstance?.toggle(true);
  settingsInstance?.showLanguagePrompt();
  const contentEl = panel!.querySelector<HTMLElement>('#wa-tr-content');
  if (contentEl) contentEl.style.display = 'none';
  const settingsBtn = panel!.querySelector('.wa-tr-btn-group button[title="' + S.tipSettings + '"]');
  if (settingsBtn) settingsBtn.classList.add('wa-tr-icon-btn--active');
}

/**
 * Forward a MODEL_LOADED notification to the settings component so it can
 * update the download button state.
 */
export function notifyModelLoaded(modelId: string): void {
  settingsInstance?.onModelLoaded(modelId);
}

/**
 * Forward download progress to the settings panel (visible even when the
 * content area is hidden behind the settings view).
 */
export function notifyDownloadProgress(pct: number): void {
  settingsInstance?.onDownloadProgress(pct);
}

/**
 * Enable or disable the stop button based on whether a transcription is active.
 */
export function setTranscribing(active: boolean): void {
  if (stopBtnEl) stopBtnEl.disabled = !active;
}

/**
 * Forward a MODEL_DELETED notification to the settings component so it can
 * reset the download button.
 */
export function notifyModelDeleted(modelId: string): void {
  settingsInstance?.onModelDeleted(modelId);
}

/**
 * Forward a MODEL_LOAD_FAILED notification so the download button is re-enabled.
 */
export function notifyModelLoadFailed(modelId: string): void {
  settingsInstance?.onModelLoadFailed(modelId);
}

// Re-export sub-module functions with the signatures the content script expects.
export { addEntry as addTranscription, showStatus as showStatusInPanel };

// ── Internal helpers ───────────────────────────────────────────────────

function iconBtn(label: string, tip: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'wa-tr-icon-btn';
  btn.textContent = label;
  btn.title = tip;
  return btn;
}

/** Temporarily change button text and add a CSS class, then revert. */
function flashButton(
  btn: HTMLButtonElement,
  tempText: string,
  cssClass: string,
  durationMs: number,
): void {
  const orig = btn.textContent!;
  btn.textContent = tempText;
  btn.classList.add(cssClass);
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove(cssClass);
  }, durationMs);
}
