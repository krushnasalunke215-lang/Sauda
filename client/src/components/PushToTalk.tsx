import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { Lang } from '../../../shared/types.js';
import { MAX_RECORD_MS, RecordError, Recorder, type Clip } from '../audio/recorder.js';
import { t } from '../i18n.js';
import { Icon } from './Icon.js';

/** A press longer than this is "hold to talk"; a shorter one (a click or tap) toggles recording. */
const HOLD_MS = 400;

/**
 * Records while the button is held. A click or tap (and Enter/Space) toggles recording instead, for
 * keyboard and touch users. Clips under 0.5 s are ignored.
 */
export function PushToTalk({
  lang,
  disabled,
  onClip,
  onRecording,
  onError,
}: {
  lang: Lang;
  disabled: boolean;
  onClip: (clip: Clip) => void;
  onRecording: (on: boolean) => void;
  onError: (code: string) => void;
}) {
  const rec = useRef<Recorder | null>(null);
  const mode = useRef<'hold' | 'toggle'>('hold');
  const downAt = useRef(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!recording) return;
    const t0 = performance.now();
    const id = setInterval(() => setElapsed(Math.floor((performance.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => () => void rec.current?.stop(), []);

  const finish = (clip: Clip | null) => {
    if (clip) onClip(clip);
    else onError('too_short');
  };

  function setOn(on: boolean) {
    setRecording(on);
    setElapsed(0);
    onRecording(on);
  }

  async function begin(m: 'hold' | 'toggle') {
    if (rec.current || disabled) return;
    const r = new Recorder((clip) => {
      // Auto-stop at 30 s.
      if (rec.current !== r) return;
      rec.current = null;
      setOn(false);
      finish(clip);
    });
    rec.current = r;
    mode.current = m;
    setOn(true);
    try {
      await r.start();
    } catch (e) {
      if (rec.current === r) rec.current = null;
      setOn(false);
      onError(e instanceof RecordError ? e.code : 'mic_error');
    }
  }

  async function end() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setOn(false);
    finish(await r.stop());
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (rec.current) {
      if (mode.current === 'toggle') void end();
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    downAt.current = performance.now();
    void begin('hold');
  }

  function onPointerUp() {
    if (!rec.current || mode.current !== 'hold') return;
    if (performance.now() - downAt.current > HOLD_MS) void end();
    else mode.current = 'toggle';
  }

  function onPointerCancel() {
    if (rec.current && mode.current === 'hold') void end();
  }

  /** Keyboard activation (Enter/Space) produces a click with detail 0; pointer clicks are handled above. */
  function onClick(e: MouseEvent<HTMLButtonElement>) {
    if (e.detail !== 0) return;
    if (rec.current) void end();
    else void begin('toggle');
  }

  return (
    <button
      type="button"
      data-testid="ptt"
      data-recording={recording}
      disabled={disabled && !recording}
      aria-pressed={recording}
      title={t(lang, 'voice.holdHint')}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={`inline-flex h-9 select-none items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
        recording ? 'bg-red-600 text-white' : 'bg-white text-stone-800 ring-1 ring-stone-200 hover:bg-stone-100'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {recording ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden /> : <Icon name="mic" className="text-emerald-700" />}
      {recording ? t(lang, 'voice.recording', { s: elapsed, max: MAX_RECORD_MS / 1000 }) : t(lang, 'voice.hold')}
    </button>
  );
}
