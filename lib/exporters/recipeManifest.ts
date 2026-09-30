import type { ParsedTile } from "@/lib/types";
import type { Assembly } from "@/lib/arrange/types";

/**
 * A human-followable rebuild sheet, not a machine format -- per plan, there's
 * no Grasshopper component to auto-rebuild an assembly (yet). For each piece:
 * its recipe (if attached) and the exact transform to apply by hand, using
 * the same mirror -> rotate -> translate convention as HANDOFF.md section 5.
 */
export function buildManifestText(assembly: Assembly, tiles: ParsedTile[]): string {
  const tileById = new Map(tiles.map((t) => [t.id, t]));
  const lines: string[] = [];
  lines.push("EROSION WORKSPACE -- assembly rebuild sheet");
  lines.push(`${assembly.instances.length} piece(s), ${assembly.joints.length} joint(s)`);
  lines.push("");
  lines.push("How to use this in Grasshopper:");
  lines.push("1. For each piece below, paste its recipe.json into the engine's `recipe` input and export/build it.");
  lines.push("2. Apply the transform in this order: mirror first, then tilt (if any), then rotate (quarter turns about Z, through the tile centre), then move.");
  lines.push("3. Move by the feet offset given -- it's this piece's world centre position.");
  lines.push("4. Scale and tilt aren't representable by the engine's own recipe -- a scaled or tipped piece needs its move/rotate applied by hand afterward at the noted scale.");
  lines.push("");

  assembly.instances.forEach((inst, i) => {
    const tile = tileById.get(inst.tileId);
    lines.push("----------------------------------------");
    lines.push(`Piece ${i + 1} of ${assembly.instances.length}  (instance ${inst.id})`);
    lines.push(`  source tile: ${tile?.name ?? "unknown"}  (id ${inst.tileId})`);
    lines.push(`  mirror: ${inst.mirror || "none"}`);
    lines.push(`  tilt:   ${inst.tilt ? `${inst.tilt.steps * 90}° about ${inst.tilt.axis.toUpperCase()}` : "none"}`);
    lines.push(`  rotate: ${inst.rotZ * 90}° about Z, through the tile centre`);
    lines.push(`  scale:  ${inst.scale.toFixed(2)}×`);
    lines.push(`  move:   ${inst.posFt.map((v) => v.toFixed(2)).join(", ")} ft  (x, y, z), this piece's centre`);
    if (inst.parentJointId) {
      const joint = assembly.joints.find((j) => j.id === inst.parentJointId);
      lines.push(`  joint score into parent: ${joint?.score === null || joint?.score === undefined ? "sealed" : joint.score.toFixed(0)}`);
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
