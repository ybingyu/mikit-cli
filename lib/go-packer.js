'use strict';

const fs = require('fs');
const path = require('path');
const { loadProjectConfig, resolveProjectPath } = require('./project-config');

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
}

function matchesAnyPattern(fileName, patterns) {
  return patterns.some(pattern => wildcardToRegExp(pattern).test(fileName));
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function isInside(parentDir, childDir) {
  const relativePath = path.relative(parentDir, childDir);
  return relativePath !== '' && !relativePath.startsWith('..' + path.sep) && !path.isAbsolute(relativePath);
}

function pathsOverlap(firstDir, secondDir) {
  return firstDir === secondDir || isInside(firstDir, secondDir) || isInside(secondDir, firstDir);
}

function validateOutputDirectory(projectDir, sourceDir, distDir, outputDir) {
  if (outputDir === projectDir) {
    throw new Error('mikit.pack.output 不能是项目根目录。');
  }
  if (!isInside(projectDir, outputDir)) {
    throw new Error('mikit.pack.output 必须是项目目录内的独立目录。');
  }

  const relativeParts = path.relative(projectDir, outputDir).split(path.sep);
  const protectedDirectories = new Set(['.git', '.svn', 'node_modules']);
  if (relativeParts.some(part => protectedDirectories.has(part.toLowerCase()))) {
    throw new Error('mikit.pack.output 不能位于 .git、.svn 或 node_modules 中。');
  }
  if (pathsOverlap(outputDir, sourceDir)) {
    throw new Error('mikit.pack.output 不能与页面源目录重叠。');
  }
  if (pathsOverlap(outputDir, distDir)) {
    throw new Error('mikit.pack.output 不能与构建目录重叠。');
  }
}

function resetOutputDirectory(outputDir) {
  const existed = fs.existsSync(outputDir);
  if (existed) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });
  return existed;
}

function transformGoTemplateIncludes(content) {
  return content.replace(
    /<!--\s*#include\s+virtual="(?:include\/)?([^"]+)"\s*-->/gi,
    '<?#template "$1" .?>'
  );
}

function copyAssetTree(sourceDir, targetDir) {
  ensureDirectory(targetDir);
  let copied = 0;

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyAssetTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
      copied += 1;
    }
  }

  return copied;
}

function packGoTemplates(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const { config } = loadProjectConfig(projectDir, 'pack');
  const sourceDir = resolveProjectPath(projectDir, config.source || 'wwwroot', 'mikit.pack.source');
  const distDir = resolveProjectPath(projectDir, config.dist || 'dist', 'mikit.pack.dist');
  const outputDir = resolveProjectPath(projectDir, config.output || 'packed', 'mikit.pack.output');
  const pageDirs = config.pageDirs === undefined ? ['.'] : config.pageDirs;
  const assetDirs = config.assetDirs === undefined ? ['js', 'css'] : config.assetDirs;
  const excludePages = config.excludePages === undefined ? [] : config.excludePages;

  for (const [field, value] of [
    ['mikit.pack.pageDirs', pageDirs],
    ['mikit.pack.assetDirs', assetDirs],
    ['mikit.pack.excludePages', excludePages]
  ]) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      throw new Error(`${field} 必须是字符串数组。`);
    }
  }
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`页面源目录不存在：${sourceDir}`);
  }
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`构建目录不存在：${distDir}`);
  }

  validateOutputDirectory(projectDir, sourceDir, distDir, outputDir);

  const pageSourceDirs = pageDirs.map(relativeDir => {
    const pageSourceDir = path.resolve(sourceDir, relativeDir);
    if (!fs.existsSync(pageSourceDir) || !fs.statSync(pageSourceDir).isDirectory()) {
      throw new Error(`页面目录不存在：${pageSourceDir}`);
    }
    return { relativeDir, pageSourceDir };
  });
  const assetSourceDirs = assetDirs.map(relativeDir => {
    const assetSourceDir = path.resolve(distDir, relativeDir);
    if (!fs.existsSync(assetSourceDir) || !fs.statSync(assetSourceDir).isDirectory()) {
      throw new Error(`打包资源目录不存在：${assetSourceDir}`);
    }
    return { relativeDir, assetSourceDir };
  });

  const cleaned = resetOutputDirectory(outputDir);
  let pages = 0;
  let assets = 0;

  for (const { relativeDir, pageSourceDir } of pageSourceDirs) {
    const pageOutputDir = path.resolve(outputDir, relativeDir);
    ensureDirectory(pageOutputDir);

    for (const entry of fs.readdirSync(pageSourceDir, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.shtml') continue;
      if (matchesAnyPattern(entry.name, excludePages)) continue;

      const sourcePath = path.join(pageSourceDir, entry.name);
      const outputPath = path.join(pageOutputDir, entry.name);
      const content = fs.readFileSync(sourcePath, 'utf8');
      fs.writeFileSync(outputPath, transformGoTemplateIncludes(content), 'utf8');
      pages += 1;
    }
  }

  for (const { relativeDir, assetSourceDir } of assetSourceDirs) {
    assets += copyAssetTree(assetSourceDir, path.resolve(outputDir, relativeDir));
  }

  return { pages, assets, output: outputDir, cleaned };
}

module.exports = {
  packGoTemplates,
  transformGoTemplateIncludes,
  wildcardToRegExp,
  validateOutputDirectory,
  resetOutputDirectory
};
