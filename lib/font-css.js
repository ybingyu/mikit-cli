'use strict';

const postcss = require('postcss');

const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SYSTEM_FONTS = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);
const FONT_SIZE_RE = /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|0|(?:\d*\.)?\d+(?:px|em|rem|ex|rex|ch|rch|ic|ric|cap|rcap|lh|rlh|in|cm|mm|q|pt|pc|[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|%)|(?:calc|min|max|clamp|var)\(.+\))$/i;
const FONT_PREFIX_RE = /^(?:normal|italic|oblique|small-caps|bold|bolder|lighter|[1-9]\d{0,3}|(?:ultra-|extra-|semi-)?(?:condensed|expanded)|(?:\d*\.)?\d+%|[+-]?(?:\d*\.)?\d+(?:deg|grad|rad|turn))$/i;
const LINE_HEIGHT_RE = /^(?:normal|(?:\d*\.)?\d+(?:px|em|rem|ex|rex|ch|rch|ic|ric|cap|rcap|lh|rlh|in|cm|mm|q|pt|pc|[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|%)?|(?:calc|min|max|clamp|var)\(.+\))$/i;

function firstFamily(value) {
  const family = postcss.list.comma(value)[0].trim();
  if (!family) return null;
  if (/^(["'])[\s\S]*\1$/.test(family)) return family.slice(1, -1);
  // An unquoted family consists of identifiers, not a size or function value.
  if (!postcss.list.space(family).every((word) => /^-?(?:[a-z_\u0080-\uffff]|\\.)[\w\u0080-\uffff\\-]*$/i.test(word))) {
    return null;
  }
  return family;
}

function shorthandFamily(value) {
  // PostCSS's list splitter preserves quotes, escapes and nested functions.
  const parts = postcss.list.split(value, ['/'], true);
  if (parts.length > 2) return null;
  const words = postcss.list.space(parts[0]);
  for (let index = 0; index < words.length; index += 1) {
    if (!FONT_SIZE_RE.test(words[index])) continue;
    if (!words.slice(0, index).every((word) => FONT_PREFIX_RE.test(word))) continue;
    let familyWords;
    if (parts.length === 2) {
      if (index !== words.length - 1) continue;
      const afterSlash = postcss.list.space(parts[1]);
      if (!LINE_HEIGHT_RE.test(afterSlash[0] || '')) continue;
      familyWords = afterSlash.slice(1);
    } else {
      familyWords = words.slice(index + 1);
    }
    if (!familyWords.length) continue;
    const family = firstFamily(familyWords.join(' '));
    if (family !== null) return family;
  }
  return null;
}

function getDeclaredFontFamily(css) {
  if (!css) return null;
  let root;
  try {
    root = postcss.parse(css, { from: undefined });
  } catch (error) {
    if (error.name !== 'CssSyntaxError') throw error;
    return null;
  }
  let selected = null;
  for (const declaration of root.nodes) {
    if (declaration.type !== 'decl') continue;
    const property = declaration.prop.toLowerCase();
    if (property !== 'font' && property !== 'font-family') continue;
    const value = declaration.value.trim();
    const keyword = value.toLowerCase();
    let fontFamily;
    let inherit = false;
    if (CSS_WIDE_KEYWORDS.has(keyword)) {
      fontFamily = '';
      inherit = keyword === 'inherit' || keyword === 'unset';
    } else if (property === 'font' && SYSTEM_FONTS.has(keyword)) {
      // A system font resets an earlier local family; do not attribute it to that font.
      fontFamily = '';
    } else {
      fontFamily = property === 'font' ? shorthandFamily(value) : firstFamily(value);
    }
    if (fontFamily === null) continue;
    const important = Boolean(declaration.important);
    if (!selected || important || !selected.important) {
      selected = { fontFamily, inherit, important };
    }
  }
  return selected;
}

module.exports = { getDeclaredFontFamily };
