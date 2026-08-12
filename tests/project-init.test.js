'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'mikit.js');

function runInit(cwd, extraArgs = []) {
  return spawnSync(process.execPath, [cliPath, 'init', ...extraArgs], {
    cwd,
    encoding: 'utf8'
  });
}

function cleanupFixture(fixtureDir) {
  const packagePath = path.join(fixtureDir, 'package.json');
  if (fs.existsSync(packagePath)) fs.unlinkSync(packagePath);
  if (fs.existsSync(fixtureDir)) fs.rmdirSync(fixtureDir);
}

function testCreatesPackageJsonInCurrentDirectory() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-init-project-'));

  try {
    const result = runInit(fixtureDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /[mikit init].*package.json/);

    const packagePath = path.join(fixtureDir, 'package.json');
    assert.equal(fs.existsSync(packagePath), true);

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert.equal(packageJson.name, path.basename(fixtureDir));
    assert.deepEqual(packageJson.scripts, {
      start: 'mikit start',
      build: 'mikit build',
      replace: 'mikit replace',
      pack: 'mikit pack',
      'sync:svn': 'mikit sync-svn'
    });
    assert.deepEqual(packageJson.mikit, {
      replace: {
        root: 'dist',
        include: ['**/*.css'],
        rules: []
      },
      pack: {
        source: 'wwwroot',
        dist: 'dist',
        output: 'packed',
        pageDirs: ['.', 'include'],
        assetDirs: ['js', 'css'],
        excludePages: ['*font*.shtml']
      },
      syncSvn: {
        source: 'dist/css',
        target: '',
        files: ['*']
      }
    });
  } finally {
    cleanupFixture(fixtureDir);
  }
}

function testRefusesToOverwriteExistingPackageJson() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-init-existing-'));
  const packagePath = path.join(fixtureDir, 'package.json');
  const original = '{"name":"keep-me"}\n';
  fs.writeFileSync(packagePath, original, 'utf8');

  try {
    const result = runInit(fixtureDir);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /[mikit init]/);
    assert.match(result.stderr, /package.json 已存在/);
    assert.equal(fs.readFileSync(packagePath, 'utf8'), original);
  } finally {
    cleanupFixture(fixtureDir);
  }
}

function testNoLongerAcceptsProjectName() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-init-argument-'));

  try {
    const result = runInit(fixtureDir, ['demo']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /too many arguments|参数过多/i);
    assert.equal(fs.existsSync(path.join(fixtureDir, 'package.json')), false);
  } finally {
    cleanupFixture(fixtureDir);
  }
}

testCreatesPackageJsonInCurrentDirectory();
testRefusesToOverwriteExistingPackageJson();
testNoLongerAcceptsProjectName();
