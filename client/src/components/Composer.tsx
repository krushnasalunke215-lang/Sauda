import { useState, type KeyboardEvent } from 'react';
import type { Lang } from '../../../shared/types.js';
import { t } from '../i18n.js';

export function Composer({ lang, otherName, onSend }: { lang: Lang; otherName: string; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await onSend(v);
    setBusy(false);
    if (ok) setText('');
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="border-t border-stone-200 p-3">
      <div className="flex items-end gap-2">
        <textarea
          data-testid="composer-input"
          className="min-h-11 flex-1 resize-none rounded-xl border border-stone-300 px-3 py-2 text-base focus:border-emerald-600 focus:outline-none"
          rows={2}
          maxLength={1000}
          value={text}
          placeholder={t(lang, 'composer.placeholder', { name: otherName, lang: t(lang, `lang.${lang}`) })}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <button
          type="button"
          data-testid="composer-send"
          disabled={busy || !text.trim()}
          onClick={() => void send()}
          className="rounded-xl bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {t(lang, 'composer.send')}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-stone-400">{t(lang, 'composer.hint')}</p>
    </div>
  );
}
