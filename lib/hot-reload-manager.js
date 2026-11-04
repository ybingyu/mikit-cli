const path = require('node:path');
const { randomUUID } = require('node:crypto');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_HISTORY = 100;

function sourceKey(root) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function createHotReloadManager({ createWatcher, now = Date.now, onError = console.warn }) {
  let projects = new Map();
  let closed = false;
  const active = new Map();
  const closing = new Map();

  function release(key) {
    const entry = active.get(key);
    if (!entry) return closing.get(key) || Promise.resolve();
    active.delete(key);
    entry.finishReady();
    const pending = Promise.resolve()
      .then(() => entry.watcher.close())
      .catch(onError)
      .finally(() => {
        if (closing.get(key) === pending) closing.delete(key);
      });
    closing.set(key, pending);
    return pending;
  }

  function setProjects(items) {
    projects = new Map(items.map(project => [project.id, {
      root: path.resolve(project.wwwroot),
      key: sourceKey(project.wwwroot)
    }]));
    const roots = new Set(Array.from(projects.values(), project => project.key));
    for (const key of active.keys()) {
      if (!roots.has(key)) release(key);
    }
  }

  async function activate(id, since) {
    const project = projects.get(id);
    if (closed || !project) return null;
    if (closing.has(project.key)) {
      await closing.get(project.key);
      return activate(id, since);
    }

    let entry = active.get(project.key);
    if (!entry) {
      const timestamp = now();
      entry = {
        session: randomUUID(),
        lastSeen: timestamp,
        lastModified: timestamp,
        files: [],
        history: [],
        historyFloor: timestamp
      };
      entry.ready = new Promise(resolve => { entry.finishReady = resolve; });
      active.set(project.key, entry);
      try {
        entry.watcher = createWatcher(project.root, files => {
          if (active.get(project.key) !== entry) return;
          entry.lastModified = Math.max(now(), entry.lastModified + 1);
          entry.files = [...files];
          entry.history.push({ version: entry.lastModified, files: entry.files });
          if (entry.history.length > MAX_HISTORY) {
            entry.historyFloor = entry.history.shift().version;
          }
        });
        const ready = () => {
          entry.watcher.removeListener('ready', ready);
          entry.watcher.removeListener('error', ready);
          entry.finishReady();
        };
        entry.watcher.once('ready', ready);
        entry.watcher.once('error', ready);
      } catch (error) {
        active.delete(project.key);
        entry.finishReady();
        throw error;
      }
    }

    entry.lastSeen = now();
    await entry.ready;
    if (closed || !projects.has(id)) return null;
    if (projects.get(id).key !== project.key || active.get(project.key) !== entry) {
      return activate(id, since);
    }
    entry.lastSeen = now();
    let files = entry.files;
    if (since !== undefined) {
      const cursor = Number(since);
      // Missing history or invalid cursors force a full reload on a newer version.
      files = Number.isSafeInteger(cursor) && cursor >= entry.historyFloor && cursor <= entry.lastModified
        ? [...new Set(entry.history.filter(event => event.version > cursor).flatMap(event => event.files))]
        : [];
    }
    return {
      project: id,
      session: entry.session,
      lastModified: entry.lastModified,
      files
    };
  }

  async function sweep() {
    const pending = [];
    for (const [key, entry] of active) {
      if (now() - entry.lastSeen >= IDLE_TIMEOUT_MS) pending.push(release(key));
    }
    await Promise.all(pending);
  }

  const timer = setInterval(() => { sweep().catch(onError); }, 30 * 1000);
  timer.unref();

  async function close() {
    closed = true;
    clearInterval(timer);
    projects.clear();
    for (const key of active.keys()) release(key);
    await Promise.all(closing.values());
  }

  return { setProjects, activate, sweep, close };
}

module.exports = { createHotReloadManager };
