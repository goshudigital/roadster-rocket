"""Builds the obstacle vehicles seen in the reveal's jump demo (an electric
semi, an angular steel pickup, a fastback sedan, a robotaxi pod) plus a
concrete barrier, and exports public/models/vehicles.glb.

Every model faces +Y, sits on z = 0 and is parented to an empty named after it.
Run: Blender -b -P blender/vehicles.py -- <out.glb> [preview_prefix]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import lib  # noqa: E402

args = lib.script_args()
OUT = args[0] if args else "/tmp/vehicles.glb"
PREVIEW = args[1] if len(args) > 1 else None

lib.reset_scene()

M_WHITE = lib.material("VehWhite", (0.88, 0.89, 0.90), metallic=0.1, rough=0.35, coat=0.4)
M_STEEL = lib.material("VehSteel", (0.70, 0.71, 0.72), metallic=1.0, rough=0.38)
M_PAINT = lib.material("VehPaint", (0.62, 0.07, 0.09), metallic=0.4, rough=0.3, coat=0.7)
M_GOLD = lib.material("VehGold", (0.80, 0.70, 0.52), metallic=0.85, rough=0.3)
M_GLASS = lib.material("VehGlass", (0.04, 0.05, 0.07), metallic=0.6, rough=0.08)
M_TRIM = lib.material("VehTrim", (0.04, 0.04, 0.045), metallic=0.2, rough=0.6)
M_TIRE = lib.material("VehTire", (0.025, 0.025, 0.027), rough=0.9)
M_RIM = lib.material("VehRim", (0.35, 0.36, 0.38), metallic=0.9, rough=0.35)
M_RED = lib.material("VehStripe", (0.75, 0.05, 0.06), rough=0.45)
M_CONC = lib.material("Concrete", (0.58, 0.58, 0.56), rough=0.9)
M_HEAD = lib.material("VehLightWhite", (1, 1, 1), emit=(0.9, 0.95, 1.0), strength=4.0)
M_TAIL = lib.material("VehLightRed", (1, 0.1, 0.1), emit=(1.0, 0.05, 0.05), strength=4.0)
M_REFL = lib.material("Reflector", (1, 0.2, 0.15), emit=(1.0, 0.12, 0.08), strength=2.0)


def wheels(b, positions, radius, width, hub=True):
    rot = (0, math.radians(90), 0)
    for x, y in positions:
        b.cylinder(M_TIRE, radius, width, (x, y, radius), rot=rot, segments=24)
        if hub:
            side = 1 if x > 0 else -1
            b.cylinder(M_RIM, radius * 0.62, 0.02, (x + side * (width / 2 + 0.002), y, radius),
                       rot=rot, segments=20, smooth=False)


def make(name, builder, extra=None):
    root = lib.empty(name, (0, 0, 0))
    obj = builder.finish(name + "_Mesh")
    lib.add_bevel(obj, width=0.02, segments=2, angle=35)
    obj.parent = root
    return root


# ------------------------------------------------------------------- semi --
b = lib.MeshBuilder([M_WHITE])
W = 2.5
cab = [(8.00, 0.55), (8.06, 1.45), (7.55, 2.70), (6.60, 3.55), (4.95, 3.65), (4.95, 0.55)]
b.prism(cab, W, [M_WHITE, M_WHITE, M_GLASS, M_WHITE, M_WHITE, M_TRIM], M_WHITE)
for sx in (-1, 1):
    b.pane(M_GLASS, [(7.42, 2.72), (6.62, 3.42), (5.85, 3.42), (5.85, 2.45), (7.05, 2.45)],
           sx * (W / 2 + 0.004))
# Trailer, chassis, side skirts, stripe, lights.
b.box(M_WHITE, (2.6, 12.6, 2.9), (0, -1.70, 2.55))
b.box(M_TRIM, (1.2, 16.0, 0.55), (0, 0.0, 0.85))
for sx in (-1, 1):
    b.box(M_TRIM, (0.06, 6.0, 0.6), (sx * 1.25, -0.9, 0.85))
    b.box(M_RED, (0.012, 12.4, 0.16), (sx * 1.306, -1.70, 1.45))
    b.box(M_RED, (0.012, 12.4, 0.05), (sx * 1.306, -1.70, 1.66))
b.box(M_HEAD, (2.2, 0.03, 0.05), (0, 8.07, 1.42))
b.box(M_TAIL, (2.4, 0.03, 0.06), (0, -8.02, 1.30))
b.box(M_TRIM, (2.6, 0.06, 0.25), (0, -8.0, 1.0))
wheels(b, [(sx * 1.02, y) for sx in (-1, 1) for y in (6.9, 3.7, 2.4, -5.3, -6.6)], 0.52, 0.42)
make("Semi", b)

# ----------------------------------------------------------------- pickup --
b = lib.MeshBuilder([M_STEEL])
W = 2.05
pick = [(2.85, 0.45), (2.88, 0.95), (1.30, 1.53), (0.35, 1.88), (-0.75, 1.61),
        (-2.85, 1.10), (-2.88, 0.56), (-2.80, 0.45)]
b.prism(pick, W, [M_STEEL, M_STEEL, M_GLASS, M_GLASS, M_STEEL, M_STEEL, M_TRIM, M_TRIM], M_STEEL)
for sx in (-1, 1):
    b.pane(M_GLASS, [(1.18, 1.47), (0.36, 1.79), (-0.68, 1.55), (-0.68, 1.36), (1.18, 1.36)],
           sx * (W / 2 + 0.004))
    b.box(M_TRIM, (0.05, 5.5, 0.12), (sx * (W / 2 + 0.01), 0.0, 0.52))
b.box(M_HEAD, (2.0, 0.03, 0.035), (0, 2.885, 0.93))
b.box(M_TAIL, (2.0, 0.03, 0.04), (0, -2.885, 1.06))
wheels(b, [(sx * 0.93, y) for sx in (-1, 1) for y in (1.85, -1.85)], 0.44, 0.34)
make("Pickup", b)

# ------------------------------------------------------------------ sedan --
b = lib.MeshBuilder([M_PAINT])
W = 1.92
sedan = [(2.40, 0.30), (2.43, 0.62), (2.25, 0.72), (1.20, 0.88), (0.55, 1.38), (-0.75, 1.42),
         (-1.95, 1.02), (-2.40, 0.95), (-2.43, 0.55), (-2.35, 0.30)]
b.prism(sedan, W, [M_PAINT, M_PAINT, M_PAINT, M_GLASS, M_GLASS, M_GLASS, M_PAINT, M_PAINT,
                   M_TRIM, M_TRIM], M_PAINT)
for sx in (-1, 1):
    b.pane(M_GLASS, [(1.16, 0.91), (0.57, 1.33), (-0.73, 1.37), (-1.84, 1.00)], sx * (W / 2 + 0.004))
b.box(M_HEAD, (1.55, 0.03, 0.03), (0, 2.44, 0.64))
b.box(M_TAIL, (1.70, 0.03, 0.04), (0, -2.43, 0.86))
wheels(b, [(sx * 0.82, y) for sx in (-1, 1) for y in (1.45, -1.45)], 0.34, 0.26)
make("Sedan", b)

# -------------------------------------------------------------- robotaxi --
b = lib.MeshBuilder([M_GOLD])
W = 1.86
pod = [(1.95, 0.32), (1.98, 0.64), (1.55, 0.86), (0.75, 1.30), (-0.45, 1.42), (-1.45, 1.12),
       (-1.95, 0.74), (-1.95, 0.32)]
b.prism(pod, W, [M_GOLD, M_GOLD, M_GLASS, M_GLASS, M_GLASS, M_GOLD, M_GOLD, M_TRIM], M_GOLD)
for sx in (-1, 1):
    b.pane(M_GLASS, [(1.45, 0.92), (0.78, 1.26), (-0.45, 1.37), (-1.35, 1.10), (-1.35, 0.92)],
           sx * (W / 2 + 0.004))
b.box(M_HEAD, (1.50, 0.03, 0.03), (0, 1.99, 0.64))
b.box(M_TAIL, (1.50, 0.03, 0.035), (0, -1.96, 0.72))
wheels(b, [(sx * 0.82, y) for sx in (-1, 1) for y in (1.30, -1.30)], 0.33, 0.24)
make("Pod", b)

# --------------------------------------------------------------- barrier --
b = lib.MeshBuilder([M_CONC])
jersey = [(0.30, 0.0), (0.30, 0.08), (0.13, 0.30), (0.09, 0.95), (-0.09, 0.95), (-0.13, 0.30),
          (-0.30, 0.08), (-0.30, 0.0)]
b.prism(jersey, 3.0, [M_CONC] * 8, M_CONC)
for sy in (-1, 1):
    b.box(M_REFL, (2.9, 0.012, 0.07), (0, sy * 0.104, 0.72), rot=(sy * math.radians(-3.4), 0, 0))
make("Barrier", b)

lib.export_glb(OUT)
print("EXPORTED", OUT)

if PREVIEW:
    # Lay the models out side by side for one preview shot.
    xs = {"Semi": -9.0, "Pickup": -4.0, "Sedan": 0.0, "Pod": 3.6, "Barrier": 7.0}
    for name, x in xs.items():
        bpy.data.objects[name].location.x = x
    lib.preview(PREVIEW, target=(-1, 0, 1.2), dist=26,
                views={"lineup": (35, 18), "side": (90, 4)}, res=(1200, 520))
