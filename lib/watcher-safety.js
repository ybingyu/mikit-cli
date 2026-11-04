const path = require('node:path');
const { isPathWithin } = require('./path-safety');

const AUTO_WATCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.svn',
  'dist',
  'node_modules',
  'packed'
]);

function createAutoWatchIgnored(watchRoot, patterns) {
  const resolvedRoot = path.resolve(watchRoot);

  return (watchedPath, stats) => {
    const resolvedPath = path.resolve(watchedPath);
    const relativePath = path.relative(resolvedRoot, resolvedPath);

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return false;
    }

    const parts = relativePath.split(path.sep);
    if (parts.some(part => AUTO_WATCH_IGNORED_DIRECTORIES.has(part.toLowerCase()))) return true;
    if (!patterns) return false;
    if (stats && !stats.isDirectory()) return true;
    return !patterns.some(pattern => parts.length <= pattern.length && parts.every((part, index) => {
      const expected = pattern[index];
      return expected === '*' || (process.platform === 'win32'
        ? expected.toLowerCase() === part.toLowerCase()
        : expected === part);
    }));
  };
}

function createSourceWatchIgnored(root, virtual = {}) {
  const source = path.resolve(root);
  const virtualRoots = Object.values(virtual).map(value => path.resolve(value));
  return watchedPath => {
    const target = path.resolve(watchedPath);
    if (!isPathWithin(source, target)) return false;
    const parts = path.relative(source, target).split(path.sep);
    return parts.some(part => ['node_modules', 'dist'].includes(part.toLowerCase())) ||
      virtualRoots.some(virtualRoot => isPathWithin(virtualRoot, target));
  };
}

function formatWatcherError(error) {
  const code = error && error.code ? String(error.code) : '';
  let detail = error && error.message ? error.message : String(error);
  const errorPath = error && error.path ? String(error.path) : '';

  if (code && !detail.startsWith(`${code}:`)) {
    detail = `${code}: ${detail}`;
  }
  if (errorPath && !detail.includes(errorPath)) {
    detail += ` (${errorPath})`;
  }

  return detail;
}

function attachWatcherErrorHandler(watcher, label) {
  watcher.on('error', error => {
    console.warn(`[mikit start] 文件监听警告（${label}）：${formatWatcherError(error)}`);
  });
  return watcher;
}

module.exports = {
  attachWatcherErrorHandler,
  createAutoWatchIgnored,
  createSourceWatchIgnored
};
