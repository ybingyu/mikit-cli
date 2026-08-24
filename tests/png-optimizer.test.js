'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  optimizePngImages,
  formatBytes,
  PNG_LEVEL_OPTIONS
} = require('../lib/png-optimizer');

function mkdir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function write(filePath, content) {
  mkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function writePackage(projectDir, pngConfig) {
  write(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'png-fixture', version: '1.0.0', mikit: { png: pngConfig } }, null, 2)
  );
}

function cleanup(projectDir, files, dirs) {
  files.forEach(relativePath => {
    const filePath = path.join(projectDir, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  dirs.forEach(relativePath => {
    const dirPath = path.resolve(projectDir, relativePath);
    if (fs.existsSync(dirPath)) fs.rmdirSync(dirPath);
  });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function createUncompressedRgbaPng(width = 32, height = 32) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4;
      raw[pixelOffset] = (x * 7) & 0xff;
      raw[pixelOffset + 1] = (y * 11) & 0xff;
      raw[pixelOffset + 2] = ((x + y) * 5) & 0xff;
      raw[pixelOffset + 3] = 255;
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    createChunk('IHDR', ihdr),
    createChunk('tEXt', Buffer.from('Comment\0keep-me', 'latin1')),
    createChunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
    createChunk('IEND', Buffer.alloc(0))
  ]);
}

function parsePng(buffer) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function decodeRgba8Png(buffer) {
  const chunks = parsePng(buffer);
  const ihdr = chunks.find(chunk => chunk.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];
  assert.equal(ihdr[8], 8, 'fixture decoder expects 8-bit PNG');
  assert.ok(colorType === 2 || colorType === 6, 'fixture decoder expects RGB or RGBA PNG');
  assert.equal(ihdr[12], 0, 'fixture decoder expects a non-interlaced PNG');

  const inflated = zlib.inflateSync(Buffer.concat(
    chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)
  ));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const sourceStride = width * bytesPerPixel;
  const decoded = Buffer.alloc(sourceStride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * sourceStride;
    const previousRowOffset = (y - 1) * sourceStride;

    for (let x = 0; x < sourceStride; x += 1) {
      const rawValue = inflated[sourceOffset + x];
      const left = x >= bytesPerPixel ? decoded[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? decoded[previousRowOffset + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? decoded[previousRowOffset + x - bytesPerPixel]
        : 0;
      let predictor;

      switch (filter) {
        case 0: predictor = 0; break;
        case 1: predictor = left; break;
        case 2: predictor = up; break;
        case 3: predictor = Math.floor((left + up) / 2); break;
        case 4: predictor = paethPredictor(left, up, upperLeft); break;
        default: throw new Error('Unsupported PNG filter in test fixture: ' + filter);
      }

      decoded[rowOffset + x] = (rawValue + predictor) & 0xff;
    }
    sourceOffset += sourceStride;
  }

  if (colorType === 6) return decoded;

  const rgba = Buffer.alloc(width * height * 4);
  for (let source = 0, target = 0; source < decoded.length; source += 3, target += 4) {
    rgba[target] = decoded[source];
    rgba[target + 1] = decoded[source + 1];
    rgba[target + 2] = decoded[source + 2];
    rgba[target + 3] = 255;
  }
  return rgba;
}

function testDiscoveryAndExclusions() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-discovery-'));
  const files = [
    'package.json',
    'dist/img/a.png',
    'dist/IMG/B.PNG',
    'dist/img/original/c.png',
    'dist/img/skip-d.png',
    'dist/img/not-png.jpg'
  ];

  try {
    writePackage(projectDir, {
      root: 'dist',
      level: 'balanced',
      exclude: ['img/original/**', '**/skip-*.png']
    });
    write(path.join(projectDir, 'dist/img/a.png'), Buffer.from([1, 2, 3, 4]));
    write(path.join(projectDir, 'dist/IMG/B.PNG'), Buffer.from([5, 6, 7, 8]));
    write(path.join(projectDir, 'dist/img/original/c.png'), Buffer.from([9, 10, 11, 12]));
    write(path.join(projectDir, 'dist/img/skip-d.png'), Buffer.from([13, 14, 15, 16]));
    write(path.join(projectDir, 'dist/img/not-png.jpg'), Buffer.from([17, 18]));

    const summary = optimizePngImages({
      projectDir,
      compressPng(input) {
        return input.subarray(0, input.length - 1);
      }
    });

    assert.equal(summary.scanned, 4);
    assert.equal(summary.excluded, 2);
    assert.equal(summary.optimized, 2);
    assert.equal(summary.unchanged, 0);
    assert.equal(fs.readFileSync(path.join(projectDir, 'dist/img/a.png')).length, 3);
    assert.equal(fs.readFileSync(path.join(projectDir, 'dist/IMG/B.PNG')).length, 3);
    assert.equal(fs.readFileSync(path.join(projectDir, 'dist/img/original/c.png')).length, 4);
    assert.equal(fs.readFileSync(path.join(projectDir, 'dist/img/skip-d.png')).length, 4);
  } finally {
    cleanup(projectDir, files, [
      'dist/img/original',
      'dist/img',
      'dist/IMG',
      'dist',
      '.'
    ]);
  }
}

function testPresetMappingsAndUnchangedFiles() {
  assert.deepEqual(PNG_LEVEL_OPTIONS.fast, { filter: [0, 2] });
  assert.deepEqual(PNG_LEVEL_OPTIONS.balanced, {
    filter: [0, 1, 2, 4]
  });
  assert.deepEqual(PNG_LEVEL_OPTIONS.max, {
    filter: [0, 1, 2, 3, 4]
  });

  for (const level of ['fast', 'balanced', 'max']) {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `mikit-png-${level}-`));
    const original = Buffer.from([1, 2, 3, 4]);
    let receivedOptions;

    try {
      writePackage(projectDir, { root: 'dist', level, exclude: [] });
      write(path.join(projectDir, 'dist/a.png'), original);

      const summary = optimizePngImages({
        projectDir,
        compressPng(input, options) {
          receivedOptions = options;
          return Buffer.concat([input, Buffer.from([5])]);
        }
      });

      assert.deepEqual(receivedOptions.filter, PNG_LEVEL_OPTIONS[level].filter);
      assert.equal(Object.hasOwn(receivedOptions, 'useHeuristics'), false);
      assert.equal(receivedOptions.strip, false);
      assert.equal(receivedOptions.fixErrors, false);
      assert.equal(summary.optimized, 0);
      assert.equal(summary.unchanged, 1);
      assert.deepEqual(fs.readFileSync(path.join(projectDir, 'dist/a.png')), original);
    } finally {
      cleanup(projectDir, ['package.json', 'dist/a.png'], ['dist', '.']);
    }
  }

  assert.equal(formatBytes(438630), '428.35 KB');
}

function testInvalidConfiguration() {
  const cases = [
    [{ root: 'dist', level: 'ultra', exclude: [] }, /mikit\.png\.level/],
    [{ root: 'dist', level: 'balanced', exclude: '**/*.png' }, /mikit\.png\.exclude/],
    [{ root: 'dist', level: 'balanced', exclude: [123] }, /mikit\.png\.exclude\[\]/],
    [{ root: '', level: 'balanced', exclude: [] }, /mikit\.png\.root/]
  ];

  for (const [config, expectedError] of cases) {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-invalid-config-'));
    try {
      writePackage(projectDir, config);
      assert.throws(() => optimizePngImages({ projectDir }), expectedError);
    } finally {
      cleanup(projectDir, ['package.json'], ['.']);
    }
  }

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-missing-root-'));
  try {
    writePackage(projectDir, { root: 'dist', level: 'balanced', exclude: [] });
    assert.throws(() => optimizePngImages({ projectDir }), /PNG 压缩目录不存在/);
  } finally {
    cleanup(projectDir, ['package.json'], ['.']);
  }
}

function testRealLosslessCompressionAndErrors() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-real-'));
  const original = createUncompressedRgbaPng();
  const pngPath = path.join(projectDir, 'dist/img/real.png');

  try {
    writePackage(projectDir, { root: 'dist', level: 'max', exclude: [] });
    write(pngPath, original);

    const beforePixels = decodeRgba8Png(original);
    const summary = optimizePngImages({ projectDir });
    const optimized = fs.readFileSync(pngPath);
    const afterPixels = decodeRgba8Png(optimized);

    assert.deepEqual(afterPixels, beforePixels);
    assert.ok(optimized.length < original.length);
    assert.equal(summary.optimized, 1);
    assert.equal(parsePng(optimized).some(chunk => chunk.type === 'tEXt'), true);
  } finally {
    cleanup(projectDir, ['package.json', 'dist/img/real.png'], ['dist/img', 'dist', '.']);
  }

  const invalidProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-invalid-file-'));
  try {
    writePackage(invalidProjectDir, { root: 'dist', level: 'balanced', exclude: [] });
    write(path.join(invalidProjectDir, 'dist/img/broken.png'), Buffer.from('not a png'));
    assert.throws(
      () => optimizePngImages({ projectDir: invalidProjectDir }),
      /PNG 压缩失败（img\/broken\.png）：/
    );
  } finally {
    cleanup(
      invalidProjectDir,
      ['package.json', 'dist/img/broken.png'],
      ['dist/img', 'dist', '.']
    );
  }
}

testDiscoveryAndExclusions();
testPresetMappingsAndUnchangedFiles();
testInvalidConfiguration();
testRealLosslessCompressionAndErrors();
