/**
 * Reads translations aloud: the server's Gemini voice first, the browser's speechSynthesis voice
 * when that fails or is slow, so playback never depends on Gemini alone.
 */

/** How long the Gemini voice may take to start before a browser voice reads the text instead. */
export const SERVER_VOICE_WAIT_MS = 10_000;

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

let current: HTMLAudioElement | null = null;
/** Counts playbacks: a newer one stops the older one, and the older one must not fall back then. */
let generation = 0;

function stopAll(): void {
  current?.pause();
  current = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** Plays an audio URL. Rejects when it cannot be played or has not started within waitMs. */
async function playUrl(url: string, waitMs: number): Promise<void> {
  const audio = new Audio(url);
  current = audio;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([audio.play(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), waitMs)))]);
  } catch (e) {
    // Drop the request too, so a late answer cannot start talking over the browser voice.
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (current === audio) current = null;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plays the Gemini voice at `url`. When it fails or has not started within SERVER_VOICE_WAIT_MS,
 * a browser voice reads `text` instead. Returns false when neither can play (no voice for the
 * language on this device).
 */
export async function sayAloud(url: string, text: string, lang: string): Promise<boolean> {
  const mine = ++generation;
  stopAll();
  try {
    await playUrl(url, SERVER_VOICE_WAIT_MS);
    return true;
  } catch {
    if (mine !== generation) return true; // a newer message took over
  }
  const voice = await findVoice(lang);
  if (mine !== generation) return true;
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  speechSynthesis.speak(u);
  return true;
}
