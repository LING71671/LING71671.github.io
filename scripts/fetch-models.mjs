/**
 * 从 Poly Haven 下载 CC0 3D 模型（gltf + bin + 贴图）到 assets-src/models/<slug>/。
 * 用法: node scripts/fetch-models.mjs [slug...]
 * 无参数时下载 DEFAULT_SLUGS。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_SLUGS = [
  'potted_plant_01',
  'alarm_clock_01',
  'binder_notebook',
  'standing_picture_frame_01',
  'book_encyclopedia_set_01',
];

const RES = '1k';
const OUT_ROOT = 'assets-src/models';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

async function fetchModel(slug) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${slug}`);
  const gltf = files.gltf?.[RES];
  if (!gltf) throw new Error(`${slug}: no gltf/${RES}`);
  const variant = gltf[Object.keys(gltf)[0]];

  const outDir = join(OUT_ROOT, slug);
  const jobs = [[variant.url, join(outDir, variant.url.split('/').pop())]];
  for (const [name, info] of Object.entries(variant.include ?? {})) {
    jobs.push([info.url, join(outDir, name)]);
  }

  let total = 0;
  for (const [url, dest] of jobs) total += await download(url, dest);
  console.log(`${slug}: ${jobs.length} files, ${(total / 1024 / 1024).toFixed(1)}MB`);
  return outDir;
}

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SLUGS;
for (const slug of slugs) {
  try {
    await fetchModel(slug);
  } catch (err) {
    console.error(`FAILED ${slug}: ${err.message}`);
  }
}
