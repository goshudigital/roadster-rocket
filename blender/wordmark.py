"""Renders a wide transparent wordmark (logo mark + ROADSTER ROCKET) for
light backgrounds such as the AdSense consent dialog.

Run: Blender -b -P blender/wordmark.py -- <out.png> [width]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import lib  # noqa: E402

args = lib.script_args()
OUT = args[0] if args else "/tmp/wordmark.png"
WIDTH = int(args[1]) if len(args) > 1 else 600
FONT = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf"
lib.reset_scene()
scene = bpy.context.scene


def flat(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*lib.srgb(*color), 1)
    return m


ink = flat("ink", (0.07, 0.08, 0.1))
red = flat("red", (0.86, 0.11, 0.18))


def poly(name, pts, mat, scale=1.0, ox=0.0, oy=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(ox + (x - 32) * scale, oy + (32 - y) * scale, 0) for x, y in pts], [], [list(range(len(pts)))])
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)


# Logo mark on the left, scaled so its height (design y 14..51) is ~0.62 units.
s = 0.62 / 37
oy = 0.0
poly("mark", [(8, 42), (32, 14), (56, 42), (43, 42), (32, 29), (21, 42)], ink, s, -1.75, oy)
poly("bar", [(13, 47), (51, 47), (51, 51), (13, 51)], red, s, -1.75, oy)
font = bpy.data.fonts.load(FONT)


def text(body, mat, x):
    cu = bpy.data.curves.new(body, "FONT")
    cu.body = body
    cu.font = font
    cu.size = 0.62
    cu.space_character = 1.04
    o = bpy.data.objects.new(body, cu)
    o.data.materials.append(mat)
    o.location = (x, -0.22, 0)
    scene.collection.objects.link(o)
    return o


a = text("ROADSTER", ink, -0.82)
bpy.context.view_layer.update()
width = a.dimensions.x
text("ROCKET", red, -0.82 + width + 0.18)

# Fit the orthographic camera to everything drawn, with a small margin.
bpy.context.view_layer.update()
from mathutils import Vector  # noqa: E402
xs, ys = [], []
for o in scene.objects:
    if o.type in {"MESH", "FONT"}:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            xs.append(w.x)
            ys.append(w.y)
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
cam_data = bpy.data.cameras.new("Cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(max(xs) - min(xs), (max(ys) - min(ys)) * 5) * 1.08
cam = bpy.data.objects.new("Cam", cam_data)
cam.location = (cx, cy, 10)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "MATERIAL"
scene.display.render_aa = "32"
scene.view_settings.view_transform = "Standard"
scene.render.film_transparent = True
scene.render.resolution_x = WIDTH
scene.render.resolution_y = WIDTH // 5
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("WORDMARK", OUT)
