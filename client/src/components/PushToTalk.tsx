import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { Lang } from '../../../shared/types.js';
import { RecordError, Recorder, type Clip } from '../audio/recorder.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';
import { Icon } from './Icon.js';

/** A press longer than this is "hold to talk"; a shorter one (a click or tap) toggles recording. */
const HOLD_MS = 400;

/**
 * The composer's big round microphone button. Records while it is held. A click or tap (and
 * Enter/Space) toggles recording instead, for keyboard and touch users. Clips under 0.5 s are
 * ignored. `onStream` gets the live microphone stream for the sound wave (null when it stops).
 */
export function PushToTalk({
  lang,
  disabled,
  onClip,
  onRecording,
  onStream,
  onError,
}: {
  lang: Lang;
  disabled: boolean;
  onClip: (clip: Clip) => void;
  onRecording: (on: boolean) => void;
  onStream?: (stream: MediaStream | null) => void;
  onError: (code: string) => void;
}) {
  const rec = useRef<Recorder | null>(null);
  const mode = useRef<'hold' | 'toggle'>('hold');
  const downAt = useRef(0);
  const [recording, setRecording] = useState(false);

  useEffect(() => () => void rec.current?.stop(), []);

  const finish = (clip: Clip | null) => {
    if (clip) onClip(clip);
    else onError('too_short');
  };

  function setOn(on: boolean) {
    setRecording(on);
    onRecording(on);
    if (!on) onStream?.(null);
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
      if (rec.current === r) onStream?.(r.mediaStream);
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

  const label = t(lang, recording ? 'voice.stopHint' : 'voice.hold');
  return (
    <button
      type="button"
      data-testid="ptt"
      data-recording={recording}
      disabled={disabled && !recording}
      aria-pressed={recording}
      aria-label={label}
      title={recording ? label : t(lang, 'voice.holdHint')}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={`${ui.btnMic} ${recording ? ui.micRecording : ui.micIdle}`}
    >
      <Icon name={recording ? 'stop' : 'mic'} size={recording ? 20 : 26} />
    </button>
  );
}
