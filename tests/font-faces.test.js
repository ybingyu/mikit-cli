'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { subsetFonts } = require('../lib/font-subsetter');

function fixture(t, html, rules = '', faces = [[100, 'normal'], [400, 'normal'], [500, 'normal'], [700, 'normal'], [400, 'italic']]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-faces-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['wwwroot/font', 'dist/font', 'font']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const css = faces.map(([weight, style]) => {
    const name = `${weight}-${style}`;
    fs.writeFileSync(path.join(root, 'wwwroot/font', name + '.ttf'), 'original-' + name);
    for (const extension of ['ttf', 'woff', 'woff2']) fs.writeFileSync(path.join(root, 'dist/font', name + '.' + extension), 'old');
    fs.writeFileSync(path.join(root, 'font', name + '.txt'), '过期');
    return `@font-face{font-family:Shared;font-weight:${weight};font-style:${style};src:url(font/${name}.ttf),url(font/${name}.woff),url(font/${name}.woff2)}`;
  }).join('');
  fs.writeFileSync(path.join(root, 'dist/style.css'), css + '.text{font-family:Shared}' + rules);
  fs.writeFileSync(path.join(root, 'dist/index.html'), html);
  return root;
}

function build(root, overrides = {}) {
  return subsetFonts({ projectDir: root, commandRunner(_command, args) {
    assert.match(fs.readFileSync(args[0], 'utf8'), /^original-/);
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  }, ...overrides });
}

function text(root, name) {
  const file = path.join(root, 'font', name + '.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('same-family faces receive only their own characters and unused weights are removed on repeated runs', (t) => {
  const root = fixture(t, '<div class="text">常<span style="font-weight:500">中</span><i>斜</i></div>');
  for (let run = 0; run < 2; run += 1) {
    const result = build(root);
    assert.equal(text(root, '400-normal'), '常');
    assert.equal(text(root, '500-normal'), '中');
    assert.equal(text(root, '400-italic'), '斜');
    assert.equal(text(root, '100-normal'), '');
    assert.equal(text(root, '700-normal'), '');
    assert.equal(result.processed.length, 3);
    for (const unused of ['100-normal', '700-normal']) {
      for (const extension of ['ttf', 'woff', 'woff2']) assert.equal(fs.existsSync(path.join(root, 'dist/font', unused + '.' + extension)), false);
      assert.equal(fs.readFileSync(path.join(root, 'wwwroot/font', unused + '.ttf'), 'utf8'), 'original-' + unused);
    }
    assert.match(fs.readFileSync(result.report, 'utf8'), /Shared.*400.*normal/);
    assert.match(fs.readFileSync(result.report, 'utf8'), /Shared.*500.*normal/);
  }
});

test('font weight cascade, shorthand reset, inheritance and relative weights route text correctly', (t) => {
  const root = fixture(t,
    '<div class="text heavy">甲<span>乙</span><span style="font:16px Shared">丙</span><span style="font-weight:lighter">丁</span><span class="forced" style="font-weight:100">戊</span></div>' +
    '<div class="text"><strong>己</strong><span style="font:italic 400 16px Shared">庚</span></div>',
    '.heavy{font-weight:bold}.forced{font-weight:500!important}');
  build(root);
  assert.equal(text(root, '700-normal'), '甲乙己');
  assert.equal(text(root, '400-normal'), '丙丁');
  assert.equal(text(root, '500-normal'), '戊');
  assert.equal(text(root, '400-italic'), '庚');
  assert.equal(text(root, '100-normal'), '');
});

test('missing weights use CSS matching order including the special 400 to 500 range', (t) => {
  const root = fixture(t, '<div class="text"><span style="font-weight:400">甲</span><span style="font-weight:450">乙</span><span style="font-weight:600">丙</span><span style="font-weight:200">丁</span></div>', '',
    [[300, 'normal'], [500, 'normal'], [700, 'normal']]);
  build(root);
  assert.equal(text(root, '500-normal'), '甲乙');
  assert.equal(text(root, '700-normal'), '丙');
  assert.equal(text(root, '300-normal'), '丁');
});

test('known Vue weight branches are separated while conditional and unresolved styles retain possible faces', (t) => {
  const root = fixture(t,
    '<div class="text"><span :style="{fontWeight: flag ? 400 : 500}">甲</span><span class="responsive">乙</span><span style="font-weight:var(--weight)">丙</span></div>',
    '@media(max-width:600px){.responsive{font-weight:700}}');
  build(root);
  assert.equal(text(root, '400-normal'), '甲乙丙');
  assert.equal(text(root, '500-normal'), '甲丙');
  assert.equal(text(root, '700-normal'), '乙丙');
  assert.equal(text(root, '100-normal'), '丙');
  assert.equal(text(root, '400-italic'), '');
});

test('page-local face availability controls weight fallback instead of another page stylesheet', (t) => {
  const root = fixture(t, '<!doctype html><link rel="stylesheet" href="regular.css"><div class="text" style="font-weight:700">甲</div>', '', [[400, 'normal'], [700, 'normal']]);
  fs.writeFileSync(path.join(root, 'dist/regular.css'), '@font-face{font-family:Shared;font-weight:400;src:url(font/400-normal.ttf)}.text{font-family:Shared}');
  fs.writeFileSync(path.join(root, 'dist/bold.css'), '@font-face{font-family:Shared;font-weight:700;src:url(font/700-normal.ttf)}.text{font-family:Shared}');
  fs.writeFileSync(path.join(root, 'dist/other.html'), '<!doctype html><link rel="stylesheet" href="bold.css"><div class="text">乙</div>');
  build(root, { fontPage: '*.html' });
  assert.equal(text(root, '400-normal'), '甲');
  assert.equal(text(root, '700-normal'), '乙');
});

test('heading default bold differs from relative strong when the parent is light', (t) => {
  const root = fixture(t, '<div class="text" style="font-weight:100"><h2>题</h2><strong>重</strong></div>');
  build(root);
  assert.equal(text(root, '700-normal'), '题');
  assert.equal(text(root, '400-normal'), '重');
});

test('runtime face characters and explicit family supplements merge without redistributing family totals', (t) => {
  const root = fixture(t, '<div class="text">静</div>');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ mikit: { font: {
    pages: ['https://font.example.test/demo'], familyExtraText: { Shared: '补' },
  } } }));
  build(root, { runtimeRunner(config) {
    assert.ok(config.fontFaces.some((face) => face.weight === '500'));
    return { Shared: '动', '\u0000face:100-normal': '', '\u0000face:400-normal': '',
      '\u0000face:500-normal': '动', '\u0000face:700-normal': '', '\u0000face:400-italic': '' };
  } });
  assert.equal(text(root, '400-normal'), '静补');
  assert.equal(text(root, '500-normal'), '动补');
  assert.equal(text(root, '100-normal'), '补');
});

test('variable weight ranges and synthetic italic fallback retain the appropriate original', (t) => {
  const root = fixture(t, '<div class="text" style="font-weight:650;font-style:italic">变</div>', '', [['100 900', 'normal']]);
  build(root);
  assert.equal(text(root, '100 900-normal'), '变');
});

test('unresolved whole Vue style keeps possible weights and styles instead of dropping them', (t) => {
  const root = fixture(t, '<div class="text" :style="remoteStyle">待</div>');
  build(root);
  for (const name of ['100-normal', '400-normal', '500-normal', '700-normal', '400-italic']) assert.equal(text(root, name), '待');
});

test('unresolved whole Vue class conservatively keeps possible font weights and styles', (t) => {
  const root = fixture(t, '<div class="text" :class="remoteClass">待<span>继</span></div>');
  build(root);
  for (const name of ['100-normal', '400-normal', '500-normal', '700-normal', '400-italic']) assert.equal(text(root, name), '待继');
});
