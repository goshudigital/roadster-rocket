"""Builds the flying roadster (hero car) and exports public/models/roadster.glb.

Design notes from the Oct 2026 reveal footage: low angular wedge, fenders that
peak above the hood, a long raked gold-tinted canopy, thin full-width light
bar up front, full-width red taillight, dark lower skirts, thin-spoke wheels,
hidden active rear wing and ten cold-gas thrusters around the body.

Run: Blender -b -P blender/roadster.py -- <out.glb> [preview_prefix]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402

args = lib.script_args()
OUT = args[0] if args else "/tmp/roadster.glb"
PREVIEW = args[1] if len(args) > 1 else None

lib.reset_scene()

# ---------------------------------------------------------------- materials --
M_BODY = lib.material("Body", (0.91, 0.90, 0.87), metallic=0.12, rough=0.30, coat=0.6)
M_GLASS = lib.material("Glass", (0.42, 0.30, 0.12), metallic=0.92, rough=0.07)
M_TRIM = lib.material("Trim", (0.035, 0.037, 0.042), metallic=0.25, rough=0.55)
M_TITAN = lib.material("Titanium", (0.62, 0.62, 0.64), metallic=1.0, rough=0.28)
M_TIRE = lib.material("Tire", (0.025, 0.025, 0.027), rough=0.88)
M_RIM = lib.material("Rim", (0.10, 0.10, 0.11), metallic=0.85, rough=0.32)
M_HEAD = lib.material("LightWhite", (1, 1, 1), emit=(0.85, 0.93, 1.0), strength=6.0)
M_TAIL = lib.material("LightRed", (1, 0.1, 0.1), emit=(1.0, 0.04, 0.05), strength=6.0)
M_NOZZLE = lib.material("Nozzle", (0.16, 0.16, 0.17), metallic=1.0, rough=0.35)

# --------------------------------------------------------------- body shell --
# Half cross-sections (x >= 0, z) at stations along Y (front = +Y).
# P0 bottom centre, P1 bottom edge, P2 sill chamfer, P3 skirt top, P4 side
# step (white body overhangs the dark skirt), P5 upper side, P6 shoulder
# crease, P7 hood edge / canopy base, P8 canopy side top / hood mid,
# P9 roof / hood centre.
STATIONS = [
    (2.26, [(0, .30), (.70, .30), (.80, .33), (.84, .37), (.86, .40), (.86, .44), (.82, .48), (.55, .47), (.28, .47), (0, .48)]),
    (2.05, [(0, .22), (.86, .22), (.95, .29), (.96, .40), (.98, .43), (.98, .58), (.93, .66), (.62, .58), (.31, .59), (0, .60)]),
    (1.50, [(0, .19), (.88, .19), (.97, .28), (.97, .45), (1.00, .49), (1.00, .80), (.95, .87), (.64, .76), (.32, .77), (0, .79)]),
    (0.95, [(0, .19), (.88, .19), (.97, .28), (.97, .45), (1.00, .49), (1.00, .81), (.95, .87), (.67, .83), (.35, .84), (0, .85)]),
    (0.05, [(0, .19), (.88, .19), (.97, .28), (.97, .45), (1.00, .49), (1.00, .80), (.95, .86), (.70, .87), (.55, 1.05), (0, 1.12)]),
    (-0.60, [(0, .19), (.90, .19), (.99, .28), (.99, .45), (1.02, .49), (1.02, .82), (.97, .88), (.71, .89), (.53, 1.04), (0, 1.10)]),
    (-1.35, [(0, .21), (.93, .21), (1.02, .30), (1.02, .46), (1.05, .50), (1.05, .85), (1.00, .92), (.66, .93), (.42, .96), (0, .98)]),
    (-1.95, [(0, .25), (.90, .25), (.99, .33), (.99, .48), (1.02, .52), (1.02, .86), (.96, .91), (.62, .92), (.31, .92), (0, .92)]),
    (-2.22, [(0, .33), (.84, .33), (.92, .40), (.92, .50), (.96, .53), (.96, .86), (.91, .92), (.62, .95), (.31, .95), (0, .95)]),
]
NPTS = 10
CANOPY = (-1.35, 0.95)  # Y range where the top faces are gold glass
WHEELS = {  # name: (x, y, z, radius, width)
    "Wheel_FL": (-0.84, 1.35, 0.35, 0.35, 0.27),
    "Wheel_FR": (0.84, 1.35, 0.35, 0.35, 0.27),
    "Wheel_RL": (-0.86, -1.30, 0.36, 0.36, 0.31),
    "Wheel_RR": (0.86, -1.30, 0.36, 0.36, 0.31),
}
ARCHES = [(1.35, 0.35, 0.42), (-1.30, 0.36, 0.43)]  # (y, z, radius)
ARCH_INNER_X = 0.55


def poly_at(y):
    for (y0, p0), (y1, p1) in zip(STATIONS, STATIONS[1:]):
        if y0 >= y >= y1:
            t = (y0 - y) / (y0 - y1)
            return [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for a, b in zip(p0, p1)]
    return list(STATIONS[0][1] if y > STATIONS[0][0] else STATIONS[-1][1])


def section(y):
    """Polygon at y, with the wheel-arch notch cut in where needed."""
    p = poly_at(y)
    for ay, az, ar in ARCHES:
        dy = y - ay
        if abs(dy) <= ar + 1e-6:
            za = az + math.sqrt(max(ar * ar - dy * dy, 0.0))
            zb = p[0][1]
            p[1] = (ARCH_INNER_X, zb)
            p[2] = (ARCH_INNER_X, za)
            p[3] = (p[4][0], za)
            if p[4][1] < za + 0.004:
                p[4] = (p[4][0], za + 0.004)
            return p, True
    return p, False


ys = {s[0] for s in STATIONS}
for ay, _az, ar in ARCHES:
    for i in range(13):
        phi = math.pi * i / 12
        ys.add(round(ay + ar * math.cos(phi), 5))
    ys.add(round(ay + ar + 0.015, 5))
    ys.add(round(ay - ar - 0.015, 5))
ys = sorted(ys, reverse=True)
sections = [(y, *section(y)) for y in ys]

body = lib.MeshBuilder([M_BODY, M_TRIM, M_GLASS])
bm = body.bm
rings = [[bm.verts.new((x, y, z)) for (x, z) in poly] for (y, poly, _arch) in sections]
for i in range(len(rings) - 1):
    ya, yb = sections[i][0], sections[i + 1][0]
    in_canopy = CANOPY[0] - 1e-6 <= ya <= CANOPY[1] + 1e-6 and CANOPY[0] - 1e-6 <= yb <= CANOPY[1] + 1e-6
    for k in range(NPTS - 1):
        f = bm.faces.new((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]))
        if k <= 3:
            f.material_index = body.slot(M_TRIM)
        elif k >= 7 and in_canopy:
            f.material_index = body.slot(M_GLASS)
        else:
            f.material_index = body.slot(M_BODY)
# End caps (nose and tail). Half polygons; the mirror closes them.
nose = bm.faces.new(list(reversed(rings[0])))
nose.material_index = body.slot(M_BODY)
tail = bm.faces.new(rings[-1])
tail.material_index = body.slot(M_BODY)
car_body = body.finish("Body")
lib.add_mirror(car_body)
lib.add_bevel(car_body, width=0.010, segments=2, angle=25)

# ------------------------------------------------------------------ details --
det = lib.MeshBuilder([M_HEAD, M_TAIL, M_TRIM, M_NOZZLE, M_TITAN])
# Full-width front light bar along the top of the nose + headlight eyes.
det.box(M_HEAD, (1.40, 0.02, 0.022), (0, 2.266, 0.456))
for sx in (-1, 1):
    det.box(M_HEAD, (0.10, 0.026, 0.05), (sx * 0.77, 2.264, 0.448))
# Front intake (dark) along the bottom of the nose.
det.box(M_TRIM, (1.20, 0.04, 0.06), (0, 2.265, 0.335))
# Full-width taillight under the ducktail + dark rear diffuser with nozzles.
det.box(M_TAIL, (1.84, 0.03, 0.055), (0, -2.235, 0.84))
det.box(M_TRIM, (1.62, 0.05, 0.20), (0, -2.235, 0.47))
for x in (-0.62, -0.30, 0.30, 0.62):
    r = 0.075 if abs(x) < 0.5 else 0.06
    det.cylinder(M_NOZZLE, r, 0.12, (x, -2.27, 0.47), rot=(math.radians(90), 0, 0), segments=20)
    det.cylinder(M_TRIM, r * 0.62, 0.122, (x, -2.272, 0.47), rot=(math.radians(90), 0, 0), segments=20)
# Diffuser fins.
for x in (-0.46, 0.0, 0.46):
    det.box(M_TRIM, (0.02, 0.14, 0.15), (x, -2.24, 0.45))
# Small side / corner thruster ports (the Rocket trim has ten around the body).
for sx in (-1, 1):
    det.cylinder(M_NOZZLE, 0.045, 0.04, (sx * 0.985, 1.92, 0.45), rot=(0, math.radians(90), 0), segments=16)
    det.cylinder(M_NOZZLE, 0.045, 0.04, (sx * 1.03, -1.90, 0.62), rot=(0, math.radians(90), 0), segments=16)
details = det.finish("Details")

# -------------------------------------------------------------------- wheels --
root = lib.empty("Roadster", (0, 0, 0))
car_body.parent = root
details.parent = root

for name, (x, y, z, r, w) in WHEELS.items():
    wb = lib.MeshBuilder([M_TIRE, M_RIM, M_TITAN, M_TRIM])
    side = 1 if x > 0 else -1
    rot = (0, math.radians(90), 0)
    h = w / 2
    ri = r * 0.74
    # Tyre: revolved rounded profile, open in the middle for the rim.
    wb.lathe(M_TIRE, [(h, ri), (h, r * 0.90), (h - 0.015, r * 0.975), (h - 0.05, r),
                      (-h + 0.05, r), (-h + 0.015, r * 0.975), (-h, r * 0.90), (-h, ri)],
             (0, 0, 0), segments=44)
    # Recessed dark rim face, titanium lip, thin twin spokes, hub.
    wb.cylinder(M_RIM, ri + 0.004, 0.02, (side * (h - 0.05), 0, 0), rot=rot, segments=44, smooth=False)
    wb.lathe(M_TITAN, [(side * (h - 0.05), ri - 0.004), (side * (h - 0.008), ri - 0.002),
                       (side * (h - 0.002), ri + 0.012)], (0, 0, 0), segments=44)
    for i in range(10):
        ang = i * math.tau / 10 + (0.08 if i % 2 else -0.08)
        mid = ri * 0.52
        wb.box(M_TITAN, (0.03, 0.02, ri * 0.82),
               (side * (h - 0.032), math.sin(ang) * mid, math.cos(ang) * mid),
               rot=(-ang, 0, 0))
    wb.cylinder(M_TITAN, 0.055, 0.04, (side * (h - 0.025), 0, 0), rot=rot, segments=18)
    wheel = wb.finish(name)
    wheel.location = (x, y, z)
    wheel.parent = root

# ------------------------------------------------------------- active wing --
wing_pivot = lib.empty("Wing", (0, -1.98, 0.925), parent=root)
wg = lib.MeshBuilder([M_BODY, M_TRIM])
wg.box(M_BODY, (1.52, 0.27, 0.026), (0, 0, 0.010))
for sx in (-0.48, 0.48):
    wg.box(M_TRIM, (0.035, 0.09, 0.42), (sx, 0.02, -0.19))
wing = wg.finish("WingBlade")
lib.add_bevel(wing, width=0.006, segments=2, angle=30)
wing.parent = wing_pivot

# ----------------------------------------------------------- thruster ports --
# Ten emitters the game uses for cold-gas plumes: 4 rear mains, 4 downward
# lift ports near the corners, 2 lateral ports.
for i, x in enumerate((-0.62, -0.30, 0.30, 0.62)):
    lib.empty(f"T_Rear_{i}", (x, -2.33, 0.47), parent=root)
for name, loc in {
    "T_Down_FL": (-0.70, 1.90, 0.20), "T_Down_FR": (0.70, 1.90, 0.20),
    "T_Down_RL": (-0.75, -1.85, 0.24), "T_Down_RR": (0.75, -1.85, 0.24),
    "T_Side_L": (-1.06, -1.90, 0.62), "T_Side_R": (1.06, -1.90, 0.62),
}.items():
    lib.empty(name, loc, parent=root)

lib.export_glb(OUT)
print("EXPORTED", OUT)

if PREVIEW:
    lib.preview(PREVIEW, target=(0, 0, 0.55), dist=7.2)
