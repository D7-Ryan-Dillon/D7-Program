// Debug helper: why does a pair of V4 tiles not give a walkable joint?  npx tsx scripts/dbg-pair.ts G1 G2 [more pairs as A B A B ...]
import type { ParsedTile } from "../lib/types";
import { analyzeLayout } from "../lib/arrange/layout";
import { bestPair } from "../lib/arrange/pairMatrix";
import { defaultRules, emptyDoc, type Piece } from "../lib/arrange/types";
import { loadFixture, V4_ORDER } from "./v4/load";

const tiles = new Map<string, ParsedTile>();
for (const n of V4_ORDER) tiles.set(n, loadFixture(n)!);
const find = (k: string) => V4_ORDER.find((n) => n.startsWith({ G: "gathering", O: "office", L: "lobby" }[k[0]]! + "_" + k[1]))!;
const args = process.argv.slice(2);
for (let i = 0; i + 1 < args.length; i += 2) {
  const a = tiles.get(find(args[i]))!;
  const b = tiles.get(find(args[i + 1]))!;
  const bp = bestPair(a, b);
  const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
  const pb: Piece = { id: "b", tileId: b.id, pos: bp.pos, rotZ: bp.rotZ, mirrorX: bp.mirrorX, scale: 1, locked: false };
  const l = analyzeLayout({ ...emptyDoc(), pieces: [pa, pb], entranceId: "a" }, tiles, defaultRules());
  console.log(`${args[i]} + ${args[i + 1]}: place b at ${bp.pos} rot ${bp.rotZ} mirror ${bp.mirrorX} score ${bp.score}`);
  console.log(`   overlaps ${l.overlaps.length}, joints ${l.joints.length}, unreachable ${l.unreachable.length}`);
  for (const j of l.joints) console.log(`   joint axis ${j.axis} area ${j.areaFt2.toFixed(0)} score ${j.score} kind ${j.connect.kind} walkable ${j.connect.walkable} voidFt2 ${j.connect.voidFt2.toFixed(0)} step ${j.connect.stepFt} connector ${JSON.stringify(j.connect.connector)} why: ${j.connect.why}`);
}
