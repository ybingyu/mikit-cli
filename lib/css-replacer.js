'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const { globSync } = require('glob');
const { loadProjectConfig, resolveProjectPath } = require('./project-config');

function selectReplacementTarget(target, env) {
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('replace.rules[].to 必须是字符串或环境地址对象。');
  }

  const selected = target[env] !== undefined ? target[env] : target.default;
  if (typeof selected !== 'string') {
    throw new Error(`replace 规则缺少 ${env || 'default'} 环境对应的 to 地址。`);
  }
  return selected;
}

function appliesToEnvironment(rule, env) {
  if (rule.env === undefined) return true;
  if (Array.isArray(rule.env)) return rule.env.includes(env);
  return rule.env === env;
}

function replaceAllLiteral(content, from, to) {
  return content.split(from).join(to);
}

function fileKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function matchedFiles(rootDir, includes) {
  const files = new Map();
  for (const pattern of includes) {
    for (const filePath of globSync(pattern, {
      cwd: rootDir,
      absolute: true,
      nodir: true,
      windowsPathsNoEscape: true
    })) {
      const key = fileKey(filePath);
      if (!files.has(key)) files.set(key, filePath);
    }
  }
  return files;
}

function validateIncludes(includes, fieldName) {
  if (!Array.isArray(includes) || includes.length === 0 ||
      includes.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${fieldName} 必须是非空字符串数组。`);
  }
}

function replaceAssets(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const env = String(options.env || process.env.NODE_ENV || 'default').trim() || 'default';
  const { config } = loadProjectConfig(projectDir, 'replace');
  const rootDir = resolveProjectPath(projectDir, config.root || 'dist', 'mikit.replace.root');
  const includes = config.include === undefined ? ['**/*.css'] : config.include;
  const rules = config.rules;

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`替换目录不存在：${rootDir}`);
  }
  validateIncludes(includes, 'mikit.replace.include');
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('mikit.replace.rules 必须是非空数组。');
  }

  const files = [...matchedFiles(rootDir, includes).values()]
    .sort((a, b) => a.localeCompare(b));
  const realRootDir = fs.realpathSync(rootDir);
  for (const filePath of files) {
    const relativePath = path.relative(realRootDir, fs.realpathSync(filePath));
    if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
      throw new Error(`mikit.replace.include 命中的文件超出替换目录：${filePath}`);
    }
  }

  const activeRules = rules.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error('mikit.replace.rules 中的每一项必须是对象。');
    }
    if (rule.disabled === true) return null;
    if (typeof rule.from !== 'string' || rule.from.length === 0) {
      throw new Error('replace.rules[].from 必须是非空字符串。');
    }
    if (rule.include !== undefined) validateIncludes(rule.include, 'mikit.replace.rules[].include');
    if (!appliesToEnvironment(rule, env)) return null;
    return {
      from: rule.from,
      to: selectReplacementTarget(rule.to, env),
      files: rule.include === undefined ? null : matchedFiles(rootDir, rule.include)
    };
  }).filter(Boolean);

  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const updates = [];
  for (const filePath of files) {
    const bytes = fs.readFileSync(filePath);
    let original;
    try {
      original = decoder.decode(bytes);
      if (original.includes('\0')) throw new Error('包含 NUL 字符');
    } catch (error) {
      throw new Error(`替换文件不是有效的 UTF-8 文本：${filePath}（${error.message}）`);
    }
    let content = original;

    for (const rule of activeRules) {
      if (rule.files && !rule.files.has(fileKey(filePath))) continue;
      content = replaceAllLiteral(content, rule.from, rule.to);
    }

    if (content !== original) updates.push({ filePath, content });
  }

  for (const { filePath, content } of updates) {
    fs.writeFileSync(filePath, content, 'utf8');
  }

  return { files: files.length, changed: updates.length, env, root: rootDir };
}

module.exports = {
  replaceAssets,
  replaceCssAssets: replaceAssets,
  replaceAllLiteral,
  selectReplacementTarget
};
