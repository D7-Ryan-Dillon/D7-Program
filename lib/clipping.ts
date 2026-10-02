// Shared interior-clipping-plane system, used by the Viewer tab, the
// Sections cube/hex builder, and (via lib/renderTile.ts) the Boards tab's
// per-tile popup editor. One plane, selectable on X/Y/Z and movable through
// the model, optionally reversible. The plane itself is never rendered --
// every mesh in this app is already THREE.DoubleSide, so clipping alone
// already reveals real interior backfaces at the cut (a free, correct
// cross-section); a thin boundary outline marks where the cut is without
// drawing a floating plane. An optional flat "cut face" fill (its own
// color/opacity for foam and void independently) can be layered on top via
// the standard stencil-buffer cap technique.

import * as THREE from "three";

export type ClipAxis = "x" | "y" | "z";

export interface CutFaceSettings {
  enabled: boolean;
  foamColor: string;
  foamOpacity: number;
  voidColor: string;
  voidOpacity: number;
}

export interface ClipState {
  enabled: boolean;
  axis: ClipAxis;
  /** 0..1 across the model's own current bounding box on that axis, not a
   * fixed world coordinate -- so the same ClipState works for a Grasshopper
   * box tile, a Section cube tile, and a hex-prism tile despite their
   * different shapes/sizes. */
  position: number;
  reversed: boolean;
  cutFace?: CutFaceSettings;
}

export function defaultCutFaceSettings(): CutFaceSettings {
  return { enabled: false, foamColor: "#f2b878", foamOpacity: 1, voidColor: "#db7228", voidOpacity: 1 };
}

export function defaultClipState(): ClipState {
  return { enabled: false, axis: "x", position: 0.5, reversed: false };
}

const AXIS_NORMAL: Record<ClipAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/** The plane for a given clip state against an object's own current
 * world-space bounding box. Normal points toward the kept side; the other
 * side is cut away. */
export function buildClipPlane(clip: ClipState, box: THREE.Box3): THREE.Plane {
  const normal = AXIS_NORMAL[clip.axis].clone();
  if (clip.reversed) normal.negate();
  const min = box.min[clip.axis];
  const max = box.max[clip.axis];
  const worldPos = min + (max - min) * Math.max(0, Math.min(1, clip.position));
  const point = box.getCenter(new THREE.Vector3());
  point[clip.axis] = worldPos;
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
}

/** Enables (or clears, with `plane: null`) clipping on every material of a
 * mesh. `clipShadows` is harmless to leave on even where nothing casts
 * shadows today. */
export function applyClipToMesh(mesh: THREE.Mesh, plane: THREE.Plane | null) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of materials) {
    mat.clippingPlanes = plane ? [plane] : null;
    mat.clipShadows = true;
    mat.needsUpdate = true;
  }
}

/** A thin line loop at the clip plane's intersection with the model's own
 * bounding box -- not the plane itself (which would read as a floating
 * card), just enough of a marker that the cut reads as a cut rather than an
 * oddly-shaped model. */
export function buildClipOutline(clip: ClipState, box: THREE.Box3, color = "#ffffff"): THREE.LineLoop {
  const axes: ClipAxis[] = ["x", "y", "z"];
  const [a, b] = axes.filter((ax) => ax !== clip.axis);
  const min = box.min[clip.axis];
  const max = box.max[clip.axis];
  const pos = min + (max - min) * Math.max(0, Math.min(1, clip.position));

  const corners = [
    [box.min[a], box.min[b]],
    [box.max[a], box.min[b]],
    [box.max[a], box.max[b]],
    [box.min[a], box.max[b]],
  ].map(([av, bv]) => {
    const v = new THREE.Vector3();
    v[clip.axis] = pos;
    v[a] = av;
    v[b] = bv;
    return v;
  });

  const geometry = new THREE.BufferGeometry().setFromPoints(corners);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  return new THREE.LineLoop(geometry, material);
}

let stencilGroupCounter = 1;

/** Gives a stencil pass-mesh the exact world transform of the mesh it
 * re-draws -- GLB nodes can carry their own transform, and the pass must
 * land on the same triangles the visible mesh does. (Callers add the cap
 * group at the scene root, so world matrix == local matrix there.) */
function followMesh(pass: THREE.Mesh, source: THREE.Mesh) {
  source.updateWorldMatrix(true, false);
  pass.matrixAutoUpdate = false;
  pass.matrix.copy(source.matrixWorld);
}

/** A flat colored fill exactly at the clip plane for one mesh, via the
 * standard stencil-buffer "cap" technique (three.js's own
 * webgl_clipping_stencil example is the reference pattern): two invisible
 * passes over the mesh's own geometry mark, in the stencil buffer, where a
 * clipped-away solid used to be, then a plane sized to the bounding box is
 * drawn flat-colored only where that stencil says "yes" and reset to 0
 * immediately after. Each call reserves its own small renderOrder range so
 * multiple capped meshes (foam, void) in the same scene don't fight over
 * the stencil buffer. Caller adds the returned group alongside the mesh and
 * removes it when clipping/the cut face is turned off. */
export function buildCutFaceCap(mesh: THREE.Mesh, plane: THREE.Plane, box: THREE.Box3, clip: ClipState, color: string, opacity: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "clip-cut-face-cap";
  const order = stencilGroupCounter * 10;
  stencilGroupCounter += 1;

  // Every pass below -- the invisible stencil counters AND the cap itself --
  // is flagged `transparent` even when the cap is fully opaque. three.js
  // draws all opaque objects before any transparent ones regardless of
  // renderOrder, so a translucent cap (<100% opacity) used to be deferred
  // until after BOTH the foam's and the void's stencil passes had run; the
  // two overlapping counts then made each cap fill the whole section as one
  // big panel. In one list, renderOrder runs foam-count, foam-cap, void-count,
  // void-cap strictly in turn, each cap clearing the stencil it used.
  const stencilBase = {
    transparent: true,
    depthWrite: false,
    colorWrite: false,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    clippingPlanes: [plane] as THREE.Plane[],
  };

  const backFaces = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({
      ...stencilBase,
      side: THREE.BackSide,
      stencilFail: THREE.IncrementWrapStencilOp,
      stencilZFail: THREE.IncrementWrapStencilOp,
      stencilZPass: THREE.IncrementWrapStencilOp,
    }),
  );
  backFaces.renderOrder = order;
  followMesh(backFaces, mesh);

  const frontFaces = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({
      ...stencilBase,
      side: THREE.FrontSide,
      stencilFail: THREE.DecrementWrapStencilOp,
      stencilZFail: THREE.DecrementWrapStencilOp,
      stencilZPass: THREE.DecrementWrapStencilOp,
    }),
  );
  frontFaces.renderOrder = order + 1;
  followMesh(frontFaces, mesh);

  const axes: ClipAxis[] = ["x", "y", "z"];
  const [a, b] = axes.filter((ax) => ax !== clip.axis);
  const size = box.getSize(new THREE.Vector3());
  const padding = 1.05; // slightly oversized so the cap never shows a sliver gap at the silhouette edge
  const planeGeom = new THREE.PlaneGeometry(size[a] * padding, size[b] * padding);
  // PlaneGeometry's own local axes are (x, y) with normal +z; remap to the
  // clip axis's actual world axes depending on which axis is being cut.
  if (clip.axis === "x") planeGeom.rotateY(Math.PI / 2);
  else if (clip.axis === "y") planeGeom.rotateX(-Math.PI / 2);
  // clip.axis === "z": PlaneGeometry's default orientation already matches.

  const capMesh = new THREE.Mesh(
    planeGeom,
    new THREE.MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ZeroStencilOp,
      stencilZFail: THREE.ZeroStencilOp,
      stencilZPass: THREE.ZeroStencilOp,
      depthTest: false,
    }),
  );
  const center = box.getCenter(new THREE.Vector3());
  const min = box.min[clip.axis];
  const max = box.max[clip.axis];
  center[clip.axis] = min + (max - min) * Math.max(0, Math.min(1, clip.position));
  capMesh.position.copy(center);
  capMesh.renderOrder = order + 2;

  group.add(backFaces, frontFaces, capMesh);
  return group;
}
