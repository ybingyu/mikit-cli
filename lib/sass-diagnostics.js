const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

function spanPath(span, fallback) {
  if (span && span.url && span.url.protocol === 'file:') {
    return fileURLToPath(span.url);
  }
  return fallback;
}

function keyframeSelectorLocation(error, sourcePath) {
  if (error.sassMessage !== 'Expected "to" or "from".' ||
      !/^\s*@include\s+keyframes\s*\(/.test(error.span?.context || '')) {
    return null;
  }

  let lines;
  try {
    lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
  } catch (_) {
    return null;
  }

  // Sass reports the @content call site rather than the invalid selector inside it.
  let depth = 1;
  for (let i = error.span.start.line + 1; i < lines.length && i < error.span.start.line + 100; i++) {
    const line = lines[i];
    if (depth === 1) {
      const match = /^(\s*)([a-z][\w-]*)\s*\{/i.exec(line);
      if (match && !/^(from|to)$/i.test(match[2])) {
        return { line: i + 1, column: match[1].length + 1, text: line };
      }
    }
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (depth <= 0) {
      break;
    }
  }
  return null;
}

function formatSassError(error, entryPath) {
  const span = error.span;
  if (!span) {
    return `[mikit start] Sass 编译错误：${entryPath} ${error.message}`;
  }

  const sourcePath = spanPath(span, entryPath);
  const selector = keyframeSelectorLocation(error, sourcePath);
  const line = selector ? selector.line : span.start.line + 1;
  const column = selector ? selector.column : span.start.column + 1;
  const text = selector ? selector.text : span.context?.split(/\r?\n/)[0];
  const location = `${sourcePath}:${line}:${column}`;
  const message = error.sassMessage || error.message.split('\n')[0];
  if (!text) {
    return `[mikit start] Sass 编译错误：${location} ${message}`;
  }
  return `[mikit start] Sass 编译错误：${location} ${message}\n` +
    `  ${line} | ${text}\n` +
    `    | ${' '.repeat(Math.max(column - 1, 0))}^`;
}

function formatSassWarning(message, options = {}) {
  const kind = options.deprecation ? '弃用警告' : '警告';
  const id = options.deprecationType ? ` [${options.deprecationType.id}]` : '';
  const sourcePath = options.span ? spanPath(options.span) : null;
  const location = sourcePath
    ? `${sourcePath}:${options.span.start.line + 1}:${options.span.start.column + 1} `
    : '';
  return `[mikit start] Sass ${kind}${id}：${location}${message.split('\n')[0]}`;
}

module.exports = { formatSassError, formatSassWarning };
