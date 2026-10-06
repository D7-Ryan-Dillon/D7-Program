// Debug helper: two tiles placed at an offset, and what their joint says.   TILESET=v5 npx tsx scripts/dbg-nest.ts L5 L5 10 10 0 [rotB]
import type { ParsedTile } from "../lib/types";
import { analyzeLayout } from "../lib/arrange/layout";
import { defaultRules, emptyDoc, type Piece } from "../lib/arrange/types";
import { loadFixture, V4_ORDER } from "./v4/load";

const find = (k: string) => V4_ORDER.find((n) => n.startsWith({ G: "gathering", O: "office", L: "lobby" }[k[0]]! + "_" + k[1]))!;
const tiles = new Map<string, ParsedTile>();
for (const n of V4_ORDER) tiles.set(n, loadFixture(n)!);
const a = tiles.get(find(process.argv[2]))!;
const b = tiles.get(find(process.argv[3]))!;
const [dx, dy, dz] = [Number(process.argv[4]), Number(process.argv[5]), Number(process.argv[6])];
const rot = Number(process.argv[7] ?? 0);
const pa: Piece = { id: "a", tileId: a.id, pos: [0, 0, 0], rotZ: 0, mirrorX: false, scale: 1, locked: false };
const pb: Piece = { id: "b", tileId: b.id, pos: [dx, dy, dz], rotZ: rot, mirrorX: false, scale: 1, locked: false };
const l = analyzeLayout({ ...emptyDoc(), pieces: [pa, pb], entranceId: "a" }, tiles, defaultRules());
for (const c of l.collisions) console.log(`collision solid ${c.solid} consumed ${c.consumed} shared ${c.shared} sample ${JSON.stringify(c.sample.slice(0, 4))}`);
console.log(`overlaps ${l.overlaps.length} nested ${l.nested.length} joints ${l.joints.length} unreachable ${l.unreachable}`);
for (const j of l.joints) console.log(`joint axis ${j.axis} area ${j.areaFt2.toFixed(0)} kind ${j.connect.kind} patches ${j.patches.length} why: ${j.connect.why}`);
for (const e of l.exposed.filter((x) => x.pieceId === "a" || x.pieceId === "b").slice(0, 12)) console.log(`exposed ${e.pieceId} ${e.face} plane ${e.plane} cells ${e.patch.cells}`);
