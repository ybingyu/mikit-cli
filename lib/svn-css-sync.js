'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadProjectConfig, resolveProjectPath } = require('./project-config');
const { wildcardToRegExp } = require('./go-packer');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listConfiguredCssFiles(sourceDir, patterns) {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const cssFiles = entries
    .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.css')
    .map(entry => entry.name);

  const selected = new Set();
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('mikit.syncSvn.files 必须只包含非空字符串。');
    }
    const normalizedPattern = pattern === '*' ? '*.css' : pattern;
    const matcher = wildcardToRegExp(normalizedPattern);
    const matches = cssFiles.filter(fileName => matcher.test(fileName));
    const hasWildcard = /[*?]/.test(normalizedPattern);
    if (!hasWildcard && matches.length === 0) {
      throw new Error(`缺少同步源 CSS：${path.join(sourceDir, pattern)}`);
    }
    matches.forEach(fileName => selected.add(fileName));
  }

  return [...selected].sort((a, b) => a.localeCompare(b));
}

function syncCssToSvn(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const { config } = loadProjectConfig(projectDir, 'syncSvn');
  const sourceDir = resolveProjectPath(projectDir, config.source || 'dist/css', 'mikit.syncSvn.source');
  const targetDir = resolveProjectPath(projectDir, config.target, 'mikit.syncSvn.target');
  const patterns = config.files === undefined ? ['*'] : config.files;

  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error('mikit.syncSvn.files 必须是非空字符串数组。');
  }
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`同步源 CSS 目录不存在：${sourceDir}`);
  }
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`SVN CSS 目录不存在：${targetDir}`);
  }

  const files = listConfiguredCssFiles(sourceDir, patterns);
  let copied = 0;
  let skipped = 0;

  for (const fileName of files) {
    const sourceFile = path.join(sourceDir, fileName);
    const targetFile = path.join(targetDir, fileName);
    const sourceHash = hashFile(sourceFile);
    const targetHash = fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()
      ? hashFile(targetFile)
      : null;

    if (sourceHash === targetHash) {
      skipped += 1;
      continue;
    }

    fs.copyFileSync(sourceFile, targetFile);
    if (hashFile(targetFile) !== sourceHash) {
      throw new Error(`复制后校验失败：${targetFile}`);
    }
    copied += 1;
  }

  return { copied, skipped, files, source: sourceDir, target: targetDir };
}

module.exports = {
  syncCssToSvn,
  listConfiguredCssFiles,
  hashFile
};
