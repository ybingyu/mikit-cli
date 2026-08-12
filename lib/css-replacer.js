'use strict';

const fs = require('fs');
const path = require('path');
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

function replaceCssAssets(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const env = String(options.env || process.env.NODE_ENV || 'default').trim() || 'default';
  const { config } = loadProjectConfig(projectDir, 'replace');
  const rootDir = resolveProjectPath(projectDir, config.root || 'dist', 'mikit.replace.root');
  const includes = config.include === undefined ? ['**/*.css'] : config.include;
  const rules = config.rules;

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`CSS 替换目录不存在：${rootDir}`);
  }
  if (!Array.isArray(includes) || includes.length === 0 || includes.some(item => typeof item !== 'string')) {
    throw new Error('mikit.replace.include 必须是非空字符串数组。');
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error('mikit.replace.rules 必须是非空数组。');
  }

  const files = [...new Set(includes.flatMap(pattern => globSync(pattern, {
    cwd: rootDir,
    absolute: true,
    nodir: true,
    windowsPathsNoEscape: true
  })))]
    .filter(filePath => path.extname(filePath).toLowerCase() === '.css')
    .sort((a, b) => a.localeCompare(b));

  let changed = 0;
  for (const filePath of files) {
    const original = fs.readFileSync(filePath, 'utf8');
    let content = original;

    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new Error('mikit.replace.rules 中的每一项必须是对象。');
      }
      if (typeof rule.from !== 'string' || rule.from.length === 0) {
        throw new Error('replace.rules[].from 必须是非空字符串。');
      }
      if (!appliesToEnvironment(rule, env)) continue;
      content = replaceAllLiteral(content, rule.from, selectReplacementTarget(rule.to, env));
    }

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      changed += 1;
    }
  }

  return { files: files.length, changed, env, root: rootDir };
}

module.exports = {
  replaceCssAssets,
  replaceAllLiteral,
  selectReplacementTarget
};
