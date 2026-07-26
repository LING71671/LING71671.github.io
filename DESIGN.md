# Design

## Visual Theme

「温暖木质书桌」：奶油纸张底、深墨文字、黄铜点缀、暖木结构。HTML 侧是安静的纸面排版；3D 侧是一张可停留的书桌，昼夜两种光照状态（自然窗光 / 琥珀台灯）。
（注：本项目的奶油纸底色来自 2026-07 设计稿的既定品牌决策，属 identity-preservation，不按新项目色彩规则重议。）

## Color Palette

来源：`src/styles/tokens.css`（唯一事实源，昼/夜双套）。

| Token | 昼 | 夜 | 用途 |
|---|---|---|---|
| `--paper` | #f5efe0 | #1d1610 | 页面底色 |
| `--paper-raised` | #fbf6ea | #292016 | 卡片/面板 |
| `--paper-sunken` | #ece3cd | #15100b | 内嵌区/代码底 |
| `--ink` | #2b2117 | #e9dcc2 | 标题/正文 |
| `--ink-soft` | #5a4c3a | #b3a184 | 次级文字 |
| `--brass` | #a8853c | #d8a24a | 链接/点缀/激活 |
| `--wood` | #6b4a2b | #8a6238 | 结构装饰 |

3D 材质同源：木 #7a5230 系、黄铜金属、奶油陶瓷、琥珀灯光 #ffb46b。

## Typography

- 正文/标题：Noto Serif SC（400/500/700，unicode-range 分片）
- 手写感点缀（便签/状态卡/引言）：LXGW WenKai Screen
- 代码：ui-monospace 栈
- 字号阶梯 `--text-xs`…`--text-3xl`（1.75/2.125rem 顶格）；正文行高 1.8–2.0

## Components

- 布局：`.container`(64rem) / `.container-narrow`(44rem)；卡片 `.card`（细线 + 浅影，圆角 10px）
- 内容组件：PostCard / ProjectCard / StatusCard / FilterTabs / TagList / Breadcrumb / RelatedPosts
- 覆盖面板 `#panel`：从物体投影位置 FLIP 展开，圆角 16px，移动端全屏
- 动效常量：`--dur-fast`180ms / `--dur`240ms / `--dur-slow`320ms，`--ease-out` quart 系；reduced-motion 全局降 1ms

## 3D Scene

- 场景与资产契约：`docs/gltf-asset-spec.md`；命名唯一事实源 `src/three/config/naming.ts`
- 光照：环境贴图 + Hemisphere + 窗光 Directional（昼投影）+ 台灯 Spot（夜投影），台灯三档=环境/专注/夜间
- 相机：入口时钟特写 → 主视角；±15° 环视；热点聚焦位姿相对包围盒中心定义
- 性能：按需渲染（空闲零帧）、单投影光、meshopt 压缩 GLB、三档画质分级
