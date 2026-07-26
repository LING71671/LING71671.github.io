# -*- coding: utf-8 -*-
"""
3D 书桌博客 —— Blender 程序化建模与 GLB 导出脚本。

用法（无头运行）:
  E:\\Blender\\blender.exe --background --factory-startup --python scripts/blender/build_desk.py -- <输出目录>

产出:
  <输出目录>/clock.glb  （时钟，入口先行加载）
  <输出目录>/desk.glb   （书桌、房间与其余物件）

坐标契约（与 src/three/config/layout.ts 保持同步）:
  three.js: 米制, Y 向上, 桌面上表面 y=0.75, 窗在 -X 侧, 观者朝 -Z 看。
  Blender:  Z 向上; 映射 three(x, y, z) -> blender(x, -z, y)。
  glTF 导出器会把顶点数据转为 +Y up, 物体保持恒等旋转 ->
  时针/分针/秒针建成沿 Blender +Z 延伸、表盘法线朝 Blender -Y,
  运行时绕 glTF 局部 Z 旋转即在表盘平面内转动。

命名契约: 与 src/three/config/naming.ts 完全一致（snake_case, 禁 .001 后缀）。
"""

import bpy
import bmesh
import math
import sys
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- 布局（同 layout.ts）
DESK_TOP_Y = 0.75
DESK = dict(w=1.6, d=0.8, top=DESK_TOP_Y, thickness=0.045)
WALL_Z = -0.55
WINDOW = dict(x=-0.62, y=1.45, w=0.78, h=0.9, z=-0.54)
CLOCK = dict(x=-0.38, z=0.08, face_r=0.075, stand_h=0.1)
LAMP = dict(x=-0.58, z=-0.18, pole_h=0.42)
MONITOR = dict(x=0.12, z=-0.24, sw=0.54, sh=0.31, stand_h=0.12)
CALENDAR = dict(x=0.58, z=-0.18, w=0.14, h=0.16)
NOTEBOOK = dict(x=0.02, z=0.14, w=0.38, d=0.27)
COFFEE = dict(x=0.34, z=0.1, r=0.045, h=0.095)
STICKY = dict(x=0.56, z=0.24, size=0.07)
DRAWER = dict(x=0.38, face_w=0.42, face_h=0.12, depth=0.34, travel=0.24)


def P(x, y, z):
    """three.js 坐标 -> Blender 坐标"""
    return (x, -z, y)


# ---------------------------------------------------------------- 场景清理
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            block.remove(item)


# ---------------------------------------------------------------- PBR 贴图（CC0, Poly Haven）
import os

ASSET_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TEX_DIR = os.path.join(ASSET_ROOT, "assets-src", "textures")
MODEL_DIR = os.path.join(ASSET_ROOT, "assets-src", "models")


def import_asset(slug, name, location, rot_z=0.0, target_height=None,
                 target_width=None, max_parts=None):
    """
    导入 Poly Haven CC0 模型（1k gltf），合并为单个对象并按契约命名。
    location 用 three 坐标（内部经 P() 转换）；target_height/width 按包围盒等比缩放（米）。
    返回导入后的对象，失败返回 None。
    """
    path = os.path.join(MODEL_DIR, slug, f"{slug}_1k.gltf")
    if not os.path.exists(path):
        print(f"[import] MISSING {path}")
        return None

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == 'MESH']
    if not meshes:
        for o in imported:
            bpy.data.objects.remove(o, do_unlink=True)
        print(f"[import] NO MESH in {slug}")
        return None

    # 先解除父子关系并保留世界变换，再合并（join 会销毁被合并对象的 StructRNA）
    non_mesh = [o for o in imported if o.type != 'MESH']
    for m in meshes:
        if m.parent is not None:
            world = m.matrix_world.copy()
            m.parent = None
            m.matrix_world = world
    bpy.context.view_layer.update()

    for o in non_mesh:
        bpy.data.objects.remove(o, do_unlink=True)

    # 只保留体积最大的 max_parts 个部件（成套素材常含一整排同类物，桌面上放不下）
    if max_parts and len(meshes) > max_parts:
        def volume(o):
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            dx = max(v.x for v in bb) - min(v.x for v in bb)
            dy = max(v.y for v in bb) - min(v.y for v in bb)
            dz = max(v.z for v in bb) - min(v.z for v in bb)
            return dx * dy * dz
        meshes.sort(key=volume, reverse=True)
        for extra in meshes[max_parts:]:
            bpy.data.objects.remove(extra, do_unlink=True)
        meshes = meshes[:max_parts]

    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 归一化：原点移到底部中心
    bbox = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    min_v = Vector((min(v.x for v in bbox), min(v.y for v in bbox),
                    min(v.z for v in bbox)))
    max_v = Vector((max(v.x for v in bbox), max(v.y for v in bbox),
                    max(v.z for v in bbox)))
    size = max_v - min_v
    center_xy = ((min_v.x + max_v.x) / 2, (min_v.y + max_v.y) / 2)
    obj.data.transform(Matrix.Translation(
        (-center_xy[0], -center_xy[1], -min_v.z)))

    scale = 1.0
    if target_height and size.z > 1e-6:
        scale = target_height / size.z
    elif target_width and size.x > 1e-6:
        scale = target_width / size.x
    if scale != 1.0:
        obj.data.transform(Matrix.Diagonal((scale, scale, scale, 1.0)))

    obj.name = name
    obj.data.name = name
    obj.location = P(*location)
    obj.rotation_euler = (0, 0, rot_z)
    obj.rotation_mode = 'XYZ'
    print(f"[import] {slug} -> {name} scale={scale:.3f} size={tuple(round(v,3) for v in size)}")
    return obj


def load_image(filename):
    path = os.path.join(TEX_DIR, filename)
    img = bpy.data.images.load(path, check_existing=True)
    img.pack()
    return img


def textured_material(name, diff_file, rough_file=None, rough=0.55,
                      tint=None, mapping_scale=None):
    """图像贴图材质；mapping_scale 经 KHR_texture_transform 导出（three 支持）"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    def tex_node(filename, non_color=False):
        node = nodes.new("ShaderNodeTexImage")
        node.image = load_image(filename)
        if non_color:
            node.image.colorspace_settings.name = 'Non-Color'
        if mapping_scale:
            mapping = nodes.new("ShaderNodeMapping")
            mapping.inputs["Scale"].default_value = (*mapping_scale, 1.0)
            uv = nodes.new("ShaderNodeTexCoord")
            links.new(uv.outputs["UV"], mapping.inputs["Vector"])
            links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    diff = tex_node(diff_file)
    linked = False
    if tint:
        try:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs["Factor"].default_value = 1.0
            color_inputs = [s for s in mix.inputs if s.type == 'RGBA']
            color_inputs[1].default_value = (*tint, 1.0)
            color_out = next(s for s in mix.outputs if s.type == 'RGBA')
            links.new(diff.outputs["Color"], color_inputs[0])
            links.new(color_out, bsdf.inputs["Base Color"])
            linked = True
        except Exception:
            linked = False
    if not linked:
        links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])

    if rough_file:
        rough_node = tex_node(rough_file, non_color=True)
        links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])
    elif "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = rough
    return m


def emissive_texture_material(name, diff_file, strength=1.0):
    """自发光贴图材质：窗外实景用，不被室内光照压暗"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = load_image(diff_file)
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if "Emission Color" in bsdf.inputs:
        links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = strength
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 1.0
    return m


# ---------------------------------------------------------------- 材质
_materials = {}


def mat(name, color, rough=0.8, metal=0.0, emission=None, emission_strength=0.0,
        alpha=None):
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")

    def set_input(node, key, value):
        if node and key in node.inputs:
            node.inputs[key].default_value = value

    set_input(bsdf, "Base Color", (*color, 1.0))
    set_input(bsdf, "Roughness", rough)
    set_input(bsdf, "Metallic", metal)
    if emission is not None:
        set_input(bsdf, "Emission Color", (*emission, 1.0))
        set_input(bsdf, "Emission Strength", emission_strength)
    if alpha is not None:
        set_input(bsdf, "Alpha", alpha)
        m.blend_method = 'BLEND'
    _materials[name] = m
    return m


def build_materials():
    tex = dict(
        # 真实 PBR 贴图（CC0 / Poly Haven）
        wood_desk=textured_material("wood_desk", "wood_table_001_diff_1k.jpg",
                                    rough_file="wood_table_001_rough_1k.jpg"),
        # UV 密度由 set_uv_density 统一控制，材质里不再叠 mapping
        wood_floor=textured_material("wood_floor", "wood_floor_diff_1k.jpg",
                                     rough=0.8, tint=(0.55, 0.42, 0.32)),
        wall_plaster=textured_material("wall_plaster", "plaster.jpg",
                                       rough=0.95, tint=(0.88, 0.80, 0.68)),
        terracotta=textured_material("terracotta", "terracotta.jpg",
                                     rough=0.8, tint=(0.85, 0.62, 0.45),
                                     mapping_scale=(2.0, 2.0)),
        soil=mat("soil", (0.13, 0.09, 0.06), rough=1.0),
        # 窗外实景：自发光贴图（不受室内光照压暗，像真的窗外天光）
        window_view=emissive_texture_material("window_view", "window_view.jpg",
                                              strength=1.0),
    )
    return dict(
        **tex,
        wood=mat("wood", (0.28, 0.16, 0.08), rough=0.6),
        wood_top=mat("wood_top", (0.33, 0.19, 0.10), rough=0.5),
        wood_dark=mat("wood_dark", (0.10, 0.055, 0.028), rough=0.7),
        # 抽屉内壁：浅色生木（与深色外壳形成明暗差，空腔深度才可读）
        wood_raw=mat("wood_raw", (0.52, 0.38, 0.24), rough=0.85),
        # 墙裙护墙板：奶油漆面，与墙体拉开一点明度差
        wainscot=mat("wainscot", (0.72, 0.66, 0.55), rough=0.7),
        # 日历正面：运行时注入 CanvasTexture（GitHub 提交记录）
        calendar_face=mat("calendar_face", (1.0, 1.0, 1.0), rough=0.92),
        wainscot_trim=mat("wainscot_trim", (0.62, 0.55, 0.45), rough=0.65),
        floor=mat("floor", (0.16, 0.10, 0.06), rough=0.9),
        wall=mat("wall", (0.62, 0.52, 0.38), rough=1.0),
        paper=mat("paper", (0.93, 0.88, 0.78), rough=0.9),
        paper_dim=mat("paper_dim", (0.85, 0.79, 0.66), rough=0.9),
        brass=mat("brass", (0.55, 0.38, 0.13), rough=0.28, metal=0.95),
        dark=mat("dark", (0.05, 0.045, 0.04), rough=0.5),
        ink=mat("ink", (0.08, 0.06, 0.04), rough=0.65),
        ceramic=mat("ceramic", (0.95, 0.91, 0.83), rough=0.32),
        coffee=mat("coffee", (0.10, 0.05, 0.02), rough=0.15),
        sticky=mat("sticky_paper", (0.92, 0.83, 0.47), rough=0.95),
        leaf=mat("leaf", (0.24, 0.35, 0.18), rough=0.85),
        glass=mat("glass", (0.85, 0.92, 0.95), rough=0.08, alpha=0.10),
        clock_face=mat("clock_face_mat", (0.90, 0.85, 0.72), rough=0.85),
        tick=mat("tick_mat", (0.33, 0.27, 0.20), rough=0.7,
                 emission=(0.79, 0.64, 0.36), emission_strength=0.01),
        bulb=mat("bulb_mat", (1.0, 0.93, 0.80), rough=0.4,
                 emission=(1.0, 0.70, 0.42), emission_strength=0.01),
        screen=mat("screen_mat", (0.02, 0.02, 0.02), rough=0.3,
                   emission=(1.0, 1.0, 1.0), emission_strength=0.4),
        second=mat("second_hand", (0.66, 0.52, 0.23), rough=0.4, metal=0.6),
    )


# ---------------------------------------------------------------- 建模助手
def auto_smooth(obj, angle_deg=40.0):
    """角度限制平滑：保留棱线（杯沿、桌角），曲面平滑。export_apply 会应用修改器。"""
    for poly in obj.data.polygons:
        poly.use_smooth = True
    try:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    except Exception:
        pass  # 老版本回退：整体平滑


def _finish(obj, name, material, smooth=False, bevel=0.0):
    obj.name = name
    obj.data.name = name
    if material:
        obj.data.materials.append(material)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
    if smooth:
        auto_smooth(obj)
    return obj


def add_box(name, size, loc, material, bevel=0.0, mesh_offset=(0, 0, 0)):
    """尺寸/偏移均为 Blender 坐标；mesh_offset 让原点偏离几何中心（pivot 控制）"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.data.transform(Matrix.Diagonal((*size, 1.0)))
    if mesh_offset != (0, 0, 0):
        obj.data.transform(Matrix.Translation(Vector(mesh_offset)))
    return _finish(obj, name, material, bevel=bevel)


def add_cylinder(name, r_top, r_bottom, depth, loc, material, verts=32,
                 smooth=True, axis='Z'):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r_bottom, radius2=r_top, depth=depth, location=loc)
    obj = bpy.context.object
    if axis == 'Y':
        obj.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
    return _finish(obj, name, material, smooth=smooth)


def add_sphere(name, radius, loc, material, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2,
                                         radius=radius, location=loc)
    return _finish(bpy.context.object, name, material, smooth=True)


def add_torus(name, major, minor, loc, material, rot=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     location=loc,
                                     major_segments=40, minor_segments=14)
    obj = bpy.context.object
    if rot:
        obj.rotation_euler = rot
    return _finish(obj, name, material, smooth=True)


def set_uv_density(obj, world_w, world_h, tile=0.8):
    """
    按世界尺寸重设 UV 密度：primitive 的每个面都是 0-1 UV，
    尺寸不同的墙板会呈现完全不同的纹理密度（大墙糊成一片、小墙纹理细碎）。
    统一成「每 tile 米一次平铺」。
    """
    uv = obj.data.uv_layers.active
    if not uv:
        return
    su = max(world_w, 0.01) / tile
    sv = max(world_h, 0.01) / tile
    for loop_uv in uv.data:
        loop_uv.uv.x *= su
        loop_uv.uv.y *= sv


def add_plane(name, w, h, loc, material, normal='-Y'):
    """默认法线朝 Blender -Y（即 three.js +Z，面向观者）"""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    obj = bpy.context.object
    obj.data.transform(Matrix.Diagonal((w, h, 1, 1)))
    if normal == '-Y':
        obj.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
    elif normal == '+Z':
        pass
    return _finish(obj, name, material)


def add_empty(name, loc):
    bpy.ops.object.empty_add(location=loc)
    obj = bpy.context.object
    obj.name = name
    return obj


def parent(children, root):
    for child in children:
        child.parent = root
        child.matrix_parent_inverse = root.matrix_world.inverted()


# ---------------------------------------------------------------- 时钟
def build_clock(M):
    cx, cz = CLOCK["x"], CLOCK["z"]
    face_y = DESK_TOP_Y + CLOCK["stand_h"] + CLOCK["face_r"]
    face_r = CLOCK["face_r"]

    root = add_empty("clock_root", P(cx, DESK_TOP_Y, cz))

    # 底座：黄铜横梁 + 两粒圆脚
    base = add_box("decor_clock_base", (0.095, 0.05, 0.016),
                   P(cx, DESK_TOP_Y + 0.016, cz), M["brass"], bevel=0.004)
    feet = []
    for i, fx in enumerate((-0.034, 0.034)):
        foot = add_sphere(f"decor_clock_foot_{i}", 0.009,
                          P(cx + fx, DESK_TOP_Y + 0.008, cz), M["brass"])
        feet.append(foot)
    stand = add_cylinder("decor_clock_stand", 0.007, 0.009, CLOCK["stand_h"],
                         P(cx, DESK_TOP_Y + 0.024 + CLOCK["stand_h"] / 2 - 0.01, cz),
                         M["brass"], verts=20)

    # 表壳：圆柱壳体（后移，前盖不得遮住表盘/刻度）+ 顶部提钮
    housing = add_cylinder("decor_clock_housing", face_r + 0.011, face_r + 0.011,
                           0.034, P(cx, face_y, cz - 0.018), M["brass"],
                           verts=48, axis='Y')
    bezel = add_torus("decor_clock_bezel", face_r + 0.0075, 0.0075,
                      P(cx, face_y, cz + 0.009), M["brass"],
                      rot=(math.radians(90), 0, 0))
    crown = add_sphere("decor_clock_crown", 0.011,
                       P(cx, face_y + face_r + 0.018, cz - 0.008), M["brass"])
    crown_neck = add_cylinder("decor_clock_neck", 0.004, 0.005, 0.012,
                              P(cx, face_y + face_r + 0.008, cz - 0.008),
                              M["brass"], verts=12)

    # 表盘（微凹：外盘 + 内芯浅色）
    face = add_cylinder("clock_face", face_r, face_r, 0.005,
                        P(cx, face_y, cz + 0.004), M["clock_face"], verts=56, axis='Y')

    # 刻度：60 根合并为 clock_ticks
    tick_meshes = []
    for i in range(60):
        major = i % 5 == 0
        angle = i / 60 * math.tau
        r = face_r - 0.010
        tx = cx + math.sin(angle) * r
        ty = face_y + math.cos(angle) * r
        t = add_box(f"__tick_{i}",
                    (0.0035 if major else 0.0016, 0.001, 0.010 if major else 0.005),
                    P(tx, ty, cz + 0.0075), M["tick"])
        t.rotation_euler.y = angle
        tick_meshes.append(t)
    bpy.ops.object.select_all(action='DESELECT')
    for t in tick_meshes:
        t.select_set(True)
    bpy.context.view_layer.objects.active = tick_meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.join()
    ticks = bpy.context.object
    ticks.name = "clock_ticks"
    ticks.data.name = "clock_ticks"

    # 数字 12/3/6/9（文字转网格）
    numerals = []
    for text, nx, ny in [("12", 0, 0.62), ("3", 0.62, 0), ("6", 0, -0.66), ("9", -0.62, 0)]:
        bpy.ops.object.text_add(
            location=P(cx + nx * face_r, face_y + ny * face_r, cz + 0.0075))
        t = bpy.context.object
        t.data.body = text
        t.data.size = 0.024
        t.data.align_x = 'CENTER'
        t.data.align_y = 'CENTER'
        t.data.extrude = 0.0005
        bpy.ops.object.convert(target='MESH')
        obj = bpy.context.object
        obj.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
        numerals.append(_finish(obj, f"decor_clock_num_{text}", M["ink"]))

    # 指针：锥形（扁平化的细长圆锥）+ 尾部配重，原点在轴心
    def hand(name, length, w_root, w_tip, material, z_front, counterweight):
        bpy.ops.mesh.primitive_cone_add(
            vertices=8, radius1=w_root, radius2=w_tip, depth=length,
            location=P(cx, face_y, cz + z_front))
        obj = bpy.context.object
        # 压扁厚度 + 轴心移到尾部 12%
        obj.data.transform(Matrix.Diagonal((1.0, 0.32, 1.0, 1.0)))
        obj.data.transform(Matrix.Translation((0, 0, length / 2 - length * 0.14)))
        _finish(obj, name, material)
        if counterweight:
            bpy.ops.mesh.primitive_uv_sphere_add(
                segments=14, ring_count=8, radius=w_root * 1.4,
                location=P(cx, face_y, cz + z_front))
            cw = bpy.context.object
            cw.data.transform(Matrix.Diagonal((1.0, 0.4, 1.0, 1.0)))
            cw.data.transform(Matrix.Translation((0, 0, -length * 0.17)))
            cw.data.materials.append(material)
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            cw.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.join()
        return obj

    hour = hand("clock_hand_hour", face_r * 0.55, 0.0042, 0.0016, M["ink"], 0.011, True)
    minute = hand("clock_hand_minute", face_r * 0.82, 0.0034, 0.0012, M["ink"], 0.014, True)
    second = hand("clock_hand_second", face_r * 0.88, 0.0012, 0.0008, M["second"], 0.017, True)

    hub = add_sphere("decor_clock_hub", 0.006, P(cx, face_y, cz + 0.019), M["brass"])

    objs = [base, stand, housing, bezel, crown, crown_neck, face, ticks,
            hour, minute, second, hub] + feet + numerals
    parent(objs, root)
    # 旋转必须在 parent 之后设置（matrix_parent_inverse 会抵消先设的旋转）
    root.rotation_euler.z = 0.12
    return [root] + objs


# ---------------------------------------------------------------- 房间
def build_room(M):
    objs = []
    floor = add_plane("decor_floor", 8, 6, (0, 0, 0), M["wood_floor"], normal='+Z')
    set_uv_density(floor, 8, 6, tile=1.1)
    objs.append(floor)

    # 后墙（含窗洞）：四块板
    wz = WALL_Z
    wx, wy = WINDOW["x"], WINDOW["y"]
    ww, wh = WINDOW["w"], WINDOW["h"]
    wall_h, wall_w, t = 3.0, 8.0, 0.05
    left_edge, right_edge = wx - ww / 2, wx + ww / 2
    bottom, top = wy - wh / 2, wy + wh / 2

    def wall_seg(name, seg_w, seg_h, x, y):
        if seg_w <= 0 or seg_h <= 0:
            return None
        obj = add_box(name, (seg_w, t, seg_h), P(x, y, wz - t / 2 + 0.01),
                      M["wall_plaster"])
        set_uv_density(obj, seg_w, seg_h, tile=0.9)
        return obj

    objs += [o for o in [
        wall_seg("decor_wall_l", left_edge + wall_w / 2, wall_h,
                 (-wall_w / 2 + left_edge) / 2, wall_h / 2),
        wall_seg("decor_wall_r", wall_w / 2 - right_edge, wall_h,
                 (right_edge + wall_w / 2) / 2, wall_h / 2),
        wall_seg("decor_wall_b", ww, bottom, wx, bottom / 2),
        wall_seg("decor_wall_t", ww, wall_h - top, wx, (top + wall_h) / 2),
    ] if o]

    # —— 墙面装修：踢脚线 + 腰线 + 墙裙竖板条（毛坯 → 书房） ——
    skirt_h = 0.09
    skirt = add_box("decor_skirting", (wall_w, 0.02, skirt_h),
                    P(0, skirt_h / 2, wz + 0.014), M["wainscot_trim"], bevel=0.003)
    objs.append(skirt)
    rail_y = 0.92
    rail = add_box("decor_chair_rail", (wall_w, 0.022, 0.030),
                   P(0, rail_y, wz + 0.016), M["wainscot_trim"], bevel=0.003)
    objs.append(rail)
    # 墙裙：整块浅色护墙板 + 稀疏细压条（深色细竖条会读成黑栅栏，改浅色宽板）
    panel = add_box("decor_wainscot_panel", (wall_w, 0.010, rail_y - skirt_h),
                    P(0, (rail_y + skirt_h) / 2, wz + 0.006), M["wainscot"])
    objs.append(panel)
    # 挂镜线（腰线上方的一道细木条，把大片空白墙面分割出层次）
    picture_rail = add_box("decor_picture_rail", (wall_w, 0.018, 0.022),
                           P(0, 2.05, wz + 0.014), M["wainscot_trim"], bevel=0.002)
    objs.append(picture_rail)
    for i in range(7):
        px = -wall_w / 2 + wall_w * (i + 0.5) / 7
        strip = add_box(f"decor_wainscot_{i}", (0.016, 0.006, rail_y - skirt_h - 0.06),
                        P(px, (rail_y + skirt_h) / 2, wz + 0.014), M["wainscot_trim"])
        objs.append(strip)

    # —— 挂画两幅（窗右侧墙面） ——
    art_specs = [
        # (中心x, 中心y, 宽, 高, 画心色)
        (0.85, 1.75, 0.34, 0.44, (0.72, 0.55, 0.33)),   # 暖赭抽象
        (1.45, 1.55, 0.26, 0.32, (0.35, 0.42, 0.30)),   # 苔绿小画
    ]
    for i, (ax, ay, aw, ah, color) in enumerate(art_specs):
        frame = add_box(f"decor_art_frame_{i}", (aw + 0.05, 0.025, ah + 0.05),
                        P(ax, ay, wz + 0.015), M["wood_dark"], bevel=0.004)
        matboard = add_box(f"decor_art_mat_{i}", (aw + 0.02, 0.006, ah + 0.02),
                           P(ax, ay, wz + 0.028), M["paper"])
        art_mat = mat(f"art_color_{i}", color, rough=0.9)
        canvas = add_box(f"decor_art_canvas_{i}", (aw, 0.004, ah),
                         P(ax, ay, wz + 0.032), art_mat)
        objs += [frame, matboard, canvas]

    # —— 墙边小书架（右墙角，几本立着的书） ——
    shelf_x, shelf_y = 1.15, 1.12
    shelf = add_box("decor_shelf", (0.5, 0.16, 0.022),
                    P(shelf_x, shelf_y, wz + 0.09), M["wood_desk"], bevel=0.003)
    objs.append(shelf)
    # 书架上的书：真实 CC0 模型（百科全书套装）
    books = import_asset("book_encyclopedia_set_01", "decor_shelf_books",
                         (shelf_x, shelf_y + 0.011, wz + 0.09),
                         rot_z=0.0, target_width=0.42)
    if books:
        objs.append(books)

    # 窗框 + 玻璃 + 窗台
    win_root = add_empty("window_root", P(wx, wy, WINDOW["z"]))
    frame_t = 0.045
    bars = []
    for name, bw, bh, bx, by in [
        ("decor_winbar_top", ww + frame_t, frame_t, 0, wh / 2),
        ("decor_winbar_bottom", ww + frame_t, frame_t, 0, -wh / 2),
        ("decor_winbar_left", frame_t, wh, -ww / 2, 0),
        ("decor_winbar_right", frame_t, wh, ww / 2, 0),
        ("decor_winbar_mid", frame_t * 0.6, wh, 0, 0),
    ]:
        bars.append(add_box(name, (bw, 0.05, bh),
                            P(wx + bx, wy + by, WINDOW["z"]), M["wood_dark"],
                            bevel=0.005))
    glass = add_plane("window_glass", ww, wh, P(wx, wy, WINDOW["z"]), M["glass"])
    sill = add_box("decor_sill", (ww + 0.14, 0.12, 0.03),
                   P(wx, wy - wh / 2 - 0.015, WINDOW["z"] + 0.03), M["wood_dark"],
                   bevel=0.005)

    # —— 窗外实景：真实照片板 ——
    # 距离要近：放太远的话窗口只框到照片中间一小块（看起来就是一片天空）。
    # 放在墙后 0.42m，尺寸按 3:2 取，窗口正好框住照片中段的景物。
    # 板心比窗心低一截：照片的山峰与霞光在上半部，压低板子才能把它们框进窗内
    view = add_plane("decor_window_view", 1.90, 1.27,
                     P(wx, wy - 0.30, WALL_Z - 0.42), M["window_view"])

    # —— 窗台盆栽：真实 CC0 模型（Poly Haven potted_plant_01） ——
    plant_objs = []
    plant = import_asset("potted_plant_01", "decor_potted_plant",
                         (wx - ww / 2 + 0.15, wy - wh / 2 + 0.015, WINDOW["z"] + 0.06),
                         rot_z=0.6, target_height=0.30)
    if plant:
        plant_objs.append(plant)

    parent(bars + [glass, sill] + plant_objs, win_root)
    objs += [win_root, glass, sill, view] + bars + plant_objs
    return objs


# ---------------------------------------------------------------- 书桌
def build_desk(M):
    objs = []
    dz = -0.08  # 桌面中心的 three-Z 偏移（同占位场景）
    top = add_box("desk_top", (DESK["w"], DESK["d"], DESK["thickness"]),
                  P(0, DESK["top"] - DESK["thickness"] / 2, dz), M["wood_desk"],
                  bevel=0.008)
    objs.append(top)

    leg_h = DESK["top"] - DESK["thickness"]
    for i, (lx, lz) in enumerate([
        (-DESK["w"] / 2 + 0.06, dz - DESK["d"] / 2 + 0.06),
        (DESK["w"] / 2 - 0.06, dz - DESK["d"] / 2 + 0.06),
        (-DESK["w"] / 2 + 0.06, dz + DESK["d"] / 2 - 0.06),
        (DESK["w"] / 2 - 0.06, dz + DESK["d"] / 2 - 0.06),
    ]):
        leg = add_cylinder(f"decor_leg_{i}", 0.026, 0.034, leg_h,
                           P(lx, leg_h / 2, lz), M["wood_desk"], verts=16)
        objs.append(leg)

    # 前梁：为抽屉留出真实开口（左右两段 + 抽屉上方过梁），否则抽屉面板与梁穿模
    apron_y = DESK["top"] - DESK["thickness"] - 0.08
    apron_z = dz + DESK["d"] / 2 - 0.02
    # 开口要比面板小一圈（面板盖住开口边缘），否则关上时四周漏出内腔的浅色
    opening_w = DRAWER["face_w"] - 0.008
    opening_h = DRAWER["face_h"] - 0.008
    apron_left_x = -(DESK["w"] - 0.18) / 2
    apron_right_x = (DESK["w"] - 0.18) / 2
    open_left = DRAWER["x"] - opening_w / 2
    open_right = DRAWER["x"] + opening_w / 2

    seg_l_w = open_left - apron_left_x
    if seg_l_w > 0.01:
        objs.append(add_box("decor_apron_l", (seg_l_w, 0.02, 0.16),
                            P(apron_left_x + seg_l_w / 2, apron_y, apron_z),
                            M["wood_desk"]))
    seg_r_w = apron_right_x - open_right
    if seg_r_w > 0.01:
        objs.append(add_box("decor_apron_r", (seg_r_w, 0.02, 0.16),
                            P(open_right + seg_r_w / 2, apron_y, apron_z),
                            M["wood_desk"]))
    # 开口上方与下方的过梁（0.16 高的前梁减去开口高度）
    top_strip = (0.16 - opening_h) / 2
    if top_strip > 0.005:
        objs.append(add_box("decor_apron_top", (opening_w, 0.02, top_strip),
                            P(DRAWER["x"], apron_y + opening_h / 2 + top_strip / 2,
                              apron_z), M["wood_desk"]))
        objs.append(add_box("decor_apron_bottom", (opening_w, 0.02, top_strip),
                            P(DRAWER["x"], apron_y - opening_h / 2 - top_strip / 2,
                              apron_z), M["wood_desk"]))

    # 抽屉
    drawer_root = add_empty("drawer_root",
                            P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                              dz + DESK["d"] / 2 - 0.02))
    # 开口内衬（框住抽屉四周，深度方向让位给抽屉本体，不再是挡在前面的实心板）
    housing = add_box("decor_drawer_housing",
                      (DRAWER["face_w"] + 0.024, 0.006, DRAWER["face_h"] + 0.024),
                      P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                        dz + DESK["d"] / 2 - 0.021 - DRAWER["depth"] - 0.004),
                      M["wood_dark"])
    slide_root = add_empty("drawer_slide",
                           P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                             dz + DESK["d"] / 2 - 0.02))
    face = add_box("decor_drawer_face", (DRAWER["face_w"], 0.018, DRAWER["face_h"]),
                   P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                     dz + DESK["d"] / 2 - 0.011), M["wood_desk"], bevel=0.004)

    # 抽屉本体：真实空腔（底板 + 三面薄壁；前壁即抽屉面板）
    # 内箱要能穿过开口，所以比开口再小一圈；高度绝不能超过面板，否则从正面看得见
    bw = DRAWER["face_w"] - 0.020         # 内箱宽
    bh = DRAWER["face_h"] - 0.016         # 内箱高
    bd = DRAWER["depth"] - 0.06           # 内箱深（缩短，比例更像书桌中屉）
    cy = DESK["top"] - DESK["thickness"] - 0.08          # 抽屉中心高
    cz_ = dz + DESK["d"] / 2 - 0.02 - bd / 2             # 内箱中心 three-Z
    wall_t = 0.012
    # 抽屉本体做成一体化托盘：整块 box 的顶面 inset 后下压，
    # 得到壁厚一致的真实空腔（分片拼装会在侧面留下「鳍片」）
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(DRAWER["x"], cy, cz_))
    tray = bpy.context.object
    tray.data.transform(Matrix.Diagonal((bw, bd, bh, 1.0)))

    bm = bmesh.new()
    bm.from_mesh(tray.data)
    bm.faces.ensure_lookup_table()
    top = max(bm.faces, key=lambda f: f.calc_center_median().z)
    inset = bmesh.ops.inset_region(bm, faces=[top], thickness=wall_t, use_even_offset=True)
    inner = [f for f in bm.faces if f.select] or [top]
    # inset_region 后原面仍是 top；把它向下挤出形成内腔
    bmesh.ops.translate(bm, verts=list(top.verts), vec=(0, 0, -(bh - wall_t)))
    bm.normal_update()
    bm.to_mesh(tray.data)
    bm.free()
    _finish(tray, "decor_drawer_tray", M["wood_raw"], bevel=0.002)
    body_parts = [tray]

    knob = add_sphere("decor_drawer_knob", 0.014,
                      P(DRAWER["x"], cy, dz + DESK["d"] / 2 + 0.006), M["brass"])

    # 抽屉里的物件：About Me 笔记本（米色封面 + 墨色书脊）+ 一支旧钥匙
    book = add_box("decor_drawer_book", (bw * 0.55, 0.014, bd * 0.52),
                   P(DRAWER["x"] - bw * 0.14, cy - bh / 2 + wall_t + 0.007,
                     cz_ + bd * 0.05), M["paper_dim"], bevel=0.002)
    book_spine = add_box("decor_drawer_book_spine", (bw * 0.55, 0.016, 0.014),
                         P(DRAWER["x"] - bw * 0.14, cy - bh / 2 + wall_t + 0.008,
                           cz_ + bd * 0.05 + bd * 0.26), M["ink"])
    key_ring = add_torus("decor_drawer_key", 0.012, 0.003,
                         P(DRAWER["x"] + bw * 0.27, cy - bh / 2 + wall_t + 0.004,
                           cz_ - bd * 0.18), M["brass"],
                         rot=(math.radians(90), 0, 0.6))
    key_stem = add_cylinder("decor_drawer_key_stem", 0.0025, 0.0025, 0.035,
                            P(DRAWER["x"] + bw * 0.27 + 0.02,
                              cy - bh / 2 + wall_t + 0.004,
                              cz_ - bd * 0.18 + 0.012), M["brass"], verts=8)
    key_stem.rotation_euler = (math.radians(90), 0, -0.5)

    drawer_items = [face] + body_parts + [knob, book, book_spine, key_ring, key_stem]
    parent(drawer_items, slide_root)
    parent([housing, slide_root], drawer_root)
    objs += [drawer_root, housing, slide_root] + drawer_items
    return objs


# ---------------------------------------------------------------- 台灯
def build_lamp(M):
    """黄铜台灯：分层底座 + 细杆 + 关节 + 带内衬的锥形灯罩"""
    x, z = LAMP["x"], LAMP["z"]
    top_y = DESK_TOP_Y + 0.026 + LAMP["pole_h"]
    root = add_empty("lamp_root", P(x, DESK_TOP_Y, z))

    # 底座：宽盘 + 收腰台阶（比单个圆柱更像实物）
    base_disc = add_cylinder("decor_lamp_base", 0.078, 0.088, 0.016,
                             P(x, DESK_TOP_Y + 0.008, z), M["brass"], verts=36)
    base_step = add_cylinder("decor_lamp_base_step", 0.042, 0.062, 0.018,
                             P(x, DESK_TOP_Y + 0.024, z), M["brass"], verts=32)
    felt = add_cylinder("decor_lamp_felt", 0.080, 0.080, 0.002,
                        P(x, DESK_TOP_Y + 0.001, z), M["ink"], verts=32)

    pole = add_cylinder("decor_lamp_pole", 0.009, 0.011, LAMP["pole_h"],
                        P(x, DESK_TOP_Y + 0.033 + LAMP["pole_h"] / 2, z), M["brass"],
                        verts=22)
    # 关节球（杆与灯头之间）
    joint = add_sphere("decor_lamp_joint", 0.017, P(x, top_y, z), M["brass"], seg=20)

    head = add_empty("lamp_head", P(x, top_y, z))

    shade_y = top_y + 0.022
    # 灯罩外壳：开口锥壳，**宽口朝下**（primitive_cone_add 的 radius1 是底面 -Z）
    bpy.ops.mesh.primitive_cone_add(
        vertices=36, radius1=0.092, radius2=0.030, depth=0.125,
        end_fill_type='NOTHING', location=P(x, shade_y, z))
    shade = bpy.context.object
    sm = shade.modifiers.new("solidify", 'SOLIDIFY')
    sm.thickness = 0.0022
    sm.offset = 0.0
    _finish(shade, "decor_lamp_shade", M["brass"], smooth=True)
    # 罩口卷边（在下沿）
    shade_rim = add_torus("decor_lamp_shade_rim", 0.092, 0.0028,
                          P(x, shade_y - 0.0625, z), M["brass"])
    # 内衬（朝下的暖白面，灯亮时是光的来源感）
    bpy.ops.mesh.primitive_cone_add(
        vertices=36, radius1=0.089, radius2=0.028, depth=0.120,
        end_fill_type='NOTHING', location=P(x, shade_y, z))
    liner = bpy.context.object
    _finish(liner, "decor_lamp_liner", M["bulb"], smooth=True)

    bulb = add_sphere("lamp_bulb", 0.026, P(x, shade_y - 0.030, z), M["bulb"], seg=20)
    bulb.scale = (1.0, 1.25, 1.0)
    socket = add_cylinder("decor_lamp_socket", 0.013, 0.015, 0.022,
                          P(x, shade_y + 0.006, z), M["dark"], verts=16)

    head.rotation_euler.y = -0.75
    parent([shade, shade_rim, liner, bulb, socket], head)
    parent([base_disc, base_step, felt, pole, joint, head], root)
    return [root, base_disc, base_step, felt, pole, joint, head,
            shade, shade_rim, liner, bulb, socket]


# ---------------------------------------------------------------- 显示器
def build_monitor(M):
    x, z = MONITOR["x"], MONITOR["z"]
    root = add_empty("monitor_root", P(x, DESK_TOP_Y, z))
    foot = add_cylinder("decor_mon_foot", 0.10, 0.13, 0.02,
                        P(x, DESK_TOP_Y + 0.01, z), M["dark"])
    neck = add_box("decor_mon_neck", (0.03, 0.02, MONITOR["stand_h"]),
                   P(x, DESK_TOP_Y + 0.02 + MONITOR["stand_h"] / 2, z), M["dark"])
    fw, fh = MONITOR["sw"] + 0.03, MONITOR["sh"] + 0.03
    frame = add_box("decor_mon_frame", (fw, 0.035, fh),
                    P(x, DESK_TOP_Y + MONITOR["stand_h"] + fh / 2, z), M["dark"],
                    bevel=0.006)
    screen = add_plane("monitor_screen", MONITOR["sw"], MONITOR["sh"],
                       P(x, DESK_TOP_Y + MONITOR["stand_h"] + fh / 2, z + 0.019),
                       M["screen"])
    parent([foot, neck, frame, screen], root)
    return [root, foot, neck, frame, screen]


# ---------------------------------------------------------------- 笔记本 / 咖啡 / 日历 / 便签 / 装饰
def build_notebook(M):
    x, z = NOTEBOOK["x"], NOTEBOOK["z"]
    root = add_empty("notebook_root", P(x, DESK_TOP_Y, z))
    w, d = NOTEBOOK["w"], NOTEBOOK["d"]
    objs = []

    # 硬封面（摊开的两片，比纸厚、深色布面）
    for side, sx in (("l", -1), ("r", 1)):
        cover = add_box(f"decor_book_cover_{side}", (w / 2 + 0.006, d + 0.010, 0.006),
                        P(x + sx * w / 4, DESK_TOP_Y + 0.003, z), M["ink"], bevel=0.002)
        objs.append(cover)

    # 纸页：微弯的曲面（细分 + Bend），左右各一叠，靠书脊处高、外缘低
    for side, sx, pmat in (("l", -1, M["paper"]), ("r", 1, M["paper_dim"])):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
        page = bpy.context.object
        page.data.transform(Matrix.Diagonal((w / 2 - 0.006, d - 0.004, 1, 1)))
        bm = bmesh.new()
        bm.from_mesh(page.data)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=8, use_grid_fill=True)
        bm.to_mesh(page.data)
        bm.free()
        thick = page.modifiers.new("solidify", 'SOLIDIFY')
        thick.thickness = 0.010
        thick.offset = -1.0
        bend = page.modifiers.new("bend", 'SIMPLE_DEFORM')
        bend.deform_method = 'BEND'
        bend.angle = math.radians(sx * 9)      # 极轻的翻页弧度
        bend.deform_axis = 'Y'
        page.location = P(x + sx * w / 4, DESK_TOP_Y + 0.0125, z)
        _finish(page, f"decor_page_{side}", pmat, smooth=True)
        objs.append(page)

    # 书脊
    spine = add_cylinder("decor_notebook_spine", 0.008, 0.008, d + 0.008,
                         P(x, DESK_TOP_Y + 0.010, z), M["ink"], verts=14, axis='Y')
    objs.append(spine)

    # 文具（真实 CC0 模型：笔 / 铅笔 / 橡皮），放在书右侧的桌面上（贴桌面，不悬空）
    pen = import_asset("stationery_supplies", "decor_stationery",
                       (x - w / 2 - 0.085, DESK_TOP_Y, z + 0.075),
                       rot_z=0.38, target_width=0.14, max_parts=3)
    if pen:
        objs.append(pen)
    parent(objs, root)
    root.rotation_euler.z = -0.06  # 旋转在 parent 之后设置才生效
    return [root] + objs


def build_coffee(M):
    x, z = COFFEE["x"], COFFEE["z"]
    r, h = COFFEE["r"], COFFEE["h"]
    root = add_empty("coffee_root", P(x, DESK_TOP_Y, z))

    # 碟：带内凹的浅盘（外盘 + 内圈下陷）
    saucer = add_cylinder("decor_saucer", r + 0.030, r + 0.010, 0.007,
                          P(x, DESK_TOP_Y + 0.0035, z), M["ceramic"], verts=44)
    saucer_well = add_cylinder("decor_saucer_well", r + 0.004, r + 0.002, 0.003,
                               P(x, DESK_TOP_Y + 0.0075, z), M["ceramic"], verts=36)

    # 杯体：微收腰筒壁（solidify 真实壁厚）
    bpy.ops.mesh.primitive_cone_add(
        vertices=44, radius1=r * 0.82, radius2=r, depth=h,
        end_fill_type='NOTHING',
        location=P(x, DESK_TOP_Y + 0.009 + h / 2, z))
    cup = bpy.context.object
    solid = cup.modifiers.new("solidify", 'SOLIDIFY')
    solid.thickness = 0.0040
    solid.offset = -1.0
    _finish(cup, "decor_cup", M["ceramic"], smooth=True)

    # 沿口圆环（杯口卷边，轮廓立刻「像杯子」）
    rim = add_torus("decor_cup_rim", r - 0.0018, 0.0022,
                    P(x, DESK_TOP_Y + 0.009 + h, z), M["ceramic"])

    # 杯底
    bottom = add_cylinder("decor_cup_bottom", r * 0.81, r * 0.74, 0.009,
                          P(x, DESK_TOP_Y + 0.0135, z), M["ceramic"], verts=36)

    # 咖啡液面（接近杯口，看得见的一杯咖啡）
    liquid = add_cylinder("decor_coffee_liquid", r * 0.93, r * 0.93, 0.002,
                          P(x, DESK_TOP_Y + 0.009 + h * 0.82, z),
                          M["coffee"], verts=44)

    # 杯把：C 形竖直环，明确「长」在杯壁上
    handle = add_torus("decor_cup_handle", 0.017, 0.0048,
                       P(x + r + 0.007, DESK_TOP_Y + 0.009 + h * 0.55, z),
                       M["ceramic"], rot=(math.radians(90), 0, 0))
    handle.scale = (0.62, 1.0, 1.05)

    steam = add_empty("coffee_steam_anchor", P(x, DESK_TOP_Y + h + 0.03, z))
    objs = [saucer, saucer_well, cup, rim, bottom, liquid, handle, steam]
    parent(objs, root)
    return [root] + objs


def build_calendar(M):
    """帐篷式台历：两块斜板 + 顶脊螺旋圈 + 前页大日期数字"""
    x, z = CALENDAR["x"], CALENDAR["z"]
    root = add_empty("calendar_root", P(x, DESK_TOP_Y, z))
    w, h = CALENDAR["w"], CALENDAR["h"]
    lean = 0.30
    # 两块斜板组成 A 形（底边分开、顶边相接）
    half_gap = math.sin(lean) * h / 2
    front = add_box("decor_cal_front", (w, 0.005, h),
                    P(x, DESK_TOP_Y + math.cos(lean) * h / 2, z + half_gap),
                    M["paper"], bevel=0.002)
    front.rotation_euler.x = -lean
    back = add_box("decor_cal_back", (w, 0.005, h),
                   P(x, DESK_TOP_Y + math.cos(lean) * h / 2, z - half_gap),
                   M["paper_dim"], bevel=0.002)
    back.rotation_euler.x = lean

    ridge_y = DESK_TOP_Y + math.cos(lean) * h
    # 顶脊螺旋装订圈：9 个小圆环
    rings = []
    for i in range(9):
        rx = x - w / 2 + w * (i + 0.5) / 9
        ring = add_torus(f"decor_cal_ring_{i}", 0.006, 0.0012,
                         P(rx, ridge_y + 0.002, z), M["dark"],
                         rot=(0, math.radians(90), 0))
        rings.append(ring)

    # 日历正面：整张前页都是贴图面（运行时 CanvasTexture 绘制 GitHub 提交记录，
    # 月份条与日期都画在贴图里，不再用 3D 几何体叠加）
    off = 0.005
    face = add_plane("calendar_face", w * 0.97, h * 0.97,
                     P(x,
                       DESK_TOP_Y + math.cos(lean) * h / 2 + math.sin(lean) * off,
                       z + half_gap + math.cos(lean) * off),
                     M["calendar_face"])
    face.rotation_euler.x = -lean

    objs = [front, back, face] + rings
    parent(objs, root)
    root.rotation_euler.z = -0.35  # 旋转在 parent 之后设置才生效
    return [root] + objs


def build_sticky(M):
    """便签：真实 CC0 便签本模型（office_notepads）"""
    x, z = STICKY["x"], STICKY["z"]
    root = add_empty("sticky_root", P(x, DESK_TOP_Y, z))
    objs = []
    pads = import_asset("office_notepads", "decor_notepads",
                        (x, DESK_TOP_Y, z), rot_z=0.35, target_width=0.13,
                        max_parts=2)
    if pads:
        objs.append(pads)
    parent(objs, root)
    return [root] + objs


def build_decor(M):
    """桌面装饰：真实 CC0 相框（正面朝观者，即绕竖直轴转到 +Z 方向）"""
    objs = []
    frame = import_asset("standing_picture_frame_01", "decor_photo_frame",
                         (-0.70, DESK_TOP_Y, -0.24),
                         rot_z=math.pi + 0.45, target_height=0.15)
    if frame:
        objs.append(frame)
    return objs


# ---------------------------------------------------------------- 导出
def export_glb(objs, filepath):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    kwargs = dict(filepath=filepath, export_format='GLB', export_apply=True)
    try:
        bpy.ops.export_scene.gltf(use_selection=True, **kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(export_selected=True, **kwargs)


def main():
    argv = sys.argv
    out_dir = argv[argv.index("--") + 1] if "--" in argv else "./public/models"

    reset_scene()
    M = build_materials()

    clock_objs = build_clock(M)

    desk_objs = []
    desk_objs += build_room(M)
    desk_objs += build_desk(M)
    desk_objs += build_lamp(M)
    desk_objs += build_monitor(M)
    desk_objs += build_notebook(M)
    desk_objs += build_coffee(M)
    desk_objs += build_calendar(M)
    desk_objs += build_sticky(M)
    desk_objs += build_decor(M)

    import os
    os.makedirs(out_dir, exist_ok=True)
    export_glb(clock_objs, os.path.join(out_dir, "clock.glb"))
    export_glb(desk_objs, os.path.join(out_dir, "desk.glb"))

    print("EXPORT_OK clock_objs=%d desk_objs=%d -> %s" %
          (len(clock_objs), len(desk_objs), out_dir))


main()
