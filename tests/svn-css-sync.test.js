'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncCssToSvn } = require('../lib/svn-css-sync');

function mkdir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function write(filePath, content) {
  mkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeConfig(projectDir, syncSvn) {
  write(path.join(projectDir, 'package.json'), JSON.stringify({
    name: 'svn-sync-fixture',
    version: '1.0.0',
    mikit: { syncSvn }
  }, null, 2));
}

function cleanup(projectDir, files, dirs) {
  files.forEach(relativePath => {
    const filePath = path.join(projectDir, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  dirs.forEach(relativePath => {
    const dirPath = path.resolve(projectDir, relativePath);
    if (fs.existsSync(dirPath)) fs.rmdirSync(dirPath);
  });
}

function testSyncsToMultipleTargetsAndDeduplicates() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-svn-multi-'));
  const targetA = path.join(projectDir, 'svn-a', 'css');
  const targetB = path.join(projectDir, 'svn-b', 'css');
  mkdir(targetA);
  mkdir(targetB);

  try {
    writeConfig(projectDir, {
      source: 'dist/css',
      targets: [targetA, targetB, targetA],
      files: ['*']
    });
    write(path.join(projectDir, 'dist', 'css', 'style.css'), '.style{}');
    write(path.join(projectDir, 'dist', 'css', 'phone.css'), '.phone{}');
    write(path.join(targetA, 'phone.css'), '.phone{}');

    const summary = syncCssToSvn({ projectDir });

    assert.equal(summary.copied, 3);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.target, path.resolve(targetA));
    assert.deepEqual(summary.targets, [path.resolve(targetA), path.resolve(targetB)]);
    assert.deepEqual(summary.files, ['phone.css', 'style.css']);
    assert.equal(fs.readFileSync(path.join(targetA, 'style.css'), 'utf8'), '.style{}');
    assert.equal(fs.readFileSync(path.join(targetB, 'style.css'), 'utf8'), '.style{}');
    assert.equal(fs.readFileSync(path.join(targetB, 'phone.css'), 'utf8'), '.phone{}');
  } finally {
    cleanup(projectDir, [
      'package.json',
      'dist/css/style.css',
      'dist/css/phone.css',
      'svn-a/css/style.css',
      'svn-a/css/phone.css',
      'svn-b/css/style.css',
      'svn-b/css/phone.css'
    ], [
      'dist/css',
      'dist',
      'svn-a/css',
      'svn-a',
      'svn-b/css',
      'svn-b',
      '.'
    ]);
  }
}

function testSupportsLegacySingleTarget() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-svn-legacy-'));
  const targetDir = path.join(projectDir, 'svn', 'css');
  mkdir(targetDir);

  try {
    writeConfig(projectDir, {
      source: 'dist/css',
      target: targetDir,
      files: ['style.css']
    });
    write(path.join(projectDir, 'dist', 'css', 'style.css'), '.legacy{}');

    const summary = syncCssToSvn({ projectDir });

    assert.equal(summary.copied, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.target, path.resolve(targetDir));
    assert.deepEqual(summary.targets, [path.resolve(targetDir)]);
  } finally {
    cleanup(projectDir, [
      'package.json',
      'dist/css/style.css',
      'svn/css/style.css'
    ], [
      'dist/css',
      'dist',
      'svn/css',
      'svn',
      '.'
    ]);
  }
}

function testRejectsTargetAndTargetsTogether() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-svn-conflict-'));
  const targetDir = path.join(projectDir, 'svn', 'css');
  mkdir(targetDir);

  try {
    writeConfig(projectDir, {
      source: 'dist/css',
      target: targetDir,
      targets: [targetDir],
      files: ['*']
    });
    write(path.join(projectDir, 'dist', 'css', 'style.css'), '.style{}');

    assert.throws(
      () => syncCssToSvn({ projectDir }),
      /mikit\.syncSvn\.target 和 mikit\.syncSvn\.targets 不能同时配置/
    );
  } finally {
    cleanup(projectDir, [
      'package.json',
      'dist/css/style.css'
    ], [
      'dist/css',
      'dist',
      'svn/css',
      'svn',
      '.'
    ]);
  }
}

function testRejectsInvalidTargetsArrays() {
  const invalidTargets = [
    [],
    [''],
    [123]
  ];

  invalidTargets.forEach((targets, index) => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `mikit-svn-invalid-${index}-`));

    try {
      writeConfig(projectDir, {
        source: 'dist/css',
        targets,
        files: ['*']
      });
      write(path.join(projectDir, 'dist', 'css', 'style.css'), '.style{}');

      assert.throws(
        () => syncCssToSvn({ projectDir }),
        /mikit\.syncSvn\.targets 必须是非空字符串数组/
      );
    } finally {
      cleanup(projectDir, [
        'package.json',
        'dist/css/style.css'
      ], [
        'dist/css',
        'dist',
        '.'
      ]);
    }
  });
}

function testValidatesAllTargetsBeforeCopying() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-svn-preflight-'));
  const validTarget = path.join(projectDir, 'svn-valid', 'css');
  const missingTarget = path.join(projectDir, 'svn-missing', 'css');
  mkdir(validTarget);

  try {
    writeConfig(projectDir, {
      source: 'dist/css',
      targets: [validTarget, missingTarget],
      files: ['*']
    });
    write(path.join(projectDir, 'dist', 'css', 'style.css'), '.style{}');

    assert.throws(
      () => syncCssToSvn({ projectDir }),
      new RegExp(`SVN CSS 目录不存在：${missingTarget.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`)
    );
    assert.equal(fs.existsSync(path.join(validTarget, 'style.css')), false);
  } finally {
    cleanup(projectDir, [
      'package.json',
      'dist/css/style.css'
    ], [
      'dist/css',
      'dist',
      'svn-valid/css',
      'svn-valid',
      '.'
    ]);
  }
}

testSyncsToMultipleTargetsAndDeduplicates();
testSupportsLegacySingleTarget();
testRejectsTargetAndTargetsTogether();
testRejectsInvalidTargetsArrays();
testValidatesAllTargetsBeforeCopying();
