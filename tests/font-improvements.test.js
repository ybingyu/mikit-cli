'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { subsetFonts, collectFontCharacters } = require('../lib/font-subsetter');
const { validateFontRuntimeConfig } = require('../lib/font-runtime-config');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist', 'font'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span class="a">甲</span><span class="b">乙</span>');
  fs.writeFileSync(path.join(root, 'dist', 'style.css'), '@font-face{font-family:A;src:url(font/a.ttf)} @font-face{font-family:B;src:url(font/b.ttf)} .a{font-family:A}.b{font-family:B}');
  for (const name of ['a', 'b']) fs.writeFileSync(path.join(root, 'dist', 'font', `${name}.ttf`), `original-${name}`);
  return root;
}

test('subsets stylesheet and inline font shorthand and publishes exact character reports', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'style.css'),
    '@font-face{font-family:A;src:url(font/a.ttf)}' +
    '@font-face{font-family:B;src:url(font/b.ttf)}' +
    '.a{font:400 clamp(14px,1.35vw,20px)/1.5 A,sans-serif}');
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<span class="a">甲</span><span style="font:400 .65em/1 B,sans-serif">12</span>');
  const result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  assert.equal(result.processed.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8'), '甲');
  assert.equal(fs.readFileSync(path.join(root, 'font', 'b.txt'), 'utf8'), '12');
  for (const name of ['a', 'b']) {
    assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', name + '.ttf'), 'utf8'), 'subset');
  }
  const report = JSON.parse(fs.readFileSync(result.report, 'utf8'));
  assert.equal(report.asciiBaseline, 'none');
  assert.deepEqual(report.fonts.map((font) => [font.family, font.characters]), [['A', 1], ['B', 2]]);
  assert.equal(report.fonts.find((font) => font.family === 'B').missingDigits, '03456789');
});

test('a later subset failure leaves every original font and manifest untouched', (t) => {
  const root = fixture(t);
  const manifest = path.join(root, 'font');
  fs.mkdirSync(manifest);
  fs.writeFileSync(path.join(manifest, 'a.txt'), 'old-manifest');
  let count = 0;
  assert.throws(() => subsetFonts({ projectDir: root, commandRunner(_command, args) {
    count += 1;
    const output = args.find((arg) => arg.startsWith('--output-file=')).slice(14);
    fs.writeFileSync(output, 'subset');
    return { status: count === 2 ? 1 : 0 };
  } }), /生成.*失败/);
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'a.ttf'), 'utf8'), 'original-a');
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'b.ttf'), 'utf8'), 'original-b');
  assert.equal(fs.readFileSync(path.join(manifest, 'a.txt'), 'utf8'), 'old-manifest');
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist', 'font')).sort(), ['a.ttf', 'b.ttf']);
});

test('font config preserves no-baseline defaults and accepts per-family extra text', () => {
  const config = validateFontRuntimeConfig({ familyExtraText: { A: '丙' }, dynamicTextPolicy: 'warn' });
  assert.equal(config.asciiBaseline, 'none');
  assert.equal(config.familyExtraText.A, '丙');
  assert.equal(config.dynamicTextPolicy, 'warn');
  assert.throws(() => validateFontRuntimeConfig({ familyExtraText: { A: 2 } }), /familyExtraText/);
});

test('resolves visible Vue binding branches into the element font without leaking technical strings', () => {
  const result = collectFontCharacters({
    htmlContents: [`<div class="a"><b v-for="item in items">{{item.name}}</b><span>{{status ? '抢购' : '售罄'}}</span><i v-html="markup"></i><em>{{rewards[user.type].name}}</em></div>
      <script>new Vue({data(){return {items:[{name:'王者'},{name:'勇士'}],markup:'<b>额外</b>',rewards:{one:{name:'礼包'},two:{name:'宝箱'}},user:{type:'one'}}}})</script>`],
    cssFiles: [{ content: '.a{font-family:A}' }],
    fontFamilies: new Set(['A']),
  });
  for (const char of '王者勇士抢购售罄额外礼包宝箱') assert.ok(result.A.includes(char), char);
  assert.equal(result.A.includes('one'), false);
});

test('per-family extra text and baseline are independent and default none adds no digits', (t) => {
  const root = fixture(t);
  const result = subsetFonts({ projectDir: root,
    runtimeConfig: validateFontRuntimeConfig({ familyExtraText: { A: '丙' }, familyOptions: { B: { asciiBaseline: 'common' } } }),
    commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    },
  });
  assert.equal(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8'), '甲丙');
  assert.match(fs.readFileSync(path.join(root, 'font', 'b.txt'), 'utf8'), /0123456789/);
  assert.equal(result.processed.length, 2);
});

test('verification failure rolls back the entire font batch', (t) => {
  const root = fixture(t);
  assert.throws(() => subsetFonts({ projectDir: root,
    verifier() { throw new Error('cmap mismatch'); },
    commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    },
  }), /cmap mismatch/);
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'a.ttf'), 'utf8'), 'original-a');
  assert.equal(fs.existsSync(path.join(root, 'font')), false);
});

test('static JS source from built script adds visible text and leaves unknown bindings as risks', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), `<div class="a">{{item.name}}{{apiText}}</div><script src="./app.js"></script>`);
  fs.writeFileSync(path.join(root, 'dist', 'app.js'), `new Vue({data(){return {item:{name:'静态文案'}}}})`);
  const result = subsetFonts({ projectDir: root,
    commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    },
  });
  assert.match(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8'), /静态文案/);
  assert.match(result.risks.join(','), /apiText/);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'font', 'font-report.json'), 'utf8'));
  const font = report.fonts.find((entry) => entry.family === 'A');
  assert.equal(font.dynamicBinding, true);
  assert.equal(font.missingDigits, '0123456789');
  assert.match(font.digitSuggestion, /familyExtraText/);
  assert.equal(/[0-9]/.test(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8')), false);
});


test('writes an auditable per-font report and character source counts', (t) => {
  const root = fixture(t);
  const result = subsetFonts({ projectDir: root,
    runtimeConfig: validateFontRuntimeConfig({ globalExtraText: '丙' }),
    commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    },
  });
  const report = JSON.parse(fs.readFileSync(path.join(root, 'font', 'font-report.json'), 'utf8'));
  assert.equal(report.version, 1);
  assert.deepEqual(report.sources.staticPages, ['index.html']);
  assert.deepEqual(report.fonts.map((font) => font.family).sort(), ['A', 'B']);
  assert.deepEqual(report.fonts[0].characterSources, { static: 1, runtime: 0, configured: 1 });
  assert.equal(report.fonts[0].verification.status, 'not-run');
  assert.equal(result.manifests.length, 2);
});

test('dynamic text error policy refuses any publication and unsafe manifest roots', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span class="a">{{remoteValue}}</span>');
  assert.throws(() => subsetFonts({ projectDir: root,
    runtimeConfig: validateFontRuntimeConfig({ dynamicTextPolicy: 'error' }),
    commandRunner() { throw new Error('should not subset'); },
  }), /动态展示文字/);
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'a.ttf'), 'utf8'), 'original-a');
  assert.equal(fs.existsSync(path.join(root, 'font')), false);
  assert.throws(() => subsetFonts({ projectDir: root, manifestDir: root }), /不能重叠/);
  assert.throws(() => subsetFonts({ projectDir: root, manifestDir: path.join(root, 'dist') }), /不能重叠/);
});

test('real font subset passes FontTools verification and records missing glyphs', { skip: !fs.existsSync('C:\\Windows\\Fonts\\arial.ttf') }, (t) => {
  const root = fixture(t);
  const source = 'C:\\Windows\\Fonts\\arial.ttf';
  const { spawnSync } = require('node:child_process');
  if (spawnSync('pyftsubset', ['--help'], { windowsHide: true }).error) t.skip('pyftsubset unavailable');
  fs.copyFileSync(source, path.join(root, 'dist', 'font', 'a.ttf'));
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span class="a">AB☃</span>');
  fs.writeFileSync(path.join(root, 'dist', 'style.css'), '@font-face{font-family:A;src:url(font/a.ttf)} .a{font-family:A}');
  const result = subsetFonts({ projectDir: root });
  assert.equal(result.verification.length, 1);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'font', 'font-report.json'), 'utf8'));
  assert.equal(report.fonts[0].verification.requested, 3);
  assert.deepEqual(report.fonts[0].verification.sourceMissing, [9731]);
  assert.ok(fs.statSync(path.join(root, 'dist', 'font', 'a.ttf')).size < fs.statSync(source).size);
});


test('failure publishing manifest restores previously published fonts and both old directories', (t) => {
  const root = fixture(t);
  const manifest = path.join(root, 'font');
  fs.mkdirSync(manifest);
  fs.writeFileSync(path.join(manifest, 'a.txt'), 'old');
  const originalRename = fs.renameSync;
  fs.renameSync = function (source, target) {
    if (source.includes('.mikit-font-stage-') && target === manifest) {
      throw new Error('simulated manifest publish failure');
    }
    return originalRename(source, target);
  };
  try {
    assert.throws(() => subsetFonts({ projectDir: root, commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    } }), /simulated manifest publish failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'a.ttf'), 'utf8'), 'original-a');
  assert.equal(fs.readFileSync(path.join(manifest, 'a.txt'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(manifest, 'font-report.json')), false);
});


test('v-for aliases pass into descendants even when only children use the target font', () => {
  const result = collectFontCharacters({
    htmlContents: [`<div v-for="item in items"><span class="a">{{item.name}}</span></div>
      <script>new Vue({data(){return {items:[{name:'后代文字'}]}}})</script>`],
    cssFiles: [{ content: '.a{font-family:A}' }],
    fontFamilies: new Set(['A']),
  });
  assert.match(result.A, /后代文字/);
});

test('reports uncollected digits for a dynamic font family without adding a baseline', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<span class="a">甲{{counter}}</span><span class="b">乙</span><script>new Vue({data:{counter:12}})</script>');
  subsetFonts({ projectDir: root, commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const report = JSON.parse(fs.readFileSync(path.join(root, 'font', 'font-report.json'), 'utf8'));
  const a = report.fonts.find((font) => font.family === 'A');
  const b = report.fonts.find((font) => font.family === 'B');
  assert.equal(a.dynamicBinding, true);
  assert.equal(a.missingDigits, '03456789');
  assert.match(a.digitSuggestion, /familyExtraText.*familyOptions.*common/);
  assert.equal(b.dynamicBinding, false);
  assert.equal(b.missingDigits, '0123456789');
  assert.equal(b.digitSuggestion, null);
  assert.deepEqual(new Set(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8')), new Set('甲12'));
  assert.equal(fs.readFileSync(path.join(root, 'font', 'b.txt'), 'utf8'), '乙');
});

test('explicit common baseline clears the missing-digit suggestion', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<span class="a">甲{{counter}}</span><span class="b">乙</span><script>new Vue({data:{counter:12}})</script>');
  subsetFonts({ projectDir: root, runtimeConfig: validateFontRuntimeConfig({
    familyOptions: { A: { asciiBaseline: 'common' } },
  }), commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const report = JSON.parse(fs.readFileSync(path.join(root, 'font', 'font-report.json'), 'utf8'));
  const a = report.fonts.find((font) => font.family === 'A');
  assert.equal(a.dynamicBinding, true);
  assert.equal(a.missingDigits, '');
  assert.equal(a.digitSuggestion, null);
  for (const digit of '0123456789') assert.ok(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8').includes(digit));
});

test('points users to the published font report only when one exists', (t) => {
  const root = fixture(t);
  const messages = [];
  const originalLog = console.log;
  console.log = (...args) => messages.push(args.join(' '));
  let result;
  try {
    result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    } });
  } finally {
    console.log = originalLog;
  }
  const reportPath = path.join(root, 'font', 'font-report.json');
  assert.equal(result.report, reportPath);
  assert.equal(fs.existsSync(reportPath), true);
  assert.equal(messages.filter((message) => message.includes('请查看字体报告')).length, 1);
  assert.match(messages.join('\n'), /\[mikit font\].*请查看字体报告/);
  assert.ok(messages.some((message) => message.includes(reportPath) && message.includes('尚未收集的数字')));

  const emptyRoot = fixture(t);
  fs.writeFileSync(path.join(emptyRoot, 'dist', 'style.css'), '.a{font-family:A}');
  const emptyMessages = [];
  console.log = (...args) => emptyMessages.push(args.join(' '));
  let emptyResult;
  try {
    emptyResult = subsetFonts({ projectDir: emptyRoot });
  } finally {
    console.log = originalLog;
  }
  assert.equal(emptyResult.report, null);
  assert.equal(emptyMessages.some((message) => message.includes('请查看字体报告')), false);
});
