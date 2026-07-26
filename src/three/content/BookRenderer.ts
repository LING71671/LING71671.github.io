import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import { NODES } from '../config/naming';
import { withBase } from '../../lib/url';
import { postPartial } from '../../lib/hotspots';
import { SITE } from '../../config/site';
import { easeOutCubic } from '../utils/tween';

/**
 * BookRenderer —— 把文章内容直接渲染到 3D 笔记本的书页上（就地阅读）。
 *
 * 做法：不改动 decor_page_l / decor_page_r 曲面本身（solidify + bend 的 UV 不干净），
 * 而是在两页上表面各贴合一片「纸面」PlaneGeometry：
 *   - 顶点沿 -Y 射线投射到页面网格上取高度（drape），文字随纸页微曲更贴合；
 *   - CanvasTexture 承载排版（标题 / meta / 正文，横排中文，Noto Serif SC）；
 *   - 翻页由一片绕书脊（notebook 局部 Z 轴）旋转 180 度的「翻动页」完成，
 *     正面 / 背面分别贴旧页与新页纹理（背面纹理水平镜像，翻过来正好读正）。
 *
 * 内容来自 partial 片段路由：/partials/posts/（目录）与 /partials/posts/<slug>/（单篇）。
 * 目录跨（spread 0）左页是笔记本扉页，右页为文章清单，点击条目进入该文章。
 */

// —— 画布与排版常量 ——
const W = 1024;
/** 页面几何比例约 0.266 / 0.184 = 1.446，画布同比避免文字被拉伸 */
const H = 1480;
const MX = Math.round(W * 0.12); // 页边距（宽度的 12%）
const TOP = 148;
const BOTTOM = 128;
const FOOT_Y = H - 70;

const PAPER = '#ede6d4'; // 与 decor_page 材质底色一致
const INK = '#2b2117';
const SUB = '#5a4c3a';

const FAMILY = '"Noto Serif SC", "Songti SC", "SimSun", serif';
const MONO = '"Cascadia Mono", Consolas, "Courier New", monospace';

type StyleKey = 'title' | 'meta' | 'body' | 'h2' | 'quote' | 'code' | 'tocTitle' | 'tocSub';

interface Style {
  font: string;
  lineH: number;
  color: string;
}

const STYLES: Record<StyleKey, Style> = {
  title: { font: `700 58px ${FAMILY}`, lineH: 86, color: INK },
  meta: { font: `400 27px ${FAMILY}`, lineH: 46, color: SUB },
  body: { font: `400 33px ${FAMILY}`, lineH: 63, color: INK }, // 行高约 1.9
  h2: { font: `700 40px ${FAMILY}`, lineH: 70, color: INK },
  quote: { font: `400 30px ${FAMILY}`, lineH: 57, color: SUB },
  code: { font: `400 24px ${MONO}`, lineH: 42, color: '#4a3b2c' },
  tocTitle: { font: `600 36px ${FAMILY}`, lineH: 60, color: INK },
  tocSub: { font: `400 25px ${FAMILY}`, lineH: 42, color: SUB },
};

/** 行首禁排标点（简单避头点：并入上一行） */
const NO_LINE_START = '，。、；：！？）』」】〉》…‥·,.;:!?)]%~';

// —— 排版数据结构 ——

interface Line {
  text: string;
  x: number;
  /** 行盒顶部 y（绘制时用 middle 基线取行盒中心） */
  y: number;
  style: StyleKey;
  /** 装饰分隔线（忽略 text） */
  rule?: boolean;
}

interface HitRegion {
  y0: number;
  y1: number;
  slug: string;
}

interface Page {
  lines: Line[];
  regions: HitRegion[];
  /** null = 不显示页码（目录页） */
  pageNo: number | null;
}

type Block =
  | { kind: 'text'; text: string; style: StyleKey; spaceBefore: number; indent?: number; hang?: string }
  | { kind: 'rule'; spaceBefore: number }
  | { kind: 'toc'; title: string; sub: string; slug: string; index: number; spaceBefore: number }
  | { kind: 'break' };

interface PostRef {
  slug: string;
  title: string;
  date: string;
}

/** 装饰页面节点名：不在 naming.ts 命名契约内（该文件归属其他任务，不在本模块修改范围） */
const PAGE_L_NAME = 'decor_page_l';
const PAGE_R_NAME = 'decor_page_r';

const FLIP_DURATION = 0.52;

export class BookRenderer {
  /** ESC / 点击书外请求退出（由 main.ts 接到 unfocus） */
  onRequestExit: (() => void) | null = null;

  private ready = false;
  private focused = false;
  private flipping = false;
  private mode: 'toc' | 'post' = 'toc';
  private spread = 0;
  private slug: string | null = null;

  private group: THREE.Group | null = null;
  private sheetL: THREE.Mesh | null = null;
  private sheetR: THREE.Mesh | null = null;
  private flipPivot: THREE.Group | null = null;

  private canvasL = document.createElement('canvas');
  private canvasR = document.createElement('canvas');
  private canvasFlipF = document.createElement('canvas');
  private canvasFlipB = document.createElement('canvas');
  private texL: THREE.CanvasTexture | null = null;
  private texR: THREE.CanvasTexture | null = null;
  private texFlipF: THREE.CanvasTexture | null = null;
  private texFlipB: THREE.CanvasTexture | null = null;

  /** 文本测量用 scratch context */
  private measureCtx: CanvasRenderingContext2D;

  private tocPages: Page[] | null = null;
  private tocLoading: Promise<void> | null = null;
  private postCache = new Map<string, Page[]>();
  /** 当前静态双页展示的内容 */
  private curL: Page | null = null;
  private curR: Page | null = null;

  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
  ) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('[BookRenderer] 无法创建 2D 上下文');
    this.measureCtx = ctx;
    for (const c of [this.canvasL, this.canvasR, this.canvasFlipF, this.canvasFlipB]) {
      c.width = W;
      c.height = H;
    }
  }

  // ———————————————————————— 装配 ————————————————————————

  /** 场景（desk.glb）就绪后调用：建纸面网格，内容惰性加载（首次聚焦时 prepare） */
  async mount(): Promise<void> {
    const root = this.registry.get(NODES.notebookRoot);
    const pageL = this.manager.scene.getObjectByName(PAGE_L_NAME);
    const pageR = this.manager.scene.getObjectByName(PAGE_R_NAME);
    if (!root || !(pageL instanceof THREE.Mesh) || !(pageR instanceof THREE.Mesh)) {
      // 占位场景 / 旧模型：优雅缺席，handleClick 恒返回 false
      return;
    }

    await this.ensureFonts();
    if (this.disposed) return;

    root.updateWorldMatrix(true, true);
    const invRoot = root.matrixWorld.clone().invert();
    const bbL = this.localBox(pageL, invRoot);
    const bbR = this.localBox(pageR, invRoot);
    if (!bbL || !bbR) return;

    this.group = new THREE.Group();
    this.group.name = 'book_renderer_root';
    root.add(this.group);

    this.texL = this.makeTexture(this.canvasL, false);
    this.texR = this.makeTexture(this.canvasR, false);
    this.texFlipF = this.makeTexture(this.canvasFlipF, false);
    // 翻动页背面：水平镜像，翻转 180 度后内容读正
    this.texFlipB = this.makeTexture(this.canvasFlipB, true);

    const rootWorldY = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld).y;
    this.sheetL = this.buildSheet(bbL, pageL, rootWorldY, this.texL);
    this.sheetR = this.buildSheet(bbR, pageR, rootWorldY, this.texR);

    // 翻动页：绕书脊（局部 Z 轴）旋转；书脊取两页内缘中点
    const spineX = (bbL.max.x + bbR.min.x) / 2;
    const pageW = bbR.max.x - bbR.min.x;
    const pageD = bbR.max.z - bbR.min.z;
    const spineY = Math.max(bbL.max.y, bbR.max.y) + 0.0012;
    this.flipPivot = new THREE.Group();
    this.flipPivot.position.set(spineX, spineY, (bbR.min.z + bbR.max.z) / 2);
    this.flipPivot.visible = false;

    const flipGeo = new THREE.PlaneGeometry(pageW * 0.985, pageD * 0.985);
    flipGeo.rotateX(-Math.PI / 2);
    flipGeo.translate((pageW * 0.985) / 2, 0, 0);
    const front = new THREE.Mesh(
      flipGeo,
      new THREE.MeshStandardMaterial({ map: this.texFlipF, roughness: 0.9, metalness: 0 }),
    );
    front.name = 'book_flip_front';
    // 背面：同一几何体，只从背面可见（BackSide），纹理已镜像
    const back = new THREE.Mesh(
      flipGeo,
      new THREE.MeshStandardMaterial({
        map: this.texFlipB,
        roughness: 0.9,
        metalness: 0,
        side: THREE.BackSide,
      }),
    );
    back.name = 'book_flip_back';
    this.flipPivot.add(front, back);
    this.group.add(this.flipPivot);

    // 初始：空白纸面（颜色与页面一致，远看无感）
    this.drawPage(this.canvasL, null, 'left');
    this.drawPage(this.canvasR, null, 'right');
    this.commitTextures();
    this.ready = true;
    this.manager.invalidate();
  }

  /** 首次聚焦前调用：拉取目录并绘制（相机 0.8s 飞行时间内通常可完成） */
  async prepare(): Promise<void> {
    if (!this.ready || this.tocPages) return;
    if (!this.tocLoading) this.tocLoading = this.loadToc();
    await this.tocLoading;
  }

  get available(): boolean {
    return this.ready;
  }

  // ———————————————————————— 对外交互 ————————————————————————

  /** 聚焦态开关：接管左右方向键翻页与 ESC 退出 */
  setFocused(on: boolean): void {
    if (this.focused === on) return;
    this.focused = on;
    if (on) window.addEventListener('keydown', this.onKey);
    else window.removeEventListener('keydown', this.onKey);
  }

  /**
   * 点击分发（InteractionManager 在 book 模式调用）。
   * 返回 true = 已被书页消费；false = 未命中书页（调用方可视为退出意图）。
   */
  handleClick(raycaster: THREE.Raycaster): boolean {
    if (!this.ready || !this.sheetL || !this.sheetR) return false;
    const hits = raycaster.intersectObjects([this.sheetL, this.sheetR], false);
    const hit = hits[0];
    if (!hit || !hit.uv) return false;
    if (this.flipping) return true;

    const isRight = hit.object === this.sheetR;
    const cx = hit.uv.x * W;
    const cy = (1 - hit.uv.y) * H;

    // 目录右页：命中文章条目 → 打开该篇
    if (isRight && this.mode === 'toc') {
      const region = this.curR?.regions.find((r) => cy >= r.y0 - 10 && cy <= r.y1 + 10);
      if (region) {
        void this.openPost(region.slug);
        return true;
      }
    }
    // 右页右侧四分之一 → 下一跨；左页左侧四分之一 → 上一跨
    if (isRight && cx > W * 0.75) {
      this.nextSpread();
      return true;
    }
    if (!isRight && cx < W * 0.25) {
      this.prevSpread();
      return true;
    }
    return true; // 命中书页其余区域：消费掉，避免误触退出
  }

  /** 悬停命中测试（用于指针样式） */
  hitTest(raycaster: THREE.Raycaster): boolean {
    if (!this.ready || !this.sheetL || !this.sheetR) return false;
    return raycaster.intersectObjects([this.sheetL, this.sheetR], false).length > 0;
  }

  /** 打开某篇文章（翻页动画进入其第一跨） */
  async openPost(slug: string): Promise<void> {
    if (!this.ready || this.flipping) return;
    const pages = await this.loadPost(slug);
    if (!pages || this.disposed) return;
    this.mode = 'post';
    this.slug = slug;
    this.spread = 0;
    this.flip('next', pages[0] ?? null, pages[1] ?? null);
  }

  nextSpread(): void {
    if (!this.ready || this.flipping) return;
    const pages = this.currentPages();
    const next = this.spread + 1;
    if (!pages || next * 2 >= pages.length) return;
    this.spread = next;
    this.flip('next', pages[next * 2] ?? null, pages[next * 2 + 1] ?? null);
  }

  prevSpread(): void {
    if (!this.ready || this.flipping) return;
    if (this.spread === 0) {
      // 文章第一跨再往前 = 合上文章回到目录
      if (this.mode === 'post' && this.tocPages) {
        this.mode = 'toc';
        this.slug = null;
        this.flip('prev', this.tocPages[0] ?? null, this.tocPages[1] ?? null);
      }
      return;
    }
    const pages = this.currentPages();
    if (!pages) return;
    this.spread -= 1;
    this.flip('prev', pages[this.spread * 2] ?? null, pages[this.spread * 2 + 1] ?? null);
  }

  setVisible(v: boolean): void {
    if (!this.group) return;
    this.group.visible = v;
    this.manager.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.setFocused(false);
    this.group?.removeFromParent();
    for (const mesh of [this.sheetL, this.sheetR]) {
      mesh?.geometry.dispose();
      (mesh?.material as THREE.Material | undefined)?.dispose();
    }
    if (this.flipPivot) {
      for (const child of this.flipPivot.children) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
    }
    for (const tex of [this.texL, this.texR, this.texFlipF, this.texFlipB]) tex?.dispose();
    this.group = null;
    this.sheetL = null;
    this.sheetR = null;
    this.flipPivot = null;
    this.ready = false;
  }

  // ———————————————————————— 网格构建 ————————————————————————

  /** 页面网格在 notebook_root 局部空间的包围盒 */
  private localBox(page: THREE.Mesh, invRoot: THREE.Matrix4): THREE.Box3 | null {
    page.geometry.computeBoundingBox();
    const bb = page.geometry.boundingBox?.clone();
    if (!bb) return null;
    page.updateWorldMatrix(true, false);
    return bb.applyMatrix4(invRoot.clone().multiply(page.matrixWorld));
  }

  /** 建一片贴合页面上表面的纸面（顶点向下投射到页面网格取高度） */
  private buildSheet(
    bb: THREE.Box3,
    pageMesh: THREE.Mesh,
    rootWorldY: number,
    tex: THREE.CanvasTexture,
  ): THREE.Mesh {
    const w = (bb.max.x - bb.min.x) * 0.985;
    const d = (bb.max.z - bb.min.z) * 0.985;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;

    const geo = new THREE.PlaneGeometry(w, d, 32, 6);
    geo.rotateX(-Math.PI / 2); // 平躺，法线 +Y；u 沿 +X，v=1 在 -Z（远端 = 页顶）

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 }),
    );
    mesh.name = `book_sheet_${cx < 0 ? 'l' : 'r'}`;
    mesh.position.set(cx, 0, cz);
    mesh.receiveShadow = true;
    this.group!.add(mesh);
    mesh.updateWorldMatrix(true, false);

    // drape：逐顶点取页面表面高度 + 0.5mm 抬升（避免 z-fighting）
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    const lift = 0.0005;
    const fallbackY = bb.max.y + lift;
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), 0, pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
      this.raycaster.set(new THREE.Vector3(v.x, rootWorldY + 0.2, v.z), down);
      this.raycaster.far = 0.5;
      const hit = this.raycaster.intersectObject(pageMesh, false)[0];
      const localY = hit ? hit.point.y - rootWorldY + lift : fallbackY;
      pos.setY(i, localY - 0); // mesh y=0，父空间高度即顶点 y
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return mesh;
  }

  private makeTexture(canvas: HTMLCanvasElement, mirrored: boolean): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.manager.renderer.capabilities.getMaxAnisotropy());
    if (mirrored) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;
      tex.offset.x = 1;
    }
    return tex;
  }

  // ———————————————————————— 内容获取与解析 ————————————————————————

  private async fetchText(url: string): Promise<string | null> {
    try {
      const res = await fetch(withBase(url));
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  private async loadToc(): Promise<void> {
    const html = await this.fetchText('/partials/posts/');
    if (this.disposed) return;
    const posts: PostRef[] = [];
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/posts/"]'))) {
        const m = (a.getAttribute('href') ?? '').match(/\/posts\/([^/]+)\/?$/);
        const title = a.textContent?.trim();
        if (!m?.[1] || !title) continue;
        const card = a.closest('article');
        const date = card?.querySelector('time')?.textContent?.trim() ?? '';
        posts.push({ slug: decodeURIComponent(m[1]), title, date });
      }
    }
    this.tocPages = this.buildTocPages(posts);
    // 若当前正显示目录（含空白初始态），立即落到纸面
    if (this.mode === 'toc' && !this.flipping) {
      this.showSpread(this.tocPages[0] ?? null, this.tocPages[1] ?? null);
    }
  }

  private async loadPost(slug: string): Promise<Page[] | null> {
    const cached = this.postCache.get(slug);
    if (cached) return cached;
    const html = await this.fetchText(postPartial(slug));
    if (!html) return null;
    const pages = this.paginate(this.parsePost(html));
    this.postCache.set(slug, pages);
    return pages;
  }

  /** 单篇 partial → 排版块（标题 / meta / 正文；剥标签、保段落） */
  private parsePost(html: string): Block[] {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('.article-head h1')?.textContent?.trim() ?? '无题';
    const date = doc.querySelector('.post-meta time')?.textContent?.trim() ?? '';

    const blocks: Block[] = [];
    const prose = doc.querySelector('.prose');
    const bodyBlocks: Block[] = [];
    let charCount = 0;

    const pushText = (text: string, style: StyleKey, spaceBefore: number, indent = 0, hang = '') => {
      const t = text.replace(/\s+/g, ' ').trim();
      if (!t) return;
      charCount += t.replace(/\s/g, '').length;
      bodyBlocks.push({ kind: 'text', text: t, style, spaceBefore, indent, hang });
    };

    for (const el of Array.from(prose?.children ?? [])) {
      const tag = el.tagName;
      if (tag === 'P') {
        pushText(el.textContent ?? '', 'body', 28);
      } else if (tag === 'H2' || tag === 'H3' || tag === 'H4') {
        pushText(el.textContent ?? '', 'h2', 54);
      } else if (tag === 'UL' || tag === 'OL') {
        const items = Array.from(el.querySelectorAll(':scope > li'));
        items.forEach((li, i) => {
          const marker = tag === 'OL' ? `${i + 1}. ` : '· ';
          pushText(li.textContent ?? '', 'body', i === 0 ? 24 : 10, 36, marker);
        });
      } else if (tag === 'BLOCKQUOTE') {
        for (const p of Array.from(el.querySelectorAll('p'))) {
          pushText(p.textContent ?? '', 'quote', 24, 34);
        }
      } else if (tag === 'PRE') {
        const codeLines = (el.textContent ?? '').replace(/\n+$/, '').split('\n');
        codeLines.forEach((lineText, i) => {
          bodyBlocks.push({
            kind: 'text',
            text: lineText.length > 0 ? lineText : ' ',
            style: 'code',
            spaceBefore: i === 0 ? 26 : 0,
            indent: 24,
          });
        });
      } else if (tag === 'FIGURE' || tag === 'IMG') {
        const cap = el.querySelector('figcaption')?.textContent?.trim();
        pushText(cap ? `〔图〕${cap}` : '〔图〕', 'meta', 24);
      } else {
        pushText(el.textContent ?? '', 'body', 28);
      }
    }

    blocks.push({ kind: 'text', text: title, style: 'title', spaceBefore: 0 });
    const metaParts = [date, `约 ${charCount} 字`].filter(Boolean);
    blocks.push({ kind: 'text', text: metaParts.join(' · '), style: 'meta', spaceBefore: 22 });
    blocks.push({ kind: 'rule', spaceBefore: 34 });
    blocks.push(...bodyBlocks);
    return blocks;
  }

  /** 目录：左页扉页 + 右页起的文章清单 */
  private buildTocPages(posts: PostRef[]): Page[] {
    const blocks: Block[] = [
      { kind: 'text', text: `${SITE.name} 的笔记本`, style: 'title', spaceBefore: 300 },
      { kind: 'rule', spaceBefore: 40 },
      { kind: 'text', text: '在安静的环境里写下的思考、设计与记录。', style: 'quote', spaceBefore: 44 },
      { kind: 'text', text: '点击右页的篇目开始阅读。', style: 'tocSub', spaceBefore: 220 },
      { kind: 'text', text: '点击页面外缘可以翻页，也可以用左右方向键。', style: 'tocSub', spaceBefore: 10 },
      { kind: 'text', text: '按 Esc 或点击书页之外合上笔记本。', style: 'tocSub', spaceBefore: 10 },
      { kind: 'break' },
      { kind: 'text', text: '目 录', style: 'h2', spaceBefore: 0 },
      { kind: 'rule', spaceBefore: 26 },
    ];
    if (posts.length === 0) {
      blocks.push({
        kind: 'text',
        text: '（这一本还没有写下任何篇目。）',
        style: 'quote',
        spaceBefore: 60,
      });
    } else {
      posts.forEach((p, i) => {
        blocks.push({
          kind: 'toc',
          title: p.title,
          sub: p.date,
          slug: p.slug,
          index: i + 1,
          spaceBefore: i === 0 ? 44 : 34,
        });
      });
    }
    const pages = this.paginate(blocks);
    for (const page of pages) page.pageNo = null;
    return pages;
  }

  // ———————————————————————— 排版与分页 ————————————————————————

  /** 中文按字断行、英文按词断行；行首避标点 */
  private wrap(text: string, style: StyleKey, maxW: number): string[] {
    const ctx = this.measureCtx;
    ctx.font = STYLES[style].font;
    const cjk = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\u3000-\\u303F\\uFF01-\\uFF60';
    const re = new RegExp(`[${cjk}]|[^\\s${cjk}]+|\\s+`, 'g');
    const tokens = text.match(re) ?? [text];

    const lines: string[] = [];
    let cur = '';
    let curW = 0;
    for (const token of tokens) {
      const tw = ctx.measureText(token).width;
      if (curW + tw <= maxW || cur === '') {
        cur += token;
        curW += tw;
        continue;
      }
      if (/^\s+$/.test(token)) {
        // 行末空白吞掉，直接换行
        lines.push(cur);
        cur = '';
        curW = 0;
        continue;
      }
      if (token.length === 1 && NO_LINE_START.includes(token)) {
        // 避头点：标点并入上一行（轻微超边距可接受）
        cur += token;
        lines.push(cur);
        cur = '';
        curW = 0;
        continue;
      }
      lines.push(cur);
      cur = token.trimStart();
      curW = ctx.measureText(cur).width;
    }
    if (cur.trim() !== '' || lines.length === 0) lines.push(cur);
    return lines;
  }

  /** 把块序列排入若干页（左页 = 偶数下标、右页 = 奇数下标） */
  private paginate(blocks: Block[]): Page[] {
    const pages: Page[] = [];
    let cur: Page = { lines: [], regions: [], pageNo: 1 };
    let y = TOP;

    const closePage = (): void => {
      pages.push(cur);
      cur = { lines: [], regions: [], pageNo: pages.length + 1 };
      y = TOP;
    };
    const fit = (need: number): void => {
      if (y + need > H - BOTTOM && cur.lines.length > 0) closePage();
    };

    for (const block of blocks) {
      if (block.kind === 'break') {
        closePage();
        continue;
      }
      if (block.kind === 'rule') {
        fit(block.spaceBefore + 8);
        if (cur.lines.length > 0) y += block.spaceBefore;
        cur.lines.push({ text: '', x: MX, y, style: 'meta', rule: true });
        y += 8;
        continue;
      }
      if (block.kind === 'toc') {
        const numGutter = 64;
        const titleLines = this.wrap(block.title, 'tocTitle', W - MX * 2 - numGutter).slice(0, 2);
        const need =
          block.spaceBefore + titleLines.length * STYLES.tocTitle.lineH + STYLES.tocSub.lineH;
        fit(need);
        const startY = cur.lines.length > 0 ? y + block.spaceBefore : y;
        y = startY;
        titleLines.forEach((lineText, i) => {
          cur.lines.push({
            text: i === 0 ? `${String(block.index).padStart(2, '0')}  ${lineText}` : lineText,
            x: i === 0 ? MX : MX + numGutter,
            y,
            style: 'tocTitle',
          });
          y += STYLES.tocTitle.lineH;
        });
        if (block.sub) {
          cur.lines.push({ text: block.sub, x: MX + numGutter, y, style: 'tocSub' });
          y += STYLES.tocSub.lineH;
        }
        cur.regions.push({ y0: startY, y1: y, slug: block.slug });
        continue;
      }

      // 普通文本块
      const style = STYLES[block.style];
      const indent = block.indent ?? 0;
      const hang = block.hang ?? '';
      this.measureCtx.font = style.font;
      const hangW = hang ? Math.ceil(this.measureCtx.measureText(hang).width) : 0;
      const maxW = W - MX * 2 - indent - (hang ? hangW : 0);
      const lines =
        block.style === 'code'
          ? [block.text] // 代码行不折行（超宽截断绘制）
          : this.wrap(block.text, block.style, maxW);

      lines.forEach((lineText, i) => {
        const before = i === 0 ? block.spaceBefore : 0;
        fit(before + style.lineH);
        if (cur.lines.length > 0 && i === 0) y += block.spaceBefore;
        const isFirst = i === 0;
        cur.lines.push({
          text: isFirst && hang ? hang + lineText : lineText,
          x: MX + indent + (isFirst || !hang ? 0 : hangW),
          y,
          style: block.style,
        });
        y += style.lineH;
      });
    }
    if (cur.lines.length > 0) pages.push(cur);
    return pages;
  }

  // ———————————————————————— 绘制 ————————————————————————

  private drawPage(canvas: HTMLCanvasElement, page: Page | null, side: 'left' | 'right'): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);

    // 书脊内侧的淡淡阴影（左页在右缘，右页在左缘）
    const gx0 = side === 'left' ? W - 110 : 110;
    const gx1 = side === 'left' ? W : 0;
    const grad = ctx.createLinearGradient(gx0, 0, gx1, 0);
    grad.addColorStop(0, 'rgba(43, 33, 23, 0)');
    grad.addColorStop(1, 'rgba(43, 33, 23, 0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(Math.min(gx0, gx1), 0, 110, H);

    if (!page) return;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const line of page.lines) {
      const style = STYLES[line.style];
      if (line.rule) {
        ctx.strokeStyle = 'rgba(168, 133, 60, 0.55)'; // 黄铜色分隔线
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(MX, line.y + 4);
        ctx.lineTo(W - MX, line.y + 4);
        ctx.stroke();
        continue;
      }
      ctx.font = style.font;
      ctx.fillStyle = style.color;
      ctx.fillText(line.text, line.x, line.y + style.lineH / 2, W - MX - line.x + 30);
    }

    // 页脚页码（外侧角）
    if (page.pageNo !== null) {
      ctx.font = `400 24px ${FAMILY}`;
      ctx.fillStyle = SUB;
      ctx.textAlign = side === 'left' ? 'left' : 'right';
      ctx.fillText(`· ${page.pageNo} ·`, side === 'left' ? MX : W - MX, FOOT_Y);
      ctx.textAlign = 'left';
    }
  }

  private commitTextures(): void {
    if (this.texL) this.texL.needsUpdate = true;
    if (this.texR) this.texR.needsUpdate = true;
  }

  /** 无动画直接落一跨（初始化 / 减动效） */
  private showSpread(left: Page | null, right: Page | null): void {
    this.curL = left;
    this.curR = right;
    this.drawPage(this.canvasL, left, 'left');
    this.drawPage(this.canvasR, right, 'right');
    this.commitTextures();
    this.manager.invalidate();
  }

  // ———————————————————————— 翻页动画 ————————————————————————

  private currentPages(): Page[] | null {
    if (this.mode === 'post' && this.slug) return this.postCache.get(this.slug) ?? null;
    return this.tocPages;
  }

  /**
   * 翻动页绕书脊转 180 度：
   * next（右→左）：正面 = 旧右页，背面 = 新左页；静态右页先换新，翻完左页落定。
   * prev（左→右）：背面 = 旧左页，正面 = 新右页；静态左页先换新，翻完右页落定。
   */
  private flip(dir: 'next' | 'prev', newL: Page | null, newR: Page | null): void {
    if (!this.flipPivot || this.reducedMotion) {
      this.showSpread(newL, newR);
      return;
    }
    this.flipping = true;

    if (dir === 'next') {
      this.drawPage(this.canvasFlipF, this.curR, 'right');
      this.drawPage(this.canvasFlipB, newL, 'left');
      this.drawPage(this.canvasR, newR, 'right');
    } else {
      this.drawPage(this.canvasFlipB, this.curL, 'left');
      this.drawPage(this.canvasFlipF, newR, 'right');
      this.drawPage(this.canvasL, newL, 'left');
    }
    if (this.texFlipF) this.texFlipF.needsUpdate = true;
    if (this.texFlipB) this.texFlipB.needsUpdate = true;
    this.commitTextures();

    this.curL = newL;
    this.curR = newR;

    const pivot = this.flipPivot;
    pivot.rotation.z = dir === 'next' ? 0 : Math.PI;
    pivot.visible = true;

    this.manager.tweens.run({
      duration: FLIP_DURATION,
      ease: easeOutCubic,
      onUpdate: (t) => {
        pivot.rotation.z = dir === 'next' ? Math.PI * t : Math.PI * (1 - t);
        this.manager.invalidate();
      },
      onComplete: () => {
        // 静态页落定，隐藏翻动页
        if (dir === 'next') this.drawPage(this.canvasL, this.curL, 'left');
        else this.drawPage(this.canvasR, this.curR, 'right');
        this.commitTextures();
        pivot.visible = false;
        this.flipping = false;
        this.manager.invalidate();
      },
    });
  }

  // ———————————————————————— 键盘与字体 ————————————————————————

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.nextSpread();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prevSpread();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.onRequestExit?.();
    }
  };

  /** canvas 绘制中文前确保 Noto Serif SC 就绪（失败回落系统衬线） */
  private async ensureFonts(): Promise<void> {
    try {
      await Promise.all([
        document.fonts.load(`700 58px "Noto Serif SC"`, '目录笔记'),
        document.fonts.load(`400 33px "Noto Serif SC"`, '目录笔记'),
      ]);
      await document.fonts.ready;
    } catch {
      /* 字体加载失败不阻塞：回落 serif */
    }
  }
}
