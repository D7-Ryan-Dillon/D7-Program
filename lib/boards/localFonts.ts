// Wraps the (Chromium-only, permission-gated) Local Font Access API so the
// Boards tab can offer a real dropdown of fonts actually installed on this
// device -- "Architech Medium" and all. Callers must fall back to a plain
// text field when this reports unsupported (Firefox/Safari, or permission
// denied): the font name is just a CSS font-family string either way, so
// nothing else needs to branch on how it was entered.

export interface LocalFontEntry {
  family: string;
  fullName: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<{ family: string; fullName: string; postscriptName: string; style: string }[]>;
  }
}

export function localFontAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.queryLocalFonts === "function";
}

/** Returns one entry per distinct font family (the API lists one entry per
 * style/weight, which would otherwise flood the dropdown with "Architech
 * Medium", "Architech Bold", etc. as if they were unrelated fonts). */
export async function listLocalFontFamilies(): Promise<LocalFontEntry[]> {
  if (!window.queryLocalFonts) return [];
  const fonts = await window.queryLocalFonts();
  const byFamily = new Map<string, LocalFontEntry>();
  for (const f of fonts) if (!byFamily.has(f.family)) byFamily.set(f.family, { family: f.family, fullName: f.fullName });
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}
