# Render one model to a PNG for a quick look.
# Run from the repo root: blender -b --factory-startup --python tools/preview.py -- <Model> <distance> <target height> [out.png]
# e.g. GuineaPig 0.45 0.05 · Human 2.2 0.6 · Oak 14 3.5 · Fox 1.4 0.35
import bpy, sys, os
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
name, dist, h = args[0], float(args[1]), float(args[2])
out = os.path.abspath(args[3] if len(args) > 3 else f"prev_{name}.png")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", f"{name}.glb"))
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = 640; sc.render.resolution_y = 480
w = bpy.data.worlds.new("w"); sc.world = w
w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.7, 0.8, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler = (0.8, 0.2, 0.8); sun.data.energy = 3
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
tgt = Vector((0, 0, h))
cam.location = tgt + Vector((-dist * 0.7, -dist * 0.75, dist * 0.35))
cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
