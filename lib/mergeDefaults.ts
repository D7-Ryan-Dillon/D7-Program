// Fills in anything a saved (possibly older) settings object doesn't have
// from the current defaults, so a project saved before a setting existed
// still opens cleanly. Plain objects merge key by key; arrays and scalars
// from the saved copy win outright.

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function mergeDefaults<T>(defaults: T, saved: unknown): T {
  if (Array.isArray(defaults)) return (Array.isArray(saved) ? saved : defaults) as T;
  if (isPlainObject(defaults)) {
    const out: Record<string, unknown> = { ...defaults };
    if (isPlainObject(saved)) {
      for (const [k, v] of Object.entries(saved)) {
        const d = defaults[k];
        out[k] = isPlainObject(d) ? mergeDefaults(d, v) : v === undefined ? d : v;
      }
    }
    return out as T;
  }
  return (saved === undefined || saved === null ? defaults : saved) as T;
}
