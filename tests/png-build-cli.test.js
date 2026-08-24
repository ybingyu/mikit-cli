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

testBuildUsesActualOutputDirectory();
testBuildReportsMissingPngConfigWithoutStackTrace();
