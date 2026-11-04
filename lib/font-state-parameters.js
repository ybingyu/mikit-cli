'use strict';

const acorn = require('acorn');

// This is source inspection only: never execute page scripts or invent URLs.
function analyzePageStateParameters({ scripts, bindings = [], page, localFamilies = [], runtimePages = [] }) {
  const nodes = [];
  const scopes = new WeakMap();
  const sources = new WeakMap();
  const global = { names: new Map(), parent: null, functionScope: true };
  const definitions = new Map();
  const parameters = new Map();
  let nextId = 0;
  const declare = (scope, name) => {
    if (!scope.names.has(name)) scope.names.set(name, ++nextId);
    return scope.names.get(name);
  };
  const lookup = (scope, name) => {
    for (let current = scope; current; current = current.parent) if (current.names.has(name)) return current.names.get(name);
    return 'global:' + name;
  };
  const children = node => Object.values(node).flatMap(value => Array.isArray(value)
    ? value.filter(item => item && typeof item.type === 'string')
    : value && typeof value.type === 'string' ? [value] : []);
  const isFunction = node => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type);
  const build = (node, scope, source) => {
    if (node.type === 'FunctionDeclaration' && node.id) declare(scope, node.id.name);
    if (isFunction(node)) {
      scope = { names: new Map(), parent: scope, functionScope: true };
      for (const param of node.params) if (param.type === 'Identifier') declare(scope, param.name);
    } else if (node.type === 'BlockStatement') scope = { names: new Map(), parent: scope };
    if (node.type === 'VariableDeclaration') for (const item of node.declarations) {
      if (item.id.type !== 'Identifier') continue;
      let target = scope;
      if (node.kind === 'var') while (!target.functionScope) target = target.parent;
      declare(target, item.id.name);
    }
    scopes.set(node, scope);
    sources.set(node, source);
    nodes.push({ node, source });
    for (const child of children(node)) build(child, scope, source);
  };
  for (const record of scripts) {
    try {
      const tree = acorn.parse(record.content, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
      build(tree, global, record.filePath || page);
    } catch { /* The existing static collector reports script parsing failures. */ }
  }
  const property = node => node.computed ? node.property.type === 'Literal' ? String(node.property.value) : null : node.property.name;
  const key = node => {
    if (!node) return null;
    if (node.type === 'Identifier') return String(lookup(scopes.get(node), node.name));
    if (node.type === 'ThisExpression') {
      let scope = scopes.get(node);
      while (scope && !scope.functionScope) scope = scope.parent;
      return 'this:' + (scope ? declare(scope, '@this') : 0);
    }
    if (node.type === 'MemberExpression' && property(node) !== null) {
      const object = key(node.object);
      return object === null ? null : object + '.' + property(node);
    }
    return null;
  };
  for (const { node } of nodes) {
    const target = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentExpression' ? node.left : null;
    const value = node.type === 'VariableDeclarator' ? node.init : node.right;
    const name = key(target);
    if (name !== null && value) {
      if (!definitions.has(name)) definitions.set(name, []);
      definitions.get(name).push(value);
    }
  }
  const getParameter = (name, sourceNode) => {
    if (!parameters.has(name)) parameters.set(name, { page, name, values: new Set(), pattern: '', bindings: new Set(), sources: new Set() });
    const item = parameters.get(name);
    if (sourceNode) item.sources.add(sourceNode.source + ':' + sourceNode.node.loc.start.line);
    return 'param:' + name;
  };
  const merge = (...sets) => new Set(sets.flatMap(set => [...set]));
  const provenanceByNode = new WeakMap();
  const dependentsByNode = new WeakMap();
  const provenance = node => node ? provenanceByNode.get(node) || new Set() : new Set();
  // Propagate only changed results. Shared dependencies and cycles must not
  // recursively expand the same definition along every possible path.
  const evaluateProvenance = (node) => {
    const next = (child) => {
      if (!child) return new Set();
      if (!dependentsByNode.has(child)) dependentsByNode.set(child, new Set());
      dependentsByNode.get(child).add(node);
      return provenance(child);
    };
    const name = key(node);
    let output = new Set();
    if (name !== null && definitions.has(name)) {
      for (const value of definitions.get(name)) output = merge(output, next(value));
    }
    if (node.type === 'MemberExpression') {
      const prop = property(node);
      const object = next(node.object);
      // Browser globals must not have been shadowed by a local declaration.
      const full = key(node);
      if (['global:location.search', 'global:window.location.search', 'global:document.location.search', 'global:globalThis.location.search'].includes(full)) output.add('search');
      if (['global:location.href', 'global:window.location.href', 'global:document.location.href', 'global:globalThis.location.href'].includes(full)) output.add('href');
      if (prop === 'searchParams' && object.has('url')) output.add('params');
      if (prop === 'search' && object.has('url')) output.add('search');
      output = merge(output, [...object].filter(tag => tag.startsWith('param:')));
    } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier') {
      if (lookup(scopes.get(node.callee), node.callee.name) === 'global:URLSearchParams' && next(node.arguments[0]).has('search')) output.add('params');
      if (lookup(scopes.get(node.callee), node.callee.name) === 'global:URL' && next(node.arguments[0]).has('href')) output.add('url');
    } else if (node.type === 'CallExpression') {
      if (node.callee.type === 'MemberExpression') {
        const method = property(node.callee);
        const receiver = next(node.callee.object);
        const first = node.arguments[0];
        if (receiver.has('params') && ['get', 'getAll', 'has'].includes(method) && typeof first?.value === 'string') {
          output.add(getParameter(first.value, { node, source: sources.get(node) }));
        } else if (receiver.has('search') && method === 'match' && first?.regex) {
          const match = first.regex.pattern.match(/([a-zA-Z_][\w.-]*)=\(([^()]*)\)/);
          if (match) {
            output.add(getParameter(match[1], { node, source: sources.get(node) }));
            const item = parameters.get(match[1]);
            if (/^[\w.-]+(?:\|[\w.-]+)*$/.test(match[2])) match[2].split('|').slice(0, 32).forEach(value => item.values.add(value));
            else item.pattern = /\\d|\[0-9\]/.test(match[2]) ? '数字（范围未确定）' : '取值范围未确定';
          }
        }
        output = merge(output, [...receiver].filter(tag => tag.startsWith('param:')));
      }
      for (const argument of node.arguments) output = merge(output, next(argument));
    } else if (!isFunction(node) && !['ObjectExpression', 'ArrayExpression', 'Literal', 'Identifier'].includes(node.type)) {
      for (const child of children(node)) output = merge(output, next(child));
    }
    return output;
  };
  const pending = nodes.map(record => record.node);
  const queued = new Set(pending);
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index];
    queued.delete(node);
    const previous = provenance(node);
    const output = evaluateProvenance(node);
    if (output.size === previous.size && [...output].every(tag => previous.has(tag))) continue;
    provenanceByNode.set(node, output);
    for (const dependent of dependentsByNode.get(node) || []) {
      if (queued.has(dependent)) continue;
      queued.add(dependent);
      pending.push(dependent);
    }
  }
  for (const { node } of nodes) {
    if (node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(node.operator)) {
      for (const [expression, literal] of [[node.left, node.right], [node.right, node.left]]) {
        if (literal.type !== 'Literal' || !['string', 'number'].includes(typeof literal.value)) continue;
        for (const tag of provenance(expression)) if (tag.startsWith('param:')) parameters.get(tag.slice(6)).values.add(String(literal.value));
      }
    }
    const target = node.type === 'AssignmentExpression' ? node.left : node.type === 'VariableDeclarator' ? node.id
      : node.type === 'Property' && !node.computed ? node.key : null;
    const field = target?.type === 'MemberExpression' ? property(target) : target?.type === 'Identifier' ? target.name : target?.value;
    if (typeof field !== 'string') continue;
    const value = node.type === 'AssignmentExpression' ? node.right : node.type === 'VariableDeclarator' ? node.init : node.value;
    for (const tag of provenance(value)) if (tag.startsWith('param:')) parameters.get(tag.slice(6)).bindings.add(field);
  }
  const identifiers = expression => {
    try {
      const tree = acorn.parseExpressionAt(expression, 0, { ecmaVersion: 'latest' });
      const names = new Set();
      const visit = node => {
        if (node.type === 'Identifier') names.add(node.name);
        if (node.type === 'MemberExpression') {
          if (node.object.type === 'ThisExpression' && property(node) !== null) names.add(property(node));
          visit(node.object);
          if (node.computed && node.property.type !== 'Literal') visit(node.property);
          return;
        }
        for (const child of children(node)) visit(child);
      };
      visit(tree);
      return names;
    } catch { return new Set(); }
  };
  const locations = bindings.map(binding => ({ ...binding, names: identifiers(binding.expression) }));
  const local = new Set([...localFamilies].map(family => family.toLowerCase()));
  return [...parameters.values()].map(item => {
    const matched = locations.filter(location => [...item.bindings].some(field => location.names.has(field)));
    const unique = [...new Map(matched.map(({ names, ...location }) => [JSON.stringify(location), location])).values()];
    const families = unique.flatMap(location => location.families);
    const impact = families.some(family => local.has(family.toLowerCase())) ? 'local' : unique.length && families.length ? 'system' : 'unknown';
    const configured = new Set(runtimePages.flatMap(url => new URL(url).searchParams.getAll(item.name)));
    const values = [...item.values].slice(0, 32);
    return { ...item, values, bindings: [...item.bindings], sources: [...item.sources], locations: unique,
      impact, configuredValues: [...configured], unconfiguredValues: values.filter(value => !configured.has(value)) };
  });
}

module.exports = { analyzePageStateParameters };
