'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectFontCharacters, subsetFonts } = require('../lib/font-subsetter');

function collect(css, html = '<div class="text">甲<span>乙</span></div>') {
  return collectFontCharacters({ htmlContents: [html], cssFiles: [{ content: css }],
    fontFamilies: new Set(['Desktop', 'Mobile', 'Special']) });
}

test('media queries keep base and conditional families, including inherited text', () => {
  const result = collect('.text{font-family:Desktop}@media(max-width:600px){.text{font-family:Mobile}}');
  assert.equal(result.Desktop, '甲乙');
  assert.equal(result.Mobile, '甲乙');
});

test('nested conditional rules and pseudo states retain all possible families', () => {
  const result = collect('.text{font-family:Desktop}@supports(display:grid){@media(max-width:600px){.text{font:16px Mobile}}}.text:hover{font-family:Special}');
  for (const family of ['Desktop', 'Mobile', 'Special']) assert.equal(result[family], '甲乙');
});

test('unconditional priority and inline declarations still override unreachable conditional rules', () => {
  const css = '.text{font-family:Desktop!important}@media(max-width:600px){.text{font-family:Mobile}}';
  assert.equal(collect(css).Mobile, '');
  const result = collect('.text{font-family:Desktop}@media(max-width:600px){.text{font-family:Mobile}}', '<div class="text" style="font-family:Special">甲</div>');
  assert.equal(result.Special, '甲');
  assert.equal(result.Desktop, '');
  assert.equal(result.Mobile, '');
});

test('child overrides do not leak into inherited conditional branches', () => {
  const result = collect('.text{font-family:Desktop}@media print{.text{font-family:Mobile}}span{font-family:Special}');
  assert.equal(result.Desktop, '甲');
  assert.equal(result.Mobile, '甲');
  assert.equal(result.Special, '乙');
});

test('font output retains fonts used by different display conditions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-conditional-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const dir of ['wwwroot/font', 'dist/font']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  let faces = '';
  for (const family of ['Desktop', 'Mobile']) {
    fs.writeFileSync(path.join(root, 'wwwroot/font', family + '.ttf'), 'original');
    fs.writeFileSync(path.join(root, 'dist/font', family + '.ttf'), 'old');
    faces += '@font-face{font-family:' + family + ';src:url(font/' + family + '.ttf)}';
  }
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<div class="text">甲乙</div>');
  fs.writeFileSync(path.join(root, 'dist/style.css'), faces + '.text{font-family:Desktop}@media(max-width:600px){.text{font-family:Mobile}}');
  for (let run = 0; run < 2; run += 1) {
    const result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
      fs.writeFileSync(args.find(arg => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    } });
    assert.equal(result.processed.length, 2);
    for (const family of ['Desktop', 'Mobile']) {
      assert.equal(fs.readFileSync(path.join(root, 'font', family + '.txt'), 'utf8'), '甲乙');
      assert.equal(fs.existsSync(path.join(root, 'dist/font', family + '.ttf')), true);
      assert.equal(fs.readFileSync(path.join(root, 'wwwroot/font', family + '.ttf'), 'utf8'), 'original');
    }
  }
});

test('root font variables resolve family lists and inherit into children', () => {
  const result = collect(':root{--heading:"Desktop",sans-serif;--number:Mobile}.text{font-family:var(--heading)}.number{font-family:var(--number)}',
    '<html><body><div class="text">甲<span>乙</span></div><div class="number">123</div></body></html>');
  assert.equal(result.Desktop, '甲乙');
  assert.equal(result.Mobile, '123');
});

test('font variables respect element scopes, inheritance, inline priority and fallbacks', () => {
  const css = ':root{--face:Desktop}.text{font-family:var(--face)}.local{--face:Mobile}.local{--face:Special!important}.fallback{font-family:var(--missing,var(--also-missing,Mobile))}';
  const result = collect(css, '<html><body><div class="text">甲<span class="local" style="--face:Mobile">乙</span><span style="--face:Mobile">丙</span></div><div class="fallback">丁</div></body></html>');
  assert.equal(result.Desktop, '甲乙丙'); // A child inherits the computed family, not its parent variable reference.
  assert.equal(result.Mobile, '丁');
  assert.equal(result.Special, '');
  const scoped = collect(css, '<html><body><div class="text local" style="--face:Mobile">乙</div><div class="text" style="--face:Mobile">丙</div></body></html>');
  assert.equal(scoped.Special, '乙');
  assert.equal(scoped.Mobile, '丙');
  assert.equal(scoped.Desktop, '');
});

test('font variables resolve aliases at the defining element and do not leak across pages', () => {
  const css = ':root{--base:Desktop;--face:var(--base)}.text{font-family:var(--face)}.local{--base:Mobile}';
  assert.equal(collect(css, '<html><body><div class="text local">甲</div></body></html>').Desktop, '甲');
  assert.equal(collect('.text{font-family:var(--face,Special)}').Special, '甲乙');
});

test('conditional variable definitions preserve base and alternate font families', () => {
  const result = collect(':root{--face:Desktop}@media print{:root{--face:Mobile}}.text{font-family:var(--face)}', '<html><body><div class="text">甲乙</div></body></html>');
  assert.equal(result.Desktop, '甲乙');
  assert.equal(result.Mobile, '甲乙');
});

test('cyclic font variables use fallbacks and quoted var text stays a literal', () => {
  const result = collect(':root{--one:var(--two);--two:var(--one)}.text{font-family:var(--one,Special)}', '<html><body><div class="text">甲<span>乙</span></div></body></html>');
  assert.equal(result.Special, '甲乙');
  assert.equal(collect('.text{font-family:"var(--missing)",Desktop}').Desktop, '');
});

test('variable based families produce font files and manifests instead of pruning used fonts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-variables-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['wwwroot/font', 'dist/font']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  let css = '';
  for (const family of ['Desktop', 'Mobile']) {
    fs.writeFileSync(path.join(root, 'wwwroot/font', family + '.ttf'), 'original');
    fs.writeFileSync(path.join(root, 'dist/font', family + '.ttf'), 'old');
    css += '@font-face{font-family:' + family + ';src:url(font/' + family + '.ttf),url(font/' + family + '.woff),url(font/' + family + '.woff2)}';
  }
  css += ':root{--heading:Desktop;--number:Mobile}.text{font-family:var(--heading)}.number{font-family:var(--number)}';
  fs.writeFileSync(path.join(root, 'dist/style.css'), css);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<html><head><link rel="stylesheet" href="style.css"></head><body><div class="text">甲乙</div><div class="number">123</div></body></html>');
  const result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
    assert.equal(fs.readFileSync(args[0], 'utf8'), 'original');
    fs.writeFileSync(args.find(arg => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  assert.equal(result.processed.length, 2);
  assert.equal(fs.readFileSync(path.join(root, 'font/Desktop.txt'), 'utf8'), '甲乙');
  assert.equal(fs.readFileSync(path.join(root, 'font/Mobile.txt'), 'utf8'), '123');
  for (const family of ['Desktop', 'Mobile']) {
    for (const extension of ['ttf', 'woff', 'woff2']) {
      assert.equal(fs.readFileSync(path.join(root, 'dist/font', family + '.' + extension), 'utf8'), 'subset');
    }
  }
});

test('cycles remain invalid even when a variable inside the cycle has a fallback', () => {
  const result = collect(':root{--one:var(--two,Desktop);--two:var(--one)}.text{font-family:var(--one,Special)}', '<html><body><div class="text">甲</div></body></html>');
  assert.equal(result.Special, '甲');
  assert.equal(result.Desktop, '');
});

test('a conditional variable cycle does not remove the valid base family', () => {
  const result = collect(':root{--face:Desktop}@media print{:root{--face:var(--face)}}.text{font-family:var(--face,Special)}', '<html><body><div class="text">甲</div></body></html>');
  assert.equal(result.Desktop, '甲');
  assert.equal(result.Special, '甲');
});
