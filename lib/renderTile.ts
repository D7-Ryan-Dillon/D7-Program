// Headless (non-React) three.js rendering of a tile's GLB from a fixed axo
// preset. Originally built for the Boards tab -- both its live on-screen
// preview (small) and its print-resolution export (large) go through this
// same function, just at different pixel sizes, so what you see is what you
// get -- now also the source of the small identifying thumbnails shown next
// to a tile's name in every tile bank/list across the app.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AXO_VIEWS, POPUP_VIEW_PRESETS, type AxoViewKey } from "@/lib/faceViews";
import { applyClipToMesh, buildClipOutline, buildClipPlane, buildCutFaceCap, type ClipState } from "@/lib/clipping";
import { HEX_APOTHEM } from "@/lib/sections/volumeField";
import type { CustomCamera, FacetLineSettings, OutlineSettings } from "@/lib/boards/types";

const loader = new GLTFLoader();
const sceneCache = new Map<string, Promise<THREE.Group>>();

function loadScene(glbUrl: string): Promise<THREE.Group> {
  let cached = sceneCache.get(glbUrl);
  if (!cached) {
    cached = loader.loadAsync(glbUrl).then((gltf) => gltf.scene);
    sceneCache.set(glbUrl, cached);
  }
  return cached;
}

export interface TileRenderOptions {
  glbUrl: string;
  view: AxoViewKey;
  /** Overrides `view` when present -- an exact camera captured from the
   * Boards tab's per-tile popup editor left in free Perspective rotation,
   * reproduced exactly rather than refit to a preset. */
  customCamera?: CustomCamera;
  /** Target pixel size -- rendered at this exact aspect ratio (not forced
   * square), and the camera distance is fit to whichever axis is tighter,
   * so the whole tile shows with no cropping regardless of the cell's own
   * proportions. */
  width: number;
  height: number;
  backgroundColor: string | null;
  foamColor: string;
  voidColor: string;
  foamOpacity: number;
  voidOpacity: number;
  foamVisible: boolean;
  voidVisible: boolean;
  clip?: ClipState;
  foamOutline?: OutlineSettings;
  voidOutline?: OutlineSettings;
  facetLines?: FacetLineSettings;
  /** Render pixels per printed point (1pt = 1/72in) -- turns the outline
   * weights (stored in points) into real pixel widths at this render's
   * size. Boards passes `dpi / 72`; only matters when an outline is on. */
  pxPerPt?: number;
  /** Identifying-thumbnail mode: on a tile built in the Sections cube/hex
   * builder, whose void is a solid cube shell that would hide the foam
   * entirely, the void is left out. */
  thumbnail?: boolean;
  /** Degrees the model is turned about its own vertical axis from the
   * starting view (positive = counter-clockwise seen from above). 0 is the
   * view exactly as set. Turntable GIF/MP4 export steps this 0..360. */
  orbitDeg?: number;
}

// ---------------------------------------------------------------------------
// Line decorations (Boards tab): outer-shape outline, void silhouette
// outline, facet lines. Shared by the headless renderer below and the
// per-tile popup editor's live R3F canvas so both draw identically.
// ---------------------------------------------------------------------------

/** What a decoration needs to know about the render it lands in. */
export interface LineContext {
  /** Drawing-buffer pixels per printed point. */
  pxPerPt: number;
  /** Drawing-buffer size -- fat lines are laid out in screen space. */
  resolution: THREE.Vector2;
  /** World units covered by one drawing-buffer pixel at the model's depth. */
  worldPerPx: number;
}

export type TileOuterShape = "cube" | "hex-prism";

/** Whether a tile's outer shape is a box or a hex prism: stamped into
 * `userData.tileShape` by lib/sections/mesh.ts (survives the GLB round trip
 * as a node extra), with a bounding-box proportion check as the fallback
 * for tiles from before that stamp (a hex prism is 0.866 as wide as it is
 * deep -- see volumeField.ts's HEX_APOTHEM). */
function readShapeStamp(root: THREE.Object3D): TileOuterShape | undefined {
  let stamped: unknown;
  root.traverse((o) => {
    if (stamped === undefined && o.userData && typeof o.userData.tileShape === "string") stamped = o.userData.tileShape;
  });
  return stamped === "hex-prism" || stamped === "cube" ? stamped : undefined;
}

export function detectTileShape(root: THREE.Object3D, box: THREE.Box3): TileOuterShape {
  const stamped = readShapeStamp(root);
  if (stamped) return stamped;
  const size = box.getSize(new THREE.Vector3());
  if (size.z > 0 && Math.abs(size.x / size.z - HEX_APOTHEM) < 0.03) return "hex-prism";
  return "cube";
}

function outerShapeSegments(box: THREE.Box3, shape: TileOuterShape): number[] {
  const { min, max } = box;
  const seg: number[] = [];
  const push = (a: number[], b: number[]) => seg.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  if (shape === "hex-prism") {
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const hx = (max.x - min.x) / 2;
    const hz = (max.z - min.z) / 2;
    // Corners at 30deg + k*60deg, flats facing +-x (volumeField.ts): the
    // bounding box's x half-extent is the corner x at 30deg, so scale by it.
    const corners = Array.from({ length: 6 }, (_, k) => {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      return [cx + (hx * Math.cos(a)) / Math.cos(Math.PI / 6), cz + hz * Math.sin(a)] as const;
    });
    for (let k = 0; k < 6; k++) {
      const [x0, z0] = corners[k];
      const [x1, z1] = corners[(k + 1) % 6];
      push([x0, min.y, z0], [x1, min.y, z1]);
      push([x0, max.y, z0], [x1, max.y, z1]);
      push([x0, min.y, z0], [x0, max.y, z0]);
    }
    return seg;
  }
  const xs = [min.x, max.x];
  const ys = [min.y, max.y];
  const zs = [min.z, max.z];
  for (const y of ys) for (const z of zs) push([min.x, y, z], [max.x, y, z]);
  for (const x of xs) for (const z of zs) push([x, min.y, z], [x, max.y, z]);
  for (const x of xs) for (const y of ys) push([x, y, min.z], [x, y, max.z]);
  return seg;
}

/** The foam outline: a screen-space-width line along the tile's outer shape
 * -- the cube's 12 edges, or the hex prism's 18 -- rather than tracing the
 * foam mesh itself. Real fat lines (LineSegments2), because plain WebGL
 * lines are stuck at 1px no matter what width you ask for. */
export function buildOuterShapeOutline(root: THREE.Object3D, box: THREE.Box3, settings: OutlineSettings, ctx: LineContext): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(outerShapeSegments(box, detectTileShape(root, box)));
  const material = new LineMaterial({
    color: new THREE.Color(settings.color),
    linewidth: Math.max(settings.weightPt * ctx.pxPerPt, 0.01),
    worldUnits: false,
    transparent: settings.opacity < 1,
    opacity: settings.opacity,
    resolution: ctx.resolution.clone(),
  });
  const lines = new LineSegments2(geometry, material);
  lines.name = "outer-shape-outline";
  return lines;
}

// A welded, smooth-normal copy of a mesh's geometry, used only to push the
// silhouette hull outward. Marching-cubes output is non-indexed (every
// triangle owns its vertices), so this welds first -- otherwise each corner
// would be pushed along its own face's normal and the hull would crack open.
const smoothHullBase = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function hullBase(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let base = smoothHullBase.get(geometry);
  if (!base) {
    const stripped = geometry.clone();
    for (const name of Object.keys(stripped.attributes)) if (name !== "position") stripped.deleteAttribute(name);
    base = mergeVertices(stripped, 1e-3);
    base.computeVertexNormals();
    smoothHullBase.set(geometry, base);
  }
  return base;
}

/** The void outline: a back-face-only duplicate of the void mesh, pushed out
 * along its smoothed normals by exactly the requested line weight (in
 * screen pixels at this render's scale), drawn behind the real surface so
 * only a rim of it peeks out around the silhouette. Pushing along normals
 * (rather than scaling the whole mesh about the origin, which is what an
 * earlier version did) gives every part of the silhouette the same
 * thickness. */
export function buildSilhouetteOutline(mesh: THREE.Mesh, settings: OutlineSettings, ctx: LineContext): THREE.Mesh {
  const base = hullBase(mesh.geometry);
  const distance = Math.max(settings.weightPt * ctx.pxPerPt, 0) * ctx.worldPerPx;
  const src = base.attributes.position.array as Float32Array;
  const normals = base.attributes.normal.array as Float32Array;
  const pushed = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) pushed[i] = src[i] + normals[i] * distance;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pushed, 3));
  geometry.setIndex(base.index);
  const outline = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: settings.color,
      opacity: settings.opacity,
      transparent: settings.opacity < 1,
      side: THREE.BackSide,
      // Behind the real surface wherever the two nearly coincide -- only the
      // rim that actually clears the silhouette should show.
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    }),
  );
  outline.name = "void-silhouette-outline";
  outline.position.copy(mesh.position);
  outline.rotation.copy(mesh.rotation);
  outline.scale.copy(mesh.scale);
  return outline;
}

export function buildFacetLines(mesh: THREE.Mesh, settings: FacetLineSettings, ctx: LineContext): LineSegments2 {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 1);
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(edges.attributes.position.array as Float32Array);
  edges.dispose();
  const lines = new LineSegments2(
    geometry,
    new LineMaterial({
      color: new THREE.Color(settings.color),
      linewidth: Math.max(settings.weightPt * ctx.pxPerPt, 0.01),
      worldUnits: false,
      transparent: settings.opacity < 1,
      opacity: settings.opacity,
      resolution: ctx.resolution.clone(),
    }),
  );
  lines.name = "foam-facet-lines";
  lines.position.copy(mesh.position);
  lines.rotation.copy(mesh.rotation);
  lines.scale.copy(mesh.scale);
  return lines;
}

export interface LineDecorSettings {
  foamOutline?: OutlineSettings;
  voidOutline?: OutlineSettings;
  facetLines?: FacetLineSettings;
}

/** Builds whichever of the three decorations are switched on for a tile
 * scene and returns them (not yet added anywhere) so the caller can parent
 * them and remove them again later. */
export function buildLineDecorations(root: THREE.Object3D, foam: THREE.Mesh | undefined, voidMesh: THREE.Mesh | undefined, box: THREE.Box3, settings: LineDecorSettings, ctx: LineContext): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  if (settings.foamOutline?.enabled) out.push(buildOuterShapeOutline(root, box, settings.foamOutline, ctx));
  if (settings.voidOutline?.enabled && voidMesh) out.push(buildSilhouetteOutline(voidMesh, settings.voidOutline, ctx));
  if (settings.facetLines?.enabled && foam) out.push(buildFacetLines(foam, settings.facetLines, ctx));
  return out;
}

/** Foam and void share their whole interface surface (the void is the cube
 * minus the foam), so drawing both lands two coincident surfaces on top of
 * each other -- a classic z-fight. These offsets push the void a hair behind
 * the foam, and both a hair behind any line drawn on them. */
function applyMaterial(mesh: THREE.Object3D | undefined, color: string, opacity: number, visible: boolean, kind: "foam" | "void") {
  if (!(mesh instanceof THREE.Mesh)) return;
  mesh.visible = visible;
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: kind === "void" ? 2 : 1,
    polygonOffsetUnits: kind === "void" ? 2 : 1,
  });
}

// Browsers cap how many live WebGL contexts can exist at once (commonly
// 8-16); a bank with a dozen-plus tiles would otherwise fire off that many
// renderTileToDataUrl calls at the same instant (one per thumbnail mounting
// together) and start silently losing contexts. Serializing every call
// through this queue -- thumbnails and the Boards tab's own export/preview
// calls alike -- keeps at most one renderer alive at a time; Boards already
// awaits these sequentially in its own loop, so this changes nothing for it.
let renderQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  renderQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** A tile prepared for rendering once and drawn many times: the scene is
 * cloned, materials / clipping / line decorations built a single time, and
 * only the camera moves between draws -- what makes a 100-frame turntable
 * affordable (a fresh clone and fresh decorations per frame would not be). */
export interface TileRig {
  /** Draws the tile turned `orbitDeg` degrees about its vertical axis (see
   * `TileRenderOptions.orbitDeg`) into the renderer the rig was made for,
   * which must already be sized to the rig's own width x height. */
  renderAt(orbitDeg: number): void;
  dispose(): void;
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** A WebGL renderer sized for `createTileRig`: stencil on (cut-face caps),
 * local clipping on, one drawing-buffer pixel per CSS pixel. */
export function createTileRenderer(width: number, height: number, alpha: boolean): THREE.WebGLRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true, stencil: true });
  renderer.localClippingEnabled = true;
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  return renderer;
}

/** Frees what a rig made for itself. The foam/void geometry is shared with
 * the cached source scene, so only their (per-rig) materials go. */
function disposeOwned(root: THREE.Object3D, ownGeometry: boolean) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (ownGeometry) mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

export async function createTileRig(renderer: THREE.WebGLRenderer, opts: TileRenderOptions): Promise<TileRig> {
  const original = await loadScene(opts.glbUrl);
  const scene = original.clone(true);

  applyMaterial(scene.getObjectByName("foam") ?? undefined, opts.foamColor, opts.foamOpacity, opts.foamVisible, "foam");
  applyMaterial(scene.getObjectByName("void") ?? undefined, opts.voidColor, opts.voidOpacity, opts.voidVisible && !(opts.thumbnail && readShapeStamp(scene)), "void");

  const box = new THREE.Box3().setFromObject(scene);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;

  const foamMesh = scene.getObjectByName("foam");
  const voidMesh = scene.getObjectByName("void");
  const foam = foamMesh instanceof THREE.Mesh ? foamMesh : undefined;
  const voidM = voidMesh instanceof THREE.Mesh ? voidMesh : undefined;

  // Camera first: the outline widths need to know how far away it sits.
  const aspect = opts.width / opts.height;
  const vFov = 42;
  const camera = new THREE.PerspectiveCamera(vFov, aspect, 0.05, 500);
  const lookTarget = new THREE.Vector3();
  let distance: number;
  if (opts.customCamera) {
    camera.position.set(...opts.customCamera.position);
    lookTarget.set(...opts.customCamera.target);
    camera.lookAt(lookTarget);
    distance = camera.position.distanceTo(lookTarget);
  } else {
    const preset = POPUP_VIEW_PRESETS.find((v) => v.key === opts.view) ?? AXO_VIEWS.find((v) => v.key === opts.view) ?? AXO_VIEWS[0];
    const dir = new THREE.Vector3(...preset.dir).normalize();
    // The sphere must fit inside whichever of the two field-of-view angles
    // (vertical, fixed; horizontal, derived from aspect) is tighter -- a
    // portrait cell (aspect < 1) narrows the horizontal fov below the
    // vertical one, so fitting only to vFov would crop the sides.
    const vHalf = (vFov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const constrainingHalf = Math.min(vHalf, hHalf);
    distance = (radius / Math.sin(constrainingHalf)) * 1.08;
    camera.position.copy(sphere.center).addScaledVector(dir, distance);
    camera.up.set(...preset.up);
    lookTarget.copy(sphere.center);
    camera.lookAt(lookTarget);
  }
  // A tight depth range keeps the depth buffer's precision where the model
  // actually is -- needed for the outline hull, which sits a fraction of a
  // pixel behind the real surface. Measured to the model's centre, which an
  // orbit about the model's own axis never changes.
  const centerDistance = camera.position.distanceTo(sphere.center);
  camera.near = Math.max(0.05, centerDistance - radius * 2);
  camera.far = centerDistance + radius * 3;
  camera.updateProjectionMatrix();

  let clipPlane: THREE.Plane | null = null;
  if (opts.clip?.enabled) {
    clipPlane = buildClipPlane(opts.clip, box);
    for (const mesh of [foam, voidM]) if (mesh) applyClipToMesh(mesh, clipPlane);
  }

  const owned: THREE.Object3D[] = [];
  const lineCtx: LineContext = {
    pxPerPt: opts.pxPerPt ?? 300 / 72,
    resolution: new THREE.Vector2(opts.width, opts.height),
    worldPerPx: (2 * distance * Math.tan((vFov * Math.PI) / 360)) / opts.height,
  };
  for (const obj of buildLineDecorations(scene, foam, voidM, box, { foamOutline: opts.foamOutline, voidOutline: opts.voidOutline, facetLines: opts.facetLines }, lineCtx)) owned.push(obj);

  if (clipPlane) {
    owned.push(buildClipOutline(opts.clip!, box));
    if (opts.clip!.cutFace?.enabled) {
      if (foam) owned.push(buildCutFaceCap(foam, clipPlane, box, opts.clip!, opts.clip!.cutFace.foamColor, opts.clip!.cutFace.foamOpacity));
      if (voidM) owned.push(buildCutFaceCap(voidM, clipPlane, box, opts.clip!, opts.clip!.cutFace.voidColor, opts.clip!.cutFace.voidOpacity));
    }
  }
  for (const obj of owned) scene.add(obj);

  const threeScene = new THREE.Scene();
  if (opts.backgroundColor) threeScene.background = new THREE.Color(opts.backgroundColor);
  threeScene.add(scene);
  // The lights ride in a group that turns with the camera, so a turntable
  // keeps the same lighting on the model's visible side instead of the
  // light sweeping across it.
  const lights = new THREE.Group();
  lights.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(6, 10, 4);
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-6, -4, -6);
  lights.add(fill);
  threeScene.add(lights);

  // The whole camera rig (position, look target, up) turns rigidly about the
  // vertical axis through the model's centre -- equivalent to turning the
  // model on a turntable, whatever the starting view (a top-down view just
  // spins in place).
  const baseOffset = camera.position.clone().sub(sphere.center);
  const baseTargetOffset = lookTarget.clone().sub(sphere.center);
  const baseUp = camera.up.clone();
  const scratch = new THREE.Vector3();

  return {
    renderAt(orbitDeg: number) {
      const a = -THREE.MathUtils.degToRad(orbitDeg);
      camera.position.copy(baseOffset).applyAxisAngle(UP_AXIS, a).add(sphere.center);
      camera.up.copy(baseUp).applyAxisAngle(UP_AXIS, a);
      camera.lookAt(scratch.copy(baseTargetOffset).applyAxisAngle(UP_AXIS, a).add(sphere.center));
      lights.rotation.y = a;
      renderer.render(threeScene, camera);
    },
    dispose() {
      for (const obj of owned) disposeOwned(obj, true);
      for (const mesh of [foam, voidM]) if (mesh) disposeOwned(mesh, false);
    },
  };
}

/** Renders one tile to a dataURL at `width`x`height` pixels. A fresh
 * renderer per call (rather than a pooled one) keeps this safe to run for
 * several tiles back to back, including at very large export sizes,
 * without one render's leftover state leaking into the next. */
export function renderTileToDataUrl(opts: TileRenderOptions): Promise<string> {
  return serialized(() => renderTileToDataUrlNow(opts));
}

async function renderTileToDataUrlNow(opts: TileRenderOptions): Promise<string> {
  const renderer = createTileRenderer(opts.width, opts.height, !opts.backgroundColor);
  try {
    const rig = await createTileRig(renderer, opts);
    rig.renderAt(opts.orbitDeg ?? 0);
    const dataUrl = renderer.domElement.toDataURL("image/png");
    rig.dispose();
    return dataUrl;
  } finally {
    // dispose() alone leaves the GL context alive until garbage collection;
    // a burst of renders (every builder edit makes a thumbnail) then hits the
    // browser's context cap and the oldest context -- the live viewport -- is
    // evicted. Release it explicitly.
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

const thumbnailCache = new Map<string, Promise<string>>();

/** Forgets everything cached for a GLB url -- for throwaway blob urls (e.g. a
 * builder preview rendered once for its saved thumbnail) so they don't pile up. */
export function evictTileRender(glbUrl: string) {
  sceneCache.delete(glbUrl);
  for (const key of [...thumbnailCache.keys()]) if (key.startsWith(`${glbUrl}@`)) thumbnailCache.delete(key);
}

/** A small identifying preview for a tile bank/list row -- same fixed angle
 * and colors everywhere (matching the Viewer tab's own default look) so
 * thumbnails read consistently across Viewer, Analysis, Arrange and Boards,
 * rather than each tab inventing its own. Cached per glbUrl+size: several
 * banks can show the same tile at the same time (e.g. Arrange and Boards
 * open together isn't possible today, but Viewer/Analysis's own switcher
 * and a future split view might), and a tile's GLB never changes once
 * loaded. */
export function renderTileThumbnail(glbUrl: string, size: number): Promise<string> {
  const key = `${glbUrl}@${size}`;
  let cached = thumbnailCache.get(key);
  if (!cached) {
    cached = renderTileToDataUrl({
      glbUrl,
      view: "iso-top-ne",
      width: size,
      height: size,
      backgroundColor: null,
      foamColor: "#e8a6c8",
      voidColor: "#1c1c1c",
      foamOpacity: 1,
      voidOpacity: 1,
      foamVisible: true,
      voidVisible: true,
      thumbnail: true,
    });
    thumbnailCache.set(key, cached);
    cached.catch(() => thumbnailCache.delete(key));
  }
  return cached;
}
