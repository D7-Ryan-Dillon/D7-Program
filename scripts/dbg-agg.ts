// Debug helper: why is an interlock aggregation not walkable?   npx tsx scripts/dbg-agg.ts O3 repeat 4
import type { ParsedTile } from "../lib/types";
import { analyzeLayout } from "../lib/arrange/layout";
import { interlockDoc, type InterlockCount, type InterlockPattern } from "../lib/arrange/interlock";
import { defaultRules } from "../lib/arrange/types";
import { loadFixture, V4_ORDER } from "./v4/load";

const tiles = new Map<string, ParsedTile>();
for (const n of V4_ORDER) tiles.set(n, loadFixture(n)!);
const [k, pattern, count] = process.argv.slice(2);
const name = V4_ORDER.find((n) => n.startsWith({ G: "gathering", O: "office", L: "lobby" }[k[0]]! + "_" + k[1]))!;
const t = tiles.get(name)!;
const doc = interlockDoc(t, pattern as InterlockPattern, Number(count) as InterlockCount);
const l = analyzeLayout(doc, tiles, defaultRules());
console.log(`${name} ${pattern} ${count}: pieces ${doc.pieces.length}, joints ${l.joints.length}, overlaps ${l.overlaps.length}, islands ${l.islands.length}, unreachable ${l.unreachable.join(",")}, entrance ${l.entranceId}`);
for (const p of doc.pieces) console.log(`  piece ${p.id} at ${p.pos} rot ${p.rotZ} mirror ${p.mirrorX}`);
for (const j of l.joints) console.log(`  joint ${j.aId}-${j.bId} axis ${j.axis} area ${j.areaFt2.toFixed(0)} kind ${j.connect.kind} walkable ${j.connect.walkable} crossings ${j.connect.crossings.length} why ${j.connect.why}`);
for (const [id, r] of l.reach) console.log(`  reach ${id}: ${r.reachedFt2.toFixed(0)} / ${r.totalFt2.toFixed(0)} ft2, main ${r.main}`);
import { getWalk } from "../lib/arrange/occupancy";
for (const b of l.boxes) {
  const wk = getWalk(b.occ);
  console.log(`  zones of ${b.piece.id}: main ${wk.main}; ` + wk.zones.map((z) => `#${z.id}:${z.areaFt2.toFixed(0)}ft2${z.significant ? "*" : ""}`).join(" "));
}
for (const j of l.joints) console.log(`  crossings ${j.aId}-${j.bId}: ` + j.connect.crossings.map((x) => `${x.aId}#${x.zoneA}~${x.bId}#${x.zoneB}`).join(", "));
console.log("  reached zones: " + [...l.reachedZones].join(" "));
