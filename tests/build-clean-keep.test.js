'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { build } = require('../lib/builder');
const { cleanBuildOutput } = require('../lib/build-output');
const cli = path.resolve(__dirname, '../bin/mikit.js');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture(t, buildConfig, output = 'dist') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-build-keep-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('mikit-build-keep-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const mikit = { author: 'test' };
  if (buildConfig !== undefined) mikit.build = buildConfig;
  write(path.join(root, 'package.json'), JSON.stringify({ mikit }));
  write(path.join(root, 'wwwroot/index.html'), '<main>new page</main>');
  const outputDir = path.join(root, output);
  write(path.join(outputDir, 'stale.txt'), 'stale');
  write(path.join(outputDir, 'font/old.woff2'), 'old font');
  return { root, outputDir };
}

for (const config of [undefined, {}, { cleanKeep: [] }]) {
  test('missing or empty cleanKeep clears all old output: ' + JSON.stringify(config), t => {
    const { root, outputDir } = fixture(t, config);
    cleanBuildOutput(root, outputDir);
    assert.deepEqual(fs.readdirSync(outputDir), []);
  });
}

test('build remains usable without package.json', t => {
  const { root, outputDir } = fixture(t);
  fs.unlinkSync(path.join(root, 'package.json'));
  cleanBuildOutput(root, outputDir);
  assert.deepEqual(fs.readdirSync(outputDir), []);
});

for (const output of ['dist', 'custom-dist']) {
  test('CLI preserves multiple nested directories without copying source files: ' + output, t => {
    const { root, outputDir } = fixture(t, { cleanKeep: ['font', 'Img/pic'] }, output);
    write(path.join(root, 'wwwroot/font/new.woff2'), 'new font');
    write(path.join(root, 'wwwroot/font/common.woff2'), 'source font');
    write(path.join(root, 'wwwroot/Img/pic/common.png'), 'source image');
    write(path.join(outputDir, 'font/common.woff2'), 'previous font');
    write(path.join(outputDir, 'Img/pic/common.png'), 'previous image');
    write(path.join(outputDir, 'Img/pic/nested/old.png'), 'kept image');
    write(path.join(outputDir, 'Img/picture/old.png'), 'remove sibling');
    write(path.join(outputDir, 'Img/obsolete.txt'), 'remove file');
    write(path.join(outputDir, 'font-backup/old.woff2'), 'remove prefix sibling');
    write(path.join(outputDir, '.obsolete'), 'remove dotfile');
    const result = spawnSync(process.execPath, [cli, 'build', '--output', output], {
      cwd: root, encoding: 'utf8', windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Build completed successfully/);
    for (const [file, content] of [
      ['index.html', '<main>new page</main>'],
      ['font/common.woff2', 'previous font'],
      ['font/old.woff2', 'old font'],
      ['Img/pic/common.png', 'previous image'],
      ['Img/pic/nested/old.png', 'kept image']
    ]) {
      assert.equal(fs.readFileSync(path.join(outputDir, file), 'utf8'), content, file);
    }
    for (const file of ['font/new.woff2', 'stale.txt', 'Img/picture', 'Img/obsolete.txt', 'font-backup', '.obsolete']) {
      assert.equal(fs.existsSync(path.join(outputDir, file)), false, file);
    }
  });
}

test('direct build reads the same cleanKeep configuration', t => {
  const { root, outputDir } = fixture(t, { cleanKeep: ['font'] });
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    build();
  } finally {
    process.chdir(originalCwd);
  }
  assert.equal(fs.readFileSync(path.join(outputDir, 'font/old.woff2'), 'utf8'), 'old font');
  assert.equal(fs.existsSync(path.join(outputDir, 'stale.txt')), false);
  assert.equal(fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8'), '<main>new page</main>');
});

test('missing preserved directories and a first build are allowed', t => {
  const { root, outputDir } = fixture(t, { cleanKeep: ['missing/deep'] });
  cleanBuildOutput(root, outputDir);
  assert.equal(fs.existsSync(path.join(outputDir, 'missing')), false);
  assert.deepEqual(fs.readdirSync(outputDir), []);
  fs.rmdirSync(outputDir);
  cleanBuildOutput(root, outputDir);
  assert.deepEqual(fs.readdirSync(outputDir), []);
});

test('literal directory names, separators, duplicates and parent entries are supported', t => {
  const { root, outputDir } = fixture(t, {
    cleanKeep: ['Img\\pic\\nested', './Img/pic/', 'Img/pic', 'asset[1]']
  });
  write(path.join(outputDir, 'Img/pic/nested/a.txt'), 'nested');
  write(path.join(outputDir, 'Img/pic/other.txt'), 'parent contents');
  write(path.join(outputDir, 'Img/other/old.txt'), 'remove');
  write(path.join(outputDir, 'asset[1]/keep.txt'), 'literal brackets');
  write(path.join(outputDir, 'asset1/old.txt'), 'remove');
  cleanBuildOutput(root, outputDir);
  assert.equal(fs.readFileSync(path.join(outputDir, 'Img/pic/other.txt'), 'utf8'), 'parent contents');
  assert.equal(fs.readFileSync(path.join(outputDir, 'asset[1]/keep.txt'), 'utf8'), 'literal brackets');
  assert.equal(fs.existsSync(path.join(outputDir, 'Img/other')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'asset1')), false);
});

if (process.platform === 'win32') {
  test('Windows matches kept directories without case sensitivity', t => {
    const { root, outputDir } = fixture(t, { cleanKeep: ['FONT', 'img/PIC'] });
    write(path.join(outputDir, 'Img/pic/a.txt'), 'keep');
    write(path.join(outputDir, 'Img/drop.txt'), 'remove');
    cleanBuildOutput(root, outputDir);
    assert.equal(fs.readFileSync(path.join(outputDir, 'font/old.woff2'), 'utf8'), 'old font');
    assert.equal(fs.readFileSync(path.join(outputDir, 'Img/pic/a.txt'), 'utf8'), 'keep');
    assert.equal(fs.existsSync(path.join(outputDir, 'Img/drop.txt')), false);
  });
}

for (const value of [null, true, 'font', {}, [null], [''], [' '], ['.'], ['/absolute'],
  ['C:\\absolute'], ['C:relative'], ['../escape'], ['font/../../escape'], ['font/*'], ['font?']]) {
  test('invalid cleanKeep fails before deleting output: ' + JSON.stringify(value), t => {
    const { root, outputDir } = fixture(t, { cleanKeep: value });
    assert.throws(() => cleanBuildOutput(root, outputDir), /mikit\.build\.cleanKeep/);
    assert.equal(fs.readFileSync(path.join(outputDir, 'stale.txt'), 'utf8'), 'stale');
    assert.equal(fs.readFileSync(path.join(outputDir, 'font/old.woff2'), 'utf8'), 'old font');
  });
}

for (const invalid of [null, true, 'font', []]) {
  test('invalid build config fails before deleting output: ' + JSON.stringify(invalid), t => {
    const { root, outputDir } = fixture(t, invalid);
    assert.throws(() => cleanBuildOutput(root, outputDir), /mikit\.build/);
    assert.equal(fs.readFileSync(path.join(outputDir, 'stale.txt'), 'utf8'), 'stale');
  });
}

for (const kept of ['stale.txt', 'stale.txt/nested', '../outside']) {
  test('all entries are checked before any deletion: ' + kept, t => {
    const { root, outputDir } = fixture(t, { cleanKeep: ['font', kept] });
    assert.throws(() => cleanBuildOutput(root, outputDir), /mikit\.build\.cleanKeep\[1\]/);
    assert.equal(fs.readFileSync(path.join(outputDir, 'stale.txt'), 'utf8'), 'stale');
    assert.equal(fs.readFileSync(path.join(outputDir, 'font/old.woff2'), 'utf8'), 'old font');
  });
}

for (const kept of ['linked', 'linked/nested', 'font']) {
  test('links in preserved paths fail before deletion or external writes: ' + kept, t => {
    const { root, outputDir } = fixture(t, { cleanKeep: [kept] });
    const outside = path.join(root, 'outside');
    write(path.join(outside, 'sentinel.txt'), 'external');
    const link = path.join(outputDir, kept === 'font' ? 'font/linked' : 'linked');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => cleanBuildOutput(root, outputDir), /mikit\.build\.cleanKeep.*符号链接/);
    assert.equal(fs.readFileSync(path.join(outputDir, 'stale.txt'), 'utf8'), 'stale');
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'external');
  });
}

test('CLI reports an invalid later entry without clearing output', t => {
  const { root, outputDir } = fixture(t, { cleanKeep: ['font', '../outside'] });
  const result = spawnSync(process.execPath, [cli, 'build'], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /\[mikit build\].*mikit\.build\.cleanKeep\[1\]/);
  assert.doesNotMatch(result.stderr, /at .*node_modules/);
  assert.doesNotMatch(result.stdout, /Build completed successfully/);
  assert.equal(fs.readFileSync(path.join(outputDir, 'stale.txt'), 'utf8'), 'stale');
});


function runBuild(root, options = {}) {
  const originalCwd = process.cwd();
  try {
    process.chdir(root);
    build(options);
  } finally {
    process.chdir(originalCwd);
  }
}

test('kept trees skip compilation, missing directories and literal path names', t => {
  const { root, outputDir } = fixture(t, {
    cleanKeep: ['font', 'Img/pic', 'missing/deep', 'asset[1]', 'styles.css', 'page.html']
  });
  for (const folder of ['font', 'Img/pic', 'missing/deep', 'asset[1]']) {
    write(path.join(root, 'wwwroot', folder, 'invalid.scss'), 'invalid {');
    write(path.join(root, 'wwwroot', folder, 'invalid.js'), 'let = ;');
    write(path.join(root, 'wwwroot', folder, 'invalid.shtml'), '<!--#include virtual="/missing.shtml" -->');
  }
  write(path.join(root, 'wwwroot/styles.scss'), 'invalid {');
  write(path.join(root, 'wwwroot/page.shtml'), '<!--#include virtual="/missing.shtml" -->');
  write(path.join(outputDir, 'styles.css/old.txt'), 'old style directory');
  write(path.join(outputDir, 'page.html/old.txt'), 'old page directory');
  write(path.join(root, 'wwwroot/asset1/new.txt'), 'normal sibling');
  write(path.join(root, 'wwwroot/Img/sibling/new.txt'), 'normal image sibling');
  const result = spawnSync(process.execPath, [cli, 'build', '--min'], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  for (const folder of ['font', 'Img/pic', 'missing/deep', 'asset[1]']) {
    assert.equal(fs.existsSync(path.join(outputDir, folder, 'invalid.css')), false);
    assert.equal(fs.existsSync(path.join(outputDir, folder, 'invalid.js')), false);
    assert.equal(fs.existsSync(path.join(outputDir, folder, 'invalid.html')), false);
  }
  assert.equal(fs.existsSync(path.join(outputDir, 'missing/deep')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'asset[1]')), false);
  assert.equal(fs.readFileSync(path.join(outputDir, 'styles.css/old.txt'), 'utf8'), 'old style directory');
  assert.equal(fs.readFileSync(path.join(outputDir, 'page.html/old.txt'), 'utf8'), 'old page directory');
  assert.equal(fs.readFileSync(path.join(outputDir, 'asset1/new.txt'), 'utf8'), 'normal sibling');
  assert.equal(fs.readFileSync(path.join(outputDir, 'Img/sibling/new.txt'), 'utf8'), 'normal image sibling');
});

for (const exists of [true, false]) {
  test('build --minfont skips a fully kept font directory, existing: ' + exists, t => {
    const { root, outputDir } = fixture(t, { cleanKeep: ['font'] });
    if (!exists) fs.rmSync(path.join(outputDir, 'font'), { recursive: true });
    write(path.join(root, 'wwwroot/font/new.ttf'), 'invalid font');
    // Invalid font settings must not be loaded for a skipped font directory.
    const configFile = path.join(root, 'package.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.mikit.font = { pages: 'invalid' };
    fs.writeFileSync(configFile, JSON.stringify(config));
    const result = spawnSync(process.execPath, [cli, 'build', '--minfont'], {
      cwd: root, encoding: 'utf8', windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(outputDir, 'font/new.ttf')), false);
    assert.equal(fs.existsSync(path.join(outputDir, 'font/old.woff2')), exists);
    assert.equal(fs.existsSync(path.join(root, 'font')), false);
  });
}

test('build --png skips kept PNGs and optimizes other PNGs', t => {
  const { root, outputDir } = fixture(t, { cleanKeep: ['Img/pic'] });
  // Use a known valid PNG without requiring a browser or image conversion.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64');
  write(path.join(root, 'wwwroot/Img/normal.png'), png);
  write(path.join(outputDir, 'Img/pic/invalid.png'), 'must not decode');
  const configFile = path.join(root, 'package.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.mikit.png = { mode: 'lossless' };
  fs.writeFileSync(configFile, JSON.stringify(config));
  const result = spawnSync(process.execPath, [cli, 'build', '--png'], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /扫描 1/);
  assert.equal(fs.readFileSync(path.join(outputDir, 'Img/pic/invalid.png'), 'utf8'), 'must not decode');
  assert.equal(fs.existsSync(path.join(outputDir, 'Img/normal.png')), true);
});

function fakeSubset(_command, args) {
  write(args.find(arg => arg.startsWith('--output-file=')).slice(14), 'subset font');
  return { status: 0 };
}

function fontFixture(t) {
  const { root, outputDir } = fixture(t, { cleanKeep: ['font/vendor', 'protected'] });
  write(path.join(root, 'wwwroot/font/Active.ttf'), 'source font');
  write(path.join(outputDir, 'font/Active.ttf'), 'original font');
  write(path.join(outputDir, 'font/vendor/Old.woff2'), 'keep font');
  write(path.join(outputDir, 'font/vendor/nested/data.txt'), 'keep nested');
  write(path.join(outputDir, 'style.css'), '@font-face{font-family:Active;src:url(font/Active.ttf)}' +
    '@font-face{font-family:Vendor;src:url(font/vendor/Old.woff2)}.active{font-family:Active}');
  write(path.join(outputDir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="style.css">' +
    '<link rel="stylesheet" href="protected/hidden.css"><script src="protected/hidden.js"></script></head>' +
    '<body><div class="active">甲乙</div></body></html>');
  write(path.join(outputDir, 'protected/hidden.css'), '@font-face{font-family:Hidden;src:url(/font/Missing.ttf)}');
  write(path.join(outputDir, 'protected/hidden.js'), 'invalid script {');
  write(path.join(outputDir, 'protected/hidden.html'), '<div class="active">排除</div>');
  return { root, outputDir };
}

for (const fontPage of [undefined, '**/*.html']) {
  test('partial font preservation skips staging, analysis, pruning and publication: ' + fontPage, t => {
    const { root, outputDir } = fontFixture(t);
    const { subsetFonts } = require('../lib/font-subsetter');
    const { createDirectoryExclusion } = require('../lib/directory-exclusion');
    const excludedDirectories = ['font/vendor', 'protected'].map(dir => path.join(outputDir, dir));
    const { isExcluded } = createDirectoryExclusion(excludedDirectories);
    const preserved = path.join(outputDir, 'font/vendor');
    const before = fs.statSync(preserved);
    const readFileSync = fs.readFileSync;
    const readdirSync = fs.readdirSync;
    let result;
    try {
      fs.readFileSync = function(file, ...args) {
        assert.equal(typeof file === 'string' && isExcluded(file), false, 'must not read kept file: ' + file);
        return readFileSync.call(this, file, ...args);
      };
      fs.readdirSync = function(file, ...args) {
        assert.equal(typeof file === 'string' && isExcluded(file), false, 'must not scan kept directory: ' + file);
        return readdirSync.call(this, file, ...args);
      };
      result = subsetFonts({ projectDir: root, excludedDirectories, fontPage, commandRunner: fakeSubset });
    } finally {
      fs.readFileSync = readFileSync;
      fs.readdirSync = readdirSync;
    }
    assert.equal(result.processed.length, 1);
    assert.equal(fs.readFileSync(path.join(root, 'font/Active.txt'), 'utf8'), '甲乙');
    assert.equal(fs.readFileSync(path.join(outputDir, 'font/Active.ttf'), 'utf8'), 'subset font');
    assert.equal(fs.existsSync(path.join(outputDir, 'font/old.woff2')), false);
    assert.equal(fs.readFileSync(path.join(preserved, 'Old.woff2'), 'utf8'), 'keep font');
    assert.equal(fs.readFileSync(path.join(preserved, 'nested/data.txt'), 'utf8'), 'keep nested');
    const after = fs.statSync(preserved);
    assert.equal(after.ino, before.ino, 'kept directory must not be replaced');
    assert.equal(after.mtimeMs, before.mtimeMs, 'kept directory must not be changed');
    assert.equal(fs.existsSync(path.join(root, 'font/vendor')), false);
  });
}

test('font pruning leaves kept nested directories untouched when no active fonts remain', t => {
  const { root, outputDir } = fontFixture(t);
  fs.unlinkSync(path.join(outputDir, 'style.css'));
  write(path.join(outputDir, 'index.html'), '<div>nothing</div>');
  const { subsetFonts } = require('../lib/font-subsetter');
  const result = subsetFonts({ projectDir: root, excludedDirectories: ['font/vendor', 'protected'].map(dir => path.join(outputDir, dir)),
    commandRunner() { throw new Error('no font should be processed'); } });
  assert.equal(result.processed.length, 0);
  assert.equal(fs.readFileSync(path.join(outputDir, 'font/vendor/Old.woff2'), 'utf8'), 'keep font');
  assert.equal(fs.existsSync(path.join(outputDir, 'font/Active.ttf')), false);
});

test('build forwards partial font exclusions and still builds active fonts', t => {
  const { root, outputDir } = fixture(t, { cleanKeep: ['font/vendor'] });
  write(path.join(root, 'wwwroot/font/Active.ttf'), 'source font');
  write(path.join(root, 'wwwroot/style.css'), '@font-face{font-family:Active;src:url(font/Active.ttf)}div{font-family:Active}');
  write(path.join(root, 'wwwroot/index.html'), '<div>甲乙</div>');
  write(path.join(root, 'wwwroot/font/vendor/new.ttf'), 'must not copy');
  write(path.join(outputDir, 'font/vendor/Old.woff2'), 'keep font');
  const fonts = require('../lib/font-subsetter');
  const subsetFonts = fonts.subsetFonts;
  try {
    fonts.subsetFonts = options => subsetFonts({ ...options, commandRunner: fakeSubset });
    runBuild(root, { minFont: true });
  } finally {
    fonts.subsetFonts = subsetFonts;
  }
  assert.equal(fs.readFileSync(path.join(outputDir, 'font/Active.ttf'), 'utf8'), 'subset font');
  assert.equal(fs.readFileSync(path.join(outputDir, 'font/vendor/Old.woff2'), 'utf8'), 'keep font');
  assert.equal(fs.existsSync(path.join(outputDir, 'font/vendor/new.ttf')), false);
});


test('font publication failure rolls back processed branches and keeps protected branches in place', t => {
  const { root, outputDir } = fontFixture(t);
  const { subsetFonts } = require('../lib/font-subsetter');
  const manifestDir = path.join(root, 'font');
  write(path.join(manifestDir, 'previous.txt'), 'previous manifest');
  const renameSync = fs.renameSync;
  try {
    fs.renameSync = function(from, to) {
      if (to === manifestDir && path.basename(from) === 'manifest') throw new Error('injected publish failure');
      return renameSync.call(this, from, to);
    };
    assert.throws(() => subsetFonts({ projectDir: root, commandRunner: fakeSubset,
      excludedDirectories: ['font/vendor', 'protected'].map(dir => path.join(outputDir, dir)) }), /injected publish failure/);
  } finally {
    fs.renameSync = renameSync;
  }
  assert.equal(fs.readFileSync(path.join(outputDir, 'font/Active.ttf'), 'utf8'), 'original font');
  assert.equal(fs.readFileSync(path.join(outputDir, 'font/old.woff2'), 'utf8'), 'old font');
  assert.equal(fs.readFileSync(path.join(outputDir, 'font/vendor/Old.woff2'), 'utf8'), 'keep font');
  assert.equal(fs.readFileSync(path.join(manifestDir, 'previous.txt'), 'utf8'), 'previous manifest');
  assert.equal(fs.existsSync(path.join(manifestDir, 'Active.txt')), false);
  assert.equal(fs.readdirSync(path.join(outputDir, 'font')).some(name => name.startsWith('.mikit-font-backup-')), false);
});

test('preserved pages are excluded from runtime collection and nested stylesheet dependencies', t => {
  const { root, outputDir } = fontFixture(t);
  const { subsetFonts } = require('../lib/font-subsetter');
  const { loadFontRuntimeConfig } = require('../lib/font-runtime-config');
  write(path.join(outputDir, 'style.css'), '@import "protected/hidden.css";@font-face{font-family:Active;src:url(font/Active.ttf)}.active{font-family:Active}');
  write(path.join(root, 'wwwroot/protected/hidden.shtml'), 'must not discover');
  let runtimePages;
  const result = subsetFonts({ projectDir: root, commandRunner: fakeSubset,
    excludedDirectories: ['font/vendor', 'protected'].map(dir => path.join(outputDir, dir)),
    runtimeConfig: { ...loadFontRuntimeConfig(root), pages: ['https://example.test/protected/hidden.html', 'https://example.test/index.html'] },
    runtimeRunner(config) { runtimePages = config.pages; return {}; }
  });
  assert.equal(result.processed.length, 1);
  assert.deepEqual(runtimePages, ['https://example.test/index.html']);
  assert.equal(fs.readFileSync(path.join(root, 'font/Active.txt'), 'utf8'), '甲乙');
  assert.equal(result.risks.some(risk => risk.includes('protected')), false);
});

test('independent font and PNG commands retain their configured scope', t => {
  const { root, outputDir } = fixture(t, { cleanKeep: ['font', 'Img/pic'] });
  const { subsetFonts } = require('../lib/font-subsetter');
  const { optimizePngImages } = require('../lib/png-optimizer');
  write(path.join(root, 'wwwroot/font/Active.ttf'), 'source font');
  write(path.join(outputDir, 'style.css'), '@font-face{font-family:Active;src:url(font/Active.ttf)}main{font-family:Active}');
  write(path.join(outputDir, 'index.html'), '<main>甲乙</main>');
  const fonts = subsetFonts({ projectDir: root, commandRunner: fakeSubset });
  assert.equal(fonts.processed.length, 1);
  assert.equal(fs.existsSync(path.join(outputDir, 'font/old.woff2')), false);
  write(path.join(outputDir, 'Img/pic/a.png'), 'long fake png');
  const configFile = path.join(root, 'package.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.mikit.png = { root: 'dist' };
  fs.writeFileSync(configFile, JSON.stringify(config));
  const visited = [];
  const png = optimizePngImages({ projectDir: root, rootOverride: outputDir,
    quantizePng(input, options) { visited.push(options.relativePath); return Buffer.from('small'); }
  });
  assert.deepEqual(visited, ['Img/pic/a.png']);
  assert.equal(png.optimized, 1);
});
