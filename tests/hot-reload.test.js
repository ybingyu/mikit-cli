const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-hot-reload-'));
const wwwroot = path.join(fixtureRoot, 'primary', 'wwwroot');
const otherRoot = path.join(fixtureRoot, 'primary', 'wwwroot-copy');
const dist = path.join(fixtureRoot, 'primary', 'dist');
let port;
let output = '';

function request(project, pathname = '/hot-update-status') {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1', port, path: pathname,
      headers: { Host: project + '.y.bindyy.cn' }
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

async function status(project) {
  const response = await request(project);
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body);
}

async function waitUntil(check, message) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message + '\nServer output:\n' + output);
}

async function verifyClient(page, initial) {
  const script = page.match(/<script id="mikit-hot-reload"[^>]*>([\s\S]*?)<\/script>/)[1];
  let nextStatus = initial;
  let reloads = 0;
  let styleUpdates = 0;
  let pendingFetch;
  let requests = 0;
  const events = {};
  const timers = new Map();
  let timerId = 0;
  const attributes = { 'data-project': 'primary', 'data-session': initial.session, 'data-modified': initial.lastModified };
  const document = {
    hidden: false,
    currentScript: { getAttribute: name => attributes[name] },
    addEventListener: (name, callback) => { events[name] = callback; },
    querySelectorAll: () => [{
      getAttribute: () => '/style.css',
      setAttribute: () => { styleUpdates += 1; }
    }]
  };
  vm.runInNewContext(script, {
    document, URL,
    window: { location: { href: 'http://primary.y.bindyy.cn/', reload: () => { reloads += 1; } },
      addEventListener: (name, callback) => { events[name] = callback; } },
    fetch: () => {
      requests += 1;
      return new Promise(resolve => {
        pendingFetch = () => resolve({ ok: true, json: async () => nextStatus });
      });
    },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  const flush = async () => { pendingFetch(); await new Promise(resolve => setImmediate(resolve)); };
  events.pageshow();
  events.visibilitychange();
  assert.equal(requests, 1, 'Lifecycle events must not overlap an in-flight heartbeat');
  await flush();
  assert.equal(reloads, 0);
  nextStatus = { ...initial, lastModified: initial.lastModified + 1, files: ['style.css'] };
  events.visibilitychange();
  await flush();
  assert.equal(styleUpdates, 1, 'CSS-only updates must retain stylesheet replacement');
  assert.equal(reloads, 0);
  nextStatus = { ...initial, session: 'new-session' };
  events.pageshow();
  await flush();
  assert.equal(reloads, 1, 'A resumed page must reload when its watcher session expired');
  events.beforeunload();
  assert.equal(timers.size, 0);
}

(async () => {
  let child;
  let rpcId = 0;
  try {
    fs.mkdirSync(path.join(wwwroot, 'css'), { recursive: true });
    fs.mkdirSync(path.join(wwwroot, 'listing'));
    fs.mkdirSync(path.join(wwwroot, 'nested'));
    fs.mkdirSync(otherRoot);
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(wwwroot, 'index.html'), 'primary page');
    fs.writeFileSync(path.join(wwwroot, 'nested', 'index.shtml'), 'nested page');
    fs.writeFileSync(path.join(wwwroot, 'css', 'initial.css'), 'body {}');
    fs.writeFileSync(path.join(otherRoot, 'index.html'), 'other page');
    fs.writeFileSync(path.join(dist, 'index.html'), 'built page');
    const configPath = path.join(fixtureRoot, 'mikit.alias.json');
    const config = { auto: ['*/wwwroot'], projects: { renamed: 'primary/wwwroot', other: 'primary/wwwroot-copy' } };
    fs.writeFileSync(configPath, JSON.stringify(config));

    const env = { ...process.env };
    delete env.MIKIT_ALIAS_CONFIG;
    // Observe real watchers and advance the manager clock without production test hooks.
    const script = [
      'const chokidar = require(' + JSON.stringify(require.resolve('chokidar')) + ');',
      'const watch = chokidar.watch;',
      'const watchers = [];',
      'chokidar.watch = function (root, options) {',
      '  const watcher = watch.call(this, root, options);',
      '  const entry = { root, discovery: options.depth !== undefined, ready: false, watcher };',
      '  watchers.push(entry);',
      '  watcher.on("ready", () => { entry.ready = true; });',
      '  return watcher;',
      '};',
      'const modulePath = ' + JSON.stringify(path.join(repoRoot, 'lib', 'hot-reload-manager')) + ';',
      'const managerModule = require(modulePath);',
      'const create = managerModule.createHotReloadManager;',
      'let clock = Date.now(); let manager;',
      'managerModule.createHotReloadManager = options => (manager = create({ ...options, now: () => clock }));',
      'let server;',
      'process.on("message", async message => {',
      '  if (message.command === "advance") { clock += message.ms; await manager.sweep(); }',
      '  if (message.command === "close") { await new Promise(resolve => server.close(resolve)); }',
      '  process.send({ id: message.id, watchers: watchers.map(entry => ({',
      '    root: entry.root, discovery: entry.discovery, ready: entry.ready, closed: entry.watcher.closed,',
      '    watched: entry.watcher.getWatched()',
      '  })) });',
      '});',
      'const probe = require("net").createServer();',
      'probe.listen(0, "127.0.0.1", () => {',
      '  const port = probe.address().port;',
      '  probe.close(() => {',
      '    console.log("Test port: " + port);',
      '    server = require(' + JSON.stringify(path.join(repoRoot, 'lib', 'server')) + ').start({',
      '      root: ' + JSON.stringify(fixtureRoot) + ', port, virtual: {}',
      '    });',
      '  });',
      '});'
    ].join('\n');
    child = spawn(process.execPath, ['-e', script], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', error => { output += error.stack; });
    child.on('exit', code => { output += '\nTest child exited: ' + code; });
    const rpc = (command, ms) => new Promise((resolve, reject) => {
      const id = ++rpcId;
      const timeout = setTimeout(() => { child.removeListener('message', receive); reject(new Error('IPC timed out')); }, 5000);
      function receive(message) {
        if (message.id !== id) return;
        clearTimeout(timeout);
        child.removeListener('message', receive);
        resolve(message.watchers);
      }
      child.on('message', receive);
      child.send({ id, command, ms });
    });
    const sourceWatchers = watchers => watchers.filter(entry => entry.root === wwwroot || entry.root === otherRoot);
    await waitUntil(() => {
      const match = output.match(/Test port: (\d+)/);
      if (match) port = Number(match[1]);
      return port && output.includes('Server is running at http://localhost:' + port);
    }, 'Test server must start');
    await waitUntil(async () => (await rpc('inspect')).filter(entry => entry.discovery).every(entry => entry.ready),
      'Discovery watcher must become ready');
    assert.equal(sourceWatchers(await rpc('inspect')).length, 0, 'Startup must not watch source directories');

    for (const pathname of ['/dist', '/dist/', '/dist/index.html', '/dist/missing.html', '/css/initial.css', '/listing/', '/missing.html']) {
      const response = await request('primary', pathname);
      assert.doesNotMatch(response.body, /mikit-hot-reload/);
    }
    assert.equal((await request('primary', '/hot-update-status?project=other')).statusCode, 404);
    assert.equal((await request('primary', '/hot-update-status?project=unknown')).statusCode, 404);
    assert.equal(sourceWatchers(await rpc('inspect')).length, 0, 'Dist, assets and mismatched status must not activate source watchers');
    const discovery = (await rpc('inspect')).find(entry => entry.discovery);
    assert.ok(!Object.keys(discovery.watched).some(dir => dir.startsWith(wwwroot + path.sep)), 'Discovery must not descend into source trees');
    assert.ok(!Object.values(discovery.watched).flat().includes('index.html'), 'Discovery must not track source files');

    let primaryPage;
    for (const project of ['primary', 'renamed', 'other']) {
      const page = await request(project, '/');
      assert.equal(page.statusCode, 200);
      assert.match(page.body, new RegExp('data-project="' + project + '"'));
      if (project === 'primary') primaryPage = page.body;
    }
    assert.equal(sourceWatchers(await rpc('inspect')).length, 2, 'Aliases of the same root must share one watcher');
    const initial = await status('primary');
    const otherInitial = await status('other');
    await verifyClient(primaryPage, initial);

    async function changeSharedFile(file, change) {
      const before = await status('primary');
      change();
      await waitUntil(async () => (await status('primary')).lastModified > before.lastModified, 'Shared root must receive ' + file);
      for (const project of ['primary', 'renamed']) {
        const updated = await status(project);
        assert.deepEqual(updated.files, [file]);
        assert.equal(updated.session, initial.session);
      }
      assert.deepEqual(await status('other'), otherInitial);
    }
    await changeSharedFile('index.html', () => fs.writeFileSync(path.join(wwwroot, 'index.html'), 'changed page'));
    await changeSharedFile('style.css', () => fs.writeFileSync(path.join(wwwroot, 'style.css'), 'body { color: red; }'));
    await changeSharedFile('style.css', () => fs.writeFileSync(path.join(wwwroot, 'style.css'), 'body { color: green; }'));
    await changeSharedFile('style.css', () => fs.unlinkSync(path.join(wwwroot, 'style.css')));
    const sharedBefore = await status('primary');
    fs.writeFileSync(path.join(otherRoot, 'index.html'), 'other changed page');
    await waitUntil(async () => (await status('other')).lastModified > otherInitial.lastModified, 'Other project must receive its own changes');
    assert.deepEqual(await status('primary'), sharedBefore);

    await rpc('advance', 299999);
    await status('renamed');
    let watched = sourceWatchers(await rpc('advance', 2));
    assert.equal(watched.find(entry => entry.root === wwwroot).closed, false, 'Another alias heartbeat keeps shared root alive');
    assert.equal(watched.find(entry => entry.root === otherRoot).closed, true);
    watched = sourceWatchers(await rpc('advance', 300000));
    assert.ok(watched.every(entry => entry.closed), 'Idle source watchers must all close');
    const distResponse = await request('primary', '/dist/');
    assert.equal(distResponse.statusCode, 200, 'Routing remains available after source watcher expiry');
    assert.equal(sourceWatchers(await rpc('inspect')).length, 2);
    fs.writeFileSync(path.join(wwwroot, 'index.html'), 'changed while idle');
    const restored = await status('primary');
    assert.notEqual(restored.session, initial.session, 'A returning device must receive a new session');
    assert.equal(sourceWatchers(await rpc('inspect')).length, 3);
    assert.equal((await request('primary', '/')).body.includes('changed while idle'), true);

    await rpc('advance', 300000);
    const nestedPage = await request('primary', '/nested/');
    assert.equal(nestedPage.statusCode, 200);
    assert.match(nestedPage.body, /data-session="[^"]+"/);
    assert.equal(sourceWatchers(await rpc('inspect')).length, 4, 'A nested index visit must activate source watching');

    const newProject = path.join(fixtureRoot, 'added');
    fs.mkdirSync(path.join(newProject, 'wwwroot'), { recursive: true });
    fs.writeFileSync(path.join(newProject, 'wwwroot', 'index.html'), 'new project');
    await waitUntil(() => output.includes('primary, added') || output.includes('added, primary'), 'New projects must still be discovered');
    const added = await request('added', '/');
    assert.match(added.body, /data-project="added"/);
    fs.rmSync(newProject, { recursive: true, force: true });
    await waitUntil(() => output.split(/\r?\n/).filter(line => line.startsWith('Reloaded projects')).at(-1)?.endsWith('primary, renamed, other'),
      'Removing a project must update routing');

    config.auto = ['*/wwwroot-copy'];
    fs.writeFileSync(configPath, JSON.stringify(config));
    await waitUntil(async () => {
      const entries = await rpc('inspect');
      return entries.filter(entry => entry.discovery).length === 2 && entries.filter(entry => entry.discovery && entry.closed).length === 1;
    }, 'Alias pattern changes must replace discovery watchers');
    assert.deepEqual((await status('renamed')).files, [], 'Remapping discovery must retain the active source session');
    await rpc('close');
    await waitUntil(async () => (await rpc('inspect')).every(entry => entry.closed), 'Closing the server must close all watchers');
    console.log('hot reload tests passed');
  } finally {
    if (child && child.exitCode === null) {
      await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
