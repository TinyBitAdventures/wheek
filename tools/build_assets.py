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
        x = -0.5 + i * 0.28
        st = limb_bm((x + 0.12, 0.1 * (i % 2), cz + Ro * 0.95), (x + 0.12, 0.1 * (i % 2), cz + Ro * 0.95 + 0.04), 0.008, 0.007, 8)
        cap = sphere_bm(1, 12, 8)
        deform(cap, lambda v: Vector((v.x * 0.03, v.y * 0.03, max(v.z, -0.2) * 0.018)))
        xform(cap, Matrix.Translation((x + 0.12, 0.1 * (i % 2), cz + Ro * 0.95 + 0.045)))
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
}
for k, fn in jobs.items():
    if only and k not in only:
        continue
    random.seed(k)
    fn()
print("DONE")
