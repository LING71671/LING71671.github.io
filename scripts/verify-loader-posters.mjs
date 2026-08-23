/** Build gate for the loader's 2 poses × 9 moments × 2 orientations. */
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public', 'images', 'loader');
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
const layouts = [
  { suffix: '', width: 1440, height: 900, budget: 220 * 1024 },
  { suffix: '-portrait', width: 430, height: 932, budget: 130 * 1024 },
];

const errors = [];
let total = 0;
const expected = new Set();
for (const pose of poses) {
  for (const moment of moments) {
    for (const layout of layouts) {
      const name = `${pose}-${moment}${layout.suffix}.webp`;
      expected.add(name);
      const path = join(DIR, name);
      try {
        const info = await stat(path);
        const metadata = await sharp(path).metadata();
        total += info.size;
        if (metadata.format !== 'webp') errors.push(`${name}: expected WebP`);
        if (metadata.width !== layout.width || metadata.height !== layout.height) {
          errors.push(
            `${name}: expected ${layout.width}x${layout.height}, got ` +
              `${metadata.width ?? '?'}x${metadata.height ?? '?'}`,
          );
        }
        if (info.size > layout.budget) {
          errors.push(
            `${name}: ${(info.size / 1024).toFixed(1)}KB exceeds ` +
              `${(layout.budget / 1024).toFixed(0)}KB`,
          );
        }
      } catch (error) {
        errors.push(`${name}: missing or unreadable (${error.message})`);
      }
    }
  }
}

try {
  const actual = (await readdir(DIR)).filter((name) => name.endsWith('.webp'));
  for (const name of actual) {
    if (!expected.has(name)) errors.push(`${name}: unexpected stale poster`);
  }
} catch (error) {
  errors.push(`loader directory missing or unreadable (${error.message})`);
}

if (errors.length > 0) {
  throw new Error(`Loader poster verification failed:\n- ${errors.join('\n- ')}`);
}

const totalBudget = 3 * 1024 * 1024;
if (total > totalBudget) {
  throw new Error(
    `Loader poster set ${(total / 1024 / 1024).toFixed(2)}MB exceeds 3MB`,
  );
}

console.log(`loader posters: ${expected.size} files, ${(total / 1024).toFixed(1)}KB total`);
