'use strict';

// Keep face IDs in the existing string-to-string worker protocol without mixing
// a family total with per-file character sets.
function faceCharacterKey(key) {
  return '\u0000face:' + key;
}

function weightRange(value) {
  const normalized = String(value ?? 'normal').trim().toLowerCase();
  if (normalized === 'normal') return [400, 400];
  if (normalized === 'bold') return [700, 700];
  const numbers = normalized.split(/\s+/).map(Number);
  if (numbers.length > 2 || numbers.some((n) => !Number.isFinite(n) || n < 1 || n > 1000)) return null;
  return [Math.min(...numbers), Math.max(...numbers)];
}

function styleKind(value) {
  const match = String(value ?? 'normal').trim().match(/^(normal|italic|oblique)(?:\s|$)/i);
  return match ? match[1].toLowerCase() : null;
}

function computedWeight(value, inherited = 400) {
  const word = String(value).toLowerCase();
  if (word === 'bolder' || word === 'lighter') {
    if (inherited === null) return null;
    if (word === 'bolder') return inherited < 350 ? 400 : inherited < 550 ? 700 : 900;
    return inherited < 550 ? 100 : inherited < 750 ? 400 : 700;
  }
  const range = weightRange(value);
  return range && range[0] === range[1] ? range[0] : null;
}

function matchFontFaces(faces, family, weight, style) {
  let matches = faces.filter((face) => face.family.toLowerCase() === family.toLowerCase());
  const kind = styleKind(style);
  if (style !== null && kind) {
    const preferences = kind === 'normal' ? ['normal', 'oblique', 'italic'] : kind === 'italic'
      ? ['italic', 'oblique', 'normal'] : ['oblique', 'italic', 'normal'];
    const chosen = preferences.find((candidate) => matches.some((face) => styleKind(face.style) === candidate));
    matches = matches.filter((face) => !styleKind(face.style) || styleKind(face.style) === chosen);
  }
  const target = weight === null ? null : computedWeight(weight);
  if (target === null) return matches;
  // CSS weight search: 400..500 first searches up to 500, then below,
  // then above 500. Other weights search their preferred side first.
  const rank = (face) => {
    const range = weightRange(face.weight);
    if (!range) return null;
    const nearest = Math.max(range[0], Math.min(target, range[1]));
    if (nearest === target) return [0, 0];
    if (target >= 400 && target <= 500) {
      if (nearest > target && nearest <= 500) return [1, nearest - target];
      if (nearest < target) return [2, target - nearest];
      return [3, nearest - target];
    }
    const preferred = target < 400 ? nearest < target : nearest > target;
    return [preferred ? 1 : 2, Math.abs(nearest - target)];
  };
  const ranks = matches.map(rank).filter(Boolean).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const best = ranks[0];
  return matches.filter((face) => {
    const value = rank(face);
    return !value || !best || (value[0] === best[0] && value[1] === best[1]);
  });
}

function addFaceCharacters(target, faces, record) {
  if (Array.isArray(record.availableFaces)) {
    faces = faces.filter((face) => record.availableFaces.some((available) =>
      available.family.toLowerCase() === face.family.toLowerCase() &&
      JSON.stringify(weightRange(available.weight)) === JSON.stringify(weightRange(face.weight)) &&
      styleKind(available.style) === styleKind(face.style)));
  }
  for (const weight of record.weights || [record.fontWeight ?? null]) {
    for (const style of record.styles || [record.fontStyle ?? null]) {
      for (const face of matchFontFaces(faces, record.family, weight, style)) {
        if (face.key === null) continue;
        const key = faceCharacterKey(face.key);
        if (!target[key]) target[key] = new Set();
        for (const character of record.text) target[key].add(character);
      }
    }
  }
}

module.exports = { faceCharacterKey, weightRange, styleKind, computedWeight, matchFontFaces, addFaceCharacters };
