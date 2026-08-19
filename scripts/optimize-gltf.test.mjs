import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  transcodeEmbeddedTextures,
  verifyEmbeddedTextures,
} from './optimize-gltf.mjs';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function align4(value) {
  return (value + 3) & ~3;
}

function makeGlb(json, binary) {
  const jsonRaw = Buffer.from(JSON.stringify(json));
  const jsonLength = align4(jsonRaw.length);
  const binaryLength = align4(binary.length);
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binaryLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonRaw.copy(output, 20);
  output.fill(0x20, 20 + jsonRaw.length, 20 + jsonLength);
  const binaryHeader = 20 + jsonLength;
  output.writeUInt32LE(binaryLength, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

describe('GLB embedded texture optimizer', () => {
  it('converts regular and window textures to valid, bounded WebP images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'desk-gltf-textures-'));
    tempDirs.push(dir);
    const path = join(dir, 'fixture.glb');
    const regular = await sharp({
      create: { width: 1400, height: 700, channels: 3, background: '#8a6238' },
    })
      .png()
      .toBuffer();
    const windowView = await sharp({
      create: { width: 1600, height: 800, channels: 3, background: '#27334d' },
    })
      .jpeg()
      .toBuffer();
    const secondOffset = align4(regular.length);
    const binary = Buffer.alloc(secondOffset + windowView.length);
    regular.copy(binary, 0);
    windowView.copy(binary, secondOffset);

    const json = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: binary.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: regular.length },
        { buffer: 0, byteOffset: secondOffset, byteLength: windowView.length },
      ],
      images: [
        { name: 'wood_diff_1k', mimeType: 'image/png', bufferView: 0 },
        { name: 'window_view', mimeType: 'image/jpeg', bufferView: 1 },
      ],
      textures: [{ source: 0 }, { source: 1 }],
    };
    await writeFile(path, makeGlb(json, binary));

    const result = await transcodeEmbeddedTextures(path);
    const verified = await verifyEmbeddedTextures(path);
    expect(result.count).toBe(2);
    expect(verified.count).toBe(2);
    expect(result.afterBytes).toBeLessThan(result.beforeBytes);

    const glb = await readFile(path);
    const jsonLength = glb.readUInt32LE(12);
    const outputJson = JSON.parse(glb.subarray(20, 20 + jsonLength).toString().trim());
    expect(outputJson.extensionsRequired).toContain('EXT_texture_webp');
    expect(outputJson.textures).toEqual([
      { extensions: { EXT_texture_webp: { source: 0 } } },
      { extensions: { EXT_texture_webp: { source: 1 } } },
    ]);

    const binaryStart = 20 + jsonLength + 8;
    const regularView = outputJson.bufferViews[0];
    const windowViewBuffer = outputJson.bufferViews[1];
    const regularMeta = await sharp(
      glb.subarray(
        binaryStart + regularView.byteOffset,
        binaryStart + regularView.byteOffset + regularView.byteLength,
      ),
    ).metadata();
    const windowMeta = await sharp(
      glb.subarray(
        binaryStart + windowViewBuffer.byteOffset,
        binaryStart + windowViewBuffer.byteOffset + windowViewBuffer.byteLength,
      ),
    ).metadata();
    expect([regularMeta.width, regularMeta.height]).toEqual([512, 256]);
    expect([windowMeta.width, windowMeta.height]).toEqual([1024, 512]);
  });
});
