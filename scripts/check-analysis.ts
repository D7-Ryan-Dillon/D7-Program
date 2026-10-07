// Proves the Analysis against the matrix without a browser: the twelve descriptors read exactly as the project's matrix words them, every measurement carries
// an honest status (missing information is "not assessable", never zero and never a pass), Continuous and Compressed-then-released mean what the matrix says,
// overrides persist and reset one at a time, a comparison profile stays put as variants arrive, non-cubic containers and assemblies are read from the cells,
// and the Analysis, the Boards text and the exports are one set of numbers. Run: npm run check:analysis

import { gunzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTile } from "../lib/types";
import { ensureAnalysis } from "../lib/tiles/pipeline";
import { MATRIX, MATRIX_KEYS, STATUS_LABEL } from "../lib/scoring/matrix";
import { evaluateTile, type TileEvaluation } from "../lib/scoring/matrixEval";
import { DESCRIPTOR_META, legacyMeasurementsFor, scoreTile } from "../lib/scoring/descriptors";
import { DEFAULT_ASSUMPTIONS } from "../lib/scoring/assumptions";
import { spatialDensityFor } from "../lib/scoring/spatialDensity";
import { applyWalk, DEFAULT_WALK, getOcc, getWalk, WALK } from "../lib/arrange/occupancy";
import { getOriented } from "../lib/arrange/orient";
import { findRoute } from "../lib/scoring/voxelFacts";
import type { MatrixKey } from "../lib/scoring/matrix";
import { adoptFrom, defaultProfile, diffSuggestion, effectiveAssumptions, effectiveCriteria, emptyOverrides, interpretationFor, migrateLegacy, normalizeProfile, type EvaluationProfile, suggestCriteria, withAssumption, withInterpretation, withPick, withPin, withReason, withRoomClass, withRoute, withTarget, withoutAssumption } from "../lib/scoring/profile";
import { fitOf, preferenceFor, suggestPick, typologyGroups, type TypologyGroup } from "../lib/scoring/compareSet";
import type { MatrixStatus } from "../lib/scoring/matrix";
import type { UsableSpace } from "../lib/scoring/usable";
import { descriptorText, boardTextFor } from "../lib/scoring/boardText";
import { resultsCsv, type ResultRow } from "../lib/scoring/exportResults";
import { voxelFacts } from "../lib/scoring/voxelFacts";
import { usableSpace } from "../lib/scoring/usable";
import { analyzeLayout } from "../lib/arrange/layout";
import { buildComposite, compositeToTile } from "../lib/arrange/composite";
import { makePiece, withPiece } from "../lib/arrange/ops";
import { defaultRules, emptyDoc } from "../lib/arrange/types";
import { L, Lfilled, block, closed, corridor, cube, pocket, skylit } from "./fixtures/shaped";
import { loadFixture } from "./tiles/load";

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error("FAIL " + msg);
  }
};
const eq = <T,>(a: T, b: T, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

// ---- the fifteen engine-shaped fixtures (ordinary cube tiles) --------------------------------------------------------------------------------------------------
const root = join(__dirname, "..", "lib", "tiles", "fixtures");
const names = readdirSync(root).filter((n) => existsSync(join(root, n, "meta.json"))).sort();
const read = (dir: string, f: string) => (existsSync(join(dir, f)) ? new Uint8Array(gunzipSync(readFileSync(join(dir, f)))) : undefined);
const cubes: ParsedTile[] = names.map((name) => {
  const dir = join(root, name);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { grid: [number, number, number]; cell_ft: number };
  const m = /^(gathering|office|lobby)_(\d+)_(.+)$/.exec(name)!;
  return ensureAnalysis({ id: name, name, sourceFolderName: name, tileFt: [meta.grid[0] * meta.cell_ft, meta.grid[1] * meta.cell_ft, meta.grid[2] * meta.cell_ft], cellFt: meta.cell_ft, grid: meta.grid, config: {}, metrics: {}, glbUrl: "", voxels: { void: read(dir, "void.u8.gz"), plates: read(dir, "plates.u8.gz") }, guessed: { category: m[1] as "gathering" }, meta: { category: m[1] as "gathering", typology: m[3].replace(/_/g, " ") } } as unknown as ParsedTile);
});

// ---- 1. the twelve descriptors, exactly as the matrix words them -----------------------------------------------------------------------------------------------
{
  const expected: [string, string, string, string, string][] = [
    ["Carved", "Perceived sense the void was subtracted from solid mass.", "Percentage of void surface that is seamless versus paneled.", "Gilder Center’s unbroken shotcrete.", "Formal / geometrical"],
    ["Stepped / Terraced", "Legibility of successive setbacks in section.", "Number of distinct setback increments per building height.", "Namba Parks canyon section.", "Formal / geometrical"],
    ["Porous", "Perceived visual permeability across levels.", "Percentage of void wall area occupied by openings/bridges versus solid.", "Gilder Center’s bridges and vaulted openings.", "Formal / geometrical"],
    ["Continuous", "Absence of perceptible material joints.", "Number of visible seams per 10 m of surface.", "Shotcrete versus panel systems.", "Formal / geometrical"],
    ["Retained / Resistant", "Clarity that one element resists the surrounding erosion.", "Percentage of floor area/volume occupied by the retained solid.", "Namba Parks tower; office cores at Valley.", "Formal / geometrical"],
    ["Threaded", "Sense that public program is encountered continuously, not just at entry.", "Number of public program instances located above ground floor.", "Valley aboveground circulation and shops.", "Organizational / spatial"],
    ["Graduated", "Smoothness of transition between enclosed and open zones.", "Number of discrete enclosure “steps” from private to public.", "Distance to get from outside to the office at Valley.", "Organizational / spatial"],
    ["Non-hierarchical Circulation", "Degree to which multiple paths feel equally valid.", "Number of distinct routes from entry to a given destination.", "Gilder Center’s bridge network.", "Organizational / spatial"],
    ["Force-driven", "Legibility of the generating force in the final form.", "Measurable input used to generate geometry, such as required sun-hours or pedestrian counts.", "Namba Parks and Valley force diagrams.", "Organizational / spatial"],
    ["Light-filled", "Perceived brightness/quality of daylight at the void’s base.", "Skylight area as a percentage of void floor area below it.", "Gilder Center’s oval skylights; Valley’s grotto skylights/reflecting pools.", "Experiential / atmospheric"],
    ["Monumental", "Perceived significance communicated by scale.", "Void height-to-width ratio, or void volume as a percentage of total building volume.", "Gilder Center’s five-story atrium.", "Experiential / atmospheric"],
    ["Spatial density", "Perceived contrast between narrowest and widest moments.", "Ratio of narrowest to widest passage width along the sequence.", "Gilder Center entrance to exhibit threshold.", "Experiential / atmospheric"],
  ];
  ok(MATRIX.length === 12, `the matrix has ${MATRIX.length} descriptors`);
  expected.forEach((e, i) => {
    const m = MATRIX[i];
    ok(m.name === e[0] && m.qualitative === e[1] && m.quantitative === e[2] && m.precedent === e[3] && m.group === e[4], `matrix row ${i + 1} (${e[0]}) differs from the project's wording`);
  });
  const tile = cubes[0];
  const e = evaluateTile(tile);
  eq(e.results.map((r) => r.criterion.name), expected.map((x) => x[0]), "the twelve results come back in the matrix's order");
  eq(e.results.map((r) => r.key), MATRIX_KEYS, "the keys");
  ok(e.results.every((r) => r.interpretation.generated === true && r.measure.method.length > 0 && r.measure.cannot.length > 0), "every result says it is generated, how it was measured and what it cannot establish");
  // Spatial density is the project's twelfth descriptor (a decision, not a supplement), with the matrix's own criteria
  ok(MATRIX_KEYS[11] === "spatialDensity" && MATRIX[11].name === "Spatial density", "Spatial density is the twelfth descriptor");
  ok(!MATRIX.some((m) => /compressed|released/i.test(m.name)) && !MATRIX_KEYS.includes("compressed" as never), "the working name is not used anywhere in the matrix");
  ok(MATRIX[11].qualitative === "Perceived contrast between narrowest and widest moments." && MATRIX[11].quantitative === "Ratio of narrowest to widest passage width along the sequence.", "Spatial density keeps the matrix's qualitative and quantitative criteria");
  const legacy = scoreTile(tile);
  eq(legacy.map((r) => r.key), MATRIX_KEYS, "the older index list is the same twelve");
  eq(DESCRIPTOR_META.map((m) => m.label), MATRIX.map((m) => m.name), "the labels are the matrix's names");
  // the earlier formula (cross-section AREA along the main route) is a legacy measurement under another key: never in the twelve, never relabelled as the current criterion
  const lm = legacyMeasurementsFor(tile);
  ok(lm.length === 1 && (lm[0].key as string) === "spatialDensityArea", "the earlier Spatial density formula is kept as a legacy measurement");
  ok(!e.results.some((r) => (r.legacy.key as string) === "spatialDensityArea") && e.legacyMeasurements.length === 1, "the legacy measurement is beside the twelve, not among them");
  console.log(`  matrix: ${MATRIX.length} descriptors in ${new Set(MATRIX.map((m) => m.group)).size} groups, word for word, Spatial density the twelfth; the older index is relabelled, not converted; the earlier cross-section formula is a legacy measurement`);
}

// ---- 2. every ordinary tile reads without a manual step; statuses are honest ---------------------------------------------------------------------------------------
{
  const t0 = Date.now();
  let measured = 0;
  const statusCount: Record<string, number> = {};
  for (const t of cubes) {
    const e = evaluateTile(t);
    ok(e.results.length === 12, `${t.name}: ${e.results.length} results`);
    for (const r of e.results) {
      statusCount[r.measure.status] = (statusCount[r.measure.status] ?? 0) + 1;
      if (r.measure.status === "measured") measured++;
      // missing information is never a zero and never a pass
      if (r.measure.status === "unavailable") ok(r.measure.value === null, `${t.name} ${r.criterion.name}: not assessable but has a value ${r.measure.value}`);
      if (r.measure.value !== null) ok(Number.isFinite(r.measure.value), `${t.name} ${r.criterion.name}: value is not a number`);
      ok(r.interpretation.text.length > 10, `${t.name} ${r.criterion.name}: no reading`);
    }
    ok(e.usable.available, `${t.name}: usable space not read`);
    // Force-driven needs a recipe, and these fixtures carry none: honest, not zero
    const fd = e.results.find((r) => r.key === "forceDriven")!;
    ok(fd.measure.status === "unavailable" && fd.measure.value === null, `${t.name}: Force-driven without a recipe should be not assessable`);
  }
  console.log(`  ${cubes.length} tiles x 12 read in ${Date.now() - t0} ms with no manual input: ${Object.entries(statusCount).map(([k, v]) => `${v} ${STATUS_LABEL[k as keyof typeof STATUS_LABEL]}`).join(", ")}`);
  ok(measured > 0, "nothing was measured");
}

// ---- 3. Continuous and Compressed-then-released mean what the matrix says --------------------------------------------------------------------------------------
{
  const e = evaluateTile(cubes[1]);
  const c = e.results.find((r) => r.key === "continuous")!;
  // Continuous reads the continuity of SPACE (how much of the void and of the walkable floor is one connected body); it does not claim to count seams
  ok(c.measure.status === "measured" && c.measure.value !== null && c.measure.value >= 0 && c.measure.value <= 100, `Continuous should be a measured 0-100 continuity: ${c.measure.status} ${c.measure.value}`);
  ok(/connected/.test(c.measure.headline) && /continuity of space/.test(c.measure.unit), `Continuous names what it measures: ${c.measure.headline} / ${c.measure.unit}`);
  ok(/seamless|construction/i.test(c.measure.cannot), "Continuous does not say it cannot show seamless construction");
  const k = new Map(MATRIX.map((m) => [m.key, m]));
  ok(/passage width/.test(k.get("spatialDensity")!.quantitative), "Spatial density: narrowest to widest passage width");
  // a known passage: 4 ft, then a 3 ft neck, then a 10 ft chamber (widths are read between the walls, one cell added)
  const cor = ensureAnalysis(corridor());
  const r = evaluateTile(cor).results.find((x) => x.key === "spatialDensity")!;
  ok(r.measure.status === "measured" && r.measure.value !== null, `the corridor is not read: ${r.measure.headline} ${r.interpretation.text}`);
  // it is the ratio of narrowest to widest passage WIDTH: not occupancy, rooms per volume or a solid-to-void share
  const sd = spatialDensityFor(cor, DEFAULT_ASSUMPTIONS);
  ok(sd.ok && r.measure.value === sd.profile.narrowFt / sd.profile.wideFt && /passage width/.test(r.measure.unit), `Spatial density is not the narrowest / widest passage width: ${r.measure.value} vs ${sd.ok ? sd.profile.narrowFt / sd.profile.wideFt : "n/a"}`);
  ok(/width of the passage/.test(r.measure.method) && !/occupan|rooms per|solid-to-void/i.test(r.measure.unit), "Spatial density names its measurement honestly");
  ok(r.measure.supporting.some((s) => /legacy/i.test(s.label)), "the earlier formula's number is shown as a legacy measurement beside the current one");
  if (r.measure.value !== null) {
    ok(r.measure.value > 0.2 && r.measure.value < 0.45, `corridor ratio ${r.measure.value} (a 3 ft neck against a 10.5 ft chamber is about 0.3)`);
    ok(r.measure.supporting.some((s) => s.label === "Constrictions" && s.value !== "none") && r.measure.supporting.some((s) => s.label === "Expansions" && s.value !== "none"), "the corridor's constriction and expansion were not located");
    ok(!!r.evidence.routePoints && r.evidence.routePoints.length > 20, "the corridor's route is not offered as evidence");
  }
  console.log(`  Spatial density on a known passage: ${r.measure.headline}`);
  // a tile with no way in has no supported route: not assessable, with a reason, and no line through open air
  const sealed = ensureAnalysis(closed());
  const es = evaluateTile(sealed);
  for (const key of ["spatialDensity", "graduated", "nonHierarchical"] as const) {
    const x = es.results.find((q) => q.key === key)!;
    ok(x.measure.status === "unavailable" && x.measure.value === null && /opening|entry|floor/.test(x.interpretation.text), `${key} on a sealed room: ${x.measure.status} / ${x.interpretation.text}`);
  }
  // a sealed room is still one connected space: Continuous reads the geometry, which needs no way in
  const xc = es.results.find((q) => q.key === "continuous")!;
  ok(xc.measure.status === "measured" && /one connected space/.test(xc.measure.headline), `continuous on a sealed room: ${xc.measure.headline}`);
  console.log(`  a sealed room: routes, passages and enclosure are "not assessable" with the reason (no opening at ground level)`);
}

// ---- 4. honest statuses for missing information ---------------------------------------------------------------------------------------------------------------------
{
  const noCat = ensureAnalysis({ ...cubes[0], id: "nocat", name: "nocat", meta: undefined, guessed: {} } as ParsedTile);
  const th = evaluateTile(noCat).results.find((r) => r.key === "threaded")!;
  // spaces are counted from the walkable floors whether or not the tile has a program label; an unlabelled tile is never assumed public
  ok(th.measure.value !== null && th.measure.supporting.some((s) => /Public program/.test(s.label) && /^0 of/.test(s.value)), `an unlabelled tile must not be assumed public: ${th.measure.status} ${th.measure.headline} / ${th.measure.supporting.map((s) => s.value).join(" | ")}`);
  const withCat = evaluateTile(cubes[0]).results.find((r) => r.key === "threaded")!;
  ok(withCat.measure.status === "inferred" && withCat.measure.used.some((u) => /public/.test(u)), "Threaded with a category should say it is inferred, naming the public assumption");
  // no plates, no retained element
  const flat = ensureAnalysis({ ...cubes[0], id: "noplates", name: "noplates", voxels: { ...cubes[0].voxels, plates: undefined, struts: undefined }, structure: undefined, spaces: undefined } as ParsedTile);
  const rs = evaluateTile(flat).results.find((r) => r.key === "resistant")!;
  ok(rs.measure.status === "unavailable" && rs.measure.value === null && /no (protected|retained)|not called retained|remaining foam/.test(rs.interpretation.text), `no plates: ${rs.measure.status} / ${rs.interpretation.text}`);
  // no voxels at all: everything not assessable, nothing throws
  const bare = { ...cubes[0], id: "bare", name: "bare", voxels: {}, spaces: undefined, structure: undefined } as ParsedTile;
  const eb = evaluateTile(bare);
  ok(eb.results.every((r) => r.measure.status === "unavailable" && r.measure.value === null), "a tile with no voxel data should be entirely not assessable");
  console.log("  missing information: unlabelled program, no plates, no recipe, no voxels all give 'not assessable' with a reason");
}

// ---- 5. non-cubic containers: the mask is respected in every denominator ------------------------------------------------------------------------------------------
{
  const shaped = ensureAnalysis(L());
  const filled = ensureAnalysis(Lfilled());
  const f = voxelFacts(shaped)!;
  const g = voxelFacts(filled)!;
  ok(f.inside === 24000 && f.containerFt3 === 3000, `the L's container is ${f.containerFt3} ft3 (${f.inside} cells), not its 4,000 ft3 box`);
  ok(g.inside === 32000 && g.containerFt3 === 4000, "the filled L is the whole box");
  ok(f.voidCells === 15680, `the void trap in the notch leaked: ${f.voidCells} void cells`);
  const em = evaluateTile(shaped).results.find((r) => r.key === "monumental")!;
  const mf = evaluateTile(filled).results.find((r) => r.key === "monumental")!;
  ok(em.measure.supporting.some((s) => /3,000 ft³/.test(s.value)), `Monumental's volume denominator is not the L's 3,000 ft3: ${em.measure.supporting.map((s) => s.value).join(" | ")}`);
  ok(mf.measure.supporting.some((s) => /4,000 ft³/.test(s.value)), "Monumental's denominator for the filled L should be the box");
  const rs = evaluateTile(shaped).results.find((r) => r.key === "resistant")!;
  const rf = evaluateTile(filled).results.find((r) => r.key === "resistant")!;
  ok(rs.measure.supporting.some((s) => /Container/.test(s.label) && /notch is not counted/.test(s.how ?? "")), "Retained/Resistant does not say the notch is excluded");
  ok(rs.measure.supporting.some((s) => /Container/.test(s.label) && /300/.test(s.value)) && rf.measure.supporting.some((s) => /Container/.test(s.label) && /400/.test(s.value)), `the retained floors read against the L's own footprint: ${rs.measure.supporting.map((s) => s.value).join(" | ")}`);
  const lf = evaluateTile(shaped).results.find((r) => r.key === "lightFilled")!;
  ok(lf.measure.value !== null, "Light-filled on the L");
  console.log(`  non-cubic: the L reads against ${f.containerFt3} ft3 and ${f.footprintFt2} ft2 (box ${g.containerFt3} ft3, ${g.footprintFt2} ft2); retained plan share ${rs.measure.value?.toFixed(0)}% vs ${rf.measure.value?.toFixed(0)}%`);
}

// ---- 6. assemblies: the overhead exposure, the ground level and the program are read from the combined voxels ------------------------------------------------------
async function assemblies() {
  const tiles = new Map<string, ParsedTile>();
  const reg = (t: ParsedTile) => (tiles.set(t.id, ensureAnalysis(t)), tiles.get(t.id)!);
  const sky = reg(skylit());
  const cap = reg(block());
  const lobby = reg(cube("cube_lobby", "lobby"));
  const gath = reg(cube("cube_gath", "gathering"));
  const asTile = async (items: { tile: ParsedTile; at: [number, number, number] }[], name: string) => {
    let doc = emptyDoc();
    for (const it of items) doc = withPiece(doc, makePiece(doc, it.tile.id, it.at));
    const l = analyzeLayout(doc, tiles, defaultRules());
    ok(l.overlaps.length === 0, `${name}: pieces overlap`);
    const comp = buildComposite(l.boxes)!;
    const t = await compositeToTile(comp, l.boxes, { name, doc, withMeshes: false });
    return ensureAnalysis(t);
  };
  const alone = evaluateTile(sky).results.find((r) => r.key === "lightFilled")!;
  ok(alone.measure.value !== null && alone.measure.value > 0, `the roof opening alone should give a skylight share: ${alone.measure.headline}`);
  const covered = await asTile([{ tile: sky, at: [0, 0, 0] }, { tile: cap, at: [0, 0, 10] }], "covered");
  const cl = evaluateTile(covered).results.find((r) => r.key === "lightFilled")!;
  ok(cl.measure.value === 0 && /no roof opening/.test(cl.measure.headline), `a block over the roof opening must remove the skylight in the assembly: ${cl.measure.headline}`);
  const open = await asTile([{ tile: sky, at: [0, 0, 0] }, { tile: cap, at: [10, 0, 0] }], "beside");
  const ol = evaluateTile(open).results.find((r) => r.key === "lightFilled")!;
  ok(ol.measure.value !== null && ol.measure.value > 0, `the same block beside it leaves the opening: ${ol.measure.headline}`);
  console.log(`  assembly overhead exposure: roof opening alone ${alone.measure.headline.split(" — ")[0]}; covered by a block above: ${cl.measure.headline}; block beside it: ${ol.measure.headline.split(" — ")[0]}`);
  // program and ground level: a lobby on the ground and a gathering room above it
  const stack = await asTile([{ tile: lobby, at: [0, 0, 0] }, { tile: gath, at: [0, 0, 10] }], "stack");
  ok(!!stack.meta?.roomCategory && Object.values(stack.meta!.roomCategory!).includes("lobby") && Object.values(stack.meta!.roomCategory!).includes("gathering"), "the assembly tile does not carry the program of its rooms");
  const th = evaluateTile(stack).results.find((r) => r.key === "threaded")!;
  ok(th.measure.value === 1 && th.measure.supporting.some((s) => /Public program/.test(s.label) && /^1 of 1/.test(s.value)), `a gathering room above a lobby: ${th.measure.headline} / ${th.measure.supporting.map((s) => s.value).join(" | ")}`);
  const th2 = evaluateTile(stack, { assumptions: { ...DEFAULT_ASSUMPTIONS, publicCategories: ["lobby"] } }).results.find((r) => r.key === "threaded")!;
  ok(th2.measure.value === 1 && th2.measure.supporting.some((s) => /Public program/.test(s.label) && /^0 of 1/.test(s.value)), `if only lobbies are public the upper room is a space but not a public instance: ${th2.measure.headline} / ${th2.measure.supporting.map((s) => s.value).join(" | ")}`);
  console.log(`  assembly program: ${th.measure.headline}; with only lobby public: ${th2.measure.headline}`);
}

// ---- 7. overrides persist, reset independently, and survive a round trip --------------------------------------------------------------------------------------------
{
  let p = defaultProfile();
  const id = cubes[0].id;
  p = withPin(p, "carved", "on");
  p = withReason(p, "carved", "my reason");
  p = withInterpretation(p, id, "porous", "my reading");
  p = withAssumption(p, "setbackRunFt", 3.5);
  p = withRoomClass(p, id, 1, "private");
  p = withRoute(p, id, { to: [5, 5, 5] });
  p = withPick(p, "stepped amphitheater", id);
  const back = JSON.parse(JSON.stringify(p)) as typeof p;
  eq(back, p, "a profile survives a save and reload");
  eq(effectiveAssumptions(back).setbackRunFt, 3.5, "a changed threshold persists");
  eq(effectiveAssumptions(back).roomClass[`${id}:1`], "private", "a room class persists");
  // each one resets without disturbing the others
  const p1 = withoutAssumption(p, "setbackRunFt");
  eq(effectiveAssumptions(p1).setbackRunFt, DEFAULT_ASSUMPTIONS.setbackRunFt, "restoring a threshold");
  ok(p1.overrides.pins.carved === "on" && p1.overrides.reasons.carved === "my reason" && p1.overrides.interpretations[id].porous === "my reading" && p1.overrides.assumptions.roomClass![`${id}:1`] === "private" && !!p1.overrides.routes[id], "restoring one threshold must not touch the others");
  const p2 = withInterpretation(p, id, "porous", "");
  ok(!p2.overrides.interpretations[id] && p2.overrides.reasons.carved === "my reason", "restoring a reading removes it (and its tile entry) only");
  const p3 = withRoomClass(p, id, 1, null);
  ok(!p3.overrides.assumptions.roomClass && p3.overrides.assumptions.setbackRunFt === 3.5, "restoring a room class leaves the thresholds");
  const p4 = withRoute(p, id, null);
  ok(!p4.overrides.routes[id] && p4.overrides.picks["stepped amphitheater"] === id, "restoring a route leaves the pick");
  ok(effectiveCriteria(p).keys.includes("carved") && !effectiveCriteria(withPin(p, "carved", null)).keys.includes("carved"), "a pin carries a criterion and un-pinning puts it back to the suggestion");
  // an edited reading is shown, the generated one is kept
  const e = evaluateTile(cubes[0]);
  const por = e.results.find((r) => r.key === "porous")!;
  const shown = interpretationFor(p, id, por);
  ok(shown.edited && shown.text === "my reading" && por.interpretation.text !== "my reading", "an edited reading replaces the generated one on show only");
  // a changed threshold changes the result, and only for the criterion that uses it
  const base = evaluateTile(cubes[5]);
  const tight = evaluateTile(cubes[5], { assumptions: effectiveAssumptions(withAssumption(defaultProfile(), "setbackRunFt", 9)) });
  ok(tight.results.find((r) => r.key === "carved")!.measure.headline === base.results.find((r) => r.key === "carved")!.measure.headline, "a Stepped threshold changed Carved");
  console.log("  overrides: pins, reasons, readings, thresholds, room classes, routes and picks each persist, round-trip through JSON and reset on their own");
}

// ---- 8. a comparison profile stays put as variants arrive -------------------------------------------------------------------------------------------------------------
{
  const first = cubes.slice(0, 6);
  const evalsOf = (ts: ParsedTile[]) => ts.map((t) => evaluateTile(t));
  const s0 = suggestCriteria(first, evalsOf(first));
  ok(s0.keys.length < 12 && s0.keys.length >= 1, `the suggestion should carry some but not all (${s0.keys.length})`);
  let p = { ...defaultProfile(), adopted: adoptFrom(s0, first) };
  const keys0 = effectiveCriteria(p).keys;
  // a new variant arrives: the criteria in use do not change by themselves
  const more = cubes.slice(0, 11);
  const s1 = suggestCriteria(more, evalsOf(more));
  const diff = diffSuggestion(p, s1);
  eq(effectiveCriteria(p).keys, keys0, "adding tiles must not change the criteria in use");
  ok(JSON.stringify(effectiveAssumptions(p)) === JSON.stringify(DEFAULT_ASSUMPTIONS), "the assumptions are the same for the new tiles");
  // the new tile reads at once against the same profile
  const fresh = evaluateTile(cubes[10], { assumptions: effectiveAssumptions(p), routes: p.overrides.routes });
  ok(keys0.every((k) => !!fresh.results.find((r) => r.key === k)), "a new tile is read against the carried criteria immediately");
  console.log(`  profile: ${keys0.length} criteria adopted from 6 tiles; with 11 tiles the suggestion ${diff.changed ? `differs (+${diff.add.length} −${diff.remove.length}) and waits to be adopted` : "is the same"}`);
  p = { ...p, adopted: adoptFrom(s1, more) };
  eq(effectiveCriteria(p).keys, s1.keys, "adopting applies the suggestion");
  // no minimum, and a criterion that cannot be assessed for most tiles is set aside with the reason
  const one = cubes.slice(0, 1);
  const s2 = suggestCriteria(one, evalsOf(one));
  ok(s2.keys.length <= 12, "at most twelve");
  const fd = s0.setAside.forceDriven ?? "";
  ok(/assessed for only|can be assessed/.test(fd) || !s0.keys.includes("forceDriven"), `Force-driven (no recipe) should be set aside with its reason: ${fd}`);
  ok(!s0.keys.includes("forceDriven"), "a criterion not assessable for these tiles must not be carried");
  // a pick is made only where the evidence supports it
  const groups = typologyGroups(cubes);
  ok(groups.length === cubes.length, "fifteen different typologies are fifteen groups: they are never ranked against each other");
  const fake = ensureAnalysis({ ...cubes[3], id: "variant2", name: `${cubes[3].name}_V2` } as ParsedTile);
  const g2 = typologyGroups([cubes[3], fake]);
  ok(g2.length === 1 && g2[0].tiles.length === 2, "a _V2 tile is a variant of the same typology");
  const m = new Map([cubes[3], fake].map((t) => [t.id, evaluateTile(t)]));
  const pk = suggestPick(g2[0], m, ["porous", "carved"]);
  ok(!pk.supported && pk.tileId === null && /does not support|cannot be told apart/.test(pk.rationale), `identical variants must not get a forced pick: ${pk.rationale}`);
}

// ---- 8b. variant comparison: strength, fit and usability are kept apart; a bigger number is not a better building -------------------------------------------------
{
  type Spec = Partial<Record<MatrixKey, { v: number | null; status?: MatrixStatus }>>;
  const usableOf = (share: number, extra: Partial<UsableSpace> = {}): UsableSpace => ({ available: true, reason: "", thresholds: { headroomFt: 6.5, widthFt: 2.5, stepFt: 0.5, minZoneFt2: 12 }, voidFt3: 1000, reachableVoidFt3: 1000 * share, plateFt2: 0, floorFt2: 400, usableFt2: 400 * share, cutOffFt2: 400 * (1 - share), tightFt2: 0, voidPieces: 1, zones: 2, zonesReached: share > 0.8 ? 2 : 1, verticalVisual: 0, levelsTotal: 2, levelsReached: share > 0.8 ? 2 : 1, verticalTraversable: share > 0.8, tight: [], cutOff: [], ...extra });
  // a synthetic evaluation: only the measurements named are real, the rest are not assessable (never a zero)
  const fake = (tile: ParsedTile, spec: Spec, usable: UsableSpace = usableOf(0.95)): TileEvaluation => {
    const base = evaluateTile(tile);
    return {
      ...base,
      usable,
      results: base.results.map((r) => {
        const s = spec[r.key];
        if (!s) return { ...r, measure: { ...r.measure, value: null, status: "unavailable" as const, headline: "not assessable" } };
        return { ...r, measure: { ...r.measure, value: s.v, status: s.v === null ? ("unavailable" as const) : (s.status ?? "measured"), headline: s.v === null ? "not assessable" : String(s.v) }, interpretation: { ...r.interpretation, scale: ["low", "middle", "high"], index: s.v === null ? 0 : s.v < 3 ? 0 : s.v < 10 ? 1 : 2 } };
      }),
    };
  };
  const mk = (typology: string, n: number): { group: TypologyGroup; tiles: ParsedTile[] } => {
    const tiles = Array.from({ length: n }, (_, i) => ensureAnalysis({ ...cubes[i % cubes.length], id: `v${typology}${i}`, name: `${typology}_V${i + 1}`, meta: { ...(cubes[0].meta ?? {}), typology }, guessed: { ...cubes[0].guessed, typology } } as ParsedTile));
    return { group: typologyGroups(tiles)[0], tiles };
  };
  const pickOf = (typology: string, specs: Spec[], usables: UsableSpace[] = [], carried: MatrixKey[] = ["stepped", "graduated", "porous", "forceDriven", "carved", "spatialDensity", "nonHierarchical"], over = {}) => {
    const { group, tiles } = mk(typology, specs.length);
    const evals = new Map(tiles.map((t, i) => [t.id, fake(t, specs[i], usables[i])]));
    return { pick: suggestPick(group, evals, carried, over), tiles, group };
  };

  // the rules are typology-aware ranges, not "more is better"
  ok(preferenceFor("stepped amphitheater", "stepped").pref.mode === "target" && preferenceFor("flat deep plan plate", "stepped").pref.hi! <= 1, "a stepped typology wants a legible range of setbacks, a flat plate wants almost none");
  ok(preferenceFor("void field gathering", "forceDriven").pref.mode === "descriptive" && preferenceFor("stepped amphitheater", "resistant").pref.mode === "descriptive", "no defensible preference: described, not preferred");
  ok(fitOf({ mode: "target", lo: 2, hi: 8, why: "" }, 5) === 1 && fitOf({ mode: "target", lo: 2, hi: 8, why: "" }, 40)! === 0, "a target is a range: far above it is no better than far below");

  // 1. tiny numerical differences do not become decisive (no min/max stretching)
  {
    const r = pickOf("stepped amphitheater", [{ stepped: { v: 4.0 }, graduated: { v: 3, status: "measured" } }, { stepped: { v: 4.1 }, graduated: { v: 3, status: "measured" } }]);
    ok(!r.pick.supported && r.pick.verdict !== "pick", `a 4.0 against 4.1 setbacks must not decide: ${r.pick.verdict}`);
    const r2 = pickOf("stepped amphitheater", [{ stepped: { v: 2.0 }, graduated: { v: 3 } }, { stepped: { v: 2.2 }, graduated: { v: 3.4 } }]);
    ok(!r2.pick.supported, `differences smaller than the measurement resolution decide nothing: ${r2.pick.verdict}`);
  }
  // 2. a missing result is not a zero and is not used to compare
  {
    const r = pickOf("void field gathering", [{ porous: { v: 25 }, lightFilled: { v: 12 } }, { porous: { v: null }, lightFilled: { v: 12 } }], [], ["porous", "lightFilled"]);
    const por = r.pick.basis.find((b) => b.key === "porous")!;
    ok(!!por.notUsed && /not assessable for/.test(por.notUsed) && /not a zero/.test(por.notUsed), `a missing porosity should be reported, not used: ${por.notUsed}`);
    ok(por.rows[1].fit === null && por.rows[1].against === "not assessable" && por.rows[1].value === null, "a missing result has no fit and no value (not 0)");
    ok(!r.pick.supported, "with one usable criterion left there is not enough to pick");
  }
  // 3. proxies and assumptions are supporting evidence only: they cannot decide alone
  {
    const r = pickOf("topographic ground field", [{ carved: { v: 90, status: "proxy" }, threaded: { v: 2, status: "assumed" } }, { carved: { v: 35, status: "proxy" }, threaded: { v: 0, status: "assumed" } }], [], ["carved", "threaded"]);
    ok(!r.pick.supported && r.pick.verdict === "insufficient", `proxy and assumed evidence alone must not produce a pick: ${r.pick.verdict}`);
    ok(/proxy|assumed/.test(r.pick.rationale), `the reason names the weakness of the evidence: ${r.pick.rationale}`);
    ok(r.pick.basis.filter((b) => b.pref.mode !== "descriptive").every((b) => b.role === "supporting"), "proxy and assumed criteria are supporting, never decisive");
  }
  // 4. blindly increasing a metric does not improve the recommendation
  {
    const near = pickOf("stepped amphitheater", [{ stepped: { v: 5 }, graduated: { v: 3 } }, { stepped: { v: 60 }, graduated: { v: 3 } }, { stepped: { v: 5 }, graduated: { v: 3.2 } }]);
    const huge = pickOf("stepped amphitheater", [{ stepped: { v: 5 }, graduated: { v: 3 } }, { stepped: { v: 60 }, graduated: { v: 9 } }]);
    ok(huge.pick.tileId !== huge.tiles[1].id, "twelve times the setbacks must not be the pick: more steps are not better architecture");
    ok(near.pick.tileId !== near.tiles[1].id, "an overshooting variant is not the pick");
    const stepRow = huge.pick.basis.find((b) => b.key === "stepped")!;
    ok(stepRow.rows[0].against === "within" && stepRow.rows[1].against === "outside", "inside the target is fit, far above it is outside");
    // a criterion with no defensible preference changes nothing, however big it gets
    const a = pickOf("void field gathering", [{ porous: { v: 25 }, lightFilled: { v: 12 }, forceDriven: { v: 100 } }, { porous: { v: 25 }, lightFilled: { v: 12 }, forceDriven: { v: 5 } }], [], ["porous", "lightFilled", "forceDriven"]);
    const b = pickOf("void field gathering", [{ porous: { v: 25 }, lightFilled: { v: 12 }, forceDriven: { v: 100000 } }, { porous: { v: 25 }, lightFilled: { v: 12 }, forceDriven: { v: 5 } }], [], ["porous", "lightFilled", "forceDriven"]);
    ok(a.pick.verdict === b.pick.verdict && a.pick.tileId === b.pick.tileId && !a.pick.supported, `a bigger generating dose must not change the recommendation: ${a.pick.verdict} / ${b.pick.verdict}`);
    ok(a.pick.basis.find((x) => x.key === "forceDriven")!.pref.mode === "descriptive", "Force-driven is described, never preferred");
  }
  // 5. usability always accompanies a recommendation, and a clear usability gap blocks a pick
  {
    const good = pickOf("stepped amphitheater", [{ stepped: { v: 5 }, graduated: { v: 3 } }, { stepped: { v: 40 }, graduated: { v: 12 } }], [usableOf(0.95), usableOf(0.9)]);
    ok(good.pick.supported && good.pick.tileId === good.tiles[0].id, `a clear, usable leader is picked: ${good.pick.verdict} ${good.pick.rationale}`);
    ok(/Usability:/.test(good.pick.rationale) && good.pick.usability.length === 2, "a pick carries the usability of the variants");
    const blocked = pickOf("stepped amphitheater", [{ stepped: { v: 5 }, graduated: { v: 3 } }, { stepped: { v: 40 }, graduated: { v: 12 } }], [usableOf(0.25), usableOf(0.95)]);
    ok(!blocked.pick.supported && blocked.pick.verdict === "tradeoff" && /usab/.test(blocked.pick.rationale), `a leader that can hardly be walked must not be recommended over a usable variant: ${blocked.pick.verdict} / ${blocked.pick.rationale}`);
    ok(blocked.pick.usability[0].problems.length > 0, "the usability problem is stated");
  }
  // 6. no winner justified: the tradeoffs are explained automatically
  {
    const t = pickOf("stepped amphitheater", [{ stepped: { v: 5 }, graduated: { v: 9 } }, { stepped: { v: 45 }, graduated: { v: 3 } }], [], ["stepped", "graduated"]);
    ok(!t.pick.supported && t.pick.verdict === "tradeoff", `each variant wins on something: ${t.pick.verdict}`);
    ok(t.pick.tradeoffs.length >= 2 && t.pick.tradeoffs.some((x) => /Stepped/.test(x)) && t.pick.tradeoffs.some((x) => /Graduated/.test(x)), `the tradeoffs say who leads on what: ${t.pick.tradeoffs.join(" | ")}`);
    ok(t.pick.assumptions.length > 0 && t.pick.assumptions.every((a) => /system assumption|your override/.test(a)), "every rule is labelled as the system's assumption or yours");
  }
  // 7. overrides: yours replaces the system's for one typology, one criterion, and can be put back; the profile round-trips
  {
    const g = "stepped amphitheater";
    let p = defaultProfile();
    p = withTarget(p, g, "stepped", { mode: "target", lo: 30, hi: 50 });
    const back = JSON.parse(JSON.stringify(p));
    ok(back.overrides.targets[g].stepped.lo === 30, "the preference you set survives a JSON round trip");
    const mine = pickOf(g, [{ stepped: { v: 5 }, graduated: { v: 3 } }, { stepped: { v: 40 }, graduated: { v: 3 } }], [], ["stepped", "graduated"], back.overrides.targets[g]);
    ok(mine.pick.basis.find((b) => b.key === "stepped")!.source === "your override", "an override is labelled as yours");
    ok(mine.pick.tileId === mine.tiles[1].id || !mine.pick.supported, "with your target (30-50 setbacks) the 40 fits and the 5 does not");
    ok(mine.pick.basis.find((b) => b.key === "stepped")!.rows[1].against === "within", "your range is the one used");
    p = withTarget(p, g, "stepped", null);
    ok(!p.overrides.targets[g], "restoring the criterion removes the override and nothing else");
    const sys = pickOf(g, [{ stepped: { v: 5 }, graduated: { v: 3 } }, { stepped: { v: 40 }, graduated: { v: 3 } }], [], ["stepped", "graduated"], p.overrides.targets[g]);
    ok(sys.pick.basis.find((b) => b.key === "stepped")!.source === "system assumption", "restored to the system's assumption");
  }
  console.log("  variants: tiny differences, missing results, proxies, usability and 'more is better' are each handled: no forced pick, tradeoffs written out, usability always shown, rules labelled as system assumptions or yours");
}

// ---- 9. usable space ---------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const u = usableSpace(ensureAnalysis(cube()));
  ok(u.available && u.usableFt2 > 40 && u.reachableVoidFt3 > 100, `a plain room should have floor to walk on: ${u.usableFt2} ft2`);
  const closedU = usableSpace(ensureAnalysis(closed()));
  ok(closedU.usableFt2 === 0 && closedU.cutOffFt2 > 0, `a sealed room's floor cannot be reached: usable ${closedU.usableFt2}, cut off ${closedU.cutOffFt2}`);
  const pk = usableSpace(ensureAnalysis(pocket()));
  ok(pk.tightFt2 > 0 || pk.cutOffFt2 > 0, "a closet behind a doorway has floor that is tight or cut off");
  const real = cubes.map((t) => usableSpace(t));
  ok(real.every((x) => x.voidFt3 >= x.reachableVoidFt3 - 1e-6 && x.floorFt2 + 1e-6 >= x.usableFt2 + x.cutOffFt2 + x.tightFt2 - 1e-6), "reachable space is never more than the carved space");
  console.log(`  usable space: ${real.filter((x) => x.usableFt2 > 0).length} of ${real.length} tiles have floor reachable from an opening; the average tile has ${(real.reduce((a, x) => a + x.usableFt2 / Math.max(1, x.floorFt2), 0) / real.length * 100).toFixed(0)}% of its floor usable`);
}

// ---- 9b. one walking model: Analysis and Arrange agree on what can be walked --------------------------------------------------------------------------------------
{
  // The same four numbers (headroom, clear width, one step, the smallest space) decide where a person can stand and walk in Arrange's joints and in Analysis's
  // routes and usable-space check. Before they were unified Analysis used 5 ft of headroom and no width: it walked through a 2 ft neck and under a 5.5 ft lintel
  // that Arrange refused. Compare what each says about the SAME tile, cell for cell.
  const arrangeEntryZone = (t: ParsedTile): number => {
    const w = getWalk(getOcc(getOriented(t, 0, false)));
    const i = (3 * t.grid[1] + 12) * t.grid[2] + 2; // just inside the way in (x = 1.5 ft, y = 6 ft), standing on the floor slab
    return w.stand[i] ? w.zones[w.zone[i]].cells : 0;
  };
  const cases: { name: string; tile: ParsedTile; passes: boolean }[] = [
    { name: "a 3 ft neck", tile: ensureAnalysis(corridor("c3", "gathering", { neckFt: 3 })), passes: true },
    { name: "a 2 ft neck (too narrow: needs 2.5 ft clear width)", tile: ensureAnalysis(corridor("c2", "gathering", { neckFt: 2 })), passes: false },
    { name: "a 7 ft ceiling in the neck", tile: ensureAnalysis(corridor("h7", "gathering", { neckFt: 4, lowFt: 7 })), passes: true },
    { name: "a 5.5 ft ceiling in the neck (too low: needs 6.5 ft)", tile: ensureAnalysis(corridor("h55", "gathering", { neckFt: 4, lowFt: 5.5 })), passes: false },
  ];
  for (const c of cases) {
    const u = usableSpace(c.tile);
    const arr = arrangeEntryZone(c.tile);
    const analysisCells = Math.round(u.usableFt2 / 0.25);
    ok(arr > 0, `${c.name}: Arrange finds no floor to start from`);
    ok(arr === analysisCells, `${c.name}: Arrange's entry floor is ${arr} cells, Analysis's usable floor is ${analysisCells}`);
    const chamberReached = u.cutOffFt2 === 0;
    ok(chamberReached === c.passes, `${c.name}: the chamber beyond should ${c.passes ? "" : "not "}be reached on foot (cut off ${u.cutOffFt2} ft2)`);
    // the route the passage descriptors read goes through exactly when a person could walk
    const f = voxelFacts(c.tile)!;
    const rr = findRoute(f, { destination: "farthest" });
    const reachedX = rr.route ? Math.max(...rr.route.points.map((p) => p[0])) : 0;
    ok(c.passes ? reachedX > 30 : reachedX < 19, `${c.name}: the route reaches ${reachedX.toFixed(1)} ft (it should ${c.passes ? "cross into the chamber" : "stop before the constriction"})`);
    // the descriptors agree with the route: a blocked route is read as a short one, never as a passage through the neck
    const sd = evaluateTile(c.tile).results.find((x) => x.key === "spatialDensity")!;
    if (!c.passes) ok(sd.measure.supporting.some((s) => s.label === "Floor not reached"), `${c.name}: Spatial density does not say that floor was not reached`);
    else ok(sd.measure.value !== null && sd.measure.value < 0.6, `${c.name}: a passage that is walked should show its contrast (${sd.measure.value})`);
    console.log(`  walking: ${c.name}: Arrange ${arr} cells, Analysis ${analysisCells} cells, ${chamberReached ? "chamber reached" : "chamber cut off"}`);
  }
  // the rules are one set, and changing one changes both (the caches follow): a 1.5 ft clear width lets the 2 ft neck be walked in Arrange and in Analysis alike
  const narrow = cases[1].tile;
  const before = evaluateTile(narrow).results.find((x) => x.key === "spatialDensity")!.measure.headline;
  applyWalk({ widthFt: 1.5 });
  const arrWide = arrangeEntryZone(narrow);
  const uWide = usableSpace(narrow);
  const afterRule = evaluateTile(narrow).results.find((x) => x.key === "spatialDensity")!.measure.headline;
  applyWalk({ widthFt: DEFAULT_WALK.widthFt });
  ok(uWide.cutOffFt2 === 0 && arrWide === Math.round(uWide.usableFt2 / 0.25), "with a 1.5 ft clear width the 2 ft neck is walked, in Arrange and Analysis alike");
  ok(afterRule !== before, "a changed walking rule must recompute the Analysis results (the cache is keyed by the rules)");
  ok(evaluateTile(narrow).results.find((x) => x.key === "spatialDensity")!.measure.headline === before && usableSpace(narrow).cutOffFt2 > 0, "and putting the rule back restores the results");
  ok(WALK.headroomFt === 6.5 && WALK.widthFt === 2.5 && WALK.stepFt === 0.5, "the defaults are Arrange's: 6.5 ft headroom, 2.5 ft clear width, 0.5 ft step");
}

// ---- 10. migration ------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const m = migrateLegacy({ manual: true, keys: ["carved", "spatialDensity", "porous"], pins: { spatialDensity: "on", carved: "on" }, notes: { carved: "mine", spatialDensity: "my note on density" } });
  ok(!!m && m.overrides.pins.carved === "on" && m.overrides.reasons.carved === "mine", "pins and written reasons carry over");
  ok(!!m && m.overrides.pins.spatialDensity === "on" && m.overrides.reasons.spatialDensity === "my note on density", "the pin and the note on Spatial density are kept: it is one of the twelve");
  ok(!!m && m.overrides.pins.porous === "on", "a list edited by hand is kept as pins");
  ok(!!m?.migration && m.migration.notes.some((n) => /Spatial density/.test(n) && /legacy measurement/.test(n) && /recomputed/.test(n)), "the migration says the earlier Spatial density numbers are kept as a legacy measurement and the current criterion is recomputed");
  ok(!m?.adopted, "the list the program chose is not adopted: a fresh suggestion replaces it");
  ok(migrateLegacy(undefined) === null, "nothing to migrate");
  // a profile saved under the working name is read as Spatial density, everything kept
  const old = { ...defaultProfile(), adopted: { keys: ["compressed", "carved"], reasons: { compressed: "r" }, setAside: {}, basis: [], at: 1 }, overrides: { ...emptyOverrides(), pins: { compressed: "on" }, reasons: { compressed: "mine" }, interpretations: { t1: { compressed: "reading" } } } } as never as EvaluationProfile;
  const fixed = normalizeProfile(old);
  ok(fixed.adopted!.keys.includes("spatialDensity") && !fixed.adopted!.keys.includes("compressed" as never) && fixed.overrides.pins.spatialDensity === "on" && fixed.overrides.reasons.spatialDensity === "mine" && fixed.overrides.interpretations.t1.spatialDensity === "reading", "a profile saved under the working name is read as Spatial density with its pins, notes and readings");
  ok(normalizeProfile(fixed) === fixed, "an already-current profile is returned as it is");
}

// ---- 11. the Analysis, the Boards and the exports are one set of numbers ------------------------------------------------------------------------------------------------
{
  const ts = cubes.slice(0, 4);
  const evals = new Map<string, TileEvaluation>(ts.map((t) => [t.id, evaluateTile(t)]));
  const text = descriptorText(evals);
  const keys = MATRIX_KEYS;
  const rows: ResultRow[] = ts.map((t) => ({ tile: t, ev: evals.get(t.id)!, reading: (r) => r.interpretation.text }));
  const csv = resultsCsv(rows, keys).trim().split("\n");
  ok(csv.length === ts.length + 1, "the CSV has a row per tile");
  for (const t of ts) {
    const e = evals.get(t.id)!;
    for (const r of e.results) {
      ok(text[t.id][r.key].startsWith(r.measure.headline), `Boards text for ${t.name} / ${r.criterion.name} differs from the analysis`);
      ok(boardTextFor(r) === text[t.id][r.key], "one function writes the board text");
    }
    const line = csv.find((l) => l.startsWith(t.name))!;
    for (const r of e.results) ok(line.includes(r.measure.headline.replace(/"/g, '""')), `the CSV for ${t.name} / ${r.criterion.name} differs from the analysis`);
  }
  console.log(`  one source: the CSV rows and the Boards text equal the Analysis results for ${ts.length} tiles x 12 criteria`);
}

// ---- 9. the descriptors that used to read the same on every tile now differ across the first set ------------------------------------------------------------------
{
  const root = join(__dirname, "..", "lib", "tiles", "fixtures");
  const names = readdirSync(root).filter((n) => existsSync(join(root, n, "meta.json"))).sort();
  const tiles = names.map((n) => loadFixture(n, root)).filter((t): t is ParsedTile => !!t);
  if (tiles.length >= 10) {
    const keys: MatrixKey[] = ["carved", "stepped", "continuous", "resistant", "threaded", "graduated", "nonHierarchical", "forceDriven"];
    const seen = new Map<string, Set<string>>();
    const by = new Map<string, Map<string, { value: number | null; idx: number | undefined }>>();
    for (const t of tiles) {
      const e = evaluateTile(t);
      for (const k of keys) {
        const r = e.results.find((q) => q.key === k)!;
        (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(`${r.interpretation.index}/${r.measure.value === null ? "n" : Math.round(r.measure.value)}`);
        (by.get(t.name) ?? by.set(t.name, new Map()).get(t.name)!).set(k, { value: r.measure.value, idx: r.interpretation.index });
      }
    }
    // Graduated counts enclosure steps from the way in to the far floors; the set's tiles are one to two steps deep, so it takes two values (0 and 1): the others take three or more
    for (const k of keys) ok((seen.get(k)?.size ?? 0) >= (k === "graduated" ? 2 : 3), `${k} reads the same on (nearly) every tile of the set: ${[...(seen.get(k) ?? [])].join(", ")}`);
    // the tiles with many steps and terraces say so
    const g1 = by.get("gathering_1_stepped_amphitheater_v7");
    ok(!!g1 && (g1.get("stepped")!.idx ?? 0) >= 3, `the stepped amphitheater should read as terraced: ${JSON.stringify(g1?.get("stepped"))}`);
    const o2 = by.get("office_2_cascaded_terraced_plates_v7");
    ok(!!o2 && (o2.get("stepped")!.idx ?? 0) >= 2 && (o2.get("resistant")!.idx ?? 0) >= 2, `the cascaded plates should read as stepped with retained floors: ${JSON.stringify([o2?.get("stepped"), o2?.get("resistant")])}`);
    console.log(`  the eight fixed descriptors take ${keys.map((k) => `${k} ${seen.get(k)?.size}`).join(", ")} distinct values across ${tiles.length} tiles`);
  }
}

(async () => {
  await assemblies();
  console.log(failures ? `\n${failures} analysis check(s) failed` : "\nAll analysis checks passed");
  process.exit(failures ? 1 : 0);
})();
