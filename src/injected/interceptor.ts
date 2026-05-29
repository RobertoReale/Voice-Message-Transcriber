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
    // Update currently existing audio elements instantly
    document.querySelectorAll('audio').forEach(audio => {
      const src = audio.src || '';
      if (src.startsWith('blob:') || (src.includes('cdn.discordapp.com') && src.includes('voice-message'))) {
        audio.muted = isSilentMode;
      }
    });
  }
});

(function () {
  // 1. Intercept `src` assignment to catch new voice messages
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'src'
  );
  if (descriptor?.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      set(value: string) {
        if (typeof value === 'string' && this instanceof HTMLAudioElement) {
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
  }

  // 2. Intercept `play()` to enforce mute state when the user actually hits play
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this instanceof HTMLAudioElement) {
      const src = this.src || '';
      if (src.startsWith('blob:') || (src.includes('cdn.discordapp.com') && src.includes('voice-message'))) {
        this.muted = isSilentMode;
      }
    }
    return origPlay.call(this);
  };
})();
