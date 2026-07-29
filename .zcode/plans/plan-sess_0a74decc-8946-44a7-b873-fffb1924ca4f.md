## 目标

恢复快速首帧（去掉 await HDRI），让 HDRI 后台替换时通过 `environmentIntensity` 柔化过渡掩盖反射突变，消除「突然变暗一个度」的可见跳变。

## 根因回顾

- `await HDRI`（main.ts:104）阻塞 `manager.start()`，导致白色期过长（用户反馈「卡了好久」）
- 去掉 await 后，HDRI 替换 `scene.environment`（RoomEnvironment → HDR）瞬间 PBR 反射突变可见
- 用户选择「保留快速首帧 + HDRI 柔化」策略

## 改动点

### 1. 去掉 `await HDRI`（`src/three/main.ts`）

删除 `init()` 中 `await this.lighting.awaitEnvironment()`（line 102-104），恢复快速首帧。删除 `awaitEnvironment` 方法和 `envReady` 字段（`LightingSystem.ts`）。

### 2. HDRI 柔化过渡（`src/three/lighting/LightingSystem.ts`）

引入 `envDim` 乘数（默认 1.0），`applyValues` 里 `environmentIntensity = v.envI * this.envDim`。

在 `setupEnvironment()` 的 HDR 替换回调里：
1. 用 tween 把 `envDim` 1→0（~0.25s，反射淡出）
2. 在最低点替换 `scene.environment`（此时反射近乎不可见，替换无感）
3. 再 tween `envDim` 0→1（~0.25s，反射淡入新 HDR）

过渡期间每帧 `applyValues(this.current)` + `invalidate()`，保证 `envDim` 生效且画面更新。

### 3. 预加载保留

`BaseHead.astro` 的三个 preload（clock.glb / desk.glb / HDRI）保留--它们让网络请求并行，缩短首帧前的资源等待，且 HDRI 命中缓存后 `loadAsync` 几乎瞬时，柔化过渡很快触发。

## 不改动

- `composeScene()` 的 clock.glb/desk.glb 加载逻辑（保持现状，避免引入风险）
- 入口流程、光照过渡逻辑
- preload 链路

## 预期效果

- 白色期短（恢复改动前状态，首帧不被 HDRI 阻塞）
- HDRI 替换时 PBR 反射通过 envDim 柔化淡入淡出，无可见突变
- 整体时序：白屏（短）→ 淡紫/暗紫空场（preload 已缩短）→ 正常场景（无突变）