"""Shared helpers for the Roadster Rocket Blender scripts.

Conventions: metres, Blender Z-up, every vehicle faces +Y. The glTF exporter
converts to Y-up, so +Y in Blender becomes -Z in three.js (the game's "forward").
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


def script_args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb(*c):
    """sRGB 0..1 -> linear, which is what Blender colour sockets expect."""
    def conv(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(conv(v) for v in c)


def material(name, color, metallic=0.0, rough=0.5, coat=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    lin = srgb(*color)
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.04
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(*emit), 1.0)
        b.inputs["Emission Strength"].default_value = strength
    # Viewport / Workbench colour so quick previews read correctly.
    m.diffuse_color = (*(emit and srgb(*emit) or lin), 1.0)
    m.metallic = metallic
    m.roughness = rough
    return m


class MeshBuilder:
    """Accumulates geometry in one bmesh, tagging faces with material slots."""

    def __init__(self, materials):
        self.bm = bmesh.new()
        self.materials = list(materials)

    def slot(self, mat):
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def _tag(self, faces, mat, smooth=False):
        idx = self.slot(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth

    def lathe(self, mat, profile, loc, segments=40, smooth=True):
        """Revolve an (axial x, radius) profile around the X axis through loc."""
        idx = self.slot(mat)
        rings = []
        for ax, r in profile:
            rings.append([self.bm.verts.new((loc[0] + ax,
                                             loc[1] + math.cos(s * math.tau / segments) * r,
                                             loc[2] + math.sin(s * math.tau / segments) * r))
                          for s in range(segments)])
        for a, b in zip(rings, rings[1:]):
            for s in range(segments):
                s2 = (s + 1) % segments
                f = self.bm.faces.new((a[s], b[s], b[s2], a[s2]))
                f.material_index = idx
                f.smooth = smooth

    def box(self, mat, size, loc, rot=(0, 0, 0)):
        before = set(self.bm.faces)
        m = (Matrix.Translation(Vector(loc)) @ euler(rot)
             @ Matrix.Diagonal((*size, 1.0)))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._tag([f for f in self.bm.faces if f not in before], mat)

    def cylinder(self, mat, radius, depth, loc, rot=(0, 0, 0), segments=32,
                 radius2=None, smooth=True):
        before = set(self.bm.faces)
        m = Matrix.Translation(Vector(loc)) @ euler(rot)
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False,
                              segments=segments, radius1=radius,
                              radius2=radius if radius2 is None else radius2,
                              depth=depth, matrix=m)
        new = [f for f in self.bm.faces if f not in before]
        self._tag(new, mat, smooth=False)
        if smooth:
            for f in new:
                if len(f.verts) == 4:  # side quads only; caps stay flat
                    f.smooth = True

    def prism(self, profile, width, edge_mats, cap_mat, x0=0.0):
        """Extrude a side-view polygon (y, z) across X, centred on x0.

        edge_mats[i] is the material of the face running profile[i] -> profile[i+1].
        """
        before = set(self.bm.faces)
        hw = width / 2.0
        left = [self.bm.verts.new((x0 - hw, y, z)) for y, z in profile]
        right = [self.bm.verts.new((x0 + hw, y, z)) for y, z in profile]
        n = len(profile)
        for i in range(n):
            j = (i + 1) % n
            f = self.bm.faces.new((left[i], left[j], right[j], right[i]))
            self._tag([f], edge_mats[i])
        fl = self.bm.faces.new(list(reversed(left)))
        fr = self.bm.faces.new(right)
        self._tag([fl, fr], cap_mat)
        return [f for f in self.bm.faces if f not in before]

    def pane(self, mat, polygon, x, thickness=0.012):
        """Thin flat panel (side windows, decals) lying in the plane x = const."""
        prof = list(polygon)
        self.prism(prof, thickness, [mat] * len(prof), mat, x0=x)

    def finish(self, name, recalc=True):
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.materials:
            me.materials.append(m)
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def euler(rot):
    from mathutils import Euler
    return Euler(rot, "XYZ").to_matrix().to_4x4()


def empty(name, loc, parent=None, size=0.1):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = size
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e


def parent_to(obj, parent):
    obj.parent = parent


def add_bevel(obj, width=0.012, segments=2, angle=30.0):
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    return mod


def add_mirror(obj):
    mod = obj.modifiers.new("Mirror", "MIRROR")
    mod.use_axis[0] = True
    mod.use_clip = True
    mod.use_mirror_merge = True
    mod.merge_threshold = 0.0005
    return mod


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
    )


def preview(path_prefix, target=(0, 0, 0.6), dist=7.5, views=None, res=(900, 520)):
    """Quick Workbench renders from several angles to sanity-check shapes."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = False
    scene.display.shading.show_specular_highlight = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    views = views or {
        "front34": (35, 18),
        "side": (90, 4),
        "front": (0, 8),
        "rear34": (150, 20),
        "top": (90, 85),
    }
    tgt = Vector(target)
    for label, (az, el) in views.items():
        a, e = math.radians(az), math.radians(el)
        # azimuth 0 = looking at the front (+Y), 90 = from the right side (+X)
        offset = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
        cam.location = tgt + offset * dist
        direction = tgt - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{path_prefix}_{label}.png"
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
