import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, LANG_ENDONYMS, LANGS, type Party, type Role } from '../../shared/types.js';
import { DICTS, renderEvent, tMaybe } from './i18n.js';

const SERVER_DIR = fileURLToPath(new URL('../../server', import.meta.url));
const parties: Record<Role, Party> = { maker: { name: 'Ravi', lang: 'hi' }, buyer: { name: 'Emily', lang: 'en' } };
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** The production server sources (tests excluded). */
function serverSources(dir = SERVER_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return serverSources(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [readFileSync(p, 'utf8')] : [];
  });
}

describe('i18n completeness', () => {
  const keys = Object.keys(DICTS.en);

  it('has every key in every language, non-empty and with the same placeholders', () => {
    for (const lang of LANGS) {
      const dict = DICTS[lang] as Record<string, string>;
      expect(Object.keys(dict).sort(), lang).toEqual([...keys].sort());
      for (const k of keys) {
        expect(dict[k]?.trim(), `${lang} ${k}`).toBeTruthy();
        expect(placeholders(dict[k]), `${lang} ${k}`).toEqual(placeholders(DICTS.en[k as keyof typeof DICTS.en]));
      }
    }
  });

  it("names each language in its own script in that language's dictionary", () => {
    for (const lang of LANGS) expect(DICTS[lang][`lang.${lang}`], lang).toBe(LANG_ENDONYMS[lang]);
  });

  it('translates most strings of each generated language (English stays only for brand names and codes)', () => {
    for (const lang of LANGS.filter((l) => !['en', 'hi', 'es'].includes(l))) {
      const dict = DICTS[lang] as Record<string, string>;
      const differ = keys.filter((k) => dict[k] !== DICTS.en[k as keyof typeof DICTS.en]).length;
      expect(differ / keys.length, lang).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('has a renderer for every system event type in every language, in both modes', () => {
    for (const lang of LANGS) {
      for (const type of EVENT_TYPES) {
        for (const judge of [false, true]) {
          const text = renderEvent(lang, { type, params: { role: 'maker', by: 'buyer' } }, parties, judge);
          expect(text, `${lang} ${type}`).not.toBe(type);
        }
      }
    }
  });

  it('lists every event type and alert code the server posts', () => {
    const src = serverSources().join('\n');
    const events = new Set([...src.matchAll(/pushEvent\(\s*\w+,\s*'(\w+)'/g)].map((m) => m[1]));
    expect(events.size).toBeGreaterThan(10);
    for (const type of events) expect(EVENT_TYPES, type).toContain(type);
    const alerts = new Set([...src.matchAll(/type: 'alert', code: '(\w+)'/g)].map((m) => m[1]));
    for (const code of alerts) for (const lang of LANGS) expect(tMaybe(lang, `timeline.alert.${code}`, {}, ''), `${lang} ${code}`).not.toBe('');
  });

  it('has a .plain twin in every language for each judge-mode string', () => {
    for (const k of keys.filter((x) => x.endsWith('.plain'))) {
      const base = k.slice(0, -'.plain'.length);
      expect(keys, k).toContain(base);
      for (const lang of LANGS) expect(placeholders(DICTS[lang][k as keyof typeof DICTS.en])).not.toContain('hash');
    }
  });
});
