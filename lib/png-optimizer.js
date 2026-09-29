'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const glob = require('glob');
const { loadProjectConfig, resolveProjectPath } = require('./project-config');

const PNG_LEVEL_OPTIONS = Object.freeze({
  fast: Object.freeze({ filter: [0, 2] }),
  balanced: Object.freeze({ filter: [0, 1, 2, 4] }),
  max: Object.freeze({ filter: [0, 1, 2, 3, 4] })
});

const PNG_MODES = Object.freeze(['quantize', 'lossless']);

function validatePngConfig(config) {
  const root = config.root === undefined ? 'dist' : config.root;
  const mode = config.mode === undefined ? 'quantize' : config.mode;
  const colors = config.colors === undefined ? 256 : config.colors;
  const level = config.level === undefined ? 'balanced' : config.level;
  const exclude = config.exclude === undefined ? [] : config.exclude;

  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('mikit.png.root 必须是非空路径。');
  }
  if (!PNG_MODES.includes(mode)) {
    throw new Error('mikit.png.mode 只能是 quantize 或 lossless。');
  }
  if (!Number.isInteger(colors) || colors < 2 || colors > 256) {
    throw new Error('mikit.png.colors 必须是 2 到 256 之间的整数。');
  }
  if (!Object.prototype.hasOwnProperty.call(PNG_LEVEL_OPTIONS, level)) {
    throw new Error('mikit.png.level 只能是 fast、balanced 或 max。');
  }
  if (!Array.isArray(exclude)) {
    throw new Error('mikit.png.exclude 必须是路径数组。');
  }
  exclude.forEach(pattern => {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('mikit.png.exclude[] 必须是非空字符串。');
    }
  });

  return {
    root: root.trim(),
    mode,
    colors,
    level,
    exclude: exclude.map(pattern => pattern.replace(/\\/g, '/'))
  };
}

function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function resolveRelativeFile(rootDir, relativePath) {
  return path.join(rootDir, ...normalizeRelativePath(relativePath).split('/'));
}

function getLosslessOptions(level) {
  return {
    fixErrors: false,
    force: false,
    bitDepthReduction: true,
    colorTypeReduction: true,
    paletteReduction: true,
    grayscaleReduction: true,
    idatRecoding: true,
    strip: false,
    ...PNG_LEVEL_OPTIONS[level]
  };
}

function resolvePngquantBinary() {
  const packageEntry = require.resolve('pngquant-bin');
  return path.join(
    path.dirname(packageEntry),
    'vendor',
    process.platform === 'win32' ? 'pngquant.exe' : 'pngquant'
  );
}

function quantizePngWithPngquant(input, options) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-pngquant-'));
  const outputPath = path.join(tempDir, 'output.png');

  try {
    const result = spawnSync(
      resolvePngquantBinary(),
      [String(options.colors), options.filePath, '-o', outputPath],
      { encoding: 'utf8', windowsHide: true }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim();
      throw new Error(detail || ('pngquant 退出状态：' + result.status));
    }
    if (!fs.existsSync(outputPath)) {
      throw new Error('pngquant 未生成输出文件。');
    }

    return fs.readFileSync(outputPath);
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
  }
}

function optimizePngImages(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const loaded = loadProjectConfig(projectDir, 'png');
  const config = validatePngConfig(loaded.config);
  const rootDir = options.rootOverride === undefined
    ? resolveProjectPath(projectDir, config.root, 'mikit.png.root')
    : path.resolve(options.rootOverride);

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error('PNG 压缩目录不存在：' + rootDir);
  }

  const globOptions = {
    cwd: rootDir,
    nodir: true,
    nocase: true,
    dot: true,
    windowsPathsNoEscape: true
  };
  const allFiles = glob.sync('**/*.png', globOptions).map(normalizeRelativePath);
  const includedFiles = glob.sync('**/*.png', {
    ...globOptions,
    ignore: config.exclude
  }).map(normalizeRelativePath);
  const quantizePng = options.quantizePng || quantizePngWithPngquant;
  const compressPng = options.compressPng || require('@napi-rs/image').losslessCompressPngSync;
  const compressionOptions = getLosslessOptions(config.level);
  let optimized = 0;
  let unchanged = 0;
  let bytesSaved = 0;
  const failed = [];

  includedFiles.forEach(relativePath => {
    const filePath = resolveRelativeFile(rootDir, relativePath);

    try {
      const input = fs.readFileSync(filePath);
      const output = config.mode === 'quantize'
        ? quantizePng(input, {
          colors: config.colors,
          filePath,
          relativePath
        })
        : compressPng(input, compressionOptions);

      if (!Buffer.isBuffer(output)) {
        throw new Error('压缩器未返回 Buffer。');
      }

      if (output.length < input.length) {
        fs.writeFileSync(filePath, output);
        optimized += 1;
        bytesSaved += input.length - output.length;
      } else {
        unchanged += 1;
      }
    } catch (error) {
      failed.push({ relativePath, filePath, message: error.message });
    }
  });

  return {
    rootDir,
    mode: config.mode,
    colors: config.colors,
    level: config.level,
    scanned: allFiles.length,
    optimized,
    excluded: allFiles.length - includedFiles.length,
    unchanged,
    bytesSaved,
    failed
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatPngSummary(summary) {
  const modeLabel = summary.mode === 'lossless'
    ? '严格无损 ' + summary.level
    : '量化 ' + summary.colors + ' 色';
  return `扫描 ${summary.scanned} 个，压缩 ${summary.optimized} 个，` +
    `排除 ${summary.excluded} 个，未缩小 ${summary.unchanged} 个，` +
    `失败跳过 ${summary.failed.length} 个，` +
    `节省 ${formatBytes(summary.bytesSaved)}（模式：${modeLabel}）。`;
}

function reportPngFailures(summary, command) {
  summary.failed.forEach(failure => {
    console.warn(`[mikit ${command}] PNG 跳过：${failure.filePath}：${failure.message}`);
  });
}

module.exports = {
  PNG_LEVEL_OPTIONS,
  PNG_MODES,
  validatePngConfig,
  optimizePngImages,
  formatBytes,
  formatPngSummary,
  reportPngFailures
};
