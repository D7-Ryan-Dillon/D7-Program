# =====================================================================
# EROSION - ACETONE SOURCE  (one of these per application)
# Units: feet (decimal). Copy / paste this component for every
# application you want (each copy gets its own sliders), and wire every
# copy's `src` output into the engine's `sources` input.
#
# INPUTS  (only `geo` is required)
#   geo      : a point (inject / pour / spray) or a curve (line)
#   mode     : 0 or "inject" | 1 or "pour" | 2 or "spray" | 3 or "line"
#              (a curve is always a line source)
#   dose     : ft3 of foam this application could dissolve
#   spread   : width of the wetted zone, feet
#   start    : when it is applied, in steps (0 = right at the start)
#   duration : how long it flows / sprays for, in steps (blank = sensible default)
#   aim      : SPRAY ONLY - direction the spray travels (a vector). Put geo
#              outside the block, like a nozzle, and aim it at the block.
#              Blank = spray the nearest face straight on.
#
# OUTPUTS
#   src      : a text description of this application -> engine `sources`
#   marker   : preview geometry so you can see where / how wide it is
# =====================================================================
import json
import math
import Rhino.Geometry as rg

INJECT, POUR, SPRAY, LINE = 0, 1, 2, 3
MODE_NAMES = {"inject": INJECT, "injection": INJECT, "i": INJECT,
              "pour": POUR, "p": POUR,
              "spray": SPRAY, "s": SPRAY,
              "line": LINE, "curve": LINE, "l": LINE}
MODE_LABEL = {INJECT: "inject", POUR: "pour", SPRAY: "spray", LINE: "line"}
DEFAULT_DOSE = {INJECT: 1500.0, POUR: 500.0, SPRAY: 200.0, LINE: 1800.0}
DEFAULT_SPREAD = {INJECT: 3.0, POUR: 1.0, SPRAY: 6.0, LINE: 2.0}
DEFAULT_DURATION = {INJECT: 0.0, POUR: 60.0, SPRAY: 10.0, LINE: 0.0}
CURVE_SAMPLE_FT = 0.25      # a curve is stored as points this far apart (engine resamples as needed)


def _inp(name, default):
    v = globals().get(name)
    return default if v is None else v


def _geom_from_guid(g):
    """Look a referenced Rhino object up by its Guid, trying every document route we can."""
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
    try:
        import rhinoscriptsyntax as rs
        p = rs.coerce3dpoint(g)
        if p is not None:
            return p
        c = rs.coercecurve(g)
        if c is not None:
            return c
    except Exception:
        pass
    raise ValueError("no Rhino object found for referenced id " + str(g))


def _to_geom(v):
    """Point -> ('pt', [x,y,z]).  Curve or line -> ('crv', [[x,y,z], ...])."""
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        if len(v) == 3 and all(isinstance(t, (int, float)) for t in v):
            return ("pt", [float(v[0]), float(v[1]), float(v[2])])
        if len(v) >= 1:
            return _to_geom(v[0])
        return None
    if type(v).__name__ == "Guid":
        return _to_geom(_geom_from_guid(v))
    if hasattr(v, "PointAt") and hasattr(v, "GetLength"):          # a curve
        L = float(v.GetLength())
        n = max(2, min(500, int(math.ceil(L / CURVE_SAMPLE_FT))))
        ts = v.DivideByCount(n, True)
        if ts is None:
            ts = [v.Domain.T0, v.Domain.T1]
        pts = []
        for t in ts:
            p = v.PointAt(t)
            pts.append([float(p.X), float(p.Y), float(p.Z)])
        return ("crv", pts)
    if hasattr(v, "From") and hasattr(v, "To") and not hasattr(v, "X"):   # a plain Line
        a, b = v.From, v.To
        n = max(2, min(500, int(math.ceil(a.DistanceTo(b) / CURVE_SAMPLE_FT))))
        return ("crv", [[float(a.X + (b.X - a.X) * i / n), float(a.Y + (b.Y - a.Y) * i / n),
                         float(a.Z + (b.Z - a.Z) * i / n)] for i in range(n + 1)])
    if hasattr(v, "X") and hasattr(v, "Y") and hasattr(v, "Z"):
        return ("pt", [float(v.X), float(v.Y), float(v.Z)])
    if hasattr(v, "Location"):
        return _to_geom(v.Location)
    if hasattr(v, "Value"):
        return _to_geom(v.Value)
    raise ValueError("unsupported type: " + type(v).__name__)


def _to_vec(v):
    if v is None:
        return None
    if isinstance(v, (list, tuple)) and len(v) == 3:
        return [float(v[0]), float(v[1]), float(v[2])]
    if hasattr(v, "X") and hasattr(v, "Y") and hasattr(v, "Z"):
        return [float(v.X), float(v.Y), float(v.Z)]
    if hasattr(v, "From") and hasattr(v, "To"):
        return [float(v.To.X - v.From.X), float(v.To.Y - v.From.Y), float(v.To.Z - v.From.Z)]
    if hasattr(v, "Value"):
        return _to_vec(v.Value)
    raise ValueError("aim must be a vector, got " + type(v).__name__)


def _parse_mode(m, is_curve):
    if m is None:
        return LINE if is_curve else INJECT
    if isinstance(m, (int, float)) and not isinstance(m, bool) and int(m) in MODE_LABEL:
        return int(m)
    key = str(m).strip().lower()
    if key in MODE_NAMES:
        return MODE_NAMES[key]
    try:
        if int(float(key)) in MODE_LABEL:
            return int(float(key))
    except Exception:
        pass
    raise ValueError("unknown mode '%s'. Use inject, pour, spray or line (or 0, 1, 2, 3)." % m)


def _circle(origin, normal, r):
    return rg.Circle(rg.Plane(origin, normal), r).ToNurbsCurve()


def _marker(kind, mode, geom, spread, d):
    out = []
    r = max(spread / 2.0, 0.1)
    if kind == "crv":
        pts = [rg.Point3d(p[0], p[1], p[2]) for p in geom]
        try:
            out.append(rg.PolylineCurve(pts))
        except Exception:
            for a, b in zip(pts[:-1], pts[1:]):
                out.append(rg.LineCurve(a, b))
        return out
    p = rg.Point3d(geom[0], geom[1], geom[2])
    out.append(p)
    if mode == INJECT:
        for n in (rg.Vector3d(0, 0, 1), rg.Vector3d(1, 0, 0), rg.Vector3d(0, 1, 0)):
            out.append(_circle(p, n, r))
    elif mode == POUR:
        out.append(_circle(p, rg.Vector3d(0, 0, 1), r))
    else:  # spray
        if d is not None:
            dv = rg.Vector3d(d[0], d[1], d[2])
            dv.Unitize()
            out.append(_circle(p, dv, r))
            out.append(rg.LineCurve(p, p + dv * max(3.0, 2.0 * r)))
        else:
            out.append(_circle(p, rg.Vector3d(0, 0, 1), r))
    return out


def run():
    raw = _inp("geo", None)
    if raw is None:
        raise ValueError("geo is empty. Wire in a point (or a curve for a line source).")
    try:
        kind, geom = _to_geom(raw)
    except Exception as e:
        raise ValueError("geo could not be read (%s). It must be a point or a curve." % e)
    mode = _parse_mode(_inp("mode", None), kind == "crv")
    if kind == "crv":
        mode = LINE
    elif mode == LINE:
        mode = INJECT                                   # a single point cannot be a line
    dose = max(0.0, float(_inp("dose", DEFAULT_DOSE[mode])))
    spread = max(0.1, float(_inp("spread", DEFAULT_SPREAD[mode])))
    start = max(0.0, float(_inp("start", 0.0)))
    dur = float(_inp("duration", DEFAULT_DURATION[mode]))
    if dur < 0:
        dur = DEFAULT_DURATION[mode]
    d = None
    try:
        d = _to_vec(_inp("aim", None))
    except Exception as e:
        raise ValueError(str(e))
    if d is not None and math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2) < 1e-9:
        d = None
    if d is not None and mode != SPRAY:
        d = None                                        # only sprays use a direction

    spec = {"v": 1, "mode": MODE_LABEL[mode], "kind": kind,
            "pt": geom if kind == "pt" else None,
            "pts": geom if kind == "crv" else None,
            "dose": dose, "spread": spread, "start": start, "duration": dur, "dir": d}
    text = json.dumps(spec)
    marker = _marker(kind, mode, geom, spread, d)
    try:
        ghenv.Component.Message = "%s | %.0f ft3" % (MODE_LABEL[mode], dose)
        import Grasshopper
        if spread > 40.0:
            ghenv.Component.AddRuntimeMessage(Grasshopper.Kernel.GH_RuntimeMessageLevel.Warning,
                "spread is a WIDTH IN FEET and is now %.0f ft. A 20 ft block needs about 1 to 12." % spread)
        if dose > 20000.0:
            ghenv.Component.AddRuntimeMessage(Grasshopper.Kernel.GH_RuntimeMessageLevel.Warning,
                "dose is %.0f ft3, more than twice a whole 20 ft block (8000 ft3)." % dose)
    except Exception:
        pass
    return text, marker


src, marker = run()
