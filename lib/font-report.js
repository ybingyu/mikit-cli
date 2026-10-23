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

function renderFontReport(report) {
  const { fonts, sources } = report;
  const risks = [...new Set(report.risks)];
  const missingFonts = fonts.filter((font) => verified(font) && font.verification.sourceMissing.length);
  const digitFonts = fonts.filter((font) => font.dynamicBinding && font.missingDigits);
  const unverifiedFonts = fonts.filter((font) => !verified(font));
  const bytes = fonts.reduce((sum, font) => sum + font.formats.reduce((total, output) => total + output.bytes, 0), 0);
  const fileCount = fonts.reduce((sum, font) => sum + font.formats.length, 0);
  const issueCount = risks.length + missingFonts.length + digitFonts.length + unverifiedFonts.length;
  const validation = unverifiedFonts.length
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
      const match = risk.match(/^([\s\S]*?) \| 表达式 ([\s\S]*?) \| 字体 ([\s\S]*?): ([\s\S]*)$/);
      if (match) contextual.push(match);
      else other.push(risk);
    }
    if (contextual.length) {
      lines.push('| 页面 | 字体族 | 表达式 / 依赖 | 待确认问题 |', '| --- | --- | --- | --- |');
      contextual.forEach(([, page, expression, family, message]) => {
        lines.push(`| ${text(page)} | ${text(family)} | ${text(expression)} | ${text(message)} |`);
      });
      lines.push('');
    }
    other.forEach((risk) => lines.push(`- ${text(risk)}`));
    lines.push('');
  }
  if (digitFonts.length) {
    lines.push('### 数字覆盖待确认', '', '尚未采集的数字不等于源字体缺字。以下字体存在动态绑定，请先确认实际是否会显示这些数字。', '',
      '| 字体族 | 尚未采集的数字 |', '| --- | --- |');
    digitFonts.forEach((font) => lines.push(`| ${text(font.faceLabel || font.family)} | ${text(font.missingDigits)} |`));
    lines.push('', '确有需要时，用 familyExtraText 按字体族补充；或显式设置 familyOptions.<字体族>.asciiBaseline 为 common，补齐数字和常用标点。', '');
  }
  const skipped = report.skipped || [];
  const removedRemote = report.removedRemote || [];
  const removedUnused = report.removedUnused || [];
  lines.push(`扫描：${sources.staticPages.length} 个静态页面、${sources.runtimePages.length} 个动态页面。跳过 ${skipped.length} 个零字符字体；清理 ${removedRemote.length + removedUnused.length} 个字体文件。`, '',
    '<details>', '<summary>采集详情</summary>', '',
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
  lines.push('', '</details>', '');
  if (skipped.length || removedRemote.length || removedUnused.length) {
    lines.push('<details>', '<summary>跳过与清理名单</summary>', '');
    if (skipped.length) lines.push(`- 未采集到字符，已跳过：${skipped.map(text).join('、')}`);
    if (removedRemote.length) lines.push(`- 仅由远程地址引用，已移除本地副本：${removedRemote.map(text).join('、')}`);
    if (removedUnused.length) lines.push(`- 未使用的字体或格式，已移除：${removedUnused.map(text).join('、')}`);
    lines.push('', '</details>', '');
  }
  lines.push('本次动态采集仅覆盖实际访问到的 DOM 状态；接口返回、用户输入及未采集的交互状态仍需确认。', '');
  return lines.join('\n');
}

module.exports = { renderFontReport };
