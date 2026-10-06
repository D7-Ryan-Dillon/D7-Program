// Draws the Analysis exports outside a browser, so they can be looked at: the analysis sheets (22 x 11 in), the results table, an annotated diagram and the arrangement
// report. It needs a canvas for node, which is not a dependency of the app: `npm i --no-save @napi-rs/canvas` first. Pictures go to $ANALYSIS_OUT (default <tmp>/analysis-out).
// Run: npx tsx scripts/render-analysis.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  let createCanvas: (w: number, h: number) => { toBuffer: (t: string) => Buffer; toBlob?: unknown; width: number; height: number };
  try {
    // not a dependency of the app: the name is a variable so nothing resolves it unless this script is run with the package installed
    const pkg = "@napi-rs/canvas";
    const lib = (await import(pkg)) as { createCanvas: typeof createCanvas; Path2D: unknown };
    createCanvas = lib.createCanvas;
    (globalThis as unknown as { Path2D: unknown }).Path2D = lib.Path2D;
  } catch {
    console.log("(@napi-rs/canvas is not installed: run `npm i --no-save @napi-rs/canvas` to draw the exports here)");
    return;
  }
  const g = globalThis as unknown as { document: unknown };
  g.document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`no ${tag}`);
      const c = createCanvas(1, 1);
      (c as unknown as { toBlob: (cb: (b: Blob) => void, type?: string) => void }).toBlob = (cb, type) => cb(new Blob([new Uint8Array(c.toBuffer(type ?? "image/png"))], { type: type ?? "image/png" }));
      return c;
    },
  };
  const out = process.env.ANALYSIS_OUT ?? join(tmpdir(), "analysis-out");
  mkdirSync(out, { recursive: true });
  const save = async (name: string, blob: Blob) => writeFileSync(join(out, name), Buffer.from(await blob.arrayBuffer()));

  const { ensureAnalysis } = await import("../lib/tiles/pipeline");
  const { evaluateTile } = await import("../lib/scoring/matrixEval");
  const { defaultProfile, effectiveAssumptions, effectiveCriteria, adoptFrom, suggestCriteria, withInterpretation } = await import("../lib/scoring/profile");
  const { typologyGroups, suggestPick } = await import("../lib/scoring/compareSet");
  const { buildAnalysisSheets, defaultSheetContent } = await import("../lib/boards/analysisSheets");
  const { resultsImage, descriptorDiagram, diagramSheet } = await import("../lib/scoring/exportResults");
  const { defaultPalette } = await import("../lib/boardPalette");
  const { drawingStyle } = await import("../lib/drawing/render");

  const root = join(__dirname, "..", "lib", "tiles", "fixtures");
  const names = readdirSync(root).filter((n) => existsSync(join(root, n, "meta.json"))).sort();
  const read = (dir: string, f: string) => (existsSync(join(dir, f)) ? new Uint8Array(gunzipSync(readFileSync(join(dir, f)))) : undefined);
  const tiles = names.map((name) => {
    const dir = join(root, name);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { grid: [number, number, number]; cell_ft: number };
    const m = /^(gathering|office|lobby)_(\d+)_(.+)$/.exec(name)!;
    return ensureAnalysis({ id: name, name, sourceFolderName: name, tileFt: [meta.grid[0] * meta.cell_ft, meta.grid[1] * meta.cell_ft, meta.grid[2] * meta.cell_ft], cellFt: meta.cell_ft, grid: meta.grid, config: {}, metrics: {}, glbUrl: "", voxels: { void: read(dir, "void.u8.gz"), plates: read(dir, "plates.u8.gz") }, guessed: { category: m[1] as "gathering" }, meta: { category: m[1] as "gathering", typology: m[3].replace(/_/g, " ") } } as never);
  });
  // a second variant of one typology, so the variants sheet has something to compare
  const variant = ensureAnalysis({ ...tiles[5], id: `${tiles[5].id}_V2`, name: `${tiles[5].name}_V2`, voxels: { ...tiles[1].voxels }, spaces: undefined, structure: undefined } as never);
  const all = [...tiles, variant];
  let profile = defaultProfile();
  const evals = new Map(all.map((t) => [t.id, evaluateTile(t, { assumptions: effectiveAssumptions(profile), routes: profile.overrides.routes })]));
  const s = suggestCriteria(all, all.map((t) => evals.get(t.id)!));
  profile = { ...profile, adopted: adoptFrom(s, all) };
  profile = withInterpretation(profile, tiles[0].id, "porous", "My own reading: the openings are what make this tile.");
  const crit = effectiveCriteria(profile);
  console.log(`carried (${crit.keys.length}): ${crit.keys.join(", ")}`);
  for (const k of Object.keys(crit.setAside)) console.log(`  set aside ${k}: ${crit.setAside[k as never]}`);
  const groups = typologyGroups(all);
  const group = groups.find((x) => x.tiles.length > 1) ?? groups[0];
  const pick = suggestPick(group, evals, crit.keys);
  console.log(`pick for ${group.label}: ${pick.rationale}`);
  const sheets = await buildAnalysisSheets({ project: "Example Spaces", group, evals, profile, carried: crit.keys, reasons: crit.reasons, setAside: crit.setAside, pick, palette: defaultPalette(), content: defaultSheetContent(), widthIn: 22, heightIn: 11, dpi: 100 });
  for (const sh of sheets) await save(sh.name, sh.blob);
  const solo = groups.find((x) => x.tiles.length === 1)!;
  const sheets2 = await buildAnalysisSheets({ project: "Example Spaces", group: solo, evals, profile, carried: crit.keys, reasons: crit.reasons, setAside: crit.setAside, pick: suggestPick(solo, evals, crit.keys), palette: defaultPalette(), content: defaultSheetContent(), widthIn: 22, heightIn: 11, dpi: 100 });
  for (const sh of sheets2) await save(`solo_${sh.name}`, sh.blob);
  const rows = tiles.slice(0, 5).map((t) => ({ tile: t, ev: evals.get(t.id)!, reading: (r: { interpretation: { text: string } }) => r.interpretation.text }));
  await save("results_table.png", await resultsImage(rows as never, crit.keys, "dark", 1));
  const e0 = evals.get(tiles[1].id)!;
  await save("diagram_spatial_density.png", await descriptorDiagram(tiles[1], e0.results.find((r) => r.key === "spatialDensity")!, e0.results.find((r) => r.key === "spatialDensity")!.interpretation.text, drawingStyle("dark"), 1));
  await save("diagrams_sheet.png", await diagramSheet(tiles[1], e0.results, (r) => r.interpretation.text, "dark", 0.7));
  console.log(`wrote ${sheets.length + sheets2.length + 3} pictures to ${out}`);
}
void main();
