'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { collectData, candidates } = require('./font-static-text');

function createPageAnalysis({ html, htmlPath, outputDir, cssFiles, risks }) {
  const root = path.resolve(outputDir);
  const realRoot = fs.realpathSync(root);
  const cache = new Map();
  const active = new Set();
  const inside = (base, file) => {
    const relative = path.relative(base, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  const resolve = (request, importer, extensions = []) => {
    if (!request.startsWith('.') && !request.startsWith('/')) {
      risks.add(`不支持外部或裸模块依赖: ${request}（${importer}）`); return null;
    }
    let clean;
    try { clean = decodeURIComponent(request.split(/[?#]/, 1)[0]); }
    catch { risks.add(`依赖路径编码无效: ${request}`); return null; }
    const base = clean.startsWith('/') ? path.resolve(root, '.' + clean) : path.resolve(path.dirname(importer), clean);
    if (!inside(root, base)) { risks.add(`依赖越出构建目录: ${request}（${importer}）`); return null; }
    const target = [base, ...extensions.map((extension) => base + extension), ...extensions.map((extension) => path.join(base, 'index' + extension))]
      .find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!target) { risks.add(`未找到本地依赖: ${request}（${importer}）`); return null; }
    if (!inside(realRoot, fs.realpathSync(target))) { risks.add(`依赖真实路径越出构建目录: ${target}`); return null; }
    return target;
  };
  const resolveModule = (request, importer, collector = risks) => {
    const file = resolve(request, importer || htmlPath, ['.js', '.mjs', '.cjs', '.json']);
    if (!file) return new Map();
    if (active.has(file)) { collector.add(`本地模块循环依赖: ${file}`); return new Map(); }
    if (cache.has(file)) return cache.get(file);
    if (cache.size >= 100) { collector.add('本地模块依赖超过上限 100，已停止展开'); return new Map(); }
    const exports = new Map();
    cache.set(file, exports);
    active.add(file);
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (path.extname(file).toLowerCase() === '.json') {
        const value = JSON.parse(content);
        exports.set('default', candidates([value]));
        exports.set('$commonjs', candidates([value]));
      } else {
        collectData([{ content, filePath: file }], collector, { exports, resolveModule });
      }
    } catch (error) { collector.add(`读取本地模块失败: ${file}: ${error.message}`); }
    finally { active.delete(file); }
    return exports;
  };
  const attributes = (source) => {
    const output = {};
    for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) output[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    return output;
  };
  const localRequest = (value) => value.startsWith('.') || value.startsWith('/') ? value : './' + value;
  const scripts = [];
  // Preserve document script order and do not parse commented-out script tags.
  const document = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of document.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.type && !/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(attrs.type)) continue;
    if (attrs.src) {
      if (/^(?:[a-z]+:)?\/\//i.test(attrs.src)) continue;
      const file = resolve(localRequest(attrs.src), htmlPath);
      if (file) scripts.push({ content: fs.readFileSync(file, 'utf8'), filePath: file });
    } else if (match[2].trim()) scripts.push({ content: match[2], filePath: htmlPath });
  }
  const styles = [];
  let styleCount = 0;
  const cssMap = new Map(cssFiles.filter((file) => file.filePath).map((file) => [path.resolve(file.filePath), file]));
  const addCss = (file, trail = new Set(), inline) => {
    if (trail.has(file)) { risks.add(`样式表循环依赖: ${file}`); return; }
    if (++styleCount > 100) { risks.add('样式表依赖展开超过上限 100'); return; }
    const entry = inline || cssMap.get(file) || { filePath: file, content: fs.readFileSync(file, 'utf8') };
    for (const match of entry.content.matchAll(/@import\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)]+))\s*\)|["']([^"']+)["'])[^;]*;/gi)) {
      const request = match[1] || match[2] || match[3];
      if (/^(?:[a-z]+:)?\/\//i.test(request)) continue;
      const imported = resolve(localRequest(request), file);
      if (imported) addCss(imported, new Set([...trail, file]));
    }
    styles.push(entry);
  };
  let linked = false;
  const styledDocument = document.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  for (const match of styledDocument.matchAll(/<link\b([^>]*)>|<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (match[2] !== undefined) { addCss(htmlPath, new Set(), { filePath: htmlPath, content: match[2] }); continue; }
    const attrs = attributes(match[1]);
    if (!attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet') || !attrs.href) continue;
    linked = true;
    if (/^(?:[a-z]+:)?\/\//i.test(attrs.href)) continue;
    const file = resolve(localRequest(attrs.href), htmlPath);
    if (file) addCss(file);
  }
  // Legacy HTML fragments have no document stylesheet boundary. Complete documents
  // use only their linked/inline styles; never mix other pages' inline styles.
  if (!linked && !/<!doctype\b|<html\b|<head\b/i.test(document)) styles.unshift(...cssFiles.filter((file) => !file.filePath || path.extname(file.filePath).toLowerCase() === '.css'));
  return { scripts, cssFiles: styles, resolveModule };
}

module.exports = { createPageAnalysis };
