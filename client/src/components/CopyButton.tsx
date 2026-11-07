import { useState } from 'react';
import { Icon } from './Icon.js';

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-700 ring-1 ring-stone-200 transition-colors hover:bg-stone-50 hover:text-stone-900"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} className={copied ? 'text-emerald-700' : ''} />
      {copied ? done : label}
    </button>
  );
}
