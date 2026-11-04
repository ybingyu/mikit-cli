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
  assert.ok(markdown.indexOf('common（字体族配置）') > markdown.indexOf('## 采集详情\n'));
  assert.match(markdown, /未配置/);
  assert.match(markdown, /接口返回、用户输入/);
  assert.match(markdown, /未采集到字符[\s\S]*unused.ttf/);
  assert.match(markdown, /remote.woff/);
  assert.doesNotMatch(markdown, /尚未采集的数字：无/);
  assert.ok(markdown.indexOf('unused.ttf') > markdown.indexOf('## 跳过与清理名单\n'));
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

test('scan details use a plain Markdown heading and retain runtime URLs and font character sources', () => {
  const markdown = renderFontReport(report({ sources: {
    staticPages: ['index.shtml', 'nested/activity.shtml'], runtimePages: ['/index.shtml?o=1&x=2'],
  } }));
  assert.match(markdown, /\n## 采集详情\n\n\| 字体 \|/);
  const details = markdown.split('## 采集详情\n')[1];
  assert.match(details, /index.shtml\?o=1&amp;x=2/);
  assert.ok(details.includes('nested/activity.shtml'));
  assert.ok(details.includes('| 活动标题 | 2 | 0 | 1 | none（全局配置） | 否 |'));
  assert.doesNotMatch(markdown, /<\/?(?:details|summary)\b/i);
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

function configurationExamples(markdown) {
  return [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
}

test('dynamic risk without project configuration does not invent page addresses or text', () => {
  const markdown = renderFontReport(report({ risks: ['接口文案无法静态确定'] }));
  assert.deepEqual(configurationExamples(markdown), []);
  assert.doesNotMatch(markdown, /activity\.example|index\.shtml\?o=|替换为实际字体族名|动态字体配置示例/);
});

test('configuration examples reuse the current runtime pages and supplement fields', () => {
  const data = report({
    risks: ['index.html | 元素 span.title | 表达式 label | 字体 活动标题: 无法确定'],
    sources: { staticPages: ['index.html'], runtimePages: ['https://hdl.example.test/event.shtml?stage=final&Ticket=abc'] },
    fontConfig: {
      familyExtraText: { 活动标题: '前往参赛', 无关字体: '无关' },
      generatedFamilyExtraText: { 活动标题: '观赛倒计时' },
    },
  });
  const markdown = renderFontReport(data);
  const examples = configurationExamples(markdown);
  assert.deepEqual(examples.find(example => example.mikit.font.pages).mikit.font.pages, data.sources.runtimePages);
  const supplements = examples.find(example => example.mikit.font.familyExtraText).mikit.font;
  assert.deepEqual(supplements.familyExtraText, { 活动标题: '前往参赛' });
  assert.deepEqual(supplements.generatedFamilyExtraText, { 活动标题: '观赛倒计时' });
  assert.doesNotMatch(markdown, /index\.shtml\?o=|无关字体|替换为/);
  assert.match(markdown, /合并[\s\S]*保留/);
  assert.match(markdown, /mikit font/);
  assert.match(markdown, /当前[\s\S]*DOM/);
});

test('report suppresses risks for fonts outside local subsetting but keeps unknown dependencies', () => {
  const data = report({ risks: [
    'index.html | 元素 nav | 表达式 active | 字体 Microsoft YaHei: 不需要核对',
    'index.html | 元素 p | 表达式 msg | 字体 Arial, sans-serif: 不需要核对',
    'index.html | 元素 span | 表达式 title | 字体 活动标题, Microsoft YaHei: 需要核对',
    'index.html | 表达式 脚本/样式依赖 | 字体 未确定: 依赖缺失',
  ] });
  const markdown = renderFontReport(data);
  assert.doesNotMatch(markdown, /Microsoft YaHei|Arial|sans-serif|不需要核对/);
  assert.ok(markdown.includes('| index.html | span | 活动标题 | title | 需要核对 |'));
  assert.match(markdown, /依赖缺失/);
  assert.match(markdown, /2 项待处理或确认/);
  const systemOnly = renderFontReport(report({ risks: [data.risks[0]] }));
  assert.doesNotMatch(systemOnly, /待处理事项|动态文字风险|待处理或确认/);
});

test('local family membership keeps custom fonts with system-like names and skipped local families', () => {
  const data = report({ localFamilies: ['Microsoft YaHei', '未采集字体'], risks: [
    'index.html | 元素 p | 表达式 label | 字体 Microsoft YaHei: 本地字体仍需核对',
    'index.html | 元素 span | 表达式 label | 字体 未采集字体: 空字符本地字体仍需核对',
  ] });
  assert.match(renderFontReport(data), /本地字体仍需核对/);
  assert.match(renderFontReport(data), /空字符本地字体仍需核对/);
});

test('digit locations already listed as dynamic risks appear only once', () => {
  const data = report({ risks: [
    'index.html | 元素 span.count | 表达式 count | 字体 活动标题: 无法确定',
  ] });
  Object.assign(data.fonts[0], { dynamicBinding: true, missingDigits: '37', dynamicSources: [
    { page: 'index.html', element: 'span.count', expression: 'count' },
    { page: 'other.html', element: 'span.count', expression: 'count' },
  ] });
  const markdown = renderFontReport(data);
  assert.equal(markdown.split('index.html | span.count').length - 1, 1);
  assert.ok(markdown.includes('| 活动标题 | other.html | span.count | count |'));
  assert.ok(markdown.includes('| 活动标题 | 37 |'));
  assert.match(markdown, /动态文字风险[\s\S]*数字覆盖待确认/);
});

test('digit remedy uses actual family keys once across weights and never the display label', () => {
  const data = report();
  Object.assign(data.fonts[0], { dynamicBinding: true, missingDigits: '37', faceLabel: '活动标题 / 400 normal' });
  data.fonts.push({ ...data.fonts[0], faceLabel: '活动标题 / 700 normal', missingDigits: '89' });
  const markdown = renderFontReport(data);
  const examples = configurationExamples(markdown);
  assert.equal(examples.length, 1);
  assert.deepEqual(examples[0].mikit.font.familyExtraText, { 活动标题: '3789' });
  assert.match(markdown, /确认[\s\S]*数字/);
  assert.match(markdown, /同一字体族[\s\S]*字重/);
});

test('configuration examples preserve special family names without breaking Markdown or HTML', () => {
  const data = report();
  Object.assign(data.fonts[0], { family: 'A"\\B<script>```', dynamicBinding: true, missingDigits: '9' });
  const markdown = renderFontReport(data);
  const examples = configurationExamples(markdown);
  assert.equal(examples[0].mikit.font.familyExtraText[data.fonts[0].family], '9');
  assert.doesNotMatch(markdown, /<script>/);
  assert.equal(configurationExamples(renderFontReport(report())).length, 0);
});


test('element locations escape markup, preserve filter expressions and distinguish page dependencies', () => {
  const data = report({ risks: [
    'index.html | 元素 div#app > span.count | 表达式 nav | filter | 字体 活动标题: 无法确定',
    'index.html | 表达式 脚本/样式依赖 | 字体 未确定: 依赖缺失',
  ] });
  Object.assign(data.fonts[0], { dynamicBinding: true, dynamicSources: [
    { page: 'index.html', element: 'span[title="<img>"]', expression: 'count | filter' },
  ] });
  data.fonts.push({ ...data.fonts[0], faceLabel: '活动标题 / 700 normal' });
  const markdown = renderFontReport(data);
  assert.ok(markdown.includes('| index.html | div&#35;app &gt; span.count | 活动标题 | nav &#124; filter | 无法确定 |'));
  assert.ok(markdown.includes('| index.html | 页面依赖（无对应元素） | 未确定 |'));
  assert.equal(markdown.split('count &#124; filter').length - 1, 1);
  assert.doesNotMatch(markdown, /<img>/);
  assert.match(markdown, /&lt;img&gt;/);
});


test('skip and cleanup lists use plain Markdown without HTML folding tags', () => {
  const markdown = renderFontReport(report({
    skipped: ['unused.ttf'], removedRemote: ['remote.woff'], removedUnused: ['old.woff2'],
  }));
  assert.match(markdown, /\n## 跳过与清理名单\n\n- 未采集到字符/);
  const cleanup = markdown.split('## 跳过与清理名单\n')[1];
  assert.match(cleanup, /unused\.ttf/);
  assert.match(cleanup, /remote\.woff/);
  assert.match(cleanup, /old\.woff2/);
  assert.doesNotMatch(markdown, /<\/?(?:details|summary)\b/i);
});

test('digit configuration preserves existing manual and generated supplements', () => {
  const data = report({ fontConfig: {
    familyExtraText: { 活动标题: '奖池12' }, generatedFamilyExtraText: { 活动标题: '倒计时' },
  } });
  Object.assign(data.fonts[0], { dynamicBinding: true, missingDigits: '37' });
  const config = configurationExamples(renderFontReport(data))[0].mikit.font;
  assert.deepEqual(config.familyExtraText, { 活动标题: '奖池1237' });
  assert.deepEqual(config.generatedFamilyExtraText, { 活动标题: '倒计时' });
  assert.deepEqual(data.fontConfig.familyExtraText, { 活动标题: '奖池12' });
});

test('digit examples handle family names matching Object prototype properties', () => {
  for (const family of ['__proto__', 'constructor']) {
    const data = report();
    Object.assign(data.fonts[0], { family, dynamicBinding: true, missingDigits: '9' });
    const config = configurationExamples(renderFontReport(data))[0].mikit.font;
    assert.equal(config.familyExtraText[family], '9');
  }
});


test('state parameters are informative and safely rendered without declaring new missing glyphs', () => {
  const data = report({ stateParameters: [{ page: 'index.html', name: 'booked|<x>', values: ['0','1'], pattern: '',
    impact: 'system', bindings: ['booked'], locations: [{ element: 'span.button', expression: 'booked', families: ['Microsoft YaHei'] }],
    sources: ['js/main.js:5'], configuredValues: ['0'], unconfiguredValues: ['1'] }] });
  const markdown = renderFontReport(data);
  assert.match(markdown, /## 页面状态参数/);
  assert.match(markdown, /booked&#124;&lt;x&gt;/);
  assert.match(markdown, /系统字体.*无需补充字体采集/);
  assert.doesNotMatch(markdown, /项待处理或确认|## 待处理事项/);
  assert.match(markdown, /配置中出现参数不代表已验证对应状态/);
});


test('risk-only reports never claim empty font output passed validation', () => {
  const markdown = renderFontReport(report({ fonts: [], localFamilies: ['活动标题'], skipped: ['title.ttf'],
    risks: ['index.html | 元素 span.title | 表达式 apiText | 字体 活动标题: 未解析动态绑定: apiText'] }));
  assert.match(markdown, /生成 0 个字体、0 个文件/);
  assert.match(markdown, /未生成字体文件，未执行字体验证/);
  assert.doesNotMatch(markdown, /字体文件验证通过/);
  assert.match(markdown, /1 项待处理或确认/);
  assert.match(markdown, /动态文字风险[\s\S]*apiText/);
});
