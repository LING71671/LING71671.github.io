import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import { NODES, type NodeName } from '../config/naming';
import { easeOutCubic, type Tween } from '../utils/tween';

/**
 * DrawerItems —— 抽屉里的私人物件与彩蛋。
 *
 * 抽屉拉开后（相机俯视进托盘），六件小物可被拾取：
 *   - hover：物件表面极轻微暖起（只改 emissive，不位移、不浮起）；
 *   - click：物件旁浮出一张纸卡片（CanvasTexture 贴在一片正对相机的平面上），
 *     写一小段与这件东西有关的话；再次点击 / 点空白 / ESC 收起。
 *
 * 命中用每件物体自带的透明代理盒（挂在 item root 下，随抽屉一起滑出）。
 * 一切画面变化显式 invalidate()，动画统一走 manager.tweens。
 */

export type DrawerItemId = 'photo' | 'note' | 'key' | 'driver' | 'usb' | 'die';

interface ItemDef {
  id: DrawerItemId;
  node: NodeName;
  /** 卡片眉标（物件是什么） */
  eyebrow: string;
  /** 正文，每项一行（过长自动折行） */
  lines?: string[];
  /** 有多组正文时每次随机取一组（骰子） */
  variants?: string[][];
}

const ITEMS: ItemDef[] = [
  {
    id: 'photo',
    node: NODES.drawerItemPhoto,
    eyebrow: '一张拍立得 · 二〇一九',
    lines: [
      '第一台被我拆开的机器，宿舍，凌晨。',
      '装回去之后多出两颗螺丝，风扇照转。',
      '从那天起我不太信「不可拆卸」四个字。',
    ],
  },
  {
    id: 'note',
    node: NODES.drawerItemNote,
    eyebrow: '一张便条 · 给翻到这里的人',
    lines: [
      '你把抽屉拉开了，说明你会乱翻东西。',
      '这是好事，愿意打开盖子的人不多。',
      '慢慢看，这里没什么要赶时间的。',
    ],
  },
  {
    id: 'key',
    node: NODES.drawerItemKey,
    eyebrow: '一把黄铜钥匙 · 不知道开哪',
    lines: [
      '老房子的锁早换了，钥匙留着。',
      '拆开一件东西看它怎么工作，',
      '这毛病就是从这类旧物开始的。',
    ],
  },
  {
    id: 'driver',
    node: NODES.drawerItemDriver,
    eyebrow: '一把 PH00 螺丝刀 · 用得最狠',
    lines: [
      '拧得开的东西，都不算黑盒。',
      '拧不开的先找卡扣，再不行有热风枪。',
      '实在打不开，就去读它的固件。',
    ],
  },
  {
    id: 'usb',
    node: NODES.drawerItemUsb,
    eyebrow: '一枚 U 盘 · 32G · 半满',
    lines: [
      '这张桌子跑在 Astro 5 与 three.js 上，',
      '模型是 Blender 脚本长出来的。',
      '盘里还躺着几份不该带出来的固件。',
    ],
  },
  {
    id: 'die',
    node: NODES.drawerItemDie,
    eyebrow: '一颗骰子 · 随手一掷',
    variants: [
      ['凌晨三点写的代码，第二天多半要重写。', '但那一版确实跑通了。'],
      ['「它就是不工作」不算 bug 报告。', '给我一条能复现的路径。'],
      ['哪天你读汇编比读文档快，', '说明那份文档是真的差。'],
      ['先备份，再动手。', '这条是拿一块砖换来的。'],
      ['「能跑就别动」是骗人的。', '能跑更要知道它凭什么能跑。'],
    ],
  },
];

// —— 卡片画布 ——
const CARD_W = 1024;
const CARD_H = 460;
/** 卡片世界宽度（米）；高度按画布比例。卡片贴近相机，物理尺寸小、屏幕上不小 */
const CARD_WORLD_W = 0.17;
const CARD_PAD_X = 62;
const CARD_INNER_PAD_Y = 46;
const EYEBROW_SIZE = 36;
const BODY_SIZE = 48;
const BODY_LINE_H = 74;

const PAPER = '#f5efe0';
const INK = '#2b2117';
const BRASS = '#a8853c';
const FAMILY = '"Noto Serif SC", "Songti SC", "SimSun", serif';
/** 行首禁排标点 */
const NO_LINE_START = '，。、；：！？）』」】〉》…·,.;:!?)]';

/**
 * hover 反馈：物件不位移、不浮起。极轻的暖起 + 表面反光微增
 * （emissive 给深色物件一点存在感，env/rough 给金属与纸面一点光泽）。
 */
const HOVER_EMISSIVE = 0xffc79a;
const HOVER_PEAK = 0.06;
const HOVER_SHEEN_ENV = 0.3;
const HOVER_SHEEN_ROUGH = 0.12;

interface HoverMat {
  mat: THREE.MeshStandardMaterial;
  rough: number;
  env: number;
  /** 按底色明度缩放暖起量：深色件加一点点就够，否则会整个变棕 */
  gain: number;
}

interface ItemRuntime {
  def: ItemDef;
  root: THREE.Object3D;
  proxy: THREE.Mesh;
  mats: HoverMat[];
  hoverK: number;
  tween: Tween | null;
}

export class DrawerItems {
  /** ESC / 点空白请求退出抽屉（由 main.ts 接到 unfocus） */
  onRequestExit: (() => void) | null = null;

  private items: ItemRuntime[] = [];
  private byProxy = new Map<THREE.Object3D, ItemRuntime>();
  private ready = false;
  private focused = false;
  private disposed = false;
  private hoveredId: DrawerItemId | null = null;
  private activeId: DrawerItemId | null = null;
  private lastVariant = new Map<DrawerItemId, number>();

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private card: THREE.Mesh | null = null;
  private cardTween: Tween | null = null;
  private cardK = 0;

  private reducedMotion =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
  ) {}

  /** 场景（desk.glb）就绪后调用：建命中代理与卡片网格；旧模型缺物件时优雅缺席 */
  async mount(): Promise<void> {
    for (const def of ITEMS) {
      const root = this.registry.get(def.node);
      if (!root) continue;
      const proxy = this.buildProxy(root);
      if (!proxy) continue;

      const mats: HoverMat[] = [];
      root.traverse((obj) => {
        if (obj === proxy) return;
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = obj.material;
        if (!(mat instanceof THREE.MeshStandardMaterial)) return;
        // 保险：材质若被别的物件共用则先克隆，避免一件 hover 全屉发亮
        const shared = this.items.some((it) =>
          it.mats.some((entry) => entry.mat === mat),
        );
        const own = shared ? mat.clone() : mat;
        if (shared) obj.material = own;
        own.emissive.setHex(HOVER_EMISSIVE);
        own.emissiveIntensity = 0;
        const lum =
          own.color.r * 0.2126 + own.color.g * 0.7152 + own.color.b * 0.0722;
        mats.push({
          mat: own,
          rough: own.roughness,
          env: own.envMapIntensity,
          gain: 0.28 + 0.72 * Math.min(1, lum),
        });
      });

      const runtime: ItemRuntime = { def, root, proxy, mats, hoverK: 0, tween: null };
      this.items.push(runtime);
      this.byProxy.set(proxy, runtime);
    }
    if (this.items.length === 0) return;

    await this.ensureFonts();
    if (this.disposed) return;

    this.buildCard();
    this.ready = true;
    this.manager.invalidate();
  }

  get available(): boolean {
    return this.ready;
  }

  /** 聚焦态开关：接管 ESC；退出时收起卡片与 hover */
  setFocused(on: boolean): void {
    if (this.focused === on) return;
    this.focused = on;
    if (on) {
      window.addEventListener('keydown', this.onKey);
    } else {
      window.removeEventListener('keydown', this.onKey);
      this.hideCard();
      this.setHovered(null);
    }
  }

  /**
   * 点击分发（InteractionManager 在 drawer 模式调用）。
   * 返回 true = 已被抽屉消费；false = 点在空处且无卡片可收（调用方视为退出意图）。
   */
  handleClick(raycaster: THREE.Raycaster): boolean {
    if (!this.ready) return false;
    const hit = this.pick(raycaster);
    if (hit) {
      if (this.activeId === hit.def.id) this.hideCard();
      else this.showCard(hit);
      return true;
    }
    // 卡片本身也算「点掉」
    if (this.activeId) {
      this.hideCard();
      return true;
    }
    return false;
  }

  /** 悬停命中测试（指针样式 + 暖起反馈） */
  hitTest(raycaster: THREE.Raycaster): boolean {
    if (!this.ready) return false;
    const hit = this.pick(raycaster);
    this.setHovered(hit?.def.id ?? null);
    return hit !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.setFocused(false);
    this.cardTween?.cancel();
    for (const item of this.items) {
      item.tween?.cancel();
      item.proxy.removeFromParent();
      item.proxy.geometry.dispose();
      (item.proxy.material as THREE.Material).dispose();
      for (const entry of item.mats) {
        entry.mat.emissiveIntensity = 0;
        entry.mat.envMapIntensity = entry.env;
        entry.mat.roughness = entry.rough;
      }
    }
    this.items = [];
    this.byProxy.clear();
    if (this.card) {
      this.card.removeFromParent();
      this.card.geometry.dispose();
      (this.card.material as THREE.Material).dispose();
      this.card = null;
    }
    this.texture?.dispose();
    this.texture = null;
    this.ready = false;
  }

  // ———————————————————————— 装配 ————————————————————————

  /** 物件的透明命中代理：按局部包围盒外扩，挂在 item root 下随抽屉滑动 */
  private buildProxy(root: THREE.Object3D): THREE.Mesh | null {
    root.updateWorldMatrix(true, true);
    const inv = root.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.computeBoundingBox();
      const bb = obj.geometry.boundingBox?.clone();
      if (!bb) return;
      obj.updateWorldMatrix(true, false);
      box.union(bb.applyMatrix4(inv.clone().multiply(obj.matrixWorld)));
    });
    if (box.isEmpty()) return null;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // 小物件（骰子、钥匙）要给足命中余量，否则精准点选很难受
    const pad = 0.016;
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(
        size.x + pad,
        Math.max(size.y + pad, 0.02),
        size.z + pad,
      ),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.name = `hit_${root.name}`;
    proxy.position.copy(center);
    root.add(proxy);
    return proxy;
  }

  /** 卡片：一片正对相机的纸，内容由 CanvasTexture 绘制 */
  private buildCard(): void {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.canvas = canvas;
    this.ctx = ctx;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.texture = texture;

    const h = (CARD_WORLD_W * CARD_H) / CARD_W;
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_WORLD_W, h),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        // 卡片浮在桌沿外的空气里；关深度测试是保险，避免任何角度被桌体切掉
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    card.name = 'drawer_card';
    card.renderOrder = 12;
    card.visible = false;
    this.card = card;
    this.manager.scene.add(card);
  }

  private async ensureFonts(): Promise<void> {
    try {
      await Promise.all([
        document.fonts.load(`600 ${EYEBROW_SIZE}px "Noto Serif SC"`, '抽屉旧物'),
        document.fonts.load(`400 ${BODY_SIZE}px "Noto Serif SC"`, '抽屉旧物'),
      ]);
      await document.fonts.ready;
    } catch {
      /* 字体拿不到就回落 serif，不阻塞 */
    }
  }

  // ———————————————————————— 拾取与 hover ————————————————————————

  private pick(raycaster: THREE.Raycaster): ItemRuntime | null {
    const proxies = this.items.map((it) => it.proxy);
    const hit = raycaster.intersectObjects(proxies, false)[0];
    return hit ? (this.byProxy.get(hit.object) ?? null) : null;
  }

  private setHovered(id: DrawerItemId | null): void {
    if (this.hoveredId === id) return;
    const prev = this.hoveredId;
    this.hoveredId = id;
    if (prev) this.animateHover(prev, false);
    if (id) this.animateHover(id, true);
  }

  private animateHover(id: DrawerItemId, on: boolean): void {
    const item = this.items.find((it) => it.def.id === id);
    if (!item) return;
    item.tween?.cancel();
    const from = item.hoverK;
    const to = on ? 1 : 0;
    if (from === to) return;
    const duration = this.reducedMotion ? 0.01 : on ? 0.2 : 0.16;
    item.tween = this.manager.tweens.run({
      duration,
      ease: easeOutCubic,
      onUpdate: (t) => {
        const k = from + (to - from) * t;
        item.hoverK = k;
        for (const entry of item.mats) {
          entry.mat.emissiveIntensity = HOVER_PEAK * entry.gain * k;
          entry.mat.envMapIntensity = entry.env * (1 + HOVER_SHEEN_ENV * k);
          entry.mat.roughness = Math.max(
            0.04,
            entry.rough * (1 - HOVER_SHEEN_ROUGH * k),
          );
        }
        this.manager.invalidate();
      },
      onComplete: () => (item.tween = null),
    });
  }

  // ———————————————————————— 卡片开合 ————————————————————————

  private showCard(item: ItemRuntime): void {
    if (!this.card || !this.ctx) return;
    const lines = this.pickLines(item.def);
    this.drawCard(item.def.eyebrow, lines);
    this.placeCard(item);

    this.activeId = item.def.id;
    this.card.visible = true;
    this.animateCard(1);
  }

  private hideCard(): void {
    if (!this.card || !this.activeId) return;
    this.activeId = null;
    this.animateCard(0);
  }

  private animateCard(to: number): void {
    const card = this.card;
    if (!card) return;
    this.cardTween?.cancel();
    const from = this.cardK;
    if (from === to) return;
    const duration = this.reducedMotion ? 0.01 : to > 0 ? 0.24 : 0.18;
    const mat = card.material as THREE.MeshBasicMaterial;
    this.cardTween = this.manager.tweens.run({
      duration,
      ease: easeOutCubic,
      onUpdate: (t) => {
        this.cardK = from + (to - from) * t;
        mat.opacity = this.cardK;
        // 极轻的浮现：从 96% 放大到 100%，没有位移
        const s = 0.96 + 0.04 * this.cardK;
        card.scale.set(s, s, 1);
        this.manager.invalidate();
      },
      onComplete: () => {
        this.cardTween = null;
        if (this.cardK <= 0) card.visible = false;
      },
    });
  }

  /** 骰子每次换一句（不与上一次重复） */
  private pickLines(def: ItemDef): string[] {
    if (!def.variants || def.variants.length === 0) return def.lines ?? [];
    const last = this.lastVariant.get(def.id);
    let index = Math.floor(Math.random() * def.variants.length);
    if (def.variants.length > 1 && index === last) {
      index = (index + 1) % def.variants.length;
    }
    this.lastVariant.set(def.id, index);
    return def.variants[index] ?? [];
  }

  /**
   * 卡片摆位：在相机空间里把物件抬到它上方一点、再朝相机拉近一点，
   * 横向做限幅，保证无论点哪件卡片都不会飞出画面；朝向完全正对相机。
   */
  private placeCard(item: ItemRuntime): void {
    const card = this.card;
    if (!card) return;
    const camera = this.manager.camera;
    camera.updateMatrixWorld();

    // 相机俯视，「相机空间往上」等于世界里往后仰；因此主要靠朝相机拉近把卡片
    // 送到桌沿之外的空气里，否则会扎进桌体被深度剔除。
    // 纵向对齐到最靠里那件物件之上、纵深取全体均值：点哪一件卡片都停在同一
    // 高度、同一大小，谁也压不住。
    const tmp = new THREE.Vector3();
    let topY = -Infinity;
    let sumZ = 0;
    for (const it of this.items) {
      it.proxy.getWorldPosition(tmp).applyMatrix4(camera.matrixWorldInverse);
      topY = Math.max(topY, tmp.y);
      sumZ += tmp.z;
    }

    const p = item.proxy.getWorldPosition(new THREE.Vector3());
    p.applyMatrix4(camera.matrixWorldInverse);
    p.x = THREE.MathUtils.clamp(p.x, -0.03, 0.03);
    p.y = topY + 0.07;
    p.z = sumZ / this.items.length + 0.19; // 相机空间 +Z 朝相机
    p.applyMatrix4(camera.matrixWorld);

    card.position.copy(p);
    card.quaternion.copy(camera.quaternion);
  }

  // ———————————————————————— 卡片绘制 ————————————————————————

  private drawCard(eyebrow: string, lines: string[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.texture) return;
    ctx.clearRect(0, 0, CARD_W, CARD_H);

    const maxWidth = CARD_W - CARD_PAD_X * 2;
    ctx.font = `400 ${BODY_SIZE}px ${FAMILY}`;
    const wrapped: string[] = [];
    for (const line of lines) wrapped.push(...this.wrap(ctx, line, maxWidth));

    // 卡片高度按内容收缩，多余画布留透明（网格尺寸固定，看不见）
    const bodyH = wrapped.length * BODY_LINE_H;
    const cardH = Math.min(
      CARD_H - 24,
      CARD_INNER_PAD_Y * 2 + EYEBROW_SIZE + 34 + bodyH,
    );
    const top = (CARD_H - cardH) / 2;
    const left = 12;
    const right = CARD_W - 12;

    // 纸面 + 落影（影子画在画布里，不额外加几何体）
    ctx.save();
    ctx.shadowColor = 'rgba(24, 16, 8, 0.34)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 7;
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, cardH, 10);
    ctx.fill();
    ctx.restore();

    // 极细的黄铜描边
    ctx.strokeStyle = 'rgba(168, 133, 60, 0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(left + 1, top + 1, right - left - 2, cardH - 2, 10);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // 眉标 + 分隔线
    let y = top + CARD_INNER_PAD_Y + EYEBROW_SIZE / 2;
    ctx.fillStyle = BRASS;
    ctx.font = `600 ${EYEBROW_SIZE}px ${FAMILY}`;
    ctx.fillText(eyebrow, CARD_PAD_X, y);

    y += EYEBROW_SIZE / 2 + 18;
    ctx.strokeStyle = 'rgba(168, 133, 60, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(CARD_PAD_X, y);
    ctx.lineTo(CARD_W - CARD_PAD_X, y);
    ctx.stroke();

    // 正文
    ctx.fillStyle = INK;
    ctx.font = `400 ${BODY_SIZE}px ${FAMILY}`;
    y += 16;
    for (const line of wrapped) {
      ctx.fillText(line, CARD_PAD_X, y + BODY_LINE_H / 2);
      y += BODY_LINE_H;
    }

    this.texture.needsUpdate = true;
  }

  /** 中文按字断行；行首禁排标点并回上一行（避头点） */
  private wrap(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ): string[] {
    if (ctx.measureText(text).width <= maxWidth) return [text];
    const out: string[] = [];
    let line = '';
    for (const ch of text) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxWidth && line) {
        if (NO_LINE_START.includes(ch)) {
          // 标点不另起一行，宁可让上一行略微超出
          out.push(next);
          line = '';
          continue;
        }
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
    return out;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.activeId) this.hideCard();
    else this.onRequestExit?.();
  };
}
