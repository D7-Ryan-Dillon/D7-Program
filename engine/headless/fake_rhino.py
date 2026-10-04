"""A tiny stand-in for the parts of Rhino.Geometry that the erosion scripts touch, so the engine's numeric core can be
run (and tested) outside Rhino. NOT a geometry kernel: meshes are just lists of vertices and faces; nothing is
intersected or measured. Used by run_headless.py and the tests; never by Grasshopper."""
import sys
import types


class Point3d:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.X, self.Y, self.Z = float(x), float(y), float(z)

    def DistanceTo(self, o):
        return ((self.X - o.X) ** 2 + (self.Y - o.Y) ** 2 + (self.Z - o.Z) ** 2) ** 0.5


class Vector3d(Point3d):
    def Unitize(self):
        n = (self.X ** 2 + self.Y ** 2 + self.Z ** 2) ** 0.5
        if n > 0:
            self.X, self.Y, self.Z = self.X / n, self.Y / n, self.Z / n
        return True

    def __mul__(self, k):
        return Vector3d(self.X * k, self.Y * k, self.Z * k)


def _p_add(self, o):
    return Point3d(self.X + o.X, self.Y + o.Y, self.Z + o.Z)


Point3d.__add__ = _p_add


class Interval:
    def __init__(self, a, b):
        self.T0, self.T1 = a, b


class Plane:
    WorldXY = object()

    def __init__(self, origin=None, normal=None):
        self.Origin, self.Normal = origin, normal


class Circle:
    def __init__(self, plane, r):
        self.plane, self.r = plane, r

    def ToNurbsCurve(self):
        return _Curve()


class _Verts:
    def __init__(self):
        self.items = []

    def Add(self, x, y, z):
        self.items.append(Point3d(x, y, z))

    @property
    def Count(self):
        return len(self.items)

    def __getitem__(self, i):
        return self.items[i]


class _Face:
    def __init__(self, a, b, c, d=None):
        self.A, self.B, self.C, self.D = a, b, c, (c if d is None else d)


class _Faces:
    def __init__(self):
        self.items = []

    def AddFace(self, a, b, c, d=None):
        self.items.append(_Face(a, b, c, d))

    @property
    def Count(self):
        return len(self.items)

    def __getitem__(self, i):
        return self.items[i]

    def ConvertQuadsToTriangles(self):
        return True


class _Normals:
    def ComputeNormals(self):
        return True


class _Colors:
    def Add(self, r, g, b):
        pass


class Mesh:
    def __init__(self):
        self.Vertices, self.Faces, self.Normals, self.VertexColors = _Verts(), _Faces(), _Normals(), _Colors()
        self.IsClosed = True

    def Compact(self):
        return True

    def DuplicateMesh(self):
        m = Mesh()
        m.Vertices.items = list(self.Vertices.items)
        m.Faces.items = list(self.Faces.items)
        return m

    def Append(self, other):
        off = self.Vertices.Count
        self.Vertices.items += other.Vertices.items
        for f in other.Faces.items:
            self.Faces.AddFace(f.A + off, f.B + off, f.C + off)


class _Curve:
    def DuplicateCurve(self):
        return self


class PolylineCurve(_Curve):
    def __init__(self, pts):
        self.pts = list(pts)
        self.PointCount = len(self.pts)
        self.IsClosed = (len(self.pts) > 2 and self.pts[0].DistanceTo(self.pts[-1]) < 1e-9)
        self.Domain = Interval(0.0, 1.0)
        self.PointAtStart, self.PointAtEnd = self.pts[0], self.pts[-1]

    def Point(self, i):
        return self.pts[i]

    def GetLength(self):
        return sum(self.pts[i].DistanceTo(self.pts[i + 1]) for i in range(len(self.pts) - 1))

    def PointAt(self, t):
        return self.pts[0]


class LineCurve(_Curve):
    def __init__(self, a, b):
        self.a, self.b = a, b


class _Brep:
    def __init__(self):
        self.Edges = [_Curve() for _ in range(12)]


class Box:
    def __init__(self, plane, x, y, z):
        pass

    def ToBrep(self):
        return _Brep()


class Brep:
    pass


class Surface:
    pass


class Extrusion:
    pass


class MeshingParameters:
    QualityRenderMesh = object()


def install():
    rhino = types.ModuleType("Rhino")
    geo = types.ModuleType("Rhino.Geometry")
    for cls in (Point3d, Vector3d, Interval, Plane, Circle, Mesh, PolylineCurve, LineCurve, Box, Brep, Surface, Extrusion, MeshingParameters):
        setattr(geo, cls.__name__, cls)
    rhino.Geometry = geo
    sys.modules["Rhino"] = rhino
    sys.modules["Rhino.Geometry"] = geo
    return geo


def box_mesh_obj(lo, hi):
    """A closed box as a stand-in Mesh (12 triangles) for geo / plate tests."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    m = Mesh()
    for v in ([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]):
        m.Vertices.Add(*v)
    for f in ([0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]):
        m.Faces.AddFace(*f)
    return m
