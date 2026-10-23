'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { subsetFonts, collectFontCharacters } = require('../lib/font-subsetter');
const { validateFontRuntimeConfig } = require('../lib/font-runtime-config');

function fontDetails(report, family) {
  return report.split('<summary>采集详情</summary>')[1].split('\n')
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
  const result = subsetFonts({ projectDir: root,
    commandRunner(_command, args) {
      fs.writeFileSync(args.find((arg) => arg.startsWith('--output-file=')).slice(14), 'subset');
      return { status: 0 };
    },
  });
  assert.match(fs.readFileSync(path.join(root, 'font', 'a.txt'), 'utf8'), /静态文案/);
  assert.match(result.risks.join(','), /apiText/);
  const report = fs.readFileSync(path.join(root, 'font', 'font-report.md'), 'utf8');
  assert.match(fontDetails(report, 'A'), /\| 是 \|$/);
  assert.ok(report.includes('| A | 0123456789 |'));
  assert.match(report, /familyExtraText/);
  assert.match(report, /动态文字风险[\s\S]*apiText/);
  assert.ok(report.includes('| index.html | A | apiText |'));
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
  assert.match(report, /familyExtraText.*familyOptions.*common/);
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
