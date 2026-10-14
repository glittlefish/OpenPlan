// Lightweight i18n (PRD M17-7). The app's UI strings are written in English and
// used directly as keys; the zh-CN dictionary maps them to Chinese. This keeps
// the bundle small and avoids an i18next dependency. The active language is
// owned by the store (UIState.lang) and pushed here via setLang().
import zh from './zh-CN';

export type Lang = 'zh-CN' | 'en-US';

let lang: Lang = 'zh-CN';

export function getLang(): Lang { return lang; }
export function setLang(l: Lang) { if (l === 'zh-CN' || l === 'en-US') lang = l; }

/** Translate a UI string. `{name}` placeholders are replaced from params. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = lang === 'zh-CN' ? (zh[key] ?? key) : key;
  if (params) for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(String(params[k]));
  return s;
}
