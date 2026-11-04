'use strict';

const { Ignore } = require('glob');
const { isPathWithin } = require('./path-safety');

// 目录按字面路径匹配，避免方括号等目录名被当作 glob。
function createDirectoryExclusion(directories = []) {
  const isExcluded = file => directories.some(directory => isPathWithin(directory, file));
  const hasExcludedDescendant = file => directories.some(directory => isPathWithin(file, directory));
  function globIgnore(patterns = [], mapPath = file => file, options = {}) {
    const ignoredPatterns = new Ignore(patterns, { nocase: process.platform === 'win32', ...options });
    return {
      ignored: entry => isExcluded(mapPath(entry.fullpath())) || ignoredPatterns.ignored(entry),
      childrenIgnored: entry => isExcluded(mapPath(entry.fullpath())) || ignoredPatterns.childrenIgnored(entry)
    };
  }
  return { isExcluded, hasExcludedDescendant, globIgnore };
}

module.exports = { createDirectoryExclusion };
