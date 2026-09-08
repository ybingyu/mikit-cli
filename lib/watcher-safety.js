const path = require('path');

const AUTO_WATCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.svn',
  'dist',
  'node_modules',
  'packed'
]);

function createAutoWatchIgnored(watchRoot) {
  const resolvedRoot = path.resolve(watchRoot);

  return watchedPath => {
    const resolvedPath = path.resolve(watchedPath);
    const relativePath = path.relative(resolvedRoot, resolvedPath);

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return false;
    }

    return relativePath
      .split(path.sep)
      .some(part => AUTO_WATCH_IGNORED_DIRECTORIES.has(part.toLowerCase()));
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
  createAutoWatchIgnored
};
