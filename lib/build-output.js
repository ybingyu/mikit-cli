'use strict';

const fs = require('fs-extra');
const path = require('node:path');
const { isPathWithin } = require('./path-safety');

function readCleanKeep(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(packagePath)) return [];

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error('无法读取项目 package.json：' + error.message);
  }

  const config = packageJson && packageJson.mikit && packageJson.mikit.build;
  if (config === undefined) return [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('mikit.build 必须是配置对象。');
  }
  if (config.cleanKeep === undefined) return [];
  if (!Array.isArray(config.cleanKeep)) {
    throw new Error('mikit.build.cleanKeep 必须是目录路径数组。');
  }
  return config.cleanKeep;
}

function validateDirectory(directory, field) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new Error(field + ' 无法检查目录 ' + directory + '：' + error.message);
  }
  if (stat.isSymbolicLink()) {
    throw new Error(field + ' 不能包含符号链接或目录联接：' + directory);
  }
  if (!stat.isDirectory()) throw new Error(field + ' 必须指向目录：' + directory);
  return true;
}

// 预检保留树中的链接，保持清理边界明确。
function validateKeptTree(directory, field) {
  if (!validateDirectory(directory, field)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(field + ' 不能包含符号链接或目录联接：' + child);
    }
    if (entry.isDirectory()) validateKeptTree(child, field);
  }
}

function resolveKeptDirectories(outputDir, entries) {
  const directories = [];
  entries.forEach((entry, index) => {
    const field = 'mikit.build.cleanKeep[' + index + ']';
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(field + ' 必须是非空目录路径。');
    }
    const parts = entry.split(/[\\/]+/).filter(part => part && part !== '.');
    if (path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry) || !parts.length ||
        parts.some(part => part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) ||
          (process.platform === 'win32' && /[. ]$/.test(part)))) {
      throw new Error(field + ' 必须是输出目录内的相对目录路径，不支持越界路径或通配符：' + entry);
    }
    const directory = path.resolve(outputDir, ...parts);
    if (!isPathWithin(outputDir, directory) || directory === outputDir) {
      throw new Error(field + ' 必须位于输出目录内：' + entry);
    }

    let current = outputDir;
    for (const part of parts) {
      current = path.join(current, part);
      if (!validateDirectory(current, field)) break;
    }
    validateKeptTree(directory, field);
    if (!directories.some(kept => isPathWithin(kept, directory))) {
      for (let i = directories.length - 1; i >= 0; i--) {
        if (isPathWithin(directory, directories[i])) directories.splice(i, 1);
      }
      directories.push(directory);
    }
  });
  return directories;
}

function cleanBuildOutput(projectDir, outputDir) {
  const keptDirectories = resolveKeptDirectories(outputDir, readCleanKeep(projectDir));
  if (!keptDirectories.length) {
    fs.emptyDirSync(outputDir);
    return keptDirectories;
  }

  // 先完成遍历和删除路径检查，再执行删除；保留嵌套目录所需的父目录。
  const removals = [];
  function collectRemovals(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.resolve(directory, entry.name);
      if (target === outputDir || !isPathWithin(outputDir, target)) {
        throw new Error('清理路径必须位于输出目录内：' + target);
      }
      if (keptDirectories.some(kept => isPathWithin(kept, target))) continue;
      if (keptDirectories.some(kept => isPathWithin(target, kept))) {
        collectRemovals(target);
      } else {
        removals.push(target);
      }
    }
  }
  if (fs.existsSync(outputDir)) collectRemovals(outputDir);
  removals.forEach(target => fs.removeSync(target));
  fs.ensureDirSync(outputDir);
  return keptDirectories;
}

module.exports = { cleanBuildOutput };
