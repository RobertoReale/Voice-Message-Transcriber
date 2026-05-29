import { S } from '../shared/strings';

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Create the scrollable content area with the empty-state placeholder.
 */
export function createContentArea(): HTMLElement {
  const content = document.createElement('div');
  content.id = 'wa-tr-content';
  content.className = 'wa-tr-content';

  const emptyState = document.createElement('div');
  emptyState.id = 'wa-tr-empty';
  emptyState.className = 'wa-tr-empty';

  const emptyIcon = document.createElement('div');
  emptyIcon.className = 'wa-tr-empty-icon';
  emptyIcon.textContent = '🎙';

  const emptyTitleEl = document.createElement('div');
  emptyTitleEl.className = 'wa-tr-empty-title';
  emptyTitleEl.textContent = S.emptyTitle;

  const emptyHintEl = document.createElement('div');
  emptyHintEl.className = 'wa-tr-empty-hint';
  emptyHintEl.textContent = S.emptyHint;

  const emptyHint2El = document.createElement('div');
  emptyHint2El.className = 'wa-tr-empty-hint';
  emptyHint2El.textContent = S.emptyHint2;

  emptyState.append(emptyIcon, emptyTitleEl, emptyHintEl, emptyHint2El);
  content.appendChild(emptyState);

  return content;
}

/**
 * Append a transcription entry to the content area.
 * Automatically hides the empty state and scrolls to the latest entry.
 * Does NOT force the panel to become visible — the panel stays in whatever
 * display state it was already in.
 *
 * @param container — the panel root element (not the content div).
 */
export function addTranscription(container: HTMLElement, text: string): void {
  // Auto-show the panel so the user actually sees the transcription.
  if (container.style.display === 'none') container.style.display = '';

  const content = getContent(container);
  const emptyEl = content.querySelector<HTMLElement>('#wa-tr-empty');
  if (emptyEl) emptyEl.style.display = 'none';
  const statusEl = content.querySelector<HTMLElement>('#wa-tr-status');
  if (statusEl) statusEl.textContent = '';

  // ── Build entry ──────────────────────────────────────────────────
  const entry = document.createElement('div');
  entry.className = 'wa-tr-entry';

  const meta = document.createElement('div');
  meta.className = 'wa-tr-entry-meta';

  const timeEl = document.createElement('span');
  timeEl.className = 'wa-tr-entry-time';
  timeEl.textContent = new Date().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const hint = document.createElement('span');
  hint.className = 'wa-tr-entry-hint';
  hint.textContent = S.clickToCopy;

  meta.append(timeEl, hint);

  const textEl = document.createElement('div');
  textEl.className = 'wa-tr-text';
  textEl.textContent = text;

  entry.append(meta, textEl);

  // ── Copy on click ────────────────────────────────────────────────
  entry.addEventListener('click', () => {
    void navigator.clipboard.writeText(text).then(() => {
      hint.textContent = S.copied;
      entry.classList.add('wa-tr-entry--copied');
      setTimeout(() => {
        hint.textContent = S.clickToCopy;
        entry.classList.remove('wa-tr-entry--copied');
      }, 1500);
    }).catch(console.error);
  });

  // ── Insert ───────────────────────────────────────────────────────
  if (statusEl) {
    content.insertBefore(entry, statusEl);
  } else {
    content.appendChild(entry);
  }

  updateTitle(container);
  requestAnimationFrame(() => {
    content.scrollTop = content.scrollHeight;
  });
}

/**
 * Show a status message at the bottom of the content area.
 * Works regardless of whether the panel is visible or hidden.
 *
 * @param container — the panel root element (not the content div).
 */
export function showStatusInPanel(container: HTMLElement, msg: string): void {
  const content = getContent(container);
  let status = content.querySelector<HTMLElement>('#wa-tr-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'wa-tr-status';
    status.className = 'wa-tr-status';
    content.appendChild(status);
  }
  status.textContent = msg;
}

export function addPendingEntry(container: HTMLElement, hash: string, text: string): void {
  if (container.style.display === 'none') container.style.display = '';

  const content = getContent(container);
  const emptyEl = content.querySelector<HTMLElement>('#wa-tr-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  const entry = document.createElement('div');
  entry.className = 'wa-tr-entry wa-tr-entry--pending';
  entry.dataset.hash = hash;

  const meta = document.createElement('div');
  meta.className = 'wa-tr-entry-meta';

  const hint = document.createElement('span');
  hint.className = 'wa-tr-entry-hint';
  hint.textContent = '...';
  meta.append(hint);

  const textEl = document.createElement('div');
  textEl.className = 'wa-tr-text';
  textEl.style.opacity = '0.6';
  textEl.style.fontStyle = 'italic';
  textEl.textContent = text;

  entry.append(meta, textEl);

  const statusEl = content.querySelector<HTMLElement>('#wa-tr-status');
  if (statusEl) {
    content.insertBefore(entry, statusEl);
  } else {
    content.appendChild(entry);
  }

  requestAnimationFrame(() => {
    content.scrollTop = content.scrollHeight;
  });
}

export function updatePendingEntry(container: HTMLElement, hash: string, text: string): void {
  const content = getContent(container);
  const entry = content.querySelector<HTMLElement>(`.wa-tr-entry--pending[data-hash="${hash}"]`);
  if (!entry) return;
  const textEl = entry.querySelector<HTMLElement>('.wa-tr-text');
  if (textEl) {
    textEl.textContent = text;
  }
}

export function removePendingEntry(container: HTMLElement, hash: string): void {
  const content = getContent(container);
  const entry = content.querySelector<HTMLElement>(`.wa-tr-entry--pending[data-hash="${hash}"]`);
  if (entry) entry.remove();
}

/**
 * Remove all transcription entries and restore the empty state.
 *
 * @param container — the panel root element.
 */
export function clearEntries(container: HTMLElement): void {
  const content = getContent(container);
  content.querySelectorAll('.wa-tr-entry').forEach((e) => e.remove());
  const emptyEl = content.querySelector<HTMLElement>('#wa-tr-empty');
  if (emptyEl) emptyEl.style.display = 'flex';
  updateTitle(container);
}

/**
 * Collect all visible transcription texts.
 * Returns an array of non-empty strings (empty array if nothing to copy).
 *
 * @param container — the panel root element.
 */
export function copyAllTexts(container: HTMLElement): string[] {
  const content = getContent(container);
  return Array.from(content.querySelectorAll<HTMLElement>('.wa-tr-text'))
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);
}

// ── Internal helpers ───────────────────────────────────────────────────

function getContent(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('#wa-tr-content') ?? container;
}

function updateTitle(container: HTMLElement): void {
  const el = container.querySelector<HTMLElement>('#wa-tr-title');
  if (!el) return;
  const n = container.querySelectorAll('.wa-tr-entry').length;
  el.textContent = n > 0 ? S.titleWithCount(n) : S.title;
}
