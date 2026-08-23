import * as THREE from 'three';
import { withBase } from '../../lib/url';

/**
 * 桌上台历的正面：运行时用 CanvasTexture 绘制 GitHub 提交记录。
 * 数据来自 public/data/github-activity.json（由 scripts/fetch-github-activity.mjs 生成）。
 * 取不到数据时退回只显示日期，绝不留白。
 */

interface ActivityDay {
  date: string;
  count: number;
}

interface Activity {
  user: string;
  days: ActivityDay[];
  total: number;
  latest: { at: string; repo: string | null } | null;
}

const W = 512;
const H = 400;

const CN_MONTH = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawLive(
  ctx: CanvasRenderingContext2D,
  activity: Activity | null,
  now: Date,
): void {
  // 纸面
  ctx.fillStyle = '#f7f2e6';
  ctx.fillRect(0, 0, W, H);

  // 顶部月份条
  ctx.fillStyle = '#a8853c';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillStyle = '#f7f2e6';
  ctx.font = '600 30px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(CN_MONTH[now.getMonth()] ?? '', 26, 32);
  ctx.font = '500 20px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(String(now.getFullYear()), W - 26, 32);
  ctx.textAlign = 'left';

  // 大日期
  ctx.fillStyle = '#2b2117';
  ctx.font = '700 96px "Noto Serif SC", serif';
  ctx.fillText(String(now.getDate()), 26, 128);

  // 星期
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  ctx.fillStyle = '#8a7a62';
  ctx.font = '500 22px "Noto Serif SC", serif';
  ctx.textAlign = 'right';
  ctx.fillText(weekday ?? '', W - 26, 128);
  ctx.textAlign = 'left';

  // 分隔线
  ctx.strokeStyle = '#ded2b6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(26, 178);
  ctx.lineTo(W - 26, 178);
  ctx.stroke();

  if (!activity || activity.days.length === 0) {
    ctx.fillStyle = '#a99b80';
    ctx.font = '500 18px "Noto Serif SC", serif';
    ctx.fillText('提交记录暂不可用', 26, 224);
    return;
  }

  // 提交热力格：7 行（周日→周六）× N 列（周）
  const days = activity.days;
  const cell = 13;
  const gap = 4;
  const gridTop = 200;
  const gridLeft = 58; // 左侧留出星期标签
  const maxCount = Math.max(1, ...days.map((d) => d.count));

  // 星期标签（只标周一/三/五，避免拥挤）
  ctx.fillStyle = '#a99b80';
  ctx.font = '500 12px "Noto Serif SC", serif';
  for (const [row, label] of [[1, '一'], [3, '三'], [5, '五']] as const) {
    ctx.fillText(label, 30, gridTop + row * (cell + gap) + cell / 2);
  }

  // 第一列对齐到该周的星期几
  const firstDow = new Date(days[0]!.date + 'T00:00:00').getDay();
  const weeks = Math.ceil((days.length + firstDow) / 7);
  const maxWeeks = Math.floor((W - gridLeft * 2 + gap) / (cell + gap));
  const skipWeeks = Math.max(0, weeks - maxWeeks);

  days.forEach((day, i) => {
    const slot = i + firstDow;
    const week = Math.floor(slot / 7) - skipWeeks;
    if (week < 0) return;
    const dow = slot % 7;
    const x = gridLeft + week * (cell + gap);
    const y = gridTop + dow * (cell + gap);

    if (day.count === 0) {
      // 空格子要看得见，否则整张格子只剩零星几个亮点，读不出「日历」
      ctx.fillStyle = '#e2d7ba';
    } else {
      const t = Math.min(1, day.count / maxCount);
      // 奶油 → 黄铜 → 深墨，与站点色板同源
      const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
      ctx.fillStyle = `rgb(${lerp(214, 120)}, ${lerp(178, 88)}, ${lerp(96, 34)})`;
    }
    roundRect(ctx, x, y, cell, cell, 3);
  });

  // 底部统计
  const footY = gridTop + 7 * (cell + gap) + 28;
  ctx.fillStyle = '#5a4c3a';
  ctx.font = '600 20px "Noto Serif SC", serif';
  ctx.fillText(`近 13 周 ${activity.total} 次提交`, 30, footY);

  if (activity.latest?.repo) {
    ctx.fillStyle = '#a8853c';
    ctx.font = '500 17px ui-monospace, monospace';
    const repo = activity.latest.repo;
    const label = repo.length > 24 ? `${repo.slice(0, 23)}…` : repo;
    ctx.fillText(label, 30, footY + 28);
  }
}

/** 海报与 WebGL 首帧共用的无日期纸面，避免把捕获日期烘死在图片里。 */
function drawHandoff(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#f7f2e6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#a8853c';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillStyle = '#ded2b6';
  ctx.fillRect(26, 108, 190, 18);
  ctx.fillStyle = '#e9dfc8';
  ctx.fillRect(26, 144, 122, 12);
  ctx.fillStyle = '#ded2b6';
  ctx.fillRect(26, 178, W - 52, 2);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      ctx.fillStyle = row === 0 && column < 3 ? '#d4bc82' : '#e5dbc2';
      roundRect(ctx, 30 + column * 49, 211 + row * 38, 32, 22, 4);
    }
  }
}

/**
 * 给日历正面网格挂上贴图。加载期间只显示确定性纸面，遮罩移除后
 * 才读取当日日期和 GitHub 数据，并在同一张 CanvasTexture 里交叉淡入。
 */
export interface CalendarFaceHandle {
  releaseLoaderHandoff(): void;
  dispose(): void;
}

export function mountCalendarFace(
  mesh: THREE.Mesh,
  invalidate: () => void,
): CalendarFaceHandle | null {
  const canvas = document.createElement('canvas');
  const handoffCanvas = document.createElement('canvas');
  const liveCanvas = document.createElement('canvas');
  for (const target of [canvas, handoffCanvas, liveCanvas]) {
    target.width = W;
    target.height = H;
  }
  const ctx = canvas.getContext('2d');
  const handoffCtx = handoffCanvas.getContext('2d');
  const liveCtx = liveCanvas.getContext('2d');
  if (!ctx || !handoffCtx || !liveCtx) return null;

  drawHandoff(handoffCtx);
  ctx.drawImage(handoffCanvas, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // glTF UV 约定 V 原点在上
  texture.anisotropy = 4;

  const material = mesh.material as THREE.MeshStandardMaterial;
  material.map = texture;
  material.color.setHex(0xffffff);
  material.needsUpdate = true;

  let disposed = false;
  let released = false;
  let frame = 0;
  let controller: AbortController | null = null;

  const commit = (mix: number): void => {
    ctx.globalAlpha = 1;
    ctx.drawImage(handoffCanvas, 0, 0);
    if (mix > 0) {
      ctx.globalAlpha = mix;
      ctx.drawImage(liveCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    texture.needsUpdate = true;
    invalidate();
  };

  const reveal = (activity: Activity | null): void => {
    if (disposed) return;
    drawLive(liveCtx, activity, new Date());
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      commit(1);
      return;
    }
    const startedAt = performance.now();
    const tick = (now: number): void => {
      if (disposed) return;
      const linear = Math.min(1, (now - startedAt) / 520);
      const eased = 1 - Math.pow(1 - linear, 4);
      commit(eased);
      if (linear < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };

  return {
    releaseLoaderHandoff(): void {
      if (released || disposed) return;
      released = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 2500);
      void fetch(withBase('/data/github-activity.json'), { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Activity | null) => reveal(data?.days ? data : null))
        .catch(() => reveal(null))
        .finally(() => window.clearTimeout(timeout));
    },
    dispose(): void {
      disposed = true;
      controller?.abort();
      cancelAnimationFrame(frame);
      texture.dispose();
    },
  };
}
