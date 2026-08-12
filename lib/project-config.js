'use strict';

const fs = require('fs');
const path = require('path');

function loadProjectConfig(projectDir, sectionName) {
  const resolvedProjectDir = path.resolve(projectDir || process.cwd());
  const packagePath = path.join(resolvedProjectDir, 'package.json');

  if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isFile()) {
    throw new Error(`项目 package.json 不存在：${packagePath}`);
  }

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取项目 package.json：${error.message}`);
  }

  const mikitConfig = packageJson.mikit;
  if (!mikitConfig || typeof mikitConfig !== 'object' || Array.isArray(mikitConfig)) {
    throw new Error('package.json 缺少 mikit 配置。');
  }

  const section = mikitConfig[sectionName];
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error(`package.json 缺少 mikit.${sectionName} 配置。`);
  }

  return {
    projectDir: resolvedProjectDir,
    packagePath,
    packageJson,
    config: section
  };
}

function resolveProjectPath(projectDir, configuredPath, fieldName) {
  if (typeof configuredPath !== 'string' || !configuredPath.trim()) {
    throw new Error(`${fieldName} 必须是非空路径。`);
  }
  return path.resolve(projectDir, configuredPath);
}

module.exports = {
  loadProjectConfig,
  resolveProjectPath
};
