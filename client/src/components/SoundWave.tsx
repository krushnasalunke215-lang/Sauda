import { useEffect, useRef } from 'react';

const BARS = 40;
/** How often a new level enters the wave (ms). */
const STEP_MS = 60;

/**
 * A live sound wave of the microphone while recording: the loudness of the last ~2.4 s as bars
 * that scroll from right to left. It reads the stream with a Web Audio analyser and writes the bar
 * heights straight to the DOM (no React re-render per frame). Without a stream or Web Audio the
 * bars stay flat.
 */
export function SoundWave({ stream, className = '' }: { stream: MediaStream | null; className?: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !stream) return;
    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const levels: number[] = new Array<number>(BARS).fill(0);
      let last = 0;
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (now - last < STEP_MS) return;
        last = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) {
          const x = (v - 128) / 128;
          sum += x * x;
        }
        levels.shift();
        levels.push(Math.min(1, Math.sqrt(sum / data.length) * 5));
        const bars = el.children;
        for (let i = 0; i < bars.length; i++) (bars[i] as HTMLElement).style.height = `${Math.max(10, Math.round(levels[i]! * 100))}%`;
      };
      void ctx.resume().catch(() => undefined);
      raf = requestAnimationFrame(tick);
    } catch {
      // No Web Audio: the bars stay flat; recording still works.
    }
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
    };
  }, [stream]);

  return (
    <div ref={box} data-testid="sound-wave" aria-hidden className={`flex items-center justify-end gap-[3px] overflow-hidden ${className}`}>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="w-[3px] shrink-0 rounded-full bg-brand" style={{ height: '10%' }} />
      ))}
    </div>
  );
}
