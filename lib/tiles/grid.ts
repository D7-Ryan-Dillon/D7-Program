// Voxel-grid helpers shared by lib/tiles: indexing, exact Euclidean distance, connected components, face layers and a small
// priority queue. Layout everywhere is the engine's: C order, z fastest, index = (x * ny + y) * nz + z.
//
// These mirror what the Python engine uses (scipy.ndimage), including the tie-breaking that decides which cell is
// labelled first, because the engine's own analysis (data/spaces.json) and lib/tiles/analyze.ts must agree. The parity
// check (npm run check:parity) is what proves it.

export type Grid = [number, number, number];

export const VIEWS = ["-X", "+X", "-Y", "+Y", "-Z", "+Z"] as const;
export const SIDE_FACES = ["-X", "+X", "-Y", "+Y"] as const;

export const cellIndex = (grid: Grid, x: number, y: number, z: number) => (x * grid[1] + y) * grid[2] + z;

/** Exact squared Euclidean distance (in cells) from every cell with target = 1 to the nearest cell with target = 0.
 * If there is no 0 anywhere the result is 1e12 everywhere. Felzenszwalb & Huttenlocher's lower envelope, one axis at a time. */
export function edtSquared(target: Uint8Array, grid: Grid): Float64Array {
  const [nx, ny, nz] = grid;
  const n = nx * ny * nz;
  const out = new Float64Array(n);
  let anyZero = false;
  for (let i = 0; i < n; i++) {
    if (target[i]) out[i] = 1e20;
    else {
      out[i] = 0;
      anyZero = true;
    }
  }
  if (!anyZero) {
    out.fill(1e12);
    return out;
  }
  const maxLen = Math.max(nx, ny, nz);
  const f = new Float64Array(maxLen);
  const d = new Float64Array(maxLen);
  const v = new Int32Array(maxLen);
  const z = new Float64Array(maxLen + 1);

  const pass = (len: number, stride: number, starts: number[]) => {
    for (const s of starts) {
      for (let q = 0; q < len; q++) f[q] = out[s + q * stride];
      let k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;
      for (let q = 1; q < len; q++) {
        let sIntersect: number;
        for (;;) {
          const p = v[k];
          sIntersect = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
          if (sIntersect <= z[k]) k--;
          else break;
          if (k < 0) {
            k = 0;
            break;
          }
        }
        k++;
        v[k] = q;
        z[k] = sIntersect;
        z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (z[k + 1] < q) k++;
        const p = v[k];
        d[q] = (q - p) * (q - p) + f[p];
      }
      for (let q = 0; q < len; q++) out[s + q * stride] = d[q];
    }
  };

  // along z
  let starts: number[] = [];
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) starts.push((x * ny + y) * nz);
  pass(nz, 1, starts);
  // along y
  starts = [];
  for (let x = 0; x < nx; x++) for (let zz = 0; zz < nz; zz++) starts.push(x * ny * nz + zz);
  pass(ny, nz, starts);
  // along x
  starts = [];
  for (let y = 0; y < ny; y++) for (let zz = 0; zz < nz; zz++) starts.push(y * nz + zz);
  pass(nx, ny * nz, starts);
  return out;
}

/** Six-neighbour connected components of a boolean volume, numbered 1.. in the raster order of each component's first cell. */
export function label6(mask: Uint8Array, grid: Grid): { labels: Int32Array; count: number } {
  const [nx, ny, nz] = grid;
  const labels = new Int32Array(mask.length);
  let count = 0;
  const stack: number[] = [];
  const syz = ny * nz;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    count++;
    labels[i] = count;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      const x = Math.floor(c / syz);
      const y = Math.floor((c - x * syz) / nz);
      const zz = c - x * syz - y * nz;
      const visit = (m: number) => {
        if (mask[m] && !labels[m]) {
          labels[m] = count;
          stack.push(m);
        }
      };
      if (x > 0) visit(c - syz);
      if (x < nx - 1) visit(c + syz);
      if (y > 0) visit(c - nz);
      if (y < ny - 1) visit(c + nz);
      if (zz > 0) visit(c - 1);
      if (zz < nz - 1) visit(c + 1);
    }
  }
  return { labels, count };
}

/** Four-neighbour components of a 2D boolean grid (rows x cols), returned as the list of component sizes in cells. */
export function componentSizes2d(mask: Uint8Array, rows: number, cols: number): number[] {
  const seen = new Uint8Array(mask.length);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const r = Math.floor(c / cols);
      const q = c - r * cols;
      const visit = (m: number) => {
        if (mask[m] && !seen[m]) {
          seen[m] = 1;
          stack.push(m);
        }
      };
      if (r > 0) visit(c - cols);
      if (r < rows - 1) visit(c + cols);
      if (q > 0) visit(c - 1);
      if (q < cols - 1) visit(c + 1);
    }
    sizes.push(size);
  }
  return sizes;
}

/** One face of a volume as a 2D array: X faces are [y][z], Y faces are [x][z], Z faces are [x][y] (the engine's stored axes). */
export function faceLayer(arr: ArrayLike<number>, grid: Grid, face: string): { data: Uint8Array; rows: number; cols: number } {
  const [nx, ny, nz] = grid;
  const axis = "XYZ".indexOf(face[1]);
  const at = face[0] === "-" ? 0 : grid[axis] - 1;
  if (axis === 0) {
    const data = new Uint8Array(ny * nz);
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) data[y * nz + z] = arr[(at * ny + y) * nz + z] ? 1 : 0;
    return { data, rows: ny, cols: nz };
  }
  if (axis === 1) {
    const data = new Uint8Array(nx * nz);
    for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) data[x * nz + z] = arr[(x * ny + at) * nz + z] ? 1 : 0;
    return { data, rows: nx, cols: nz };
  }
  const data = new Uint8Array(nx * ny);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) data[x * ny + y] = arr[(x * ny + y) * nz + at] ? 1 : 0;
  return { data, rows: nx, cols: ny };
}

/** Binary min-heap of (key, id) pairs ordered by key, then id (so ties always resolve the same way). */
export class MinHeap {
  private keys: number[] = [];
  private ids: number[] = [];

  get size() {
    return this.keys.length;
  }

  private less(a: number, b: number) {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.ids[a] < this.ids[b]);
  }

  private swap(a: number, b: number) {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const i = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = i;
  }

  push(key: number, id: number) {
    this.keys.push(key);
    this.ids.push(id);
    let c = this.keys.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!this.less(c, p)) break;
      this.swap(c, p);
      c = p;
    }
  }

  /** Removes the smallest entry and returns its id and key. */
  pop(): { key: number; id: number } {
    const key = this.keys[0];
    const id = this.ids[0];
    const lastKey = this.keys.pop()!;
    const lastId = this.ids.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      this.keys[0] = lastKey;
      this.ids[0] = lastId;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < n && this.less(l, m)) m = l;
        if (r < n && this.less(r, m)) m = r;
        if (m === c) break;
        this.swap(c, m);
        c = m;
      }
    }
    return { key, id };
  }
}
