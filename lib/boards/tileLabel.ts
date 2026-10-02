// What a board's name tag says. Tile names from the studio follow
// `category_N_typology words_Vk` ("gathering_4_contained_room_within_volume_V2");
// this pulls that apart so the tag can show any mix of it, and so the 3x5
// catalogue knows which row/column a tile belongs in. A per-tile tag on the
// slot (category + number) overrides the parse for tiles named some other way.

import { displayName, type BoardSlot, type NameTagSettings } from "./types";

export interface ParsedTileName {
  category: string;
  number: number | null;
  typology: string;
  version: string;
}

export function parseTileName(name: string): ParsedTileName {
  const m = name.match(/^([a-zA-Z]+)_(\d+)(?:_(.*))?$/);
  if (!m) return { category: "", number: null, typology: displayName(name), version: "" };
  let rest = m[3] ?? "";
  let version = "";
  const v = rest.match(/(?:^|_)(V\d+(?:_v\d+)?)$/i);
  if (v && v.index !== undefined) {
    version = v[1].replace(/_/g, " ");
    rest = rest.slice(0, v.index);
  }
  return { category: m[1].toLowerCase(), number: Number(m[2]), typology: rest.replace(/_/g, " ").trim(), version };
}

/** The tile's category/number, honouring a slot-level override. */
export function resolveTag(name: string, slot: Pick<BoardSlot, "tag">): ParsedTileName {
  const parsed = parseTileName(name);
  if (!slot.tag) return parsed;
  return { ...parsed, category: slot.tag.category.trim().toLowerCase(), number: slot.tag.number };
}

export function tileLabelText(name: string, slot: Pick<BoardSlot, "tag" | "labelOverride">, tag: NameTagSettings): string {
  if (slot.labelOverride?.trim()) return slot.labelOverride.trim();
  const p = resolveTag(name, slot);
  const short = p.category && p.number !== null ? `${p.category} ${p.number}` : displayName(name);
  switch (tag.labelMode) {
    case "typology":
      return p.typology || short;
    case "full":
      return p.typology && p.category ? `${short} - ${p.typology}` : short;
    case "custom":
      return (
        tag.template
          .replace(/\{category\}/g, p.category)
          .replace(/\{n\}/g, p.number === null ? "" : String(p.number))
          .replace(/\{typology\}/g, p.typology)
          .replace(/\{version\}/g, p.version)
          .replace(/\{name\}/g, displayName(name))
          .replace(/\s+/g, " ")
          .trim() || short
      );
    default:
      return short;
  }
}

/** Sort key for "auto-sort tiles": category order, then number, then name. */
export function tileSortKey(name: string, slot: Pick<BoardSlot, "tag">): [number, number, string] {
  const p = resolveTag(name, slot);
  const order = ["gathering", "office", "lobby"].findIndex((c) => p.category.startsWith(c));
  return [order < 0 ? 99 : order, p.number ?? 999, name];
}
