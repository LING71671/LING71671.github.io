/**
 * 从同一张固定机位山景生成四个现实时间段的窗外贴图。
 *
 * 只做逐像素色彩映射与垂直光照渐变，不生成、裁切或移动地貌，确保四张图
 * 的山脊、云海和前景完全像素对齐。
 *
 * 用法：node scripts/gen-window-times.mjs
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const SOURCE = join(ROOT, 'assets-src', 'textures', 'window_view.jpg');
const OUTPUT_DIR = join(ROOT, 'public', 'images', 'window');
const CONTACT_SHEET = join(ROOT, 'output', 'window-times-contact-sheet.webp');

const WIDTH = 1536;
const HEIGHT = 1024;
const SIZE_BUDGET = 180 * 1024;

const variants = [
  {
    name: 'dawn',
    label: 'DAWN  07:20',
    // 冷蓝空气，山脊与地平线仅留一圈很薄的暖光。
    modulate: { brightness: 0.78, saturation: 0.78 },
    recomb: [
      [0.79, 0.08, 0.03],
      [0.03, 0.85, 0.07],
      [0.02, 0.11, 1.03],
    ],
    overlays: [
      ['#132a48', 0.26, 0, 0.62],
      ['#e49a73', 0.13, 0.36, 0.63],
      ['#07111f', 0.20, 0.55, 1],
    ],
  },
  {
    name: 'noon',
    label: 'NOON  12:00',
    // 去除落日偏红，提亮雪线和云海，形成中性、宽阔的日光。
    modulate: { brightness: 1.12, saturation: 0.72 },
    recomb: [
      [0.86, 0.08, 0.03],
      [0.02, 0.96, 0.05],
      [0.01, 0.07, 1.04],
    ],
    overlays: [
      ['#4f87af', 0.11, 0, 0.48],
      ['#fff4d8', 0.10, 0.28, 0.78],
      ['#dce8ee', 0.08, 0.62, 1],
    ],
  },
  {
    name: 'sunset',
    label: 'SUNSET  18:20',
    // 延续源图真实的侧逆光，只把暖区收束为铜粉色，而非橙色滤镜。
    modulate: { brightness: 0.91, saturation: 1.06 },
    recomb: [
      [1.02, 0.04, 0.00],
      [0.01, 0.94, 0.02],
      [0.01, 0.03, 0.91],
    ],
    overlays: [
      ['#b95443', 0.10, 0.22, 0.66],
      ['#e69b68', 0.10, 0.36, 0.72],
      ['#1b1420', 0.13, 0.62, 1],
    ],
  },
  {
    name: 'night',
    label: 'NIGHT  23:10',
    // 深夜蓝黑，保留微弱的云海层次；不新增月亮或星星，避免破坏固定构图。
    modulate: { brightness: 0.46, saturation: 0.58 },
    recomb: [
      [0.48, 0.07, 0.02],
      [0.04, 0.57, 0.08],
      [0.03, 0.13, 0.82],
    ],
    overlays: [
      ['#061426', 0.38, 0, 0.68],
      ['#0b2038', 0.28, 0.42, 1],
      ['#02070e', 0.25, 0.69, 1],
    ],
  },
];

function verticalOverlay(colour, peakOpacity, start, end) {
  const top = Math.max(0, Math.round(start * HEIGHT));
  const bottom = Math.min(HEIGHT, Math.round(end * HEIGHT));
  const fade = Math.max(32, Math.round((bottom - top) * 0.24));
  const opaqueStart = Math.min(bottom, top + fade);
  const opaqueEnd = Math.max(top, bottom - fade);
  const hex = colour.replace('#', '');
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const stop = (y, opacity) =>
    `<stop offset="${((y / HEIGHT) * 100).toFixed(3)}%" stop-color="rgb(${red},${green},${blue})" stop-opacity="${opacity}"/>`;

  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          ${stop(Math.max(0, top - fade), 0)}
          ${stop(opaqueStart, peakOpacity)}
          ${stop(opaqueEnd, peakOpacity)}
          ${stop(Math.min(HEIGHT, bottom + fade), 0)}
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g)"/>
    </svg>
  `);
}

async function renderVariant(variant) {
  const overlays = variant.overlays.map(([colour, opacity, start, end]) => ({
    input: verticalOverlay(colour, opacity, start, end),
    blend: 'over',
  }));

  const pixels = await sharp(SOURCE)
    .resize(WIDTH, HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .modulate(variant.modulate)
    .recomb(variant.recomb)
    .composite(overlays)
    .toColourspace('srgb')
    .toBuffer();

  let quality = 76;
  let encoded;
  do {
    encoded = await sharp(pixels)
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    quality -= 3;
  } while (encoded.length > SIZE_BUDGET && quality >= 49);

  if (encoded.length > SIZE_BUDGET) {
    throw new Error(`${variant.name}.webp 超过 180KB：${encoded.length} bytes`);
  }

  const path = join(OUTPUT_DIR, `${variant.name}.webp`);
  // 直接写入已通过预算验收的编码结果，避免 toFile() 按默认质量二次编码。
  await writeFile(path, encoded);
  const metadata = await sharp(path).metadata();
  if (metadata.width !== WIDTH || metadata.height !== HEIGHT || metadata.format !== 'webp') {
    throw new Error(`${variant.name}.webp 格式验收失败`);
  }

  return { ...variant, path, bytes: encoded.length, quality: quality + 3 };
}

async function createContactSheet(results) {
  const cellWidth = 768;
  const imageHeight = 512;
  const labelHeight = 48;
  const sheetWidth = cellWidth * 2;
  const sheetHeight = (imageHeight + labelHeight) * 2;
  const composites = [];

  for (const [index, result] of results.entries()) {
    const left = (index % 2) * cellWidth;
    const top = Math.floor(index / 2) * (imageHeight + labelHeight);
    const image = await sharp(result.path)
      .resize(cellWidth, imageHeight, { fit: 'fill' })
      .toBuffer();
    const label = Buffer.from(`
      <svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#0d0b0a"/>
        <text x="22" y="31" fill="#eadfc9" font-size="18" font-family="Georgia, serif" letter-spacing="2">${result.label}</text>
        <text x="${cellWidth - 22}" y="31" text-anchor="end" fill="#a58e6b" font-size="14" font-family="Arial, sans-serif">${(result.bytes / 1024).toFixed(1)} KB · Q${result.quality}</text>
      </svg>
    `);
    composites.push({ input: image, left, top });
    composites.push({ input: label, left, top: top + imageHeight });
  }

  await mkdir(dirname(CONTACT_SHEET), { recursive: true });
  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: '#0d0b0a',
    },
  })
    .composite(composites)
    .webp({ quality: 84, effort: 6, smartSubsample: true })
    .toFile(CONTACT_SHEET);
}

await mkdir(OUTPUT_DIR, { recursive: true });
const results = [];
for (const variant of variants) results.push(await renderVariant(variant));
await createContactSheet(results);

for (const result of results) {
  const { size } = await stat(result.path);
  console.log(`${result.name}.webp  ${WIDTH}x${HEIGHT}  ${(size / 1024).toFixed(1)}KB  Q${result.quality}`);
}
console.log(`contact sheet: ${CONTACT_SHEET}`);
