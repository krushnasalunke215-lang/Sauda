import type { BoardRowState } from '../../../shared/board.js';
import type { Lang } from '../../../shared/types.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n.js';
import { ui } from '../ui.js';

const TONE: Record<BoardRowState, string> = { done: ui.tone.done, ready: ui.tone.ready, locked: ui.tone.quiet };

/** A board row state as a coloured chip (done green, ready sky blue, locked grey), on the fallback board and in the legend. */
export function StateChip({ state, lang }: { state: BoardRowState; lang: Lang }) {
  return (
    <span className={`${ui.pill} ${TONE[state]} shrink-0`}>
      {state === 'done' && <Icon name="check" size={10} />}
      {state === 'ready' && <span className="h-2 w-2 rounded-full ring-[1.5px] ring-inset ring-sky-600" aria-hidden />}
      {state === 'locked' && <Icon name="lock" size={11} />}
      {t(lang, `board.state.${state}`)}
    </span>
  );
}
