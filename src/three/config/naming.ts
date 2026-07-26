/**
 * GLTF 节点命名契约 —— 唯一事实来源。
 * 占位场景（placeholder/）、NodeRegistry 校验与 docs/gltf-asset-spec.md 三方共用。
 * Blender 物体名必须与此完全一致（snake_case，禁止 .001 后缀）。
 */

export const NODES = {
  // —— 时钟（独立资产 clock.glb，入口先行加载） ——
  clockRoot: 'clock_root',
  clockFace: 'clock_face',
  clockHandHour: 'clock_hand_hour',
  clockHandMinute: 'clock_hand_minute',
  clockHandSecond: 'clock_hand_second',
  /** 分针加粗透明碰撞代理（可选，缺省由代码生成） */
  hitClockMinute: 'hit_clock_minute',

  // —— 书桌与可动部件 ——
  deskBody: 'desk_body',
  drawerRoot: 'drawer_root',
  /** 可动抽屉：原点在关闭位，局部 +Z 为拉出方向 */
  drawerSlide: 'drawer_slide',
  lampRoot: 'lamp_root',
  /** 灯头：原点在关节 */
  lampHead: 'lamp_head',
  /** 灯泡：独立 mesh，独立自发光材质 */
  lampBulb: 'lamp_bulb',
  monitorRoot: 'monitor_root',
  /** 屏幕：独立 mesh，UV 满铺 0-1，emissive 贴图槽 */
  monitorScreen: 'monitor_screen',

  // —— 热点物体组（原点在自身底部中心） ——
  notebookRoot: 'notebook_root',
  calendarRoot: 'calendar_root',
  /** 日历正面：运行时绘制 GitHub 提交记录的贴图承载面 */
  calendarFace: 'calendar_face',
  coffeeRoot: 'coffee_root',
  stickyRoot: 'sticky_root',
  windowRoot: 'window_root',
  windowGlass: 'window_glass',
  /** 窗外实景照片板（不受室内光照影响，按原图呈现） */
  windowView: 'decor_window_view',

  // —— 可选锚点（空节点；缺省用对应 root 包围盒中心） ——
  coffeeSteamAnchor: 'coffee_steam_anchor',
} as const;

export type NodeName = (typeof NODES)[keyof typeof NODES];

/** 换模验收时必须存在的节点（validateContract 检查项） */
export const REQUIRED_NODES: NodeName[] = [
  NODES.clockRoot,
  NODES.clockFace,
  NODES.clockHandHour,
  NODES.clockHandMinute,
  NODES.clockHandSecond,
  NODES.deskBody,
  NODES.drawerRoot,
  NODES.drawerSlide,
  NODES.lampRoot,
  NODES.lampHead,
  NODES.lampBulb,
  NODES.monitorRoot,
  NODES.monitorScreen,
  NODES.notebookRoot,
  NODES.calendarRoot,
  NODES.coffeeRoot,
  NODES.stickyRoot,
  NODES.windowRoot,
];
