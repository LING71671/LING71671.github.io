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

  // 关键：禁用 join/flatten/simplify —— 命名契约节点（指针/抽屉/锚点）不可合并拍扁
  execFileSync(
    'npx',
    [
      'gltf-transform',
      'optimize',
      path,
      path,
      '--compress',
      'meshopt',
      '--texture-compress',
      'false',
      '--join',
      'false',
      '--flatten',
      'false',
      '--simplify',
      'false',
      // palette 会把纯色材质并成调色板贴图并重写 UV，破坏运行时贴图槽（屏幕）
      '--palette',
      'false',
      // 屏幕材质的贴图在运行时才注入，构建期 UV 看似未使用，不能剪
      '--prune-attributes',
      'false',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  const after = statSync(path).size;
  console.log(
    `${file}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`,
  );
}
