# GLTF 资产规范 —— 3D 书桌博客

本文档是 3D 场景模型的**命名与结构契约**。当前资产由 `scripts/blender/build_desk.py`
程序化生成（`pwsh scripts/export-glb.ps1` 一键重建）；任何后续手工建模 / 精修的替换资产，
只要满足本契约即可**零代码改动**换入（`NodeRegistry.validateContract()` 可自动验收，
dev 下访问 `/?placeholder=1` 可与占位场景对比调试）。

## 产物

| 文件 | 内容 | 预算 | 当前 |
|---|---|---|---|
| `public/models/clock.glb` | 时钟（入口先行加载） | < 300KB | ~151KB |
| `public/models/desk.glb` | 书桌、房间与其余物件 | < 4MB | ~2.45MB |

## 坐标与单位

- 米制，1 unit = 1m；桌面上表面 y = **0.75**；桌宽约 1.6m
- glTF +Y up；世界原点在桌面面板中心正下方的地面
- 窗户在 **-X** 侧后墙（z ≈ -0.55），观者从 +Z 看向 -Z
- 关键位置常量与 `src/three/config/layout.ts` 保持同步（相机入口位姿依赖 `CLOCK` 坐标）

## 命名契约（snake_case，禁止 `.001` 后缀）

必需节点（缺失即 validateContract 报错）：

| 节点 | 类型 | pivot / 轴向要求 |
|---|---|---|
| `clock_root` | 组 | 底座落地点；可带轻微 yaw |
| `clock_face` | mesh | 原点在表盘圆心，法线 +Z（朝观者） |
| `clock_hand_hour` / `_minute` / `_second` | mesh | **原点在旋转轴心**；建模指向 12 点 = 局部 +Y；运行时绕局部 Z 旋转 |
| `desk_body`（或含 `desk_top`） | mesh/组 | — |
| `drawer_root` | 组 | 抽屉柜体 |
| `drawer_slide` | 组/mesh | **原点在关闭位**，局部 +Z 为拉出方向（行程 0.24m 由代码控制） |
| `lamp_root` / `lamp_head` / `lamp_bulb` | 组/mesh | `lamp_head` 原点在关节；`lamp_bulb` 独立自发光材质 |
| `monitor_root` / `monitor_screen` | 组/mesh | 屏幕独立 mesh，**UV 满铺 0-1**（运行时注入 CanvasTexture） |
| `notebook_root` / `calendar_root` / `coffee_root` / `sticky_root` / `window_root` | 组 | 原点在自身底部中心 |

可选节点：

| 节点 | 说明 |
|---|---|
| `window_glass` | 玻璃独立 mesh（简单半透明，禁 transmission） |
| `clock_ticks` | 刻度合并 mesh，独立材质（校准接近时代码提亮 emissive） |
| `hit_clock_minute` | 分针命中代理；缺省由 AssetLoader 自动生成 |
| `coffee_steam_anchor` | 空节点，蒸汽挂点 |
| `decor_*` | 纯装饰，静态可合并 |

## 材质要求

- PBR metal-rough；关键大表面（`wood_desk` / `wood_floor` / `wallpaper` / `linen` /
  `rug` / `wainscot`）必须同时带 `normalTexture`、共享 ORM 的
  `metallicRoughnessTexture` 与 `occlusionTexture`
- 禁 transmission；clearcoat / sheen 只允许在确有物理含义的材质上少量使用：
  漆木、黄铜、陶瓷釉与亚麻，不得把所有材质升级成 `MeshPhysicalMaterial`
- 运行时按 emissiveIntensity 调控的材质（灯泡 / 屏幕 / 刻度）会在导入后被
  `AssetLoader.prepare()` 显式重设 emissive 颜色 —— 建模侧只需保证**材质独立不共享**
- 场景面数预算 ≤ 65k 三角（当前约 50k），draw call ≤ 160；背景盆栽 ≤18k、
  书架书本 ≤8k，禁止小背景物重新吃掉大部分几何预算
- 桌木与亚麻的 base color / normal 可保留 1K；其 ORM 与其余大表面 512，窗景 1K；
  WebP 解码后的估算纹理显存（RGBA8 + mipmaps）≤84MB
- 桌面、抽屉面和搁板木纹必须按真实尺寸投影，约 0.5m/tile，纹理方向与构件长轴一致；
  禁止沿用 Blender 默认 cube atlas 把整个桌面压进约 1/16 张贴图

## 导出（Blender）

- glb、+Y up（默认）、Apply Modifiers；关键大表面的法线贴图网格导出 tangent；不含灯光/相机
  （光照全代码驱动）
- 静态件 Apply All Transforms；可动件（指针/抽屉/灯头）保留正确 origin；禁负缩放
- 无头一键：`pwsh scripts/export-glb.ps1`（Blender 位于 `E:\Blender`）

## 压缩（scripts/optimize-gltf.mjs）

管线为 `dedup → prune → WebP/分级缩放 → quantize → meshopt`，并在末尾验收
文件体积、三角面、draw call、关键 PBR 槽与纹理显存。必须保留以下约束：

- `--join false --flatten false`：合并/拍扁会毁掉命名契约节点
- `--palette false`：调色板化会重写 UV 指向单像素，毁掉运行时贴图槽
- `--prune-attributes false`：屏幕贴图运行时才注入，构建期 UV「看似未用」不能剪
- `--simplify false`：小几何体简化易变形

## 运行时加固（AssetLoader，换模者无需关心但值得知道）

- `ensureHandPivots()`：指针网格被包进位于表盘轴心的 pivot Group 再旋转 ——
  即使压缩管线把量化偏移烘进节点 TRS，指针依然绕正确轴心转
- `ensureClockHitProxy()`：自动补齐覆盖全表盘的透明命中盘
- 手工赋给 glTF 网格的 CanvasTexture 必须 `flipY = false`（glTF UV 约定 V 原点在上）
