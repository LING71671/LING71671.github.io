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
    return dict(
        wood=mat("wood", (0.28, 0.16, 0.08), rough=0.6),
        wood_top=mat("wood_top", (0.33, 0.19, 0.10), rough=0.5),
        wood_dark=mat("wood_dark", (0.18, 0.10, 0.05), rough=0.7),
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
        for poly in obj.data.polygons:
            poly.use_smooth = True
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
    objs = []
    cx, cz = CLOCK["x"], CLOCK["z"]
    face_y = DESK_TOP_Y + CLOCK["stand_h"] + CLOCK["face_r"]
    face_r = CLOCK["face_r"]

    root = add_empty("clock_root", P(cx, DESK_TOP_Y, cz))
    root.rotation_euler.z = 0.12  # three 场景中的轻微朝向（绕 three-Y = blender-Z）

    base = add_box("decor_clock_base", (0.09, 0.05, 0.02), P(cx, DESK_TOP_Y + 0.01, cz),
                   M["brass"], bevel=0.004)
    stand = add_box("decor_clock_stand", (0.014, 0.014, CLOCK["stand_h"]),
                    P(cx, DESK_TOP_Y + 0.02 + CLOCK["stand_h"] / 2 - 0.01, cz), M["brass"])
    bezel = add_torus("decor_clock_bezel", face_r + 0.006, 0.009,
                      P(cx, face_y, cz), M["brass"],
                      rot=(math.radians(90), 0, 0))
    # 表盘：薄圆柱，法线朝 -Y（three +Z）
    face = add_cylinder("clock_face", face_r, face_r, 0.006,
                        P(cx, face_y, cz), M["clock_face"], verts=48, axis='Y')

    # 刻度：60 根合并为 clock_ticks
    tick_meshes = []
    for i in range(60):
        major = i % 5 == 0
        angle = i / 60 * math.tau
        r = face_r - 0.011
        tx = cx + math.sin(angle) * r
        ty = face_y + math.cos(angle) * r
        t = add_box(f"__tick_{i}",
                    (0.004 if major else 0.002, 0.001, 0.012 if major else 0.006),
                    P(tx, ty, cz + 0.0045), M["tick"])
        t.rotation_euler.y = angle  # 绕 blender Y（表盘法线轴），长轴对准径向
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

    # 指针：原点在轴心，几何沿 Blender +Z（= glTF +Y = 12 点方向）
    def hand(name, length, width, thickness, material, z_front):
        obj = add_box(name, (width, thickness, length),
                      P(cx, face_y, cz + z_front), material,
                      mesh_offset=(0, 0, length / 2 - length * 0.12))
        return obj

    hour = hand("clock_hand_hour", face_r * 0.52, 0.007, 0.003, M["ink"], 0.008)
    minute = hand("clock_hand_minute", face_r * 0.78, 0.005, 0.003, M["ink"], 0.011)
    second = hand("clock_hand_second", face_r * 0.85, 0.002, 0.002, M["second"], 0.014)

    hub = add_sphere("decor_clock_hub", 0.007, P(cx, face_y, cz + 0.014), M["brass"])

    objs = [base, stand, bezel, face, ticks, hour, minute, second, hub]
    parent(objs, root)
    return [root] + objs


# ---------------------------------------------------------------- 房间
def build_room(M):
    objs = []
    floor = add_plane("decor_floor", 8, 6, (0, 0, 0), M["floor"], normal='+Z')
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
        obj = add_box(name, (seg_w, t, seg_h), P(x, y, wz - t / 2 + 0.01), M["wall"])
        return obj

    objs += [o for o in [
        wall_seg("decor_wall_l", left_edge + wall_w / 2, wall_h,
                 (-wall_w / 2 + left_edge) / 2, wall_h / 2),
        wall_seg("decor_wall_r", wall_w / 2 - right_edge, wall_h,
                 (right_edge + wall_w / 2) / 2, wall_h / 2),
        wall_seg("decor_wall_b", ww, bottom, wx, bottom / 2),
        wall_seg("decor_wall_t", ww, wall_h - top, wx, (top + wall_h) / 2),
    ] if o]

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
    # 窗台绿植
    pot = add_cylinder("decor_plant_pot", 0.038, 0.05, 0.075,
                       P(wx - ww / 2 + 0.13, wy - wh / 2 + 0.038, WINDOW["z"] + 0.06),
                       M["ceramic"])
    leaves = []
    for i, (dx, dy, s) in enumerate([(-0.03, 0.10, 0.035), (0.02, 0.13, 0.04),
                                     (0.045, 0.09, 0.03)]):
        leaf = add_sphere(f"decor_plant_leaf_{i}", s,
                          P(wx - ww / 2 + 0.13 + dx, wy - wh / 2 + dy,
                            WINDOW["z"] + 0.06), M["leaf"], seg=12)
        leaf.scale = (0.7, 0.7, 1.25)
        leaves.append(leaf)
    parent(bars + [glass, sill, pot] + leaves, win_root)
    objs += [win_root, glass, sill, pot] + bars + leaves
    return objs


# ---------------------------------------------------------------- 书桌
def build_desk(M):
    objs = []
    dz = -0.08  # 桌面中心的 three-Z 偏移（同占位场景）
    top = add_box("desk_top", (DESK["w"], DESK["d"], DESK["thickness"]),
                  P(0, DESK["top"] - DESK["thickness"] / 2, dz), M["wood_top"],
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
                           P(lx, leg_h / 2, lz), M["wood_dark"], verts=16)
        objs.append(leg)

    apron = add_box("decor_apron", (DESK["w"] - 0.18, 0.02, 0.16),
                    P(0, DESK["top"] - DESK["thickness"] - 0.08,
                      dz + DESK["d"] / 2 - 0.02), M["wood_dark"])
    objs.append(apron)

    # 抽屉
    drawer_root = add_empty("drawer_root",
                            P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                              dz + DESK["d"] / 2 - 0.02))
    housing = add_box("decor_drawer_housing",
                      (DRAWER["face_w"] + 0.04, 0.02, DRAWER["face_h"] + 0.04),
                      P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                        dz + DESK["d"] / 2 - 0.04), M["wood_dark"])
    slide_root = add_empty("drawer_slide",
                           P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                             dz + DESK["d"] / 2 - 0.02))
    face = add_box("decor_drawer_face", (DRAWER["face_w"], 0.018, DRAWER["face_h"]),
                   P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                     dz + DESK["d"] / 2 - 0.011), M["wood_top"], bevel=0.004)
    body = add_box("decor_drawer_body",
                   (DRAWER["face_w"] - 0.03, DRAWER["depth"], DRAWER["face_h"] - 0.03),
                   P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                     dz + DESK["d"] / 2 - 0.02 - DRAWER["depth"] / 2), M["wood_dark"])
    knob = add_sphere("decor_drawer_knob", 0.014,
                      P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.08,
                        dz + DESK["d"] / 2 + 0.006), M["brass"])
    book = add_box("decor_drawer_book", (DRAWER["face_w"] - 0.16, 0.16, 0.022),
                   P(DRAWER["x"], DESK["top"] - DESK["thickness"] - 0.125,
                     dz + DESK["d"] / 2 - 0.14), M["ink"], bevel=0.003)
    parent([face, body, knob, book], slide_root)
    parent([housing, slide_root], drawer_root)
    objs += [drawer_root, housing, slide_root, face, body, knob, book]
    return objs


# ---------------------------------------------------------------- 台灯
def build_lamp(M):
    x, z = LAMP["x"], LAMP["z"]
    root = add_empty("lamp_root", P(x, DESK_TOP_Y, z))
    base = add_cylinder("decor_lamp_base", 0.07, 0.09, 0.026,
                        P(x, DESK_TOP_Y + 0.013, z), M["brass"])
    pole = add_cylinder("decor_lamp_pole", 0.010, 0.012, LAMP["pole_h"],
                        P(x, DESK_TOP_Y + 0.026 + LAMP["pole_h"] / 2, z), M["brass"],
                        verts=20)
    head = add_empty("lamp_head", P(x, DESK_TOP_Y + 0.026 + LAMP["pole_h"], z))
    head.rotation_euler.y = -0.75  # 朝桌心倾斜（three 绕 Z -> blender 绕 Y 反向？保持与占位一致的观感）
    shade = add_cylinder("decor_lamp_shade", 0.03, 0.09, 0.13,
                         P(x, DESK_TOP_Y + 0.026 + LAMP["pole_h"] + 0.02, z),
                         M["brass"], verts=28)
    bulb = add_sphere("lamp_bulb", 0.027,
                      P(x, DESK_TOP_Y + 0.026 + LAMP["pole_h"] - 0.015, z), M["bulb"])
    parent([shade, bulb], head)
    parent([base, pole, head], root)
    return [root, base, pole, head, shade, bulb]


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
    root.rotation_euler.z = -0.06
    w, d = NOTEBOOK["w"], NOTEBOOK["d"]
    left = add_box("decor_page_l", (w / 2 - 0.004, d, 0.012),
                   P(x - w / 4, DESK_TOP_Y + 0.006, z), M["paper"], bevel=0.002)
    left.rotation_euler.y = 0.05
    right = add_box("decor_page_r", (w / 2 - 0.004, d, 0.012),
                    P(x + w / 4, DESK_TOP_Y + 0.006, z), M["paper_dim"], bevel=0.002)
    right.rotation_euler.y = -0.05
    spine = add_cylinder("decor_notebook_spine", 0.009, 0.009, d,
                         P(x, DESK_TOP_Y + 0.008, z), M["ink"], verts=12, axis='Y')
    pen = add_cylinder("decor_pen", 0.0038, 0.0038, 0.135,
                       P(x + w / 4, DESK_TOP_Y + 0.017, z + d / 2 - 0.04), M["ink"],
                       verts=10)
    pen.rotation_euler = (math.radians(90), 0, 0.5)
    objs = [left, right, spine, pen]
    parent(objs, root)
    return [root] + objs


def build_coffee(M):
    x, z = COFFEE["x"], COFFEE["z"]
    root = add_empty("coffee_root", P(x, DESK_TOP_Y, z))
    saucer = add_cylinder("decor_saucer", COFFEE["r"] + 0.026, COFFEE["r"] + 0.012,
                          0.009, P(x, DESK_TOP_Y + 0.0045, z), M["ceramic"])
    cup = add_cylinder("decor_cup", COFFEE["r"], COFFEE["r"] * 0.8, COFFEE["h"],
                       P(x, DESK_TOP_Y + 0.009 + COFFEE["h"] / 2, z), M["ceramic"])
    liquid = add_cylinder("decor_coffee_liquid", COFFEE["r"] - 0.007,
                          COFFEE["r"] - 0.007, 0.003,
                          P(x, DESK_TOP_Y + 0.009 + COFFEE["h"] - 0.007, z),
                          M["coffee"], verts=24)
    handle = add_torus("decor_cup_handle", 0.021, 0.006,
                       P(x + COFFEE["r"] + 0.013, DESK_TOP_Y + 0.009 + COFFEE["h"] / 2, z),
                       M["ceramic"], rot=(0, math.radians(90), 0))
    steam = add_empty("coffee_steam_anchor",
                      P(x, DESK_TOP_Y + COFFEE["h"] + 0.03, z))
    objs = [saucer, cup, liquid, handle, steam]
    parent(objs, root)
    return [root] + objs


def build_calendar(M):
    x, z = CALENDAR["x"], CALENDAR["z"]
    root = add_empty("calendar_root", P(x, DESK_TOP_Y, z))
    root.rotation_euler.z = -0.35
    w, h = CALENDAR["w"], CALENDAR["h"]
    lean = 0.28
    front = add_box("decor_cal_front", (w, 0.004, h),
                    P(x, DESK_TOP_Y + h / 2, z + h * 0.14), M["paper"])
    front.rotation_euler.x = -lean
    back = add_box("decor_cal_back", (w, 0.004, h),
                   P(x, DESK_TOP_Y + h / 2, z - h * 0.14), M["paper_dim"])
    back.rotation_euler.x = lean
    block = add_box("decor_cal_date", (w * 0.42, 0.003, h * 0.3),
                    P(x, DESK_TOP_Y + h * 0.62, z + h * 0.14 + 0.004), M["brass"])
    block.rotation_euler.x = -lean
    objs = [front, back, block]
    parent(objs, root)
    return [root] + objs


def build_sticky(M):
    x, z = STICKY["x"], STICKY["z"]
    root = add_empty("sticky_root", P(x, DESK_TOP_Y, z))
    objs = []
    for i, (dx, dz2, rot) in enumerate([(-0.02, 0.0, -0.12), (0.055, 0.045, 0.31),
                                        (-0.045, -0.055, 0.55)]):
        note = add_plane(f"decor_sticky_{i}", STICKY["size"], STICKY["size"],
                         P(x + dx, DESK_TOP_Y + 0.002 + i * 0.0012, z + dz2),
                         M["sticky"], normal='+Z')
        note.rotation_euler.z = rot
        objs.append(note)
    parent(objs, root)
    return [root] + objs


def build_decor(M):
    objs = []
    frame_root = add_empty("decor_photo_frame", P(-0.72, DESK_TOP_Y, -0.28))
    frame_root.rotation_euler.z = 0.5
    border = add_box("decor_frame_border", (0.09, 0.008, 0.11),
                     P(-0.72, DESK_TOP_Y + 0.055, -0.28), M["wood_dark"], bevel=0.003)
    border.rotation_euler.x = 0.12
    photo = add_plane("decor_frame_photo", 0.07, 0.09,
                      P(-0.72, DESK_TOP_Y + 0.055, -0.28 + 0.006), M["paper_dim"])
    photo.rotation_euler.x = 0.12
    parent([border, photo], frame_root)
    objs += [frame_root, border, photo]
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
