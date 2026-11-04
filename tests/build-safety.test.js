'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { build } = require('../lib/builder');
const cli = path.resolve(__dirname, '../bin/mikit.js');

function fixture(t, rootless = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-build-safety-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ mikit: { author: 'review' } }));
  const source = rootless ? root : path.join(root, 'wwwroot');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'index.html'), '<main>original</main>');
  return { root, source };
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, 'build', ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
}

for (const output of ['wwwroot', '.', 'wwwroot/nested', '.git/output', 'node_modules/output', '.svn/output']) {
  test('build rejects unsafe output before clearing files: ' + output, t => {
    const { root, source } = fixture(t);
    const target = path.resolve(root, output);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
    const result = run(root, ['-o', output]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /\[mikit build\]/);
    assert.doesNotMatch(result.stdout, /Build completed successfully/);
    assert.equal(fs.readFileSync(path.join(source, 'index.html'), 'utf8'), '<main>original</main>');
    assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
  });
}

test('direct build also rejects output above the project', t => {
  const { root, source } = fixture(t);
  const nested = path.join(root, 'project');
  fs.mkdirSync(nested);
  fs.renameSync(source, path.join(nested, 'wwwroot'));
  const originalCwd = process.cwd();
  try {
    process.chdir(nested);
    assert.throws(() => build({ output: root }), /输出目录/);
    assert.equal(fs.existsSync(path.join(nested, 'wwwroot/index.html')), true);
  } finally { process.chdir(originalCwd); }
});

test('build checks real paths through a directory junction', t => {
  const { root, source } = fixture(t);
  fs.symlinkSync(source, path.join(root, 'linked-output'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = run(root, ['-o', 'linked-output']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(fs.readFileSync(path.join(source, 'index.html'), 'utf8'), '<main>original</main>');
});

for (const output of ['dist', 'public-output', 'public[1]', 'nested/output']) {
  test('rootless builds preserve source and exclude their output: ' + output, t => {
    const { root } = fixture(t, true);
    const result = run(root, ['-o', output]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(root, output, 'index.html'), 'utf8'), '<main>original</main>');
    assert.equal(fs.existsSync(path.join(root, output, output)), false);
    assert.equal(fs.existsSync(path.join(root, 'package.json')), true);
  });
}

for (const flag of ['--minjs', '--min']) {
  test('build actually minifies JavaScript with ' + flag, t => {
    const { root, source } = fixture(t);
    const input = 'function calculateTotal(price, count) {\n  const subtotal = price * count;\n  return subtotal;\n}\nresult = calculateTotal(12, 3);\n';
    fs.writeFileSync(path.join(source, 'app.js'), input);
    const result = run(root, [flag]);
    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(path.join(root, 'dist/app.js'), 'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/, '');
    assert.ok(output.length < input.length, output);
    const context = {};
    vm.runInNewContext(output, context);
    assert.equal(context.result, 36);
  });
}

for (const [file, content, args] of [
  ['broken.js', 'function {', ['--minjs']],
  ['broken.scss', '.a { color: $notDefined; }', []]
]) {
  test('build reports failure for ' + file, t => {
    const { root, source } = fixture(t);
    fs.writeFileSync(path.join(source, file), content);
    const result = run(root, args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /\[mikit build\]/);
    assert.ok(result.stderr.includes(file), result.stderr);
    assert.doesNotMatch(result.stdout, /Build completed successfully/);
    assert.doesNotMatch(result.stderr, /at .*node_modules|UnhandledPromiseRejection/);
  });
}
