// Runs in world: "MAIN" (page context).
// Patches HTMLMediaElement.src at document_start, before any site JS runs.
//
// Captured patterns (manifest limits which sites this script is injected on):
//   • blob: URLs  — WhatsApp Web and Telegram Web download audio locally first
//   • Discord CDN voice messages — signed HTTPS URLs from cdn.discordapp.com
let isSilentMode = false;

window.addEventListener('message', (event) => {
  if (event.data?.source === 'WA_TRANSCRIBER_CONTENT' && event.data?.type === 'SYNC_SILENT_MODE') {
    isSilentMode = !!event.data.silentMode;
  }
});

(function () {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'src'
  );
  if (!descriptor?.set) return;

  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    set(value: string) {
      if (typeof value === 'string' && this instanceof HTMLAudioElement) {
        if (isSilentMode) {
          this.muted = true;
        }
        const isBlobAudio = value.startsWith('blob:');
        const isDiscordVoice =
          value.includes('cdn.discordapp.com') && value.includes('voice-message');
        if (isBlobAudio || isDiscordVoice) {
          window.postMessage(
            {
              source: 'WA_TRANSCRIBER',
              type: 'AUDIO_SRC_SET',
              blobUrl: value,
            },
            window.location.origin
          );
        }
      }
      descriptor.set!.call(this, value);
    },
    get() {
      return descriptor.get!.call(this);
    },
    configurable: true,
  });
})();
