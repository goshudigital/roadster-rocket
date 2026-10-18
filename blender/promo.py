"""Cycles promo shot for social cards: the roadster mid-jump over a vehicle
lineup at night, cold-gas plume trailing, floodlights cutting through haze.

Run: Blender -b -P blender/promo.py -- <out.png> <width> <height> [samples] [--text]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402

args = lib.script_args()
OUT = args[0] if args else "/tmp/promo.png"
W = int(args[1]) if len(args) > 1 else 1200
H = int(args[2]) if len(args) > 2 else 630
SAMPLES = int(args[3]) if len(args) > 3 and args[3].isdigit() else 128
TEXT = "--text" in args
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf"

lib.reset_scene()
scene = bpy.context.scene


def emission(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*lib.srgb(*color), 1)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def volume(name, density, color=(0.92, 0.95, 1.0)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (*color, 1)
    vol.inputs["Density"].default_value = density
    vol.inputs["Anisotropy"].default_value = 0.25
    vol.inputs["Emission Strength"].default_value = 0.03
    vol.inputs["Emission Color"].default_value = (0.85, 0.9, 1.0, 1)
    # Break up the spheres with noise so they read as billowing gas.
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 3.6
    tex.inputs["Detail"].default_value = 8
    tex.inputs["Roughness"].default_value = 0.62
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.46
    ramp.color_ramp.elements[1].position = 0.66
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = density
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mul.inputs[0])
    nt.links.new(mul.outputs[0], vol.inputs["Density"])
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return m


def add_mesh_obj(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def box(name, size, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.data.materials.append(mat)
    return o


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


# ------------------------------------------------------------------ assets --
# Uncompressed exports (Blender's importer can't read the meshopt-compressed public copies).
car_objs = import_glb(os.path.join(ROOT, "blender/out/roadster.glb"))
veh_objs = import_glb(os.path.join(ROOT, "blender/out/vehicles.glb"))
car = bpy.data.objects["Roadster"]
car.location = (0.0, 0.5, 8.2)
car.rotation_euler = (math.radians(9), math.radians(-6), math.radians(-18))
for m in bpy.data.materials:
    if m.name.startswith("Light"):
        b = m.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Emission Strength"].default_value = 18

# Lineup under the car: pods, the semi, sedans - parked across the road.
templates = {n: bpy.data.objects[n] for n in ("Semi", "Pickup", "Sedan", "Pod", "Barrier")}


def place(name, x, y, rot_z=90):
    src = templates[name]
    new = src.copy()
    scene.collection.objects.link(new)
    for child in src.children:
        c = child.copy()
        c.data = child.data
        scene.collection.objects.link(c)
        c.parent = new
    new.location = (x, y, 0)
    new.rotation_euler = (0, 0, math.radians(rot_z))
    return new


for x in (-6.3, -2.0, 2.3, 6.6):
    place("Pod", x, 5.5)
place("Semi", 0, 1.6)
for x in (-6, 0, 6):
    place("Sedan", x, -2.2, rot_z=-90)
for x in (-6.1, 0, 6.1):
    place("Pickup", x, -5.4)
for o in templates.values():
    o.hide_render = True
    for c in o.children:
        c.hide_render = True

# ------------------------------------------------------------ environment --
asphalt = lib.material("Asphalt", (0.035, 0.036, 0.04), rough=0.42)
ground = add_mesh_obj("Ground", [(-300, -300, 0), (300, -300, 0), (300, 300, 0), (-300, 300, 0)], [(0, 1, 2, 3)], asphalt)
line_mat = emission("LaneLine", (0.92, 0.93, 0.95), 1.2)
for x in (-3, 3):
    for y in range(-80, 60, 12):
        box(f"dash{x}{y}", (0.16, 6, 0.01), (x, y, 0.005), line_mat)
for x in (-9, 9):
    box(f"edge{x}", (0.22, 200, 0.01), (x, -40, 0.005), line_mat)
red = emission("EdgeRed", (1.0, 0.1, 0.13), 12)
for x in (-11.2, 11.2):
    box(f"strip{x}", (0.12, 220, 0.08), (x, -40, 0.05), red)
    for y in range(-120, 60, 12):
        box(f"post{x}{y}", (0.2, 0.2, 0.5), (x * 1.04, y, 0.25), red)
# Red kicker ramp behind the lineup.
ramp_mat = lib.material("RampRed", (0.72, 0.06, 0.1), rough=0.5)
add_mesh_obj("Ramp", [(-10, -26, 0), (10, -26, 0), (10, -14, 2.8), (-10, -14, 2.8), (-10, -14, 0), (10, -14, 0)],
             [(0, 1, 2, 3), (3, 2, 5, 4), (0, 3, 4), (1, 5, 2)], ramp_mat)
box("RampLip", (20, 0.14, 0.1), (0, -14.05, 2.82), red)

# Floodlight towers with real spot lights for god rays.
pole_mat = lib.material("Pole", (0.12, 0.13, 0.15), metallic=0.5, rough=0.5)
head_mat = emission("Lamp", (1, 0.98, 0.94), 40)
for x, y in ((-22, -6), (22, 18), (-22, 42), (22, -40)):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=26, location=(x, y, 13))
    bpy.context.active_object.data.materials.append(pole_mat)
    box(f"head{x}{y}", (2.8, 0.4, 1.2), (x * 0.95, y, 26), head_mat)
    ld = bpy.data.lights.new(f"Flood{x}{y}", "SPOT")
    ld.energy = 90000
    ld.spot_size = math.radians(62)
    ld.spot_blend = 0.5
    ld.color = (0.92, 0.95, 1.0)
    lo = bpy.data.objects.new(f"Flood{x}{y}", ld)
    lo.location = (x * 0.95, y, 25.5)
    scene.collection.objects.link(lo)
    direction = Vector((0, y, 0)) - lo.location
    lo.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

# Soft cool fill so the white paint holds detail.
fill = bpy.data.lights.new("Fill", "AREA")
fill.energy = 2500
fill.size = 14
fill.color = (0.75, 0.82, 1.0)
fo = bpy.data.objects.new("Fill", fill)
fo.location = (14, 18, 10)
scene.collection.objects.link(fo)
fo.rotation_euler = (Vector((0, 0, 3)) - fo.location).to_track_quat("-Z", "Y").to_euler()
rim = bpy.data.lights.new("Rim", "AREA")
rim.energy = 2200
rim.size = 10
rim.color = (0.55, 0.6, 1.0)
ro = bpy.data.objects.new("Rim", rim)
ro.location = (-12, -16, 9)
scene.collection.objects.link(ro)
ro.rotation_euler = (Vector((0, 0, 4)) - ro.location).to_track_quat("-Z", "Y").to_euler()

# Distant launch tower + rocket silhouette with beacons.
dark = lib.material("Silhouette", (0.02, 0.022, 0.03), rough=0.9)
for dx, dy in ((-4, -4), (4, -4), (-4, 4), (4, 4)):
    box(f"tower{dx}{dy}", (1.2, 1.2, 120), (-150 + dx, -260 + dy, 60), dark)
bpy.ops.mesh.primitive_cylinder_add(radius=4.5, depth=110, location=(-128, -262, 55))
steel = lib.material("RocketSteel", (0.5, 0.52, 0.56), metallic=0.9, rough=0.35)
bpy.context.active_object.data.materials.append(steel)
beacon = emission("Beacon", (1, 0.15, 0.15), 60)
for z in (121, 90):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.9, location=(-150, -260, z))
    bpy.context.active_object.data.materials.append(beacon)

# ------------------------------------------------- cold-gas plume + haze --
gas = volume("ColdGas", 2.2)
car.matrix_world  # noqa: B018 (ensure matrices exist)
bpy.context.view_layer.update()
puffs = [
    # (local x, y, z, radius) relative to the car: rear jets stream back, lift jets push down.
    (0.0, -3.4, 0.3, 0.9), (0.4, -5.0, 0.0, 1.3), (-0.5, -6.8, -0.4, 1.7), (0.3, -8.8, -0.9, 2.1),
    (-0.2, -11.0, -1.4, 2.5), (0.8, 1.6, -0.9, 0.7), (-0.8, 1.7, -1.1, 0.8), (0.7, -1.6, -1.0, 0.8),
    (-0.8, -1.7, -1.2, 0.9), (0.0, 0.0, -2.4, 1.6), (0.9, -0.6, -3.4, 1.9),
]
for i, (x, y, z, r) in enumerate(puffs):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=car.matrix_world @ Vector((x, y, z)))
    o = bpy.context.active_object
    o.name = f"Puff{i}"
    o.data.materials.append(gas)
# Ground smoke around the lineup, like the demo.
ground_gas = volume("GroundGas", 0.7, (0.8, 0.84, 0.9))
for i, (x, y, r) in enumerate(((-9, 3, 3.2), (9, -1, 3.4), (-4, 9, 2.6), (5, 8, 2.8), (-11, -6, 3.6), (11, -7, 3.0))):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=(x, y, r * 0.35))
    o = bpy.context.active_object
    o.scale = (1.4, 1.0, 0.55)
    o.data.materials.append(ground_gas)
# Mach diamonds behind the main nozzles.
diamond = emission("MachDiamond", (0.7, 0.86, 1.0), 45)
for nx in (-0.62, -0.30, 0.30, 0.62):
    for k in range(1, 4):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.07 - k * 0.012,
                                              location=car.matrix_world @ Vector((nx, -2.33 - k * 0.34, 0.47)))
        bpy.context.active_object.data.materials.append(diamond)

world = bpy.data.worlds.new("Night")
scene.world = world
world.use_nodes = True
wnt = world.node_tree
bg = wnt.nodes["Background"]
sky = wnt.nodes.new("ShaderNodeTexGradient")
coord = wnt.nodes.new("ShaderNodeTexCoord")
sep = wnt.nodes.new("ShaderNodeSeparateXYZ")
wramp = wnt.nodes.new("ShaderNodeValToRGB")
wramp.color_ramp.elements[0].position = 0.0
wramp.color_ramp.elements[0].color = (*lib.srgb(0.10, 0.11, 0.24), 1)
wramp.color_ramp.elements[1].position = 0.35
wramp.color_ramp.elements[1].color = (*lib.srgb(0.008, 0.012, 0.035), 1)
wnt.links.new(coord.outputs["Generated"], sep.inputs[0])
wnt.links.new(sep.outputs["Z"], wramp.inputs["Fac"])
wnt.links.new(wramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 1.0
haze = wnt.nodes.new("ShaderNodeVolumeScatter")
haze.inputs["Density"].default_value = 0.0035
haze.inputs["Anisotropy"].default_value = 0.35
wnt.links.new(haze.outputs[0], wnt.nodes["World Output"].inputs["Volume"])

# ------------------------------------------------------------------ camera --
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 85
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (17.0, 25.0, 9.0)
cam.rotation_euler = (Vector((0.2, -4.4, 7.3)) - cam.location).to_track_quat("-Z", "Y").to_euler()

# Key light on the car, like the stage lighting at the reveal.
key = bpy.data.lights.new("Key", "SPOT")
key.energy = 6000
key.spot_size = math.radians(30)
key.spot_blend = 0.6
ko = bpy.data.objects.new("Key", key)
ko.location = (7, 12, 18)
scene.collection.objects.link(ko)
ko.rotation_euler = (Vector((0.0, 0.5, 8.2)) - ko.location).to_track_quat("-Z", "Y").to_euler()
cam_data.dof.use_dof = True
cam_data.dof.focus_object = car
cam_data.dof.aperture_fstop = 5.6

if TEXT and os.path.exists(FONT):
    font = bpy.data.fonts.load(FONT)
    white = emission("TitleWhite", (1, 1, 1), 1.6)
    redt = emission("TitleRed", (1.0, 0.18, 0.24), 2.2)
    grey = emission("TitleGrey", (0.78, 0.82, 0.9), 0.9)

    def text(body, size, x, y, mat):
        cu = bpy.data.curves.new(body, "FONT")
        cu.body = body
        cu.font = font
        cu.size = size
        cu.space_character = 1.05
        o = bpy.data.objects.new(body, cu)
        o.data.materials.append(mat)
        scene.collection.objects.link(o)
        o.parent = cam
        o.location = (x, y, -1.0)
        return o

    cam_data.dof.use_dof = False  # keep the title sharp
    # Frame half-width at 1 m in front of the lens (sensor fit is horizontal, 36 mm).
    hw = 18 / cam_data.lens
    hh = hw * H / W
    left = -hw * 0.9
    text("ROADSTER", hw * 0.2, left, hh * 0.62, white)
    text("ROCKET", hw * 0.2, left, hh * 0.27, redt)
    text("FLYING ROADSTER STUNT GAME  /  PLAY FREE", hw * 0.041, left + hw * 0.005, hh * 0.13, grey)

# ------------------------------------------------------------------ render --
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception as err:  # noqa: BLE001
    print("GPU unavailable, using CPU", err)
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.volume_step_rate = 2.0
scene.cycles.max_bounces = 6
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
if OUT.lower().endswith((".jpg", ".jpeg")):
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88
else:
    scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("RENDERED", OUT)
