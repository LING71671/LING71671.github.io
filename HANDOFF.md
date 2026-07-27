# 3D 书桌博客 — 接手文档

## 运行

```bash
npm run dev      # 开发服务器 http://localhost:4321
npm run build    # 生产构建（自动裁剪字体 + 压缩模型）
npm run models   # 重建 3D 模型（Blender 无头导出 + gltf-transform）
npm test         # 角度数学单测
npm run parity   # partial 与完整页内容一致性检查
```

## 架构速览

```
B:\blog\
├── astro.config.mjs / tsconfig.json / package.json
├── docs\gltf-asset-spec.md          # GLTF 资产规范（踩坑记录在里面）
├── public\models\clock.glb, desk.glb # Blender 导出（3MB，meshopt 压缩）
├── public\data\github-activity.json  # 构建时生成（GitHub 提交热力数据）
├── public\env\artist_workshop_1k.hdr # HDRI 环境贴图
├── scripts\
│   ├── blender\build_desk.py         # Blender 程序化建模（E:\Blender 无头运行）
│   ├── optimize-gltf.mjs             # gltf-transform 压缩管线
│   ├── prune-legacy-fonts.mjs        # 构建后删 legacy woff
│   ├── fetch-models.mjs              # 从 Poly Haven 下载 CC0 模型
│   ├── fetch-github-activity.mjs     # 从 GitHub API 抓提交数据
│   └── check-parity.mjs              # partial vs 完整页一致性
├── src\
│   ├── config\site.ts                # 站点身份（Ling / LING71671）
│   ├── content.config.ts             # Astro content collections
│   ├── content\{posts,projects,status} # Markdown 内容
│   ├── lib\                          # 工具库（archive / related / hotspots / url）
│   ├── components\                   # Astro 组件（PostCard / StatusCard / views 等）
│   ├── layouts\                      # BaseLayout / ContentLayout
│   ├── pages\                        # 路由页面 + partials\
│   ├── styles\tokens.css             # 设计 token（昼/夜双主题 CSS 变量）
│   ├── scripts\desk\                 # HTML ↔ Three.js 整合层
│   │   ├── boot.ts                   # WebGL 检测 → 动态 import 3D → 事件接线
│   │   ├── panel-router.ts           # pushState / popstate 历史编排
│   │   ├── overlay-fsm.ts            # 面板 FLIP 动画 + 滚动锁
│   │   └── storage.ts               # localStorage / sessionStorage 统一读写
│   └── three\                        # 3D 场景（纯 Three.js，不碰 DOM/URL）
│       ├── main.ts                   # DeskScene 类 → 对外唯一边界
│       ├── core\                     # SceneManager / EventBus / NodeRegistry / AssetLoader
│       ├── camera\                   # CameraRig（三层叠加）+ poses（位姿定义）
│       ├── interaction\              # InteractionManager / ClockController / HotspotSystem
│       ├── lighting\                 # LightingSystem + SkyWindow + presets
│       ├── audio\AudioManager.ts     # WebAudio 合成音
│       ├── content\                  # 内容渲染进 3D 物体（核心创新）
│       │   ├── BookRenderer.ts       # 文章排版渲染到书页
│       │   ├── ScreenOS.ts           # DOM 贴到显示器屏幕（桌面 OS）
│       │   ├── CalendarFace.ts       # GitHub 热力格画到台历
│       │   └── DrawerItems.ts        # 抽屉物件彩蛋
│       └── config\naming.ts          # GLTF 节点命名契约（唯一事实源）
```

## 当前状态

### 已落地（已提交 df0bc5a）

| 功能 | 状态 | 备注 |
|------|------|------|
| 入口校准时钟 | ✅ | 7:20±1min 判定，阻尼拖拽，无跳过入口 |
| 场景 + 8 热点 | ✅ | Hover 接触光晕（不浮起），写实风格 |
| 笔记本 → 书页阅读 | ✅ | 目录 + 翻页动画 + CanvasTexture 排版，behavior='in-scene' |
| 显示器 → 屏幕 OS | ✅ | CSS3DRenderer，Ling OS 桌面 + 可开文件夹 |
| 日历 → GitHub 热力格 | ✅ | 运行时 CanvasTexture 绘制提交记录 |
| 抽屉 → 物件彩蛋 | ✅ | 6 件物品可点，CanvasTexture 卡片浮出 |
| 台灯三档 | ✅ | 环境/专注/夜间，window.deskTheme.setLamp() |
| 昼夜主题 | ✅ | HDRI + 真实时间混合 + 窗外照片调色 |
| 性能（按需渲染） | ✅ | 静止零帧，中位 16.6ms，100 帧零掉帧 |
| 站点身份 Ling | ✅ | GitHub 头像、真实仓库作项目，4 篇技术文章 |
| 降级与 SEO | ✅ | 无 WebGL 时语义化首页 + 完整 HTML 页面 |
| 深链 | ✅ | /posts/xxx/ 直接访问纯 HTML |
| 回归 | ✅ | build 0 错误，11 单测全过，parity OK |

### 待修（已知问题）

1. **Blender 模型需要重导出** — build_desk.py 被改了（rug、cornice、drawer items）但 public/models/desk.glb 还是旧的压缩产物。`npm run models` 后会完整重建。
2. **dist 体积 37MB** — 主要是 691 个 Noto Serif SC woff2 子集文件（~29MB），中文宋体 unicode-range 分片是必须的。已删了 303 个 legacy woff（省 11.5MB）和 raw.glb 泄漏（省 15MB）。
3. **墙面上半部分** — cornice 和 picture rail 加了但 Agent 还没跑导出，需要 `npm run models` 后才能看到效果。
4. **书页交互** — BookRenderer 加了翻页提示和 hover 高亮，但用户之前说「不舒服」，可能需要进一步调整手感参数。
5. **移动端未实测** — 代码路径写了（touch-action + pointer capture），但没真机验过。
6. **desk.glb 3.1MB** — 对 4G 网络还行，想更小可以砍 CC0 模型的贴图分辨率。

### 关键约定（接手时注意）

- **按需渲染不容破坏**：任何画面变化必须调 `manager.invalidate()`，updater 返回值仅表示「继续存活」，不表示「要出帧」
- **GLB 压缩必须禁五样**：join/flatten/palette/prune-attributes/simplify，法线量化 12 位（否则纸面出斜纹伪影）
- **Playwright 点击用显式命令**：mousemove X Y / mousedown / mouseup，`page.mouse.click` 不派发 pointer 事件
- **dev 钩子**：`window.__desk.api`（DeskScene 实例）、`window.__desk.test.completeClock()`
- **改内容后 dev 不刷新**：删 `.astro` 目录重启（Astro 内容缓存）
- **Blender 在 E:\Blender**：`npm run models` 或手输 `"E:/Blender/blender.exe" --background --factory-startup --python scripts/blender/build_desk.py -- public/models`

### git 历史（共 8 个 commit）

```
df0bc5a drawer easter-eggs + book UX + room polish + font pruning  ← HEAD
123ed5d Fix the stutter, the window, the drawer gap, and hide the dev toolbar
4cb2cc0 Monitor becomes an operable desktop OS on the 3D screen
2ef3c20 Book pages render real articles in 3D; calendar shows GitHub heatmap
80a3f00 Realism pass + Ling identity + GitHub-synced calendar
a3da353 M6: regression suite green — parity check, OG image, prod flow verified
77589c6 M5: Blender-scripted GLTF assets + meshopt pipeline
3d00494 M2+M3: placeholder 3D desk, entry clock, overlay integration
```

若要回滚到某个里程碑，`git checkout <hash>` 即可。
