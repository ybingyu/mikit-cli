'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renderFontReport } = require('../lib/font-report');

function report(overrides = {}) {
  return {
    asciiBaseline: 'none',
    sources: { staticPages: ['index.html'], runtimePages: [] },
    risks: [], skipped: [], removedRemote: [], removedUnused: [],
    fonts: [{ family: '活动标题', font: 'title.ttf', manifest: 'title.txt',
      characters: 3, characterSources: { static: 2, runtime: 0, configured: 1 },
      sample: '甲乙丙', dynamicBinding: false, missingDigits: '0123456789',
      digitSuggestion: null, asciiBaseline: 'none', asciiBaselineSource: '全局配置',
      sourceBytes: 1024,
      formats: [{ format: 'ttf', file: '../dist/font/title.ttf', bytes: 256, originalBytes: 1024 }],
      verification: { requested: 3, supported: 3, sourceMissing: [], outputs: [{ format: 'ttf', characters: 3 }] } }],
    ...overrides,
  };
}

test('Markdown report leads with outcome and readable per-font counts and file links', () => {
  const markdown = renderFontReport(report());
  assert.ok(markdown.startsWith('# 字体精简报告\n'));
  assert.match(markdown, /生成 1 个字体、1 个文件，总计 256 B/);
  assert.match(markdown, /字体文件验证通过/);
  assert.doesNotMatch(markdown, /## 待处理事项/);
  assert.match(markdown, /\| 活动标题 \| 3 \| \[256 B\]/);
  assert.ok(markdown.includes('[title.txt](./title.txt)'));
  assert.ok(markdown.includes('[256 B](../dist/font/title.ttf)'));
  assert.doesNotMatch(markdown, /75\.0%|字符预览|### 1\./);
  assert.doesNotMatch(markdown, /0123456789/);
  assert.match(markdown, /运行时页面：未配置/);
  assert.doesNotMatch(markdown, /digitSuggestion|sourceMissing|.mikit-font-stage-/);
});

test('source missing glyphs and dynamic risks are distinct from uncollected digits', () => {
  const data = report({ risks: ['index.html: counter（字体：活动标题）无法确定'] });
  Object.assign(data.fonts[0], { dynamicBinding: true, missingDigits: '03456789', digitSuggestion: '请确认运行时数字，再配置 familyExtraText。' });
  data.fonts[0].verification.sourceMissing = [9731];
  data.fonts[0].verification.supported = 2;
  const markdown = renderFontReport(data);
  assert.match(markdown, /3 项待处理或确认/);
  assert.match(markdown, /源字体缺字[\s\S]*☃[\s\S]*U\+2603/);
  assert.match(markdown, /动态文字风险[\s\S]*counter/);
  assert.match(markdown, /数字覆盖待确认[\s\S]*03456789/);
  assert.match(markdown, /尚未采集的数字不等于源字体缺字/);
  assert.match(markdown, /familyExtraText/);
});

test('verification omitted by an injected runner is never reported as passing', () => {
  const data = report();
  data.fonts[0].verification = { status: 'not-run' };
  const markdown = renderFontReport(data);
  assert.match(markdown, /1 个字体未执行验证/);
  assert.match(markdown, /未执行/);
  assert.doesNotMatch(markdown, /字体文件验证通过|源字体未发现缺字/);
});

test('Markdown escapes font names, risk expressions, samples and link paths', () => {
  const data = report({ risks: ['<img src=x> | **warning**\n# heading'] });
  data.fonts[0].family = 'A|B<script>_title_';
  data.fonts[0].sample = '<b>甲</b> | [link](evil)';
  data.fonts[0].manifest = '子目录/a # (b).txt';
  const markdown = renderFontReport(data);
  assert.ok(markdown.includes('A&#124;B&lt;script&gt;&#95;title&#95;'));
  assert.ok(markdown.includes('./%E5%AD%90%E7%9B%AE%E5%BD%95/a%20%23%20%28b%29.txt'));
  assert.doesNotMatch(markdown, /<script>|<img|<b>|\*\*warning\*\*|\n# heading/);
});

test('effective ASCII policies, uncertain runtime coverage and skipped fonts stay visible', () => {
  const data = report({ skipped: ['unused.ttf'], removedRemote: ['remote.woff'], removedUnused: ['unused.ttf'] });
  data.fonts[0].asciiBaseline = 'common';
  data.fonts[0].asciiBaselineSource = '字体族配置';
  data.fonts[0].missingDigits = '';
  const markdown = renderFontReport(data);
  assert.match(markdown, /common（字体族配置）/);
  assert.ok(markdown.indexOf('common（字体族配置）') > markdown.indexOf('<summary>采集详情</summary>'));
  assert.match(markdown, /未配置/);
  assert.match(markdown, /接口返回、用户输入/);
  assert.match(markdown, /未采集到字符[\s\S]*unused.ttf/);
  assert.match(markdown, /remote.woff/);
  assert.doesNotMatch(markdown, /尚未采集的数字：无/);
  assert.ok(markdown.indexOf('unused.ttf') > markdown.indexOf('<summary>跳过与清理名单</summary>'));
});

test('report displays final sizes without comparing against previous subsets', () => {
  const data = report();
  data.fonts[0].formats.push({ format: 'woff2', file: '../dist/font/title.woff2', bytes: 96, originalBytes: null });
  const markdown = renderFontReport(data);
  assert.doesNotMatch(markdown, /原文件不存在|无法比较|减少比例|75\.0%/);
  assert.doesNotMatch(markdown, /NaN|Infinity|undefined/);
  assert.match(markdown, /352 B/);
  assert.match(markdown, /\| \[256 B\].* \| — \| \[96 B\]/);
});

test('contextual dynamic risks are displayed in a table without losing pipe expressions', () => {
  const markdown = renderFontReport(report({ risks: ['index.html | 表达式 nav | filter | 字体 活动标题: 自定义过滤器无法确定'] }));
  assert.ok(markdown.includes('| 页面 | 字体族 | 表达式 / 依赖 | 待确认问题 |'));
  assert.ok(markdown.includes('| index.html | 活动标题 | nav &#124; filter | 自定义过滤器无法确定 |'));
});

test('cross-drive output paths remain readable without creating invalid relative links', () => {
  const data = report();
  data.fonts[0].formats[0].file = 'F:\\dist\\font\\title.ttf';
  const markdown = renderFontReport(data);
  assert.ok(markdown.includes('F:/dist/font/title.ttf（请按绝对路径打开）'));
  assert.doesNotMatch(markdown, /\.\/F%3A/);
});


test('multiple dynamic fonts share one digit remedy and preserve each missing digit list', () => {
  const data = report();
  data.fonts[0].dynamicBinding = true;
  data.fonts[0].missingDigits = '37';
  data.fonts[0].digitSuggestion = 'old verbose suggestion';
  data.fonts.push({ ...data.fonts[0], family: '正文', missingDigits: '89' });
  const markdown = renderFontReport(data);
  assert.ok(markdown.includes('| 活动标题 | 37 |'));
  assert.ok(markdown.includes('| 正文 | 89 |'));
  assert.equal((markdown.match(/familyExtraText/g) || []).length, 1);
  assert.doesNotMatch(markdown, /old verbose suggestion/);
});

test('scan details retain runtime URLs and font character sources inside a closed fold', () => {
  const markdown = renderFontReport(report({ sources: {
    staticPages: ['index.shtml', 'nested/activity.shtml'], runtimePages: ['/index.shtml?o=1&x=2'],
  } }));
  const details = markdown.slice(markdown.indexOf('<details>'));
  assert.match(details, /index.shtml\?o=1&amp;x=2/);
  assert.ok(details.includes('nested/activity.shtml'));
  assert.ok(details.includes('| 活动标题 | 2 | 0 | 1 | none（全局配置） | 否 |'));
  assert.doesNotMatch(markdown, /<details open/);
  assert.match(markdown, /扫描：2 个静态页面、1 个动态页面/);
});

test('unverified fonts remain explicit when source gaps also exist', () => {
  const data = report();
  data.fonts[0].verification.sourceMissing = [9731];
  data.fonts.push({ ...data.fonts[0], family: '正文', verification: { status: 'not-run' } });
  const markdown = renderFontReport(data);
  assert.match(markdown, /1 个字体未执行验证/);
  assert.match(markdown, /源字体缺字/);
  assert.match(markdown, /未执行字体验证[\s\S]*正文/);
  assert.doesNotMatch(markdown, /字体文件验证通过/);
});
