// The arrangement back into Rhino: an engine 7 `mass` (the finished result as text, for the engine's `mass_in`) and a recipe
// that starts from it, so a second engine pass can add passages where joints dead-end, open rooms, or erode further, and the
// result comes back to the app as a tile. Packed exactly as the engine unpacks it (docs: engine/ENGINE_7_GUIDE.md, "Two passes"):
// zlib-compressed base64 arrays in C order, z fastest; bits packed big-endian like numpy.packbits.

import JSZip from "jszip";
import type { Composite } from "./composite";

async function deflate(bytes: Uint8Array): Promise<string> {
  // "deflate" is the zlib format Python's zlib.decompress reads
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = "";
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
}

function packBits(a: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.ceil(a.length / 8));
  for (let i = 0; i < a.length; i++) if (a[i]) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

export interface RhinoExport {
  blob: Blob;
  files: string[];
  notes: string[];
}

export async function buildRhinoZip(comp: Composite, name: string): Promise<RhinoExport> {
  if (typeof CompressionStream === "undefined") throw new Error("This browser can't compress the mass (CompressionStream). Use Chrome, Edge or a recent Safari.");
  const [nx, ny, nz] = comp.grid;
  const n = nx * ny * nz;
  const material = new Uint8Array(n);
  for (let i = 0; i < n; i++) material[i] = comp.mask[i] && !comp.void[i] ? 255 : 0;
  const struts = new Uint8Array(n);
  for (let i = 0; i < n; i++) struts[i] = comp.struts[i] && !comp.void[i] ? 1 : 0;
  const foam = { v: 1, noise: 0.55, scale: 3.6, grain: 0.22, seed: 1, web: 0.0, web_open: 0.3, web_thickness: 0.5, layers: false, layer_count: 3, layer_axis: 2, layer_thickness: 0.75, layer_strength: 0.85 };
  const mass = {
    schema: "erosion-mass/1",
    engine: "7.0",
    origin: comp.origin,
    cell: comp.cell,
    shape: [nx, ny, nz],
    mask: await deflate(packBits(comp.mask)),
    material: await deflate(material),
    // floor plates become ordinary foam in the second pass (their flat tops are kept in the voxels; the engine's plate objects are not rebuilt here)
    plate_id: await deflate(new Uint8Array(n * 2)),
    struts: await deflate(packBits(struts)),
    foam,
    groups: [],
    plates: [],
  };
  const recipe = {
    schema: "erosion-recipe/2",
    name: `${name}_pass2`,
    engine_version: "7.0",
    sim: { tile_w: 20, tile_h: 20, cell: comp.cell, steps: 140, gravity: 0.6, drain: false, n_frames: 8, smooth: 0.8, seed: 1 },
    cleanup: { min_void_ft3: 6, min_foam_ft3: 8, weld: "" },
    foam,
    plates: [],
    sources: [],
    start: mass,
    frame: null,
  };
  const zip = new JSZip();
  const stem = name.replace(/[^A-Za-z0-9_.+-]+/g, "_") || "arrangement";
  zip.file(`${stem}.mass.json`, JSON.stringify(mass));
  zip.file(`${stem}_pass2.recipe.json`, JSON.stringify(recipe));
  zip.file(
    "README.txt",
    [
      `${name}: an arrangement as an engine 7 mass`,
      "",
      `Grid ${nx} x ${ny} x ${nz} cells of ${comp.cell} ft; the low corner is at (${comp.origin.map((v) => v.toFixed(1)).join(", ")}) ft in world coordinates.`,
      "",
      "To carry on in Grasshopper:",
      `1. Paste ${stem}.mass.json into a Panel (Multiline Data) wired to the engine's mass_in, add new Erosion Sources (and Floor Plates) in world coordinates, run.`,
      `   Or paste ${stem}_pass2.recipe.json into the recipe Panel: it carries the mass and has no sources yet (add some to its "sources" list).`,
      "2. Export as usual and drop the _analysis folder into the app's Viewer: the result is a tile like any other.",
      "",
      "Notes: floor plates arrive as ordinary foam (flat tops are kept); a source placed in a joint that dead-ends opens it.",
    ].join("\n"),
  );
  return { blob: await zip.generateAsync({ type: "blob" }), files: [`${stem}.mass.json`, `${stem}_pass2.recipe.json`, "README.txt"], notes: [] };
}
