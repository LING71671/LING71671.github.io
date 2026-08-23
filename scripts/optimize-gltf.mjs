/**
 * GLB 压缩管线：dedup → prune → 贴图缩放/WebP → 量化 → meshopt。
 * 用法: node scripts/optimize-gltf.mjs [输入目录=public/models]
 * 产物原地覆盖（.glb），运行前自动备份到 assets-src/models-raw。
 *
 * 贴图不再调用 `gltf-transform resize/webp`。当前 Windows 环境中的
 * ndarray-pixels + sharp/libvips 组合会在该路径报
 * `colourspace: parameter space not set`；直接把 GLB 内嵌图片交给 Sharp
 * 则没有这层 float ndarray 色彩空间转换，也更容易做严格的后置校验。
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const WEBP_EXTENSION = 'EXT_texture_webp';
const DEFAULT_TEXTURE_LIMIT = 512;
const HERO_TEXTURE_LIMIT = 1024;
const WINDOW_TEXTURE_LIMIT = 1024;
const WEBP_QUALITY = 88;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLTF_TRANSFORM_CLI = join(
  PROJECT_ROOT,
  'node_modules',
  '@gltf-transform',
  'cli',
  'bin',
  'cli.js',
);

function align4(value) {
  return (value + 3) & ~3;
}

function addExtension(list, extension) {
  const next = Array.isArray(list) ? list : [];
  if (!next.includes(extension)) next.push(extension);
  return next;
}

function parseGlb(buffer, source = 'GLB') {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error(`${source}: 不是有效的 GLB 文件`);
  }
  if (buffer.readUInt32LE(4) !== GLB_VERSION) {
    throw new Error(`${source}: 仅支持 glTF 2.0 GLB`);
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error(`${source}: GLB header 长度与文件长度不一致`);
  }

  let json = null;
  let binary = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const byteLength = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + byteLength;
    if (end > buffer.length) throw new Error(`${source}: GLB chunk 越界`);
    if (type === JSON_CHUNK) {
      const text = buffer
        .subarray(start, end)
        .toString('utf8')
        .replace(/\0+$/u, '')
        .trimEnd();
      json = JSON.parse(text);
    } else if (type === BIN_CHUNK) {
      binary = buffer.subarray(start, end);
    }
    offset = end;
  }

  if (!json || !binary) throw new Error(`${source}: 缺少 JSON 或 BIN chunk`);
  if (!Array.isArray(json.buffers) || json.buffers.length === 0) {
    throw new Error(`${source}: GLB 缺少 buffer 定义`);
  }
  return { json, binary };
}

function encodeGlb(json, binary) {
  const jsonRaw = Buffer.from(JSON.stringify(json));
  const jsonLength = align4(jsonRaw.length);
  const binaryLength = align4(binary.length);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const output = Buffer.alloc(totalLength);

  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(GLB_VERSION, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  jsonRaw.copy(output, 20);
  output.fill(0x20, 20 + jsonRaw.length, 20 + jsonLength);

  const binaryHeader = 20 + jsonLength;
  output.writeUInt32LE(binaryLength, binaryHeader);
  output.writeUInt32LE(BIN_CHUNK, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

function imageLabel(image, index) {
  return image.name || image.uri || `image_${index}`;
}

function textureLimit(image, index) {
  const label = imageLabel(image, index);
  if (/window[_-]?view/iu.test(label)) return WINDOW_TEXTURE_LIMIT;
  // 占据主画面的表面保留 1K；其余小道具继续 512，预算投给用户真正看得见的地方。
  const packedOrScalar = /(?:^|[_-])orm(?:[_-]|$)|roughness|metallic/iu.test(label);
  if (/wood[_-]?table|linen/iu.test(label) && !packedOrScalar) {
    return HERO_TEXTURE_LIMIT;
  }
  return DEFAULT_TEXTURE_LIMIT;
}

function imageBytes(json, binary, image, source) {
  if (!Number.isInteger(image.bufferView)) {
    throw new Error(`${source}: 图片 ${image.name ?? '(unnamed)'} 不是 GLB 内嵌图片`);
  }
  const view = json.bufferViews?.[image.bufferView];
  if (!view || (view.buffer ?? 0) !== 0) {
    throw new Error(`${source}: 图片引用了无效的 bufferView`);
  }
  const start = view.byteOffset ?? 0;
  const end = start + view.byteLength;
  if (start < 0 || end > binary.length) {
    throw new Error(`${source}: 图片 bufferView 越界`);
  }
  return binary.subarray(start, end);
}

/**
 * 原地压缩 GLB 的内嵌 PNG/JPEG/WebP，并写入标准 EXT_texture_webp 引用。
 * 必须在 meshopt 之前运行；函数会重排 bufferView 并拒绝压缩后的输入，避免
 * 破坏 EXT_meshopt_compression 内部的独立 byteOffset。
 */
export async function transcodeEmbeddedTextures(
  path,
  { quality = WEBP_QUALITY } = {},
) {
  const input = readFileSync(path);
  const { json, binary } = parseGlb(input, path);
  const images = json.images ?? [];
  if (images.length === 0) {
    return { count: 0, beforeBytes: 0, afterBytes: 0 };
  }

  if (
    json.extensionsUsed?.includes('EXT_meshopt_compression') ||
    json.bufferViews?.some((view) => view.extensions?.EXT_meshopt_compression)
  ) {
    throw new Error(`${path}: 贴图转换必须在 meshopt 之前运行`);
  }
  if (json.buffers.length !== 1) {
    throw new Error(`${path}: 贴图转换阶段要求单 buffer GLB`);
  }

  // 同一 image bufferView 理论上可以被多个 image 复用；按较大的目标上限处理一次。
  const specs = new Map();
  images.forEach((image, index) => {
    if (!Number.isInteger(image.bufferView)) {
      throw new Error(`${path}: ${imageLabel(image, index)} 不是内嵌图片`);
    }
    const current = specs.get(image.bufferView);
    const limit = textureLimit(image, index);
    if (!current || limit > current.limit) {
      specs.set(image.bufferView, { image, index, limit });
    }
  });

  const replacements = new Map();
  let beforeBytes = 0;
  let afterBytes = 0;
  for (const [viewIndex, spec] of specs) {
    const bytes = imageBytes(json, binary, spec.image, path);
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`${path}: 无法读取 ${imageLabel(spec.image, spec.index)} 的尺寸`);
    }

    let output = bytes;
    const alreadyReady =
      metadata.format === 'webp' &&
      metadata.width <= spec.limit &&
      metadata.height <= spec.limit;
    if (!alreadyReady) {
      output = await sharp(bytes, { failOn: 'error' })
        .resize({
          width: spec.limit,
          height: spec.limit,
          fit: 'inside',
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3,
        })
        .webp({
          quality,
          alphaQuality: 90,
          effort: 4,
          smartSubsample: true,
        })
        .toBuffer();
    }
    replacements.set(viewIndex, output);
    beforeBytes += bytes.length;
    afterBytes += output.length;
  }

  // 将 texture.source 迁到 EXT_texture_webp.source。没有 PNG/JPEG fallback，
  // 因而扩展同时列入 extensionsRequired，与 gltf-transform webp 的产物一致。
  const convertedImages = new Set(images.map((_, index) => index));
  for (const texture of json.textures ?? []) {
    const webpSource = texture.extensions?.[WEBP_EXTENSION]?.source;
    const source = Number.isInteger(texture.source) ? texture.source : webpSource;
    if (!convertedImages.has(source)) continue;
    texture.extensions ??= {};
    texture.extensions[WEBP_EXTENSION] = { source };
    delete texture.source;
  }
  json.extensionsUsed = addExtension(json.extensionsUsed, WEBP_EXTENSION);
  json.extensionsRequired = addExtension(json.extensionsRequired, WEBP_EXTENSION);
  for (const image of images) {
    image.mimeType = 'image/webp';
    delete image.uri;
  }

  // 用压缩后的图片替换对应 bufferView，并按 4 字节重新打包整个 BIN。
  // accessors 仍按 bufferView index 引用，内部 byteOffset 不变。
  const parts = [];
  let cursor = 0;
  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    if ((view.buffer ?? 0) !== 0) {
      throw new Error(`${path}: 仅支持 buffer 0 的 bufferView`);
    }
    const start = view.byteOffset ?? 0;
    const end = start + view.byteLength;
    if (start < 0 || end > binary.length) {
      throw new Error(`${path}: bufferView ${index} 越界`);
    }
    const data = replacements.get(index) ?? binary.subarray(start, end);
    const aligned = align4(cursor);
    if (aligned > cursor) parts.push(Buffer.alloc(aligned - cursor));
    cursor = aligned;
    parts.push(data);
    view.byteOffset = cursor;
    view.byteLength = data.length;
    if (replacements.has(index)) {
      delete view.byteStride;
      delete view.target;
    }
    cursor += data.length;
  }
  const rebuiltBinary = Buffer.concat(parts, cursor);
  json.buffers[0].byteLength = rebuiltBinary.length;
  writeFileSync(path, encodeGlb(json, rebuiltBinary));

  return { count: images.length, beforeBytes, afterBytes };
}

/** 严格验证所有内嵌贴图的格式、尺寸和 EXT_texture_webp 引用。 */
export async function verifyEmbeddedTextures(path) {
  const { json, binary } = parseGlb(readFileSync(path), path);
  const images = json.images ?? [];
  const failures = [];
  let totalBytes = 0;
  let gpuBytes = 0;

  for (const [index, image] of images.entries()) {
    const label = imageLabel(image, index);
    if (image.mimeType !== 'image/webp') {
      failures.push(`${label}: mimeType=${image.mimeType ?? '(missing)'}`);
      continue;
    }
    try {
      const bytes = imageBytes(json, binary, image, path);
      const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
      const limit = textureLimit(image, index);
      totalBytes += bytes.length;
      if (metadata.format !== 'webp') failures.push(`${label}: 内容不是 WebP`);
      if (!metadata.width || !metadata.height) {
        failures.push(`${label}: 无法读取尺寸`);
      } else if (metadata.width > limit || metadata.height > limit) {
        failures.push(`${label}: ${metadata.width}x${metadata.height} 超过 ${limit}px`);
      }
      if (metadata.width && metadata.height) {
        // WebP 只省网络；浏览器上传 GPU 后约为 RGBA8 + mipmaps（4/3）。
        gpuBytes += metadata.width * metadata.height * 4 * (4 / 3);
      }
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const [index, texture] of (json.textures ?? []).entries()) {
    const source = texture.extensions?.[WEBP_EXTENSION]?.source;
    if (!Number.isInteger(source) || texture.source !== undefined) {
      failures.push(`texture_${index}: EXT_texture_webp 引用不完整`);
    }
  }
  if (images.length > 0) {
    if (!json.extensionsUsed?.includes(WEBP_EXTENSION)) {
      failures.push(`extensionsUsed 缺少 ${WEBP_EXTENSION}`);
    }
    if (!json.extensionsRequired?.includes(WEBP_EXTENSION)) {
      failures.push(`extensionsRequired 缺少 ${WEBP_EXTENSION}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${path}: 贴图验收失败\n- ${failures.join('\n- ')}`);
  }
  return { count: images.length, totalBytes, gpuBytes };
}

/** 验收可见质量与实时预算，防止以后再次把多边形花在背景小物上。 */
export function verifyModelQuality(path, file = '') {
  const { json } = parseGlb(readFileSync(path), path);
  const meshInstances = new Map();
  for (const node of json.nodes ?? []) {
    if (!Number.isInteger(node.mesh)) continue;
    meshInstances.set(node.mesh, (meshInstances.get(node.mesh) ?? 0) + 1);
  }

  let triangles = 0;
  let drawCalls = 0;
  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    const instances = meshInstances.get(meshIndex) ?? 0;
    for (const primitive of mesh.primitives ?? []) {
      const accessorIndex = Number.isInteger(primitive.indices)
        ? primitive.indices
        : primitive.attributes?.POSITION;
      const count = json.accessors?.[accessorIndex]?.count ?? 0;
      triangles += (count / 3) * instances;
      drawCalls += instances;
    }
  }

  const failures = [];
  if (file === 'desk.glb') {
    if (triangles > 65_000) failures.push(`${triangles} tris 超过 65k 场景预算`);
    if (drawCalls > 160) failures.push(`${drawCalls} draw calls 超过 160 预算`);
    const requiredPbr = ['wood_desk', 'wood_floor', 'wallpaper', 'linen', 'rug', 'wainscot'];
    for (const name of requiredPbr) {
      const material = (json.materials ?? []).find((entry) => entry.name === name);
      if (!material) {
        failures.push(`缺少关键材质 ${name}`);
        continue;
      }
      const pbr = material.pbrMetallicRoughness ?? {};
      if (!Number.isInteger(material.normalTexture?.index)) {
        failures.push(`${name} 缺少 normalTexture`);
      }
      if (!Number.isInteger(pbr.metallicRoughnessTexture?.index)) {
        failures.push(`${name} 缺少 metallicRoughnessTexture`);
      }
      if (!Number.isInteger(material.occlusionTexture?.index)) {
        failures.push(`${name} 缺少 occlusionTexture`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`${path}: 模型质量验收失败\n- ${failures.join('\n- ')}`);
  }
  return { triangles, drawCalls, materials: json.materials?.length ?? 0 };
}

function runGltfTransform(args) {
  execFileSync(process.execPath, [GLTF_TRANSFORM_CLI, ...args], {
    stdio: 'inherit',
  });
}

export async function optimizeModels(directory, { backup = true } = {}) {
  const dir = resolve(directory);
  const backupDir = join(PROJECT_ROOT, 'assets-src', 'models-raw');
  const files = ['clock.glb', 'desk.glb'];
  const budgets = new Map([
    ['clock.glb', 300 * 1024],
    ['desk.glb', 4 * 1024 * 1024],
  ]);

  if (backup) mkdirSync(backupDir, { recursive: true });

  for (const file of files) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      console.warn(`跳过（不存在）: ${path}`);
      continue;
    }
    if (backup) copyFileSync(path, join(backupDir, file));
    const before = statSync(path).size;

    // 1) 清理：保留顶点属性，屏幕贴图运行时才注入，UV 不能剪。
    runGltfTransform(['dedup', path, path]);
    runGltfTransform(['prune', path, path, '--keep-attributes', 'true']);

    // 2) 贴图：普通贴图 512px，窗外实景 1024px，全部转 WebP。
    // 任一步失败都中止管线，禁止把未压缩资产静默发布。
    const textures = await transcodeEmbeddedTextures(path);
    const verified = await verifyEmbeddedTextures(path);
    if (textures.count > 0) {
      console.log(
        `${file} textures: ${verified.count}, ` +
          `${(textures.beforeBytes / 1024).toFixed(0)}KB -> ` +
          `${(textures.afterBytes / 1024).toFixed(0)}KB`,
      );
    }
    if (file === 'desk.glb' && verified.gpuBytes > 84 * 1024 * 1024) {
      throw new Error(
        `${file}: 估算纹理显存 ${(verified.gpuBytes / 1024 / 1024).toFixed(1)}MB 超过 84MB`,
      );
    }

    // 3) 量化：法线/UV 提高到 12/14 位，避免纸面反射斜纹伪影。
    runGltfTransform([
      'quantize',
      path,
      path,
      '--quantize-position',
      '14',
      '--quantize-normal',
      '12',
      '--quantize-texcoord',
      '14',
      '--quantize-color',
      '8',
    ]);

    // 4) meshopt：不做 join/flatten/palette/simplify，保护命名契约与 UV。
    runGltfTransform(['meshopt', path, path, '--level', 'medium']);

    // meshopt 写回后再验一次图片引用，防止后续步骤破坏扩展。
    await verifyEmbeddedTextures(path);
    const quality = verifyModelQuality(path, file);
    const after = statSync(path).size;
    const budget = budgets.get(file);
    if (budget && after > budget) {
      throw new Error(
        `${file}: ${(after / 1024).toFixed(0)}KB 超出预算 ${(budget / 1024).toFixed(0)}KB`,
      );
    }
    console.log(
      `${file}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB, ` +
        `${Math.round(quality.triangles).toLocaleString()} tris, ${quality.drawCalls} draws`,
    );
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? join(PROJECT_ROOT, 'public', 'models'));
  await optimizeModels(dir);
  console.log('模型贴图、格式与体积预算验收通过。');
}
