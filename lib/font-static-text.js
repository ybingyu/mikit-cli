'use strict';
const acorn = require('acorn');

function parseExpression(source) {
  try {
    const expression = acorn.parseExpressionAt(source, 0, { ecmaVersion: 'latest' });
    return source.slice(expression.end).trim() ? null : expression;
  }
  catch { return null; }
}

function collectData(scripts, risks) {
  const values = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      values.set(node.id.name, node.init);
    }
    if (node.type === 'Property' && (node.key?.name || node.key?.value) === 'data') {
      const body = node.value?.body;
      if (node.value?.type === 'ObjectExpression') {
        for (const item of node.value.properties) if (item.key?.name) values.set(item.key.name, item.value);
      }
      if (body?.body) {
        for (const statement of body.body) if (statement.type === 'ReturnStatement' && statement.argument?.type === 'ObjectExpression') {
          for (const item of statement.argument.properties) {
            const key = item.key?.name || item.key?.value;
            if (key) values.set(key, item.value);
          }
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'start' || key === 'end' || key === 'loc') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  for (const script of scripts) {
    try { visit(acorn.parse(script, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true })); }
    catch { risks.add('JavaScript 解析失败，部分动态展示文字需要运行时页面或人工补字'); }
  }
  return values;
}

function evaluate(node, values, risks, depth = 0) {
  if (!node || depth > 16) return [];
  const next = (value) => evaluate(value, values, risks, depth + 1);
  switch (node.type) {
    case 'Literal': return [node.value];
    case 'Identifier': {
      const value = values.get(node.name);
      if (!value) { risks.add(`未解析动态绑定: ${node.name}`); return []; }
      return next(value);
    }
    case 'ArrayExpression': return [node.elements.flatMap((value) => next(value))];
    case 'ObjectExpression': {
      const object = {};
      for (const property of node.properties) {
        const key = property.key?.name || property.key?.value;
        if (key !== undefined) object[key] = next(property.value);
      }
      return [object];
    }
    case 'MemberExpression': {
      const objects = next(node.object);
      const keys = node.computed ? next(node.property).flatMap((v) => Array.isArray(v) ? v : [v]) : [node.property.name];
      const output = [];
      const staticKey = node.property.type === 'Literal' ? node.property.value : null;
      if (node.computed && staticKey === null) risks.add('动态索引无法静态确定，已展开已知分支');
      for (const object of objects.flatMap((v) => Array.isArray(v) ? v : [v])) {
        if (object && typeof object === 'object') {
          // Computed keys can vary at runtime; include all locally known branches.
          const selected = node.computed ? staticKey === null ? Object.keys(object) : [staticKey] : keys;
          for (const key of selected) if (Object.hasOwn(object, key)) output.push(...object[key]);
        }
      }
      if (!output.length) risks.add('动态索引或属性没有可确定的源码值');
      return output;
    }
    case 'ConditionalExpression': return [...next(node.consequent), ...next(node.alternate)];
    case 'LogicalExpression': return [...next(node.left), ...next(node.right)];
    case 'TemplateLiteral': {
      let parts = [''];
      node.quasis.forEach((part, index) => {
        parts = parts.map((value) => value + part.value.cooked);
        if (index < node.expressions.length) {
          const additions = next(node.expressions[index]).filter((v) => ['string', 'number'].includes(typeof v));
          parts = parts.flatMap((value) => additions.map((added) => value + added)).slice(0, 100);
        }
      });
      return parts;
    }
    case 'BinaryExpression': {
      if (node.operator !== '+') return [];
      return next(node.left).flatMap((left) => next(node.right).map((right) => `${left}${right}`)).slice(0, 100);
    }
    default: risks.add(`无法静态求值的表达式: ${node.type}`); return [];
  }
}

function visibleValues(expression, values, risks, html = false) {
  const ast = parseExpression(expression);
  if (!ast) { risks.add(`无法解析动态表达式: ${expression}`); return []; }
  const resolved = evaluate(ast, values, risks);
  return resolved.filter((item) => typeof item === 'string' || typeof item === 'number')
    .map((item) => html ? String(item).replace(/<[^>]*>/g, '') : String(item));
}

module.exports = { collectData, visibleValues, parseExpression, evaluate };
