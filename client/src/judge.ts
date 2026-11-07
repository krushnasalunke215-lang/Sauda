import { createContext, useContext } from 'react';

/**
 * Judge mode shows the technical labels that the normal maker and buyer views hide (docs/design.md,
 * "Technical details and judge mode"): the model and latency on bubbles, message numbers and
 * citation numbers, hashes and ids. It is switched on with `judge=1` in the room URL
 * (`/r/:id?t=TOKEN&judge=1`); FEAT-004's /demo page sets it on both iframes. The data itself is
 * always in the DealView; only what is drawn changes.
 */
export const JudgeMode = createContext(false);

export const useJudge = () => useContext(JudgeMode);
