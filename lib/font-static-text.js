'use strict';
const acorn = require('acorn');

const MAX_CANDIDATES = 100;
const MAX_DEPTH = 32;
const UNKNOWN = Symbol('unknown static value');
const OPTIONAL_EMPTY = Symbol('optional chain short circuit');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const candidates = (values) => ({ type: 'StaticCandidates', values });
const deferred = (expression, scope) => ({ type: 'StaticExpression', expression, scope: new Map(scope) });
const keyOf = (node) => node && (node.name ?? node.value);

function limit(values, risks) {
  if (values.length > MAX_CANDIDATES) risks.add(`静态候选超过上限 ${MAX_CANDIDATES}，已截断，请使用运行时采集或补字`);
  return values.slice(0, MAX_CANDIDATES);
}

function parseExpression(source) {
  try {
    const expression = acorn.parseExpressionAt(source, 0, { ecmaVersion: 'latest', preserveParens: true });
    return source.slice(expression.end).trim() ? null : expression;
  } catch { return null; }
}

function functionValue(node, scope, thisScope = node.type === 'ArrowFunctionExpression' ? scope.get('$this') : undefined) {
  return { type: 'StaticFunction', node, scope, thisScope, loader: scope.get('$require') };
}

function bindPattern(pattern, expression, scope) {
  if (pattern.type === 'Identifier') scope.set(pattern.name, expression);
  else if (pattern.type === 'ObjectPattern' || pattern.type === 'ArrayPattern') {
    const entries = pattern.type === 'ObjectPattern' ? pattern.properties : pattern.elements;
    entries.forEach((entry, index) => {
      if (!entry) return;
      if (entry.type === 'RestElement') {
        bindPattern(entry.argument, { type: 'StaticUnknown', reason: '暂不支持解构 rest' }, scope);
        return;
      }
      const target = pattern.type === 'ObjectPattern' ? entry.value : entry;
      const key = pattern.type === 'ObjectPattern' ? keyOf(entry.key) : index;
      bindPattern(target, { type: 'MemberExpression', object: expression, property: { type: 'Literal', value: key }, computed: true }, scope);
    });
  } else if (pattern.type === 'AssignmentPattern') {
    bindPattern(pattern.left, { type: 'StaticDefault', expression, fallback: deferred(pattern.right, scope) }, scope);
  }
}

function patternNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap((item) => patternNames(item.type === 'RestElement' ? item.argument : item.value));
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(patternNames);
  if (pattern.type === 'AssignmentPattern') return patternNames(pattern.left);
  return [];
}

function declare(statement, scope) {
  for (const declaration of statement.declarations) {
    const init = declaration.init;
    const value = init && ['FunctionExpression', 'ArrowFunctionExpression'].includes(init.type)
      ? candidates([functionValue(init, scope)])
      : init ? deferred(init, scope) : candidates([undefined]);
    bindPattern(declaration.id, value, scope);
  }
}

function markUncertain(scope, name, reason) {
  if (!scope.has(name)) return;
  const previous = scope.get(name);
  if (previous.type === 'StaticUncertain' && previous.reason === reason) return;
  scope.set(name, { type: 'StaticUncertain', expression: previous, reason });
}

// Analyze assignments without running callbacks, lifecycle hooks or application code.
function markMutations(node, scope, locals = new Set()) {
  if (!node || typeof node !== 'object') return;
  if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(node.type)) {
    locals = new Set(locals);
    const names = (pattern) => {
      if (!pattern) return;
      if (pattern.type === 'Identifier') locals.add(pattern.name);
      else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => names(p.value || p.argument));
      else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(names);
      else if (pattern.type === 'AssignmentPattern') names(pattern.left);
    };
    node.params.forEach(names);
    // Locals in a callback must not invalidate an unrelated page variable.
    const declarations = (value) => {
      if (!value || typeof value !== 'object') return;
      if (value !== node && /Function/.test(value.type)) return;
      if (value.type === 'VariableDeclarator') names(value.id);
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(declarations);
        else if (child && typeof child === 'object') declarations(child);
      }
    };
    declarations(node.body);
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
      ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'assign'].includes(keyOf(node.callee.property))) {
    const target = keyOf(node.callee.property) === 'assign' ? node.arguments[0] : node.callee.object;
    markMutations({ type: 'UpdateExpression', argument: target || { type: 'Identifier', name: '' } }, scope, locals);
  }
  if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
    let target = node.left || node.argument;
    while (target?.type === 'MemberExpression' && target.object.type !== 'ThisExpression') target = target.object;
    const name = target?.type === 'Identifier' ? target.name :
      target?.object?.type === 'ThisExpression' && (!target.computed || target.property.type === 'Literal') ? keyOf(target.property) : null;
    if (name && (target?.object?.type === 'ThisExpression' || !locals.has(name))) markUncertain(scope, name, `绑定 ${name} 存在未执行的回调或生命周期赋值`);
  }
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((item) => markMutations(item, scope, locals));
    else if (child && typeof child === 'object') markMutations(child, scope, locals);
  }
}

function assign(node, scope, risks) {
  const target = node.left || node.argument;
  if (target.type === 'Identifier') {
    const previous = scope.get(target.name) || candidates([undefined]);
    const right = node.type === 'UpdateExpression' ? { type: 'Literal', value: 1 } : node.right;
    const operator = node.type === 'UpdateExpression' ? (node.operator === '++' ? '+' : '-') : node.operator.slice(0, -1);
    scope.set(target.name, node.operator === '=' ? deferred(right, scope) : deferred({
      type: 'BinaryExpression', operator, left: previous, right,
    }, scope));
    return;
  }
  if (target.type === 'MemberExpression' && target.object.type === 'Identifier' && node.operator === '=') {
    const name = target.object.name;
    scope.set(name, { type: 'StaticObjectUpdate', expression: scope.get(name),
      key: deferred(target.computed ? target.property : { type: 'Literal', value: keyOf(target.property) }, scope),
      value: deferred(node.right, scope) });
    return;
  }
  risks.add('无法确定复杂赋值结果');
  markMutations(node, scope);
}

function vueOptionsNode(value) {
  return {
    type: 'ObjectExpression',
    properties: Object.entries(value).map(([name, item]) => ({
      type: 'Property', key: { type: 'Literal', value: name }, value: candidates([item]),
    })),
  };
}

function mergeVueData(parent, child, risks, depth = 0) {
  const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) && value.type !== 'StaticFunction';
  if (!plain(parent) || !plain(child)) return child;
  if (depth > MAX_DEPTH) { risks.add('Vue data 合并超过递归上限'); return child; }
  const merged = Object.assign(Object.create(null), parent, child);
  for (const key of Object.keys(child)) {
    if (own(parent, key)) merged[key] = mergeVueData(parent[key], child[key], risks, depth + 1);
  }
  return merged;
}

function installVue(options, scope, risks, state, depth = 0) {
  if (options?.type !== 'ObjectExpression') return;
  if (depth > MAX_DEPTH) { risks.add('Vue mixins 超过递归上限'); return; }
  const properties = new Map(options.properties.filter((p) => p.type === 'Property').map((p) => [keyOf(p.key), p.value]));
  if (!['data', 'computed', 'methods', 'mixins'].some((key) => properties.has(key))) return;
  const root = !state;
  state = state || { data: new Map(), hooks: [], instanceScope: scope };
  const mixins = properties.get('mixins');
  if (mixins) {
    const rows = evaluate(mixins, scope, risks).filter((row) => {
      if (Array.isArray(row)) return true;
      risks.add('无法静态解析 Vue mixins 数组'); return false;
    });
    const branches = rows.map((row) => {
      const branchScope = new Map(scope);
      const branchState = { ...state, data: new Map(state.data), hooks: [] };
      for (const mixin of row) {
        if (!mixin) continue;
        if (typeof mixin !== 'object' || Array.isArray(mixin) || mixin.type === 'StaticFunction') {
          risks.add('无法静态解析 Vue mixin'); continue;
        }
        installVue(vueOptionsNode(mixin), branchScope, risks, branchState, depth + 1);
      }
      return { scope: branchScope, state: branchState };
    });
    if (branches.length) {
      const keys = new Set(branches.flatMap((branch) => [...branch.scope.keys()]));
      for (const key of keys) {
        const values = branches.map((branch) => branch.scope.get(key));
        if (values.every((value) => value === scope.get(key))) continue;
        scope.set(key, values.every((value) => value === values[0]) ? values[0] : {
          type: 'StaticAlternatives',
          branches: branches.map((branch) => ({ expression: branch.scope.get(key) || {
            type: 'StaticUnknown', reason: 'Vue mixin 分支缺少绑定: ' + key,
          }, scope: branch.scope })),
        });
      }
      for (const branch of branches) {
        for (const key of branch.state.data.keys()) state.data.set(key, scope.get(key));
        state.hooks.push(...branch.state.hooks);
      }
    }
  }
  const data = properties.get('data');
  if (data) {
    let entries;
    if (data.type === 'ObjectExpression') {
      entries = data.properties.filter((p) => p.type === 'Property' && !p.computed)
        .map((p) => [keyOf(p.key), deferred(p.value, scope)]);
      if (entries.length !== data.properties.length) risks.add('Vue data 存在无法确定的展开或动态属性');
    } else {
      const result = evaluate(data, scope, risks).flatMap((value) => value?.type === 'StaticFunction'
        ? evaluateFunction({ ...value, thisScope: value.node.type === 'ArrowFunctionExpression' ? value.thisScope : state.instanceScope }, [], risks, 0) : [value]);
      const keys = new Set(result.flatMap((value) => value && typeof value === 'object' ? Object.keys(value) : []));
      entries = [...keys].map((key) => [key, candidates(result.filter((value) => value && own(value, key)).map((value) => value[key]))]);
    }
    for (const [key, value] of entries) {
      const merged = state.data.has(key) ? { type: 'StaticVueData', parent: state.data.get(key), child: value } : value;
      scope.set(key, merged);
      state.data.set(key, merged);
    }
  }
  for (const group of ['computed', 'methods']) {
    const expression = properties.get(group);
    if (!expression) continue;
    const groups = evaluate(expression, scope, risks);
    if (!groups.length) { risks.add('无法解析 Vue ' + group); continue; }
    const functions = new Map();
    for (const value of groups) {
      if (!value || typeof value !== 'object') { risks.add('无法解析 Vue ' + group); continue; }
      for (const [name, item] of Object.entries(value)) {
        const fn = group === 'computed' && item?.type !== 'StaticFunction' ? item?.get : item;
        if (fn?.type !== 'StaticFunction') { risks.add('无法解析 Vue ' + group + '.' + name); continue; }
        if (!functions.has(name)) functions.set(name, []);
        functions.get(name).push({ ...fn, thisScope: fn.node.type === 'ArrowFunctionExpression' ? fn.thisScope : state.instanceScope });
      }
    }
    for (const [name, functionsForName] of functions) {
      const callable = candidates(functionsForName);
      scope.set(name, group === 'computed' ? { type: 'CallExpression', callee: callable, arguments: [] } : callable);
    }
  }
  for (const [name, value] of properties) if (!['data', 'computed', 'mixins'].includes(name)) state.hooks.push(value);
  // Mark callbacks after all mixins and component data have been installed.
  if (root) for (const hook of state.hooks) markMutations(hook, scope);
}

function collectData(scripts, risks, options = {}) {
  const scope = options.scope || new Map();
  scope.set('undefined', candidates([undefined]));
  const exports = options.exports || new Map();
  const moduleFor = (specifier, record, collector = risks) => options.resolveModule
    ? options.resolveModule(specifier, record.filePath, collector)
    : (collector.add(`未解析本地模块: ${specifier}`), new Map());
  for (const item of scripts) {
    const record = typeof item === 'string' ? { content: item } : item;
    let tree;
    try { tree = acorn.parse(record.content, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }); }
    catch { risks.add(`JavaScript 解析失败: ${record.filePath || '内联脚本'}`); continue; }
    const current = scope;
    // Discover literal dependencies while the loader's active stack is intact.
    const dependencies = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' &&
        node.arguments.length === 1 && typeof node.arguments[0].value === 'string') moduleFor(node.arguments[0].value, record);
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(dependencies);
        else if (child && typeof child === 'object') dependencies(child);
      }
    };
    dependencies(tree);
    current.set('$require', { type: 'StaticModuleLoader', load: (specifier, collector, depth) => {
      const exported = moduleFor(specifier, record, collector);
      if (exported.has('$commonjs')) return evaluate(exported.get('$commonjs'), exported, collector, depth);
      return evaluate({ type: 'StaticNamespace', exports: exported }, exported, collector, depth);
    } });
    for (const statement of tree.body) {
      const node = statement.declaration || statement;
      if (node.type === 'FunctionDeclaration' && node.id) current.set(node.id.name, candidates([functionValue(node, current)]));
    }
    for (const statement of tree.body) {
      if (statement.type === 'ImportDeclaration') {
        const imported = moduleFor(statement.source.value, record);
        for (const specifier of statement.specifiers) {
          const name = specifier.type === 'ImportDefaultSpecifier' ? 'default' : keyOf(specifier.imported);
          current.set(specifier.local.name, specifier.type === 'ImportNamespaceSpecifier'
            ? { type: 'StaticNamespace', exports: imported }
            : { type: 'StaticExport', exports: imported, name });
        }
        continue;
      }
      const node = statement.declaration || statement;
      if (statement.type === 'ExportDefaultDeclaration') {
        exports.set('default', node.type === 'FunctionDeclaration' ? candidates([functionValue(node, current)]) : deferred(node, current));
        installVue(node, current, risks);
      } else if (node.type === 'VariableDeclaration') declare(node, current);
      else if (node.type === 'FunctionDeclaration') { markMutations(node, current); }
      else if (node.type === 'ExpressionStatement') {
        const expression = node.expression;
        const left = expression.left;
        if (expression.type === 'AssignmentExpression' && left?.type === 'MemberExpression' &&
            (left.object.name === 'exports' || left.object.name === 'module' && keyOf(left.property) === 'exports' ||
              left.object.type === 'MemberExpression' && left.object.object.name === 'module' && keyOf(left.object.property) === 'exports')) {
          if (left.computed && left.property.type !== 'Literal') { risks.add('无法确定 CommonJS 导出名称'); continue; }
          if (left.object.type === 'MemberExpression') {
            exports.set('$commonjs', { type: 'StaticObjectUpdate', expression: exports.get('$commonjs') || candidates([Object.create(null)]),
              key: candidates([keyOf(left.property)]), value: deferred(expression.right, current) });
          } else if (left.object.name === 'exports') exports.set(keyOf(left.property), deferred(expression.right, current));
          else exports.set('$commonjs', deferred(expression.right, current));
        } else if (expression.type === 'AssignmentExpression' || expression.type === 'UpdateExpression') assign(expression, current, risks);
        else {
          if (['NewExpression', 'CallExpression'].includes(expression.type)) {
            expression.arguments.forEach((argument) => installVue(argument, current, risks));
          }
          if (expression.type === 'CallExpression' && expression.callee.type === 'Identifier') {
            const callable = current.get(expression.callee.name);
            if (callable?.type === 'StaticCandidates') for (const fn of callable.values) {
              if (fn?.type === 'StaticFunction') markMutations(fn.node, current);
            }
          }
          markMutations(expression, current);
        }
      } else if (node.type === 'BlockStatement') {
        const localNames = new Set(node.body.filter((n) => n.type === 'VariableDeclaration' && n.kind !== 'var')
          .flatMap((n) => n.declarations.flatMap((d) => patternNames(d.id))));
        const local = collectData([{ ...record, content: record.content.slice(node.start + 1, node.end - 1) }], risks,
          { ...options, scope: new Map(current), exports: new Map() });
        for (const [name, value] of local) if (!localNames.has(name)) current.set(name, value);
      } else if (!['EmptyStatement', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) markMutations(node, current);
      if (node.type === 'VariableDeclaration') {
        for (const declaration of node.declarations) {
          if (['NewExpression', 'CallExpression'].includes(declaration.init?.type)) declaration.init.arguments.forEach((arg) => installVue(arg, current, risks));
        }
      }
      if (statement.type === 'ExportNamedDeclaration') {
        if (statement.source) {
          const imported = moduleFor(statement.source.value, record);
          for (const specifier of statement.specifiers) exports.set(keyOf(specifier.exported), { type: 'StaticExport', exports: imported, name: keyOf(specifier.local) });
        } else if (statement.declaration) {
          const names = node.type === 'VariableDeclaration' ? node.declarations.flatMap((d) => patternNames(d.id)) : [node.id?.name];
          names.filter(Boolean).forEach((name) => exports.set(name, { type: 'StaticReference', scope: current, name }));
        } else statement.specifiers.forEach((specifier) => exports.set(keyOf(specifier.exported), { type: 'StaticReference', scope: current, name: keyOf(specifier.local) }));
      }
      if (statement.type === 'ExportAllDeclaration') {
        for (const [name, value] of moduleFor(statement.source.value, record)) if (name !== 'default') exports.set(name, value);
      }
    }
  }
  return scope;
}

function evaluateFunction(fn, args, risks, depth) {
  if (!fn || fn.type !== 'StaticFunction' || !Array.isArray(fn.node?.params) || fn.node.async || fn.node.generator) {
    risks.add('无法静态执行非纯函数或异步函数'); return [];
  }
  const scope = new Map(fn.scope);
  if (fn.loader) scope.set('$require', fn.loader);
  scope.set('$this', fn.thisScope || new Map());
  fn.node.params.forEach((param, index) => bindPattern(param, candidates([args[index]]), scope));
  if (fn.node.body.type !== 'BlockStatement') return evaluate(fn.node.body, scope, risks, depth + 1);
  let steps = 0;
  const run = (statement, env) => {
    if (++steps > 500) { risks.add('纯函数分析超过语句上限 500'); return [{ env, done: true, values: [] }]; }
    if (statement.type === 'ReturnStatement') return [{ env, done: true,
      values: statement.argument ? evaluate(statement.argument, env, risks, depth + 1) : [undefined] }];
    if (statement.type === 'VariableDeclaration') { declare(statement, env); return [{ env }]; }
    if (statement.type === 'EmptyStatement') return [{ env }];
    if (statement.type === 'BlockStatement') {
      const locals = new Set(statement.body.filter((item) => item.type === 'VariableDeclaration')
        .flatMap((item) => item.declarations.flatMap((declaration) => patternNames(declaration.id))));
      return walk(statement.body, new Map(env)).map((state) => {
        const outer = new Map(env);
        for (const [name, value] of state.env) if (env.has(name) && !locals.has(name)) outer.set(name, value);
        return { ...state, env: outer };
      });
    }
    if (statement.type === 'IfStatement') {
      const tests = evaluate(statement.test, env, risks, depth + 1);
      const branches = tests.length ? [...new Set(tests.map(Boolean))] : [true, false];
      return branches.flatMap((truthy) => {
        const branch = truthy ? statement.consequent : statement.alternate;
        return branch ? run(branch, new Map(env)) : [{ env: new Map(env) }];
      });
    }
    risks.add('纯函数包含未支持或有副作用的语句: ' + statement.type);
    return [{ env, done: true, values: [] }];
  };
  const walk = (statements, env) => {
    let states = [{ env }];
    for (const statement of statements) states = limit(states.flatMap((state) => state.done ? [state] : run(statement, state.env)), risks);
    return states;
  };
  return limit(walk(fn.node.body.body, scope).flatMap((state) => state.done ? state.values : [undefined]), risks);
}

function evaluate(node, values, risks, depth = 0) {
  if (depth > MAX_DEPTH) { risks.add(`静态求值递归超过上限 ${MAX_DEPTH}`); return []; }
  if (!node) { risks.add('缺少可解析的动态表达式'); return []; }
  const next = (value, scope = values) => evaluate(value, scope, risks, depth + 1);
  const product = (groups) => groups.reduce((rows, group) => limit(rows.flatMap((row) => group.map((item) => [...row, item])), risks), [[]]);
  switch (node.type) {
    case 'StaticCandidates': return limit(node.values, risks).filter((value) => {
      if (value !== UNKNOWN) return true;
      risks.add('绑定值包含无法确定的分支'); return false;
    });
    case 'StaticExpression': return next(node.expression, node.scope);
    case 'StaticAlternatives': return limit(node.branches.flatMap((branch) => next(branch.expression, branch.scope)), risks);
    case 'StaticVueData': {
      const children = next(node.child);
      const parents = next(node.parent);
      return parents.length ? limit(parents.flatMap((parent) => children.map((child) => mergeVueData(parent, child, risks))), risks) : children;
    }
    case 'StaticReference': return next({ type: 'Identifier', name: node.name }, node.scope);
    case 'StaticUncertain': risks.add(node.reason); return next(node.expression);
    case 'StaticUnknown': risks.add(node.reason); return [];
    case 'StaticDefault': { const result = next(node.expression); return result.flatMap((value) => value === undefined ? next(node.fallback) : [value]); }
    case 'StaticNamespace': {
      const entries = [...node.exports].filter(([key]) => !key.startsWith('$'));
      return product(entries.map(([, value]) => next(value, node.exports))).map((row) => Object.fromEntries(entries.map(([key], index) => [key, row[index]])));
    }
    case 'StaticExport': {
      if (!node.exports.has(node.name)) {
        if (node.exports.has('$commonjs')) {
          const exported = next(node.exports.get('$commonjs'), node.exports);
          if (node.name === 'default') return exported;
          const result = exported.flatMap((value) => value && own(value, node.name) ? [value[node.name]] : []);
          if (!result.length) risks.add('模块缺少导出: ' + node.name);
          return result;
        }
        risks.add(`模块缺少导出: ${node.name}`); return [];
      }
      return next(node.exports.get(node.name), node.exports);
    }
    case 'Literal': return [node.value];
    case 'Identifier': {
      if (!values.has(node.name)) { risks.add(`未解析动态绑定: ${node.name}`); return []; }
      return next(values.get(node.name));
    }
    case 'ParenthesizedExpression': return next(node.expression);
    case 'ChainExpression': return next(node.expression).map((value) => value === OPTIONAL_EMPTY ? undefined : value);
    case 'ArrayExpression': return product(node.elements.map((element) => {
      const result = element ? next(element) : [undefined];
      return result.length ? result : [UNKNOWN];
    }));
    case 'ObjectExpression': {
      let output = [Object.create(null)];
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.kind !== 'init') { risks.add('无法静态解析对象展开、方法或 getter'); return []; }
        const keys = property.computed ? next(property.key) : [keyOf(property.key)];
        const result = next(property.value);
        const items = result.length ? result : [UNKNOWN];
        output = limit(output.flatMap((object) => keys.flatMap((key) => items.map((value) => Object.assign(Object.create(null), object, { [key]: value })))), risks);
      }
      return output;
    }
    case 'StaticObjectUpdate': {
      return product([next(node.expression), next(node.key), next(node.value)]).map(([object, key, value]) => {
        if (!object || typeof object !== 'object') { risks.add('无法对非对象应用属性赋值'); return undefined; }
        return Object.assign(Array.isArray(object) ? [...object] : Object.create(null), object, { [key]: value });
      });
    }
    case 'MemberExpression': {
      if (node.object.type === 'ThisExpression') {
        const keys = node.computed ? next(node.property) : [keyOf(node.property)];
        return limit(keys.flatMap((key) => next({ type: 'Identifier', name: key }, values.get('$this') || values)), risks);
      }
      const objects = next(node.object);
      const keys = node.computed ? next(node.property) : [keyOf(node.property)];
      const output = [];
      for (const object of objects) {
        if (object === OPTIONAL_EMPTY || object == null && node.optional) { output.push(OPTIONAL_EMPTY); continue; }
        if (object === UNKNOWN) { risks.add('属性所属对象无法确定'); continue; }
        if (object == null) { risks.add('动态索引或属性没有可确定的源码值'); continue; }
        let selected = keys;
        if (!keys.length && node.computed) {
          risks.add('动态索引无法静态确定，已展开已知分支'); selected = Object.keys(Object(object));
        }
        for (const key of selected) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) { risks.add('禁止访问动态对象的原型属性'); continue; }
          if (own(Object(object), key)) {
            if (object[key] === UNKNOWN) risks.add('属性包含无法确定的源码值: ' + String(key));
            else output.push(object[key]);
          }
          else if (key === 'length' && (Array.isArray(object) || typeof object === 'string')) output.push(object.length);
          else output.push(undefined);
        }
      }
      return limit(output, risks);
    }
    case 'ConditionalExpression': {
      const tests = next(node.test);
      const outcomes = tests.length ? [...new Set(tests.map(Boolean))] : [true, false];
      return limit(outcomes.flatMap((value) => next(value ? node.consequent : node.alternate)), risks);
    }
    case 'LogicalExpression': {
      const left = next(node.left);
      if (!left.length) return next(node.right);
      return limit(left.flatMap((value) => (node.operator === '&&' ? Boolean(value) : node.operator === '??' ? value == null : !value) ? next(node.right) : [value]), risks);
    }
    case 'TemplateLiteral': {
      let parts = [''];
      node.quasis.forEach((part, index) => {
        parts = parts.map((value) => value + part.value.cooked);
        if (index < node.expressions.length) parts = limit(parts.flatMap((value) => next(node.expressions[index]).map((added) => value + String(added))), risks);
      });
      return parts;
    }
    case 'UnaryExpression': {
      const operations = { '+': (v) => +v, '-': (v) => -v, '!': (v) => !v, '~': (v) => ~v, typeof: (v) => typeof v, void: () => undefined };
      if (!own(operations, node.operator)) { risks.add(`未支持的一元运算: ${node.operator}`); return []; }
      return next(node.argument).map(operations[node.operator]);
    }
    case 'BinaryExpression': {
      const operations = {
        '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b, '**': (a, b) => a ** b,
        '===': (a, b) => a === b, '!==': (a, b) => a !== b, '==': (a, b) => a == b, '!=': (a, b) => a != b,
        '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
        '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b, '<<': (a, b) => a << b, '>>': (a, b) => a >> b, '>>>': (a, b) => a >>> b,
      };
      if (!own(operations, node.operator)) { risks.add(`未支持的二元运算: ${node.operator}`); return []; }
      return product([next(node.left), next(node.right)]).flatMap(([a, b]) => {
        if ([a, b].some((value) => value !== null && typeof value === 'object')) { risks.add('无法安全确定对象参与运算后的文字'); return []; }
        try { return [operations[node.operator](a, b)]; } catch { risks.add(`无法计算运算: ${node.operator}`); return []; }
      });
    }
    case 'FunctionExpression': case 'ArrowFunctionExpression': return [functionValue(node, values)];
    case 'CallExpression': {
      const args = product(node.arguments.map((argument) => next(argument)));
      if (node.callee.type === 'Identifier' && !values.has(node.callee.name) && ['String', 'Number', 'Boolean'].includes(node.callee.name)) {
        const convert = { String, Number, Boolean }[node.callee.name];
        return args.flatMap((row) => {
          if (row.some((value) => value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof value))) {
            risks.add('内置转换仅支持原始值'); return [];
          }
          return [row.length ? convert(row[0]) : convert()];
        });
      }
      if (node.callee.type === 'MemberExpression' && node.callee.object.type !== 'ThisExpression') {
        const member = node.callee;
        const objects = next(member.object);
        const names = member.computed ? next(member.property) : [keyOf(member.property)];
        return limit(objects.flatMap((object) => names.flatMap((name) => args.flatMap((row) => {
          if (object === OPTIONAL_EMPTY || object == null && (member.optional || node.optional)) return [OPTIONAL_EMPTY];
          if (Array.isArray(object) && name === 'map') {
            return product(limit(object, risks).map((item, index) => evaluateFunction(row[0], [item, index, object], risks, depth + 1)));
          }
          const stringMethods = ['trim', 'trimStart', 'trimEnd', 'toUpperCase', 'toLowerCase', 'slice', 'substring', 'substr', 'concat', 'replace', 'replaceAll', 'split', 'includes', 'startsWith', 'endsWith', 'charAt'];
          const arrayMethods = ['join', 'slice', 'concat', 'includes', 'indexOf'];
          const prototype = typeof object === 'string' && stringMethods.includes(name) ? String.prototype :
            Array.isArray(object) && arrayMethods.includes(name) ? Array.prototype : null;
          const primitive = (value) => value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
          if (prototype && row.every(primitive) && (!Array.isArray(object) || object.every(primitive))) {
            try { return [prototype[name].apply(object, row)]; }
            catch { risks.add('无法计算纯方法: ' + name); return []; }
          }
          if (object && own(object, name) && object[name]?.type === 'StaticFunction') return evaluateFunction(object[name], row, risks, depth + 1);
          risks.add('未支持或无法安全求值的方法: ' + String(name)); return [];
        }))), risks);
      }
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
        const loader = values.get('$require');
        const specifiers = node.arguments.length === 1 ? next(node.arguments[0]) : [];
        if (!loader || !specifiers.length || specifiers.some((value) => typeof value !== 'string')) { risks.add('无法确定 require 本地模块路径'); return []; }
        return limit(specifiers.flatMap((specifier) => loader.load(specifier, risks, depth + 1)), risks);
      }
      const functions = next(node.callee);
      if (node.optional && functions.every((fn) => fn == null)) return [OPTIONAL_EMPTY];
      return limit(functions.flatMap((fn) => args.flatMap((row) => evaluateFunction(fn, row, risks, depth + 1))), risks);
    }
    default: risks.add(`无法静态求值的表达式: ${node.type}`); return [];
  }
}

function evaluateText(expression, values, risks) {
  const ast = parseExpression(expression);
  if (!ast) { risks.add(`无法解析动态表达式: ${expression}`); return []; }
  // Vue 2 filters use a top-level pipe, not JavaScript bitwise-OR semantics.
  let depth = 0;
  try {
    for (const token of acorn.tokenizer(expression, { ecmaVersion: 'latest' })) {
      if (['(', '[', '{', '${'].includes(token.type.label)) depth += 1;
      else if ([')', ']', '}'].includes(token.type.label)) depth -= 1;
      else if (token.value === '|' && depth === 0) { risks.add(`未支持的 Vue 过滤器: ${expression}`); return []; }
    }
    return evaluate(ast, values, risks);
  } catch (error) { risks.add(`静态表达式求值失败: ${error.message}`); return []; }
}

function visibleValues(expression, values, risks, html = false) {
  return evaluateText(expression, values, risks).flatMap((item) => {
    if (item == null) return [];
    if (!['string', 'number', 'boolean'].includes(typeof item)) { risks.add('展示表达式不是可确定的文本值'); return []; }
    return [html ? String(item).replace(/<[^>]*>/g, '') : String(item)];
  });
}

module.exports = { collectData, visibleValues, parseExpression, evaluate, evaluateText, limit, candidates };
