// Ported from the original app's utils/documentFonts.ts. document.language stores a language NAME,
// so names are mapped to the original ISO-style codes first.
const devanagari = "'Noto Sans Devanagari', 'Mangal', 'Kokila', 'Noto Sans', sans-serif";
const bengali = "'Noto Sans Bengali', 'Vrinda', 'Noto Sans', sans-serif";
const tamil = "'Noto Sans Tamil', 'Latha', 'Noto Sans', sans-serif";
const telugu = "'Noto Sans Telugu', 'Gautami', 'Noto Sans', sans-serif";
const kannada = "'Noto Sans Kannada', 'Tunga', 'Noto Sans', sans-serif";
const malayalam = "'Noto Sans Malayalam', 'Kartika', 'Noto Sans', sans-serif";
const gujarati = "'Noto Sans Gujarati', 'Shruti', 'Noto Sans', sans-serif";
const gurmukhi = "'Noto Sans Gurmukhi', 'Raavi', 'Noto Sans', sans-serif";
const odia = "'Noto Sans Oriya', 'Kalinga', 'Noto Sans', sans-serif";
const urdu = "'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Jameel Noori Nastaleeq', sans-serif";

const fontFamilyMap: Record<string, string> = {
  hi: devanagari, mr: devanagari, ne: devanagari, sa: devanagari, bho: devanagari, raj: devanagari, kok: devanagari, doi: devanagari, mai: devanagari,
  bn: bengali, as: bengali, mni: bengali,
  ta: tamil, te: telugu, kn: kannada, ml: malayalam, gu: gujarati, pa: gurmukhi, or: odia,
  ur: urdu, sd: urdu, ks: urdu, ar: urdu,
};

const nameToCode: Record<string, string> = {
  english: 'en', hindi: 'hi', marathi: 'mr', nepali: 'ne', sanskrit: 'sa', bhojpuri: 'bho', rajasthani: 'raj', konkani: 'kok', dogri: 'doi', maithili: 'mai',
  bengali: 'bn', bangla: 'bn', assamese: 'as', manipuri: 'mni', meitei: 'mni',
  tamil: 'ta', telugu: 'te', kannada: 'kn', malayalam: 'ml', gujarati: 'gu', punjabi: 'pa', panjabi: 'pa', odia: 'or', oriya: 'or',
  urdu: 'ur', sindhi: 'sd', kashmiri: 'ks', arabic: 'ar',
};

const RTL = new Set(['ur', 'sd', 'ks', 'ar']);

export function languageCode(language?: string | null): string {
  if (!language) return 'en';
  const k = language.trim().toLowerCase();
  return nameToCode[k] ?? nameToCode[k.split(/[\s(]/)[0]] ?? (fontFamilyMap[k] ? k : 'en');
}

export function getDocumentFontFamily(language?: string | null): string {
  return fontFamilyMap[languageCode(language)] || "'Times New Roman', Times, serif";
}

export function getDocumentFontName(language?: string | null): string {
  const f = fontFamilyMap[languageCode(language)];
  return f ? f.split(',')[0].replace(/'/g, '').trim() : 'Times New Roman';
}

export function isRtl(language?: string | null): boolean {
  return RTL.has(languageCode(language));
}

/** True when text contains characters outside Latin-1 (jsPDF core fonts cannot draw them). */
export function hasNonLatin(text: string): boolean {
  return /[^\u0000-\u024F\u2000-\u206F\u20B9]/.test(text);
}

const loaded = new Set<string>();
/** Load the matching Noto webfont from Google Fonts so preview and raster PDF render the script. */
export function ensureDocumentFont(language?: string | null) {
  const name = getDocumentFontName(language);
  if (!name.startsWith('Noto') || loaded.has(name) || typeof document === 'undefined') return;
  loaded.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}
