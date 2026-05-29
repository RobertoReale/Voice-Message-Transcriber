/** Color tokens used by the CSS stylesheet and (sparingly) by JS for dynamic states. */
export const C = {
  bg: '#202c33',
  surface: '#2a3942',
  surfaceHover: '#3b4a54',
  border: '#3b4a54',
  text: '#e9edef',
  textSecondary: '#8696a0',
  green: '#00a884',
  greenDark: '#017561',
  danger: '#f15c6d',
  copied: '#25d366',
};

const STYLE_ID = 'wa-tr-styles';

/**
 * Inject the panel stylesheet into the page. Idempotent — safe to call
 * multiple times; the stylesheet is only inserted once.
 */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* ── Panel root ──────────────────────────────────────────────────── */
    #wa-transcriber-panel {
      position: fixed;
      width: 340px;
      height: 440px;
      min-width: 240px;
      min-height: 160px;
      overflow: hidden;
      resize: both;
      display: flex;
      flex-direction: column;
      background-color: ${C.bg};
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      padding: 0;
      z-index: 2147483647;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: ${C.text};
      border: 1px solid ${C.border};
    }

    /* ── Header ──────────────────────────────────────────────────────── */
    .wa-tr-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid ${C.border};
      background-color: ${C.bg};
      border-radius: 12px 12px 0 0;
      gap: 6px;
      flex-shrink: 0;
      user-select: none;
    }

    .wa-tr-title {
      font-weight: 600;
      font-size: 13px;
      color: ${C.text};
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wa-tr-btn-group {
      display: flex;
      gap: 4px;
      align-items: center;
      flex-shrink: 0;
    }

    /* ── Icon buttons ────────────────────────────────────────────────── */
    .wa-tr-icon-btn {
      border: 1px solid ${C.border};
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      color: ${C.textSecondary};
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      flex-shrink: 0;
      transition: color 0.15s, border-color 0.15s;
      line-height: 1;
    }
    .wa-tr-icon-btn:hover {
      color: ${C.text};
      border-color: ${C.textSecondary};
    }
    .wa-tr-icon-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .wa-tr-icon-btn--active {
      color: ${C.green} !important;
      border-color: ${C.green} !important;
    }
    .wa-tr-icon-btn--success {
      color: ${C.copied} !important;
      border-color: ${C.copied} !important;
    }

    /* ── Settings area ───────────────────────────────────────────────── */
    .wa-tr-settings {
      padding: 10px 12px;
      border-bottom: 1px solid ${C.border};
      background-color: ${C.surface};
      flex-shrink: 0;
    }
    .wa-tr-settings[hidden] { display: none; }

    .wa-tr-settings-label {
      font-size: 10px;
      color: ${C.textSecondary};
      letter-spacing: 0.07em;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .wa-tr-model-row {
      display: flex;
      gap: 6px;
    }

    .wa-tr-model-btn {
      flex: 1;
      padding: 7px 8px;
      border-radius: 8px;
      border: 1px solid ${C.border};
      background: transparent;
      color: ${C.textSecondary};
      font-size: 12px;
      cursor: pointer;
      text-align: left;
      line-height: 1.4;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
    }
    .wa-tr-model-btn--active {
      border-color: ${C.green};
      background: ${C.green}28;
      color: ${C.text};
    }
    .wa-tr-model-btn .wa-tr-model-badge {
      font-size: 15px;
      line-height: 1;
    }
    .wa-tr-model-btn .wa-tr-model-name {
      display: block;
      font-size: 12px;
      font-weight: bold;
      margin-top: 1px;
    }
    .wa-tr-model-btn .wa-tr-model-desc {
      font-size: 10px;
      color: ${C.textSecondary};
    }

    .wa-tr-settings-note {
      font-size: 11px;
      color: ${C.textSecondary};
      margin-top: 8px;
    }
    .wa-tr-settings-note[hidden] { display: none; }

    .wa-tr-download-progress {
      font-size: 11px;
      color: ${C.textSecondary};
      margin-top: 6px;
      text-align: center;
    }
    .wa-tr-download-progress[hidden] { display: none; }

    .wa-tr-download-btn {
      margin-top: 8px;
      width: 100%;
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid ${C.border};
      background: transparent;
      color: ${C.textSecondary};
      font-size: 12px;
      cursor: pointer;
      text-align: center;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .wa-tr-download-btn:hover:not(:disabled) {
      color: ${C.text};
      border-color: ${C.textSecondary};
    }
    .wa-tr-download-btn:disabled,
    .wa-tr-download-btn--ready {
      cursor: default;
      opacity: 1;
      color: ${C.green};
      border-color: ${C.green};
      background: ${C.green}18;
    }

    .wa-tr-delete-model-btn {
      margin-top: 4px;
      width: 100%;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      color: ${C.textSecondary};
      font-size: 11px;
      cursor: pointer;
      text-align: center;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .wa-tr-delete-model-btn:hover:not(:disabled) {
      color: ${C.danger};
      border-color: ${C.danger};
      background: ${C.danger}14;
    }
    .wa-tr-delete-model-btn:disabled { opacity: 0.45; cursor: default; }
    .wa-tr-delete-model-btn[hidden] { display: none; }

    .wa-tr-lang-label {
      font-size: 10px;
      color: ${C.textSecondary};
      letter-spacing: 0.07em;
      font-weight: 600;
      margin-top: 10px;
      margin-bottom: 6px;
    }

    .wa-tr-lang-select {
      width: 100%;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid ${C.border};
      background: ${C.bg};
      color: ${C.text};
      font-size: 12px;
      cursor: pointer;
      outline: none;
    }

    /* ── Content area ────────────────────────────────────────────────── */
    .wa-tr-content {
      padding: 8px 12px 12px;
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    /* ── Empty state ─────────────────────────────────────────────────── */
    .wa-tr-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: ${C.textSecondary};
      text-align: center;
      gap: 6px;
      pointer-events: none;
      user-select: none;
    }
    .wa-tr-empty-icon  { font-size: 34px; opacity: 0.3; }
    .wa-tr-empty-title { font-size: 13px; font-weight: 600; color: ${C.text}; opacity: 0.45; }
    .wa-tr-empty-hint  { font-size: 11px; line-height: 1.6; opacity: 0.35; }

    /* ── Transcription entry ─────────────────────────────────────────── */
    .wa-tr-entry {
      padding: 10px 12px;
      margin-bottom: 6px;
      background: ${C.surface};
      border-radius: 8px;
      cursor: pointer;
      word-break: break-word;
      color: ${C.text};
      font-size: 13px;
      line-height: 1.55;
      transition: background 0.15s;
      border: 1px solid transparent;
    }
    .wa-tr-entry:hover {
      background: ${C.surfaceHover};
      border-color: ${C.border};
    }
    .wa-tr-entry--copied {
      background: ${C.greenDark} !important;
      border-color: ${C.green} !important;
    }

    .wa-tr-entry-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .wa-tr-entry-time {
      font-size: 10px;
      color: ${C.textSecondary};
    }
    .wa-tr-entry-hint {
      font-size: 10px;
      color: ${C.textSecondary};
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .wa-tr-entry--copied .wa-tr-entry-hint {
      color: ${C.copied};
    }

    /* ── Status bar ──────────────────────────────────────────────────── */
    .wa-tr-status {
      padding: 6px 4px;
      font-size: 12px;
      color: ${C.textSecondary};
      border-top: 1px solid ${C.border};
      margin-top: 4px;
    }
  `;
  document.head.appendChild(style);
}
