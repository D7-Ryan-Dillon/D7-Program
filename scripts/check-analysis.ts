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
import { DESCRIPTOR_META, scoreTile, supplementalFor } from "../lib/scoring/descriptors";
import { DEFAULT_ASSUMPTIONS } from "../lib/scoring/assumptions";
import { adoptFrom, defaultProfile, diffSuggestion, effectiveAssumptions, effectiveCriteria, interpretationFor, migrateLegacy, suggestCriteria, withAssumption, withInterpretation, withPick, withPin, withReason, withRoomClass, withRoute, withoutAssumption } from "../lib/scoring/profile";
import { suggestPick, typologyGroups } from "../lib/scoring/compareSet";
import { descriptorText, boardTextFor } from "../lib/scoring/boardText";
import { resultsCsv, type ResultRow } from "../lib/scoring/exportResults";
import { voxelFacts } from "../lib/scoring/voxelFacts";
import { usableSpace } from "../lib/scoring/usable";
import { analyzeLayout } from "../lib/arrange/layout";
import { buildComposite, compositeToTile } from "../lib/arrange/composite";
import { makePiece, withPiece } from "../lib/arrange/ops";
import { defaultRules, emptyDoc } from "../lib/arrange/types";
import { L, Lfilled, block, closed, corridor, cube, pocket, skylit } from "./fixtures/shaped";

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
    ["Compressed-then-released", "Perceived contrast between narrowest and widest moments.", "Ratio of narrowest to widest passage width along the sequence.", "Gilder Center entrance to exhibit threshold.", "Experiential / atmospheric"],
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
  ok(!MATRIX_KEYS.includes("spatialDensity" as never), "Spatial density is not a matrix descriptor");
  const legacy = scoreTile(tile);
  eq(legacy.map((r) => r.key), MATRIX_KEYS, "the older index list is the same twelve, with Compressed-then-released where Spatial density was");
  eq(DESCRIPTOR_META.map((m) => m.label), MATRIX.map((m) => m.name), "the labels are the matrix's names");
  const sup = supplementalFor(tile);
  ok(sup.length === 1 && (sup[0].key as string) === "spatialDensity", "Spatial density is kept as a supplemental reading");
  ok(!e.results.some((r) => r.legacy.key === ("spatialDensity" as never)), "Spatial density is not among the results");
  console.log(`  matrix: ${MATRIX.length} descriptors in ${new Set(MATRIX.map((m) => m.group)).size} groups, word for word; the older index is relabelled, not converted; Spatial density is supplemental`);
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
  ok(c.measure.status !== "measured", "Continuous cannot be 'measured': the files hold no panel or joint model");
  ok(/seam|material|joint/i.test(c.measure.cannot) && /voxel|triangle|mesh/i.test(c.measure.cannot), "Continuous does not say that mesh triangles and voxel edges are not seams");
  ok(/material change/.test(c.measure.unit) || c.measure.status === "unavailable", "Continuous proxy is not in material changes");
  ok(!/connect|circulation/i.test(c.measure.unit), "Continuous must not substitute circulation connectivity");
  const k = new Map(MATRIX.map((m) => [m.key, m]));
  ok(/passage width/.test(k.get("compressed")!.quantitative), "Compressed-then-released: narrowest to widest passage width");
  // a known passage: 4 ft, then a 2 ft neck, then a 10 ft chamber (widths are read between the walls, one cell added)
  const cor = ensureAnalysis(corridor());
  const r = evaluateTile(cor).results.find((x) => x.key === "compressed")!;
  ok(r.measure.status === "measured" && r.measure.value !== null, `the corridor is not read: ${r.measure.headline} ${r.interpretation.text}`);
  if (r.measure.value !== null) {
    ok(r.measure.value > 0.13 && r.measure.value < 0.4, `corridor ratio ${r.measure.value} (a 2.5 ft neck against a 10.5 ft chamber is about 0.24)`);
    ok(r.measure.supporting.some((s) => s.label === "Constrictions" && s.value !== "none") && r.measure.supporting.some((s) => s.label === "Expansions" && s.value !== "none"), "the corridor's constriction and expansion were not located");
    ok(!!r.evidence.routePoints && r.evidence.routePoints.length > 20, "the corridor's route is not offered as evidence");
  }
  console.log(`  Compressed-then-released on a known passage: ${r.measure.headline}`);
  // a tile with no way in has no supported route: not assessable, with a reason, and no line through open air
  const sealed = ensureAnalysis(closed());
  const es = evaluateTile(sealed);
  for (const key of ["compressed", "graduated", "nonHierarchical", "continuous"] as const) {
    const x = es.results.find((q) => q.key === key)!;
    ok(x.measure.status === "unavailable" && x.measure.value === null && /opening|entry|floor/.test(x.interpretation.text), `${key} on a sealed room: ${x.measure.status} / ${x.interpretation.text}`);
  }
  console.log(`  a sealed room: routes, passages and enclosure are "not assessable" with the reason (no opening at ground level)`);
}

// ---- 4. honest statuses for missing information ---------------------------------------------------------------------------------------------------------------------
{
  const noCat = ensureAnalysis({ ...cubes[0], id: "nocat", name: "nocat", meta: undefined, guessed: {} } as ParsedTile);
  const th = evaluateTile(noCat).results.find((r) => r.key === "threaded")!;
  ok(th.measure.status === "unavailable" && th.measure.value === null, `an unlabelled tile must not be assumed public: ${th.measure.status} ${th.measure.headline}`);
  const withCat = evaluateTile(cubes[0]).results.find((r) => r.key === "threaded")!;
  ok(withCat.measure.status === "assumed" && withCat.measure.used.some((u) => /public/.test(u)), "Threaded with a category should be 'assumed', naming the assumption");
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
  ok(rs.measure.value !== null && rf.measure.value !== null && rs.measure.value > rf.measure.value, `plan-area share should be larger against the L's 300 ft2 footprint than the box's 400 ft2 (${rs.measure.value} vs ${rf.measure.value})`);
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
  ok(th.measure.value === 1, `a gathering room above a lobby: ${th.measure.headline}`);
  const th2 = evaluateTile(stack, { assumptions: { ...DEFAULT_ASSUMPTIONS, publicCategories: ["lobby"] } }).results.find((r) => r.key === "threaded")!;
  ok(th2.measure.value === 0, `if only lobbies are public the upper room is not a public instance: ${th2.measure.headline}`);
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

// ---- 10. migration ------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const m = migrateLegacy({ manual: true, keys: ["carved", "spatialDensity", "porous"], pins: { spatialDensity: "on", carved: "on" }, notes: { carved: "mine", spatialDensity: "old" } });
  ok(!!m && m.overrides.pins.carved === "on" && !("spatialDensity" in m.overrides.pins) && m.overrides.reasons.carved === "mine", "pins and written reasons carry over; Spatial density does not");
  ok(!!m?.migration && m.migration.notes.some((n) => /Spatial density/.test(n) && /not converted|not one of/.test(n)), "the migration says Spatial density was not converted into Compressed-then-released");
  ok(!m?.adopted, "the old list is not adopted: a fresh suggestion replaces it");
  ok(migrateLegacy(undefined) === null, "nothing to migrate");
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

(async () => {
  await assemblies();
  console.log(failures ? `\n${failures} analysis check(s) failed` : "\nAll analysis checks passed");
  process.exit(failures ? 1 : 0);
})();
