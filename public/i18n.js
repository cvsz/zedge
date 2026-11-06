/** Minimal i18n for Zedge: English and Thai.
 * Loads public/i18n/{lang}.json and exposes t(key) for UI strings.
 * Language persists in localStorage under 'zedge.lang'.
 */
const EN = {};
let TH = {};
let lang = 'en';

export function setLang(l) {
  lang = l;
  try { localStorage.setItem('zedge.lang', l); } catch { /* ignore */ }
}

export function getLang() {
  try { const l = localStorage.getItem('zedge.lang'); if (l === 'en' || l === 'th') {return l;} } catch { /* ignore */ }
  return 'en';
}

export async function loadI18n() {
  lang = getLang();
  try { TH = await (await fetch('/public/i18n/th.json')).json(); } catch { TH = {}; }
}

export function t(key) {
  const byLang = lang === 'th' ? TH : EN;
  return byLang[key] || key;
}

export function L(key) {
  return t(key);
}
