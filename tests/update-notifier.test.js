'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { notifyUpdate, fetchLatestVersion, isNewerStableVersion } = require('../lib/update-notifier');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const messages = [];
  let calls = 0;
  return {
    directory,
    messages,
    calls: () => calls,
    options: {
      currentVersion: '1.0.1',
      cacheFile: path.join(directory, 'cache.json'),
      stream: { isTTY: true, write: message => messages.push(message) },
      env: {},
      now: () => 1000000000,
      fetchVersion: async () => { calls++; return '1.0.2'; },
      ...overrides
    }
  };
}

for (const [current, latest, expected] of [
  ['1.0.1', '1.0.2', true],
  ['1.9.9', '1.10.0', true],
  ['1.0.2', '1.0.2', false],
  ['2.0.0', '1.9.9', false],
  ['1.0.2-beta.1', '1.0.2', true],
  ['1.0.2+local', '1.0.2+registry', false],
  ['1.0.1', '2.0.0-beta.1', false],
  ['1.0.1', 'garbage', false],
  ['1.0.1', '01.2.3', false],
  ['invalid', '2.0.0', false],
  ['1.0.1', '2.0.0\n', false]
]) {
  test(`version comparison ${JSON.stringify(current)} -> ${JSON.stringify(latest)}: ${expected}`, () => {
    assert.equal(isNewerStableVersion(current, latest), expected);
  });
}

test('first invocation reports the newer version and caches checks for one day', async t => {
  const f = fixture(t);
  await notifyUpdate(f.options);
  await notifyUpdate(f.options);
  assert.equal(f.calls(), 1);
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[0], /\[mikit\].*1\.0\.1.*1\.0\.2/);
  assert.match(f.messages[0], /npm install -g mikit-cli@latest/);
  f.options.now = () => 1000000000 + 86400001;
  await notifyUpdate(f.options);
  assert.equal(f.calls(), 2);
});

test('does not notify when installed version is newer than cached latest', async t => {
  const f = fixture(t);
  await notifyUpdate(f.options);
  f.messages.length = 0;
  await notifyUpdate({ ...f.options, currentVersion: '2.0.0' });
  assert.equal(f.messages.length, 0);
  assert.equal(f.calls(), 1);
});

test('project dependency installation gets the local update command', async t => {
  const f = fixture(t);
  f.options.installationDir = path.join(f.directory, 'node_modules', 'mikit-cli');
  fs.writeFileSync(path.join(f.directory, 'package.json'), JSON.stringify({ devDependencies: { 'mikit-cli': '^1.0.1' } }));
  await notifyUpdate(f.options);
  assert.match(f.messages[0], /npm install -D mikit-cli@latest/);
  assert.doesNotMatch(f.messages[0], /npm install -g/);
});

for (const [field, expectedCommand] of [
  ['dependencies', 'npm install mikit-cli@latest'],
  ['optionalDependencies', 'npm install --save-optional mikit-cli@latest']
]) {
  test(`preserves the dependency category for ${field}`, async t => {
    const f = fixture(t);
    f.options.installationDir = path.join(f.directory, 'node_modules', 'mikit-cli');
    fs.writeFileSync(path.join(f.directory, 'package.json'), JSON.stringify({ [field]: { 'mikit-cli': '^1.0.1' } }));
    await notifyUpdate(f.options);
    assert.ok(f.messages[0].includes(expectedCommand));
    assert.doesNotMatch(f.messages[0], /npm install -D/);
  });
}

test('global node_modules installation retains the global update command', async t => {
  const f = fixture(t);
  f.options.installationDir = path.join(f.directory, 'node_modules', 'mikit-cli');
  await notifyUpdate(f.options);
  assert.match(f.messages[0], /npm install -g mikit-cli@latest/);
});
for (const env of [{ CI: 'true' }, { CI: '1' }, { npm_config_update_notifier: 'false' }]) {
  test(`skips notifications and requests for ${JSON.stringify(env)}`, async t => {
    const f = fixture(t, { env });
    await notifyUpdate(f.options);
    assert.equal(f.calls(), 0);
    assert.equal(f.messages.length, 0);
    assert.equal(fs.existsSync(f.options.cacheFile), false);
  });
}

test('redirected output does not trigger a network request', async t => {
  const f = fixture(t, { stream: { isTTY: false, write: () => assert.fail('unexpected notice') } });
  await notifyUpdate(f.options);
  assert.equal(f.calls(), 0);
});

test('network failure is silent and retries are throttled', async t => {
  let calls = 0;
  const f = fixture(t, { fetchVersion: async () => { calls++; throw new Error('offline'); } });
  await notifyUpdate(f.options);
  await notifyUpdate(f.options);
  assert.equal(calls, 1);
  assert.equal(f.messages.length, 0);
});

test('bad or future-dated cache does not hide an available update', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.options.cacheFile, '{broken');
  await notifyUpdate(f.options);
  fs.writeFileSync(f.options.cacheFile, JSON.stringify({ checkedAt: 2000000000, latest: '1.0.1' }));
  await notifyUpdate(f.options);
  assert.equal(f.calls(), 2);
});

test('unwritable cache does not prevent a notification or reject the command', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.options.cacheFile);
  await notifyUpdate(f.options);
  assert.equal(f.messages.length, 1);
});

test('cached versions containing terminal escapes are never printed', async t => {
  const f = fixture(t, { fetchVersion: async () => '1.0.1' });
  fs.writeFileSync(f.options.cacheFile, JSON.stringify({ checkedAt: f.options.now(), latest: '2.0.0\u001b[31m' }));
  await notifyUpdate(f.options);
  assert.equal(f.messages.length, 0);
});

async function registry(t, handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}/mikit-cli/latest`, get: http.get, timeoutMs: 100 };
}

test('reads version from registry metadata', async t => {
  const options = await registry(t, (req, res) => {
    assert.equal(req.url, '/mikit-cli/latest');
    res.end(JSON.stringify({ version: '1.10.0' }));
  });
  assert.equal(await fetchLatestVersion(options), '1.10.0');
});

for (const mode of ['http-error', 'invalid-json', 'oversized', 'timeout', 'aborted']) {
  test(`registry ${mode} rejects within a bounded time`, async t => {
    const options = await registry(t, (req, res) => {
      if (mode === 'http-error') { res.writeHead(503); res.end(); }
      if (mode === 'invalid-json') res.end('{');
      if (mode === 'oversized') res.end('x'.repeat(70000));
      if (mode === 'aborted') { res.write('{'); res.socket.destroy(); }
    });
    await assert.rejects(fetchLatestVersion(options));
  });
}

test('CLI executes commands after checking and preserves version/help output', t => {
  const f = fixture(t);
  const preload = path.join(f.directory, 'preload.cjs');
  const modulePath = path.resolve(__dirname, '../lib/update-notifier');
  fs.writeFileSync(preload, `
    const updater = require(${JSON.stringify(modulePath)});
    const original = updater.notifyUpdate;
    updater.notifyUpdate = () => original({
      currentVersion: '1.0.1', env: {},
      cacheFile: ${JSON.stringify(f.options.cacheFile)},
      installationDir: ${JSON.stringify(path.resolve(__dirname, '..'))},
      stream: { isTTY: true, write: text => process.stderr.write(text) },
      fetchVersion: async () => '1.0.2'
    });
  `);
  const cli = path.resolve(__dirname, '../bin/mikit.js');
  for (const args of [['init'], ['--version'], ['--help'], ['help'], []]) {
    const result = spawnSync(process.execPath, ['--require', preload, cli, ...args], {
      cwd: f.directory, encoding: 'utf8', timeout: 10000
    });
    assert.ifError(result.error);
    if (!args.length) {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Usage:/);
      assert.doesNotMatch(result.stderr, /发现新版本/);
      continue;
    }
    assert.equal(result.status, 0, result.stderr);
    if (args[0] === 'init') {
      assert.match(result.stderr, /1\.0\.1.*1\.0\.2/);
      assert.match(result.stdout, /\[mikit init\]/);
      assert.ok(fs.existsSync(path.join(f.directory, 'package.json')));
    } else {
      assert.equal(result.stderr, '');
      if (args[0] === '--version') assert.equal(result.stdout.trim(), require('../package.json').version);
      else assert.match(result.stdout, /Usage:/);
    }
  }
});
