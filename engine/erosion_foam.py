# =====================================================================
# EROSION - FOAM  (one per model; wire `foam` into the engine's `foam` input)
# Units: feet (decimal).
#
# Real foam is not even: it has soft and dense patches. Acetone finds the
# soft, open routes first, so the void grows lobes, necks and thin webs
# instead of a clean ball. This component sets that up, plus optional layers.
#
# INPUTS (all optional)
#   noise           : 0 = perfectly even foam ... 1 = strongly uneven (try 0.4 - 0.7)
#   scale           : size of the lobes / foam cells, feet (try 3 - 6; bigger = bigger rooms)
#   grain           : fine pitting on the cavity walls, 0 = smooth ... 1 = pitted
#   foam_seed       : whole number. Same seed = same foam, every time, at any cell size
#   web             : thin dense membranes around each foam cell (0 = none ... 1 = strong).
#                     The void fills a cell, stops at its walls, and leaks into the next
#                     cell only through weak spots - this is what makes branching networks
#                     and leaves thin webs standing between cavities.
#   web_open        : fraction of membranes that are weak / open (0.3 = 30% are leaky)
#   web_thickness   : membrane thickness, feet
#   layers          : on / off toggle for flat layers
#   layer_count     : how many layers (evenly spaced, never on the faces)
#   layer_axis      : the direction the layers are stacked along: 0 = X, 1 = Y, 2 = Z
#                     (2 = horizontal layers stacked up the block, like floors)
#   layer_thickness : thickness of each layer, feet
#   layer_strength  : +1 = solid resistant sheet (solvent pools on it -> flat floors)
#                      0 = no effect
#                     -1 = very weak seam (solvent races along it -> flat wide slots)
#
# OUTPUT
#   foam : text description -> engine `foam`
# =====================================================================
import json


def _inp(name, default):
    v = globals().get(name)
    return default if v is None else v


def _truthy(v):
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    return bool(v)


def _axis(v):
    if isinstance(v, str):
        k = v.strip().lower()
        if k in ("x", "y", "z"):
            return "xyz".index(k)
        v = float(k)
    return max(0, min(2, int(v)))


def run():
    noise = max(0.0, min(1.5, float(_inp("noise", 0.5))))
    scale = max(0.5, float(_inp("scale", 4.0)))
    grain = max(0.0, min(2.0, float(_inp("grain", 0.4))))
    seed = int(_inp("foam_seed", 1))
    web = max(0.0, min(1.5, float(_inp("web", 0.6))))
    web_open = max(0.0, min(1.0, float(_inp("web_open", 0.3))))
    web_thick = max(0.05, float(_inp("web_thickness", 0.5)))
    layers = _truthy(_inp("layers", False))
    count = max(0, min(40, int(_inp("layer_count", 3))))
    axis = _axis(_inp("layer_axis", 2))
    thick = max(0.05, float(_inp("layer_thickness", 0.75)))
    strength = max(-1.0, min(1.0, float(_inp("layer_strength", 0.85))))
    spec = {"v": 1, "noise": noise, "scale": scale, "grain": grain, "seed": seed,
            "web": web, "web_open": web_open, "web_thickness": web_thick,
            "layers": layers, "layer_count": count, "layer_axis": axis,
            "layer_thickness": thick, "layer_strength": strength}
    try:
        msg = "noise %.2f | web %.2f | seed %d" % (noise, web, seed)
        if layers and count > 0:
            msg += " | %d layers %s" % (count, "XYZ"[axis])
        ghenv.Component.Message = msg
    except Exception:
        pass
    return json.dumps(spec)


foam = run()
