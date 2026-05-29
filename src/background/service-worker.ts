import {
  type ExtensionMessage,
  type ModelId,
  DEFAULT_MODEL,
  DEFAULT_LANGUAGE,
  STORAGE_KEYS,
  MODEL_IDS,
} from '../shared/types';

// ── Cache helpers ─────────────────────────────────────────────────────────

/**
 * On fresh install, the browser cache (transformers-cache) may still contain
 * model files from a previous install. Scan the cache and reconcile the
 * downloadedModels storage key so the UI reflects what's actually on-device.
 */
async function reconcileModelCache(): Promise<void> {
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    const urls = keys.map(r => r.url);

    // Evict cached files for model IDs no longer in the supported list so
    // stale q4 onnx-community entries can't be loaded by a downlevel build.
    await Promise.all(
      keys
        .filter(req => !MODEL_IDS.some(id => req.url.includes(id)))
        .map(req => cache.delete(req))
    );

    // Require at least one ONNX file to be cached — config.json alone (from a
    // very early interrupted download) is not enough to use the model.
    const cached = MODEL_IDS.filter(id => {
      const modelUrls = urls.filter(url => url.includes(id));
      return modelUrls.some(url => url.includes('.onnx'));
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.downloadedModels]: cached });

    // Reset selectedModel if it's no longer a valid model ID (e.g. after
    // onnx-community models were removed from the supported list).
    const prefs = await chrome.storage.local.get(STORAGE_KEYS.selectedModel);
    const raw = prefs[STORAGE_KEYS.selectedModel] as string | undefined;
    if (raw && !MODEL_IDS.includes(raw as ModelId)) {
      await chrome.storage.local.set({ [STORAGE_KEYS.selectedModel]: DEFAULT_MODEL });
      console.log('[WA Transcriber] Reset invalid selectedModel from', raw, 'to', DEFAULT_MODEL);
    }

    console.log('[WA Transcriber] Reconciled model cache:', cached);
  } catch (e) {
    console.warn('[WA Transcriber] Cache reconciliation failed:', e);
  }
}

async function deleteModelFromCache(modelId: string): Promise<void> {
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    await Promise.all(
      keys.filter(req => req.url.includes(modelId)).map(req => cache.delete(req))
    );
    console.log('[WA Transcriber] Deleted model from cache:', modelId);
  } catch (e) {
    console.warn('[WA Transcriber] Failed to delete model from cache:', e);
  }
}

// On fresh install, carry over any model files left in the browser cache
// from a previous installation so the user doesn't have to re-download.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') void reconcileModelCache();
});

// Toggle the transcription panel in the active WhatsApp tab when the user
// clicks the extension icon in the Chrome toolbar.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    void chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {});
  }
});

let creatingOffscreen: Promise<void> | null = null;

async function setupOffscreenDocument() {
  const exists = await chrome.offscreen.hasDocument();
  if (exists) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('offscreen.html'),
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Running transformers.js for local Whisper transcription',
  }).finally(() => {
    creatingOffscreen = null;
  });
  await creatingOffscreen;
}

/** Forward a message to every open tab on a supported platform. */
async function broadcastToWaTabs(message: ExtensionMessage): Promise<void> {
  const tabs = await chrome.tabs.query({ url: [
    '*://web.whatsapp.com/*',
    '*://web.telegram.org/*',
    '*://discord.com/*',
  ] });
  for (const tab of tabs) {
    if (tab.id) void chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

async function sendToOffscreen(
  pcmBase64: string,
  modelId: ModelId,
  language: string,
  returnTimestamps?: boolean,
  hash?: string
): Promise<string> {
  // Retry a few times in case the offscreen document's listener isn't
  // registered yet (race window right after createDocument resolves).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = (await chrome.runtime.sendMessage({
        type: 'WHISPER_TRANSCRIBE',
        pcmBase64,
        model: modelId,
        language,
        returnTimestamps,
        hash,
      })) as string | undefined;
      return text ?? '';
    } catch (err) {
      const msg = String(err);
      if (msg.includes('Receiving end does not exist') && attempt < 2) {
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        await setupOffscreenDocument();
        continue;
      }
      throw err;
    }
  }
  return '';
}

// ── Port-based transcription handler ─────────────────────────────────────
// Using a port (instead of sendMessage) keeps the service worker alive for
// the entire duration of the transcription. Chrome guarantees the SW is not
// killed while at least one port is connected.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'transcriber') return;

  port.onMessage.addListener(async (message: { type: string; pcmBase64?: string; hash?: string; returnTimestamps?: boolean }) => {
    if (message.type !== 'TRANSCRIBE') return;

    await setupOffscreenDocument();

    console.log('[WA Transcriber SW] Forwarding to offscreen, pcmBase64.length:', message.pcmBase64?.length);

    const prefs = await chrome.storage.local.get([
      STORAGE_KEYS.selectedModel,
      STORAGE_KEYS.selectedLanguage,
    ]);
    const rawModel = (prefs[STORAGE_KEYS.selectedModel] as string | undefined) || DEFAULT_MODEL;
    const modelId: ModelId = MODEL_IDS.includes(rawModel as ModelId) ? (rawModel as ModelId) : DEFAULT_MODEL;
    const language =
      (prefs[STORAGE_KEYS.selectedLanguage] as string | undefined) || DEFAULT_LANGUAGE;

    if (!language || language === 'auto') {
      console.warn('[WA Transcriber SW] Transcription blocked: no language selected.');
      try { port.postMessage({ type: 'TRANSCRIBE_RESULT', text: '' }); } catch {}
      return;
    }

    let text = '';
    try {
      text = await sendToOffscreen(message.pcmBase64!, modelId, language, message.returnTimestamps, message.hash);
      console.log('[WA Transcriber SW] Offscreen response:', JSON.stringify(text));
    } catch (err) {
      if (String(err).includes('message channel closed')) {
        console.log('[WA Transcriber SW] Transcription stopped by user.');
      } else {
        console.error('[WA Transcriber SW] offscreen transcription error:', err);
      }
    }

    if (message.hash && text) {
      await chrome.storage.local.set({ [message.hash]: text });
    }

    try {
      port.postMessage({ type: 'TRANSCRIBE_RESULT', text });
    } catch {
      // Port was disconnected (tab closed, etc.) — nothing to do.
    }
  });
});

// ── sendMessage handler (status relay, model events, preload, stop) ───────
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender,
    sendResponse
  ) => {
    // ── Relay progress / status to WhatsApp tabs ──────────────────────
    if (message.type === 'MODEL_DOWNLOAD_PROGRESS' || message.type === 'STATUS_UPDATE') {
      void broadcastToWaTabs(message);
      return false;
    }

    // ── Model load failed: broadcast to tabs so UI can re-enable button ──
    if (message.type === 'MODEL_LOAD_FAILED') {
      void broadcastToWaTabs(message);
      return false;
    }

    // ── Model loaded: persist to storage + broadcast to tabs ──────────
    if (message.type === 'MODEL_LOADED') {
      void (async () => {
        const res = await chrome.storage.local.get(STORAGE_KEYS.downloadedModels);
        const downloaded = (res[STORAGE_KEYS.downloadedModels] as string[]) ?? [];
        if (!downloaded.includes(message.modelId)) {
          downloaded.push(message.modelId);
          await chrome.storage.local.set({ [STORAGE_KEYS.downloadedModels]: downloaded });
        }
        await broadcastToWaTabs(message);
      })();
      return false;
    }

    // ── Preload model (triggered by content script on page load) ───────
    if (message.type === 'PRELOAD_MODEL') {
      void (async () => {
        try {
          await setupOffscreenDocument();
          const res = await chrome.storage.local.get(STORAGE_KEYS.selectedModel);
          const rawModel = (res[STORAGE_KEYS.selectedModel] as string) || DEFAULT_MODEL;
          const modelId: ModelId = MODEL_IDS.includes(rawModel as ModelId) ? (rawModel as ModelId) : DEFAULT_MODEL;
          // Fire-and-forget: offscreen handles progress/ready notifications itself.
          void chrome.runtime.sendMessage({ type: 'WHISPER_PRELOAD', model: modelId });
        } catch (_) { /* ignore */ }
        sendResponse(null);
      })();
      return true;
    }

    if (message.type === 'STOP_TRANSCRIPTION') {
      void (async () => {
        // Signal the offscreen to discard the current result without unloading the model.
        if (await chrome.offscreen.hasDocument()) {
          void chrome.runtime.sendMessage({ type: 'WHISPER_STOP' });
        }
        // Notify all WA tabs so the content script can suppress the "no text" fallback.
        await broadcastToWaTabs({ type: 'TRANSCRIPTION_STOPPED' });
      })();
      return false;
    }

    if (message.type === 'DELETE_MODEL') {
      void (async () => {
        // Evict from offscreen memory if the model is currently loaded.
        if (await chrome.offscreen.hasDocument()) {
          void chrome.runtime.sendMessage({ type: 'WHISPER_UNLOAD', modelId: message.modelId });
        }
        await deleteModelFromCache(message.modelId);
        const res = await chrome.storage.local.get(STORAGE_KEYS.downloadedModels);
        const downloaded = (res[STORAGE_KEYS.downloadedModels] as string[]) ?? [];
        await chrome.storage.local.set({
          [STORAGE_KEYS.downloadedModels]: downloaded.filter(id => id !== message.modelId),
        });
        await broadcastToWaTabs({ type: 'MODEL_DELETED', modelId: message.modelId });
      })();
      return false;
    }

    return false;
  }
);
