/**
 * scene-bridge：整合层与 3D 场景的契约（类型仅在编译期存在）。
 * 运行时由 boot.ts 动态 import('../../three/main') 获得实现，
 * 保证 Three.js 代码不进入首屏关键路径、WebGL 不可用时零加载。
 */
export type { DeskScene, AppState, InitOptions } from '../../three/main';
export type { DeskEvents } from '../../three/core/EventBus';
export { HOTSPOTS, postPartial, postHref, type HotspotId } from '../../lib/hotspots';
