'use strict';

// Resolve custom property values without evaluating text inside CSS strings.
function variableCalls(value) {
  const calls = [];
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') { index += 1; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (value.slice(index, index + 4) !== 'var(' || /[\w-]/.test(value[index - 1] || '')) continue;
    const start = index;
    let depth = 1;
    let comma = -1;
    for (index += 4; index < value.length; index += 1) {
      const current = value[index];
      if (current === '\\') { index += 1; continue; }
      if (quote) { if (current === quote) quote = ''; continue; }
      if (current === '"' || current === "'") { quote = current; continue; }
      if (current === '(') depth += 1;
      if (current === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      if (current === ',' && depth === 1 && comma < 0) comma = index;
    }
    if (depth !== 0) return null;
    calls.push({ start, end: index + 1,
      name: value.slice(start + 4, comma < 0 ? index : comma).trim(),
      fallback: comma < 0 ? null : value.slice(comma + 1, index) });
  }
  return calls;
}

function resolveCssVariables(value, lookup, visiting = new Set(), depth = 0) {
  if (depth >= 100 || visiting.size >= 100) return [null];
  const calls = variableCalls(value);
  if (!calls) return [null];
  let results = [''];
  let end = 0;
  for (const call of calls) {
    let replacements = [null];
    if (/^--[^\s,()]+$/.test(call.name) && !visiting.has(call.name)) {
      replacements = lookup(call.name, new Set([...visiting, call.name]));
    }
    replacements = replacements.flatMap(replacement => replacement === null && call.fallback !== null
      ? resolveCssVariables(call.fallback, lookup, visiting, depth + 1) : [replacement]);
    const prefix = value.slice(end, call.start);
    results = [...new Set(results.flatMap(result => replacements.map(replacement =>
      result === null || replacement === null || result.length + prefix.length + replacement.length > 65536
        ? null : result + prefix + replacement)))].slice(0, 100);
    end = call.end;
  }
  return results.map(result => result === null ? null : result + value.slice(end));
}

function computeCustomProperties(raw, inherited) {
  const dependencies = (value, depth = 0) => {
    if (value === null || depth >= 100) return [];
    return (variableCalls(value) || []).flatMap(call => [call.name,
      ...(call.fallback === null ? [] : dependencies(call.fallback, depth + 1))]);
  };
  const state = new Map();
  const invalid = new Set();
  const stack = [];
  const visit = name => {
    if (!raw.has(name) || state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      const cycle = stack.slice(stack.indexOf(name));
      // Conditional definitions have valid and invalid branches. Keep their
      // alternatives rather than invalidating an otherwise valid base value.
      if (cycle.every(member => raw.get(member).length === 1)) {
        for (const member of cycle) invalid.add(member);
      }
      return;
    }
    if (stack.length >= 100) { invalid.add(name); return; }
    state.set(name, 'visiting');
    stack.push(name);
    for (const value of raw.get(name)) for (const dependency of dependencies(value)) visit(dependency);
    stack.pop();
    state.set(name, 'done');
  };
  for (const name of raw.keys()) visit(name);
  const cache = new Map();
  const lookup = (name, visiting) => {
    if (!raw.has(name)) return inherited.get(name) || [null];
    if (invalid.has(name)) return [null];
    if (!cache.has(name)) cache.set(name, [...new Set(raw.get(name).flatMap(value =>
      value === null ? [null] : resolveCssVariables(value, lookup, visiting)))]);
    return cache.get(name);
  };
  const computed = new Map(inherited);
  for (const name of raw.keys()) computed.set(name, lookup(name, new Set([name])));
  return computed;
}

module.exports = { resolveCssVariables, computeCustomProperties };
