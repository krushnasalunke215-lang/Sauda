/** Speaks translations with the browser's speechSynthesis voices. */

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

/** The browser's voices. They load asynchronously in Chromium, so wait for voiceschanged (at most 2 s). */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  voicesReady ??= new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      clearTimeout(timer);
      const v = speechSynthesis.getVoices();
      if (!v.length) voicesReady = null; // try again next time
      resolve(v);
    };
    const timer = setTimeout(done, 2000);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
  return voicesReady;
}

/** A voice whose lang starts with the code (hi, en, es); a local voice is preferred. */
export async function findVoice(lang: string): Promise<SpeechSynthesisVoice | null> {
  const code = lang.toLowerCase();
  const matches = (await loadVoices()).filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(code));
  return matches.find((v) => v.localService) ?? matches[0] ?? null;
}

/** Speaks the text. Returns false when the device has no voice for the language. */
export async function speak(text: string, lang: string): Promise<boolean> {
  const voice = await findVoice(lang);
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  speechSynthesis.speak(u);
  return true;
}

let current: HTMLAudioElement | null = null;

/** Plays an audio URL (the server TTS fallback). Rejects when it cannot be played. */
export async function playUrl(url: string): Promise<void> {
  current?.pause();
  current = new Audio(url);
  await current.play();
}
