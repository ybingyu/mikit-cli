'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { subsetFonts, collectFontCharacters } = require('../lib/font-subsetter');
const { validateFontRuntimeConfig } = require('../lib/font-runtime-config');

function fontDetails(report, family) {
  return report.split('## 采集详情\n')[1].split('\n')
    .find((line) => line.startsWith('| ' + family + ' |'));
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist', 'font'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span class="a">甲</span><span class="b">乙</span>');
  fs.writeFileSync(path.join(root, 'dist', 'style.css'), '@font-face{font-family:A;src:url(font/a.ttf)} @font-face{font-family:B;src:url(font/b.ttf)} .a{font-family:A}.b{font-family:B}');
  for (const name of ['a', 'b']) fs.writeFileSync(path.join(root, 'dist', 'font', `${name}.ttf`), `original-${name}`);
  fs.cpSync(path.join(root, 'dist', 'font'), path.join(root, 'wwwroot', 'font'), { recursive: true });
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
  const report = fs.readFileSync(result.report, 'utf8');
  assert.match(fontDetails(report, 'A'), /none（全局配置）/);
  assert.ok(report.includes('| A | 1 | 0 | 0 | none（全局配置） | 否 |'));
  assert.ok(report.includes('| B | 2 | 0 | 0 | none（全局配置） | 否 |'));
  assert.doesNotMatch(report, /数字覆盖待确认/);
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
  // A known object key selects one entry; only unknown keys expand all candidates.
  assert.equal(result.A.includes('宝'), false);
  assert.equal(result.A.includes('箱'), false);
  for (const char of '王者勇士抢购售罄额外礼包') assert.ok(result.A.includes(char), char);
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
  const warnings = [];
  const originalWarn = console.warn;
  let result;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    result = subsetFonts({ projectDir: root,
      commandRunner(_command, args) {
        fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
        return { status: 0 };
      },
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, []);
  assert.match(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8'), /静态文案/);
  assert.match(result.risks.join(','), /apiText/);
  const report = fs.readFileSync(path.join(root, 'font', 'font-report.md'), 'utf8');
  assert.match(fontDetails(report, 'A'), /\| 是 \|$/);
  assert.ok(report.includes('| A | 0123456789 |'));
  assert.match(report, /familyExtraText/);
  assert.match(report, /动态文字风险[\s\S]*apiText/);
  assert.ok(report.includes('| index.html | div.a | A | apiText |'));
  assert.equal(report.includes(root), false);
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
  const report = fs.readFileSync(path.join(root, 'font', 'font-report.md'), 'utf8');
  assert.ok(report.startsWith('# 字体精简报告\n'));
  assert.match(report, /静态页面[\s\S]*index.html/);
  assert.ok(report.includes('| A | 1 | 0 | 1 | none（全局配置） | 否 |'));
  assert.ok(report.includes('| B | 1 | 0 | 1 | none（全局配置） | 否 |'));
  assert.match(report, /字体文件|未执行字体验证/);
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
  fs.copyFileSync(source, path.join(root, 'wwwroot', 'font', 'a.ttf'));
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span class="a">AB☃</span>');
  fs.writeFileSync(path.join(root, 'dist', 'style.css'), '@font-face{font-family:A;src:url(font/a.ttf)} .a{font-family:A}');
  const result = subsetFonts({ projectDir: root });
  assert.equal(result.verification.length, 1);
  const report = fs.readFileSync(path.join(root, 'font', 'font-report.md'), 'utf8');
  assert.match(report, /A：[\s\S]*请求 3 个字符/);
  assert.match(report, /☃（U\+2603）/);
  assert.match(report, /源字体支持 2 个/);
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
  assert.equal(fs.existsSync(path.join(manifest, 'font-report.md')), false);
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

for (const [name, binding] of [
  ['v-html', '<span class="a" v-html="nav"></span>'],
  ['v-text', '<span class="a" v-text="nav"></span>'],
  ['interpolation', '<span class="a">{{nav}}</span>'],
  ['bound title', '<span class="a" :title="nav"></span>'],
  ['template literal', '<span class="a">{{`标签${nav}`}}</span>'],
  ['concatenation', '<span class="a">{{"标签" + nav}}</span>'],
]) {
  test('collects primitive v-for candidates through ' + name, () => {
    const risks = new Set();
    const result = collectFontCharacters({
      htmlContents: ['<div v-for="(nav, index) in navArr">' + binding + '</div>'],
      cssFiles: [{ content: '.a{font-family:A}' }],
      fontFamilies: new Set(['A']),
      scriptContents: ['new Vue({data:{navArr:["官网充值","积分兑好礼",0,42],unused:"不应收集"}})'],
      risks,
    });
    const expected = '官网充值积分兑好礼042' +
      (['template literal', 'concatenation'].includes(name) ? '标签' : '');
    assert.deepEqual(new Set(result.A), new Set(expected));
    assert.deepEqual([...risks], []);
  });
}

test('collects navigation HTML from a local script into the font manifest and report', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<div class="a"><a v-for="(nav, index) in navArr"><span v-html="nav"></span></a>' +
    '<span>收起导航</span></div><span class="b">乙</span><script src="nav.js?v=1"></script>');
  fs.writeFileSync(path.join(root, 'dist', 'nav.js'),
    'new Vue({data:{navArr:["官网充值","积分兑好礼","提取京东<b>E</b>卡","京东<b>E</b>卡提取步骤"],unused:"不应收集"}})');
  const result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const expected = new Set('官网充值积分兑好礼提取京东E卡步骤收起导航');
  assert.deepEqual(new Set(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8')), expected);
  assert.equal(fs.readFileSync(path.join(root, 'font', 'b.txt'), 'utf8'), '乙');
  const report = fs.readFileSync(result.report, 'utf8');
  assert.ok(report.includes('| A | ' + expected.size + ' | 0 | 0 | none（全局配置） | 是 |'));
  assert.match(fontDetails(report, 'A'), /\| 是 \|$/);
});

test('reports uncollected digits for a dynamic font family without adding a baseline', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<span class="a">甲{{counter}}</span><span class="b">乙</span><script>new Vue({data:{counter:12}})</script>');
  subsetFonts({ projectDir: root, commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const report = fs.readFileSync(path.join(root, 'font', 'font-report.md'), 'utf8');
  assert.match(fontDetails(report, 'A'), /\| 是 \|$/);
  assert.ok(report.includes('| A | 03456789 |'));
  const examples = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
    .map((match) => JSON.parse(match[1]));
  const extra = examples.find((example) => example.mikit.font.familyExtraText);
  assert.ok(extra, 'dynamic digit configuration example missing');
  assert.deepEqual(extra.mikit.font.familyExtraText, { A: '03456789' });
  assert.match(fontDetails(report, 'B'), /\| 否 \|$/);
  assert.ok(!report.includes('| B | 0123456789 |'));
  assert.equal(fs.readFileSync(path.join(root, 'font', 'b.txt'), 'utf8'), '乙');
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
  const report = fs.readFileSync(path.join(root, 'font', 'font-report.md'), 'utf8');
  assert.match(fontDetails(report, 'A'), /\| 是 \|$/);
  assert.doesNotMatch(report, /尚未采集的数字：无/);
  assert.match(fontDetails(report, 'A'), /common（字体族配置）/);
  assert.doesNotMatch(report, /### 数字覆盖待确认/);
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
  const reportPath = path.join(root, 'font', 'font-report.md');
  assert.equal(result.report, reportPath);
  assert.equal(fs.existsSync(reportPath), true);
  assert.equal(messages.filter((message) => message.includes('请查看字体报告')).length, 1);
  assert.match(messages.join('\n'), /\[mikit font\].*请查看字体报告/);
  assert.ok(messages.includes(`[mikit font] 请查看字体报告：${reportPath}`));

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

test('successful Markdown publication replaces stale JSON and preserves unrelated manifests', (t) => {
  const root = fixture(t);
  const manifest = path.join(root, 'font');
  fs.mkdirSync(manifest);
  fs.writeFileSync(path.join(manifest, 'font-report.json'), 'old-json');
  fs.writeFileSync(path.join(manifest, 'font-report.md'), 'old-markdown');
  fs.writeFileSync(path.join(manifest, 'notes.txt'), 'keep');
  const result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  assert.equal(result.report, path.join(manifest, 'font-report.md'));
  assert.match(fs.readFileSync(result.report, 'utf8'), /^# 字体精简报告/);
  assert.equal(fs.existsSync(path.join(manifest, 'font-report.json')), false);
  assert.equal(fs.readFileSync(path.join(manifest, 'notes.txt'), 'utf8'), 'keep');
});

for (const failure of ['subset', 'verification', 'publication']) {
  test(`failed ${failure} preserves both previously published report versions`, (t) => {
    const root = fixture(t);
    const manifest = path.join(root, 'font');
    fs.mkdirSync(manifest);
    for (const extension of ['json', 'md']) fs.writeFileSync(path.join(manifest, `font-report.${extension}`), `old-${extension}`);
    const rename = fs.renameSync;
    if (failure === 'publication') {
      fs.renameSync = function (source, target) {
        if (source.includes('.mikit-font-stage-') && target === manifest) throw new Error('publish failure');
        return rename(source, target);
      };
    }
    try {
      assert.throws(() => subsetFonts({ projectDir: root,
        verifier() {
          if (failure === 'verification') throw new Error('verify failure');
          return { requested: 1, supported: 1, sourceMissing: [], outputs: [] };
        },
        commandRunner(_command, args) {
          fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
          return { status: failure === 'subset' ? 1 : 0 };
        },
      }), /failure|失败/);
    } finally {
      fs.renameSync = rename;
    }
    for (const extension of ['json', 'md']) assert.equal(fs.readFileSync(path.join(manifest, `font-report.${extension}`), 'utf8'), `old-${extension}`);
    assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'a.ttf'), 'utf8'), 'original-a');
  });
}

for (const noFonts of ['no-local-font', 'no-characters']) {
  test(`${noFonts} removes stale reports of both formats without announcing a report`, (t) => {
    const root = fixture(t);
    const manifest = path.join(root, 'font');
    fs.mkdirSync(manifest);
    for (const extension of ['json', 'md']) fs.writeFileSync(path.join(manifest, `font-report.${extension}`), 'stale');
    if (noFonts === 'no-local-font') fs.writeFileSync(path.join(root, 'dist', 'style.css'), '.a{font-family:Arial}');
    else fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<div></div>');
    const result = subsetFonts({ projectDir: root, commandRunner() { throw new Error('no font should be processed'); } });
    assert.equal(result.report, null);
    for (const extension of ['json', 'md']) assert.equal(fs.existsSync(path.join(manifest, `font-report.${extension}`)), false);
  });
}

test('Markdown file links resolve from a nested manifest directory and show final sizes', (t) => {
  const root = fixture(t);
  const manifestDir = path.join(root, 'reports', 'fonts # (preview)');
  fs.writeFileSync(path.join(root, 'dist', 'style.css'),
    '@font-face{font-family:A;src:url(font/a.ttf),url(font/a.woff2)}.a{font-family:A}');
  const result = subsetFonts({ projectDir: root, manifestDir, commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'sub');
    return { status: 0 };
  } });
  const report = fs.readFileSync(result.report, 'utf8');
  assert.ok(report.includes('| A | 1 | [3 B](../../dist/font/a.ttf) | — | [3 B](../../dist/font/a.woff2) |'));
  assert.doesNotMatch(report, /原文件不存在|无法比较|70\.0%/);
  for (const match of report.matchAll(/\]\(([^)]+)\)/g)) {
    assert.ok(fs.existsSync(path.resolve(manifestDir, decodeURIComponent(match[1]))), match[1]);
    assert.doesNotMatch(match[1], /\.mikit-font-stage-/);
  }
});


test('preflights all source fonts before changing existing outputs or manifests', (t) => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'wwwroot', 'font', 'b.ttf'));
  fs.mkdirSync(path.join(root, 'font'));
  fs.writeFileSync(path.join(root, 'font', 'a.txt'), 'old manifest');
  assert.throws(() => subsetFonts({ projectDir: root,
    commandRunner() { assert.fail('must preflight all source fonts before subsetting'); },
  }), (error) => error.message.includes(path.join(root, 'wwwroot', 'font', 'b.ttf')));
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'a.ttf'), 'utf8'), 'original-a');
  assert.equal(fs.readFileSync(path.join(root, 'dist', 'font', 'b.ttf'), 'utf8'), 'original-b');
  assert.equal(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8'), 'old manifest');
  assert.equal(fs.readFileSync(path.join(root, 'wwwroot', 'font', 'a.ttf'), 'utf8'), 'original-a');
});

test('rejects output or manifest paths overlapping original fonts without changing originals', (t) => {
  const root = fixture(t);
  const sourceFontDir = path.join(root, 'wwwroot', 'font');
  for (const options of [
    { outputDir: 'wwwroot' },
    { manifestDir: sourceFontDir },
    { manifestDir: path.join(sourceFontDir, 'manifests') },
  ]) {
    assert.throws(() => subsetFonts({ projectDir: root, ...options }), /原字体目录.*重叠/);
    assert.equal(fs.readFileSync(path.join(sourceFontDir, 'a.ttf'), 'utf8'), 'original-a');
  }
});

// Regression coverage for per-weight/style font subsetting.
require('./font-faces.test');


test('report locates unresolved bindings and digit candidates at distinct template elements', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<div id="app" class="a"><span class="count">甲{{counter}}</span>' +
    '<span class="count">{{counter}}</span><em v-text="apiText"></em>' +
    '<input :placeholder="counter"><b v-for="n in [1,2]">{{n}}</b></div>' +
    '<span class="b">乙</span><script>new Vue({data:{counter:12}})</script>');
  const result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
    fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const report = fs.readFileSync(result.report, 'utf8');
  assert.ok(report.includes('| 页面 | 元素位置 | 字体族 | 表达式 / 依赖 | 待确认问题 |'));
  assert.match(report, /div&#35;app\.a &gt; em[\s\S]*apiText/);
  const digits = report.split('### 数字覆盖待确认')[1].split('### 动态字体配置示例')[0];
  assert.match(digits, /index.html/);
  assert.match(digits, /div&#35;app\.a &gt; span\.count:nth-of-type\(1\).*counter/);
  assert.match(digits, /div&#35;app\.a &gt; span\.count:nth-of-type\(2\).*counter/);
  assert.match(digits, /input.*counter/);
  assert.equal(digits.split(' &gt; b | n |').length - 1, 1, 'loop instances share a source location');
  assert.doesNotMatch(digits, /apiText|class="b"/);
  assert.doesNotMatch(report, /mikit-font-safe-|#root/);
  assert.deepEqual(new Set(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8')), new Set('甲12'));
});

test('dynamic injected markup and inherited loop text retain the originating binding location', () => {
  const dynamicSources = new Map();
  collectFontCharacters({
    htmlContents: ['<div class="a"><section v-html="markup"></section><p v-for="n in [1,2]"><b>9</b></p></div><script>new Vue({data:{markup:"<i>12</i>"}})</script>'],
    htmlPaths: ['index.shtml'], cssFiles: [{ content: '.a{font-family:A}' }],
    fontFamilies: new Set(['A']), dynamicSources,
  });
  const locations = [...dynamicSources.values()];
  assert.ok(locations.some((source) => source.family === 'A' && source.element === 'div.a > section' && source.expression === 'markup'));
  assert.ok(locations.some((source) => source.family === 'A' && source.element === 'div.a > p' && source.expression === 'n in [1,2]'));
});


test('wide templates do not repeatedly scan the same sibling arrays for element locations', () => {
  const count = 4000;
  const originalFilter = Array.prototype.filter;
  let scannedEntries = 0;
  let result;
  // Count scan work instead of relying on machine-dependent timing thresholds.
  try {
    Array.prototype.filter = function (...args) {
      if (this.length >= count) scannedEntries += this.length;
      return Reflect.apply(originalFilter, this, args);
    };
    result = collectFontCharacters({
      htmlContents: ['<div class="a">' + '<span>甲</span>'.repeat(count) + '</div>'],
      cssFiles: [{ content: '.a{font-family:A}' }], fontFamilies: new Set(['A']),
    });
  } finally {
    Array.prototype.filter = originalFilter;
  }
  assert.equal(result.A, '甲');
  assert.ok(scannedEntries <= count * 20,
    'sibling scan work must stay linear; scanned ' + scannedEntries + ' entries');
});

test('template traversal stops at its node limit with one warning and continues on the next page', () => {
  const risks = new Set();
  const result = collectFontCharacters({
    htmlContents: [
      '<div class="a">' + '<span>甲</span>'.repeat(10010) + '<b>{{apiText}}</b>尾</div><p class="a">丙</p>',
      '<div class="a">乙</div>',
    ],
    htmlPaths: ['wide.html', 'next.html'],
    cssFiles: [{ content: '.a{font-family:A}' }], fontFamilies: new Set(['A']), risks,
  });
  assert.equal(risks.size, 1, 'the node limit must produce only one summary warning per page');
  assert.match([...risks][0], /wide\.html.*模板展开超过节点上限 10000/);
  assert.equal(result.A, '甲乙', 'text and bindings after the limit must not be collected');
});

test('cached element positions count tags separately and stay local to each original parent', () => {
  const dynamicSources = new Map();
  collectFontCharacters({
    htmlContents: ['<div class="a"><section><span>{{counter}}</span> text <em>甲</em><span>{{counter}}</span></section>' +
      '<section><span v-for="n in [1,2]">{{counter}}</span><span>{{counter}}</span></section></div>' +
      '<script>new Vue({data:{counter:12}})</script>'],
    cssFiles: [{ content: '.a{font-family:A}' }], fontFamilies: new Set(['A']), dynamicSources,
  });
  const locations = [...dynamicSources.values()].filter((source) => source.expression === 'counter')
    .map((source) => source.element);
  assert.deepEqual(locations, [
    'div.a > section:nth-of-type(1) > span:nth-of-type(1)',
    'div.a > section:nth-of-type(1) > span:nth-of-type(2)',
    'div.a > section:nth-of-type(2) > span:nth-of-type(1)',
    'div.a > section:nth-of-type(2) > span:nth-of-type(2)',
  ]);
});


test('generated supplements can be replaced and removed without deleting manual or collected text', (t) => {
  const root = fixture(t);
  const manual = { A: '甲保a😀' };
  const run = (generated) => subsetFonts({ projectDir: root,
    runtimeConfig: validateFontRuntimeConfig({ globalExtraText: '全', familyExtraText: manual,
      ...(generated === undefined ? {} : { generatedFamilyExtraText: generated }) }),
    commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    },
  });
  const text = (name) => fs.readFileSync(path.join(root, 'font', name + '.txt'), 'utf8');
  const first = run({ A: 'abc😀', B: '乙Z' });
  assert.equal(text('a'), '甲全保a😀bc');
  assert.equal(text('b'), '乙全Z');
  assert.ok(fs.readFileSync(first.report, 'utf8').includes('| A | 1 | 0 | 6 |'));
  run({ A: '1723甲😀' });
  assert.equal(text('a'), '甲全保a😀1723');
  assert.equal(text('b'), '乙全');
  run({});
  const afterRemoval = text('a');
  assert.equal(afterRemoval, '甲全保a😀');
  run();
  assert.equal(text('a'), afterRemoval, 'omitting the new field preserves legacy output');
  assert.deepEqual(manual, { A: '甲保a😀' });
  assert.equal(fs.readFileSync(path.join(root, 'wwwroot', 'font', 'a.ttf'), 'utf8'), 'original-a');
});

test('font report uses actual runtime configuration and omits system-only risks', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<div style="font-family:Microsoft YaHei">{{systemText}}</div>' +
    '<span class="a">甲{{apiText}}</span><span class="b">乙</span>');
  const runtimeConfig = validateFontRuntimeConfig({
    pages: ['https://hdl.example.test/event.shtml?stage=final'],
    familyExtraText: { A: '前往参赛' }, generatedFamilyExtraText: { A: '倒计时' },
  });
  const result = subsetFonts({ projectDir: root, runtimeConfig, runtimeRunner: () => ({}),
    commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    },
  });
  const markdown = fs.readFileSync(result.report, 'utf8');
  assert.doesNotMatch(markdown, /Microsoft YaHei|systemText|index\.shtml\?o=/);
  assert.match(markdown, /apiText/);
  const examples = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]).mikit.font);
  assert.deepEqual(examples.find(config => config.pages).pages, runtimeConfig.pages);
  const supplements = examples.find(config => config.familyExtraText);
  assert.ok(supplements.familyExtraText.A.startsWith('前往参赛'));
  assert.deepEqual(supplements.generatedFamilyExtraText, { A: '倒计时' });
});
test('reports query-driven system text and local-font visibility without inventing URLs', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<link rel="stylesheet" href="style.css"><div id="app">' +
    '<span class="system" v-text="booked ? \'已预约\' : \'立即预约\'"></span>' +
    '<section v-show="activeDialog === \'rules\'"><b class="a">规则</b></section>' +
    '<b class="a">{{heat}}</b></div><script src="state.js"></script>');
  fs.appendFileSync(path.join(root, 'dist', 'style.css'), '.system{font-family:"Microsoft YaHei"}');
  fs.writeFileSync(path.join(root, 'dist', 'state.js'),
    'function preview(page){var search=window.location.search;' +
    'var bookedMatch=search.match(/(?:^|[?&])booked=(0|1)(?:&|$)/);' +
    'var dialogMatch=search.match(/(?:^|[?&])dialog=(login|rules)(?:&|$)/);' +
    'var heatMatch=search.match(/(?:^|[?&])heat=(\\d+)(?:&|$)/);' +
    'if(bookedMatch)page.booked=bookedMatch[1]==="1";' +
    'if(dialogMatch)page.activeDialog=dialogMatch[1];if(heatMatch)page.heat=Number(heatMatch[1]);}' +
    'new Vue({data:{booked:false,activeDialog:"",heat:0},mounted(){preview(this)}});');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ mikit: { font: { pages: ['http://example.test/?booked=0'] } } }));
  const result = subsetFonts({ projectDir: root, runtimeRunner() { return {}; }, commandRunner(_command, args) {
    fs.writeFileSync(args.find(arg => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const markdown = fs.readFileSync(result.report, 'utf8');
  assert.match(markdown, /## 页面状态参数/);
  const section = markdown.split('## 页面状态参数')[1].split('## 采集详情')[0];
  assert.match(section, /booked.*0、1.*系统字体.*无需补充字体采集/);
  assert.match(section, /dialog.*login、rules.*可能影响本地字体.*A/);
  assert.match(section, /heat.*数字.*范围未确定/);
  assert.match(section, /已配置取值：0；未显式配置取值：1/);
  assert.match(section, /activeDialog.*section/);
  assert.doesNotMatch(section, /http:\/\/example.test\/\?booked=1/);
});

const { analyzePageStateParameters } = require('../lib/font-state-parameters');
function analyzeState(content, options = {}) {
  return analyzePageStateParameters({ scripts: [{ content, filePath: 'js/state.js' }],
    page: 'index.html', localFamilies: ['A'], ...options });
}

test('state discovery follows URLSearchParams and URL aliases into template fields', () => {
  const records = analyzeState(
    'const params = new URLSearchParams(window.location.search);' +
    'const booked = params.get("booked"); if(booked === "1") {}' +
    'const url = new URL(location.href); const mode = url.searchParams.get("mode");' +
    'if(mode === "rules") {}', {
      bindings: [{ element: 'span', expression: 'booked', families: ['A'] },
        { element: 'section', expression: 'mode', families: ['KaiTi'] }],
      runtimePages: ['https://example.test/?booked=1'],
    });
  assert.equal(records.find(item => item.name === 'booked').impact, 'local');
  assert.deepEqual(records.find(item => item.name === 'booked').values, ['1']);
  assert.deepEqual(records.find(item => item.name === 'booked').configuredValues, ['1']);
  assert.equal(records.find(item => item.name === 'mode').impact, 'system');
});

test('state discovery excludes comments, static strings, shadowed globals and unrelated regular expressions', () => {
  const records = analyzeState(
    '// ?fake=0|1\n' +
    'const sample = "?example=0"; sample.match(/example=(0|1)/);' +
    'function f(window) { const p = new URLSearchParams(window.location.search); p.get("fake"); }' +
    'function g(URLSearchParams) { new URLSearchParams(location.search).get("fake2"); }' +
    'const p = new URLSearchParams(location.search); const orphan=p.get("real");');
  assert.deepEqual(records.map(item => item.name), ['real']);
  assert.equal(records[0].impact, 'unknown');
});

test('state analysis does not confuse member names with independent template identifiers', () => {
  const [record] = analyzeState('const params = new URLSearchParams(location.search); const booked=params.get("booked");', {
    bindings: [{ element: 'span', expression: 'other.booked', families: ['A'] }],
  });
  assert.equal(record.impact, 'unknown');
});

test('parameter extraction sources exclude unrelated later calls and do not execute source', () => {
  const [record] = analyzeState('const p = new URLSearchParams(location.search);\nconst heat = p.get("heat");\nNumber(heat);\nthrow new Error("must not run");');
  assert.deepEqual(record.sources, ['js/state.js:2']);
});

test('runtime parameter values from other pages are not counted as configured states', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<span class="a">甲</span><script>const params=new URLSearchParams(location.search); const booked=params.get("booked"); if(booked==="1") {}</script>');
  fs.writeFileSync(path.join(root, 'dist', 'other.html'), '<span>其他</span>');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ mikit: { font: { pages: ['http://example.test/other.html?booked=1'] } } }));
  const result = subsetFonts({ projectDir: root, runtimeRunner() { return {}; }, commandRunner(_command, args) {
    fs.writeFileSync(args.find(arg => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const markdown = fs.readFileSync(result.report, 'utf8');
  const section = markdown.split('## 页面状态参数')[1].split('## 采集详情')[0];
  assert.match(section, /未显式配置该参数；未显式配置取值：1/);
  assert.doesNotMatch(section, /已配置取值：1/);
});


test('state discovery inspects referenced local modules without unrelated script files', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'),
    '<span class="a" v-text="mode === \'rules\' ? \'规则\' : \'首页\'"></span>' +
    '<script type="module" src="entry.js"></script>');
  fs.writeFileSync(path.join(root, 'dist', 'entry.js'), 'import { mode } from "./state.js"; new Vue({data:{mode}});');
  fs.writeFileSync(path.join(root, 'dist', 'state.js'),
    'const params = new URLSearchParams(location.search); export const mode = params.get("dialog"); if(mode === "rules") {}');
  fs.writeFileSync(path.join(root, 'dist', 'unused.js'), 'new URLSearchParams(location.search).get("unused");');
  const result = subsetFonts({ projectDir: root, commandRunner(_command, args) {
    fs.writeFileSync(args.find(arg => arg.startsWith('--output-file=')).slice(14), 'subset');
    return { status: 0 };
  } });
  const markdown = fs.readFileSync(result.report, 'utf8');
  const section = markdown.split('## 页面状态参数')[1].split('## 采集详情')[0];
  assert.match(section, /dialog.*rules.*可能影响本地字体.*A/);
  assert.match(section, /state.js:1/);
  assert.doesNotMatch(section, /unused/);
});


test('state analysis reuses shared dependencies without exponential expansion', () => {
  const declarations = ['const params = new URLSearchParams(location.search);', 'let state0 = params.get("booked");'];
  for (let index = 1; index <= 24; index++) {
    declarations.push('let state' + index + ' = state' + (index - 1) + ' + state' + (index - 1) + ';');
  }
  declarations.push('if (state24 === "1") {}');
  const originalHas = Set.prototype.has;
  let operations = 0;
  let records;
  try {
    Set.prototype.has = function (value) {
      if (++operations > 50000) throw new Error('shared dependency analysis exceeded its work budget');
      return Reflect.apply(originalHas, this, [value]);
    };
    records = analyzeState(declarations.join('\n'), {
      bindings: [{ element: 'span', expression: 'state24', families: ['A'] }],
    });
  } finally {
    Set.prototype.has = originalHas;
  }
  assert.deepEqual(records.map(record => record.name), ['booked']);
  assert.equal(records[0].impact, 'local');
  assert.deepEqual(records[0].values, ['1']);
  assert.deepEqual(records[0].sources, ['js/state.js:2']);
});

test('state analysis propagates query provenance across cycles without contaminating unrelated variables', () => {
  const records = analyzeState('const params = new URLSearchParams(location.search);' +
    'let a = b; let b = a; b = params.get("booked"); if (a === "1") {}' +
    'let other = "unused"; if (other === "2") {}', {
    bindings: [{ element: 'span', expression: 'a', families: ['A'] }],
  });
  assert.deepEqual(records.map(record => record.name), ['booked']);
  assert.equal(records[0].impact, 'local');
  assert.deepEqual(records[0].values, ['1']);
  assert.ok(records[0].bindings.includes('a'));
  assert.equal(records[0].bindings.includes('other'), false);
});

test('all skipped fonts still publish unresolved dynamic text risks and announce a report', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span class="a">{{apiText}}</span>');
  const manifestDir = path.join(root, 'font');
  fs.mkdirSync(manifestDir);
  fs.writeFileSync(path.join(manifestDir, 'font-report.json'), 'stale');
  const messages = [];
  const originalLog = console.log;
  let result;
  try {
    console.log = (...args) => messages.push(args.join(' '));
    result = subsetFonts({ projectDir: root, commandRunner() { throw new Error('empty fonts must not be subset'); } });
  } finally {
    console.log = originalLog;
  }
  assert.equal(result.processed.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.report, path.join(manifestDir, 'font-report.md'));
  const report = fs.readFileSync(result.report, 'utf8');
  assert.match(report, /动态文字风险[\s\S]*apiText/);
  assert.match(report, /index.html.*span.a.*apiText/);
  assert.ok(messages.some(message => message.includes('请查看字体报告') && message.includes(result.report)));
  assert.match(messages.join('\n'), /1 项动态文字风险/);
  assert.doesNotMatch(messages.join('\n'), /apiText/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist', 'font')), []);
  assert.equal(fs.existsSync(path.join(manifestDir, 'font-report.json')), false);
});

test('risk summaries omit system-only risks when all fonts are skipped', (t) => {
  const root = fixture(t);
  const html = path.join(root, 'dist', 'index.html');
  fs.writeFileSync(html, '<span style="font-family:Microsoft YaHei">{{systemText}}</span>');
  const messages = [];
  const originalLog = console.log;
  try {
    console.log = (...args) => messages.push(args.join(' '));
    const run = () => subsetFonts({ projectDir: root, commandRunner() { throw new Error('empty fonts must not be subset'); } });
    const systemOnly = run();
    assert.equal(systemOnly.report, null);
    assert.doesNotMatch(messages.join('\n'), /动态文字风险|请查看字体报告/);
    messages.length = 0;
    fs.appendFileSync(html, '<span class="a">{{apiText}}</span>');
    const mixed = run();
    assert.ok(mixed.report);
    assert.match(messages.join('\n'), /1 项动态文字风险/);
    assert.doesNotMatch(fs.readFileSync(mixed.report, 'utf8'), /systemText|Microsoft YaHei/);
  } finally {
    console.log = originalLog;
  }
});
