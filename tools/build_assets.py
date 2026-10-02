# Blender model builder for Wheek!: every model in assets/ is generated here.
# Run from the repo root: blender -b --factory-startup --python tools/build_assets.py -- assets [Model ...]
# With model names, only those are rebuilt. Each model has its own random seed, so a single rebuild matches a full run.
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, noise, Euler

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp/assets"
os.makedirs(OUT, exist_ok=True)
random.seed(7)

# ---------------------------------------------------------------- helpers
def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def scl(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c)

def fbm(p, oct=3):
    s, a, f = 0.0, 0.5, 1.0
    for _ in range(oct):
        s += a * noise.noise(p * f)
        a *= 0.5
        f *= 2.03
    return s

def material(name, rough=0.8, metal=0.0, spec=0.35, emit=None, emit_str=0.0, coat=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break
    if emit:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emit, 1)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emit_str
    return m

def from_bm(bm, name, mat=None, smooth_shade=True, parent=None, origin=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = smooth_shade
    if mat:
        me.materials.append(mat)
    if origin != (0, 0, 0):
        me.transform(Matrix.Translation(-Vector(origin)))
        ob.location = origin
    if parent:
        bpy.context.view_layer.update()
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob

def sphere_bm(r=1.0, u=24, v=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r, calc_uvs=True)
    return bm

def ico_bm(r=1.0, sub=3):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, calc_uvs=True)
    return bm

def cone_bm(r1, r2, depth, seg=16, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg,
                          radius1=r1, radius2=r2, depth=depth, calc_uvs=True)
    return bm

def xform(bm, mat):
    bmesh.ops.transform(bm, matrix=mat, verts=bm.verts)
    return bm

def deform(bm, fn):
    for v in bm.verts:
        v.co = fn(v.co.copy())
    return bm

def look_mat(a, b):
    """Matrix that maps a unit-z-cylinder (centered, depth=1) onto segment a->b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((1, 1, L, 1))

def limb_bm(a, b, r1, r2, seg=14, caps=True):
    bm = cone_bm(r1, r2, 1.0, seg, caps=False)
    # scale z only on the unit-depth cone; radii stay
    xform(bm, look_mat(a, b))
    if not caps:
        return bm
    s1 = sphere_bm(r1, seg, max(4, seg // 2))
    xform(s1, Matrix.Translation(Vector(a)))
    s2 = sphere_bm(r2, seg, max(4, seg // 2))
    xform(s2, Matrix.Translation(Vector(b)))
    me = bpy.data.meshes.new("tmp")
    for extra in (s1, s2):
        extra.to_mesh(me)
        bm.from_mesh(me)
        extra.free()
    bpy.data.meshes.remove(me)
    return bm

def merge_bms(bms):
    out = bmesh.new()
    me = bpy.data.meshes.new("tmp")
    for b in bms:
        b.to_mesh(me)
        out.from_mesh(me)
        b.free()
    bpy.data.meshes.remove(me)
    return out

def subsurf(ob, levels=1):
    mod = ob.modifiers.new("ss", 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    for p in me.polygons:
        p.use_smooth = True
    return ob

def paint(ob, fn):
    me = ob.data
    if "Col" in me.color_attributes:
        ca = me.color_attributes["Col"]
    else:
        ca = me.color_attributes.new("Col", 'BYTE_COLOR', 'CORNER')
    mw = ob.matrix_world
    nm = mw.to_3x3()
    verts = me.vertices
    corner_normals = None
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = verts[me.loops[li].vertex_index]
            c = fn(mw @ v.co, (nm @ v.normal).normalized())
            try:
                ca.data[li].color_srgb = (c[0], c[1], c[2], 1)
            except AttributeError:
                ca.data[li].color = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1)
    me.color_attributes.active_color = ca
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass
    return ob

def solid(c):
    return lambda p, n: c

def export(name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        o.select_set(True)
    path = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_vertex_color='ACTIVE',
                              export_normals=True, export_texcoords=True, export_materials='EXPORT',
                              export_draco_mesh_compression_enable=False, export_animations=False,
                              export_cameras=False, export_lights=False)
    print("EXPORTED", path, os.path.getsize(path))

def root(name):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    return ob

# ================================================================ GUINEA PIG
S = 0.14
LIFT = 0.064

def gp_shape(u):
    x, y, z = u
    t = y
    w = 0.57 + 0.07 * t
    h = 0.50 + 0.03 * t
    zz = z * h if z > 0 else z * h * 0.72
    if t < -0.5:
        k = (-0.5 - t) / 0.5
        zz -= 0.05 * k * k
        w *= 1.0 - 0.12 * k
    yy = y if y < 0 else y * 0.9
    # soft fur lumpiness
    lump = 1.0 + 0.025 * noise.noise(Vector((x, y, z)) * 4.0)
    return Vector((x * w * lump, yy * lump, zz * lump)) * S + Vector((0, 0, LIFT))

def gp_surf(yu, zu, side):
    x = side * math.sqrt(max(0.0, 1 - yu * yu - zu * zu))
    return gp_shape(Vector((x, yu, zu)))

CREAM = (0.95, 0.90, 0.80)
GINGER = (0.82, 0.48, 0.20)
DARK = (0.16, 0.11, 0.08)

def gp_color(p, n):
    y = (p.y) / S
    x = p.x / S
    z = (p.z - LIFT) / S
    g = smooth(-0.05, 0.25, noise.noise(p * 11 + Vector((3.1, 1.7, 2.2))) + 0.35 * y + 0.1)
    c = mix(CREAM, GINGER, g)
    # dark patch: left side of head and a saddle
    d = smooth(0.05, 0.3, noise.noise(p * 8 + Vector((9.0, 2.0, 5.0))) + (0.55 if (y < -0.2 and x > -0.05) else -0.25))
    c = mix(c, DARK, d)
    # white blaze on face
    if y < -0.35 and abs(x) < 0.09 + 0.05 * (-y - 0.35) and z > -0.15:
        c = mix(c, CREAM, 0.9)
    # lighter belly
    if z < -0.2:
        c = mix(c, CREAM, smooth(-0.2, -0.45, z) * 0.7)
    k = 0.9 + 0.12 * noise.noise(p * 90)
    return scl(c, k)

def build_guinea_pig():
    clear()
    rt = root("GuineaPig")
    bm = sphere_bm(1.0, 44, 28)
    deform(bm, gp_shape)
    body = from_bm(bm, "Body", material("Fur", rough=0.95, spec=0.2), parent=rt)
    subsurf(body, 1)
    paint(body, gp_color)

    # eyes
    for side, nm in ((1, "EyeR"), (-1, "EyeL")):
        c = gp_surf(-0.55, 0.30, side)
        n = (c - Vector((0, c.y, LIFT + 0.01))).normalized()
        e = sphere_bm(0.0115, 16, 10)
        xform(e, Matrix.Translation(c - n * 0.004))
        ob = from_bm(e, nm, material("Eye", rough=0.04, spec=0.9), parent=rt)
        paint(ob, solid((0.02, 0.015, 0.012)))

    # ears (origin at base for flopping)
    for side, nm in ((1, "EarR"), (-1, "EarL")):
        base = gp_surf(-0.28, 0.74, side)
        e = sphere_bm(1.0, 16, 10)
        def ear_shape(v, side=side):
            # petal: wide round top, cup
            v = Vector((v.x * 0.021, v.y * 0.016, v.z * 0.0035))
            v.z += (v.x * v.x + v.y * v.y) * 6.0  # cup it
            return v
        deform(e, ear_shape)
        m = (Matrix.Translation(base + Vector((side * 0.012, 0.0, 0.004)))
             @ Euler((0.3, side * -0.9, side * 0.4)).to_matrix().to_4x4()
             @ Matrix.Translation(Vector((side * 0.012, 0, 0))))
        xform(e, m)
        ob = from_bm(e, nm, material("Skin", rough=0.7), parent=rt, origin=tuple(base))
        paint(ob, lambda p, n: mix((0.78, 0.55, 0.48), (0.45, 0.30, 0.24), smooth(0.0, 0.8, noise.noise(p * 200) * 0.5 + 0.5)))

    # nose (separate for twitch)
    tip = gp_shape(Vector((0, -0.985, -0.17)))
    nb = sphere_bm(1.0, 14, 8)
    deform(nb, lambda v: Vector((v.x * 0.0105, v.y * 0.006, v.z * 0.0075)))
    xform(nb, Matrix.Translation(tip + Vector((0, 0.001, 0.004))))
    nose = from_bm(nb, "Nose", material("Skin", rough=0.7), parent=rt, origin=tuple(tip))
    paint(nose, lambda p, n: (0.82, 0.52, 0.52) if n.y > -0.7 or p.z > tip.z + 0.004 else (0.25, 0.12, 0.12))

    # whiskers
    wb = []
    for side in (1, -1):
        for i in range(4):
            a = gp_shape(Vector((side * 0.28, -0.93, -0.22)))
            ang = side * (0.35 + i * 0.28)
            d = Vector((math.sin(ang) * 0.9, -math.cos(ang) * 0.6, 0.12 - i * 0.09)).normalized()
            b = a + d * (0.05 + 0.006 * i)
            cb = cone_bm(0.0007, 0.0002, 1.0, 5, caps=False)
            xform(cb, look_mat(a, b))
            wb.append(cb)
    wob = from_bm(merge_bms(wb), "Whiskers", material("Whisker", rough=0.5), parent=rt)
    paint(wob, solid((0.9, 0.88, 0.82)))

    # feet
    feet = {"FootFL": (-0.034, -0.07), "FootFR": (0.034, -0.07), "FootBL": (-0.046, 0.066), "FootBR": (0.046, 0.066)}
    for nm, (x, y) in feet.items():
        fb = sphere_bm(1.0, 14, 8)
        back = nm.startswith("FootB")
        deform(fb, lambda v, back=back: Vector((v.x * 0.013, v.y * (0.024 if back else 0.017), v.z * 0.009)))
        # toes
        o = Vector((x, y - (0.008 if back else 0.004), 0.008))
        xform(fb, Matrix.Translation(o))
        ob = from_bm(fb, nm, material("Skin", rough=0.7), parent=rt, origin=(x, y, 0.03))
        paint(ob, lambda p, n: mix((0.80, 0.56, 0.52), (0.55, 0.38, 0.34), 0.5 + 0.5 * noise.noise(p * 300)))
    export("GuineaPig")

# ================================================================ HUMAN (kneeling, facing -Y)
def build_human():
    clear()
    rt = root("Human")
    skin_m = material("HumanSkin", rough=0.6, spec=0.4)
    shirt_m = material("Shirt", rough=0.9)
    pants_m = material("Pants", rough=0.9)
    hair_m = material("Hair", rough=0.7, spec=0.5)
    shoe_m = material("Shoe", rough=0.6)
    white = (1, 1, 1)

    def part(bm, nm, m, sub=0, parent=rt, origin=(0, 0, 0), col=white):
        ob = from_bm(bm, nm, m, parent=parent, origin=origin)
        if sub:
            subsurf(ob, sub)
        paint(ob, solid(col) if not callable(col) else col)
        return ob

    cloth = lambda p, n: scl((1, 1, 1), 0.88 + 0.12 * (0.5 + 0.5 * noise.noise(p * 60)))
    # legs: shins on ground, thighs up to hips (sitting on heels)
    legs = []
    for sx in (1, -1):
        knee = Vector((sx * 0.12, -0.10, 0.075))
        ankle = Vector((sx * 0.13, 0.32, 0.07))
        hip = Vector((sx * 0.105, 0.24, 0.30))
        legs.append(limb_bm(knee, ankle, 0.068, 0.05))
        legs.append(limb_bm(knee + Vector((0, 0, 0.02)), hip, 0.078, 0.098))
    legs.append(xform(deform(sphere_bm(1, 20, 12), lambda v: Vector((v.x * 0.19, v.y * 0.15, v.z * 0.12))), Matrix.Translation((0, 0.24, 0.36))))
    part(merge_bms(legs), "Legs", pants_m, 1, col=cloth)
    shoes = []
    for sx in (1, -1):
        s = sphere_bm(1, 16, 10)
        deform(s, lambda v: Vector((v.x * 0.055, v.y * 0.13, v.z * 0.05)))
        xform(s, Matrix.Translation((sx * 0.13, 0.40, 0.06)) @ Euler((0.9, 0, 0)).to_matrix().to_4x4())
        shoes.append(s)
    part(merge_bms(shoes), "Shoes", shoe_m, 0, col=(0.95, 0.95, 0.95))

    # torso
    tb = sphere_bm(1, 24, 16)
    def torso_shape(v):
        z = v.z
        w = 0.19 + 0.025 * smooth(-0.2, 0.6, z)  # broader shoulders
        return Vector((v.x * w, v.y * 0.125 * (1 - 0.1 * z), v.z * 0.34)) + Vector((0, 0.21 - 0.03 * z, 0.66))
    deform(tb, torso_shape)
    part(tb, "Torso", shirt_m, 1, col=cloth)
    # neck + head
    part(limb_bm((0, 0.19, 0.93), (0, 0.18, 1.0), 0.05, 0.048), "Neck", skin_m, 0)
    hb = sphere_bm(1, 28, 18)
    deform(hb, lambda v: Vector((v.x * 0.088, v.y * 0.1 - (0.012 if v.y < -0.3 and v.z < 0 else 0), v.z * 0.115 * (1 - 0.12 * max(0, -v.z)))) + Vector((0, 0.17, 1.10)))
    part(hb, "Head", skin_m, 0, col=lambda p, n: (1.0, 1.0, 1.0) if not (abs(p.x) < 0.03 and p.z < 1.05 and p.z > 1.03 and n.y < -0.6) else (0.85, 0.55, 0.55))
    # nose, eyes, ears
    part(xform(deform(sphere_bm(1, 12, 8), lambda v: Vector((v.x * 0.016, v.y * 0.02, v.z * 0.028))), Matrix.Translation((0, 0.075, 1.09))), "HNose", skin_m)
    eyes = []
    for sx in (1, -1):
        eyes.append(xform(sphere_bm(0.012, 12, 8), Matrix.Translation((sx * 0.035, 0.083, 1.125))))
    part(merge_bms(eyes), "HEyes", material("HEye", rough=0.1, spec=0.8), col=(0.08, 0.05, 0.04))
    ears = []
    for sx in (1, -1):
        ears.append(xform(deform(sphere_bm(1, 10, 8), lambda v: Vector((v.x * 0.012, v.y * 0.025, v.z * 0.032))), Matrix.Translation((sx * 0.088, 0.18, 1.1))))
    part(merge_bms(ears), "HEars", skin_m)
    # hair: cap + ponytail-ish back volume
    hr = sphere_bm(1, 28, 18)
    bmh = hr
    kill = [v for v in bmh.verts if (v.co.y < 0.2 and v.co.z < 0.25) or (v.co.z < -0.55)]
    bmesh.ops.delete(bmh, geom=kill, context='VERTS')
    deform(bmh, lambda v: Vector((v.x * 0.097, v.y * 0.112, v.z * 0.12)) + Vector((0, 0.18, 1.115)))
    back = xform(deform(sphere_bm(1, 16, 10), lambda v: Vector((v.x * 0.07, v.y * 0.06, v.z * 0.11))), Matrix.Translation((0, 0.27, 1.02)))
    part(merge_bms([bmh, back]), "HairMesh", hair_m, 1, col=lambda p, n: scl((1, 1, 1), 0.8 + 0.2 * (0.5 + 0.5 * noise.noise(Vector((p.x * 200, p.y * 20, p.z * 20))))))

    # left arm resting on thigh
    la = [limb_bm((-0.2, 0.2, 0.86), (-0.24, 0.12, 0.62), 0.05, 0.043)]
    part(merge_bms(la), "ArmLUpper", shirt_m, 0, col=cloth)
    part(limb_bm((-0.24, 0.12, 0.62), (-0.17, -0.07, 0.42), 0.038, 0.03), "ArmLFore", skin_m)
    part(xform(deform(sphere_bm(1, 14, 8), lambda v: Vector((v.x * 0.035, v.y * 0.05, v.z * 0.02))), Matrix.Translation((-0.16, -0.12, 0.4))), "HandL", skin_m)

    # right arm - reaching to the ground to pet; origin at shoulder
    sh = (0.2, 0.2, 0.86)
    arm = root("ArmR")
    arm.location = sh
    arm.parent = rt
    part(limb_bm(sh, (0.25, -0.03, 0.58), 0.05, 0.043), "ArmRUpper", shirt_m, 0, parent=arm, col=cloth)
    part(limb_bm((0.25, -0.03, 0.58), (0.19, -0.33, 0.2), 0.038, 0.03), "ArmRFore", skin_m, 0, parent=arm)
    part(xform(deform(sphere_bm(1, 14, 8), lambda v: Vector((v.x * 0.04, v.y * 0.06, v.z * 0.018))),
               Matrix.Translation((0.18, -0.39, 0.17)) @ Euler((0.6, 0, 0)).to_matrix().to_4x4()), "HandR", skin_m, 0, parent=arm)
    export("Human")

# ================================================================ TREES
def bark_color(p, n):
    a = math.atan2(p.y, p.x)
    st = noise.noise(Vector((a * 3.0, a * 3.0, p.z * 0.9))) * 0.5 + 0.5
    st2 = noise.noise(Vector((p.x * 14, p.y * 14, p.z * 3))) * 0.5 + 0.5
    c = mix((0.20, 0.15, 0.11), (0.42, 0.33, 0.24), st * 0.7 + st2 * 0.3)
    moss = smooth(0.2, 0.7, noise.noise(p * 2.0 + Vector((5, 5, 5))) * 0.5 + 0.5 - p.z * 0.35) * smooth(-0.2, 0.5, n.x)
    return mix(c, (0.25, 0.38, 0.12), moss * 0.8)

def trunk_bm(H, r0, rings=26, seg=22, flare=0.9, top=0.45, bend=0.25):
    bm = bmesh.new()
    rows = []
    ph = random.random() * 10
    for i in range(rings + 1):
        t = i / rings
        z = -0.25 + t * (H + 0.25)
        row = []
        for j in range(seg):
            a = j / seg * math.tau
            r = r0 * (1 - (1 - top) * t)
            zz = max(z, 0)
            r *= 1 + flare * math.exp(-zz / 0.35) * (0.45 + 0.55 * abs(math.sin(2.5 * a + ph)))
            r *= 1 + 0.08 * noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, z * 1.5 + ph)))
            ox = bend * math.sin(t * 2.2 + ph) * t
            oy = bend * 0.6 * math.cos(t * 1.7 + ph) * t
            row.append(bm.verts.new((ox + math.cos(a) * r, oy + math.sin(a) * r, z)))
        rows.append(row)
    for i in range(rings):
        for j in range(seg):
            a, b = rows[i][j], rows[i][(j + 1) % seg]
            c, d = rows[i + 1][(j + 1) % seg], rows[i + 1][j]
            bm.faces.new((a, b, c, d))
    bm.faces.new(list(reversed(rows[-1]))) if False else None
    return bm

def blob_bm(r, sub=3, amp=0.28, freq=1.4, seed=0.0, squash=1.0):
    bm = ico_bm(1.0, sub)
    off = Vector((seed, seed * 1.3, seed * 0.7))
    def f(v):
        n = v.normalized()
        d = 1 + amp * fbm(n * freq * 2 + off, 3) + 0.08 * noise.noise(n * 9 + off)
        return Vector((n.x, n.y, n.z * squash)) * r * d
    return deform(bm, f)

def leaf_color(base_a, base_b):
    def f(p, n):
        t = noise.noise(p * 1.7) * 0.5 + 0.5
        c = mix(base_a, base_b, t)
        c = mix(c, (0.55, 0.62, 0.18), smooth(0.55, 0.85, noise.noise(p * 5 + Vector((2, 3, 4))) * 0.5 + 0.5) * 0.35)
        ao = 0.55 + 0.45 * smooth(-0.8, 0.8, n.z)
        k = ao * (0.85 + 0.15 * noise.noise(p * 25))
        return scl(c, k)
    return f

def build_oak(name="Oak", seed=1):
    clear()
    random.seed(seed)
    rt = root(name)
    H = 5.0
    tr = trunk_bm(H, 0.34, bend=0.3)
    branches = []
    top = Vector((0.3 * math.sin(2.2), 0.18 * math.cos(1.7), H))
    for i in range(5):
        a = i / 5 * math.tau + random.random()
        s = Vector((0, 0, H * (0.55 + 0.1 * i)))
        e = s + Vector((math.cos(a) * 1.8, math.sin(a) * 1.8, 1.2 + random.random()))
        branches.append(limb_bm(s, e, 0.13, 0.05, 10))
    t = from_bm(merge_bms([tr] + branches), "Trunk", material("Bark", rough=0.95), parent=rt)
    paint(t, bark_color)
    blobs = []
    centers = [Vector((0, 0, H + 1.4))]
    for i in range(6):
        a = i / 6 * math.tau + random.random() * 0.5
        centers.append(Vector((math.cos(a) * 1.9, math.sin(a) * 1.9, H + 0.4 + random.random() * 1.3)))
    centers.append(Vector((0.3, -0.2, H + 2.6)))
    for i, c in enumerate(centers):
        r = 1.5 + random.random() * 0.5 if i else 2.0
        b = blob_bm(r, 3, 0.32, 1.3, seed=i * 3.7 + seed, squash=0.8)
        xform(b, Matrix.Translation(c))
        blobs.append(b)
    lv = from_bm(merge_bms(blobs), "Leaves", material("Leaves", rough=0.85, spec=0.25), parent=rt)
    paint(lv, leaf_color((0.16, 0.34, 0.08), (0.30, 0.48, 0.12)))
    export(name)

def build_pine():
    clear()
    random.seed(3)
    rt = root("Pine")
    H = 7.5
    tr = trunk_bm(H, 0.24, flare=0.7, top=0.2, bend=0.08)
    t = from_bm(tr, "Trunk", material("Bark", rough=0.95), parent=rt)
    paint(t, lambda p, n: scl(bark_color(p, n), 0.9))
    layers = []
    n = 7
    for i in range(n):
        f = i / (n - 1)
        z0 = 1.6 + f * (H - 1.2)
        r = 2.3 * (1 - f) + 0.35
        cb = cone_bm(r, 0.02, r * 1.25 + 0.4, 28, caps=True)
        def jag(v, i=i):
            a = math.atan2(v.y, v.x)
            rr = Vector((v.x, v.y)).length
            k = 1 + 0.18 * math.sin(a * 9 + i) + 0.12 * noise.noise(v * 3 + Vector((i, i, i)))
            vz = v.z - 0.35 * rr * (0.5 + 0.5 * math.sin(a * 9 + i))  # drooping tips
            return Vector((v.x * k, v.y * k, vz))
        deform(cb, jag)
        xform(cb, Matrix.Translation((0, 0, z0 + (r * 1.25 + 0.4) / 2)))
        layers.append(cb)
    lv = from_bm(merge_bms(layers), "Needles", material("Needles", rough=0.9, spec=0.2), parent=rt)
    subsurf(lv, 1)
    paint(lv, leaf_color((0.07, 0.20, 0.08), (0.13, 0.29, 0.10)))
    export("Pine")

def build_birch():
    clear()
    random.seed(11)
    rt = root("Birch")
    H = 6.0
    tr = trunk_bm(H, 0.17, flare=0.5, top=0.35, bend=0.35)
    br = []
    for i in range(4):
        a = i * 1.7
        s = Vector((0, 0, H * (0.6 + 0.08 * i)))
        br.append(limb_bm(s, s + Vector((math.cos(a) * 1.2, math.sin(a) * 1.2, 1.3)), 0.07, 0.03, 8))
    t = from_bm(merge_bms([tr] + br), "Trunk", material("BirchBark", rough=0.8), parent=rt)
    def birch(p, n):
        stripe = noise.noise(Vector((p.x * 3, p.y * 3, p.z * 7)))
        c = (0.88, 0.86, 0.80)
        if stripe > 0.35:
            c = (0.12, 0.10, 0.09)
        if p.z < 0.4:
            c = mix(c, (0.3, 0.26, 0.2), smooth(0.4, 0.0, p.z))
        return scl(c, 0.9 + 0.1 * noise.noise(p * 40))
    paint(t, birch)
    blobs = []
    for i in range(6):
        a = i * 1.3
        c = Vector((math.cos(a) * 1.1, math.sin(a) * 1.1, H + 0.3 + (i % 3) * 0.6))
        b = blob_bm(1.1 + 0.2 * (i % 2), 3, 0.35, 1.6, seed=i * 2.1 + 40, squash=1.2)
        xform(b, Matrix.Translation(c))
        blobs.append(b)
    lv = from_bm(merge_bms(blobs), "Leaves", material("Leaves", rough=0.85, spec=0.25), parent=rt)
    paint(lv, leaf_color((0.30, 0.46, 0.12), (0.46, 0.60, 0.18)))
    export("Birch")

# ================================================================ BUSH (with berries)
def build_bush():
    clear()
    random.seed(21)
    rt = root("Bush")
    blobs = []
    cs = []
    for i in range(7):
        a = i / 7 * math.tau
        rr = 0.0 if i == 0 else 0.35
        c = Vector((math.cos(a) * rr, math.sin(a) * rr, 0.32 + (0.15 if i == 0 else 0)))
        r = 0.42 if i == 0 else 0.3 + random.random() * 0.08
        b = blob_bm(r, 3, 0.35, 2.2, seed=i * 1.9, squash=0.85)
        xform(b, Matrix.Translation(c))
        blobs.append(b)
        cs.append((c, r))
    lv = from_bm(merge_bms(blobs), "BushLeaves", material("Leaves", rough=0.85, spec=0.25), parent=rt)
    paint(lv, leaf_color((0.12, 0.30, 0.08), (0.22, 0.42, 0.10)))
    berries = []
    for i in range(22):
        c, r = cs[random.randrange(len(cs))]
        d = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-0.2, 1))).normalized()
        p = c + Vector((d.x, d.y, d.z * 0.85)) * r * 1.02
        if p.z < 0.08:
            continue
        s = sphere_bm(0.028, 10, 7)
        xform(s, Matrix.Translation(p))
        berries.append(s)
    bo = from_bm(merge_bms(berries), "Berries", material("Berry", rough=0.25, spec=0.7), parent=rt)
    paint(bo, lambda p, n: mix((0.55, 0.03, 0.12), (0.85, 0.12, 0.18), 0.5 + 0.5 * noise.noise(p * 40)))
    export("Bush")

# ================================================================ ROCK
def build_rock(name="Rock", seed=5):
    clear()
    rt = root(name)
    bm = ico_bm(1.0, 4)
    off = Vector((seed, seed * 2, seed * 3))
    def f(v):
        n = v.normalized()
        d = 1 + 0.35 * fbm(n * 1.2 + off, 4) + 0.03 * noise.noise(n * 12)
        # faceted look
        q = Vector((n.x * 1.1, n.y * 0.85, n.z * 0.62)) * d
        q.z = max(q.z, -0.25) if q.z < 0 else q.z
        return q
    deform(bm, f)
    ob = from_bm(bm, "Stone", material("Stone", rough=0.9), parent=rt)
    def col(p, n):
        g = 0.42 + 0.12 * fbm(p * 3, 3)
        c = (g, g * 0.98, g * 0.94)
        moss = smooth(0.45, 0.85, n.z + 0.3 * noise.noise(p * 4))
        c = mix(c, (0.22, 0.36, 0.12), moss)
        c = mix(c, (0.62, 0.62, 0.52), smooth(0.6, 0.8, noise.noise(p * 9) * 0.5 + 0.5) * 0.5)  # lichen
        return c
    paint(ob, col)
    export(name)

# ================================================================ HOLLOW LOG (tunnel)
def build_log():
    clear()
    rt = root("Log")
    L, Ro, Ri, seg, rings = 1.7, 0.25, 0.185, 28, 18
    bm = bmesh.new()
    outer, inner = [], []
    for i in range(rings + 1):
        y = -L / 2 + i * L / rings
        ro_row, ri_row = [], []
        for j in range(seg):
            a = j / seg * math.tau
            nn = noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, y * 2)))
            ro = Ro * (1 + 0.06 * nn + 0.03 * math.sin(a * 11))
            ri = Ri * (1 + 0.05 * noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, y * 3 + 9))))
            ro_row.append(bm.verts.new((math.cos(a) * ro, y, math.sin(a) * ro + Ro * 0.85)))
            ri_row.append(bm.verts.new((math.cos(a) * ri, y, math.sin(a) * ri + Ro * 0.85)))
        outer.append(ro_row)
        inner.append(ri_row)
    for i in range(rings):
        for j in range(seg):
            k = (j + 1) % seg
            bm.faces.new((outer[i][j], outer[i + 1][j], outer[i + 1][k], outer[i][k]))
            bm.faces.new((inner[i][j], inner[i][k], inner[i + 1][k], inner[i + 1][j]))
    for j in range(seg):
        k = (j + 1) % seg
        bm.faces.new((outer[0][j], outer[0][k], inner[0][k], inner[0][j]))
        bm.faces.new((outer[-1][j], inner[-1][j], inner[-1][k], outer[-1][k]))
    bm.normal_update()
    ob = from_bm(bm, "LogWood", material("Bark", rough=0.95), parent=rt)
    cz = Ro * 0.85
    def col(p, n):
        r = math.hypot(p.x, p.z - cz)
        endcap = abs(abs(p.y) - L / 2) < 0.01
        if endcap:
            ring = 0.5 + 0.5 * math.sin(r * 160)
            return mix((0.55, 0.40, 0.25), (0.70, 0.55, 0.36), ring)
        if r < (Ro + Ri) / 2:
            return scl((0.40, 0.28, 0.17), 0.7 + 0.3 * (noise.noise(p * 20) * 0.5 + 0.5))
        c = bark_color(Vector((p.x, p.z, p.y * 2)), n)
        moss = smooth(0.3, 0.8, n.z + 0.3 * noise.noise(p * 5))
        return mix(c, (0.22, 0.40, 0.10), moss * 0.9)
    paint(ob, col)
    # little mushrooms on top
    ms = []
    for i in range(4):
        # along the log (y) on its crest, stems sunk into the bark so the bumpy surface never leaves a gap
        x, y, z0 = 0.05 * (1 if i % 2 else -1), -0.38 + i * 0.28, cz + Ro * 0.86
        st = limb_bm((x, y, z0), (x, y, z0 + 0.065), 0.008, 0.007, 8)
        cap = sphere_bm(1, 12, 8)
        deform(cap, lambda v: Vector((v.x * 0.03, v.y * 0.03, max(v.z, -0.2) * 0.018)))
        xform(cap, Matrix.Translation((x, y, z0 + 0.07)))
        ms += [st, cap]
    mo = from_bm(merge_bms(ms), "LogShrooms", material("Shroom", rough=0.6), parent=rt)
    paint(mo, lambda p, n: (0.85, 0.75, 0.6) if n.z < 0.2 else (0.72, 0.45, 0.2))
    export("Log")

# ================================================================ BURROW (tunnel entrance)
def build_burrow():
    clear()
    rt = root("Burrow")
    bm = sphere_bm(1.0, 36, 20)
    def f(v):
        n = v.normalized()
        d = 1 + 0.15 * fbm(n * 2.0 + Vector((4, 4, 4)), 3)
        q = Vector((n.x * 0.8, n.y * 0.75, n.z * 0.42)) * d
        # pull the front down into an opening slope
        if q.y < -0.3 and q.z > 0:
            q.z *= 0.8
        if q.z < -0.05:
            q.z = -0.05
        return q
    deform(bm, f)
    ob = from_bm(bm, "Mound", material("Dirt", rough=0.95), parent=rt)
    def col(p, n):
        dirt = mix((0.30, 0.20, 0.12), (0.45, 0.32, 0.20), noise.noise(p * 8) * 0.5 + 0.5)
        grassy = smooth(0.25, 0.4, p.z + 0.08 * noise.noise(p * 6)) * smooth(-0.35, 0.2, p.y)
        return mix(dirt, (0.25, 0.40, 0.12), grassy * 0.8)
    paint(ob, col)
    # the hole: dark cavity
    h = sphere_bm(1, 24, 14)
    deform(h, lambda v: Vector((v.x * 0.17, v.y * 0.25, v.z * 0.14)))
    xform(h, Matrix.Translation((0, -0.55, 0.12)) @ Euler((-0.35, 0, 0)).to_matrix().to_4x4())
    ho = from_bm(h, "Hole", material("Hole", rough=1.0, spec=0.0), parent=rt)
    paint(ho, lambda p, n: (0.03, 0.018, 0.01) if p.y > -0.72 else (0.12, 0.08, 0.05))
    # rim of dug dirt
    rim = []
    for i in range(14):
        a = math.pi + (i / 13 - 0.5) * 2.4
        b = blob_bm(0.06 + random.random() * 0.04, 2, 0.4, 3, seed=i, squash=0.6)
        xform(b, Matrix.Translation((math.sin(a) * 0.24, -0.72 - math.cos(a) * 0.08 + 0.1, 0.02)))
        rim.append(b)
    ro = from_bm(merge_bms(rim), "Clods", material("Dirt", rough=0.95), parent=rt)
    paint(ro, lambda p, n: mix((0.28, 0.18, 0.1), (0.4, 0.28, 0.18), noise.noise(p * 20) * 0.5 + 0.5))
    export("Burrow")

# ================================================================ LEAF PILE
def build_leafpile():
    clear()
    random.seed(33)
    rt = root("LeafPile")
    leaves = []
    cols = []
    for i in range(70):
        rr = math.sqrt(random.random()) * 0.42
        a = random.random() * math.tau
        x, y = math.cos(a) * rr, math.sin(a) * rr
        z = 0.2 * (1 - (rr / 0.44) ** 2) + random.random() * 0.03
        lb = sphere_bm(1, 10, 6)
        L = 0.05 + random.random() * 0.03
        def lf(v, L=L):
            w = max(0.0, 1 - abs(v.y)) ** 0.8
            return Vector((v.x * 0.55 * L * w, v.y * L, v.z * 0.003 + abs(v.x) * 0.012))
        deform(lb, lf)
        m = Matrix.Translation((x, y, z)) @ Euler((random.uniform(-0.6, 0.6), random.uniform(-0.6, 0.6), random.random() * math.tau)).to_matrix().to_4x4()
        xform(lb, m)
        leaves.append(lb)
    ob = from_bm(merge_bms(leaves), "Leaves", material("DryLeaves", rough=0.8), parent=rt)
    pal = [(0.75, 0.35, 0.08), (0.62, 0.22, 0.06), (0.80, 0.55, 0.12), (0.45, 0.28, 0.12), (0.55, 0.45, 0.15)]
    def col(p, n):
        k = int((noise.noise(p * 14) * 0.5 + 0.5) * 4.99)
        return scl(pal[k], 0.85 + 0.2 * noise.noise(p * 60))
    paint(ob, col)
    export("LeafPile")

# ================================================================ SMALL FOODS
def build_dandelion(name="Dandelion"):
    clear()
    rt = root(name)
    parts = []
    stem = limb_bm((0, 0, 0), (0.01, 0.0, 0.16), 0.0035, 0.003, 8)
    st = from_bm(stem, "Stem", material("Plant", rough=0.7), parent=rt)
    paint(st, solid((0.35, 0.55, 0.18)))
    head = sphere_bm(1, 20, 12)
    def hf(v):
        n = v.normalized()
        r = 1 + 0.2 * abs(math.sin(math.atan2(n.y, n.x) * 14))
        return Vector((n.x * 0.028 * r, n.y * 0.028 * r, n.z * 0.014 + (0.008 if n.z > 0 else 0)))
    deform(head, hf)
    xform(head, Matrix.Translation((0.01, 0, 0.17)))
    hd = from_bm(head, "Flower", material("Petal", rough=0.6), parent=rt)
    paint(hd, lambda p, n: mix((0.95, 0.70, 0.05), (1.0, 0.85, 0.2), noise.noise(p * 200) * 0.5 + 0.5))
    lvs = []
    for i in range(5):
        a = i / 5 * math.tau
        lb = sphere_bm(1, 12, 6)
        def lf(v):
            w = max(0.0, 1 - abs(v.y)) * (0.8 + 0.4 * abs(math.sin(v.y * 12)))
            return Vector((v.x * 0.012 * w, v.y * 0.055, v.z * 0.002))
        deform(lb, lf)
        xform(lb, Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, 0.05, 0.012)) @ Euler((0.25, 0, 0)).to_matrix().to_4x4())
        lvs.append(lb)
    lo = from_bm(merge_bms(lvs), "BaseLeaves", material("Plant", rough=0.7), parent=rt)
    paint(lo, solid((0.25, 0.48, 0.12)))
    export(name)

def build_clover(name="Clover", n_leaves=3):
    clear()
    rt = root(name)
    parts = []
    for s in range(3 if n_leaves == 3 else 1):
        a0 = s * 2.1
        base = Vector((math.cos(a0) * 0.03, math.sin(a0) * 0.03, 0))
        top = base + Vector((0.004, 0.002, 0.07 + s * 0.012))
        parts.append(limb_bm(base, top, 0.0022, 0.002, 6))
        for i in range(n_leaves):
            a = i / n_leaves * math.tau + a0
            lb = sphere_bm(1, 12, 6)
            def heart(v):
                ang = math.atan2(v.y, v.x)
                r = 1 - 0.3 * max(0, math.cos(ang)) ** 6
                return Vector((v.x * 0.017 * r, v.y * 0.015 * r, v.z * 0.002))
            deform(lb, heart)
            xform(lb, Matrix.Translation(top) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0.016, 0, 0)) @ Euler((0, -0.15, 0)).to_matrix().to_4x4())
            parts.append(lb)
    ob = from_bm(merge_bms(parts), "CloverMesh", material("Plant", rough=0.6), parent=rt)
    def col(p, n):
        r = math.hypot(p.x, p.y)
        c = (0.22, 0.50, 0.14) if n_leaves == 3 else (0.18, 0.62, 0.20)
        return mix(c, (0.62, 0.80, 0.45), 0.35 * smooth(0.0, 1.0, noise.noise(p * 300) * 0.5 + 0.5))
    paint(ob, col)
    export(name)

def build_carrot():
    clear()
    rt = root("Carrot")
    c = cone_bm(0.022, 0.003, 0.16, 18)
    def f(v):
        a = math.atan2(v.y, v.x)
        k = 1 + 0.05 * math.sin(v.z * 120)
        return Vector((v.x * k, v.y * k, v.z))
    deform(c, f)
    xform(c, Matrix.Translation((0, 0, 0.08)) @ Euler((math.pi, 0, 0)).to_matrix().to_4x4())
    xform(c, Matrix.Translation((0, 0, 0.16)))
    ob = from_bm(c, "Root", material("Veg", rough=0.5, spec=0.5), parent=rt)
    subsurf(ob, 1)
    paint(ob, lambda p, n: scl((0.95, 0.45, 0.06), 0.85 + 0.15 * math.sin(p.z * 400)))
    tops = []
    for i in range(6):
        a = i / 6 * math.tau
        tops.append(limb_bm((0, 0, 0.16), (math.cos(a) * 0.03, math.sin(a) * 0.03, 0.24 + 0.02 * (i % 2)), 0.003, 0.002, 6, caps=False))
        lb = sphere_bm(1, 8, 5)
        deform(lb, lambda v: Vector((v.x * 0.012, v.y * 0.012, v.z * 0.004)))
        xform(lb, Matrix.Translation((math.cos(a) * 0.032, math.sin(a) * 0.032, 0.245 + 0.02 * (i % 2))))
        tops.append(lb)
    to = from_bm(merge_bms(tops), "Tops", material("Plant", rough=0.7), parent=rt)
    paint(to, solid((0.25, 0.55, 0.15)))
    rt.rotation_euler = (0, math.radians(80), 0)
    rt.location = (0.12, 0, 0.022)
    export("Carrot")

def build_pepper():
    clear()
    rt = root("Pepper")
    b = sphere_bm(1, 24, 16)
    def f(v):
        a = math.atan2(v.y, v.x)
        lobe = 1 + 0.12 * math.cos(a * 4) * (1 - abs(v.z))
        z = v.z * 1.1
        w = 1 - 0.15 * max(0, -v.z)
        return Vector((v.x * lobe * w, v.y * lobe * w, z)) * 0.042 + Vector((0, 0, 0.045))
    deform(b, f)
    ob = from_bm(b, "PepperBody", material("Veg", rough=0.25, spec=0.8), parent=rt)
    paint(ob, lambda p, n: scl((0.85, 0.08, 0.05), 0.85 + 0.15 * n.z))
    st = limb_bm((0, 0, 0.09), (0.006, 0.0, 0.115), 0.006, 0.004, 8)
    so = from_bm(st, "Stem", material("Plant", rough=0.7), parent=rt)
    paint(so, solid((0.25, 0.45, 0.12)))
    export("Pepper")

def build_strawberry():
    clear()
    rt = root("Strawberry")
    b = sphere_bm(1, 22, 14)
    def f(v):
        w = 0.55 + 0.45 * smooth(-1.0, 0.6, v.z)
        return Vector((v.x * w, v.y * w, v.z)) * 0.03 + Vector((0, 0, 0.03))
    deform(b, f)
    ob = from_bm(b, "Berry", material("Veg", rough=0.3, spec=0.7), parent=rt)
    subsurf(ob, 1)
    def col(p, n):
        s = noise.noise(p * 700)
        return (0.95, 0.85, 0.3) if s > 0.55 else scl((0.85, 0.05, 0.08), 0.9 + 0.1 * n.z)
    paint(ob, col)
    cal = []
    for i in range(6):
        a = i / 6 * math.tau
        lb = sphere_bm(1, 8, 5)
        deform(lb, lambda v: Vector((v.x * 0.006, v.y * 0.016, v.z * 0.002)))
        xform(lb, Matrix.Translation((0, 0, 0.061)) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, 0.012, 0)) @ Euler((-0.4, 0, 0)).to_matrix().to_4x4())
        cal.append(lb)
    cal.append(limb_bm((0, 0, 0.06), (0, 0.004, 0.075), 0.002, 0.0015, 6))
    co = from_bm(merge_bms(cal), "Calyx", material("Plant", rough=0.7), parent=rt)
    paint(co, solid((0.2, 0.5, 0.15)))
    export("Strawberry")

def build_mushroom(name, cap_col, spots):
    clear()
    rt = root(name)
    st = limb_bm((0, 0, 0), (0.004, 0, 0.07), 0.011, 0.009, 12)
    so = from_bm(st, "Stalk", material("Shroom", rough=0.6), parent=rt)
    paint(so, solid((0.92, 0.88, 0.8)))
    cap = sphere_bm(1, 22, 14)
    deform(cap, lambda v: Vector((v.x * 0.045, v.y * 0.045, (max(v.z, -0.15) + 0.15) * 0.03)))
    xform(cap, Matrix.Translation((0.004, 0, 0.066)))
    co = from_bm(cap, "Cap", material("ShroomCap", rough=0.35 if spots else 0.6, spec=0.6), parent=rt)
    def col(p, n):
        if n.z < -0.3:
            return (0.9, 0.85, 0.75)
        if spots and noise.noise(p * 260) > 0.45:
            return (0.97, 0.95, 0.9)
        return scl(cap_col, 0.85 + 0.15 * noise.noise(p * 80))
    paint(co, col)
    export(name)

def build_hay():
    clear()
    random.seed(44)
    rt = root("Hay")
    st = []
    for i in range(60):
        a = random.random() * math.tau
        r = math.sqrt(random.random()) * 0.03
        x, y = math.cos(a) * r, math.sin(a) * r
        L = 0.16 + random.random() * 0.06
        tilt = random.uniform(-0.2, 0.2)
        st.append(limb_bm((x - L / 2, y + tilt * 0.05, 0.03 + y * 0.3), (x + L / 2, y - tilt * 0.05, 0.03 + y * 0.3 + random.uniform(-0.01, 0.01)), 0.0022, 0.0018, 4, caps=False))
    ho = from_bm(merge_bms(st), "Straw", material("Straw", rough=0.7), parent=rt)
    paint(ho, lambda p, n: mix((0.78, 0.68, 0.32), (0.55, 0.62, 0.25), noise.noise(p * 90) * 0.5 + 0.5))
    tie = cone_bm(0.036, 0.036, 0.012, 16, caps=False)
    xform(tie, Matrix.Translation((0, 0, 0.03)) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4())
    to = from_bm(tie, "Twine", material("Plant", rough=0.8), parent=rt)
    paint(to, solid((0.55, 0.12, 0.1)))
    export("Hay")

# ================================================================ GRASS
def grass_blade(h, w, lean, rot, pos, bend=0.3):
    bm = bmesh.new()
    segs = 4
    rows = []
    for i in range(segs + 1):
        t = i / segs
        ww = w * (1 - t) ** 0.9
        z = h * t
        off = lean * t * t
        rows.append((bm.verts.new((-ww / 2, off, z)), bm.verts.new((ww / 2, off, z))))
    for i in range(segs):
        a, b = rows[i]
        c, d = rows[i + 1]
        bm.faces.new((a, b, d, c))
    xform(bm, Matrix.Translation(pos) @ Matrix.Rotation(rot, 4, 'Z'))
    return bm

def build_grass(name, n, hmin, hmax, spread, dark, light, seedheads=False, seed=1):
    clear()
    random.seed(seed)
    rt = root(name)
    bl = []
    for i in range(n):
        a = random.random() * math.tau
        r = math.sqrt(random.random()) * spread
        h = random.uniform(hmin, hmax)
        bl.append(grass_blade(h, random.uniform(0.008, 0.013), random.uniform(0.03, 0.08) * h / 0.2, a + random.uniform(-0.6, 0.6), (math.cos(a) * r, math.sin(a) * r, 0)))
        if seedheads and i % 5 == 0:
            tip = Vector((math.cos(a) * r, math.sin(a) * r, h * 1.1))
            bl.append(limb_bm(Vector((tip.x, tip.y, 0)), tip, 0.0012, 0.001, 3, caps=False))
            sh = sphere_bm(1, 4, 3)
            deform(sh, lambda v: Vector((v.x * 0.004, v.y * 0.004, v.z * 0.02)))
            xform(sh, Matrix.Translation(tip + Vector((0, 0, 0.02))))
            bl.append(sh)
    ob = from_bm(merge_bms(bl), "Blades", material("Grass", rough=0.8, spec=0.3), parent=rt, smooth_shade=False)
    hmax_ = hmax * 1.3
    def col(p, n):
        t = smooth(0.0, hmax_, p.z)
        c = mix(dark, light, t)
        return scl(c, 0.85 + 0.2 * noise.noise(p * 30))
    paint(ob, col)
    export(name)

def build_fern():
    clear()
    random.seed(55)
    rt = root("Fern")
    parts = []
    for f in range(7):
        a = f / 7 * math.tau + random.random() * 0.3
        L = 0.45 + random.random() * 0.15
        pts = []
        for i in range(10):
            t = i / 9
            pts.append(Vector((math.cos(a) * L * t, math.sin(a) * L * t, 0.35 * math.sin(t * 2.4) * L)))
        for i in range(9):
            parts.append(limb_bm(pts[i], pts[i + 1], 0.004 * (1 - i / 10) + 0.001, 0.004 * (1 - (i + 1) / 10) + 0.001, 4, caps=False))
            t = i / 9
            lw = 0.08 * math.sin(math.pi * (t * 0.9 + 0.1))
            for s in (1, -1):
                lb = sphere_bm(1, 6, 3)
                deform(lb, lambda v, lw=lw: Vector((v.x * 0.01, v.y * lw * 0.5, v.z * 0.002)))
                perp = Vector((-math.sin(a), math.cos(a), 0)) * s
                ang = math.atan2(perp.y, perp.x) - math.pi / 2
                xform(lb, Matrix.Translation(pts[i] + perp * lw * 0.45 + Vector((0, 0, -0.01))) @ Matrix.Rotation(ang, 4, 'Z'))
                parts.append(lb)
    ob = from_bm(merge_bms(parts), "Fronds", material("Leaves", rough=0.8), parent=rt)
    paint(ob, lambda p, n: scl(mix((0.12, 0.30, 0.08), (0.30, 0.52, 0.14), smooth(0, 0.3, p.z)), 0.9 + 0.1 * noise.noise(p * 50)))
    export("Fern")

def build_flower(name, petal):
    clear()
    rt = root(name)
    stem = limb_bm((0, 0, 0), (0.005, 0.003, 0.2), 0.003, 0.0025, 6)
    so = from_bm(stem, "Stem", material("Plant", rough=0.7), parent=rt)
    paint(so, solid((0.3, 0.5, 0.18)))
    ps = []
    for i in range(6):
        a = i / 6 * math.tau
        lb = sphere_bm(1, 8, 5)
        deform(lb, lambda v: Vector((v.x * 0.01, v.y * 0.02, v.z * 0.002)))
        xform(lb, Matrix.Translation((0.005, 0.003, 0.2)) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, 0.017, 0)) @ Euler((0.3, 0, 0)).to_matrix().to_4x4())
        ps.append(lb)
    c = sphere_bm(0.007, 8, 6)
    xform(c, Matrix.Translation((0.005, 0.003, 0.203)))
    po = from_bm(merge_bms(ps), "Petals", material("Petal", rough=0.6), parent=rt)
    paint(po, solid(petal))
    co = from_bm(c, "Center", material("Petal", rough=0.6), parent=rt)
    paint(co, solid((0.95, 0.75, 0.1)))
    export(name)

# ================================================================ HAWK
def build_hawk():
    clear()
    rt = root("Hawk")
    b = sphere_bm(1, 22, 14)
    deform(b, lambda v: Vector((v.x * 0.075, v.y * 0.22, v.z * 0.075 * (1 - 0.2 * v.y))))
    body = from_bm(b, "HawkBody", material("Feather", rough=0.85), parent=rt)
    paint(body, lambda p, n: mix((0.35, 0.22, 0.12), (0.9, 0.85, 0.75), smooth(0.2, -0.6, n.z)) if True else None)
    hb = sphere_bm(0.06, 16, 10)
    xform(hb, Matrix.Translation((0, -0.22, 0.03)))
    ho = from_bm(hb, "HawkHead", material("Feather", rough=0.85), parent=rt)
    paint(ho, lambda p, n: (0.95, 0.75, 0.1) if (abs(p.x) > 0.035 and p.y < -0.24 and p.z > 0.035) else mix((0.3, 0.2, 0.12), (0.85, 0.8, 0.7), smooth(0.2, -0.6, n.z)))
    bk = cone_bm(0.015, 0.001, 0.05, 8)
    xform(bk, Matrix.Translation((0, -0.29, 0.02)) @ Euler((math.pi / 2 + 0.4, 0, 0)).to_matrix().to_4x4())
    bko = from_bm(bk, "Beak", material("Beak", rough=0.4), parent=rt)
    paint(bko, solid((0.9, 0.75, 0.2)))
    tb = sphere_bm(1, 14, 8)
    deform(tb, lambda v: Vector((v.x * 0.09 * (0.6 + 0.5 * max(0, v.y)), v.y * 0.12, v.z * 0.012)))
    xform(tb, Matrix.Translation((0, 0.3, 0.0)))
    to = from_bm(tb, "Tail", material("Feather", rough=0.85), parent=rt)
    paint(to, lambda p, n: mix((0.75, 0.35, 0.15), (0.3, 0.15, 0.08), smooth(0.36, 0.41, p.y)))
    for side, nm in ((1, "WingR"), (-1, "WingL")):
        w = sphere_bm(1, 20, 10)
        def wf(v, side=side):
            span = (v.x * side + 1) / 2  # 0 root .. 1 tip
            chord = 0.16 * (1 - 0.55 * span) + 0.03
            return Vector((side * span * 0.58, v.y * chord + span * 0.08, v.z * 0.012 * (1 - span * 0.6) + 0.04 * math.sin(span * 2.5)))
        deform(w, wf)
        xform(w, Matrix.Translation((side * 0.04, -0.03, 0.02)))
        wo = from_bm(w, nm, material("Feather", rough=0.85), parent=rt, origin=(side * 0.04, -0.03, 0.02))
        def wc(p, n, side=side):
            span = abs(p.x) / 0.6
            base = mix((0.42, 0.27, 0.15), (0.2, 0.12, 0.07), smooth(0.6, 1.0, span))
            if n.z < -0.3:
                base = mix((0.85, 0.78, 0.65), (0.3, 0.2, 0.15), smooth(0.7, 1.0, span))
            bar = 0.85 + 0.15 * math.sin(p.y * 120)
            return scl(base, bar)
        paint(wo, wc)
    export("Hawk")

# ================================================================ FOX
def build_fox():
    clear()
    rt = root("Fox")
    ORANGE, WHITE, BLACK = (0.85, 0.38, 0.1), (0.95, 0.92, 0.86), (0.08, 0.06, 0.05)
    b = sphere_bm(1, 26, 16)
    deform(b, lambda v: Vector((v.x * 0.12 * (1 - 0.1 * v.y), v.y * 0.3, v.z * 0.12)) + Vector((0, 0, 0.42)))
    bo = from_bm(b, "FoxBody", material("FoxFur", rough=0.9), parent=rt)
    subsurf(bo, 1)
    paint(bo, lambda p, n: WHITE if n.z < -0.55 and p.y < 0.05 else scl(ORANGE, 0.85 + 0.2 * noise.noise(p * 40)))
    # neck + head
    nk = limb_bm((0, -0.22, 0.45), (0, -0.33, 0.55), 0.08, 0.07, 14)
    no = from_bm(nk, "Neck", material("FoxFur", rough=0.9), parent=rt)
    paint(no, lambda p, n: WHITE if n.y < -0.3 and n.z < 0.3 else ORANGE)
    hd = sphere_bm(1, 22, 14)
    deform(hd, lambda v: Vector((v.x * 0.075, v.y * 0.08, v.z * 0.065)) + Vector((0, -0.38, 0.58)))
    snout = cone_bm(0.042, 0.012, 0.13, 14)
    xform(snout, Matrix.Translation((0, -0.49, 0.555)) @ Euler((math.pi / 2 + 0.15, 0, 0)).to_matrix().to_4x4())
    ears = []
    for sx in (1, -1):
        e = cone_bm(0.035, 0.002, 0.09, 4)
        deform(e, lambda v: Vector((v.x, v.y * 0.35, v.z)))
        xform(e, Matrix.Translation((sx * 0.045, -0.36, 0.66)) @ Euler((0.1, sx * 0.25, 0)).to_matrix().to_4x4())
        ears.append(e)
    ho = from_bm(merge_bms([hd, snout] + ears), "FoxHead", material("FoxFur", rough=0.9), parent=rt)
    def hcol(p, n):
        if p.z > 0.68:
            return BLACK
        if (p.z < 0.565 and p.y < -0.36) or (abs(p.x) > 0.05 and p.y < -0.42 and p.z < 0.59):
            return WHITE
        return ORANGE
    paint(ho, hcol)
    fe = []
    for sx in (1, -1):
        fe.append(xform(sphere_bm(0.012, 10, 6), Matrix.Translation((sx * 0.038, -0.435, 0.605))))
    fe.append(xform(sphere_bm(0.013, 10, 6), Matrix.Translation((0, -0.555, 0.565))))
    feo = from_bm(merge_bms(fe), "FoxEyes", material("Eye", rough=0.05, spec=0.9), parent=rt)
    paint(feo, lambda p, n: (0.02, 0.02, 0.02) if p.y < -0.5 else (0.7, 0.45, 0.05))
    # tail
    tl = []
    for i in range(7):
        t = i / 6
        c = Vector((0, 0.3 + t * 0.32, 0.4 - t * 0.08 + 0.05 * math.sin(t * 3)))
        r = 0.05 + 0.05 * math.sin(math.pi * min(1, t * 1.1 + 0.1))
        tl.append(xform(sphere_bm(r, 14, 8), Matrix.Translation(c)))
    tlo = from_bm(merge_bms(tl), "Tail", material("FoxFur", rough=0.9), parent=rt, origin=(0, 0.28, 0.42))
    subsurf(tlo, 1)
    paint(tlo, lambda p, n: WHITE if p.y > 0.58 else scl(ORANGE, 0.9 + 0.15 * noise.noise(p * 30)))
    for nm, (x, y) in {"LegFL": (-0.06, -0.2), "LegFR": (0.06, -0.2), "LegBL": (-0.065, 0.2), "LegBR": (0.065, 0.2)}.items():
        lg = limb_bm((x, y, 0.4), (x, y, 0.03), 0.03, 0.018, 10)
        paw = sphere_bm(1, 10, 6)
        deform(paw, lambda v: Vector((v.x * 0.022, v.y * 0.03, v.z * 0.015)))
        xform(paw, Matrix.Translation((x, y - 0.01, 0.015)))
        lo = from_bm(merge_bms([lg, paw]), nm, material("FoxFur", rough=0.9), parent=rt, origin=(x, y, 0.4))
        paint(lo, lambda p, n: BLACK if p.z < 0.2 else ORANGE)
    export("Fox")

# ================================================================ COTTAGE + GARDEN
def box_bm(sx, sy, sz, c=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    xform(bm, Matrix.Translation(c) @ Matrix.Diagonal((sx, sy, sz, 1)))
    return bm

def build_house():
    clear()
    rt = root("House")
    W, D, Hh = 6.0, 4.5, 2.7
    walls = box_bm(W, D, Hh, (0, 0, Hh / 2))
    wo = from_bm(walls, "Walls", material("Plaster", rough=0.9), parent=rt, smooth_shade=False)
    def wall_col(p, n):
        c = (0.93, 0.89, 0.80)
        if p.z < 0.45:
            c = mix((0.45, 0.42, 0.40), (0.60, 0.58, 0.55), noise.noise(p * 5) * 0.5 + 0.5)
        return scl(c, 0.92 + 0.08 * noise.noise(p * 3))
    # subdivide walls so vertex colours have resolution
    bm = bmesh.new(); bm.from_mesh(wo.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=12, use_grid_fill=True)
    bm.to_mesh(wo.data); bm.free()
    paint(wo, wall_col)
    # roof: prism
    bm = bmesh.new()
    ov = 0.5
    ridge = Hh + 1.9
    pts = [(-W / 2 - ov, -D / 2 - ov, Hh - 0.25), (W / 2 + ov, -D / 2 - ov, Hh - 0.25), (W / 2 + ov, 0, ridge), (-W / 2 - ov, 0, ridge),
           (-W / 2 - ov, D / 2 + ov, Hh - 0.25), (W / 2 + ov, D / 2 + ov, Hh - 0.25)]
    v = [bm.verts.new(p) for p in pts]
    bm.faces.new((v[0], v[1], v[2], v[3]))
    bm.faces.new((v[3], v[2], v[5], v[4]))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=10, use_grid_fill=True)
    sol = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    ext = [e for e in sol["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, 0.12), verts=ext)
    bm.normal_update()
    ro = from_bm(bm, "Roof", material("Roof", rough=0.8), parent=rt, smooth_shade=False)
    paint(ro, lambda p, n: scl((0.45, 0.16, 0.10), 0.75 + 0.25 * (0.5 + 0.5 * math.sin(p.z * 34)) * (0.9 + 0.1 * noise.noise(p * 6))))
    # gables
    gb = bmesh.new()
    for sx in (1, -1):
        g = [gb.verts.new((sx * W / 2, -D / 2, Hh)), gb.verts.new((sx * W / 2, D / 2, Hh)), gb.verts.new((sx * W / 2, 0, ridge - 0.1))]
        gb.faces.new(g if sx > 0 else list(reversed(g)))
    go = from_bm(gb, "Gables", material("Plaster", rough=0.9), parent=rt, smooth_shade=False)
    paint(go, solid((0.9, 0.86, 0.77)))
    # door + windows + chimney + step
    door = box_bm(1.0, 0.1, 2.0, (0.8, -D / 2 - 0.02, 1.0))
    do = from_bm(door, "Door", material("Wood", rough=0.7), parent=rt, smooth_shade=False)
    paint(do, lambda p, n: scl((0.35, 0.2, 0.12), 0.8 + 0.2 * math.sin(p.x * 40)))
    knob = sphere_bm(0.04, 10, 6); xform(knob, Matrix.Translation((1.15, -D / 2 - 0.09, 1.0)))
    ko = from_bm(knob, "Knob", material("Brass", rough=0.3, metal=1.0), parent=rt)
    paint(ko, solid((0.9, 0.7, 0.3)))
    wins = []
    frames = []
    for (x, y, rotz) in ((-1.5, -D / 2, 0), (2.2, -D / 2, 0), (-1.5, D / 2, 0), (1.5, D / 2, 0)):
        yy = y - 0.03 if y < 0 else y + 0.03
        wins.append(box_bm(1.1, 0.06, 1.0, (x, yy, 1.6)))
        frames.append(box_bm(1.3, 0.12, 0.1, (x, yy, 1.05)))
        frames.append(box_bm(1.3, 0.12, 0.1, (x, yy, 2.15)))
        frames.append(box_bm(0.1, 0.12, 1.2, (x - 0.6, yy, 1.6)))
        frames.append(box_bm(0.1, 0.12, 1.2, (x + 0.6, yy, 1.6)))
        frames.append(box_bm(0.06, 0.1, 1.0, (x, yy, 1.6)))
        frames.append(box_bm(1.1, 0.1, 0.06, (x, yy, 1.6)))
    wio = from_bm(merge_bms(wins), "Windows", material("Glass", rough=0.05, spec=1.0, emit=(1.0, 0.75, 0.35), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(wio, solid((0.25, 0.35, 0.45)))
    fo = from_bm(merge_bms(frames), "Frames", material("Trim", rough=0.6), parent=rt, smooth_shade=False)
    paint(fo, solid((0.96, 0.96, 0.94)))
    ch = box_bm(0.6, 0.6, 1.6, (-1.8, 0.8, ridge - 0.3))
    cho = from_bm(ch, "Chimney", material("Brick", rough=0.9), parent=rt, smooth_shade=False)
    bm = bmesh.new(); bm.from_mesh(cho.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=8, use_grid_fill=True)
    bm.to_mesh(cho.data); bm.free()
    paint(cho, lambda p, n: scl((0.6, 0.25, 0.18), 0.7 + 0.3 * (1 if (int(p.z * 12) % 2) else 0.8)))
    step = box_bm(1.6, 0.8, 0.18, (0.8, -D / 2 - 0.4, 0.09))
    sto = from_bm(step, "Step", material("Stone", rough=0.9), parent=rt, smooth_shade=False)
    paint(sto, solid((0.55, 0.53, 0.5)))
    export("House")

def build_gardenbed():
    clear()
    random.seed(66)
    rt = root("GardenBed")
    L, Wd, Hb = 2.4, 1.0, 0.3
    planks = [box_bm(L, 0.06, Hb, (0, -Wd / 2, Hb / 2)), box_bm(L, 0.06, Hb, (0, Wd / 2, Hb / 2)),
              box_bm(0.06, Wd, Hb, (-L / 2, 0, Hb / 2)), box_bm(0.06, Wd, Hb, (L / 2, 0, Hb / 2))]
    po = from_bm(merge_bms(planks), "Planks", material("Wood", rough=0.8), parent=rt, smooth_shade=False)
    bm = bmesh.new(); bm.from_mesh(po.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=6, use_grid_fill=True)
    bm.to_mesh(po.data); bm.free()
    paint(po, lambda p, n: scl((0.5, 0.34, 0.2), 0.75 + 0.25 * (0.5 + 0.5 * math.sin(p.x * 25 + p.y * 25 + noise.noise(p * 8) * 3))))
    soil = box_bm(L - 0.08, Wd - 0.08, 0.05, (0, 0, Hb - 0.05))
    bm = soil
    so = from_bm(bm, "Soil", material("Dirt", rough=1.0), parent=rt)
    paint(so, lambda p, n: mix((0.18, 0.12, 0.08), (0.3, 0.2, 0.12), noise.noise(p * 20) * 0.5 + 0.5))
    tops = []
    for i in range(9):
        for j in range(2):
            x = -L / 2 + 0.25 + i * 0.24
            y = -0.22 + j * 0.44
            for k in range(5):
                a = k / 5 * math.tau + i
                tops.append(limb_bm((x, y, Hb - 0.02), (x + math.cos(a) * 0.06, y + math.sin(a) * 0.06, Hb + 0.13 + random.random() * 0.05), 0.006, 0.003, 5, caps=False))
    to = from_bm(merge_bms(tops), "VegTops", material("Plant", rough=0.7), parent=rt)
    paint(to, lambda p, n: mix((0.2, 0.45, 0.12), (0.35, 0.6, 0.18), noise.noise(p * 30) * 0.5 + 0.5))
    export("GardenBed")

def build_fence():
    clear()
    rt = root("Fence")
    parts = [box_bm(0.09, 0.09, 1.0, (0, 0, 0.5)), box_bm(2.0, 0.05, 0.1, (1.0, 0, 0.35)), box_bm(2.0, 0.05, 0.1, (1.0, 0, 0.75))]
    cap = cone_bm(0.07, 0.0, 0.08, 4)
    xform(cap, Matrix.Translation((0, 0, 1.04)) @ Matrix.Rotation(math.pi / 4, 4, 'Z'))
    parts.append(cap)
    fo = from_bm(merge_bms(parts), "Rails", material("Trim", rough=0.7), parent=rt, smooth_shade=False)
    paint(fo, lambda p, n: scl((0.93, 0.92, 0.88), 0.88 + 0.12 * noise.noise(p * 10)))
    export("Fence")

def build_blanket():
    clear()
    rt = root("Blanket")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=24, y_segments=24, size=0.9, calc_uvs=True)
    deform(bm, lambda v: Vector((v.x, v.y, 0.01 + 0.012 * noise.noise(v * 4))))
    bo = from_bm(bm, "Cloth", material("Cloth", rough=0.95), parent=rt)
    def col(p, n):
        cx = int(math.floor(p.x * 5)) % 2
        cy = int(math.floor(p.y * 5)) % 2
        return (0.85, 0.2, 0.2) if cx ^ cy else (0.95, 0.93, 0.88)
    paint(bo, col)
    export("Blanket")

# ---------------------------------------------------------------- run
only = sys.argv[sys.argv.index("--") + 2:] if "--" in sys.argv else []
# ================================================================ ZONES (the world around the park)
def rbox_bm(sx, sy, sz, c=(0, 0, 0), e=0.28, u=24, v=14):
    """A box with rounded edges: a UV sphere pushed out to a superellipsoid (e -> 0 is sharper)."""
    bm = sphere_bm(1, u, v)
    def f(p):
        n = p.normalized()
        return Vector((math.copysign(abs(n.x) ** e, n.x) * sx / 2, math.copysign(abs(n.y) ** e, n.y) * sy / 2, math.copysign(abs(n.z) ** e, n.z) * sz / 2)) + Vector(c)
    return deform(bm, f)

def subdivide(ob, cuts=8):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=cuts, use_grid_fill=True)
    bm.to_mesh(ob.data); bm.free()
    return ob

def quad_legs(rt, mat, hips, top, r1, r2, col, hoof=None, hoof_h=0.05):
    """Four separate legs (LegFL, LegFR, LegBL, LegBR) pivoting at the hip, like the fox, so the game can swing them."""
    for nm, (x, y) in hips.items():
        lg = limb_bm((x, y, top), (x, y, 0.02), r1, r2, 10)
        lo = from_bm(lg, nm, mat, parent=rt, origin=(x, y, top))
        paint(lo, (lambda p, n: hoof if p.z < hoof_h else col) if hoof else solid(col))

def build_sunflower():
    clear()
    rt = root("Sunflower")
    H = 1.35
    pts = [Vector((0, -0.05 * (i / 6) ** 2, H * i / 6)) for i in range(7)]
    st = merge_bms([limb_bm(pts[i], pts[i + 1], 0.017 - 0.0016 * i, 0.017 - 0.0016 * (i + 1), 7, caps=False) for i in range(6)])
    so = from_bm(st, "Stem", material("Plant", rough=0.7), parent=rt)
    paint(so, lambda p, n: scl((0.3, 0.5, 0.15), 0.85 + 0.15 * noise.noise(p * 30)))
    lv = []
    for i in range(6):
        z, a, L = 0.22 + i * 0.16, i * 2.4, 0.2 - i * 0.018
        lb = sphere_bm(1, 8, 4)
        def lf(v, L=L):
            w = max(0.0, 1 - abs(v.y)) ** 0.7
            return Vector((v.x * L * 0.55 * w, (v.y + 1) * L * 0.5, v.z * 0.004 - 0.1 * L * (v.y + 1) ** 2))
        deform(lb, lf)
        xform(lb, Matrix.Translation((0, 0, z)) @ Matrix.Rotation(a, 4, 'Z') @ Euler((-0.3, 0, 0)).to_matrix().to_4x4())
        lv.append(lb)
    lo = from_bm(merge_bms(lv), "SunLeaves", material("Plant", rough=0.7), parent=rt)
    paint(lo, lambda p, n: scl((0.22, 0.45, 0.12), 0.85 + 0.2 * noise.noise(p * 20)))
    head = Matrix.Translation((0, -0.08, H + 0.02)) @ Euler((math.pi / 2 + 0.3, 0, 0)).to_matrix().to_4x4()
    disc = sphere_bm(1, 14, 6)
    deform(disc, lambda v: Vector((v.x * 0.1, v.y * 0.1, v.z * 0.028)))
    xform(disc, head)
    do = from_bm(disc, "Disc", material("Seeds", rough=0.9), parent=rt)
    paint(do, lambda p, n: scl((0.28, 0.16, 0.07), 0.75 + 0.35 * (0.5 + 0.5 * math.sin(p.x * 180) * math.sin(p.z * 180))))
    bm = bmesh.new()
    for ring, (rt_, rv, off, z) in enumerate(((0.2, 0.09, 0.0, -0.004), (0.17, 0.08, 0.5, -0.008))):
        c = bm.verts.new((0, 0, z))
        vs = []
        for i in range(44):
            a = (i + off * 2) / 44 * math.tau
            r = rt_ if i % 2 == 0 else rv
            vs.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z - (0.03 if i % 2 == 0 else 0.0))))
        for i in range(44):
            bm.faces.new((c, vs[i], vs[(i + 1) % 44]))
    xform(bm, head)
    po = from_bm(bm, "Petals", material("Petal", rough=0.6), parent=rt, smooth_shade=False)
    paint(po, lambda p, n: mix((1.0, 0.72, 0.05), (1.0, 0.86, 0.25), noise.noise(p * 60) * 0.5 + 0.5))
    export("Sunflower")

def build_barn():
    clear()
    rt = root("Barn")
    W, D, Hw = 8.0, 6.0, 3.2
    RED = (0.62, 0.13, 0.09)
    wo = from_bm(box_bm(W, D, Hw, (0, 0, Hw / 2)), "BarnWalls", material("BarnWall", rough=0.85), parent=rt, smooth_shade=False)
    subdivide(wo, 14)
    def boards(p, n):
        u = p.x if abs(n.y) > 0.5 else p.y
        k = 0.82 + 0.18 * (0.5 + 0.5 * math.sin(u * 22)) * (0.9 + 0.1 * noise.noise(p * 4))
        if p.z < 0.35:
            return scl((0.55, 0.53, 0.5), 0.85 + 0.15 * noise.noise(p * 6))
        return scl(RED, k)
    paint(wo, boards)
    prof = [(-W / 2 - 0.35, Hw - 0.15), (-W / 2 + 1.2, Hw + 1.9), (0, Hw + 3.1), (W / 2 - 1.2, Hw + 1.9), (W / 2 + 0.35, Hw - 0.15)]
    bm = bmesh.new()
    y0, y1 = -D / 2 - 0.45, D / 2 + 0.45
    for (xa, za), (xb, zb) in zip(prof, prof[1:]):
        v = [bm.verts.new((xa, y0, za)), bm.verts.new((xb, y0, zb)), bm.verts.new((xb, y1, zb)), bm.verts.new((xa, y1, za))]
        bm.faces.new(v)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=8, use_grid_fill=True)
    sol = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    bmesh.ops.translate(bm, vec=(0, 0, 0.14), verts=[e for e in sol["geom"] if isinstance(e, bmesh.types.BMVert)])
    bm.normal_update()
    ro = from_bm(bm, "BarnRoof", material("Roof", rough=0.8), parent=rt, smooth_shade=False)
    paint(ro, lambda p, n: scl((0.32, 0.33, 0.36), 0.75 + 0.25 * (0.5 + 0.5 * math.sin(p.z * 30 + p.x * 3)) * (0.9 + 0.1 * noise.noise(p * 5))))
    gb = bmesh.new()
    inner = [(-W / 2, Hw), (-W / 2 + 1.2, Hw + 1.85), (0, Hw + 3.0), (W / 2 - 1.2, Hw + 1.85), (W / 2, Hw)]
    for y in (-D / 2, D / 2):
        vs = [gb.verts.new((x, y, z)) for x, z in inner]
        gb.faces.new(vs if y > 0 else list(reversed(vs)))
    bmesh.ops.subdivide_edges(gb, edges=gb.edges, cuts=10, use_grid_fill=True)
    go = from_bm(gb, "Gables", material("BarnWall", rough=0.85), parent=rt, smooth_shade=False)
    paint(go, lambda p, n: scl(RED, 0.82 + 0.18 * (0.5 + 0.5 * math.sin(p.x * 22))))
    door = box_bm(2.8, 0.12, 2.8, (0, -D / 2 - 0.06, 1.4))
    loft = box_bm(1.3, 0.1, 1.2, (0, -D / 2 - 0.05, Hw + 1.2))
    dro = from_bm(merge_bms([door, loft]), "BarnDoors", material("Wood", rough=0.8), parent=rt, smooth_shade=False)
    paint(dro, lambda p, n: scl((0.48, 0.1, 0.07), 0.8 + 0.2 * (0.5 + 0.5 * math.sin(p.x * 26))))
    tr = []
    for x in (-1.4, 1.4):
        tr.append(box_bm(0.14, 0.14, 2.9, (x, -D / 2 - 0.1, 1.45)))
    tr.append(box_bm(2.95, 0.14, 0.14, (0, -D / 2 - 0.1, 2.85)))
    for s in (1, -1):   # the white X on the doors
        b = box_bm(0.12, 0.08, 3.6, (0, 0, 0))
        xform(b, Matrix.Translation((0, -D / 2 - 0.14, 1.4)) @ Matrix.Rotation(s * 0.78, 4, 'Y'))
        tr.append(b)
    for x in (-0.7, 0.7):
        tr.append(box_bm(0.1, 0.1, 1.3, (x, -D / 2 - 0.09, Hw + 1.2)))
    tr += [box_bm(1.5, 0.1, 0.1, (0, -D / 2 - 0.09, Hw + 1.85)), box_bm(1.5, 0.1, 0.1, (0, -D / 2 - 0.09, Hw + 0.6))]
    for sx in (1, -1):
        for sy in (1, -1):
            tr.append(box_bm(0.16, 0.16, Hw, (sx * W / 2, sy * D / 2, Hw / 2)))
    to = from_bm(merge_bms(tr), "BarnTrim", material("Trim", rough=0.6), parent=rt, smooth_shade=False)
    paint(to, solid((0.95, 0.94, 0.9)))
    export("Barn")

def build_shop():
    clear()
    rt = root("Shop")
    W, D, H = 6.0, 5.0, 5.6
    fo = from_bm(box_bm(W, D, H, (0, 0, H / 2)), "Facade", material("Facade", rough=0.9), parent=rt, smooth_shade=False)
    subdivide(fo, 16)
    def brick(p, n):
        row = int(math.floor(p.z * 7))
        u = (p.x if abs(n.y) > 0.5 else p.y) * 3.5 + (0.5 if row % 2 else 0)
        mortar = (p.z * 7) % 1 < 0.12 or u % 1 < 0.07
        c = 0.72 if mortar else 0.9 + 0.1 * noise.noise(Vector((math.floor(u), row, 0)) * 0.7)
        return (c, c * 0.97, c * 0.93)
    paint(fo, brick)
    par = [box_bm(W + 0.3, 0.3, 0.5, (0, -D / 2 + 0.05, H + 0.2)), box_bm(W + 0.4, 0.4, 0.14, (0, -D / 2, H - 0.05)), box_bm(W + 0.2, 0.25, 0.25, (0, -D / 2 - 0.05, 2.95))]
    frames = []
    for x in (-1.5, 1.5):   # upper windows
        frames += [box_bm(1.2, 0.12, 0.1, (x, -D / 2 - 0.04, 3.45)), box_bm(1.2, 0.12, 0.1, (x, -D / 2 - 0.04, 4.75)), box_bm(0.1, 0.12, 1.4, (x - 0.55, -D / 2 - 0.04, 4.1)), box_bm(0.1, 0.12, 1.4, (x + 0.55, -D / 2 - 0.04, 4.1))]
    frames += [box_bm(3.6, 0.14, 0.12, (-0.9, -D / 2 - 0.05, 0.45)), box_bm(0.12, 0.14, 2.0, (-2.7, -D / 2 - 0.05, 1.45)), box_bm(0.12, 0.14, 2.0, (0.9, -D / 2 - 0.05, 1.45)),
               box_bm(0.12, 0.14, 2.3, (1.35, -D / 2 - 0.05, 1.15)), box_bm(0.12, 0.14, 2.3, (2.45, -D / 2 - 0.05, 1.15))]
    tro = from_bm(merge_bms(par + frames), "ShopTrim", material("Trim", rough=0.6), parent=rt, smooth_shade=False)
    paint(tro, solid((0.95, 0.95, 0.92)))
    wins = [box_bm(3.5, 0.06, 1.95, (-0.9, -D / 2 - 0.02, 1.47))] + [box_bm(1.0, 0.06, 1.2, (x, -D / 2 - 0.02, 4.1)) for x in (-1.5, 1.5)]
    wo = from_bm(merge_bms(wins), "ShopWindows", material("Glass", rough=0.05, spec=1.0, emit=(1.0, 0.8, 0.45), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(wo, lambda p, n: (0.3, 0.38, 0.45) if p.z > 0.8 else (0.22, 0.28, 0.34))
    do = from_bm(box_bm(1.0, 0.08, 2.2, (1.9, -D / 2 - 0.02, 1.1)), "ShopDoor", material("Wood", rough=0.7), parent=rt, smooth_shade=False)
    paint(do, lambda p, n: (0.2, 0.3, 0.42) if 1.3 < p.z < 2.0 and abs(p.x - 1.9) < 0.3 else (0.18, 0.28, 0.2))
    # striped awning, tintable: the stripes are painted light so a tint colours them
    bm = bmesh.new()
    y0, y1, z0, z1 = -D / 2, -D / 2 - 1.3, 2.95, 2.45
    cols = 16
    grid = [[bm.verts.new((-W / 2 + 0.2 + (W - 0.4) * i / cols, y0 + (y1 - y0) * j, z0 + (z1 - z0) * j)) for j in (0, 1)] for i in range(cols + 1)]
    for i in range(cols):
        bm.faces.new((grid[i][0], grid[i + 1][0], grid[i + 1][1], grid[i][1]))
    for i in range(cols):   # valance
        a, b = grid[i][1], grid[i + 1][1]
        c, d = bm.verts.new((b.co.x, b.co.y, b.co.z - 0.3)), bm.verts.new((a.co.x, a.co.y, a.co.z - 0.3))
        bm.faces.new((a, b, c, d))
    ao = from_bm(bm, "Awning", material("Cloth", rough=0.8), parent=rt, smooth_shade=False)
    paint(ao, lambda p, n: (0.97, 0.97, 0.97) if int((p.x + W) / (W - 0.4) * cols) % 2 == 0 else (0.62, 0.62, 0.62))
    export("Shop")

def build_lamppost():
    clear()
    rt = root("LampPost")
    parts = [limb_bm((0, 0, 0.0), (0, 0, 2.5), 0.05, 0.035, 12, caps=False), cone_bm(0.12, 0.06, 0.35, 12)]
    xform(parts[1], Matrix.Translation((0, 0, 0.17)))
    cap = cone_bm(0.2, 0.02, 0.2, 8); xform(cap, Matrix.Translation((0, 0, 2.95)))
    ring = cone_bm(0.1, 0.14, 0.06, 8); xform(ring, Matrix.Translation((0, 0, 2.55)))
    io = from_bm(merge_bms(parts + [cap, ring]), "Post", material("Iron", rough=0.5, metal=0.6), parent=rt)
    paint(io, solid((0.12, 0.16, 0.14)))
    lamp = cone_bm(0.1, 0.15, 0.32, 8); xform(lamp, Matrix.Translation((0, 0, 2.74)))
    lo = from_bm(lamp, "Lantern", material("Lamp", rough=0.2, emit=(1.0, 0.8, 0.45), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(lo, solid((1.0, 0.93, 0.75)))
    export("LampPost")

def build_bench():
    clear()
    rt = root("Bench")
    sl = [box_bm(1.6, 0.1, 0.035, (0, -0.16 + i * 0.12, 0.45)) for i in range(3)]
    for i in range(3):
        b = box_bm(1.6, 0.035, 0.09, (0, 0, 0))
        xform(b, Matrix.Translation((0, 0.2 + i * 0.02, 0.6 + i * 0.12)) @ Matrix.Rotation(-0.25, 4, 'X'))
        sl.append(b)
    wo = from_bm(merge_bms(sl), "Slats", material("Wood", rough=0.8), parent=rt, smooth_shade=False)
    paint(wo, lambda p, n: scl((0.55, 0.36, 0.2), 0.85 + 0.15 * math.sin(p.x * 30)))
    fr = []
    for x in (-0.7, 0.7):
        fr += [limb_bm((x, -0.18, 0.0), (x, -0.18, 0.45), 0.02, 0.02, 6, caps=False), limb_bm((x, 0.2, 0.0), (x, 0.26, 0.9), 0.02, 0.02, 6, caps=False),
               limb_bm((x, -0.2, 0.44), (x, 0.22, 0.44), 0.018, 0.018, 6, caps=False), limb_bm((x, -0.2, 0.62), (x, 0.0, 0.62), 0.015, 0.015, 6, caps=False)]
    io = from_bm(merge_bms(fr), "BenchIron", material("Iron", rough=0.5, metal=0.6), parent=rt)
    paint(io, solid((0.1, 0.12, 0.1)))
    export("Bench")

def build_goat():
    clear()
    rt = root("Goat")
    FUR = (0.9, 0.86, 0.78)
    fur = material("GoatFur", rough=0.9)
    b = sphere_bm(1, 22, 14)
    deform(b, lambda v: Vector((v.x * 0.16 * (1 - 0.1 * v.y), v.y * 0.34, v.z * 0.17)) + Vector((0, 0, 0.55)))
    bo = from_bm(b, "GoatBody", fur, parent=rt)
    paint(bo, lambda p, n: mix(FUR, (0.45, 0.3, 0.18), smooth(0.2, 0.45, noise.noise(p * 5)) * 0.9))
    nk = limb_bm((0, -0.24, 0.62), (0, -0.36, 0.8), 0.075, 0.06, 12)
    hd = sphere_bm(1, 16, 10)
    deform(hd, lambda v: Vector((v.x * 0.065, v.y * 0.13, v.z * 0.075)))
    xform(hd, Matrix.Translation((0, -0.45, 0.82)) @ Euler((0.5, 0, 0)).to_matrix().to_4x4())
    ears = []
    for sx in (1, -1):
        e = sphere_bm(1, 8, 5)
        deform(e, lambda v: Vector((v.x * 0.06, v.y * 0.02, v.z * 0.022)))
        xform(e, Matrix.Translation((sx * 0.1, -0.4, 0.86)) @ Euler((0, sx * 0.3, 0)).to_matrix().to_4x4())
        ears.append(e)
    beard = cone_bm(0.02, 0.002, 0.08, 6); xform(beard, Matrix.Translation((0, -0.52, 0.72)) @ Euler((math.pi, 0, 0)).to_matrix().to_4x4())
    tail = cone_bm(0.025, 0.005, 0.08, 6); xform(tail, Matrix.Translation((0, 0.34, 0.66)) @ Euler((-0.6, 0, 0)).to_matrix().to_4x4())
    ho = from_bm(merge_bms([nk, hd, beard, tail] + ears), "GoatHead", fur, parent=rt)
    paint(ho, lambda p, n: (0.55, 0.45, 0.35) if p.z < 0.75 and p.y < -0.48 else FUR)
    horns = []
    for sx in (1, -1):
        pts = [Vector((sx * 0.03, -0.42 + 0.06 * t, 0.9 + 0.1 * math.sin(t * 1.4))) for t in (0, 0.5, 1.0, 1.5)]
        horns += [limb_bm(pts[i], pts[i + 1], 0.016 - i * 0.004, 0.012 - i * 0.004, 6) for i in range(3)]
    hno = from_bm(merge_bms(horns), "Horns", material("Horn", rough=0.5), parent=rt)
    paint(hno, solid((0.45, 0.4, 0.33)))
    eo = from_bm(merge_bms([xform(sphere_bm(0.014, 8, 6), Matrix.Translation((sx * 0.055, -0.47, 0.86))) for sx in (1, -1)]), "GoatEyes", material("Eye", rough=0.05, spec=0.9), parent=rt)
    paint(eo, solid((0.05, 0.04, 0.03)))
    quad_legs(rt, fur, {"LegFL": (-0.08, -0.2), "LegFR": (0.08, -0.2), "LegBL": (-0.08, 0.22), "LegBR": (0.08, 0.22)}, 0.48, 0.035, 0.025, FUR, (0.25, 0.2, 0.15))
    export("Goat")

def build_sheep():
    clear()
    rt = root("Sheep")
    WOOL, SKIN = (0.94, 0.92, 0.86), (0.16, 0.13, 0.12)
    wool = material("Wool", rough=1.0)
    blobs = []
    for i in range(16):
        a = i / 16 * math.tau
        for zz in (-0.08, 0.06):
            s = sphere_bm(0.1 + 0.02 * math.sin(i * 1.7), 10, 7)
            xform(s, Matrix.Translation((math.cos(a) * 0.13, math.sin(a) * 0.26 + 0.02, 0.56 + zz + 0.03 * math.cos(a * 3))))
            blobs.append(s)
    core = sphere_bm(1, 16, 10); deform(core, lambda v: Vector((v.x * 0.18, v.y * 0.32, v.z * 0.17)) + Vector((0, 0.02, 0.56)))
    blobs.append(core)
    wo = from_bm(merge_bms(blobs), "Fleece", wool, parent=rt)
    paint(wo, lambda p, n: scl(WOOL, 0.86 + 0.14 * noise.noise(p * 25)))
    hd = sphere_bm(1, 14, 9)
    deform(hd, lambda v: Vector((v.x * 0.07, v.y * 0.11, v.z * 0.075)))
    xform(hd, Matrix.Translation((0, -0.36, 0.66)) @ Euler((0.45, 0, 0)).to_matrix().to_4x4())
    ears = []
    for sx in (1, -1):
        e = sphere_bm(1, 8, 5); deform(e, lambda v: Vector((v.x * 0.06, v.y * 0.025, v.z * 0.018)))
        xform(e, Matrix.Translation((sx * 0.09, -0.31, 0.7)) @ Euler((0, sx * -0.4, 0)).to_matrix().to_4x4()); ears.append(e)
    ho = from_bm(merge_bms([hd] + ears), "SheepFace", material("SheepSkin", rough=0.8), parent=rt)
    paint(ho, solid(SKIN))
    tuft = sphere_bm(0.07, 10, 7); xform(tuft, Matrix.Translation((0, -0.33, 0.74)))
    to = from_bm(tuft, "Tuft", wool, parent=rt)
    paint(to, solid(WOOL))
    eo = from_bm(merge_bms([xform(sphere_bm(0.012, 8, 6), Matrix.Translation((sx * 0.05, -0.41, 0.69))) for sx in (1, -1)]), "SheepEyes", material("Eye", rough=0.05, spec=0.9), parent=rt)
    paint(eo, solid((0.9, 0.85, 0.7)))
    quad_legs(rt, material("SheepSkin", rough=0.8), {"LegFL": (-0.08, -0.17), "LegFR": (0.08, -0.17), "LegBL": (-0.08, 0.2), "LegBR": (0.08, 0.2)}, 0.44, 0.028, 0.022, SKIN)
    export("Sheep")

def build_duck():
    clear()
    rt = root("Duck")
    b = sphere_bm(1, 18, 12)
    deform(b, lambda v: Vector((v.x * 0.085, v.y * 0.15 * (1 + 0.15 * v.y), v.z * 0.075 * (1 - 0.25 * max(0, v.y)))) + Vector((0, 0.02, 0.06)))
    tail = cone_bm(0.04, 0.005, 0.08, 8); xform(tail, Matrix.Translation((0, 0.17, 0.1)) @ Euler((-1.0, 0, 0)).to_matrix().to_4x4())
    nk = limb_bm((0, -0.08, 0.1), (0, -0.12, 0.2), 0.035, 0.03, 10)
    hd = sphere_bm(0.05, 14, 9); xform(hd, Matrix.Translation((0, -0.13, 0.23)))
    fo = from_bm(merge_bms([b, tail, nk, hd]), "DuckBody", material("Feather", rough=0.85), parent=rt)
    paint(fo, lambda p, n: scl((0.97, 0.96, 0.93), 0.9 + 0.1 * noise.noise(p * 30)))
    bill = sphere_bm(1, 10, 6); deform(bill, lambda v: Vector((v.x * 0.025, v.y * 0.045, v.z * 0.011)))
    xform(bill, Matrix.Translation((0, -0.19, 0.22)))
    bo = from_bm(bill, "Bill", material("Bill", rough=0.4), parent=rt)
    paint(bo, solid((1.0, 0.6, 0.1)))
    eo = from_bm(merge_bms([xform(sphere_bm(0.009, 8, 6), Matrix.Translation((sx * 0.035, -0.15, 0.245))) for sx in (1, -1)]), "DuckEyes", material("Eye", rough=0.05, spec=0.9), parent=rt)
    paint(eo, solid((0.03, 0.03, 0.03)))
    export("Duck")

def build_car():
    clear()
    rt = root("Car")
    L, Wd = 3.9, 1.72
    body = rbox_bm(Wd, L, 0.62, (0, 0, 0.62), e=0.22, u=28, v=16)
    roof = rbox_bm(Wd - 0.22, L * 0.5, 0.1, (0, 0.18, 1.42), e=0.3, u=20, v=8)
    pil = [box_bm(0.08, 0.1, 0.5, (sx * (Wd / 2 - 0.16), y, 1.16)) for sx in (1, -1) for y in (-0.72, 0.18, 1.06)]
    po = from_bm(merge_bms([body, roof] + pil), "CarBody", material("CarPaint", rough=0.35, metal=0.2, spec=0.7), parent=rt)
    paint(po, solid((0.92, 0.92, 0.92)))
    cab = rbox_bm(Wd - 0.3, L * 0.48, 0.52, (0, 0.18, 1.15), e=0.35, u=20, v=10)
    go = from_bm(cab, "CarWindows", material("CarGlass", rough=0.1, spec=0.9), parent=rt)
    paint(go, solid((0.12, 0.16, 0.2)))
    wh = []
    for sx in (1, -1):
        for sy in (1, -1):
            w = cone_bm(0.34, 0.34, 0.24, 18)
            xform(w, Matrix.Translation((sx * (Wd / 2 - 0.1), sy * 1.25, 0.34)) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4())
            wh.append(w)
    wo = from_bm(merge_bms(wh), "Wheels", material("Tire", rough=0.9), parent=rt)
    paint(wo, lambda p, n: (0.7, 0.7, 0.72) if abs(n.x) > 0.8 and math.hypot(p.y - math.copysign(1.25, p.y), p.z - 0.34) < 0.16 else (0.08, 0.08, 0.08))
    ch = [box_bm(Wd - 0.1, 0.14, 0.16, (0, -L / 2 - 0.02, 0.45)), box_bm(Wd - 0.1, 0.14, 0.16, (0, L / 2 + 0.02, 0.45))]
    cho = from_bm(merge_bms(ch), "Bumpers", material("Chrome", rough=0.2, metal=1.0), parent=rt, smooth_shade=False)
    paint(cho, solid((0.8, 0.8, 0.82)))
    li = [box_bm(0.3, 0.06, 0.14, (sx * 0.6, -L / 2 + 0.03, 0.72)) for sx in (1, -1)] + [box_bm(0.3, 0.06, 0.12, (sx * 0.6, L / 2 - 0.03, 0.72)) for sx in (1, -1)]
    lo = from_bm(merge_bms(li), "Lights", material("Light", rough=0.2, emit=(1.0, 0.9, 0.7), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(lo, lambda p, n: (1.0, 0.97, 0.85) if p.y < 0 else (0.9, 0.1, 0.08))
    export("Car")

def build_cattail():
    clear()
    rt = root("Cattail")
    bl = []
    for i in range(9):
        a = random.random() * math.tau
        bl.append(grass_blade(random.uniform(0.5, 0.9), 0.03, random.uniform(0.05, 0.2), a, (math.cos(a) * 0.05, math.sin(a) * 0.05, 0), 0.4))
    st = []
    for i in range(3):
        x, y, h = random.uniform(-0.06, 0.06), random.uniform(-0.06, 0.06), random.uniform(0.75, 1.0)
        st.append(limb_bm((x, y, 0), (x * 1.5, y * 1.5, h), 0.006, 0.005, 6, caps=False))
        st.append(limb_bm((x * 1.5, y * 1.5, h + 0.02), (x * 1.5, y * 1.5, h + 0.16), 0.022, 0.02, 10))
    go = from_bm(merge_bms(bl), "Reeds", material("Plant", rough=0.7), parent=rt)
    paint(go, lambda p, n: mix((0.25, 0.4, 0.12), (0.55, 0.62, 0.3), smooth(0, 0.9, p.z)))
    so = from_bm(merge_bms(st), "Spikes", material("Cattail", rough=0.9), parent=rt)
    paint(so, lambda p, n: (0.38, 0.22, 0.1) if p.z > 0.76 else (0.3, 0.42, 0.15))
    export("Cattail")

def build_umbrella():
    clear()
    rt = root("Umbrella")
    po = from_bm(limb_bm((0, 0, -0.2), (0, 0, 2.1), 0.025, 0.02, 8), "Pole", material("Wood", rough=0.7), parent=rt)
    paint(po, solid((0.9, 0.88, 0.84)))
    bm = bmesh.new()
    tip = bm.verts.new((0, 0, 2.25))
    n = 16
    rim = [bm.verts.new((math.cos(i / n * math.tau) * 1.2, math.sin(i / n * math.tau) * 1.2, 1.85)) for i in range(n)]
    for i in range(n):
        bm.faces.new((tip, rim[i], rim[(i + 1) % n]))
    co = from_bm(bm, "Canopy", material("Cloth", rough=0.8), parent=rt, smooth_shade=False)
    paint(co, lambda p, n: (0.95, 0.95, 0.93) if int((math.atan2(p.y, p.x) + math.pi) / math.tau * 8) % 2 else (0.9, 0.2, 0.2))
    export("Umbrella")

def build_sandcastle():
    clear()
    rt = root("Sandcastle")
    parts = [box_bm(0.7, 0.7, 0.18, (0, 0, 0.09))]
    for sx in (1, -1):
        for sy in (1, -1):
            t = cone_bm(0.13, 0.1, 0.32, 10); xform(t, Matrix.Translation((sx * 0.32, sy * 0.32, 0.16))); parts.append(t)
    c = cone_bm(0.16, 0.12, 0.5, 12); xform(c, Matrix.Translation((0, 0, 0.3))); parts.append(c)
    for i in range(6):
        a = i / 6 * math.tau
        parts.append(box_bm(0.05, 0.05, 0.06, (math.cos(a) * 0.1, math.sin(a) * 0.1, 0.58)))
    so = from_bm(merge_bms(parts), "Castle", material("Sand", rough=1.0), parent=rt, smooth_shade=False)
    paint(so, lambda p, n: scl((0.88, 0.76, 0.52), 0.85 + 0.15 * noise.noise(p * 30)))
    fl = [limb_bm((0, 0, 0.6), (0, 0, 0.85), 0.004, 0.004, 5, caps=False), box_bm(0.004, 0.1, 0.06, (0, 0.05, 0.81))]
    fo = from_bm(merge_bms(fl), "Flag", material("Cloth", rough=0.8), parent=rt, smooth_shade=False)
    paint(fo, lambda p, n: (0.9, 0.2, 0.2) if p.y > 0.005 else (0.8, 0.8, 0.8))
    export("Sandcastle")

def build_scarecrow():
    clear()
    rt = root("Scarecrow")
    wd = [limb_bm((0, 0, 0), (0, 0, 1.9), 0.04, 0.035, 8, caps=False), limb_bm((-0.75, 0, 1.4), (0.75, 0, 1.4), 0.03, 0.03, 8, caps=False)]
    wo = from_bm(merge_bms(wd), "Post", material("Wood", rough=0.8), parent=rt)
    paint(wo, solid((0.45, 0.32, 0.2)))
    sh = rbox_bm(0.62, 0.26, 0.6, (0, 0, 1.3), e=0.5, u=16, v=10)
    sl = [limb_bm((sx * 0.25, 0, 1.45), (sx * 0.7, 0, 1.4), 0.08, 0.07, 10) for sx in (1, -1)]
    pa = rbox_bm(0.5, 0.24, 0.5, (0, 0, 0.85), e=0.5, u=16, v=10)
    so = from_bm(merge_bms([sh, pa] + sl), "Clothes", material("Cloth", rough=0.9), parent=rt)
    paint(so, lambda p, n: ((0.75, 0.2, 0.15) if (int(p.x * 12) + int(p.z * 12)) % 2 else (0.55, 0.12, 0.1)) if p.z > 1.0 else (0.25, 0.35, 0.55))
    hd = sphere_bm(0.16, 14, 10); xform(hd, Matrix.Translation((0, 0, 1.78)))
    ho = from_bm(hd, "Sack", material("Sack", rough=1.0), parent=rt)
    paint(ho, lambda p, n: (0.1, 0.08, 0.06) if n.y < -0.6 and abs(p.x) > 0.03 and abs(p.x) < 0.09 and p.z > 1.8 else (0.8, 0.7, 0.5))
    hat = [cone_bm(0.3, 0.3, 0.02, 16), cone_bm(0.15, 0.1, 0.18, 12)]
    xform(hat[0], Matrix.Translation((0, 0, 1.9))); xform(hat[1], Matrix.Translation((0, 0, 1.99)))
    st = []
    for i in range(10):
        a = i / 10 * math.tau
        st.append(cone_bm(0.015, 0.0, 0.14, 4))
        xform(st[-1], Matrix.Translation((math.cos(a) * 0.3, math.sin(a) * 0.1 - 0.1, 1.4)) @ Euler((0, math.cos(a) * 1.5, 0)).to_matrix().to_4x4())
    hao = from_bm(merge_bms(hat + st), "Straw", material("Straw", rough=0.9), parent=rt)
    paint(hao, lambda p, n: scl((0.85, 0.72, 0.35), 0.85 + 0.15 * noise.noise(p * 40)))
    export("Scarecrow")

def build_fountain():
    clear()
    rt = root("Fountain")
    bm = bmesh.new()
    n, R1, R2, H = 32, 1.7, 1.45, 0.5
    def ringv(r, z):
        return [bm.verts.new((math.cos(i / n * math.tau) * r, math.sin(i / n * math.tau) * r, z)) for i in range(n)]
    o0, o1, i1, i0 = ringv(R1, 0), ringv(R1, H), ringv(R2, H), ringv(R2, 0.15)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((o0[i], o0[j], o1[j], o1[i])); bm.faces.new((o1[i], o1[j], i1[j], i1[i])); bm.faces.new((i1[i], i1[j], i0[j], i0[i]))
    ped = cone_bm(0.22, 0.16, 1.1, 16); xform(ped, Matrix.Translation((0, 0, 0.6)))
    bowl = cone_bm(0.2, 0.7, 0.25, 24); xform(bowl, Matrix.Translation((0, 0, 1.2)))
    top = cone_bm(0.08, 0.05, 0.5, 10); xform(top, Matrix.Translation((0, 0, 1.5)))
    so = from_bm(merge_bms([bm, ped, bowl, top]), "Stone", material("Stone", rough=0.9), parent=rt)
    paint(so, lambda p, n: scl((0.72, 0.7, 0.66), 0.85 + 0.15 * noise.noise(p * 8)))
    w1 = cone_bm(R2, R2, 0.02, 32); xform(w1, Matrix.Translation((0, 0, 0.4)))
    w2 = cone_bm(0.66, 0.66, 0.02, 24); xform(w2, Matrix.Translation((0, 0, 1.3)))
    wo = from_bm(merge_bms([w1, w2]), "FountainWater", material("Water", rough=0.05, spec=1.0), parent=rt)
    paint(wo, solid((0.35, 0.6, 0.75)))
    export("Fountain")

# ================================================================ ZONE TREATS: a signature treat for each zone, and the spot it is foraged from
def ring_sector_bm(r0, r1, a0, a1, z0, z1, seg=12):
    """A slab shaped like a slice of a ring: r0..r1 between angles a0..a1, from z0 up to z1."""
    bm = bmesh.new()
    def ring(r, z):
        return [bm.verts.new((math.cos(a0 + (a1 - a0) * i / seg) * r, math.sin(a0 + (a1 - a0) * i / seg) * r, z)) for i in range(seg + 1)]
    ib, ob, it, ot = ring(r0, z0), ring(r1, z0), ring(r0, z1), ring(r1, z1)
    for i in range(seg):
        j = i + 1
        bm.faces.new((it[i], ot[i], ot[j], it[j]))
        bm.faces.new((ib[j], ob[j], ob[i], ib[i]))
        bm.faces.new((ob[i], ob[j], ot[j], ot[i]))
        bm.faces.new((ib[j], ib[i], it[i], it[j]))
    bm.faces.new((ib[0], ob[0], ot[0], it[0]))
    bm.faces.new((it[seg], ot[seg], ob[seg], ib[seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def revolve_bm(prof, a0, a1, seg=12):
    """The skin of a profile [(r, z), ...] turned about z from angle a0 to a1."""
    bm = bmesh.new()
    rows = [[bm.verts.new((math.cos(a0 + (a1 - a0) * i / seg) * r, math.sin(a0 + (a1 - a0) * i / seg) * r, z)) for i in range(seg + 1)] for r, z in prof]
    for k in range(len(prof) - 1):
        for i in range(seg):
            bm.faces.new((rows[k][i], rows[k][i + 1], rows[k + 1][i + 1], rows[k + 1][i]))
    return bm

def wedge_caps_bm(prof, a0, a1):
    """The two flat cut faces of a wedge of a turned profile (the axis out to the profile at a0 and at a1)."""
    bm = bmesh.new()
    for a in (a0, a1):
        axis = [bm.verts.new((0, 0, z)) for r, z in prof]
        edge = [bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)) for r, z in prof]
        for k in range(len(prof) - 1):
            bm.faces.new((axis[k], edge[k], edge[k + 1], axis[k + 1]))
    return bm

def leaf_bm(L, W, serr=0, curl=0.0, thick=0.002, u=12, v=6):
    """A flat leaf along +y from the origin: L long, W wide, optionally serrated and curled up at the sides."""
    lb = sphere_bm(1, u, v)
    def f(p):
        w = max(0.0, 1 - abs(p.y)) ** 0.7 * (1 + (0.12 * math.sin(p.y * serr * math.pi) if serr else 0))
        x = p.x * W * 0.5 * w
        return Vector((x, (p.y + 1) * L * 0.5, p.z * thick + curl * (x / max(W, 1e-4)) ** 2 * W))
    return deform(lb, f)

def raspberry_bm(c, r=0.012, u=8, v=5):
    """A raspberry: a cone of little drupelets."""
    parts = []
    for k in range(4):
        z = r * (1.1 - k * 0.55)
        n = [1, 6, 8, 7][k]
        rr = [0.0, r * 0.6, r * 0.75, r * 0.55][k]
        for i in range(n):
            a = i / n * math.tau + k
            s = sphere_bm(r * 0.42, u, v)
            xform(s, Matrix.Translation(Vector(c) + Vector((math.cos(a) * rr, math.sin(a) * rr, z))))
            parts.append(s)
    return merge_bms(parts)

def build_rosehip():
    clear()
    rt = root("RoseHip")
    tw = [limb_bm((-0.045, 0, 0.008), (0.04, 0.004, 0.012), 0.0035, 0.0025, 6)]
    hips, crowns = [], []
    for i, (x, y, a) in enumerate(((0.035, 0.0, 0.2), (0.008, 0.022, 1.7), (-0.016, -0.02, -1.4))):
        d = Vector((math.cos(a), math.sin(a), 0.5)).normalized()
        base = Vector((x - d.x * 0.012, y - d.y * 0.012, 0.012))
        tw.append(limb_bm(base - d * 0.012, base, 0.0018, 0.0015, 5, caps=False))
        h = sphere_bm(1, 14, 10)
        deform(h, lambda v: Vector((v.x * 0.0115, v.y * 0.0115, v.z * 0.017)))
        m = Matrix.Translation(base + d * 0.016) @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
        xform(h, m)
        hips.append(h)
        for k in range(5):
            c = cone_bm(0.002, 0.0, 0.008, 4)
            ka = k / 5 * math.tau
            xform(c, m @ Matrix.Translation((math.cos(ka) * 0.004, math.sin(ka) * 0.004, 0.019)) @ Euler((math.sin(ka) * 0.5, -math.cos(ka) * 0.5, 0)).to_matrix().to_4x4())
            crowns.append(c)
    to = from_bm(merge_bms(tw + crowns), "Twig", material("Wood", rough=0.8), parent=rt)
    paint(to, lambda p, n: scl((0.32, 0.18, 0.1), 0.85 + 0.15 * noise.noise(p * 300)))
    ho = from_bm(merge_bms(hips), "Hips", material("Veg", rough=0.25, spec=0.8), parent=rt)
    paint(ho, lambda p, n: mix((0.82, 0.12, 0.04), (0.98, 0.42, 0.08), smooth(-0.4, 0.9, n.z) * 0.7 + 0.15 * noise.noise(p * 200)))
    lv = []
    for x, a in ((-0.03, 1.9), (-0.012, -1.3)):
        lb = leaf_bm(0.026, 0.014, serr=6)
        xform(lb, Matrix.Translation((x, 0, 0.01)) @ Matrix.Rotation(a, 4, 'Z') @ Euler((0.3, 0, 0)).to_matrix().to_4x4())
        lv.append(lb)
    lo = from_bm(merge_bms(lv), "HipLeaves", material("Plant", rough=0.7), parent=rt)
    paint(lo, solid((0.22, 0.42, 0.14)))
    export("RoseHip")

def build_raspleaf():
    clear()
    rt = root("RaspLeaf")
    st = [limb_bm((0, -0.05, 0.004), (0, 0.03, 0.01), 0.0025, 0.002, 6)]
    lv = []
    for (x, y, a, L) in ((0, 0.03, 0.0, 0.055), (0, 0.005, 1.25, 0.042), (0, 0.005, -1.25, 0.042)):
        lb = leaf_bm(L, L * 0.62, serr=9, curl=0.25)
        xform(lb, Matrix.Translation((x, y, 0.01)) @ Matrix.Rotation(-a, 4, 'Z') @ Euler((0.15, 0, 0)).to_matrix().to_4x4())
        lv.append(lb)
    so = from_bm(merge_bms(st), "Stalk", material("Wood", rough=0.8), parent=rt)
    paint(so, solid((0.45, 0.25, 0.2)))
    lo = from_bm(merge_bms(lv), "RaspLeaves", material("Plant", rough=0.7), parent=rt)
    def col(p, n):
        vein = abs(math.sin(math.atan2(p.y - 0.03, p.x) * 9)) < 0.15
        c = (0.2, 0.42, 0.13) if n.z > -0.2 else (0.48, 0.58, 0.4)
        return scl(c, 0.85 if vein else 1.0 + 0.1 * noise.noise(p * 200))
    paint(lo, col)
    bo = from_bm(raspberry_bm((0.012, -0.03, 0.006)), "Raspberry", material("Veg", rough=0.35, spec=0.6), parent=rt)
    paint(bo, lambda p, n: scl((0.78, 0.08, 0.16), 0.8 + 0.25 * smooth(-0.5, 1, n.z)))
    export("RaspLeaf")

def build_lettuce():
    clear()
    rt = root("Lettuce")
    lv = []
    for i in range(14):
        a = i * 2.4
        L = 0.12 - 0.04 * (i / 13)
        tilt = 0.3 - 0.25 * (i / 13)
        lb = leaf_bm(L, L * 0.5, serr=4, curl=0.9, thick=0.0025, u=14, v=8)
        deform(lb, lambda v: Vector((v.x * (1 + 0.12 * math.sin(v.y * 160)), v.y, v.z + 0.004 * math.sin(v.y * 90 + v.x * 200))))
        xform(lb, Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, 0.004, 0)) @ Euler((math.pi / 2 - tilt, 0, 0)).to_matrix().to_4x4())
        lv.append(lb)
    lo = from_bm(merge_bms(lv), "Romaine", material("Plant", rough=0.6, spec=0.4), parent=rt)
    def col(p, n):
        r = math.hypot(p.x, p.y)
        c = mix((0.78, 0.9, 0.55), (0.22, 0.52, 0.14), smooth(0.005, 0.03, r) * smooth(0.0, 0.08, p.z + 0.02))
        return scl(c, 0.9 + 0.12 * noise.noise(p * 260))
    paint(lo, col)
    rt.rotation_euler = (0, math.radians(78), 0)
    rt.location = (0.05, 0, 0.03)
    export("Lettuce")

def build_watermelon():
    clear()
    rt = root("Watermelon")
    a0, a1, H, o = -0.55, 0.55, 0.026, (-0.045, 0, 0)
    fl = from_bm(xform(ring_sector_bm(0.0015, 0.062, a0, a1, 0, H, 14), Matrix.Translation(o)), "Flesh", material("Flesh", rough=0.45, spec=0.6), parent=rt)
    paint(fl, lambda p, n: scl((0.93, 0.2, 0.22), 0.88 + 0.12 * noise.noise(p * 240)))
    wb = from_bm(xform(ring_sector_bm(0.062, 0.068, a0, a1, 0, H, 14), Matrix.Translation(o)), "WhiteRind", material("Flesh", rough=0.5), parent=rt)
    paint(wb, solid((0.92, 0.94, 0.78)))
    ri = from_bm(xform(ring_sector_bm(0.068, 0.075, a0, a1, 0, H, 14), Matrix.Translation(o)), "Rind", material("Veg", rough=0.4, spec=0.5), parent=rt)
    paint(ri, lambda p, n: (0.12, 0.38, 0.12) if math.sin(math.atan2(p.y, p.x + 0.045) * 40) > 0.2 else (0.3, 0.55, 0.22))
    seeds = []
    for k, (r, a) in enumerate(((0.03, -0.25), (0.036, 0.1), (0.044, 0.32), (0.026, 0.3), (0.046, -0.12), (0.04, -0.38))):
        for z in (H + 0.0004, -0.0004):
            s = sphere_bm(1, 8, 5)
            deform(s, lambda v: Vector((v.x * 0.0045, v.y * 0.0025, v.z * 0.0012)))
            xform(s, Matrix.Translation((o[0] + math.cos(a) * r, math.sin(a) * r, z)) @ Matrix.Rotation(a, 4, 'Z'))
            seeds.append(s)
    so = from_bm(merge_bms(seeds), "MelonSeeds", material("Seeds", rough=0.4), parent=rt)
    paint(so, solid((0.08, 0.06, 0.05)))
    export("Watermelon")

def build_cress():
    clear()
    rt = root("Cress")
    st, lv = [], []
    for s in range(4):
        a0 = s * 1.6
        base = Vector((math.cos(a0) * 0.012, math.sin(a0) * 0.012, 0))
        top = base + Vector((math.cos(a0) * 0.03, math.sin(a0) * 0.03, 0.045 + 0.01 * (s % 2)))
        st.append(limb_bm(base, top, 0.0022, 0.0018, 6))
        for i in range(5):
            t = 0.35 + i * 0.16
            p = base.lerp(top, min(t, 1.0))
            side = 1 if i % 2 else -1
            lb = sphere_bm(1, 10, 6)
            r = 0.011 if i < 4 else 0.014
            deform(lb, lambda v, r=r: Vector((v.x * r, v.y * r * 0.9, v.z * 0.0018)))
            xform(lb, Matrix.Translation(p) @ Matrix.Rotation(a0 + side * 1.2, 4, 'Z') @ Matrix.Translation((0.008, 0, 0)) @ Euler((0, -0.25, 0)).to_matrix().to_4x4())
            lv.append(lb)
    so = from_bm(merge_bms(st), "CressStems", material("Plant", rough=0.6), parent=rt)
    paint(so, solid((0.45, 0.6, 0.3)))
    lo = from_bm(merge_bms(lv), "CressLeaves", material("Plant", rough=0.35, spec=0.6), parent=rt)
    paint(lo, lambda p, n: scl((0.12, 0.4, 0.12), 0.85 + 0.2 * noise.noise(p * 300)))
    export("Cress")

def build_corn():
    clear()
    rt = root("Corn")
    cob = sphere_bm(1, 40, 24)
    deform(cob, lambda v: Vector((v.x * 0.055, v.y * 0.018 * (1 - 0.25 * max(0, v.x)), v.z * 0.018 * (1 - 0.25 * max(0, v.x)))))
    xform(cob, Matrix.Translation((0.01, 0, 0.02)))
    co = from_bm(cob, "Cob", material("Veg", rough=0.7, spec=0.2), parent=rt)
    def kern(p, n):
        a = math.atan2(p.z - 0.02, p.y)
        edge = abs(math.sin(a * 7)) < 0.1 or abs(math.sin(p.x * 260)) < 0.1
        return (0.9, 0.62, 0.08) if edge else scl((1.0, 0.86, 0.18), 0.92 + 0.08 * noise.noise(p * 300))
    paint(co, kern)
    hu = []
    for i, (a, k) in enumerate(((0.0, 1.0), (1.9, 0.9), (-1.9, 0.95), (3.4, 0.8))):
        lb = leaf_bm(0.1 * k, 0.04, curl=0.9, thick=0.0015, u=14, v=8)
        xform(lb, Matrix.Translation((-0.055, 0, 0.02)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Rotation(a, 4, 'Y') @ Matrix.Translation((0, 0, 0.016)) @ Euler((0.18 + 0.12 * (i % 2), 0, 0)).to_matrix().to_4x4())
        hu.append(lb)
    silk = [limb_bm((0.064, 0, 0.02), (0.08 + 0.006 * i, 0.006 * (i - 2), 0.024 + 0.003 * i), 0.0008, 0.0006, 4, caps=False) for i in range(5)]
    ho = from_bm(merge_bms(hu), "Husk", material("Plant", rough=0.7), parent=rt)
    paint(ho, lambda p, n: mix((0.55, 0.72, 0.32), (0.86, 0.85, 0.6), smooth(-0.05, 0.03, p.x)))
    sk = from_bm(merge_bms(silk), "Silk", material("Straw", rough=0.8), parent=rt)
    paint(sk, solid((0.78, 0.6, 0.35)))
    export("Corn")

def build_apple():
    clear()
    rt = root("Apple")
    H, R = 0.07, 0.04
    prof = []
    for i in range(13):
        t = i / 12
        r = R * (max(0.0, math.sin(math.pi * t)) ** 0.7) * (1 - 0.1 * t)
        z = t * H - 0.006 * math.exp(-((t - 1) / 0.12) ** 2) + 0.004 * math.exp(-(t / 0.1) ** 2)
        prof.append((max(r, 0.0008), z))
    a0, a1 = -0.55, 0.55
    sk = from_bm(revolve_bm(prof, a0, a1, 12), "AppleSkin", material("Veg", rough=0.3, spec=0.7), parent=rt)
    paint(sk, lambda p, n: mix((0.72, 0.06, 0.06), (0.95, 0.35, 0.12), smooth(-0.6, 0.9, noise.noise(p * 90)) * 0.6))
    fl = from_bm(wedge_caps_bm(prof, a0, a1), "AppleFlesh", material("Flesh", rough=0.6), parent=rt, smooth_shade=False)
    paint(fl, lambda p, n: (0.42, 0.25, 0.12) if math.hypot(p.x, p.y) < 0.006 and 0.028 < p.z < 0.042 else scl((0.98, 0.94, 0.78), 0.94 + 0.06 * noise.noise(p * 300)))
    # lay the wedge on its skin, cut faces to the sides
    rt.rotation_euler = (0, math.radians(90), 0)
    rt.location = (-0.035, 0, 0.034)
    export("Apple")

def build_seeds():
    clear()
    random.seed(77)
    rt = root("Seeds")
    sd = []
    for i in range(16):
        rr = math.sqrt(random.random()) * 0.028
        a = random.random() * math.tau
        z = 0.004 + (0.028 - rr) * 0.25 + random.random() * 0.003
        s = sphere_bm(1, 10, 6)
        deform(s, lambda v: Vector((v.x * 0.0055 * (1 - 0.35 * max(0, v.y)), v.y * 0.011, v.z * 0.003)))
        xform(s, Matrix.Translation((math.cos(a) * rr, math.sin(a) * rr, z)) @ Euler((random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.random() * math.tau)).to_matrix().to_4x4())
        sd.append(s)
    so = from_bm(merge_bms(sd), "SunSeeds", material("Seeds", rough=0.5, spec=0.5), parent=rt)
    paint(so, lambda p, n: (0.85, 0.83, 0.78) if abs(math.sin(p.x * 900 + p.y * 500)) < 0.25 else scl((0.12, 0.1, 0.09), 0.85 + 0.3 * noise.noise(p * 400)))
    export("Seeds")

# ---------------------------------------------------------------- the spots they come from
def build_snowdrift():
    clear()
    random.seed(81)
    rt = root("Snowdrift")
    bl = []
    for i, (x, y, r) in enumerate(((0, 0, 0.42), (0.3, 0.1, 0.3), (-0.28, -0.08, 0.32), (0.05, 0.28, 0.26), (-0.06, -0.26, 0.27))):
        b = blob_bm(r, 3, 0.2, 1.6, seed=i * 2.3, squash=0.55)
        deform(b, lambda v: Vector((v.x, v.y, max(v.z, -0.02))))
        xform(b, Matrix.Translation((x, y, 0.0)))
        bl.append(b)
    so = from_bm(merge_bms(bl), "Drift", material("Snow", rough=0.85, spec=0.3), parent=rt)
    paint(so, lambda p, n: mix((0.7, 0.78, 0.92), (0.97, 0.98, 1.0), smooth(-0.3, 0.7, n.z) * 0.8 + 0.2 * (noise.noise(p * 12) * 0.5 + 0.5)))
    canes, hips = [], []
    for k, (a, L) in enumerate(((0.6, 0.5), (2.4, 0.42), (4.1, 0.46))):
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [d * (0.12 + 0.02 * k) + Vector((0, 0, 0.12)), d * (0.24 + L * 0.3) + Vector((0, 0, 0.38)), d * (0.3 + L * 0.6) + Vector((0, 0, 0.26))]
        canes.append(limb_bm(pts[0], pts[1], 0.009, 0.007, 6))
        canes.append(limb_bm(pts[1], pts[2], 0.007, 0.004, 6))
        for t in (0.3, 0.7, 1.0):
            p = pts[1].lerp(pts[2], t) if t < 1 else pts[2]
            h = sphere_bm(1, 10, 7)
            deform(h, lambda v: Vector((v.x * 0.02, v.y * 0.02, v.z * 0.028)))
            xform(h, Matrix.Translation(p + Vector((0, 0, -0.02))))
            hips.append(h)
    co = from_bm(merge_bms(canes), "Canes", material("Wood", rough=0.8), parent=rt)
    paint(co, solid((0.3, 0.16, 0.1)))
    ho = from_bm(merge_bms(hips), "DriftHips", material("Veg", rough=0.25, spec=0.8), parent=rt)
    paint(ho, lambda p, n: mix((0.8, 0.1, 0.04), (0.98, 0.4, 0.08), smooth(-0.4, 0.9, n.z) * 0.7))
    export("Snowdrift")

def build_bramble():
    clear()
    random.seed(83)
    rt = root("Bramble")
    canes, leaves, berries = [], [], []
    for k in range(9):
        a = k / 9 * math.tau + random.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        L = random.uniform(0.45, 0.6)
        P = [d * (L * t) + Vector((0, 0, 0.62 * math.sin(math.pi * t * 0.85) * (0.75 + 0.25 * random.random()))) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        for i in range(4):
            canes.append(limb_bm(P[i], P[i + 1], 0.011 - i * 0.0018, 0.009 - i * 0.0018, 6, caps=False))
        for i in (1, 2, 3, 4):
            for s in (-1, 1):
                lb = leaf_bm(0.09, 0.06, serr=8, curl=0.2, thick=0.003, u=8, v=4)
                xform(lb, Matrix.Translation(P[i]) @ Matrix.Rotation(a + s * 1.3 + random.uniform(-0.3, 0.3), 4, 'Z') @ Euler((random.uniform(-0.6, 0.1), 0, 0)).to_matrix().to_4x4())
                leaves.append(lb)
            if random.random() < 0.55:
                berries.append(raspberry_bm(P[i] + Vector((0, 0, -0.03)), 0.016, 5, 3))
    for i in range(5):
        b = blob_bm(0.2, 2, 0.4, 2.0, seed=i * 4.1, squash=0.7)
        a = i / 5 * math.tau
        xform(b, Matrix.Translation((math.cos(a) * 0.2, math.sin(a) * 0.2, 0.22)))
        leaves.append(b)
    co = from_bm(merge_bms(canes), "Canes", material("Wood", rough=0.8), parent=rt)
    paint(co, lambda p, n: mix((0.42, 0.18, 0.16), (0.3, 0.38, 0.14), noise.noise(p * 20) * 0.5 + 0.5))
    lo = from_bm(merge_bms(leaves), "BrambleLeaves", material("Leaves", rough=0.85, spec=0.25), parent=rt)
    paint(lo, leaf_color((0.1, 0.24, 0.07), (0.17, 0.33, 0.09)))
    bo = from_bm(merge_bms(berries), "Berry", material("Berry", rough=0.3, spec=0.7), parent=rt)
    paint(bo, lambda p, n: scl((0.72, 0.06, 0.14), 0.8 + 0.25 * smooth(-0.5, 1, n.z)))
    export("Bramble")

def build_market_stall():
    clear()
    random.seed(85)
    rt = root("MarketStall")
    W, D, T = 2.0, 0.9, 0.8
    wd = [box_bm(W, D, 0.06, (0, 0, T))]
    for sx in (-1, 1):
        for sy in (-1, 1):
            wd.append(box_bm(0.06, 0.06, T, (sx * (W / 2 - 0.06), sy * (D / 2 - 0.06), T / 2)))
        wd.append(box_bm(0.06, 0.06, 2.2, (sx * (W / 2 - 0.03), D / 2 - 0.03, 1.1)))
        wd.append(box_bm(0.06, 0.06, 1.95, (sx * (W / 2 - 0.03), -D / 2 - 0.25, 0.975)))
    crates, veg, leafy = [], [], []
    def crate(cx, cy, cz, sx=0.56, sy=0.4, h=0.15):
        crates.extend([box_bm(sx, sy, 0.02, (cx, cy, cz + 0.01)), box_bm(sx, 0.02, h, (cx, cy - sy / 2, cz + h / 2)), box_bm(sx, 0.02, h, (cx, cy + sy / 2, cz + h / 2)),
                       box_bm(0.02, sy, h, (cx - sx / 2, cy, cz + h / 2)), box_bm(0.02, sy, h, (cx + sx / 2, cy, cz + h / 2))])
    for i, kind in enumerate(("lettuce", "carrot", "pepper")):
        cx = -0.64 + i * 0.64
        crate(cx, 0.05, T + 0.03)
        for k in range(7 if kind != "lettuce" else 4):
            x, y = cx + random.uniform(-0.2, 0.2), 0.05 + random.uniform(-0.13, 0.13)
            if kind == "lettuce":
                b = blob_bm(0.09, 2, 0.35, 3.0, seed=k * 1.7 + i, squash=0.75); xform(b, Matrix.Translation((x, y, T + 0.15))); leafy.append(b)
            elif kind == "carrot":
                c = cone_bm(0.022, 0.004, 0.16, 8); xform(c, Matrix.Translation((x, y, T + 0.13)) @ Euler((math.pi / 2, 0, random.random() * math.tau)).to_matrix().to_4x4()); veg.append(c)
            else:
                s = sphere_bm(0.045, 10, 7); xform(s, Matrix.Translation((x, y, T + 0.14))); veg.append(s)
    crate(0.0, -D / 2 - 0.42, 0.0, 0.62, 0.42, 0.16)   # the crate on the ground in front, where a guinea pig can reach
    for k in range(5):
        b = blob_bm(0.08, 2, 0.35, 3.0, seed=k * 2.9 + 11, squash=0.8)
        xform(b, Matrix.Translation((-0.2 + k * 0.1, -D / 2 - 0.42 + random.uniform(-0.1, 0.1), 0.13)))
        leafy.append(b)
    wo = from_bm(merge_bms(wd + crates), "StallWood", material("Wood", rough=0.8), parent=rt, smooth_shade=False)
    paint(wo, lambda p, n: scl((0.62, 0.44, 0.26), 0.82 + 0.18 * math.sin(p.x * 40 + p.z * 13)))
    vo = from_bm(merge_bms(veg), "StallVeg", material("Veg", rough=0.4, spec=0.6), parent=rt)
    paint(vo, lambda p, n: (0.95, 0.45, 0.06) if p.x < -0.3 + 0.64 * 0.5 else ((0.85, 0.1, 0.06) if noise.noise(p * 9) > 0 else (0.95, 0.75, 0.1)))
    lo = from_bm(merge_bms(leafy), "StallLettuce", material("Plant", rough=0.6), parent=rt)
    paint(lo, lambda p, n: mix((0.25, 0.55, 0.15), (0.65, 0.85, 0.4), smooth(-0.3, 0.9, n.z) * 0.6 + 0.2 * noise.noise(p * 40)))
    bm = bmesh.new()
    cols, y0, y1, z0, z1 = 12, D / 2 + 0.05, -D / 2 - 0.4, 2.22, 1.92
    grid = [[bm.verts.new((-W / 2 - 0.1 + (W + 0.2) * i / cols, y0 + (y1 - y0) * j, z0 + (z1 - z0) * j)) for j in (0, 1)] for i in range(cols + 1)]
    for i in range(cols):
        bm.faces.new((grid[i][0], grid[i + 1][0], grid[i + 1][1], grid[i][1]))
        a, b = grid[i][1], grid[i + 1][1]
        c, d = bm.verts.new((b.co.x, b.co.y, b.co.z - 0.22)), bm.verts.new((a.co.x, a.co.y, a.co.z - 0.22))
        bm.faces.new((a, b, c, d))
    ao = from_bm(bm, "StallAwning", material("Cloth", rough=0.8), parent=rt, smooth_shade=False)
    paint(ao, lambda p, n: (0.95, 0.95, 0.92) if int((p.x + W / 2 + 0.1) / (W + 0.2) * cols) % 2 == 0 else (0.25, 0.6, 0.3))
    export("MarketStall")

def build_basket():
    clear()
    rt = root("Basket")
    bo = from_bm(rbox_bm(0.38, 0.26, 0.2, (0, 0, 0.1), e=0.35, u=28, v=16), "BasketBody", material("Wicker", rough=0.9), parent=rt)
    def weave(p, n):
        u = (p.x if abs(n.x) < 0.7 else p.y) * 70
        w = (math.sin(u) * math.sin(p.z * 70)) > 0
        return scl((0.72, 0.52, 0.28), 0.8 if w else 1.0)
    paint(bo, weave)
    lid = from_bm(rbox_bm(0.4, 0.28, 0.04, (0, 0, 0.21), e=0.35, u=24, v=10), "BasketLid", material("Wicker", rough=0.9), parent=rt)
    paint(lid, lambda p, n: scl((0.68, 0.48, 0.26), 0.85 + 0.15 * math.sin(p.x * 120)))
    hd = []
    for i in range(8):
        a, b = math.pi * i / 8, math.pi * (i + 1) / 8
        hd.append(limb_bm((math.cos(a) * 0.14, 0, 0.22 + math.sin(a) * 0.14), (math.cos(b) * 0.14, 0, 0.22 + math.sin(b) * 0.14), 0.01, 0.01, 6, caps=False))
    ho = from_bm(merge_bms(hd), "Handle", material("Wicker", rough=0.9), parent=rt)
    paint(ho, solid((0.6, 0.42, 0.22)))
    cl = sphere_bm(1, 16, 8)
    deform(cl, lambda v: Vector((v.x * 0.12, v.y * 0.09, v.z * 0.012 - 0.04 * max(0, v.y) ** 2)))
    xform(cl, Matrix.Translation((0.05, -0.12, 0.2)) @ Euler((0.5, 0, 0.3)).to_matrix().to_4x4())
    co = from_bm(cl, "Napkin", material("Cloth", rough=0.95), parent=rt)
    paint(co, lambda p, n: (0.85, 0.2, 0.2) if (int(math.floor(p.x * 40)) + int(math.floor(p.y * 40))) % 2 else (0.95, 0.93, 0.88))
    export("Basket")

def build_cress_bed():
    clear()
    random.seed(87)
    rt = root("CressBed")
    lv, st = [], []
    for i in range(120):
        rr = math.sqrt(random.random()) * 0.48
        a = random.random() * math.tau
        x, y = math.cos(a) * rr * 1.2, math.sin(a) * rr
        z = 0.012 + random.random() * 0.025 * (1 - rr / 0.5)
        lb = sphere_bm(1, 8, 4)
        r = random.uniform(0.022, 0.036)
        deform(lb, lambda v, r=r: Vector((v.x * r, v.y * r * 0.9, v.z * 0.002)))
        xform(lb, Matrix.Translation((x, y, z)) @ Euler((random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3), random.random() * math.tau)).to_matrix().to_4x4())
        lv.append(lb)
        if i % 4 == 0:
            st.append(limb_bm((x, y, -0.04), (x * 1.02, y * 1.02, z), 0.0025, 0.002, 5, caps=False))
    lo = from_bm(merge_bms(lv), "CressPads", material("Plant", rough=0.35, spec=0.6), parent=rt)
    paint(lo, lambda p, n: scl(mix((0.1, 0.34, 0.1), (0.24, 0.5, 0.16), noise.noise(p * 30) * 0.5 + 0.5), 0.9 + 0.15 * noise.noise(p * 200)))
    so = from_bm(merge_bms(st), "CressStalks", material("Plant", rough=0.6), parent=rt)
    paint(so, solid((0.4, 0.55, 0.28)))
    export("CressBed")

def build_trough():
    clear()
    random.seed(89)
    rt = root("Trough")
    L, Wd, H = 1.3, 0.42, 0.2
    wd = [box_bm(L, 0.04, H, (0, -Wd / 2, 0.04 + H / 2)), box_bm(L, 0.04, H, (0, Wd / 2, 0.04 + H / 2)),
          box_bm(0.04, Wd + 0.04, H + 0.03, (-L / 2, 0, 0.04 + H / 2)), box_bm(0.04, Wd + 0.04, H + 0.03, (L / 2, 0, 0.04 + H / 2)), box_bm(L, Wd, 0.03, (0, 0, 0.055))]
    for sx in (-1, 1):
        wd.append(box_bm(0.06, Wd + 0.12, 0.05, (sx * (L / 2 - 0.12), 0, 0.025)))
    wo = from_bm(merge_bms(wd), "TroughWood", material("Wood", rough=0.85), parent=rt, smooth_shade=False)
    paint(wo, lambda p, n: scl((0.5, 0.36, 0.22), 0.8 + 0.2 * math.sin(p.x * 30 + p.z * 70) * (0.5 + 0.5 * noise.noise(p * 6))))
    st = []
    for i in range(90):
        x, y = random.uniform(-L / 2 + 0.06, L / 2 - 0.06), random.uniform(-Wd / 2 + 0.04, Wd / 2 - 0.04)
        a = random.random() * math.tau
        l = random.uniform(0.12, 0.22)
        z = 0.1 + random.random() * 0.12
        st.append(limb_bm((x - math.cos(a) * l / 2, y - math.sin(a) * l / 2 * 0.5, z), (x + math.cos(a) * l / 2, y + math.sin(a) * l / 2 * 0.5, z + random.uniform(-0.03, 0.05)), 0.003, 0.0025, 4, caps=False))
    so = from_bm(merge_bms(st), "TroughHay", material("Straw", rough=0.8), parent=rt)
    paint(so, lambda p, n: mix((0.78, 0.68, 0.32), (0.58, 0.62, 0.26), noise.noise(p * 60) * 0.5 + 0.5))
    cobs, husks = [], []
    for k, (x, y, a) in enumerate(((-0.35, 0.05, 0.4), (0.05, -0.06, -0.3), (0.38, 0.08, 0.9))):
        c = sphere_bm(1, 14, 10)
        deform(c, lambda v: Vector((v.x * 0.11, v.y * 0.035, v.z * 0.035)))
        m = Matrix.Translation((x, y, 0.22)) @ Euler((0, -0.35, a)).to_matrix().to_4x4()
        xform(c, m)
        cobs.append(c)
        for s in (-1, 1):
            lb = leaf_bm(0.16, 0.06, curl=0.8, thick=0.002)
            xform(lb, m @ Matrix.Translation((-0.08, 0, 0)) @ Matrix.Rotation(-math.pi / 2 + s * 0.5, 4, 'Z') @ Euler((0.3, 0, 0)).to_matrix().to_4x4())
            husks.append(lb)
    co = from_bm(merge_bms(cobs), "TroughCorn", material("Veg", rough=0.45, spec=0.5), parent=rt)
    paint(co, lambda p, n: scl((1.0, 0.8, 0.22), 0.8 + 0.2 * abs(math.sin(p.x * 220) * math.sin(p.y * 220 + p.z * 220))))
    ho = from_bm(merge_bms(husks), "TroughHusks", material("Plant", rough=0.7), parent=rt)
    paint(ho, solid((0.6, 0.72, 0.36)))
    export("Trough")

def build_apple_tree():
    clear()
    random.seed(91)
    rt = root("AppleTree")
    H = 1.9
    tr = trunk_bm(H, 0.15, rings=18, seg=16, flare=0.6, top=0.5, bend=0.3)
    branches = []
    for i in range(5):
        a = i / 5 * math.tau + random.random()
        s = Vector((0.1 * math.sin(2.0), 0, H * (0.65 + 0.07 * i)))
        e = s + Vector((math.cos(a) * 0.9, math.sin(a) * 0.9, 0.55 + random.random() * 0.4))
        branches.append(limb_bm(s, e, 0.07, 0.03, 8))
    t = from_bm(merge_bms([tr] + branches), "Trunk", material("Bark", rough=0.95), parent=rt)
    paint(t, bark_color)
    centers = [(Vector((0.1, 0, H + 0.75)), 1.0)]
    for i in range(6):
        a = i / 6 * math.tau + random.random() * 0.4
        centers.append((Vector((math.cos(a) * 0.95, math.sin(a) * 0.95, H + 0.35 + random.random() * 0.5)), 0.7 + random.random() * 0.2))
    blobs = []
    for i, (c, r) in enumerate(centers):
        b = blob_bm(r, 3, 0.3, 1.4, seed=i * 5.3 + 2, squash=0.8)
        xform(b, Matrix.Translation(c))
        blobs.append(b)
    lv = from_bm(merge_bms(blobs), "Leaves", material("Leaves", rough=0.85, spec=0.25), parent=rt)
    paint(lv, leaf_color((0.15, 0.36, 0.08), (0.28, 0.5, 0.12)))
    ap = []
    for i in range(34):
        c, r = centers[random.randrange(len(centers))]
        d = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-0.6, 0.8))).normalized()
        p = c + Vector((d.x, d.y, d.z * 0.8)) * r * 1.0
        if p.z < 1.4:
            continue
        s = sphere_bm(0.055, 10, 7)
        xform(s, Matrix.Translation(p))
        ap.append(s)
    for i in range(8):   # windfalls on the grass
        a = random.random() * math.tau
        rr = random.uniform(0.35, 1.2)
        s = sphere_bm(0.05, 10, 7)
        xform(s, Matrix.Translation((math.cos(a) * rr, math.sin(a) * rr, 0.045)))
        ap.append(s)
    ao = from_bm(merge_bms(ap), "Fruit", material("Fruit", rough=0.3, spec=0.7), parent=rt)
    paint(ao, lambda p, n: mix((0.7, 0.05, 0.05), (0.95, 0.3, 0.1), smooth(-0.5, 0.8, n.z) * 0.6 + 0.2 * noise.noise(p * 30)))
    export("AppleTree")

def build_sunflower_head():
    clear()
    rt = root("SunflowerHead")
    tilt = Matrix.Translation((0, 0, 0.05)) @ Euler((0.28, 0.12, 0)).to_matrix().to_4x4()
    disc = sphere_bm(1, 28, 10)
    deform(disc, lambda v: Vector((v.x * 0.17, v.y * 0.17, v.z * 0.035)))
    xform(disc, tilt)
    do = from_bm(disc, "HeadDisc", material("Seeds", rough=0.9), parent=rt)
    gold = math.pi * (3 - math.sqrt(5))
    def seeds(p, n):
        q = tilt.inverted() @ p
        r = math.hypot(q.x, q.y)
        if n.z < 0.2:
            return (0.3, 0.38, 0.14)
        k = (math.atan2(q.y, q.x) - math.sqrt(r) * 60) / gold
        s = abs(math.sin(k * 3.0)) < 0.3
        c = mix((0.25, 0.14, 0.06), (0.42, 0.28, 0.12), smooth(0.02, 0.15, r))
        return scl(c, 0.7 if s else 1.0)
    paint(do, seeds)
    bm = bmesh.new()
    for i in range(26):
        a = i / 26 * math.tau
        droop = 0.03 + 0.03 * math.sin(i * 1.7)
        lb = leaf_bm(0.09, 0.035, thick=0.0015, u=8, v=4)
        xform(lb, Matrix.Rotation(a - math.pi / 2, 4, 'Z') @ Matrix.Translation((0, 0.15, 0)) @ Euler((-droop * 6, 0, 0)).to_matrix().to_4x4())
        me = bpy.data.meshes.new("tmp"); lb.to_mesh(me); bm.from_mesh(me); lb.free(); bpy.data.meshes.remove(me)
    xform(bm, tilt)
    po = from_bm(bm, "HeadPetals", material("Petal", rough=0.6), parent=rt)
    paint(po, lambda p, n: mix((0.95, 0.62, 0.04), (1.0, 0.82, 0.22), noise.noise(p * 50) * 0.5 + 0.5))
    stb = limb_bm((0.12, -0.12, 0.03), (0.38, -0.3, 0.02), 0.018, 0.014, 8)
    so = from_bm(stb, "Stalk", material("Plant", rough=0.7), parent=rt)
    paint(so, solid((0.3, 0.48, 0.15)))
    export("SunflowerHead")

# ================================================================ THE BARN INSIDE (a guinea pig squeezes in through a hole) and gnawing twigs
BARN_W, BARN_D, BARN_HW = 8.0, 6.0, 3.2   # the same box as build_barn

def build_barn_inside():
    """The barn from inside, at the Barn's own size: plank walls and floor, rafters, a loft with a ladder.
    Holes at the foot of the back wall (x -2.2) and the east wall (y -1.0, Blender) let the daylight in; the game lines them up with BarnHole outside."""
    clear()
    random.seed(95)
    rt = root("BarnInside")
    W, D, Hw = BARN_W, BARN_D, BARN_HW
    fl = from_bm(box_bm(W, D, 0.06, (0, 0, -0.03)), "BarnFloor", material("BarnFloor", rough=0.95), parent=rt, smooth_shade=False)
    subdivide(fl, 14)
    def floor(p, n):
        straw = noise.noise(p * 9) > 0.35
        c = mix((0.36, 0.27, 0.18), (0.44, 0.34, 0.22), noise.noise(p * 2) * 0.5 + 0.5)
        return mix(c, (0.78, 0.66, 0.34), 0.7) if straw else c
    paint(fl, floor)
    # walls: upright planks with thin gaps (a dark backing behind them), each board its own shade
    t = 0.06
    back = [box_bm(W + 0.3, 0.02, Hw, (0, D / 2 + t + 0.02, Hw / 2)), box_bm(W + 0.3, 0.02, Hw, (0, -D / 2 - t - 0.02, Hw / 2)),
            box_bm(0.02, D + 0.3, Hw, (W / 2 + t + 0.02, 0, Hw / 2)), box_bm(0.02, D + 0.3, Hw, (-W / 2 - t - 0.02, 0, Hw / 2))]
    bko = from_bm(merge_bms(back), "BarnBacking", material("BarnBacking", rough=1.0), parent=rt, smooth_shade=False)
    paint(bko, solid((0.06, 0.04, 0.03)))
    planks, shade = [], []
    PW = 0.25
    for (axis, fixed, length) in (("x", D / 2 + t / 2, W), ("x", -D / 2 - t / 2, W), ("y", W / 2 + t / 2, D), ("y", -W / 2 - t / 2, D)):
        n = int(length / PW)
        for i in range(n):
            c = -length / 2 + (i + 0.5) * length / n
            w = length / n - 0.018
            if axis == "x":
                planks.append(box_bm(w, t, Hw, (c, fixed, Hw / 2)))
            else:
                planks.append(box_bm(t, w, Hw, (fixed, c, Hw / 2)))
    wo = from_bm(merge_bms(planks), "BarnBoards", material("Wood", rough=0.85), parent=rt, smooth_shade=False)
    def boards(p, n):
        u = p.x if abs(p.y) > D / 2 - 0.01 else p.y
        k = 0.82 + 0.2 * (noise.noise(Vector((math.floor(u / PW) * 1.7, 0.5, 0.3))) * 0.5 + 0.5)
        return scl((0.46, 0.31, 0.19), k * (0.72 + 0.28 * smooth(0.0, 1.4, p.z)) * (0.92 + 0.08 * noise.noise(p * 7)))
    paint(wo, boards)
    # gables and the roof's underside
    gb = bmesh.new()
    inner = [(-W / 2, Hw), (-W / 2 + 1.2, Hw + 1.85), (0, Hw + 3.0), (W / 2 - 1.2, Hw + 1.85), (W / 2, Hw)]
    for y in (-D / 2, D / 2):
        vs = [gb.verts.new((x, y, z)) for x, z in inner]
        gb.faces.new(list(reversed(vs)) if y > 0 else vs)
    for (xa, za), (xb, zb) in zip(inner, inner[1:]):
        gb.faces.new((gb.verts.new((xb, -D / 2, zb)), gb.verts.new((xa, -D / 2, za)), gb.verts.new((xa, D / 2, za)), gb.verts.new((xb, D / 2, zb))))
    bmesh.ops.subdivide_edges(gb, edges=gb.edges, cuts=8, use_grid_fill=True)
    go = from_bm(gb, "BarnRoofInside", material("Wood", rough=0.85), parent=rt, smooth_shade=False)
    paint(go, lambda p, n: scl((0.34, 0.24, 0.15), 0.7 + 0.3 * (0.5 + 0.5 * math.sin(p.x * 25 + p.y * 3))))
    # beams: tie beams, rafters, corner and middle posts, the loft and its ladder
    bm_ = []
    for y in (-D / 2 + 0.2, -1.0, 1.0, D / 2 - 0.2):
        bm_.append(box_bm(W, 0.16, 0.18, (0, y, Hw)))
        for (xa, za), (xb, zb) in zip(inner, inner[1:]):
            b = limb_bm((xa * 0.97, y, za - 0.1), (xb * 0.97, y, zb - 0.1), 0.07, 0.07, 6, caps=False)
            bm_.append(b)
    for x in (-W / 2 + 0.15, W / 2 - 0.15):
        for y in (-D / 2 + 0.15, D / 2 - 0.15):
            bm_.append(box_bm(0.2, 0.2, Hw, (x, y, Hw / 2)))
    for y in (-1.0, 1.0):
        bm_.append(box_bm(0.18, 0.18, Hw, (1.4, y, Hw / 2)))
    LX = 1.4   # the loft covers x 1.4 .. W/2 at 2.1 m
    bm_.append(box_bm(W / 2 - LX, D, 0.1, ((W / 2 + LX) / 2, 0, 2.1)))
    bm_.append(box_bm(0.08, D, 0.5, (LX, 0, 2.4)))
    for side in (-0.25, 0.25):
        bm_.append(limb_bm((LX - 0.75, 0.3 + side, 0), (LX - 0.05, 0.3 + side, 2.2), 0.03, 0.03, 6, caps=False))
    for i in range(7):
        z = 0.3 + i * 0.3
        f = z / 2.2
        x = LX - 0.75 + 0.7 * f
        bm_.append(limb_bm((x, 0.05, z), (x, 0.55, z), 0.02, 0.02, 6, caps=False))
    beo = from_bm(merge_bms(bm_), "BarnBeams", material("Bark", rough=0.9), parent=rt, smooth_shade=False)
    paint(beo, lambda p, n: scl((0.3, 0.2, 0.12), 0.8 + 0.2 * noise.noise(p * 5)))
    # hay up on the loft
    lh = []
    for i in range(10):
        b = blob_bm(random.uniform(0.35, 0.6), 2, 0.4, 2.0, seed=i * 2.7, squash=0.45)
        xform(b, Matrix.Translation((random.uniform(LX + 0.4, W / 2 - 0.4), random.uniform(-D / 2 + 0.5, D / 2 - 0.5), 2.2)))
        lh.append(b)
    lho = from_bm(merge_bms(lh), "LoftHay", material("Straw", rough=0.9), parent=rt)
    paint(lho, lambda p, n: mix((0.72, 0.6, 0.28), (0.88, 0.78, 0.42), noise.noise(p * 12) * 0.5 + 0.5))
    # the big doors from inside (front wall, -Y) with their brace
    dr = [box_bm(2.8, 0.06, 2.8, (0, -D / 2 + 0.02, 1.4))]
    for s in (1, -1):
        b = box_bm(0.12, 0.06, 3.6, (0, 0, 0)); xform(b, Matrix.Translation((0, -D / 2 + 0.06, 1.4)) @ Matrix.Rotation(s * 0.78, 4, 'Y')); dr.append(b)
    dro = from_bm(merge_bms(dr), "BarnDoorInside", material("Wood", rough=0.8), parent=rt, smooth_shade=False)
    paint(dro, lambda p, n: scl((0.4, 0.27, 0.16), 0.8 + 0.2 * (0.5 + 0.5 * math.sin(p.x * 26))))
    # a lantern on the middle tie beam (the game lights its glass)
    ln = [limb_bm((-0.6, -1.0, Hw - 0.1), (-0.6, -1.0, Hw - 0.55), 0.008, 0.008, 4, caps=False), cone_bm(0.07, 0.04, 0.06, 8)]
    xform(ln[1], Matrix.Translation((-0.6, -1.0, Hw - 0.55)))
    lno = from_bm(merge_bms(ln), "LanternFrame", material("Iron", rough=0.5, metal=0.6), parent=rt)
    paint(lno, solid((0.12, 0.12, 0.12)))
    glass = cone_bm(0.065, 0.08, 0.16, 8); xform(glass, Matrix.Translation((-0.6, -1.0, Hw - 0.66)))
    glo = from_bm(glass, "LanternGlass", material("Lamp", rough=0.2, emit=(1.0, 0.8, 0.45), emit_str=0.0), parent=rt)
    paint(glo, solid((1.0, 0.92, 0.7)))
    export("BarnInside")

def build_hay_pile():
    """A big heap of loose hay, 1.5 m across the middle and 0.9 m high: the game's pileHeight() follows this shape."""
    clear()
    random.seed(97)
    rt = root("HayPile")
    R, H = 1.5, 0.9
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=40, y_segments=40, size=R * 1.05, calc_uvs=True)
    def f(v):
        r = math.hypot(v.x, v.y) / R
        h = H * max(0.0, 1 - r * r) ** 0.8 if r < 1 else -0.02
        h += 0.05 * noise.noise(Vector((v.x, v.y, 0)) * 3) * (1 if r < 1 else 0)
        return Vector((v.x, v.y, h))
    deform(bm, f)
    po = from_bm(bm, "Heap", material("Straw", rough=0.9), parent=rt)
    paint(po, lambda p, n: mix((0.66, 0.54, 0.24), (0.9, 0.8, 0.44), noise.noise(p * 10) * 0.5 + 0.5))
    st = []
    for i in range(260):
        a = random.random() * math.tau
        rr = math.sqrt(random.random()) * R * 0.98
        x, y = math.cos(a) * rr, math.sin(a) * rr
        h = H * max(0.0, 1 - (rr / R) ** 2) ** 0.8
        L = random.uniform(0.12, 0.26)
        b = random.random() * math.tau
        tilt = random.uniform(-0.4, 0.5)
        st.append(limb_bm((x - math.cos(b) * L / 2, y - math.sin(b) * L / 2, h + 0.01), (x + math.cos(b) * L / 2, y + math.sin(b) * L / 2, h + 0.01 + tilt * L), 0.004, 0.003, 4, caps=False))
    so = from_bm(merge_bms(st), "Straws", material("Straw", rough=0.8), parent=rt)
    paint(so, lambda p, n: mix((0.78, 0.66, 0.3), (0.95, 0.86, 0.5), noise.noise(p * 40) * 0.5 + 0.5))
    export("HayPile")

def build_barn_hole():
    """A guinea-pig-sized gap at the foot of a barn wall: a dark arch, splintered board ends round it, straw poking out.
    Faces -Y (Blender), its back flush at y=0 against the wall."""
    clear()
    random.seed(99)
    rt = root("BarnHole")
    bm = bmesh.new()
    c = bm.verts.new((0, -0.012, 0.0))
    arc = [bm.verts.new((math.cos(a) * 0.2, -0.012, math.sin(a) * 0.24)) for a in [math.pi * i / 16 for i in range(17)]]
    for i in range(16):
        bm.faces.new((c, arc[i + 1], arc[i]))
    ho = from_bm(bm, "HoleDark", material("HoleDark", rough=1.0), parent=rt, smooth_shade=False)
    paint(ho, solid((0.03, 0.02, 0.015)))
    sp = []
    for i in range(7):
        a = math.pi * (0.08 + 0.84 * i / 6)
        x, z = math.cos(a) * 0.22, math.sin(a) * 0.26
        L = random.uniform(0.05, 0.11)
        b = box_bm(0.035, 0.03, L, (0, 0, 0))
        xform(b, Matrix.Translation((x, -0.02, z)) @ Matrix.Rotation(-(a - math.pi / 2) + random.uniform(-0.3, 0.3), 4, 'Y') @ Matrix.Translation((0, 0, L / 2)))
        sp.append(b)
    spo = from_bm(merge_bms(sp), "Splinters", material("Wood", rough=0.8), parent=rt, smooth_shade=False)
    paint(spo, lambda p, n: scl((0.62, 0.42, 0.26), 0.8 + 0.2 * noise.noise(p * 30)))
    st = []
    for i in range(14):
        x = random.uniform(-0.16, 0.16)
        st.append(limb_bm((x, -0.0, 0.01), (x + random.uniform(-0.08, 0.08), -random.uniform(0.06, 0.16), random.uniform(0.0, 0.05)), 0.004, 0.003, 4, caps=False))
    sto = from_bm(merge_bms(st), "HoleStraw", material("Straw", rough=0.8), parent=rt)
    paint(sto, lambda p, n: mix((0.78, 0.66, 0.3), (0.95, 0.86, 0.5), noise.noise(p * 40) * 0.5 + 0.5))
    export("BarnHole")

def build_twig():
    """A fallen twig to gnaw: a short branch with two side shoots and a couple of leaves, lying on the ground along X."""
    clear()
    random.seed(101)
    rt = root("Twig")
    L = 0.34
    pts = [Vector((-L / 2 + L * i / 8, 0.01 * (i / 8) + 0.004 * math.sin(i * 1.3), 0.018 + 0.004 * i / 8)) for i in range(9)]
    br = [limb_bm(pts[i], pts[i + 1], 0.016 - 0.0006 * i, 0.016 - 0.0006 * (i + 1), 10, caps=False) for i in range(8)]
    for p_, r in ((pts[0], 0.016), (pts[-1], 0.0112)):
        c = cone_bm(r, r, 0.004, 10); xform(c, Matrix.Translation(p_) @ Euler((0, math.pi / 2, 0)).to_matrix().to_4x4()); br.append(c)
    for (t, a, l) in ((-0.05, 0.7, 0.11), (0.08, -0.8, 0.09)):
        br.append(limb_bm((t, 0, 0.02), (t + math.cos(a) * l * 0.6, math.sin(a) * l, 0.03), 0.007, 0.004, 6))
    bo = from_bm(merge_bms(br), "TwigBark", material("Bark", rough=0.9), parent=rt)
    def bark(p, n):
        ends = abs(p.x) > L / 2 - 0.0015
        return (0.86, 0.74, 0.52) if ends else scl((0.36, 0.25, 0.16), 0.8 + 0.25 * noise.noise(p * 60))
    paint(bo, bark)
    lv = []
    for (x, y, a) in ((0.03, 0.09, 1.9), (0.13, -0.07, -1.2)):
        lb = leaf_bm(0.05, 0.026, curl=0.3)
        xform(lb, Matrix.Translation((x, y, 0.03)) @ Matrix.Rotation(a, 4, 'Z') @ Euler((0.2, 0, 0)).to_matrix().to_4x4())
        lv.append(lb)
    lo = from_bm(merge_bms(lv), "TwigLeaves", material("Plant", rough=0.7), parent=rt)
    paint(lo, solid((0.3, 0.5, 0.16)))
    export("Twig")

# ================================================================ THE PET SHOP (after hours, in through the cat flap)
SHOP_W, SHOP_D, SHOP_H = 6.0, 5.0, 3.2   # the Shop's footprint; the front (window, door) is -Y, the back door +Y

def build_petshop_inside():
    """The pet shop from inside at the Shop's own size: checker tiles, mint walls, the window and glass door at the front,
    a counter, shelves of supplies, an aquarium stand, the guinea pig pen, a treat bin, and the back door with its cat flap."""
    clear()
    random.seed(103)
    rt = root("PetShopInside")
    W, D, H = SHOP_W, SHOP_D, SHOP_H
    tiles = []
    NX, NY = 12, 10
    for i in range(NX):
        for j in range(NY):
            tiles.append(box_bm(W / NX - 0.01, D / NY - 0.01, 0.04, (-W / 2 + (i + 0.5) * W / NX, -D / 2 + (j + 0.5) * D / NY, -0.02)))
    to = from_bm(merge_bms(tiles), "ShopTiles", material("Tiles", rough=0.35, spec=0.6), parent=rt, smooth_shade=False)
    paint(to, lambda p, n: (0.92, 0.9, 0.82) if (int(math.floor((p.x + W) / (W / NX))) + int(math.floor((p.y + D) / (D / NY)))) % 2 else (0.36, 0.62, 0.6))
    # walls with a skirting board, the window and door cut out of the front
    t = 0.08
    wl = [box_bm(W, t, H, (0, D / 2 + t / 2, H / 2)), box_bm(t, D, H, (W / 2 + t / 2, 0, H / 2)), box_bm(t, D, H, (-W / 2 - t / 2, 0, H / 2))]
    # front wall pieces round the window (x -2.65..0.85, z .5..2.45) and the door (x 1.4..2.4, z 0..2.2)
    fy = -D / 2 - t / 2
    wl += [box_bm(0.35, t, H, (-2.825, fy, H / 2)), box_bm(0.55, t, H, (1.125, fy, H / 2)), box_bm(0.6, t, H, (2.7, fy, H / 2)),
           box_bm(3.5, t, 0.5, (-0.9, fy, 0.25)), box_bm(3.5, t, H - 2.45, (-0.9, fy, (H + 2.45) / 2)), box_bm(1.0, t, H - 2.2, (1.9, fy, (H + 2.2) / 2))]
    wo = from_bm(merge_bms(wl), "ShopWalls", material("Plaster", rough=0.9), parent=rt, smooth_shade=False)
    subdivide(wo, 6)
    paint(wo, lambda p, n: (0.95, 0.93, 0.86) if p.z < 0.12 else scl((0.72, 0.88, 0.8), 0.92 + 0.08 * noise.noise(p * 3)))
    ce = from_bm(box_bm(W, D, 0.06, (0, 0, H + 0.03)), "ShopCeiling", material("Plaster", rough=0.9), parent=rt, smooth_shade=False)
    paint(ce, solid((0.95, 0.95, 0.92)))
    glass = [box_bm(3.5, 0.03, 1.95, (-0.9, -D / 2, 1.475)), box_bm(1.0, 0.03, 2.2, (1.9, -D / 2, 1.1))]
    go = from_bm(merge_bms(glass), "ShopWindows", material("Glass", rough=0.05, spec=1.0, emit=(0.5, 0.65, 0.9), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(go, solid((0.25, 0.32, 0.42)))
    lights = [box_bm(1.2, 0.5, 0.04, (x, 0.3, H - 0.02)) for x in (-1.4, 1.4)]
    lo = from_bm(merge_bms(lights), "ShopLights", material("Lamp", rough=0.2, emit=(1.0, 0.95, 0.85), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(lo, solid((0.98, 0.97, 0.92)))
    # the counter at the front right, with the till and a bell
    ct = [box_bm(2.2, 0.6, 0.96, (1.5, -1.5, 0.48)), box_bm(2.3, 0.7, 0.05, (1.5, -1.5, 0.985))]
    cto = from_bm(merge_bms(ct), "Counter", material("Wood", rough=0.6), parent=rt, smooth_shade=False)
    paint(cto, lambda p, n: (0.78, 0.6, 0.4) if p.z > 0.96 else scl((0.55, 0.36, 0.22), 0.85 + 0.15 * math.sin(p.x * 30)))
    till = [box_bm(0.4, 0.32, 0.2, (2.15, -1.45, 1.11)), box_bm(0.36, 0.06, 0.16, (2.15, -1.55, 1.25))]
    tlo = from_bm(merge_bms(till), "Till", material("Plastic", rough=0.4), parent=rt, smooth_shade=False)
    paint(tlo, lambda p, n: (0.2, 0.22, 0.25) if p.z < 1.2 else (0.55, 0.8, 0.6))
    # shelves on the left wall: uprights, four shelves, boxes and bags in bright colours
    sh = []
    for y in (-1.6, 0.2, 2.0):
        sh.append(box_bm(0.4, 0.04, 2.3, (-2.8, y, 1.15)))
    for z in (0.25, 0.85, 1.45, 2.05):
        sh.append(box_bm(0.42, 3.64, 0.04, (-2.8, 0.2, z)))
    sho = from_bm(merge_bms(sh), "Shelves", material("Wood", rough=0.6), parent=rt, smooth_shade=False)
    paint(sho, solid((0.9, 0.88, 0.82)))
    goods = []
    for z in (0.27, 0.87, 1.47, 2.07):
        y = -1.55
        while y < 1.95:
            w = random.uniform(0.18, 0.34)
            if y + w > 1.95:
                break
            h = random.uniform(0.22, 0.45)
            goods.append(rbox_bm(0.28, w - 0.02, h, (-2.78, y + w / 2, z + h / 2), e=0.25 if random.random() < 0.5 else 0.6, u=8, v=6))
            y += w
    gdo = from_bm(merge_bms(goods), "Goods", material("Plastic", rough=0.5), parent=rt, smooth_shade=False)
    pal = [(0.9, 0.3, 0.3), (0.95, 0.75, 0.2), (0.3, 0.6, 0.9), (0.4, 0.75, 0.35), (0.85, 0.5, 0.75), (0.95, 0.55, 0.2), (0.6, 0.45, 0.85)]
    paint(gdo, lambda p, n: pal[int((noise.noise(Vector((round(p.y * 4.3), round(p.z * 1.7), 0.5)) * 1.0) * 0.5 + 0.5) * 6.99)])
    # a pellet bag tipped over on the floor by the shelves (the game forages it)
    bag = rbox_bm(0.34, 0.24, 0.46, (0, 0, 0), e=0.6, u=16, v=10)
    xform(bag, Matrix.Translation((-2.2, 0.55, 0.13)) @ Euler((math.pi / 2 - 0.1, 0, 0.6)).to_matrix().to_4x4())
    bgo = from_bm(bag, "PelletBag", material("Plastic", rough=0.6), parent=rt)
    paint(bgo, lambda p, n: (0.3, 0.6, 0.3) if noise.noise(p * 8) > -0.2 else (0.95, 0.9, 0.7))
    pel = []
    for i in range(60):
        a = random.uniform(-1.2, 2.0)
        r = random.uniform(0.05, 0.45)
        c = limb_bm((0, 0, 0), (0.025, 0, 0), 0.008, 0.008, 5, caps=False)
        xform(c, Matrix.Translation((-2.2 + math.cos(a) * r, 0.3 + math.sin(a) * r * 0.8, 0.008)) @ Matrix.Rotation(random.random() * math.tau, 4, 'Z'))
        pel.append(c)
    pelo = from_bm(merge_bms(pel), "Pellets", material("Veg", rough=0.8), parent=rt)
    paint(pelo, lambda p, n: mix((0.42, 0.5, 0.22), (0.55, 0.45, 0.22), noise.noise(p * 50) * 0.5 + 0.5))
    # the aquarium stand on the right wall: a cabinet, two tanks of glowing water, gravel and a few fish
    aq = [box_bm(0.45, 2.5, 0.8, (2.75, -0.5 + 1.0, 0.4))]
    aqo = from_bm(merge_bms(aq), "AquaStand", material("Wood", rough=0.6), parent=rt, smooth_shade=False)
    paint(aqo, solid((0.25, 0.22, 0.24)))
    tanks, gravel, fish = [], [], []
    for y in (0.0, 1.05):
        tanks.append(box_bm(0.4, 0.95, 0.55, (2.75, y + 0.5, 1.1)))
        gravel.append(box_bm(0.38, 0.93, 0.06, (2.75, y + 0.5, 0.86)))
        for k in range(4):
            f = sphere_bm(1, 8, 6)
            deform(f, lambda v: Vector((v.x * 0.012, v.y * 0.03, v.z * 0.016)))
            xform(f, Matrix.Translation((2.7 + random.uniform(-0.08, 0.08), y + 0.5 + random.uniform(-0.35, 0.35), random.uniform(0.95, 1.3))))
            fish.append(f)
    wto = from_bm(merge_bms(tanks), "TankWater", material("Water", rough=0.05, spec=1.0, emit=(0.2, 0.7, 0.9), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(wto, solid((0.35, 0.65, 0.8)))
    gro = from_bm(merge_bms(gravel), "Gravel", material("Stone", rough=0.9), parent=rt, smooth_shade=False)
    paint(gro, lambda p, n: mix((0.8, 0.6, 0.4), (0.4, 0.5, 0.7), noise.noise(p * 40) * 0.5 + 0.5))
    fio = from_bm(merge_bms(fish), "Fish", material("Veg", rough=0.3), parent=rt)
    paint(fio, lambda p, n: (1.0, 0.55, 0.1) if noise.noise(p * 20) > 0 else (0.95, 0.85, 0.2))
    # the guinea pig pen at the back left: low glass sides, wood shavings, a little wooden house, a bowl
    PX0, PX1, PY0, PY1 = -2.8, -1.4, 1.3, 2.3
    pg = [box_bm(PX1 - PX0, 0.02, 0.36, ((PX0 + PX1) / 2, PY0, 0.18)), box_bm(PX1 - PX0, 0.02, 0.36, ((PX0 + PX1) / 2, PY1, 0.18)),
          box_bm(0.02, PY1 - PY0, 0.36, (PX0, (PY0 + PY1) / 2, 0.18)), box_bm(0.02, PY1 - PY0, 0.36, (PX1, (PY0 + PY1) / 2, 0.18))]
    pgo = from_bm(merge_bms(pg), "PenGlass", material("PenGlass", rough=0.05, spec=1.0), parent=rt, smooth_shade=False)
    paint(pgo, solid((0.8, 0.92, 0.95)))
    bed = box_bm(PX1 - PX0 - 0.04, PY1 - PY0 - 0.04, 0.04, ((PX0 + PX1) / 2, (PY0 + PY1) / 2, 0.02))
    beo = from_bm(bed, "Shavings", material("Straw", rough=0.95), parent=rt, smooth_shade=False)
    subdivide(beo, 8)
    paint(beo, lambda p, n: mix((0.85, 0.72, 0.5), (0.95, 0.86, 0.66), noise.noise(p * 30) * 0.5 + 0.5))
    hs = [box_bm(0.34, 0.3, 0.02, (-2.5, 2.05, 0.04))]
    for s_ in (1, -1):
        r = box_bm(0.36, 0.32, 0.02, (0, 0, 0)); xform(r, Matrix.Translation((-2.5 + s_ * 0.09, 2.05, 0.15)) @ Matrix.Rotation(s_ * 0.9, 4, 'Y')); hs.append(r)
    hso = from_bm(merge_bms(hs), "PenHouse", material("Wood", rough=0.7), parent=rt, smooth_shade=False)
    paint(hso, lambda p, n: scl((0.7, 0.5, 0.3), 0.85 + 0.15 * math.sin(p.x * 60)))
    bowl = cone_bm(0.07, 0.09, 0.04, 16); xform(bowl, Matrix.Translation((-1.7, 1.55, 0.06)))
    bwo = from_bm(bowl, "PenBowl", material("Plastic", rough=0.4), parent=rt)
    paint(bwo, solid((0.9, 0.35, 0.45)))
    # the treat bin at the back right, lid open, and sacks beside it
    bn = cone_bm(0.22, 0.26, 0.45, 18, caps=True); xform(bn, Matrix.Translation((2.35, 2.0, 0.225)))
    lid = cone_bm(0.27, 0.27, 0.03, 18); xform(lid, Matrix.Translation((2.35, 2.32, 0.5)) @ Matrix.Rotation(1.1, 4, 'X'))
    bno = from_bm(merge_bms([bn, lid]), "TreatBin", material("Plastic", rough=0.5), parent=rt)
    paint(bno, solid((0.95, 0.75, 0.25)))
    sk = []
    for i, (x, y) in enumerate(((2.55, 1.3), (2.25, 1.05))):
        b = blob_bm(0.24, 2, 0.15, 2.0, seed=i * 3.3, squash=1.3); xform(b, Matrix.Translation((x, y, 0.3))); sk.append(b)
    sko = from_bm(merge_bms(sk), "Sacks", material("Cloth", rough=0.95), parent=rt)
    paint(sko, lambda p, n: scl((0.78, 0.68, 0.48), 0.85 + 0.15 * noise.noise(p * 20)))
    # the back door from inside, with the cat flap at its foot (x 1.2)
    dr = [box_bm(1.1, 0.06, 2.1, (1.2, D / 2 - 0.02, 1.05))]
    dro = from_bm(merge_bms(dr), "BackDoor", material("Wood", rough=0.7), parent=rt, smooth_shade=False)
    paint(dro, lambda p, n: (0.2, 0.18, 0.15) if p.z < 0.3 and abs(p.x - 1.2) < 0.16 else scl((0.45, 0.32, 0.22), 0.85 + 0.15 * math.sin(p.z * 25)))
    fl = box_bm(0.28, 0.02, 0.26, (1.2, D / 2 - 0.06, 0.15))
    flo = from_bm(fl, "Flap", material("FlapPlastic", rough=0.4), parent=rt, smooth_shade=False)
    paint(flo, solid((0.8, 0.82, 0.8)))
    sign = box_bm(0.5, 0.02, 0.2, (1.2, D / 2 - 0.06, 2.35))
    sio = from_bm(sign, "ExitSign", material("Lamp", rough=0.3, emit=(0.3, 1.0, 0.4), emit_str=0.0), parent=rt, smooth_shade=False)
    paint(sio, solid((0.4, 0.95, 0.5)))
    export("PetShopInside")

def build_cat_flap():
    """The pet shop's back door seen from outside, with a cat flap at its foot. Faces -Y; its back at y=0 against the wall."""
    clear()
    rt = root("CatFlap")
    dr = box_bm(1.1, 0.06, 2.1, (0, -0.03, 1.05))
    do = from_bm(dr, "BackDoorOut", material("Wood", rough=0.7), parent=rt, smooth_shade=False)
    subdivide(do, 10)
    paint(do, lambda p, n: (0.15, 0.13, 0.12) if p.z < 0.32 and abs(p.x) < 0.17 else scl((0.3, 0.42, 0.36), 0.85 + 0.15 * math.sin(p.z * 25)))
    fr = [box_bm(0.36, 0.03, 0.04, (0, -0.07, 0.32)), box_bm(0.04, 0.03, 0.3, (-0.17, -0.07, 0.16)), box_bm(0.04, 0.03, 0.3, (0.17, -0.07, 0.16)),
          box_bm(0.08, 0.04, 0.03, (0.35, -0.08, 1.0))]
    fro = from_bm(merge_bms(fr), "FlapFrame", material("Plastic", rough=0.4), parent=rt, smooth_shade=False)
    paint(fro, solid((0.85, 0.85, 0.82)))
    fl = box_bm(0.3, 0.015, 0.28, (0, -0.075, 0.155))
    flo = from_bm(fl, "Flap", material("FlapPlastic", rough=0.4), parent=rt, smooth_shade=False)
    paint(flo, solid((0.75, 0.78, 0.76)))
    export("CatFlap")

def build_cat():
    """Duchess the shop cat, standing: an orange tabby. Faces -Y like the fox, legs (LegFL..) and Tail pivot for the game."""
    clear()
    rt = root("Cat")
    ORANGE, CREAM, PINK = (0.88, 0.55, 0.25), (0.98, 0.92, 0.82), (0.95, 0.6, 0.6)
    def tabby(p, n):
        if n.z < -0.5:
            return CREAM
        s = math.sin(p.y * 70 + 3 * noise.noise(p * 8)) > 0.35
        return scl(ORANGE, 0.75 if s else 1.0)
    b = sphere_bm(1, 26, 16)
    deform(b, lambda v: Vector((v.x * 0.085 * (1 - 0.08 * v.y), v.y * 0.2, v.z * 0.09)) + Vector((0, 0, 0.27)))
    bo = from_bm(b, "CatBody", material("CatFur", rough=0.9), parent=rt)
    subsurf(bo, 1)
    paint(bo, tabby)
    hd = sphere_bm(1, 22, 14)
    deform(hd, lambda v: Vector((v.x * 0.072, v.y * 0.065, v.z * 0.062)) + Vector((0, -0.24, 0.36)))
    mz = sphere_bm(1, 14, 8)
    deform(mz, lambda v: Vector((v.x * 0.035, v.y * 0.025, v.z * 0.025)) + Vector((0, -0.295, 0.34)))
    ears = []
    for sx in (1, -1):
        e = cone_bm(0.03, 0.002, 0.055, 4)
        deform(e, lambda v: Vector((v.x, v.y * 0.4, v.z)))
        xform(e, Matrix.Translation((sx * 0.042, -0.235, 0.425)) @ Euler((0.0, sx * 0.3, 0)).to_matrix().to_4x4())
        ears.append(e)
    ho = from_bm(merge_bms([hd, mz] + ears), "CatHead", material("CatFur", rough=0.9), parent=rt)
    paint(ho, lambda p, n: PINK if p.z > 0.43 and abs(p.x) > 0.03 and n.y < -0.3 else (CREAM if p.y < -0.28 and p.z < 0.35 else tabby(p, n)))
    ey = [xform(sphere_bm(0.011, 10, 6), Matrix.Translation((sx * 0.03, -0.295, 0.375))) for sx in (1, -1)] + [xform(sphere_bm(0.008, 8, 5), Matrix.Translation((0, -0.32, 0.35)))]
    eyo = from_bm(merge_bms(ey), "CatEyes", material("Eye", rough=0.05, spec=0.9), parent=rt)
    paint(eyo, lambda p, n: PINK if p.y < -0.315 else (0.35, 0.75, 0.25))
    wh = []
    for sx in (1, -1):
        for k in range(3):
            wh.append(limb_bm((sx * 0.02, -0.31, 0.343 - k * 0.006), (sx * 0.1, -0.29, 0.355 - k * 0.012), 0.0012, 0.0008, 4, caps=False))
    who = from_bm(merge_bms(wh), "CatWhiskers", material("Whisker", rough=0.5), parent=rt)
    paint(who, solid((0.95, 0.95, 0.95)))
    tl = []
    for i in range(16):
        t = i / 15
        c = Vector((0, 0.18 + t * 0.12, 0.29 + t * 0.22 + 0.04 * math.sin(t * 4)))
        tl.append(xform(sphere_bm(0.024 - 0.007 * t, 10, 7), Matrix.Translation(c)))
    tlo = from_bm(merge_bms(tl), "Tail", material("CatFur", rough=0.9), parent=rt, origin=(0, 0.18, 0.29))
    paint(tlo, lambda p, n: scl(ORANGE, 0.7 if math.sin(p.z * 60) > 0.3 else 1.0))
    for nm, (x, y) in {"LegFL": (-0.045, -0.13), "LegFR": (0.045, -0.13), "LegBL": (-0.05, 0.14), "LegBR": (0.05, 0.14)}.items():
        lg = limb_bm((x, y, 0.25), (x, y, 0.02), 0.022, 0.016, 10)
        paw = sphere_bm(1, 10, 6)
        deform(paw, lambda v: Vector((v.x * 0.02, v.y * 0.026, v.z * 0.013)))
        xform(paw, Matrix.Translation((x, y - 0.008, 0.013)))
        lo = from_bm(merge_bms([lg, paw]), nm, material("CatFur", rough=0.9), parent=rt, origin=(x, y, 0.25))
        paint(lo, lambda p, n: CREAM if p.z < 0.06 else tabby(p, n))
    export("Cat")

def build_cat_loaf():
    """Duchess asleep: curled up in a loaf, chin on her paws, tail wrapped round, eyes shut."""
    clear()
    rt = root("CatLoaf")
    ORANGE, CREAM = (0.88, 0.55, 0.25), (0.98, 0.92, 0.82)
    def tabby(p, n):
        if n.z < -0.5:
            return CREAM
        s = math.sin(p.y * 70 + 3 * noise.noise(p * 8)) > 0.35
        return scl(ORANGE, 0.75 if s else 1.0)
    b = sphere_bm(1, 26, 16)
    deform(b, lambda v: Vector((v.x * 0.11, v.y * 0.17, v.z * 0.075 * (1 if v.z > 0 else 0.6))) + Vector((0, 0.02, 0.07)))
    bo = from_bm(b, "LoafBody", material("CatFur", rough=0.9), parent=rt)
    subsurf(bo, 1)
    paint(bo, tabby)
    hd = sphere_bm(1, 20, 12)
    deform(hd, lambda v: Vector((v.x * 0.07, v.y * 0.062, v.z * 0.055)) + Vector((0.01, -0.15, 0.085)))
    ears = []
    for sx in (1, -1):
        e = cone_bm(0.028, 0.002, 0.045, 4)
        deform(e, lambda v: Vector((v.x, v.y * 0.4, v.z)))
        xform(e, Matrix.Translation((0.01 + sx * 0.04, -0.15, 0.14)) @ Euler((0.2, sx * 0.35, 0)).to_matrix().to_4x4())
        ears.append(e)
    pw = []
    for sx in (1, -1):
        q = sphere_bm(1, 10, 6); deform(q, lambda v: Vector((v.x * 0.024, v.y * 0.04, v.z * 0.018))); xform(q, Matrix.Translation((sx * 0.032, -0.175, 0.03))); pw.append(q)
    ho = from_bm(merge_bms([hd] + ears + pw), "LoafHead", material("CatFur", rough=0.9), parent=rt)
    paint(ho, lambda p, n: CREAM if p.z < 0.04 or (p.y < -0.19 and p.z < 0.08) else tabby(p, n))
    lids = [limb_bm((0.01 + sx * 0.02, -0.205, 0.095), (0.01 + sx * 0.045, -0.2, 0.093), 0.003, 0.003, 4, caps=False) for sx in (1, -1)]
    lio = from_bm(merge_bms(lids), "LoafEyes", material("Eye", rough=0.5), parent=rt)
    paint(lio, solid((0.15, 0.1, 0.08)))
    tl = []
    for i in range(18):
        a = -0.9 + i / 17 * 2.9
        c = Vector((math.cos(a) * 0.125, math.sin(a) * 0.17 + 0.03, 0.03))
        tl.append(xform(sphere_bm(0.026 - 0.008 * i / 17, 10, 7), Matrix.Translation(c)))
    tlo = from_bm(merge_bms(tl), "LoafTail", material("CatFur", rough=0.9), parent=rt)
    paint(tlo, lambda p, n: scl(ORANGE, 0.7 if math.sin(math.atan2(p.y, p.x) * 12) > 0.3 else 1.0))
    export("CatLoaf")

def build_pellets():
    """A little pile of fortified guinea pig pellets."""
    clear()
    random.seed(105)
    rt = root("Pellets")
    pel = []
    for i in range(26):
        rr = math.sqrt(random.random()) * 0.035
        a = random.random() * math.tau
        z = 0.006 + (0.035 - rr) * 0.5 + random.random() * 0.004
        c = limb_bm((0, 0, 0), (0.014, 0, 0), 0.0045, 0.0045, 6)
        xform(c, Matrix.Translation((math.cos(a) * rr, math.sin(a) * rr, z)) @ Euler((random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.random() * math.tau)).to_matrix().to_4x4())
        pel.append(c)
    po = from_bm(merge_bms(pel), "PelletPile", material("Veg", rough=0.8), parent=rt)
    paint(po, lambda p, n: mix((0.42, 0.52, 0.22), (0.6, 0.5, 0.25), noise.noise(p * 80) * 0.5 + 0.5))
    export("Pellets")

jobs = {
    "GuineaPig": build_guinea_pig, "Human": build_human, "Oak": lambda: build_oak("Oak", 1),
    "Oak2": lambda: build_oak("Oak2", 9), "Pine": build_pine, "Birch": build_birch, "Bush": build_bush,
    "Rock": lambda: build_rock("Rock", 5), "Rock2": lambda: build_rock("Rock2", 17), "Log": build_log,
    "Burrow": build_burrow, "LeafPile": build_leafpile, "Dandelion": build_dandelion,
    "Clover": lambda: build_clover("Clover", 3), "Clover4": lambda: build_clover("Clover4", 4),
    "Carrot": build_carrot, "Pepper": build_pepper, "Strawberry": build_strawberry,
    "MushroomBrown": lambda: build_mushroom("MushroomBrown", (0.55, 0.36, 0.2), False),
    "MushroomRed": lambda: build_mushroom("MushroomRed", (0.8, 0.08, 0.05), True),
    "Hay": build_hay,
    "Grass": lambda: build_grass("Grass", 9, 0.07, 0.17, 0.05, (0.10, 0.25, 0.05), (0.42, 0.62, 0.18), seed=2),
    "LushGrass": lambda: build_grass("LushGrass", 22, 0.16, 0.3, 0.09, (0.12, 0.35, 0.06), (0.55, 0.85, 0.25), seedheads=True, seed=3),
    "Fern": build_fern, "FlowerWhite": lambda: build_flower("FlowerWhite", (0.97, 0.96, 0.95)),
    "FlowerPurple": lambda: build_flower("FlowerPurple", (0.62, 0.35, 0.85)),
    "Hawk": build_hawk, "Fox": build_fox, "House": build_house, "GardenBed": build_gardenbed,
    "Fence": build_fence, "Blanket": build_blanket,
    "Sunflower": build_sunflower, "Barn": build_barn, "Shop": build_shop, "LampPost": build_lamppost, "Bench": build_bench,
    "Goat": build_goat, "Sheep": build_sheep, "Duck": build_duck, "Car": build_car, "Cattail": build_cattail,
    "Umbrella": build_umbrella, "Sandcastle": build_sandcastle, "Scarecrow": build_scarecrow, "Fountain": build_fountain,
    "RoseHip": build_rosehip, "RaspLeaf": build_raspleaf, "Lettuce": build_lettuce, "Watermelon": build_watermelon, "Cress": build_cress,
    "Corn": build_corn, "Apple": build_apple, "Seeds": build_seeds, "Snowdrift": build_snowdrift, "Bramble": build_bramble,
    "MarketStall": build_market_stall, "Basket": build_basket, "CressBed": build_cress_bed, "Trough": build_trough,
    "AppleTree": build_apple_tree, "SunflowerHead": build_sunflower_head,
    "BarnInside": build_barn_inside, "HayPile": build_hay_pile, "BarnHole": build_barn_hole, "Twig": build_twig,
    "PetShopInside": build_petshop_inside, "CatFlap": build_cat_flap, "Cat": build_cat, "CatLoaf": build_cat_loaf, "Pellets": build_pellets,
}
for k, fn in jobs.items():
    if only and k not in only:
        continue
    random.seed(k)
    fn()
print("DONE")
