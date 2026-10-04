"""Measure a tile headless: void share, foam pieces, thin walls, the ports on its faces, and the interlock score
(the app's joint rule from docs/DATA_FORMAT.md section 5) for repeat / mirror / shift / rotate pairs and for any two different tiles.

  from tile_report import run_recipe, decode, metrics, port_map, pair_scores, compat
"""
import base64
import json
import os
import sys

import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from run_headless import run_engine  # noqa: E402


def run_recipe(path, **kw):
    text = open(path, encoding="utf-8").read() if os.path.exists(path) else path
    return run_engine(recipe=text, **kw)


def decode(out):
    td = json.loads(out["tile_data"])
    shape = tuple(td["grid"])
    bits = np.frombuffer(base64.b64decode(td["void_bits"]), dtype=np.uint8)
    v = np.unpackbits(bits)[: int(np.prod(shape))].reshape(shape).astype(bool)
    return v, float(td["cell_ft"])


def metrics(void, cell, min_wall_ft=1.0):
    foam = ~void
    lab, n = ndimage.label(foam)
    sizes = np.bincount(lab.ravel())[1:] if n else np.array([])
    cell3 = cell ** 3
    r = max(1, int(round(min_wall_ft / 2.0 / cell)))
    st = ndimage.generate_binary_structure(3, 1)
    opened = ndimage.binary_dilation(ndimage.binary_erosion(foam, st, iterations=r), st, iterations=r) if foam.any() else foam
    thin = float((foam & ~opened).sum()) / max(float(foam.sum()), 1.0)
    stray = []
    if n > 1:
        order = np.argsort(sizes)[::-1]
        objs = ndimage.find_objects(lab)
        for k in order[1:6]:
            sl = objs[k]
            stray.append("%.0f ft3 at x %.0f-%.0f y %.0f-%.0f z %.0f-%.0f" % (sizes[k] * cell3, sl[0].start * cell, sl[0].stop * cell,
                                                                           sl[1].start * cell, sl[1].stop * cell, sl[2].start * cell, sl[2].stop * cell))
    vlab, vn = ndimage.label(void)
    vsizes = np.bincount(vlab.ravel())[1:] if vn else np.array([])
    return dict(void_pct=100.0 * float(void.sum()) / void.size, foam_ft3=float(foam.sum()) * cell3, foam_pieces=int(n),
                foam_piece_ft3=sorted([round(float(s) * cell3, 1) for s in sizes], reverse=True)[:6],
                void_pieces=int(vn), void_piece_ft3=sorted([round(float(s) * cell3, 1) for s in vsizes], reverse=True)[:4],
                thin_foam_pct=100.0 * thin, stray=stray)


def faces(void):
    """Side face layers as [u][z] boolean (True = open). -X/+X: u = y ; -Y/+Y: u = x."""
    return {"-X": void[0, :, :], "+X": void[-1, :, :], "-Y": void[:, 0, :], "+Y": void[:, -1, :]}


def port_map(void, cell, floors=((2.0, 10.0), (12.0, 20.0))):
    """Text map of the openings on each side face per storey: open u-ranges (ft) and open share of the storey band."""
    lines = []
    for name, f in faces(void).items():
        row = []
        for (z0, z1) in floors:
            k0, k1 = int(round(z0 / cell)), int(round(z1 / cell))
            band = f[:, k0:k1]
            col_open = band.mean(axis=1) > 0.5            # columns open for more than half the storey height
            runs, i = [], 0
            while i < len(col_open):
                if col_open[i]:
                    j = i
                    while j < len(col_open) and col_open[j]:
                        j += 1
                    runs.append("%.1f-%.1f" % (i * cell, j * cell))
                    i = j
                else:
                    i += 1
            row.append("%s open %2d%%  [%s]" % ("L1" if z0 < 5 else "L2", int(100 * band.mean()), ", ".join(runs) or "-"))
        lines.append("  %s  %s" % (name, "   ".join(row)))
    return "\n".join(lines)


def _score(fp, fq):
    m = int((fp & fq).sum())
    dead = int((fp | fq).sum()) - m
    return (100.0 * m / (m + dead)) if (m + dead) else None, m, dead


def _shift_overlap(a, b, off):
    """a, b are [u][z]; b is displaced by `off` cells along u. Returns the overlapping parts."""
    n = a.shape[0]
    if off >= 0:
        return a[off:], b[: n - off]
    return a[: n + off], b[-off:]


def pair_scores(void, cell):
    """Score for each interlock pattern of one tile with copies of itself (app rule). None = nothing opens onto the joint."""
    nx, ny, nz = void.shape
    out = {}

    def joint(A, B, axis, off=0):
        if axis == 0:
            fa, fb = A[-1, :, :], B[0, :, :]
        else:
            fa, fb = A[:, -1, :], B[:, 0, :]
        if fa.shape != fb.shape:
            return None
        if off:
            fa, fb = _shift_overlap(fa, fb, off)
        return _score(fa, fb)[0]

    out["repeat-x"] = joint(void, void, 0)
    out["repeat-y"] = joint(void, void, 1)
    out["mirror-x"] = joint(void, void[::-1, :, :], 0)
    out["mirror-y"] = joint(void, void[:, ::-1, :], 1)
    out["shift-x"] = joint(void, void, 0, off=int(round(10.0 / cell)))
    out["shift-y"] = joint(void, void, 1, off=int(round(10.0 / cell)))
    if nx == ny:
        out["rot90-x"] = joint(void, np.rot90(void, 1, axes=(0, 1)), 0)
        out["rot180-x"] = joint(void, np.rot90(void, 2, axes=(0, 1)), 0)
        out["rot90-y"] = joint(void, np.rot90(void, 1, axes=(0, 1)), 1)
    fa, fb = void[:, :, -1], void[:, :, 0]
    out["repeat-z"] = _score(fa, fb)[0]
    return out


def compat(va, vb):
    """Best joint score of two different tiles over all pairs of side faces and both u-directions (rotation and mirror allowed).
    Returns (score, detail). Faces with no opening on either side score None."""
    fa, fb = faces(va), faces(vb)
    best, det = None, None
    for na, a in fa.items():
        for nb, b in fb.items():
            if a.shape != b.shape:
                continue
            for flip in (False, True):
                bb = b[::-1, :] if flip else b
                s, m, d = _score(a, bb)
                if s is not None and m > 0 and (best is None or s > best):
                    best, det = s, (na, nb, flip, m, d)
    return best, det


def summarize(name, out, extra=""):
    v, cell = decode(out)
    m = metrics(v, cell)
    ps = pair_scores(v, cell)
    lines = [name]
    lines.append("  void %.1f%% | foam %.0f ft3 in %d piece(s) %s | thin(<1ft) %.1f%% | void pieces %d %s" % (
        m["void_pct"], m["foam_ft3"], m["foam_pieces"], m["foam_piece_ft3"][:3], m["thin_foam_pct"], m["void_pieces"], m["void_piece_ft3"][:3]))
    for st in m["stray"]:
        lines.append("  stray foam piece: " + st)
    lines.append("  interlock: " + "  ".join("%s %s" % (k, "-" if s is None else "%d" % round(s)) for k, s in ps.items()))
    lines.append("  ports (open share of each storey band):")
    lines.append(port_map(v, cell))
    plog = [l.strip() for l in out["log"].splitlines() if l.strip().startswith("PLATE ") or l.strip().startswith("NOTE")]
    if plog:
        lines.append("  plates / notes:")
        lines += ["    " + l[:200] for l in plog]
    if extra:
        lines.append(extra)
    return "\n".join(lines), m, ps
