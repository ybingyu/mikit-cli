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
      mbuild: 'mikit build --mincss',
      'mbuild:font': 'mikit build --mincss --minfont',
      png: 'mikit png',
      replace: 'mikit replace',
      'replace:dev': 'set NODE_ENV=pp &&  npm run replace',
      'replace:build': 'set NODE_ENV=production &&  npm run replace',
      dev: 'npm run mbuild  && npm run replace:dev',
      build: 'npm run mbuild  && npm run replace:build',
      pack: 'mikit pack',
      'sync:svn': 'mikit sync-svn',
      'dev:svn': 'npm run dev && npm run sync:svn',
      'build:svn': 'npm run build && npm run sync:svn'
    });
    assert.deepEqual(packageJson.mikit, {
      replace: {
        root: 'dist',
        include: ['**/*.css'],
        rules: [
          {
            disabled: false,
            from: '../img/',
            to: 'https://img9.99.com/my/activity/example/'
          }
        ]
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
        targets: [],
        files: ['*']
      },
      png: {
        root: 'dist',
        level: 'balanced',
        exclude: []
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
