"""Renders the app icons (logo mark on the dark brand background).

Run: Blender -b -P blender/icons.py -- <out_dir>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import lib  # noqa: E402

args = lib.script_args()
OUT_DIR = args[0] if args else "/tmp"
lib.reset_scene()
scene = bpy.context.scene


def flat(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*lib.srgb(*color), 1)
    return m


def poly(name, pts, mat, z=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x - 32, 32 - y, z) for x, y in pts], [], [list(range(len(pts)))])
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)


poly("bg", [(0, 0), (64, 0), (64, 64), (0, 64)], flat("bg", (0.027, 0.031, 0.051)), -1)
poly("mark", [(8, 42), (32, 14), (56, 42), (43, 42), (32, 29), (21, 42)], flat("white", (1, 1, 1)))
poly("bar", [(13, 47), (51, 47), (51, 51), (13, 51)], flat("red", (1.0, 0.2, 0.28)))

cam_data = bpy.data.cameras.new("Cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 64
cam = bpy.data.objects.new("Cam", cam_data)
cam.location = (0, 0, 10)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "MATERIAL"
scene.display.render_aa = "32"
scene.view_settings.view_transform = "Standard"
for size in (512, 192):
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.filepath = os.path.join(OUT_DIR, f"icon-{size}.png")
    bpy.ops.render.render(write_still=True)
print("ICONS DONE")
