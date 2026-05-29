// Runs in world: "MAIN" (page context).
// Patches HTMLMediaElement.src at document_start, before any site JS runs.
//
// Captured patterns (manifest limits which sites this script is injected on):
//   • blob: URLs  — WhatsApp Web and Telegram Web download audio locally first
//   • Discord CDN voice messages — signed HTTPS URLs from cdn.discordapp.com
(function () {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'src'
  );
  if (!descriptor?.set) return;

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
})();
