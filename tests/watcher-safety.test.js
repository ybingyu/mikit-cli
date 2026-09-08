const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  attachWatcherErrorHandler,
  createAutoWatchIgnored
} = require('../lib/watcher-safety');

const watchRoot = path.resolve('F:\\NDW\\【魔域】\\2026');
const activityRoot = path.join(watchRoot, '0813 拉新召回');
const projectRoot = path.join(activityRoot, 'lxzh99');
const wwwroot = path.join(projectRoot, 'wwwroot');
const ignored = createAutoWatchIgnored(watchRoot);

assert.equal(ignored(watchRoot), false);
assert.equal(ignored(activityRoot), false);
assert.equal(ignored(projectRoot), false);
assert.equal(ignored(wwwroot), false);
assert.equal(ignored(path.join(wwwroot, 'css', 'index.scss')), false);
assert.equal(ignored(path.join(projectRoot, 'dist')), true);
assert.equal(ignored(path.join(projectRoot, 'dist', 'pic', 'yyzyz.png')), true);
assert.equal(ignored(path.join(projectRoot, 'packed', 'index.html')), true);
assert.equal(ignored(path.join(projectRoot, 'node_modules', 'pkg', 'index.js')), true);
assert.equal(ignored(path.join(projectRoot, '.git', 'index')), true);
assert.equal(ignored(path.join(projectRoot, '.svn', 'wc.db')), true);
assert.equal(ignored(path.resolve(watchRoot, '..', 'dist', 'outside.png')), false);

const watcher = new EventEmitter();
const warnings = [];
const originalWarn = console.warn;
console.warn = message => warnings.push(message);

try {
  attachWatcherErrorHandler(watcher, `auto projects: ${watchRoot}`);
  const error = new Error('resource busy or locked');
  error.code = 'EBUSY';
  error.path = path.join(projectRoot, 'dist', 'pic', 'yyzyz.png');
  watcher.emit('error', error);
} finally {
  console.warn = originalWarn;
}

assert.deepEqual(warnings, [
  `[mikit start] 文件监听警告（auto projects: ${watchRoot}）：EBUSY: resource busy or locked (${path.join(projectRoot, 'dist', 'pic', 'yyzyz.png')})`
]);

console.log('watcher safety tests passed');
