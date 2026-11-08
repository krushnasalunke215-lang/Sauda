import { useState } from 'react';
import { ui } from '../ui.js';
import { Icon } from './Icon.js';

/** Copies `text` to the clipboard and says so for 1.5 s. `primary` makes it the card's main button. */
export function CopyButton({ text, label, done, primary = false, testId }: { text: string; label: string; done: string; primary?: boolean; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      data-copied={copied}
      className={primary ? `${ui.btnPrimary} w-full` : `${ui.btnSecondary} shrink-0 px-2.5 py-1.5 text-xs`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={primary ? 16 : 14} className={copied && !primary ? 'text-emerald-700' : ''} />
      {copied ? done : label}
    </button>
  );
}
