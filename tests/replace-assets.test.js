'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { replaceAssets } = require('../lib/css-replacer');

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function configure(root, replace) {
  write(root, 'package.json', JSON.stringify({ mikit: { replace } }));
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function testDefaultCssOnly() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-replace-default-'));
  try {
    configure(root, { rules: [{ from: 'img/', to: 'assets/' }] });
    write(root, 'dist/style.css', 'img/a.png');
    write(root, 'dist/index.html', '<img src="img/a.png">');
    const summary = replaceAssets({ projectDir: root });
    assert.equal(summary.files, 1);
    assert.equal(summary.changed, 1);
    assert.equal(read(root, 'dist/style.css'), 'assets/a.png');
    assert.equal(read(root, 'dist/index.html'), '<img src="img/a.png">');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testExplicitTypesAndRuleScopes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-replace-scopes-'));
  try {
    configure(root, {
      root: 'dist',
      include: ['**/*.css', '**/*.html', '**/*.shtml', '**/*.js', '**/*.vue', 'css/*.css'],
      rules: [
        { include: ['**/*.css'], from: '../img/', to: 'https://css.example/' },
        { include: ['**/*.html', '**/*.shtml'], from: 'img/', to: 'https://page.example/' },
        { include: ['**/*.js'], from: '/api/', to: 'https://api.example/', env: 'production' },
        { include: ['**/*.vue'], from: 'img/', to: 'https://vue.example/' },
        { from: 'SHARED', to: 'done' },
        { disabled: true, from: 'done', to: 'disabled' }
      ]
    });
    write(root, 'dist/css/style.css', '../img/a.png SHARED');
    write(root, 'dist/index.html', '<img src="img/a.png"> SHARED');
    write(root, 'dist/part.shtml', '<img src="img/b.png"> SHARED');
    write(root, 'dist/js/app.js', '"/api/items"; "../img/a.png"; SHARED');
    write(root, 'dist/components/card.vue', '<img src="img/c.png"> SHARED');
    write(root, 'dist/notes.txt', 'SHARED img/a.png');

    const summary = replaceAssets({ projectDir: root, env: 'production' });
    assert.equal(summary.files, 5);
    assert.equal(summary.changed, 5);
    assert.equal(read(root, 'dist/css/style.css'), 'https://css.example/a.png done');
    assert.equal(read(root, 'dist/index.html'), '<img src="https://page.example/a.png"> done');
    assert.equal(read(root, 'dist/part.shtml'), '<img src="https://page.example/b.png"> done');
    assert.equal(read(root, 'dist/js/app.js'), '"https://api.example/items"; "../img/a.png"; done');
    assert.equal(read(root, 'dist/components/card.vue'), '<img src="https://vue.example/c.png"> done');
    assert.equal(read(root, 'dist/notes.txt'), 'SHARED img/a.png');
    assert.equal(replaceAssets({ projectDir: root, env: 'production' }).changed, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testRuleCannotExpandTopLevelScope() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-replace-intersection-'));
  try {
    configure(root, {
      include: ['**/*.css'],
      rules: [{ include: ['**/*.shtml'], from: 'img/', to: 'assets/' }]
    });
    write(root, 'dist/a.css', 'img/a.png');
    write(root, 'dist/a.shtml', 'img/a.png');
    assert.equal(replaceAssets({ projectDir: root }).changed, 0);
    assert.equal(read(root, 'dist/a.css'), 'img/a.png');
    assert.equal(read(root, 'dist/a.shtml'), 'img/a.png');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testWindowsCaseInsensitiveFileScopes() {
  if (process.platform !== 'win32') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-replace-case-'));
  try {
    configure(root, {
      include: ['**/*.css', 'css/style.css'],
      rules: [{ include: ['css/style.css'], from: '../img/', to: 'assets/' }]
    });
    write(root, 'dist/css/Style.css', '../img/a.png');

    const summary = replaceAssets({ projectDir: root });
    assert.equal(summary.files, 1);
    assert.equal(summary.changed, 1);
    assert.equal(read(root, 'dist/css/Style.css'), 'assets/a.png');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testInvalidSelectionDoesNotPartiallyWrite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-replace-invalid-'));
  try {
    configure(root, {
      include: ['**/*.css', '**/*.png'],
      rules: [{ from: 'img/', to: 'assets/' }]
    });
    write(root, 'dist/a.css', 'img/a.png');
    write(root, 'dist/z.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
    assert.throws(() => replaceAssets({ projectDir: root }), /替换文件不是有效的 UTF-8 文本.*z\.png/);
    assert.equal(read(root, 'dist/a.css'), 'img/a.png');

    configure(root, {
      include: ['**/*.css'],
      rules: [{ from: 'img/', to: 'assets/' }, { include: [], from: 'a', to: 'b' }]
    });
    assert.throws(() => replaceAssets({ projectDir: root }), /mikit\.replace\.rules\[\]\.include/);
    assert.equal(read(root, 'dist/a.css'), 'img/a.png');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testSelectionCannotEscapeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-replace-boundary-'));
  try {
    configure(root, {
      include: ['**/*.css', '../external/*.html'],
      rules: [{ from: 'img/', to: 'assets/' }]
    });
    write(root, 'dist/a.css', 'img/a.png');
    write(root, 'external/page.html', 'img/a.png');
    assert.throws(() => replaceAssets({ projectDir: root }), /mikit\.replace\.include 命中的文件超出替换目录/);
    assert.equal(read(root, 'dist/a.css'), 'img/a.png');
    assert.equal(read(root, 'external/page.html'), 'img/a.png');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testDefaultCssOnly();
testExplicitTypesAndRuleScopes();
testRuleCannotExpandTopLevelScope();
testWindowsCaseInsensitiveFileScopes();
testInvalidSelectionDoesNotPartiallyWrite();
testSelectionCannotEscapeRoot();
