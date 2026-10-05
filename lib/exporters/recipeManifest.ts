import type { ParsedTile } from "@/lib/types";
import type { ArrangementDoc, Joint } from "@/lib/arrange/types";
import { orientedDims } from "@/lib/arrange/orient";

/**
 * A human-followable rebuild sheet of an arrangement: for each piece, its recipe (if attached) and the transform to
 * apply by hand in Rhino -- mirror in X first, then quarter turns about Z through the tile centre, then move so the
 * piece's low corner sits at the given point (the convention of HANDOFF.md section 5). The Rhino export (a mass for the
 * engine's mass_in) is the machine route; this sheet is the by-hand one.
 */
export function buildManifestText(doc: ArrangementDoc, joints: Joint[], tiles: ParsedTile[], names: (id: string) => string): string {
  const tileById = new Map(tiles.map((t) => [t.id, t]));
  const lines: string[] = [];
  lines.push("EROSION WORKSPACE -- arrangement rebuild sheet");
  lines.push(`${doc.pieces.length} piece(s), ${joints.length} joint(s)`);
  lines.push("");
  lines.push("How to use this in Grasshopper:");
  lines.push("1. For each piece below, paste its recipe.json into the engine's `recipe` input and export/build it.");
  lines.push("2. Apply the transform: mirror in X first (if listed), then turn counter-clockwise from above by the quarter turns, about the tile's centre.");
  lines.push("3. Move the turned piece so its LOW CORNER (minimum x, y, z) sits at the point given.");
  lines.push("");

  doc.pieces.forEach((p, i) => {
    const tile = tileById.get(p.tileId);
    const dims = tile ? orientedDims(tile, p.rotZ, p.scale) : null;
    lines.push("----------------------------------------");
    lines.push(`Piece ${i + 1} of ${doc.pieces.length}: ${names(p.id)}  (${p.id})`);
    lines.push(`  source tile: ${tile?.name ?? "unknown"}  (id ${p.tileId})`);
    lines.push(`  mirror in X: ${p.mirrorX ? "yes" : "no"}`);
    lines.push(`  turn: ${p.rotZ * 90} degrees about Z`);
    lines.push(`  scale: ${p.scale.toFixed(2)}x`);
    lines.push(`  low corner: ${p.pos.map((v) => v.toFixed(2)).join(", ")} ft  (x, y, z)`);
    if (dims) lines.push(`  size after turning: ${(dims[0] * 0.5).toFixed(1)} x ${(dims[1] * 0.5).toFixed(1)} x ${(dims[2] * 0.5).toFixed(1)} ft`);
    if (p.locked) lines.push("  (locked)");
    for (const j of joints.filter((x) => x.aId === p.id || x.bId === p.id)) {
      lines.push(`  joint with ${names(j.aId === p.id ? j.bId : j.aId)}: ${j.score === null ? "sealed" : j.score.toFixed(0)}`);
    }
    if (tile?.recipeText) {
      lines.push("  recipe.json:");
      lines.push(tile.recipeText);
    } else {
      lines.push("  recipe.json: NOT ATTACHED -- attach it to this tile in the Viewer tab, then re-export this sheet.");
    }
    lines.push("");
  });

  return lines.join("\n");
}
