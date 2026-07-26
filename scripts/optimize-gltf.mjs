/**
 * GLB 压缩管线：dedup → prune → meshopt 量化压缩。
 * 用法: node scripts/optimize-gltf.mjs [输入目录=public/models]
 * 产物原地覆盖（.glb），运行前自动备份 .raw.glb（gitignore 外，仅本地）。
 * 选 meshopt 而非 draco：解码器更小、解码更快，加载端已配 MeshoptDecoder。
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'public/models');
const files = ['clock.glb', 'desk.glb'];

for (const file of files) {
  const path = join(dir, file);
  if (!existsSync(path)) {
    console.warn(`跳过（不存在）: ${path}`);
    continue;
  }
  const backup = path.replace(/\.glb$/, '.raw.glb');
  copyFileSync(path, backup);
  const before = statSync(path).size;

  const run = (args) =>
    execFileSync('npx', ['gltf-transform', ...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

  // 1) 清理：去重 + 剪枝（保留顶点属性 —— 屏幕贴图运行时才注入，UV 不能剪）
  run(['dedup', path, path]);
  run(['prune', path, path, '--keep-attributes', 'true']);

  // 2) 贴图：缩到 512 并转 WebP（CC0 模型自带 1k 贴图，体积占大头；
  //    three.js 原生支持 WebP，无需额外解码器）
  //    窗外实景是画面里唯一的大面积「照片」，缩到 512 会糊，单独保留 1024。
  run([
    'resize', path, path,
    '--width', '512', '--height', '512',
    '--pattern', '!(*window_view*)',
  ]);
  run([
    'resize', path, path,
    '--width', '1024', '--height', '1024',
    '--pattern', '*window_view*',
  ]);
  run(['webp', path, path, '--quality', '82']);

  // 3) 量化：法线/UV 提高到 12/14 位。默认 8 位法线会在平整纸面上
  //    与环境贴图反射叠出可见的三角形条纹（斜纹伪影），必须提精度。
  run([
    'quantize', path, path,
    '--quantize-position', '14',
    '--quantize-normal', '12',
    '--quantize-texcoord', '14',
    '--quantize-color', '8',
  ]);

  // 4) meshopt 压缩（不再让 optimize 顺手做 join/flatten/palette/simplify，
  //    那些会破坏命名契约节点与运行时贴图槽）
  run(['meshopt', path, path, '--level', 'medium']);

  const after = statSync(path).size;
  console.log(
    `${file}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`,
  );
}
