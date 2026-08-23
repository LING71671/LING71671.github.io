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
                 target_width=None, max_parts=None, drop_slots=(),
                 target_triangles=None):
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

    # 按材质名删面：Poly Haven 的玻璃用 KHR transmission，
    # 走完 meshopt 管线后在 three 里就是一块不透明黑板（相框画心全被盖住）。
    if drop_slots:
        drop_idx = {i for i, s in enumerate(obj.material_slots)
                    if s.material and any(k in s.material.name.lower()
                                          for k in drop_slots)}
        if drop_idx:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bm.faces.ensure_lookup_table()
            gone = [f for f in bm.faces if f.material_index in drop_idx]
            bmesh.ops.delete(bm, geom=gone, context='FACES')
            bm.to_mesh(obj.data)
            bm.free()
            print(f"[import] {slug}: dropped {len(gone)} faces {sorted(drop_idx)}")

    # Poly Haven 的 1K 只代表贴图分辨率，不代表低模。盆栽和书本原始面数占
    # 整个房间近九成，却只在背景里出现；在这里保 UV/材质做确定性减面。
    if target_triangles:
        before_triangles = sum(max(len(poly.vertices) - 2, 0)
                               for poly in obj.data.polygons)
        if before_triangles > target_triangles:
            ratio = max(0.01, target_triangles / before_triangles)
            decimate = obj.modifiers.new("web_budget", 'DECIMATE')
            decimate.decimate_type = 'COLLAPSE'
            decimate.ratio = ratio
            if hasattr(decimate, "use_collapse_triangulate"):
                decimate.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.modifier_apply(modifier=decimate.name)
            after_triangles = sum(max(len(poly.vertices) - 2, 0)
                                  for poly in obj.data.polygons)
            print(f"[import] {slug}: decimate {before_triangles} -> {after_triangles} tris")

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


# ------------------------------------------------ 程序化贴图（numpy + 手写 PNG）
# 墙纸 / 软木 / 亚麻 / 地毯这几种「大面积、低对比、需要精确配色」的材质
# 用下载素材很难对上房间色系，这里直接算出来：确定性、尺寸小、随时可调。
import zlib
import struct
import numpy as np

GEN_DIR = os.path.join(TEX_DIR, "generated")


def _write_png(path, rgb_u8):
    """写 8bit RGB PNG（Blender 自带 zlib，无需第三方库）"""
    h, w, _ = rgb_u8.shape
    rows = np.zeros((h, w * 3 + 1), dtype=np.uint8)
    rows[:, 1:] = rgb_u8.reshape(h, w * 3)

    def chunk(tag, data):
        body = tag + data
        return (struct.pack(">I", len(data)) + body +
                struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))

    blob = b"\x89PNG\r\n\x1a\n"
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(rows.tobytes(), 6))
    blob += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fp:
        fp.write(blob)


def _tileable_noise(size, cells, rng):
    """周期性平滑噪声（无缝平铺），返回 (size, size) 的 0..1 数组"""
    grid = rng.random((cells, cells))
    t = np.arange(size) * cells / size
    i0 = np.floor(t).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = t - np.floor(t)
    f = f * f * (3.0 - 2.0 * f)                      # smoothstep
    top = grid[np.ix_(i0, i0)] * (1 - f)[None, :] + grid[np.ix_(i0, i1)] * f[None, :]
    bot = grid[np.ix_(i1, i0)] * (1 - f)[None, :] + grid[np.ix_(i1, i1)] * f[None, :]
    return top * (1 - f)[:, None] + bot * f[:, None]


def _save_lum(path, lum, base, rng, grain=0.014):
    """亮度场 × 基色 + 细噪点（细噪同时充当抖动，避免 WebP 压出色块）"""
    lum = lum + (rng.random(lum.shape) - 0.5) * grain
    rgb = np.clip(np.asarray(base)[None, None, :] * lum[..., None], 0.0, 1.0)
    _write_png(path, (rgb * 255.0 + 0.5).astype(np.uint8))


def _save_gray(path, values):
    """把 0..1 标量场写成 RGB 灰度图，方便 glTF/WebP 管线统一处理。"""
    gray = np.clip(values * 255.0 + 0.5, 0, 255).astype(np.uint8)
    _write_png(path, np.repeat(gray[..., None], 3, axis=2))


def _save_normal(path, height, strength=1.0):
    """由可平铺高度场生成 OpenGL 切线空间法线（绿色通道朝 +Y）。"""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    normal = np.stack((-dx, -dy, np.ones_like(height)), axis=-1)
    normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-6)
    rgb = np.clip(normal * 0.5 + 0.5, 0.0, 1.0)
    _write_png(path, (rgb * 255.0 + 0.5).astype(np.uint8))


def _save_orm(path, occlusion, roughness, metallic=0.0):
    """写 glTF ORM：R=AO、G=roughness、B=metallic。"""
    shape = roughness.shape
    metal = (np.full(shape, metallic, dtype=np.float32)
             if np.isscalar(metallic) else metallic)
    orm = np.stack((occlusion, roughness, metal), axis=-1)
    _write_png(path, (np.clip(orm, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8))


def _read_luma(filename):
    """读取现有 1K PBR 图，返回线性亮度；仅用于派生细微 normal/AO。"""
    image = bpy.data.images.load(os.path.join(TEX_DIR, filename), check_existing=True)
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgb = pixels.reshape(height, width, 4)[..., :3]
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def make_derived_surface_maps(diff_file, normal_path, orm_path,
                              rough_file=None, rough_base=0.72,
                              normal_strength=2.0):
    """为只有 albedo/roughness 的旧素材补 normal 与共享 ORM。"""
    height = _read_luma(diff_file)
    height = height - (_tileable_noise(height.shape[0], 10,
                                       np.random.default_rng(91)) - 0.5) * 0.04
    _save_normal(normal_path, height, strength=normal_strength)
    if rough_file:
        rough = np.clip(_read_luma(rough_file), 0.18, 0.98)
    else:
        rough = np.clip(rough_base + (0.5 - height) * 0.20, 0.38, 0.96)
    # 凹处稍暗，幅度刻意克制，避免 aoMap 把大表面烤脏。
    ao = np.clip(0.94 + (height - np.mean(height)) * 0.12, 0.80, 1.0)
    _save_orm(orm_path, ao, rough)


def make_wallpaper(diff_path, normal_path, orm_path, size=1024, stripes=8):
    """腰线以上的墙纸：同色系宽窄竖条 + 细麻织理（对比压到 5% 以内，不抢戏）"""
    rng = np.random.default_rng(7)
    t = np.arange(size) / size
    u = t[None, :]
    v = t[:, None]
    phase = (u * stripes) % 1.0
    band = np.where(phase < 0.60, 1.0, 1.048)                 # 宽条 / 窄条
    band = band - np.exp(-((phase - 0.60) / 0.013) ** 2) * 0.055  # 交界一道细暗线
    band = band - np.exp(-((phase - 0.0) / 0.010) ** 2) * 0.030
    weave = (np.sin(v * np.pi * 2 * 46) * 0.004 +
             np.sin(u * np.pi * 2 * 39) * 0.003)
    mottle = (_tileable_noise(size, 6, rng) - 0.5) * 0.055
    lum = np.broadcast_to(band, (size, size)) + weave + mottle
    _save_lum(diff_path, lum, (0.72, 0.66, 0.56), rng)
    seam = (np.exp(-((phase - 0.60) / 0.014) ** 2) * 0.18 +
            np.exp(-((phase - 0.0) / 0.011) ** 2) * 0.10)
    height = (0.52 - np.broadcast_to(seam, (size, size)) +
              np.broadcast_to(weave, (size, size)) * 2.2 + mottle * 0.16)
    _save_normal(normal_path, height, strength=2.0)
    rough = np.clip(0.88 + (_tileable_noise(size, 18, rng) - 0.5) * 0.10,
                    0.80, 0.97)
    ao = np.clip(0.97 - np.broadcast_to(seam, (size, size)) * 0.22, 0.88, 1.0)
    _save_orm(orm_path, ao, rough)


def make_cork(diff_path, normal_path, orm_path, size=512):
    """软木板：粗细两级颗粒 + 大块色差"""
    rng = np.random.default_rng(11)
    lum = (0.94
           + (_tileable_noise(size, 44, rng) - 0.5) * 0.15
           + (_tileable_noise(size, 12, rng) - 0.5) * 0.08
           + (_tileable_noise(size, 120, rng) - 0.5) * 0.20)
    _save_lum(diff_path, lum, (0.60, 0.49, 0.35), rng, grain=0.028)
    _save_normal(normal_path, lum, strength=2.8)
    ao = np.clip(0.90 + (lum - np.mean(lum)) * 0.35, 0.72, 1.0)
    rough = np.clip(0.90 + (_tileable_noise(size, 70, rng) - 0.5) * 0.12,
                    0.80, 1.0)
    _save_orm(orm_path, ao, rough)


def make_linen(diff_path, normal_path, orm_path, size=1024):
    """窗帘亚麻：色彩图只保留天然色差，细经纬交给 normal，避免棋盘/摩尔纹。"""
    rng = np.random.default_rng(19)
    t = np.arange(size) / size
    u = t[None, :]
    v = t[:, None]
    slub = (_tileable_noise(size, 22, rng) - 0.5) * 0.075
    broad = (_tileable_noise(size, 5, rng) - 0.5) * 0.045
    lum = 1.0 + slub + broad
    _save_lum(diff_path, lum, (0.80, 0.75, 0.66), rng, grain=0.010)

    # 约 2mm 的可读纱线节奏，加入相位扰动，避免完美正弦格。
    phase_u = u * np.pi * 2 * 88 + (_tileable_noise(size, 7, rng) - 0.5) * 0.8
    phase_v = v * np.pi * 2 * 72 + (_tileable_noise(size, 9, rng) - 0.5) * 0.8
    warp = np.sin(phase_u) * 0.42 + np.sin(phase_u * 2.0 + 0.7) * 0.08
    weft = np.sin(phase_v) * 0.32 + np.sin(phase_v * 2.0 + 1.1) * 0.06
    height = 0.5 + warp + weft + slub * 0.35
    _save_normal(normal_path, height, strength=0.95)
    rough = np.clip(0.86 + (_tileable_noise(size, 48, rng) - 0.5) * 0.12
                    + np.abs(warp) * 0.025, 0.76, 0.98)
    ao = np.clip(0.96 - np.maximum(-(warp + weft), 0) * 0.045, 0.88, 1.0)
    _save_orm(orm_path, ao, rough)


def make_rug(diff_path, normal_path, orm_path, world_w, world_h, size=512):
    """平织地毯：一圈麦色宽边 + 两道压线，场地是横向的织纹"""
    rng = np.random.default_rng(23)
    t = np.arange(size) / size
    u = t[None, :]
    v = t[:, None]
    edge = np.minimum(np.minimum(u, 1.0 - u) * world_w,
                      np.minimum(v, 1.0 - v) * world_h)     # 到毯边的世界距离
    # 亮度压住：地毯大半藏在桌下，边框太亮会在画面下缘拉出一条刺眼的白带
    field = np.array([0.44, 0.37, 0.29])
    border = np.array([0.57, 0.50, 0.39])
    line = np.array([0.26, 0.21, 0.16])
    col = np.empty((size, size, 3))
    col[:] = field
    col[edge < 0.155] = border
    col[edge < 0.030] = line
    col[(edge >= 0.170) & (edge < 0.186)] = line
    rib = 1.0 + np.sin(v * np.pi * 2 * 46) * 0.045
    lum = np.broadcast_to(rib, (size, size)) * (0.92 + _tileable_noise(size, 52, rng) * 0.17)
    lum = lum + (rng.random((size, size)) - 0.5) * 0.02
    rgb = np.clip(col * lum[..., None], 0.0, 1.0)
    _write_png(diff_path, (rgb * 255.0 + 0.5).astype(np.uint8))
    height = (np.broadcast_to(np.sin(v * np.pi * 2 * 72), (size, size)) * 0.45
              + (_tileable_noise(size, 64, rng) - 0.5) * 0.35)
    _save_normal(normal_path, height, strength=1.35)
    rough = np.clip(0.90 + (_tileable_noise(size, 56, rng) - 0.5) * 0.10,
                    0.82, 1.0)
    ao = np.clip(0.94 + height * 0.035, 0.84, 1.0)
    _save_orm(orm_path, ao, rough)


def make_wall_art(path, size=512):
    """
    三幅小画的贴图图集（2×2 象限，画心用 set_uv_rect 取其一）：
    左上=黑白远山照片，右上=植物标本，左下=暖色抽象风景。
    墙上这几幅只有 ~7cm，靠色块是读不出「画」的，必须有内容。
    """
    rng = np.random.default_rng(31)
    q = size // 2
    img = np.full((size, size, 3), 0.88)
    t = np.arange(q) / q
    u = t[None, :]
    v = t[:, None]                       # v=0 是画面顶端

    # —— 左上：黑白远山 ——
    sky = np.broadcast_to(0.88 - v * 0.20, (q, q)).copy()
    far = 0.50 + 0.10 * np.sin(u * 7.0) + 0.05 * np.sin(u * 13.0 + 1.1)
    near = 0.66 + 0.08 * np.sin(u * 4.0 + 2.2)
    g = np.where(v > far, 0.46 - (v - far) * 0.30, sky)
    g = np.where(v > near, 0.23, g)
    g = np.clip(g + (rng.random((q, q)) - 0.5) * 0.035, 0, 1)
    img[0:q, 0:q] = g[..., None] * np.array([1.0, 0.985, 0.955])

    # —— 右上：植物标本 ——
    b = np.full((q, q), 0.90)
    stem = 0.5 + 0.05 * np.sin(v * 3.0)
    b = np.where(np.abs(u - stem) < 0.010, 0.32, b)
    for vy, side, ln in ((0.30, 1, 0.15), (0.43, -1, 0.18),
                         (0.56, 1, 0.19), (0.69, -1, 0.15)):
        ang = side * 0.55
        cu = 0.5 + side * ln * 0.60
        cv = vy - 0.045
        du = (u - cu) * math.cos(ang) + (v - cv) * math.sin(ang)
        dv = -(u - cu) * math.sin(ang) + (v - cv) * math.cos(ang)
        b = np.where((du / (ln * 0.62)) ** 2 + (dv / 0.048) ** 2 < 1.0, 0.36, b)
    b = np.clip(b + (rng.random((q, q)) - 0.5) * 0.03, 0, 1)
    img[0:q, q:size] = b[..., None] * np.array([0.94, 0.93, 0.85])

    # —— 左下：暖色抽象风景（色带 + 落日） ——
    c = np.zeros((q, q, 3))
    for v0, v1, col in ((0.0, 0.38, (0.87, 0.76, 0.58)),
                        (0.38, 0.52, (0.80, 0.61, 0.40)),
                        (0.52, 0.64, (0.58, 0.43, 0.30)),
                        (0.64, 1.01, (0.40, 0.33, 0.26))):
        c[np.broadcast_to((v >= v0) & (v < v1), (q, q))] = col
    c[np.broadcast_to((u - 0.62) ** 2 + (v - 0.28) ** 2 < 0.010, (q, q))] = (0.96, 0.84, 0.57)
    img[q:size, 0:q] = c

    # —— 右下：再切 2×2，左上/右上两格是软木板上钉的小照片 ——
    img[q:size, q:size] = np.array([0.86, 0.83, 0.76])
    s = q // 2
    t2 = np.arange(s) / s
    u2 = t2[None, :]
    v2 = t2[:, None]
    mist = np.broadcast_to(0.84 - v2 * 0.26, (s, s)).copy()
    trunk = np.zeros((s, s), dtype=bool)
    for tx, tw in ((0.17, 0.030), (0.35, 0.019), (0.53, 0.035),
                   (0.70, 0.021), (0.86, 0.028)):
        trunk |= np.broadcast_to((np.abs(u2 - tx) < tw) & (v2 > 0.20), (s, s))
    forest = np.clip(np.where(trunk, 0.27, mist), 0, 1)
    img[q:q + s, q:q + s] = forest[..., None] * np.array([0.97, 0.98, 1.0])

    shore = np.zeros((s, s, 3))
    for v0, v1, col in ((0.0, 0.56, (0.92, 0.79, 0.61)), (0.56, 1.01, (0.55, 0.48, 0.43))):
        shore[np.broadcast_to((v2 >= v0) & (v2 < v1), (s, s))] = col
    shore[np.broadcast_to((u2 - 0.40) ** 2 + (v2 - 0.44) ** 2 < 0.007, (s, s))] = (0.99, 0.89, 0.67)
    img[q:q + s, q + s:size] = shore

    img = np.clip(img + (rng.random((size, size, 1)) - 0.5) * 0.016, 0, 1)
    _write_png(path, (img * 255.0 + 0.5).astype(np.uint8))


def make_micro_surface(normal_path, orm_path, kind, size=512):
    """纯色材质共用的微表面：油漆、黄铜拉丝与纸纤维。"""
    seeds = {"paint": 41, "brass": 43, "paper": 47}
    rng = np.random.default_rng(seeds[kind])
    t = np.arange(size) / size
    u = t[None, :]
    v = t[:, None]
    if kind == "paint":
        height = ((_tileable_noise(size, 32, rng) - 0.5) * 0.34
                  + (_tileable_noise(size, 120, rng) - 0.5) * 0.10)
        rough = np.clip(0.70 + (_tileable_noise(size, 28, rng) - 0.5) * 0.10,
                        0.62, 0.80)
        ao = np.clip(0.98 + height * 0.035, 0.92, 1.0)
        metallic = 0.0
        strength = 0.75
    elif kind == "brass":
        # 横向细拉丝 + 极轻的氧化斑，避免纯色金属只剩黑块和高光点。
        brush = np.broadcast_to(np.sin(v * np.pi * 2 * 118), (size, size))
        height = brush * 0.22 + (_tileable_noise(size, 48, rng) - 0.5) * 0.12
        rough = np.clip(0.32 + (_tileable_noise(size, 38, rng) - 0.5) * 0.16
                        + np.abs(brush) * 0.025, 0.22, 0.48)
        ao = np.ones((size, size), dtype=np.float32)
        metallic = 0.95
        strength = 0.55
    else:  # paper
        fibers = (np.broadcast_to(np.sin(u * np.pi * 2 * 96), (size, size)) * 0.18
                  + np.broadcast_to(np.sin(v * np.pi * 2 * 73), (size, size)) * 0.11)
        height = fibers + (_tileable_noise(size, 70, rng) - 0.5) * 0.18
        rough = np.clip(0.88 + (_tileable_noise(size, 55, rng) - 0.5) * 0.08,
                        0.82, 0.98)
        ao = np.clip(0.99 + height * 0.018, 0.94, 1.0)
        metallic = 0.0
        strength = 0.55
    _save_normal(normal_path, height, strength=strength)
    _save_orm(orm_path, ao, rough, metallic)


RUG = dict(w=2.6, d=1.7, x=0.0, z=0.32)
WALLPAPER_TILE = 0.72          # 墙纸一次平铺的世界尺寸（米），8 道竖条 = 9cm 条距


def build_generated_textures():
    make_wallpaper(os.path.join(GEN_DIR, "wallpaper.png"),
                   os.path.join(GEN_DIR, "wallpaper_normal.png"),
                   os.path.join(GEN_DIR, "wallpaper_orm.png"))
    make_cork(os.path.join(GEN_DIR, "cork.png"),
              os.path.join(GEN_DIR, "cork_normal.png"),
              os.path.join(GEN_DIR, "cork_orm.png"))
    make_linen(os.path.join(GEN_DIR, "linen.png"),
               os.path.join(GEN_DIR, "linen_normal.png"),
               os.path.join(GEN_DIR, "linen_orm.png"))
    make_rug(os.path.join(GEN_DIR, "rug.png"),
             os.path.join(GEN_DIR, "rug_normal.png"),
             os.path.join(GEN_DIR, "rug_orm.png"), RUG["w"], RUG["d"])
    make_wall_art(os.path.join(GEN_DIR, "wall_art.png"))
    make_derived_surface_maps(
        "wood_table_001_diff_1k.jpg",
        os.path.join(GEN_DIR, "wood_table_001_normal_1k.png"),
        os.path.join(GEN_DIR, "wood_table_001_orm_1k.png"),
        rough_file="wood_table_001_rough_1k.jpg", normal_strength=1.8)
    make_derived_surface_maps(
        "wood_floor_diff_1k.jpg",
        os.path.join(GEN_DIR, "wood_floor_normal_1k.png"),
        os.path.join(GEN_DIR, "wood_floor_orm_1k.png"),
        rough_base=0.78, normal_strength=1.5)
    for kind in ("paint", "brass", "paper"):
        make_micro_surface(os.path.join(GEN_DIR, f"{kind}_normal.png"),
                           os.path.join(GEN_DIR, f"{kind}_orm.png"), kind)
    print("[tex] generated -> %s" % GEN_DIR)


def _gltf_settings_group():
    """Blender glTF 导出器识别的 AO 输出节点组。"""
    group = bpy.data.node_groups.get("glTF Material Output")
    if group:
        return group
    group = bpy.data.node_groups.new("glTF Material Output", 'ShaderNodeTree')
    group.interface.new_socket("Occlusion", socket_type="NodeSocketFloat")
    group.nodes.new('NodeGroupOutput')
    group.nodes.new('NodeGroupInput')
    return group


def _set_input(node, key, value):
    if node and key in node.inputs:
        node.inputs[key].default_value = value


def textured_material(name, diff_file=None, rough_file=None, normal_file=None,
                      orm_file=None, rough=0.55, metal=0.0, base_color=None,
                      tint=None, mapping_scale=None, normal_strength=1.0,
                      coat=0.0, coat_rough=0.35, sheen=0.0,
                      double_sided=False):
    """完整 metal-rough PBR；ORM 共图避免 AO/roughness 重复占显存。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
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

    if diff_file:
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
    elif base_color:
        _set_input(bsdf, "Base Color", (*base_color, 1.0))

    if orm_file:
        orm = tex_node(orm_file, non_color=True)
        separate = nodes.new("ShaderNodeSeparateColor")
        separate.mode = 'RGB'
        links.new(orm.outputs["Color"], separate.inputs["Color"])
        links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
        settings = nodes.new("ShaderNodeGroup")
        settings.node_tree = _gltf_settings_group()
        links.new(separate.outputs["Red"], settings.inputs["Occlusion"])
    elif rough_file:
        rough_node = tex_node(rough_file, non_color=True)
        links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])
        _set_input(bsdf, "Metallic", metal)
    else:
        _set_input(bsdf, "Roughness", rough)
        _set_input(bsdf, "Metallic", metal)

    if normal_file:
        normal_tex = tex_node(normal_file, non_color=True)
        normal = nodes.new("ShaderNodeNormalMap")
        normal.inputs["Strength"].default_value = normal_strength
        links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])

    if coat > 0:
        _set_input(bsdf, "Coat Weight", coat)
        _set_input(bsdf, "Coat Roughness", coat_rough)
    if sheen > 0:
        _set_input(bsdf, "Sheen Weight", sheen)
        _set_input(bsdf, "Sheen Roughness", 0.82)
    return m


def emissive_texture_material(name, diff_file, strength=1.0):
    """自发光贴图材质：窗外实景用，不被室内光照压暗"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
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
        alpha=None, coat=0.0, coat_rough=0.35, sheen=0.0,
        double_sided=False):
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
    bsdf = m.node_tree.nodes.get("Principled BSDF")

    _set_input(bsdf, "Base Color", (*color, 1.0))
    _set_input(bsdf, "Roughness", rough)
    _set_input(bsdf, "Metallic", metal)
    if coat > 0:
        _set_input(bsdf, "Coat Weight", coat)
        _set_input(bsdf, "Coat Roughness", coat_rough)
    if sheen > 0:
        _set_input(bsdf, "Sheen Weight", sheen)
        _set_input(bsdf, "Sheen Roughness", 0.82)
    if emission is not None:
        _set_input(bsdf, "Emission Color", (*emission, 1.0))
        _set_input(bsdf, "Emission Strength", emission_strength)
    if alpha is not None:
        _set_input(bsdf, "Alpha", alpha)
        m.blend_method = 'BLEND'
    _materials[name] = m
    return m


def build_materials():
    tex = dict(
        # 主视觉木材保留 1K：albedo + normal + 共享 ORM；轻漆层只负责宽高光。
        wood_desk=textured_material("wood_desk", "wood_table_001_diff_1k.jpg",
                                    normal_file="generated/wood_table_001_normal_1k.png",
                                    orm_file="generated/wood_table_001_orm_1k.png",
                                    normal_strength=0.62, coat=0.08, coat_rough=0.38),
        wood_floor=textured_material("wood_floor", "wood_floor_diff_1k.jpg",
                                     normal_file="generated/wood_floor_normal_1k.png",
                                     orm_file="generated/wood_floor_orm_1k.png",
                                     normal_strength=0.48,
                                     tint=(0.55, 0.42, 0.32)),
        # 腰线以上：墙纸（程序化生成，配色直接对齐 tokens 的暖中性色系）
        wallpaper=textured_material("wallpaper", "generated/wallpaper.png",
                                    normal_file="generated/wallpaper_normal.png",
                                    orm_file="generated/wallpaper_orm.png",
                                    normal_strength=0.42),
        cork=textured_material("cork", "generated/cork.png",
                               normal_file="generated/cork_normal.png",
                               orm_file="generated/cork_orm.png",
                               normal_strength=0.72),
        linen=textured_material("linen", "generated/linen.png",
                                normal_file="generated/linen_normal.png",
                                orm_file="generated/linen_orm.png",
                                normal_strength=0.38, sheen=0.12,
                                tint=(0.82, 0.79, 0.72), double_sided=True),
        rug=textured_material("rug", "generated/rug.png",
                              normal_file="generated/rug_normal.png",
                              orm_file="generated/rug_orm.png",
                              normal_strength=0.28),
        wall_art=textured_material("wall_art", "generated/wall_art.png", rough=0.86),
        terracotta=textured_material("terracotta", "terracotta.jpg",
                                     rough=0.8, tint=(0.85, 0.62, 0.45),
                                     mapping_scale=(2.0, 2.0)),
        soil=mat("soil", (0.13, 0.09, 0.06), rough=1.0),
        # 窗外实景：自发光贴图（不受室内光照压暗，像真的窗外天光）
        window_view=emissive_texture_material("window_view", "window_view.jpg",
                                              strength=1.0),
    )
    paint_normal = "generated/paint_normal.png"
    paint_orm = "generated/paint_orm.png"
    paper_normal = "generated/paper_normal.png"
    paper_orm = "generated/paper_orm.png"
    return dict(
        **tex,
        wood=mat("wood", (0.28, 0.16, 0.08), rough=0.6),
        wood_top=mat("wood_top", (0.33, 0.19, 0.10), rough=0.5),
        wood_dark=mat("wood_dark", (0.10, 0.055, 0.028), rough=0.7),
        # 抽屉内壁：浅色生木（与深色外壳形成明暗差，空腔深度才可读）
        wood_raw=mat("wood_raw", (0.52, 0.38, 0.24), rough=0.85),
        # 墙裙护墙板：奶油漆面，与墙体拉开一点明度差
        wainscot=textured_material("wainscot", base_color=(0.72, 0.66, 0.55),
                                   normal_file=paint_normal, orm_file=paint_orm,
                                   normal_strength=0.18, mapping_scale=(2.0, 2.0),
                                   coat=0.04, coat_rough=0.48),
        # 日历正面：运行时注入 CanvasTexture（GitHub 提交记录）
        calendar_face=mat("calendar_face", (1.0, 1.0, 1.0), rough=0.92),
        wainscot_trim=textured_material("wainscot_trim", base_color=(0.62, 0.55, 0.45),
                                        normal_file=paint_normal, orm_file=paint_orm,
                                        normal_strength=0.16, mapping_scale=(2.0, 2.0),
                                        coat=0.05, coat_rough=0.44),
        floor=mat("floor", (0.16, 0.10, 0.06), rough=0.9),
        wall=mat("wall", (0.62, 0.52, 0.38), rough=1.0),
        paper=textured_material("paper", base_color=(0.93, 0.88, 0.78),
                                normal_file=paper_normal, orm_file=paper_orm,
                                normal_strength=0.16, mapping_scale=(3.0, 3.0)),
        paper_dim=textured_material("paper_dim", base_color=(0.85, 0.79, 0.66),
                                    normal_file=paper_normal, orm_file=paper_orm,
                                    normal_strength=0.16, mapping_scale=(3.0, 3.0)),
        brass=textured_material("brass", base_color=(0.55, 0.38, 0.13),
                                normal_file="generated/brass_normal.png",
                                orm_file="generated/brass_orm.png",
                                normal_strength=0.22, mapping_scale=(1.6, 1.6),
                                coat=0.10, coat_rough=0.30),
        dark=mat("dark", (0.05, 0.045, 0.04), rough=0.5),
        ink=mat("ink", (0.08, 0.06, 0.04), rough=0.65),
        ceramic=mat("ceramic", (0.95, 0.91, 0.83), rough=0.28,
                    coat=0.24, coat_rough=0.16),
        coffee=mat("coffee", (0.10, 0.05, 0.02), rough=0.15),
        sticky=textured_material("sticky_paper", base_color=(0.92, 0.83, 0.47),
                                 normal_file=paper_normal, orm_file=paper_orm,
                                 normal_strength=0.14, mapping_scale=(3.0, 3.0)),
        # 软木板上钉的照片：两种冲印色（黑白 / 偏冷），只是小色块，够读即可
        photo_grey=mat("photo_grey", (0.34, 0.33, 0.31), rough=0.42),
        photo_warm=mat("photo_warm", (0.40, 0.31, 0.22), rough=0.42),
        pin_red=mat("pin_red", (0.44, 0.11, 0.08), rough=0.32),
        # 窗帘束带：不用黄铜（金属环在画面左缘会读成一根横杆）。
        # 窗边光很强，中间调会被打成灰白塑料管，必须压到深色才读得出「布绳」。
        linen_dim=mat("linen_dim", (0.17, 0.14, 0.10), rough=0.95),
        leaf=mat("leaf", (0.24, 0.35, 0.18), rough=0.85),
        glass=mat("glass", (0.85, 0.92, 0.95), rough=0.08, alpha=0.10,
                  double_sided=True),
        clock_face=textured_material("clock_face_mat", base_color=(0.90, 0.85, 0.72),
                                     normal_file=paper_normal, orm_file=paper_orm,
                                     normal_strength=0.12, mapping_scale=(2.0, 2.0)),
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


def set_box_uv_density(obj, tile=0.55):
    """按局部真实尺寸做盒体三向投影；木纹不再困在默认 cube atlas 的 1/16 区域。"""
    mesh = obj.data
    uv = mesh.uv_layers.active
    if not uv:
        uv = mesh.uv_layers.new(name="UVMap")
    inv = 1.0 / max(tile, 0.01)
    for poly in mesh.polygons:
        nx, ny, nz = map(abs, poly.normal)
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if nz >= nx and nz >= ny:      # 水平面：X/Y（three X/Z）
                value = (co.x * inv, co.y * inv)
            elif ny >= nx:                 # 前后面：X/Z
                value = (co.x * inv, co.z * inv)
            else:                          # 侧面：Y/Z
                value = (co.y * inv, co.z * inv)
            uv.data[li].uv = value


def add_box(name, size, loc, material, bevel=0.0, mesh_offset=(0, 0, 0),
            uv_tile=None):
    """尺寸/偏移均为 Blender 坐标；mesh_offset 让原点偏离几何中心（pivot 控制）"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.data.transform(Matrix.Diagonal((*size, 1.0)))
    if mesh_offset != (0, 0, 0):
        obj.data.transform(Matrix.Translation(Vector(mesh_offset)))
    if uv_tile:
        set_box_uv_density(obj, tile=uv_tile)
    return _finish(obj, name, material, bevel=bevel)


def add_cylinder(name, r_top, r_bottom, depth, loc, material, verts=32,
                 smooth=True, axis='Z'):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r_bottom, radius2=r_top, depth=depth, location=loc)
    obj = bpy.context.object
    if axis == 'Y':
        obj.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
    elif axis == 'X':
        obj.data.transform(Matrix.Rotation(math.radians(90), 4, 'Y'))
    return _finish(obj, name, material, smooth=smooth)


def add_sphere(name, radius, loc, material, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2,
                                         radius=radius, location=loc)
    return _finish(bpy.context.object, name, material, smooth=True)


def add_torus(name, major, minor, loc, material, rot=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     location=loc,
                                     major_segments=28, minor_segments=8)
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


def set_planar_uv(obj, tile=0.72, offset=(0.0, 0.0)):
    """
    世界平面投影 UV（u = 世界X / tile, v = 世界Z / tile）。
    墙面必须用这个而不是 set_uv_density：
      1) 竖条纹墙纸的 u 轴必须锁死在世界 X 上（cube 各面的默认 UV 朝向不可控）；
      2) 窗洞把后墙切成四块，各块 0-1 UV 起点不同会在接缝处错位。
    只对朝向观者的正面有意义（侧面/顶面在这个投影下退化，但也看不见）。
    """
    me = obj.data
    uv = me.uv_layers.active
    if not uv:
        return
    loc = obj.location
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x + loc.x) / tile + offset[0],
                              (co.z + loc.z) / tile + offset[1])


def set_uv_rect(obj, u0, v0, u1, v1):
    """把 0-1 的 UV 重映射到贴图图集的一个子矩形（多幅小画共用一张图）"""
    uv = obj.data.uv_layers.active
    if not uv:
        return
    for loop_uv in uv.data:
        loop_uv.uv = (u0 + loop_uv.uv.x * (u1 - u0),
                      v0 + loop_uv.uv.y * (v1 - v0))


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

    # 地毯：画面下缘两角原本是一片黑木地板，铺一块平织毯把底部托住。
    # 贴图自带边框，所以 UV 保持 primitive plane 的 0-1（不要再平铺）。
    rug = add_plane("decor_rug", RUG["w"], RUG["d"],
                    P(RUG["x"], 0.004, RUG["z"]), M["rug"], normal='+Z')
    objs.append(rug)

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
                      M["wallpaper"])
        set_planar_uv(obj, tile=WALLPAPER_TILE)
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
                    P(0, (rail_y + skirt_h) / 2, wz + 0.006), M["wainscot"],
                    uv_tile=0.55)
    objs.append(panel)
    # 挂镜线（窗顶之上的一道细木条）+ 顶部石膏线收边
    picture_rail = add_box("decor_picture_rail", (wall_w, 0.018, 0.022),
                           P(0, 2.05, wz + 0.014), M["wainscot_trim"], bevel=0.002)
    objs.append(picture_rail)
    cornice = add_box("decor_cornice", (wall_w, 0.055, 0.085),
                      P(0, wall_h - 0.055, wz + 0.032), M["wainscot_trim"], bevel=0.006)
    cornice_lip = add_box("decor_cornice_lip", (wall_w, 0.085, 0.026),
                          P(0, wall_h - 0.112, wz + 0.048), M["wainscot_trim"],
                          bevel=0.004)
    objs += [cornice, cornice_lip]
    for i in range(7):
        px = -wall_w / 2 + wall_w * (i + 0.5) / 7
        strip = add_box(f"decor_wainscot_{i}", (0.016, 0.006, rail_y - skirt_h - 0.06),
                        P(px, (rail_y + skirt_h) / 2, wz + 0.014), M["wainscot_trim"])
        objs.append(strip)

    # —— 显示器上方一排小相框 ——
    # 相机在主视角只能看到墙面 y≈0.92–1.40 这一条（顶边取景到 1.39），
    # 挂高一点的画等于不存在。这排相框压在显示器上沿之上 5cm，正好落在取景带里。
    art_specs = [
        # (中心x, 中心y, 画心宽, 画心高, 图集象限)
        (-0.100, 1.315, 0.098, 0.076, 0),    # 黑白远山
        (0.075, 1.315, 0.072, 0.090, 1),     # 植物标本
        (0.250, 1.315, 0.096, 0.074, 2),     # 暖色风景
    ]
    inset = 0.006
    for i, (ax, ay, aw, ah, quad) in enumerate(art_specs):
        # 框体是实心板：画心与卡纸必须叠在它「前面」，否则整幅画被包进木头里
        frame = add_box(f"decor_art_frame_{i}", (aw + 0.026, 0.018, ah + 0.026),
                        P(ax, ay, wz + 0.019), M["wood_dark"], bevel=0.003)
        matboard = add_box(f"decor_art_mat_{i}", (aw + 0.011, 0.006, ah + 0.011),
                           P(ax, ay, wz + 0.029), M["paper"])
        canvas = add_plane(f"decor_art_canvas_{i}", aw, ah,
                           P(ax, ay, wz + 0.0335), M["wall_art"])
        u0 = (quad % 2) * 0.5 + inset
        v0 = (1 - quad // 2) * 0.5 + inset      # 象限 0/1 在图集上半 -> UV 上半
        set_uv_rect(canvas, u0, v0, u0 + 0.5 - inset * 2, v0 + 0.5 - inset * 2)
        objs += [frame, matboard, canvas]

    objs += build_pinboard(M)

    # —— 墙上搁板（右墙角，几本立着的书） ——
    shelf_x, shelf_y = 1.10, 1.14
    shelf = add_box("decor_shelf", (0.42, 0.15, 0.022),
                    P(shelf_x, shelf_y, wz + 0.085), M["wood_desk"], bevel=0.003,
                    uv_tile=0.48)
    bracket_objs = []
    for i, bx in ((0, -0.16), (1, 0.16)):
        bracket = add_box(f"decor_shelf_bracket_{i}", (0.016, 0.085, 0.075),
                          P(shelf_x + bx, shelf_y - 0.048, wz + 0.055),
                          M["wood_dark"], bevel=0.002)
        bracket_objs.append(bracket)
    objs += [shelf] + bracket_objs
    # 搁板上的书：真实 CC0 模型（百科全书套装）
    books = import_asset("book_encyclopedia_set_01", "decor_shelf_books",
                         (shelf_x, shelf_y + 0.011, wz + 0.085),
                         rot_z=0.0, target_width=0.35, target_triangles=8000)
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
    sill = add_box("decor_sill", (ww + 0.14, 0.055, 0.03),
                   P(wx, wy - wh / 2 - 0.015, WINDOW["z"] + 0.012), M["wood_dark"],
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
                         (wx - ww / 2 + 0.15, wy - wh / 2 + 0.015, WINDOW["z"] + 0.015),
                         rot_z=0.6, target_height=0.18, target_triangles=18000)
    if plant:
        plant_objs.append(plant)

    parent(bars + [glass, sill] + plant_objs, win_root)
    objs += [win_root, glass, sill, view] + bars + plant_objs
    objs += build_curtain(M)
    return objs


# ---------------------------------------------------------------- 软木告示板
def build_pinboard(M):
    """
    软木告示板：木框 + 软木面 + 图钉钉住的便条与照片。
    位置贴着显示器右侧那片最大的空墙（主视角取景带 y≈0.92–1.40 内）。
    """
    bx, by = 0.62, 1.15
    cw, ch = 0.40, 0.30
    rail_t = 0.024                  # 边框条宽
    # 深度分层（three-Z，越大越靠近观者；墙面在 -0.54）
    rail_z = WALL_Z + 0.021         # 框条中心 -> 前沿 -0.518
    cork_z = WALL_Z + 0.016         # 软木面前沿 -0.528，比框沿凹 1cm
    note_z = WALL_Z + 0.0229
    photo_z = WALL_Z + 0.0243
    pin_z = WALL_Z + 0.0265

    # 边框必须是四根框条：做成一整块实心 box 会把软木面和纸片全部包在里面
    objs = []
    for tag, fw, fh, dx, dy in (
        ("t", cw + rail_t * 2, rail_t, 0.0, (ch + rail_t) / 2),
        ("b", cw + rail_t * 2, rail_t, 0.0, -(ch + rail_t) / 2),
        ("l", rail_t, ch, -(cw + rail_t) / 2, 0.0),
        ("r", rail_t, ch, (cw + rail_t) / 2, 0.0),
    ):
        objs.append(add_box(f"decor_pin_frame_{tag}", (fw, 0.022, fh),
                            P(bx + dx, by + dy, rail_z), M["wood_dark"],
                            bevel=0.003))
    cork = add_box("decor_pin_cork", (cw + rail_t, 0.012, ch + rail_t),
                   P(bx, by, cork_z), M["cork"])
    set_planar_uv(cork, tile=0.42)
    objs.append(cork)

    # (dx, dy, 宽, 高, 平面内旋转, 材质, 照片在 wall_art 图集里的子格)
    notes = [
        (-0.112, 0.058, 0.104, 0.074, 0.05, M["paper"], None),
        (0.012, 0.072, 0.082, 0.060, -0.07, M["sticky"], None),
        (0.128, 0.036, 0.078, 0.094, 0.03, M["paper"], (0.5, 0.25)),
        (-0.098, -0.072, 0.088, 0.068, -0.04, M["paper_dim"], None),
        (0.082, -0.078, 0.104, 0.070, 0.06, M["paper"], (0.75, 0.25)),
    ]
    for i, (dx, dy, nw, nh, rot, nmat, photo) in enumerate(notes):
        note = add_box(f"decor_pin_note_{i}", (nw, 0.0016, nh),
                       P(bx + dx, by + dy, note_z), nmat)
        note.rotation_euler.y = rot
        objs.append(note)
        if photo:
            # 照片心用 wall_art 图集的小格（3cm 的纯色块读不出「照片」）
            inner = add_plane(f"decor_pin_photo_{i}", nw - 0.012, nh - 0.016,
                              P(bx + dx, by + dy + 0.004, photo_z), M["wall_art"])
            set_uv_rect(inner, photo[0] + 0.004, photo[1] + 0.004,
                        photo[0] + 0.246, photo[1] + 0.246)
            inner.rotation_euler.y = rot
            objs.append(inner)
        pin_mat = M["pin_red"] if i % 2 else M["brass"]
        pin = add_sphere(f"decor_pin_{i}", 0.0052,
                         P(bx + dx + nw * 0.16, by + dy + nh / 2 - 0.008, pin_z),
                         pin_mat, seg=10)
        pin.scale = (1.0, 0.7, 1.0)
        objs.append(pin)
    return objs


# ---------------------------------------------------------------- 窗帘
def build_curtain(M):
    """
    高级亚麻落地窗帘（S-Wave Ripplefold），支持 Morph Target（Basis: 收拢扎在左侧，closed: 展开遮窗）。
    视线区（y > 0.80）拥有饱满立体的 S 型波浪褶皱与光影明暗，桌面后夹缝（y <= 0.80）平滑过渡为 0.7cm 细波，
    安全无干涉滑落至地面（bottom = 0.015）。
    左侧配有实体黄铜窗帘抱钩（Wall Holdback Hook）优雅承托收拢窗帘。
    """
    cx_basis = -1.12
    cx_closed = -0.62
    # 帘杆与桌面后夹缝继续沿用原深度。窗台最前缘约为
    # WINDOW.z + 0.012 + 0.055 / 2 = -0.5005；若整幅帘都放在 rod_z，
    # 约 2cm 的褶皱谷会退到窗台后方，形成周期性的穿模黑块。
    # 仅在观看/窗户带把帘布中心向观者（three +Z）拱出 2.6cm，
    # 底部在桌面上方收回、顶部在帘杆前收回，保持两端原有安全间距。
    rod_z = -0.496
    view_clearance = 0.026
    top, bottom = 1.96, 0.015
    nu, nv = 48, 36
    tile = 0.18                 # 亚麻细节约每 18cm 重复，避免粗网格读成塑料帘

    verts_basis, verts_closed, uvs = [], [], []
    half_closed = 0.46

    def smoothstep01(v):
        v = min(1.0, max(0.0, v))
        return v * v * (3.0 - 2.0 * v)

    for j in range(nv + 1):
        t = j / nv
        y = top + (bottom - top) * t

        # y<=0.80 时保持在桌面后沿之后；0.80~0.96m 平滑前移以越过窗台。
        # 1.72m 起逐渐回到帘杆深度，1.96m 顶边与杆件的原始关系不变。
        lower_clearance = smoothstep01((y - 0.80) / 0.16)
        upper_clearance = 1.0 - smoothstep01((y - 1.72) / 0.24)
        clearance = view_clearance * lower_clearance * upper_clearance

        # --- Y方向分段深度控制（视线区饱满波浪，桌面下方收敛） ---
        if y > 0.80:
            # 视线区（窗户到桌面上方）：饱满深褶（波幅 1.8cm ~ 2.2cm）
            ratio = min(1.0, max(0.0, (y - 0.80) / 1.16))
            amp_c = 0.018 * (0.80 + 0.30 * math.sin(ratio * math.pi))
            amp_b = 0.022 * (0.80 + 0.30 * math.sin(ratio * math.pi))
        else:
            # 桌面下方（y <= 0.80）：过渡到 0.7cm 细波，安全穿过桌面后夹缝至地板
            fade = max(0.0, y / 0.80)
            amp_c = 0.007 + 0.004 * fade
            amp_b = 0.008 + 0.004 * fade

        # --- Basis（收拢在左侧）：腰部收拢曲线 ---
        waist_y, waist_w = 1.25, 0.28
        pinch = math.exp(-((y - waist_y) / waist_w) ** 2)
        if y > 1.25:
            half_b = 0.115 - 0.055 * pinch
        else:
            half_b = (0.115 - 0.055 * pinch) * (1.0 + 0.35 * (1.25 - y) / 1.25)

        # 收拢态在抱钩腰部回撤，避免向前拱出的帘布切进实体抱钩；
        # 窗台高度处衰减已经很小，仍保留足够的前向净距。
        holdback_depth = math.exp(-((y - waist_y) / 0.18) ** 2)
        cz_basis = rod_z + clearance * (1.0 - 0.82 * holdback_depth)
        cz_closed = rod_z + clearance

        for i in range(nu + 1):
            u = i / nu
            drift = math.sin(t * math.pi) * 0.18 + math.sin(t * math.tau) * 0.045

            # --- Closed 状态：双谐波 S 型波浪褶皱 ---
            fold_c = (
                math.sin(u * math.pi * 12.0 + 0.3 + drift) * 0.82
                + math.sin(u * math.pi * 24.0 + 0.6 - drift * 0.45) * 0.18
            )
            # 顶部捏褶：在最顶部 5cm（y > 1.90）稍微压平对齐挂钩
            if y > 1.90:
                top_fade = (top - y) / 0.06
                cur_amp_c = amp_c * (0.35 + 0.65 * top_fade)
            else:
                cur_amp_c = amp_c

            verts_closed.append(
                P(
                    cx_closed + (u - 0.5) * 2 * half_closed,
                    y,
                    cz_closed + fold_c * cur_amp_c,
                )
            )

            # --- Basis 状态：密集堆叠褶皱 ---
            fold_b = (
                math.sin(u * math.pi * 8.0 + 0.5 + drift) * 0.80
                + math.sin(u * math.pi * 16.0 - drift * 0.4) * 0.20
            )
            verts_basis.append(
                P(
                    cx_basis + (u - 0.5) * 2 * half_b,
                    y,
                    cz_basis + fold_b * amp_b,
                )
            )

            # UV 映射：保持纹理密度均匀
            uvs.append((u * 2 * half_closed / tile, (top - y) / tile))

    faces = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))

    mesh = bpy.data.meshes.new("decor_curtain")
    mesh.from_pydata(verts_basis, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            uv_layer.data[li].uv = uvs[mesh.loops[li].vertex_index]
    curtain = bpy.data.objects.new("decor_curtain", mesh)
    bpy.context.collection.objects.link(curtain)

    # 形态键：Basis 与 closed
    curtain.shape_key_add(name="Basis", from_mix=False)
    sk_closed = curtain.shape_key_add(name="closed", from_mix=False)
    for idx, pt in enumerate(verts_closed):
        sk_closed.data[idx].co = pt

    _finish(curtain, "decor_curtain", M["linen"], smooth=True)

    # --- 窗帘杆 + 左右端头球 ---
    rod = add_cylinder("decor_curtain_rod", 0.010, 0.010, 1.22,
                       P(-0.62, top + 0.035, rod_z), M["brass"], verts=16, axis='X')
    finial_l = add_sphere("decor_curtain_finial_l", 0.016,
                          P(-1.23, top + 0.035, rod_z), M["brass"], seg=14)
    finial_r = add_sphere("decor_curtain_finial_r", 0.016,
                          P(-0.01, top + 0.035, rod_z), M["brass"], seg=14)

    # --- 黄铜窗帘抱钩 (Wall Holdback Hook) ---
    # 固定在左侧墙壁（x = -1.215），向外延伸并环抱窗帘腰部
    hook_base = add_cylinder("decor_curtain_tie", 0.016, 0.016, 0.012,
                             P(-1.215, 1.25, -0.535), M["brass"], verts=14, axis='X')
    hook_arm = add_cylinder("decor_curtain_hook_arm", 0.005, 0.005, 0.075,
                            P(-1.215, 1.25, -0.495), M["brass"], verts=10, axis='Y')
    hook_bar = add_cylinder("decor_curtain_hook_bar", 0.005, 0.005, 0.14,
                            P(-1.145, 1.25, -0.458), M["brass"], verts=10, axis='X')
    hook_ball = add_sphere("decor_curtain_hook_ball", 0.011,
                           P(-1.075, 1.25, -0.458), M["brass"], seg=12)

    parent([hook_arm, hook_bar, hook_ball], hook_base)
    hook_objs = [hook_base, hook_arm, hook_bar, hook_ball]

    return [curtain, rod, finial_l, finial_r] + hook_objs


# ---------------------------------------------------------------- 书桌
def build_desk(M):
    objs = []
    # 与占位场景 / naming.ts 保持一致：桌体（含抽屉）必须有稳定的契约根节点。
    # 不能只依赖 desk_top 之类的装饰网格名，否则资产重建后 NodeRegistry
    # 无法确认整张书桌已经完整装配。
    body_root = add_empty("desk_body", P(0, 0, 0))
    dz = -0.08  # 桌面中心的 three-Z 偏移（同占位场景）
    top = add_box("desk_top", (DESK["w"], DESK["d"], DESK["thickness"]),
                  P(0, DESK["top"] - DESK["thickness"] / 2, dz), M["wood_desk"],
                  bevel=0.008, uv_tile=0.52)
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
                            M["wood_desk"], bevel=0.002, uv_tile=0.52))
    seg_r_w = apron_right_x - open_right
    if seg_r_w > 0.01:
        objs.append(add_box("decor_apron_r", (seg_r_w, 0.02, 0.16),
                            P(open_right + seg_r_w / 2, apron_y, apron_z),
                            M["wood_desk"], bevel=0.002, uv_tile=0.52))
    # 开口上方与下方的过梁（0.16 高的前梁减去开口高度）
    top_strip = (0.16 - opening_h) / 2
    if top_strip > 0.005:
        objs.append(add_box("decor_apron_top", (opening_w, 0.02, top_strip),
                            P(DRAWER["x"], apron_y + opening_h / 2 + top_strip / 2,
                              apron_z), M["wood_desk"], bevel=0.0015, uv_tile=0.52))
        objs.append(add_box("decor_apron_bottom", (opening_w, 0.02, top_strip),
                            P(DRAWER["x"], apron_y - opening_h / 2 - top_strip / 2,
                              apron_z), M["wood_desk"], bevel=0.0015, uv_tile=0.52))

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
                     dz + DESK["d"] / 2 - 0.011), M["wood_desk"], bevel=0.004,
                   uv_tile=0.52)

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

    # 抽屉里的私人物件（彩蛋文案见 src/three/content/DrawerItems.ts）
    item_roots, item_parts = build_drawer_items(
        M, cy - bh / 2 + wall_t, DRAWER["x"], cz_)

    # 物件零件已挂在各自 item root 下，这里只把 root 挂进抽屉本体
    parent([face] + body_parts + [knob] + item_roots, slide_root)
    parent([housing, slide_root], drawer_root)
    objs += ([drawer_root, housing, slide_root, face, knob]
             + body_parts + item_roots + item_parts)
    # 只挂当前仍处于顶层的对象，保留 drawer_root -> drawer_slide 等既有层级。
    parent([obj for obj in objs if obj.parent is None], body_root)
    return [body_root] + objs


# ------------------------------------------------------- 抽屉里的物件（彩蛋）
def build_drawer_items(M, floor_y, cx, cz):
    """
    托盘里的六件私人物件。每件是一个 empty 根节点（命名契约 drawer_item_*）
    加若干零件，运行时由 DrawerItems 拾取并弹出彩蛋卡片。
    floor_y = 托盘内底面（three-Y）；cx / cz = 托盘内部中心。
    所有物件贴合底面不悬空，尺寸按实物（拍立得 86mm、钥匙 55mm、U 盘 55mm）。
    """
    IM = dict(
        photo=mat("photo_paper", (0.90, 0.88, 0.83), rough=0.5),
        photo_img=mat("photo_img", (0.17, 0.19, 0.23), rough=0.42),
        photo_sky=mat("photo_sky", (0.46, 0.38, 0.30), rough=0.42),
        photo_glow=mat("photo_glow", (0.62, 0.50, 0.34), rough=0.42),
        note=mat("note_paper", (0.89, 0.85, 0.73), rough=0.95),
        note_ink=mat("note_ink", (0.24, 0.20, 0.16), rough=0.8),
        plastic=mat("plastic_dark", (0.045, 0.045, 0.05), rough=0.38),
        steel=mat("steel_bright", (0.60, 0.61, 0.63), rough=0.26, metal=0.9),
        grip=mat("driver_grip", (0.13, 0.14, 0.16), rough=0.72),
        ivory=mat("die_ivory", (0.90, 0.87, 0.78), rough=0.3),
    )

    roots = []
    parts = []

    def item(name, x, z, rot, members):
        """把零件挂到 empty 根下，再整体绕根原点水平旋转（Blender Z = three Y）"""
        root = add_empty(name, P(x, floor_y, z))
        bpy.context.view_layer.update()
        parent(members, root)
        root.rotation_euler = (0, 0, rot)
        roots.append(root)
        parts.extend(members)
        return root

    # 1) 旧拍立得：白框 + 褪色相纸，下缘留宽边（相纸朝观者的一侧）
    #    画面分三层（暗前景 / 暖背光 / 昏黄窗光），远看是一张有内容的旧照片
    px, pz = cx - 0.115, cz - 0.055
    item("drawer_item_photo", px, pz, -0.17, [
        add_box("decor_drawer_photo_frame", (0.086, 0.102, 0.0016),
                P(px, floor_y + 0.0008, pz), IM["photo"]),
        add_box("decor_drawer_photo_img", (0.070, 0.070, 0.0006),
                P(px, floor_y + 0.0019, pz - 0.010), IM["photo_img"]),
        add_box("decor_drawer_photo_sky", (0.070, 0.030, 0.0002),
                P(px, floor_y + 0.0023, pz - 0.030), IM["photo_sky"]),
        add_box("decor_drawer_photo_lamp", (0.017, 0.013, 0.0002),
                P(px + 0.017, floor_y + 0.0025, pz - 0.028), IM["photo_glow"]),
    ])

    # 2) 手写便条：小纸片 + 三行墨迹
    nx, nz = cx - 0.113, cz + 0.052
    note_parts = [
        add_box("decor_drawer_note_paper", (0.072, 0.050, 0.0009),
                P(nx, floor_y + 0.00045, nz), IM["note"]),
    ]
    for i, (lw, lz) in enumerate([(0.050, -0.013), (0.046, 0.0), (0.030, 0.013)]):
        note_parts.append(
            add_box(f"decor_drawer_note_line_{i}", (lw, 0.0016, 0.0004),
                    P(nx - 0.008 + lw * 0.5 - 0.021, floor_y + 0.0011, nz + lz),
                    IM["note_ink"]))
    item("drawer_item_note", nx, nz, 0.23, note_parts)

    # 3) 黄铜钥匙：环 + 杆 + 两级齿（从上方看得出钥匙齿的轮廓）
    kx, kz = cx - 0.004, cz + 0.050
    item("drawer_item_key", kx, kz, -0.42, [
        add_torus("decor_drawer_key_ring", 0.0105, 0.0022,
                  P(kx, floor_y + 0.0022, kz + 0.021), M["brass"]),
        add_cylinder("decor_drawer_key_stem", 0.0026, 0.0026, 0.040,
                     P(kx, floor_y + 0.0026, kz - 0.0005), M["brass"],
                     verts=14, axis='Y'),
        add_box("decor_drawer_key_bit_a", (0.0090, 0.0062, 0.0020),
                P(kx + 0.0026, floor_y + 0.0018, kz - 0.0182), M["brass"]),
        add_box("decor_drawer_key_bit_b", (0.0064, 0.0050, 0.0020),
                P(kx + 0.0013, floor_y + 0.0018, kz - 0.0118), M["brass"]),
    ])

    # 4) 精密螺丝刀：磨砂手柄 + 黄铜箍 + 钢杆 + 十字头（拆东西的人）
    dx, dz = cx + 0.036, cz - 0.036
    item("drawer_item_driver", dx, dz, 0.34, [
        add_cylinder("decor_drawer_driver_handle", 0.0058, 0.0068, 0.040,
                     P(dx, floor_y + 0.0068, dz + 0.026), IM["grip"],
                     verts=20, axis='Y'),
        add_cylinder("decor_drawer_driver_ferrule", 0.0034, 0.0034, 0.006,
                     P(dx, floor_y + 0.0068, dz + 0.003), M["brass"],
                     verts=16, axis='Y'),
        add_cylinder("decor_drawer_driver_shaft", 0.0019, 0.0019, 0.042,
                     P(dx, floor_y + 0.0068, dz - 0.021), IM["steel"],
                     verts=12, axis='Y'),
        add_box("decor_drawer_driver_tip", (0.0032, 0.0060, 0.0013),
                P(dx, floor_y + 0.0068, dz - 0.045), IM["steel"]),
    ])

    # 5) U 盘：深色壳体 + 金属接口 + 一粒状态灯
    ux, uz = cx + 0.126, cz - 0.004
    item("drawer_item_usb", ux, uz, -0.28, [
        add_box("decor_drawer_usb_body", (0.019, 0.042, 0.0085),
                P(ux, floor_y + 0.00425, uz + 0.008), IM["plastic"], bevel=0.0012),
        add_box("decor_drawer_usb_conn", (0.0122, 0.0145, 0.0044),
                P(ux, floor_y + 0.0042, uz - 0.0202), IM["steel"], bevel=0.0004),
        add_box("decor_drawer_usb_led", (0.0035, 0.0035, 0.0006),
                P(ux, floor_y + 0.0088, uz + 0.0205), M["ink"]),
    ])

    # 6) 骰子：象牙白小方块 + 顶面五点
    gx, gz = cx + 0.150, cz + 0.046
    die_parts = [
        add_box("decor_drawer_die_body", (0.013, 0.013, 0.013),
                P(gx, floor_y + 0.0065, gz), IM["ivory"], bevel=0.0013),
    ]
    for i, (ox, oz) in enumerate(
            [(-0.0035, -0.0035), (0.0035, -0.0035), (0, 0),
             (-0.0035, 0.0035), (0.0035, 0.0035)]):
        die_parts.append(
            add_sphere(f"decor_drawer_die_pip_{i}", 0.0011,
                       P(gx + ox, floor_y + 0.0128, gz + oz), M["ink"], seg=10))
    item("drawer_item_die", gx, gz, 0.55, die_parts)

    return roots, parts


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
    """
    桌面装饰：真实 CC0 相框。
    实测该模型导入后画心法线朝 Blender +X（不是 ±Y），所以原来那个
    math.pi+0.45 一直把背板对着观者 —— 画面里只有一块黑板。
    rot_z=-1.09 让画心正对主视角相机。
    位置也往左后挪开：原来 (-0.70,-0.24) 会啃进台灯底盘（半径 0.088）。
    """
    objs = []
    frame = import_asset("standing_picture_frame_01", "decor_photo_frame",
                         (-0.72, DESK_TOP_Y, -0.33),
                         rot_z=-1.09, target_height=0.15, drop_slots=("glass",))
    if frame:
        objs.append(frame)
    return objs


# ---------------------------------------------------------------- 导出
def export_glb(objs, filepath):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    kwargs = dict(filepath=filepath, export_format='GLB', export_apply=True,
                  export_tangents=True)
    try:
        bpy.ops.export_scene.gltf(use_selection=True, **kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(export_selected=True, **kwargs)


def main():
    argv = sys.argv
    out_dir = argv[argv.index("--") + 1] if "--" in argv else "./public/models"

    reset_scene()
    build_generated_textures()
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
