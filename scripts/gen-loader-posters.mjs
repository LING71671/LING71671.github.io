/**
 * Encode the live scene's authored time anchors from final browser captures.
 *
 * Source naming (kept outside git):
 *   output/loader-source/{entry|home}-{night|predawn|dawn|sunrise|morning|noon|afternoon|sunset|bluehour}-{landscape|portrait}.png
 *
 * Output naming (served by the inline loader selector):
 *   public/images/loader/entry-dawn.webp
 *   public/images/loader/entry-dawn-portrait.webp
 *
 * Usage: npm run loader-posters
 */
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const SOURCE_DIR = join(ROOT, 'output', 'loader-source');
const OUTPUT_DIR = join(ROOT, 'public', 'images', 'loader');

const poses = ['entry', 'home'];
const moments = [
  'night',
  'predawn',
  'dawn',
  'sunrise',
  'morning',
  'noon',
  'afternoon',
  'sunset',
  'bluehour',
];
const layouts = {
  landscape: { width: 1440, height: 900, suffix: '', budget: 220 * 1024 },
  portrait: { width: 430, height: 932, suffix: '-portrait', budget: 130 * 1024 },
};

async function encode(source, name, profile) {
  // Read once, normalize to the exact authored viewport, then lower quality only
  // when necessary. The loader may fetch two adjacent moments, so each file has
  // its own hard transfer budget.
  const input = await readFile(source);
  const pixels = await sharp(input)
    .resize(profile.width, profile.height, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .toColourspace('srgb')
    .toBuffer();

  let quality = 76;
  let encoded;
  do {
    encoded = await sharp(pixels)
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    quality -= 3;
  } while (encoded.length > profile.budget && quality >= 52);

  if (encoded.length > profile.budget) {
    throw new Error(`${name} exceeds ${(profile.budget / 1024).toFixed(0)}KB`);
  }

  const metadata = await sharp(encoded).metadata();
  if (
    metadata.format !== 'webp' ||
    metadata.width !== profile.width ||
    metadata.height !== profile.height
  ) {
    throw new Error(`${name} failed format or dimension validation`);
  }
  return { encoded, bytes: encoded.length, quality: quality + 3 };
}

const jobs = [];
for (const pose of poses) {
  for (const moment of moments) {
    for (const [layout, profile] of Object.entries(layouts)) {
      const source = join(SOURCE_DIR, `${pose}-${moment}-${layout}.png`);
      const name = `${pose}-${moment}${profile.suffix}.webp`;
      await access(source);
      jobs.push({ source, name, profile });
    }
  }
}

// Encode and validate every source before touching the currently published set.
// This keeps a failed capture or an over-budget frame from leaving a half-new
// manifest in public/images/loader.
const encodedJobs = [];
for (const job of jobs) {
  const result = await encode(job.source, job.name, job.profile);
  encodedJobs.push({ ...job, ...result });
}

const outputParent = dirname(OUTPUT_DIR);
await mkdir(outputParent, { recursive: true });
const stageDir = await mkdtemp(join(outputParent, '.loader-stage-'));
const backupDir = join(
  outputParent,
  `.loader-previous-${process.pid}-${Date.now()}`,
);
let movedPrevious = false;

try {
  for (const job of encodedJobs) {
    await writeFile(join(stageDir, job.name), job.encoded);
    const { size } = await stat(join(stageDir, job.name));
    console.log(
      `${job.name}  ${job.profile.width}x${job.profile.height}  ` +
        `${(size / 1024).toFixed(1)}KB  Q${job.quality}`,
    );
  }

  try {
    await access(OUTPUT_DIR);
    await rename(OUTPUT_DIR, backupDir);
    movedPrevious = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await rename(stageDir, OUTPUT_DIR);
  if (movedPrevious) await rm(backupDir, { recursive: true, force: true });
} catch (error) {
  // Restore the last complete manifest if the directory swap itself fails.
  try {
    await access(OUTPUT_DIR);
  } catch {
    if (movedPrevious) await rename(backupDir, OUTPUT_DIR);
  }
  throw error;
} finally {
  await rm(stageDir, { recursive: true, force: true });
}
