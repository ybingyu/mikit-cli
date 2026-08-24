'use strict';

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { loadProjectConfig, resolveProjectPath } = require('./project-config');

const PNG_LEVEL_OPTIONS = Object.freeze({
  fast: Object.freeze({ filter: [0, 2] }),
  balanced: Object.freeze({ filter: [0, 1, 2, 4] }),
  max: Object.freeze({ filter: [0, 1, 2, 3, 4] })
});

function validatePngConfig(config) {
  const root = config.root === undefined ? 'dist' : config.root;
  const level = config.level === undefined ? 'balanced' : config.level;
  const exclude = config.exclude === undefined ? [] : config.exclude;

  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('mikit.png.root 必须是非空路径。');
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
  const compressPng = options.compressPng || require('@napi-rs/image').losslessCompressPngSync;
  const compressionOptions = getLosslessOptions(config.level);
  let optimized = 0;
  let unchanged = 0;
  let bytesSaved = 0;

  includedFiles.forEach(relativePath => {
    const filePath = resolveRelativeFile(rootDir, relativePath);
    const input = fs.readFileSync(filePath);
    let output;

    try {
      output = compressPng(input, compressionOptions);
    } catch (error) {
      throw new Error(`PNG 压缩失败（${relativePath}）：${error.message}`);
    }

    if (!Buffer.isBuffer(output)) {
      throw new Error(`PNG 压缩失败（${relativePath}）：压缩器未返回 Buffer。`);
    }

    if (output.length < input.length) {
      fs.writeFileSync(filePath, output);
      optimized += 1;
      bytesSaved += input.length - output.length;
    } else {
      unchanged += 1;
    }
  });

  return {
    rootDir,
    level: config.level,
    scanned: allFiles.length,
    optimized,
    excluded: allFiles.length - includedFiles.length,
    unchanged,
    bytesSaved
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatPngSummary(summary) {
  return `扫描 ${summary.scanned} 个，压缩 ${summary.optimized} 个，` +
    `排除 ${summary.excluded} 个，未缩小 ${summary.unchanged} 个，` +
    `节省 ${formatBytes(summary.bytesSaved)}。`;
}

module.exports = {
  PNG_LEVEL_OPTIONS,
  validatePngConfig,
  optimizePngImages,
  formatBytes,
  formatPngSummary
};
