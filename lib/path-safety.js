'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isPathWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function pathsOverlap(first, second) {
  return isPathWithin(first, second) || isPathWithin(second, first);
}

// Resolve existing ancestors as well as outputs which have not been created yet.
function resolveRealPath(target) {
  let current = path.resolve(target);
  const missing = [];
  while (!fs.existsSync(current)) {
    // A dangling link is not a safe output parent.
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('路径指向失效的符号链接：' + current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('无法解析路径：' + target);
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.resolve(fs.realpathSync(current), ...missing);
}

function isProtectedPath(project, target) {
  return path.relative(project, target).split(path.sep)
    .some(part => ['.git', '.svn', 'node_modules'].includes(part.toLowerCase()));
}

module.exports = { isPathWithin, pathsOverlap, resolveRealPath, isProtectedPath };
