// The centre-placed instance transform of the older Arrange tab, kept because the legacy smooth (lib/exporters/csgFuse.ts)
// and the plain OBJ export still use it: mirror letters, then an optional tilt, then quarter turns about the vertical axis,
// all about the tile's own centre, then scaled and placed at its world centre -- in GLB metres / Y-up space.

import * as THREE from "three";

const FEET_PER_METRE = 3.280839895013123;

export function ftToGlb(v: [number, number, number]): [number, number, number] {
  const s = 1 / FEET_PER_METRE;
  return [v[0] * s, v[2] * s, -v[1] * s];
}

export function instanceMatrix(
  tileFt: [number, number, number],
  mirror: string,
  rotZ: number,
  posFt: [number, number, number],
  scale = 1,
  tilt?: { axis: "x" | "y"; steps: number },
): THREE.Matrix4 {
  const center = ftToGlb([tileFt[0] / 2, tileFt[1] / 2, tileFt[2] / 2]);
  let sx = 1, sy = 1, sz = 1;
  for (const ch of mirror.toLowerCase()) {
    if (ch === "x") sx = -1;
    else if (ch === "y") sz = -1;
    else if (ch === "z") sy = -1;
  }
  const worldPos = ftToGlb(posFt);
  const toOrigin = new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2]);
  const mirrorM = new THREE.Matrix4().makeScale(sx, sy, sz);
  const tiltM = tilt
    ? tilt.axis === "x"
      ? new THREE.Matrix4().makeRotationX((((tilt.steps % 4) + 4) % 4) * (Math.PI / 2))
      : new THREE.Matrix4().makeRotationZ((((tilt.steps % 4) + 4) % 4) * (Math.PI / 2))
    : new THREE.Matrix4();
  const rotM = new THREE.Matrix4().makeRotationY((((rotZ % 4) + 4) % 4) * (Math.PI / 2));
  const scaleM = new THREE.Matrix4().makeScale(scale, scale, scale);
  const worldM = new THREE.Matrix4().makeTranslation(worldPos[0], worldPos[1], worldPos[2]);
  return new THREE.Matrix4().multiply(worldM).multiply(scaleM).multiply(rotM).multiply(tiltM).multiply(mirrorM).multiply(toOrigin);
}
