const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHotReloadManager } = require('../lib/hot-reload-manager');

(async () => {
  let clock = 1000;
  const watchers = [];
  const source = path.resolve('fixture', 'wwwroot');
  const other = path.resolve('fixture', 'other', 'wwwroot');
  const projects = [
    { id: 'auto', wwwroot: source },
    { id: 'alias', wwwroot: source },
    { id: 'other', wwwroot: other }
  ];
  const manager = createHotReloadManager({
    now: () => clock,
    createWatcher(root, notify) {
      const watcher = new EventEmitter();
      Object.assign(watcher, { root, notify, closed: false });
      watcher.close = async () => { watcher.closed = true; };
      watchers.push(watcher);
      queueMicrotask(() => watcher.emit('ready'));
      return watcher;
    }
  });

  try {
    manager.setProjects(projects);
    assert.equal(watchers.length, 0, 'Project discovery must not create source watchers');
    assert.equal(await manager.activate('unknown'), null);
    const first = await manager.activate('auto');
    const alias = await manager.activate('alias');
    assert.equal(watchers.length, 1, 'Aliases must share one source watcher');
    assert.equal(first.session, alias.session);

    watchers[0].notify(['index.html']);
    const changed = await manager.activate('alias');
    assert.ok(changed.lastModified > alias.lastModified);
    assert.deepEqual(changed.files, ['index.html']);
    assert.equal((await manager.activate('auto')).lastModified, changed.lastModified);

    clock += 299999;
    await manager.activate('alias');
    clock += 2;
    await manager.sweep();
    assert.equal(watchers[0].closed, false, 'Another alias or device heartbeat must keep the watcher alive');
    clock += 300000;
    await manager.sweep();
    assert.equal(watchers[0].closed, true, 'Five idle minutes must close the watcher');
    const restored = await manager.activate('auto');
    assert.notEqual(restored.session, first.session, 'Resuming must invalidate a page served before expiry');
    assert.deepEqual(restored.files, []);

    await manager.activate('other');
    manager.setProjects(projects.filter(project => project.id !== 'alias'));
    assert.equal(await manager.activate('alias'), null);
    assert.equal((await manager.activate('auto')).session, restored.session);

    manager.setProjects([{ id: 'auto', wwwroot: other }]);
    await manager.activate('auto');
    assert.equal(watchers[1].closed, true, 'Removing the last alias must release its old directory');
    assert.equal(await manager.activate('other'), null);

    for (let i = 0; i < 10; i += 1) {
      await manager.activate('auto');
      clock += 300000;
      await manager.sweep();
      assert.equal(watchers.filter(watcher => !watcher.closed).length, 0);
    }

    const pending = manager.activate('auto');
    manager.setProjects([]);
    assert.equal(await pending, null, 'Removal while the watcher initializes must settle pending requests');
  } finally {
    await manager.close();
  }
  assert.ok(watchers.every(watcher => watcher.closed));
  console.log('hot reload manager tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
