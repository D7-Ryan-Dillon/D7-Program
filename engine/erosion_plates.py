# =====================================================================
# EROSION - FLOOR PLATES  (one of these per GROUP of plates)
# Units: feet (decimal), Rhino world coordinates. Everything you reference is
# used EXACTLY where it is: there is no elevation, no move, no placement input.
# Make as many copies of this component as you like: everything in one copy
# shares one set of settings, a second copy can hold plates with different
# settings. Wire every copy's `plates` output into the engine's `plates` input
# (set that input to List Access).
#
# INPUTS  (only `shapes` is required)
#   shapes          : list of closed CURVES and/or GEOMETRY (Rhino references or
#                     Grasshopper geometry, mixed freely).
#                     - A closed flat CURVE is the TOP SURFACE of a slab. It is
#                       extruded by `thickness` below itself (a negative thickness
#                       extrudes upward instead). A curve in a tilted plane makes a
#                       sloped slab whose top is that plane.
#                     - Curves inside another curve in the same plane are OPENINGS in it
#                       (outer ring + inner ring = a slab with a hole).
#                     - GEOMETRY (closed Brep / box / extrusion / closed mesh) is used
#                       exactly as modelled: `thickness` does nothing for it.
#                     - An open single flat surface is treated like its boundary curve.
#   thickness       : ft, slab thickness for CURVES (measured square to the plate,
#                     so a tilted slab keeps this thickness). Default 1.0
#   resistance      : how hard the plate is to dissolve compared with foam. 1 = same as
#                     the foam around it, 3 = three times harder, 0.5 = softer. The foam's
#                     own noise, lobes and webs still apply to plates. Default 1.0
#   anchor_ft       : ft, foam within this distance of a plate is made denser so the
#                     connection around the plate survives erosion. 0 = off. Default 1.5
#   anchor_strength : how much denser that foam gets right at the plate (1 = no change,
#                     3 = three times). Default 3.0
#   auto_support    : True = after erosion, any plate that is not held up well enough
#                     gets branches (struts) grown to the rest of the foam. Default True
#   min_support     : ft2, the contact area a plate must share with the main foam body.
#                     Default 6.0
#   max_span        : ft, the longest stretch of plate allowed without support. Default 12.0
#   strut_size      : ft, diameter of the branches. Default 1.5
#   verticality     : 0 = a branch goes to the NEAREST foam at any angle ... 1 = branches
#                     prefer straight columns. Default 0.3
#   branch_from_top : True = branches may also grow from the plate's TOP face (up to foam
#                     above). Off = branches leave from the underside and sides only.
#                     The top face of a plate stays flat either way. Default False
#   support_pts     : optional points where YOU want a branch to leave a plate (each
#                     becomes a branch from the nearest plate cell, before the automatic ones)
#   name            : optional label, shown in the engine's log and plates.json
#
# OUTPUTS
#   plates : a text description of this group -> engine `plates` (List Access)
#   marker : preview geometry (slabs for curves, your geometry, support points)
# =====================================================================
import json
import math
import Rhino.Geometry as rg

SAMPLE_FT = 0.2          # a smooth curve is stored as points about this far apart
MAX_CURVE_PTS = 900
MAX_FACES = 60000


def _inp(name, default):
    v = globals().get(name)
    return default if v is None else v


def _truthy(v):
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


def _as_list(v):
    if v is None:
        return []
    if isinstance(v, (str, bytes, dict)):
        return [v]
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            out.extend(_as_list(x))
        return out
    try:
        if hasattr(v, "__iter__") and not hasattr(v, "X") and not hasattr(v, "PointAt"):
            return _as_list(list(v))
    except Exception:
        pass
    return [v]


def _geom_from_guid(g):
    docs = []
    try:
        import Rhino
        docs.append(Rhino.RhinoDoc.ActiveDoc)
        docs.extend(list(Rhino.RhinoDoc.OpenDocuments()))
    except Exception:
        pass
    try:
        import scriptcontext as sc
        docs.append(sc.doc)
    except Exception:
        pass
    for d in docs:
        if d is None:
            continue
        try:
            obj = d.Objects.FindId(g)
        except Exception:
            obj = None
        if obj is not None and obj.Geometry is not None:
            return obj.Geometry
    raise ValueError("no Rhino object found for referenced id " + str(g))


def _unwrap(v):
    if v is None:
        return None
    if type(v).__name__ == "Guid":
        return _unwrap(_geom_from_guid(v))
    if hasattr(v, "Value") and not hasattr(v, "PointAt") and not hasattr(v, "Vertices") and not hasattr(v, "Faces"):
        return _unwrap(v.Value)
    return v


def _is_curve(g):
    return hasattr(g, "PointAt") and hasattr(g, "GetLength") and hasattr(g, "Domain")


def _xyz(p):
    return [round(float(p.X), 5), round(float(p.Y), 5), round(float(p.Z), 5)]


def _curve_points(c):
    """A closed curve -> list of [x, y, z] (no repeated end point). Polylines keep their exact corners."""
    pts = None
    if isinstance(c, rg.PolylineCurve):
        pts = [_xyz(c.Point(i)) for i in range(c.PointCount)]
    else:
        ok, pl = False, None
        try:
            res = c.TryGetPolyline()
            if isinstance(res, tuple):
                ok, pl = res[0], res[1]
            else:
                ok, pl = (res is not None), res
        except Exception:
            ok = False
        if ok and pl is not None and pl.Count >= 3:
            pts = [_xyz(pl[i]) for i in range(pl.Count)]
    if pts is None:
        length = float(c.GetLength())
        n = max(16, min(MAX_CURVE_PTS, int(math.ceil(length / SAMPLE_FT))))
        ts = list(c.DivideByCount(n, True) or [c.Domain.T0, c.Domain.T1])
        try:                                                    # keep sharp corners of mixed curves
            t = c.Domain.T0
            for _ in range(400):
                res = c.GetNextDiscontinuity(rg.Continuity.C1_continuous, t, c.Domain.T1)
                ok, tt = (res[0], res[1]) if isinstance(res, tuple) else (False, None)
                if not ok:
                    break
                ts.append(tt)
                t = tt
        except Exception:
            pass
        ts = sorted(set(round(float(t), 9) for t in ts))
        pts = [_xyz(c.PointAt(t)) for t in ts]
    out = []
    for p in pts:                                               # drop repeats
        if not out or max(abs(p[0] - out[-1][0]), abs(p[1] - out[-1][1]), abs(p[2] - out[-1][2])) > 1e-6:
            out.append(p)
    if len(out) > 1 and max(abs(out[0][a] - out[-1][a]) for a in range(3)) <= 1e-3:
        out.pop()
    closed = False
    try:
        closed = bool(c.IsClosed)
    except Exception:
        pass
    if not closed:
        a, b = c.PointAtStart, c.PointAtEnd
        closed = a.DistanceTo(b) <= 1e-3
    if not closed:
        raise ValueError("a curve in `shapes` is not closed. Close it (or join it) and try again.")
    if len(out) < 3:
        raise ValueError("a curve in `shapes` has fewer than 3 distinct points.")
    return out


def _mesh_arrays(m):
    m = m.DuplicateMesh()
    m.Faces.ConvertQuadsToTriangles()
    verts = [_xyz(m.Vertices[i]) for i in range(m.Vertices.Count)]
    faces = []
    for i in range(m.Faces.Count):
        f = m.Faces[i]
        faces.append([int(f.A), int(f.B), int(f.C)])
    return verts, faces, m


def _brep_to_mesh(brep):
    parts = rg.Mesh.CreateFromBrep(brep, rg.MeshingParameters.QualityRenderMesh)
    if not parts:
        raise ValueError("a Brep in `shapes` could not be meshed.")
    mesh = rg.Mesh()
    for part in parts:
        mesh.Append(part)
    return mesh


def _read_shapes(raw, notes):
    """-> (shapes for the spec, preview geometry)."""
    shapes, preview = [], []
    for item in _as_list(raw):
        g = _unwrap(item)
        if g is None:
            continue
        if _is_curve(g):
            shapes.append({"type": "poly", "pts": _curve_points(g)})
            continue
        mesh = None
        if isinstance(g, rg.Mesh):
            mesh = g
            if not g.IsClosed:
                raise ValueError("a mesh in `shapes` is not closed. Cap/weld it first, or use a closed Brep.")
        else:
            brep = None
            if isinstance(g, rg.Brep):
                brep = g
            elif hasattr(g, "ToBrep"):
                brep = g.ToBrep()
            elif isinstance(g, rg.Surface):
                brep = rg.Brep.CreateFromSurface(g)
            if brep is None:
                raise ValueError("`shapes` accepts curves, closed Breps / boxes / extrusions / meshes. Got %s." % type(g).__name__)
            if brep.IsSolid:
                mesh = _brep_to_mesh(brep)
            else:                                               # an open flat surface: use its outline as a curve
                edges = brep.DuplicateNakedEdgeCurves(True, False)
                joined = rg.Curve.JoinCurves(edges) if edges else None
                if not joined:
                    raise ValueError("an open surface in `shapes` has no closed outline. Use a closed solid or a closed curve.")
                for crv in joined:
                    shapes.append({"type": "poly", "pts": _curve_points(crv)})
                notes.append("an open surface was used as its outline curve (extruded by thickness)")
                continue
        verts, faces, m = _mesh_arrays(mesh)
        if len(faces) > MAX_FACES:
            notes.append("a plate mesh has %d faces; the recipe will be large" % len(faces))
        shapes.append({"type": "mesh", "v": [[round(c, 4) for c in v] for v in verts], "f": faces})
        preview.append(m)
    return shapes, preview


def _newell(pts):
    n = [0.0, 0.0, 0.0]
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    ln = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
    if ln < 1e-9:
        return None
    n = [c / ln for c in n]
    if n[2] < 0:
        n = [-c for c in n]
    return n


def _slab_preview(pts, thickness):
    n = _newell(pts)
    if n is None or n[2] < 0.1:
        return None
    dz = abs(thickness) / n[2]
    vec = rg.Vector3d(0.0, 0.0, -dz if thickness >= 0 else dz)
    crv = rg.PolylineCurve([rg.Point3d(p[0], p[1], p[2]) for p in pts + [pts[0]]])
    srf = rg.Surface.CreateExtrusion(crv, vec)
    brep = srf.ToBrep().CapPlanarHoles(0.001) if srf is not None else None
    return brep


def run():
    raw = _inp("shapes", None)
    if not _as_list(raw):
        raise ValueError("shapes is empty. Reference closed curves and/or closed geometry.")
    notes = []
    shapes, preview = _read_shapes(raw, notes)
    if not shapes:
        raise ValueError("no usable shapes found.")
    thickness = float(_inp("thickness", 1.0))
    if abs(thickness) < 0.05:
        raise ValueError("thickness must not be 0 for curves (use a value such as 1.0).")
    spec = {"v": 1, "kind": "plates", "name": str(_inp("name", "") or ""),
            "thickness": thickness,
            "resistance": max(0.05, min(50.0, float(_inp("resistance", 1.0)))),
            "anchor_ft": max(0.0, float(_inp("anchor_ft", 1.5))),
            "anchor_strength": max(1.0, min(20.0, float(_inp("anchor_strength", 3.0)))),
            "auto_support": _truthy(_inp("auto_support", True)),
            "min_support": max(0.0, float(_inp("min_support", 6.0))),
            "max_span": max(1.0, float(_inp("max_span", 12.0))),
            "strut_size": max(0.25, min(10.0, float(_inp("strut_size", 1.5)))),
            "verticality": max(0.0, min(1.0, float(_inp("verticality", 0.3)))),
            "branch_from_top": _truthy(_inp("branch_from_top", False)),
            "support_pts": [], "shapes": shapes}
    for p in _as_list(_inp("support_pts", None)):
        g = _unwrap(p)
        if hasattr(g, "X") and hasattr(g, "Y") and hasattr(g, "Z"):
            spec["support_pts"].append(_xyz(g))
        elif hasattr(g, "Location"):
            spec["support_pts"].append(_xyz(g.Location))
        else:
            raise ValueError("support_pts must be points.")

    marker = list(preview)
    for s in shapes:
        if s["type"] != "poly":
            continue
        try:
            slab = _slab_preview(s["pts"], thickness)
        except Exception:
            slab = None
        if slab is not None:
            marker.append(slab)
        else:
            marker.append(rg.PolylineCurve([rg.Point3d(p[0], p[1], p[2]) for p in s["pts"] + [s["pts"][0]]]))
    for p in spec["support_pts"]:
        marker.append(rg.Point3d(p[0], p[1], p[2]))

    n_curve = sum(1 for s in shapes if s["type"] == "poly")
    n_geo = len(shapes) - n_curve
    try:
        ghenv.Component.Message = "%d curve(s), %d solid(s) | res %.2g%s" % (n_curve, n_geo, spec["resistance"], "" if spec["auto_support"] else " | no auto support")
        import Grasshopper
        for note in notes:
            ghenv.Component.AddRuntimeMessage(Grasshopper.Kernel.GH_RuntimeMessageLevel.Remark, note)
        if n_curve and spec["thickness"] < 0.4:
            ghenv.Component.AddRuntimeMessage(Grasshopper.Kernel.GH_RuntimeMessageLevel.Warning,
                "thickness %.2f ft is thin; use at least one engine cell (0.5 ft) or the slab may vanish." % spec["thickness"])
    except Exception:
        pass
    return json.dumps(spec), marker


plates, marker = run()
