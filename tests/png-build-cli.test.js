'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Transformer } = require('@napi-rs/image');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'mikit.js');

function mkdir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function write(filePath, content) {
  mkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function runBuild(projectDir) {
  return spawnSync(
    process.execPath,
    [cliPath, 'build', '--output', 'custom-dist', '--png'],
    { cwd: projectDir, encoding: 'utf8' }
  );
}

function cleanup(rootDir, files, dirs) {
  files.forEach(relativePath => {
    const filePath = path.join(rootDir, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  dirs.forEach(relativePath => {
    const dirPath = path.resolve(rootDir, relativePath);
    if (fs.existsSync(dirPath)) fs.rmdirSync(dirPath);
  });
}

function createPng() {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = (offset / 4) & 0xff;
    pixels[offset + 1] = 64;
    pixels[offset + 2] = 128;
    pixels[offset + 3] = 255;
  }
  return Transformer.fromRgbaPixels(pixels, 32, 32).pngSync();
}

function testBuildUsesActualOutputDirectory() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-build-'));

  try {
    write(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'png-build-success',
      version: '1.0.0',
      mikit: {
        png: {
          root: 'wrong-dist',
          level: 'balanced',
          exclude: []
        }
      }
    }, null, 2));
    write(path.join(projectDir, 'wwwroot', 'img', 'a.png'), createPng());

    const result = runBuild(projectDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[mikit png\] 完成：扫描 1 个/);
    assert.equal(fs.existsSync(path.join(projectDir, 'custom-dist', 'img', 'a.png')), true);
    assert.equal(fs.existsSync(path.join(projectDir, 'wrong-dist')), false);
  } finally {
    cleanup(
      projectDir,
      ['package.json', 'wwwroot/img/a.png', 'custom-dist/img/a.png'],
      ['custom-dist/img', 'custom-dist', 'wwwroot/img', 'wwwroot', '.']
    );
  }
}

function testBuildReportsMissingPngConfigWithoutStackTrace() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-build-missing-'));

  try {
    write(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'png-build-missing',
      version: '1.0.0'
    }, null, 2));
    write(path.join(projectDir, 'wwwroot', 'index.html'), '<p>fixture</p>');

    const result = runBuild(projectDir);
    assert.equal(
      result.status,
      1,
      'build should exit 1. stdout=' + result.stdout + ' stderr=' + result.stderr
    );
    assert.match(result.stderr, /\[mikit build\]/);
    assert.match(result.stderr, /package\.json 缺少 mikit 配置/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s/);
  } finally {
    cleanup(
      projectDir,
      ['package.json', 'wwwroot/index.html', 'custom-dist/index.html'],
      ['custom-dist', 'wwwroot', '.']
    );
  }
}

function testBuildAndPngSkipInvalidFileAndReportPath() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-build-invalid-'));
  const broken = Transformer.fromRgbaPixels(Buffer.alloc(32 * 32 * 4, 128), 32, 32).jpegSync();
  try {
    write(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'png-build-invalid', version: '1.0.0',
      mikit: { png: { root: 'custom-dist', mode: 'quantize', exclude: [] } }
    }));
    write(path.join(projectDir, 'wwwroot', 'img', 'a-broken.png'), broken);
    write(path.join(projectDir, 'wwwroot', 'img', 'nested', 'another-broken.png'), Buffer.from('not a png'));
    write(path.join(projectDir, 'wwwroot', 'img', 'z-valid.png'), createPng());

    const build = runBuild(projectDir);
    assert.equal(build.status, 0, build.stderr);
    assert.match(build.stdout, /Build completed successfully/);
    assert.match(build.stdout, /失败跳过 2 个/);
    assert.match(build.stderr, /\[mikit build\].*a-broken\.png/);
    assert.ok(build.stderr.includes(path.join(projectDir, 'custom-dist', 'img', 'a-broken.png')));
    assert.ok(build.stderr.includes(path.join(projectDir, 'custom-dist', 'img', 'nested', 'another-broken.png')));
    assert.deepEqual(fs.readFileSync(path.join(projectDir, 'custom-dist', 'img', 'a-broken.png')), broken);
    assert.equal(fs.existsSync(path.join(projectDir, 'custom-dist', 'img', 'z-valid.png')), true);

    const png = spawnSync(process.execPath, [cliPath, 'png'], { cwd: projectDir, encoding: 'utf8' });
    assert.equal(png.status, 0, png.stderr);
    assert.match(png.stdout, /失败跳过 2 个/);
    assert.match(png.stderr, /\[mikit png\].*a-broken\.png/);
    assert.ok(png.stderr.includes(path.join(projectDir, 'custom-dist', 'img', 'a-broken.png')));
    assert.ok(png.stderr.includes(path.join(projectDir, 'custom-dist', 'img', 'nested', 'another-broken.png')));
  } finally {
    cleanup(projectDir,
      ['package.json', 'wwwroot/img/a-broken.png', 'wwwroot/img/nested/another-broken.png', 'wwwroot/img/z-valid.png',
        'custom-dist/img/a-broken.png', 'custom-dist/img/nested/another-broken.png', 'custom-dist/img/z-valid.png'],
      ['custom-dist/img/nested', 'custom-dist/img', 'custom-dist', 'wwwroot/img/nested', 'wwwroot/img', 'wwwroot', '.']
    );
  }
}

testBuildUsesActualOutputDirectory();
testBuildAndPngSkipInvalidFileAndReportPath();
testBuildReportsMissingPngConfigWithoutStackTrace();
