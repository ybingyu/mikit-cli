'use strict';

const path = require('node:path');

function text(value) {
  return String(value ?? '').replace(/[&<>|\\`*_\[\]#!\r\n]/g, (character) => {
    if (character === '\r') return '';
    if (character === '\n') return '<br>';
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character] ||
      `&#${character.codePointAt(0)};`;
  });
}

function fileLink(file, label = file) {
  const normalized = file.replace(/\\/g, '/');
  if (path.win32.isAbsolute(file)) {
    return `${label === file ? '' : text(label) + ' · '}${text(normalized)}（请按绝对路径打开）`;
  }
  const relative = normalized.startsWith('.') ? normalized : `./${normalized}`;
  const href = relative.split('/').map((segment) => encodeURIComponent(segment)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
  return `[${text(label.replace(/\\/g, '/'))}](${href})`;
}

function stateParameterSection(report) {
  if (!report.stateParameters?.length) return [];
  const local = new Set((report.localFamilies || []).map(family => family.toLowerCase()));
  const lines = ['## 页面状态参数', '',
    '以下为源码中识别到的 URL 状态参数，发现参数本身不代表漏字。配置中出现参数不代表已验证对应状态；实际采集结果仍取决于页面运行情况。', '',
    '| 页面 | 参数 | 源码取值 | 字体影响 | 配置状态 |', '| --- | --- | --- | --- | --- |'];
  for (const item of report.stateParameters) {
    const families = [...new Set(item.locations.flatMap(location => location.families))]
      .filter(family => local.has(family.toLowerCase()));
    const impact = item.impact === 'local' ? '可能影响本地字体：' + families.join('、')
      : item.impact === 'system' ? '系统字体（无需补充字体采集）' : '影响未确定，需检查页面';
    const status = (item.configuredValues.length ? '已配置取值：' + item.configuredValues.join('、') : '未显式配置该参数') +
      (item.unconfiguredValues.length ? '；未显式配置取值：' + item.unconfiguredValues.join('、') : '');
    lines.push('| ' + [item.page, item.name, item.values.join('、') || item.pattern || '取值范围未确定', impact, status].map(text).join(' | ') + ' |');
  }
  lines.push('', '参数关联位置（源码静态推断）：', '');
  for (const item of report.stateParameters) {
    const locations = [...new Set(item.locations.map(location => location.element))];
    const details = [item.bindings.length ? '字段 ' + item.bindings.join('、') : '尚未关联到模板字段',
      ...locations.slice(0, 3), ...(locations.length > 3 ? ['另有 ' + (locations.length - 3) + ' 处'] : []),
      '来源 ' + item.sources.join('、')];
    lines.push('- ' + text(item.name) + '：' + details.map(text).join('；'));
  }
  lines.push('');
  return lines;
}

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function codePoints(points) {
  return points.map((point) => `${text(String.fromCodePoint(point))}（U+${point.toString(16).toUpperCase().padStart(4, '0')}）`).join('、');
}

function verified(font) {
  return font.verification && font.verification.status !== 'not-run' &&
    Array.isArray(font.verification.sourceMissing);
}

function configurationExample(font) {
  // Preserve valid JSON while keeping user-controlled family names inside the fence.
  const json = JSON.stringify({ mikit: { font } }, null, 2)
    .replace(/[<>&`]/g, (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  return ['```json', json, '```', ''];
}

function parseRisk(risk) {
  return risk.match(/^([\s\S]*?)(?: \| 元素 ([\s\S]*?))? \| 表达式 ([\s\S]*?) \| 字体 ([\s\S]*?): ([\s\S]*)$/);
}

function relevantRisks(report) {
  const families = new Map([...(report.localFamilies || []), ...report.fonts.map(font => font.family)]
    .map(family => [family.toLowerCase(), family]));
  return [...new Set(report.risks.flatMap(risk => {
    const match = parseRisk(risk);
    // Unresolved page dependencies can still affect local fonts.
    if (!match || match[4] === '未确定') return [risk];
    const names = families.has(match[4].toLowerCase()) ? [match[4]] : match[4].split(',');
    const local = [...new Set(names.map(name => families.get(name.trim().replace(/^['"]|['"]$/g, '').toLowerCase())).filter(Boolean))];
    return local.length ? [match[1] + (match[2] ? ' | 元素 ' + match[2] : '') +
      ' | 表达式 ' + match[3] + ' | 字体 ' + local.join(', ') + ': ' + match[5]] : [];
  }))];
}

function dynamicConfiguration(report, risks, digitFonts) {
  if (!risks.length && !digitFonts.length) return [];
  const config = report.fontConfig || {};
  const relevant = new Set(digitFonts.map(font => font.family));
  for (const risk of risks) {
    const match = parseRisk(risk);
    if (!match || match[4] === '未确定') {
      report.fonts.filter(font => font.dynamicBinding).forEach(font => relevant.add(font.family));
    } else {
      for (const family of [...(report.localFamilies || []), ...report.fonts.map(font => font.family)]) {
        if (match[4] === family || match[4].split(', ').includes(family)) relevant.add(family);
      }
    }
  }
  const supplements = {};
  for (const field of ['familyExtraText', 'generatedFamilyExtraText']) {
    const entries = Object.entries(config[field] || {}).filter(([family, value]) => relevant.has(family) && value);
    if (entries.length) supplements[field] = Object.fromEntries(entries);
  }
  const manual = new Map(Object.entries(supplements.familyExtraText || {}));
  for (const font of digitFonts) {
    manual.set(font.family, [...new Set((manual.get(font.family) || '') + font.missingDigits)].join(''));
  }
  if (manual.size) supplements.familyExtraText = Object.fromEntries(manual);
  const pages = report.sources.runtimePages;
  if (!pages.length && !Object.keys(supplements).length) return [];
  const lines = ['### 动态字体配置示例', '',
    '以下内容依据当前项目生成。将需要的字段合并到网站项目的 `package.json > mikit > font`，保留原有配置、页面地址和补字内容；以下示例不会自动写入配置。', ''];
  if (pages.length) {
    lines.push('**采集动态页面**：以下地址来自本次使用的动态页面配置。仅覆盖当前访问到的 DOM 状态，不能穷举未来接口内容；需要更多状态时，请先确认实际地址和参数。', '',
      ...configurationExample({ pages }));
  }
  if (Object.keys(supplements).length) {
    lines.push(digitFonts.length
      ? '**补齐数字**：确认对应内容会显示变化的数字后，合并以下尚未采集的数字；已有补字保留。小数点、百分号、负号等符号应依据展示格式另行追加。'
      : '**当前项目补字配置**：以下仅列出相关字体已有的补字，请核对实际文案；未确定的文案不生成示例。', '',
      ...configurationExample(supplements),
      '补字键使用 CSS 的字体族名，不使用报告中附带字重的显示名称。同一字体族的多个字重和样式都会收到该族补字。', '');
  }
  lines.push('保存后，在已有构建输出的网站项目根目录重新执行：', '', '```sh', 'mikit font', '```', '',
    '重新核对字符清单、报告和实际页面；补字不能修复源字体本身没有的字形。', '');
  return lines;
}

function renderFontReport(report) {
  const { fonts, sources } = report;
  const risks = relevantRisks(report);
  const missingFonts = fonts.filter((font) => verified(font) && font.verification.sourceMissing.length);
  const digitFonts = fonts.filter((font) => font.dynamicBinding && font.missingDigits);
  const unverifiedFonts = fonts.filter((font) => !verified(font));
  const bytes = fonts.reduce((sum, font) => sum + font.formats.reduce((total, output) => total + output.bytes, 0), 0);
  const fileCount = fonts.reduce((sum, font) => sum + font.formats.length, 0);
  const issueCount = risks.length + missingFonts.length + digitFonts.length + unverifiedFonts.length;
  const validation = !fonts.length ? '未生成字体文件，未执行字体验证' : unverifiedFonts.length
    ? `${unverifiedFonts.length} 个字体未执行验证`
    : missingFonts.length ? '输出字形验证通过，存在源字体缺字' : '字体文件验证通过';
  const lines = [
    '# 字体精简报告', '',
    `**字体打包完成**：生成 ${fonts.length} 个字体、${fileCount} 个文件，总计 ${size(bytes)}。${validation}。${issueCount ? `${issueCount} 项待处理或确认。` : ''}`, '',
    '| 字体 | 字符数 | TTF | WOFF | WOFF2 | 字符清单 |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const font of fonts) {
    const sizes = ['ttf', 'woff', 'woff2'].map((format) => {
      const output = font.formats.find((item) => item.format === format);
      return output ? fileLink(output.file, size(output.bytes)) : '—';
    });
    lines.push(`| ${text(font.faceLabel || font.family)} | ${font.characters} | ${sizes.join(' | ')} | ${fileLink(font.manifest)} |`);
  }
  lines.push('');
  if (issueCount) lines.push('## 待处理事项', '');
  if (missingFonts.length) {
    lines.push('### 源字体缺字', '', '以下字符在原字体中没有字形，请更换字体或设置回退字体；追加文字无法解决。', '');
    for (const font of missingFonts) {
      lines.push(`- ${text(font.faceLabel || font.family)}：${codePoints(font.verification.sourceMissing)}（请求 ${font.verification.requested} 个字符，源字体支持 ${font.verification.supported} 个）。`);
    }
    lines.push('');
  }
  if (unverifiedFonts.length) {
    lines.push('### 未执行字体验证', '',
      `未验证字体：${unverifiedFonts.map((font) => text(font.faceLabel || font.family)).join('、')}。字形覆盖及名称检查未执行，不能视为验证通过。`, '');
  }
  if (risks.length) {
    lines.push('### 动态文字风险', '', '以下内容无法静态确定，请核对实际文案；可配置 pages 采集对应状态，或按字体族显式补字。', '');
    const contextual = [];
    const other = [];
    for (const risk of risks) {
      const match = parseRisk(risk);
      if (match) contextual.push(match);
      else other.push(risk);
    }
    if (contextual.length) {
      const hasElements = contextual.some((entry) => entry[2]);
      lines.push(hasElements ? '| 页面 | 元素位置 | 字体族 | 表达式 / 依赖 | 待确认问题 |' : '| 页面 | 字体族 | 表达式 / 依赖 | 待确认问题 |',
        hasElements ? '| --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- |');
      contextual.forEach(([, page, element, expression, family, message]) => {
        lines.push(`| ${text(page)} | ${hasElements ? text(element || '页面依赖（无对应元素）') + ' | ' : ''}${text(family)} | ${text(expression)} | ${text(message)} |`);
      });
      if (hasElements) lines.push('', '元素位置对应构建页面中的模板结构；nth-of-type 表示同级同标签的位置，循环生成的多个实例共用一个模板位置。');
      lines.push('');
    }
    other.forEach((risk) => lines.push(`- ${text(risk)}`));
    lines.push('');
  }
  if (digitFonts.length) {
    lines.push('### 数字覆盖待确认', '', '尚未采集的数字不等于源字体缺字。以下字体存在动态绑定，请先确认实际是否会显示这些数字。', '',
      '| 字体族 | 尚未采集的数字 |', '| --- | --- |');
    digitFonts.forEach((font) => lines.push(`| ${text(font.faceLabel || font.family)} | ${text(font.missingDigits)} |`));
    lines.push('');
    const coveredLocations = new Set();
    for (const risk of risks) {
      const match = parseRisk(risk);
      if (!match || !match[2]) continue;
      for (const font of digitFonts) {
        if (match[4] === font.family || match[4].split(', ').includes(font.family)) {
          coveredLocations.add(JSON.stringify([font.family, match[1], match[2], match[3]]));
        }
      }
    }
    const locations = new Map();
    for (const font of digitFonts) for (const source of font.dynamicSources || []) {
      const row = [font.family, source.page, source.element, source.expression];
      const key = JSON.stringify(row);
      if (!coveredLocations.has(key)) locations.set(key, row);
    }
    if (coveredLocations.size) lines.push('已在“动态文字风险”列出的元素不再重复展示；请结合该表核对数字变化。', '');
    if (locations.size) {
      lines.push('请检查以下动态绑定是否会显示变化的数字。这些是待核对的模板位置，不表示已经确认漏字；页面路径相对构建输出目录，循环实例和同族多个字重共用的绑定只列一次。', '',
        '| 字体族 | 页面 | 元素位置 | 绑定表达式 |', '| --- | --- | --- | --- |');
      for (const row of locations.values()) lines.push('| ' + row.map(text).join(' | ') + ' |');
      lines.push('');
    }
  }
  lines.push(...dynamicConfiguration(report, risks, digitFonts));
  lines.push(...stateParameterSection(report));
  const skipped = report.skipped || [];
  const removedRemote = report.removedRemote || [];
  const removedUnused = report.removedUnused || [];
  lines.push(`扫描：${sources.staticPages.length} 个静态页面、${sources.runtimePages.length} 个动态页面。跳过 ${skipped.length} 个零字符字体；清理 ${removedRemote.length + removedUnused.length} 个字体文件。`, '',
    '## 采集详情', '',
    '| 字体 | 静态采集 | 运行时新增 | 配置新增 | ASCII 策略（来源） | 动态绑定 |',
    '| --- | ---: | ---: | ---: | --- | --- |');
  for (const font of fonts) {
    const counts = font.characterSources;
    lines.push(`| ${text(font.faceLabel || font.family)} | ${counts.static} | ${counts.runtime} | ${counts.configured} | ${text(font.asciiBaseline || report.asciiBaseline)}（${text(font.asciiBaselineSource || '全局配置')}） | ${font.dynamicBinding ? '是' : '否'} |`);
  }
  lines.push('', '字符按 Unicode 码点统计，来源按“静态 → 运行时 → 配置”去重；配置新增含显式补字和 ASCII 基线。', '',
    '静态页面（相对构建输出目录）：', '');
  sources.staticPages.forEach((page) => lines.push(`- ${text(page)}`));
  lines.push('');
  if (sources.runtimePages.length) {
    lines.push('动态页面：', '');
    sources.runtimePages.forEach((page) => lines.push(`- ${text(page)}`));
  } else {
    lines.push('运行时页面：未配置，本次未执行浏览器 DOM 采集。');
  }
  lines.push('');
  if (skipped.length || removedRemote.length || removedUnused.length) {
    lines.push('## 跳过与清理名单', '');
    if (skipped.length) lines.push(`- 未采集到字符，已跳过：${skipped.map(text).join('、')}`);
    if (removedRemote.length) lines.push(`- 仅由远程地址引用，已移除本地副本：${removedRemote.map(text).join('、')}`);
    if (removedUnused.length) lines.push(`- 未使用的字体或格式，已移除：${removedUnused.map(text).join('、')}`);
    lines.push('');
  }
  lines.push('本次动态采集仅覆盖实际访问到的 DOM 状态；接口返回、用户输入及未采集的交互状态仍需确认。', '');
  return lines.join('\n');
}

module.exports = { renderFontReport, relevantRisks };
