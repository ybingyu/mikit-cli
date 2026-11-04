const { createDirectoryExclusion } = require('./directory-exclusion');
const { spawnSync } = require("child_process");
const fs = require("fs");
const glob = require("glob");
const path = require("path");

const { getDeclaredFontFamily, getDeclaredFontTrait } = require('./font-css');
const postcss = require('postcss');
const { resolveCssVariables, computeCustomProperties } = require('./font-css-variables');
const { faceCharacterKey, computedWeight, styleKind, addFaceCharacters } = require('./font-face-matcher');
const { renderFontReport, relevantRisks } = require('./font-report');
const { loadFontRuntimeConfig } = require("./font-runtime-config");
const { collectData, visibleValues, evaluateText, limit, candidates } = require('./font-static-text');
const { createPageAnalysis } = require('./font-static-pages');
const { analyzePageStateParameters } = require('./font-state-parameters');
const { runRuntimeFontCollectorSync } = require("./font-runtime-runner");

const FONT_EXT_RE = /\.(?:eot|ttf|otf|woff2?|svg)(?:[?#].*)?$/i;
const TTF_EXT_RE = /\.ttf$/i;
const OUTPUT_FONT_EXT_RE = /\.(?:ttf|woff2?)$/i;
const SUBSET_RE = /-subset/i;
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function normalizeCssUrl(url) {
  return url.trim().replace(/^['"]|['"]$/g, "");
}

function isHttpFontUrl(url) {
  return /^https?:\/\//i.test(url) && FONT_EXT_RE.test(url);
}

function isLocalFontUrl(url) {
  return !/^(?:https?:)?\/\//i.test(url) && FONT_EXT_RE.test(url);
}

function stripUrlSuffix(fileName) {
  return fileName.replace(/[?#].*$/, "");
}

function getFontNameFromUrl(url) {
  const cleanUrl = stripUrlSuffix(url);
  return path.basename(cleanUrl, path.extname(cleanUrl));
}

function getFontNameFromFile(file) {
  return path.basename(
    stripUrlSuffix(file),
    path.extname(stripUrlSuffix(file)),
  );
}

function collectCssFiles(dir, excludedDirectories = []) {
  const { globIgnore } = createDirectoryExclusion(excludedDirectories);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return glob
    .sync("**/*.css", { cwd: dir, absolute: true, nodir: true, ignore: globIgnore() })
    .map((filePath) => {
      return {
        filePath,
        content: fs.readFileSync(filePath, "utf8"),
      };
    });
}

function collectInlineCssFiles(htmlTargets) {
  return htmlTargets.flatMap((filePath) => {
    const html = fs.readFileSync(filePath, 'utf8');
    return Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi),
      (match) => ({ filePath, content: match[1] }));
  });
}

function getFontKey(fontPath, fontDir) {
  const relativePath = path.relative(fontDir, fontPath);
  return relativePath.slice(0, -path.extname(relativePath).length);
}

function resolveLocalFontPath(url, cssFile, fontDir) {
  if (!cssFile.filePath || !isLocalFontUrl(url)) return null;
  const fontUrl = stripUrlSuffix(url).replace(/\\/g, '/');
  const resolved = fontUrl.startsWith('/')
    ? path.resolve(path.dirname(fontDir), '.' + fontUrl)
    : path.resolve(path.dirname(cssFile.filePath), fontUrl);
  return isPathOutside(fontDir, resolved) ? null : resolved;
}

function collectFontUrls(content) {
  const urls = [];
  const urlRe = /url\(([^)]+)\)/gi;
  let match;

  while ((match = urlRe.exec(content))) {
    urls.push(normalizeCssUrl(match[1]));
  }

  return urls;
}

function collectFontFamilyMappings(cssFiles, fontDir, isExcluded = () => false) {
  const fontFamilyByName = new Map();
  const fontFamilyByPath = new Map();
  const fontFaces = [];

  cssFiles.forEach((cssFile) => {
    const fontFaceRe = /@font-face\s*\{([^{}]*)\}/gi;
    let match;

    while ((match = fontFaceRe.exec(cssFile.content))) {
      const familyMatch = match[1].match(
        /(?:^|;)\s*font-family\s*:\s*([^;}]+)/i,
      );
      if (!familyMatch) {
        continue;
      }

      const fontFamily = normalizeFontFamily(familyMatch[1]);
      const weight = getDeclaredFontTrait(match[1], 'font-weight')?.value ?? 'normal';
      const style = getDeclaredFontTrait(match[1], 'font-style')?.value ?? 'normal';
      collectFontUrls(match[1]).forEach((url) => {
        if (FONT_EXT_RE.test(url)) {
          const resolved = resolveLocalFontPath(url, cssFile, fontDir);
          if (resolved && isExcluded(resolved)) return;
          fontFamilyByName.set(getFontNameFromUrl(url), fontFamily);
          if (resolved) {
            fontFamilyByPath.set(getFontKey(resolved, fontDir), fontFamily);
          }
          const key = resolved ? getFontKey(resolved, fontDir) : cssFile.filePath ? null : getFontNameFromUrl(url);
          if (!fontFaces.some((face) => face.key === key && face.family === fontFamily && face.weight === weight && face.style === style)) {
            fontFaces.push({ key, family: fontFamily, weight, style });
          }
        }
      });
    }
  });

  return { fontFamilyByName, fontFamilyByPath, fontFaces };
}

function createFontPlan({ fontDir, sourceFontDir = fontDir, cssFiles, ttfFiles = [], fontFiles = ttfFiles, isExcluded = () => false }) {
  const localFontNames = new Set();
  const remoteFontNames = new Set();
  const formatsByFontKey = new Map();
  const formatsByName = new Map();
  const { fontFamilyByName, fontFamilyByPath, fontFaces } = collectFontFamilyMappings(
    cssFiles, fontDir, isExcluded,
  );

  cssFiles.forEach((cssFile) => {
    collectFontUrls(cssFile.content).forEach((url) => {
      if (isHttpFontUrl(url)) {
        remoteFontNames.add(getFontNameFromUrl(url));
        return;
      }

      if (!isLocalFontUrl(url)) return;
      const fontName = getFontNameFromUrl(url);
      localFontNames.add(fontName);
      const extension = path.extname(stripUrlSuffix(url)).slice(1).toLowerCase();
      if (!OUTPUT_FONT_EXT_RE.test(`.${extension}`)) return;
      const resolved = resolveLocalFontPath(url, cssFile, fontDir);
      if (resolved && isExcluded(resolved)) return;
      const map = resolved ? formatsByFontKey : formatsByName;
      const key = resolved ? getFontKey(resolved, fontDir) : fontName;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(extension);
    });
  });

  const useNameFallback = !cssFiles.some((cssFile) => cssFile.filePath);
  if (useNameFallback) {
    ttfFiles.forEach((file) => {
      const formats = formatsByName.get(getFontNameFromFile(file));
      if (formats) {
        formatsByFontKey.set(getFontKey(path.join(fontDir, file), fontDir), formats);
      }
    });
  }

  const availableFiles = new Set(fontFiles.map((file) => path.normalize(file)));
  const fontPathsToSubset = [];
  formatsByFontKey.forEach((formats, fontKey) => {
    const candidates = ['ttf', 'woff', 'woff2'];
    const input = candidates
      .map((format) => path.join(fontDir, `${fontKey}.${format}`))
      .find((file) => availableFiles.has(
        path.normalize(path.relative(fontDir, file))));
    if (!input) {
      const expected = path.join(sourceFontDir, `${fontKey}.${candidates[0]}`);
      throw new Error(`缺少可用的字体原文件: ${expected}`);
    }
    fontPathsToSubset.push(input);
  });

  return {
    localFontNames,
    remoteFontNames,
    fontFamilyByName,
    fontFamilyByPath,
    fontFaces,
    formatsByFontKey,
    fontPathsToSubset,
    ttfFilesToSubset: fontPathsToSubset.filter((file) => TTF_EXT_RE.test(file)),
  };
}

function getRemoteFontFilesToRemove({
  fontDir,
  fontFiles,
  remoteFontNames,
  localFontNames,
}) {
  return fontFiles
    .filter((file) => FONT_EXT_RE.test(file) && !SUBSET_RE.test(file))
    .filter((file) => {
      const fontName = getFontNameFromFile(file);
      return remoteFontNames.has(fontName) && !localFontNames.has(fontName);
    })
    .map((file) => path.join(fontDir, file));
}

function isPathOutside(rootPath, targetPath) {
  const relativeTarget = path.relative(rootPath, targetPath);
  return (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  );
}

function deriveHtmlTargetFromUrl(url, outputDir, dependencies = {}) {
  const {
    existsSync = fs.existsSync,
    realpathSync = fs.realpathSync,
  } = dependencies;
  const parsedUrl = new URL(url);
  let pathname;

  try {
    pathname = decodeURIComponent(parsedUrl.pathname).replace(/\\/g, "/");
  } catch (error) {
    if (error instanceof URIError) {
      throw new Error(`运行时页面无法映射到构建目录：${url}`);
    }
    throw error;
  }

  if (pathname.endsWith("/")) {
    pathname += "index.html";
  } else if (/\.shtml$/i.test(pathname)) {
    pathname = pathname.replace(/\.shtml$/i, ".html");
  } else if (!/\.html$/i.test(pathname)) {
    return null;
  }

  const normalizedOutputDir = path.resolve(outputDir);
  const target = path.resolve(normalizedOutputDir, pathname.replace(/^\/+/, ""));

  if (isPathOutside(normalizedOutputDir, target)) {
    throw new Error(`运行时页面无法映射到构建目录：${url}`);
  }

  if (dependencies.isExcluded && dependencies.isExcluded(target)) return target;

  if (existsSync(normalizedOutputDir)) {
    const realOutputDir = realpathSync(normalizedOutputDir);
    if (existsSync(target)) {
      const realTarget = realpathSync(target);
      if (isPathOutside(realOutputDir, realTarget)) {
        throw new Error(`运行时页面无法映射到构建目录：${url}`);
      }
    }
  }

  return target;
}

function collectBuiltShtmlTargets({ sourceDir, outputDir, excludedDirectories = [] }) {
  const { globIgnore } = createDirectoryExclusion(excludedDirectories);
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return null;
  }

  const relativeSourcePages = glob.sync("**/*.shtml", {
    cwd: path.resolve(sourceDir),
    nodir: true,
    ignore: globIgnore(["**/_*.shtml", "node_modules/**", ".git/**"],
      file => path.resolve(outputDir, path.relative(sourceDir, file))),
  });
  if (relativeSourcePages.length === 0) {
    return null;
  }

  return relativeSourcePages
    .map((relativePath) =>
      path.resolve(outputDir, relativePath.replace(/\.shtml$/i, ".html")),
    )
    .filter((target) => fs.existsSync(target));
}

function collectHtmlTargets({
  outputDir,
  sourceDir,
  fontPage,
  pages = [],
  warn = console.warn,
  platform = process.platform,
  excludedDirectories = [],
}) {
  const { isExcluded, globIgnore } = createDirectoryExclusion(excludedDirectories);
  const normalizedOutputDir = path.resolve(outputDir);
  let staticTargets = [];

  if (fs.existsSync(normalizedOutputDir)) {
    if (fontPage) {
      const requestedTargets = glob.sync(fontPage, {
        cwd: normalizedOutputDir,
        absolute: true,
        nodir: true,
        ignore: globIgnore(),
      });
      staticTargets =
        requestedTargets.length > 0
          ? requestedTargets
          : glob.sync("*.html", {
              cwd: normalizedOutputDir,
              absolute: true,
              nodir: true,
              ignore: globIgnore(),
            });
    } else {
      const builtShtmlTargets = collectBuiltShtmlTargets({
        sourceDir,
        outputDir: normalizedOutputDir,
        excludedDirectories,
      });
      staticTargets =
        builtShtmlTargets === null
          ? glob.sync("**/*.html", {
              cwd: normalizedOutputDir,
              absolute: true,
              nodir: true,
              ignore: globIgnore(["**/_*.html"]),
            })
          : builtShtmlTargets;
    }
  }

  const targets = [];
  const seenTargets = new Set();
  const processedRuntimeTargets = new Set();
  const warnedUnsupportedUrls = new Set();
  const getTargetKey = (target) => {
    const normalizedTarget = path.resolve(target);
    return platform === "win32"
      ? normalizedTarget.toLowerCase()
      : normalizedTarget;
  };
  const addTarget = (target) => {
    const normalizedTarget = path.resolve(target);
    if (isExcluded(normalizedTarget)) return;
    const targetKey = getTargetKey(normalizedTarget);
    if (!seenTargets.has(targetKey)) {
      seenTargets.add(targetKey);
      targets.push(normalizedTarget);
    }
  };

  staticTargets.sort().forEach(addTarget);
  pages.forEach((url) => {
    const target = deriveHtmlTargetFromUrl(url, normalizedOutputDir, { isExcluded });
    if (!target) {
      if (!warnedUnsupportedUrls.has(url)) {
        warnedUnsupportedUrls.add(url);
        warn(`[mikit font] 无法将运行时 URL 映射为本地 HTML：${url}`);
      }
      return;
    }

    if (isExcluded(target)) return;
    const targetKey = getTargetKey(target);
    if (processedRuntimeTargets.has(targetKey)) {
      return;
    }
    processedRuntimeTargets.add(targetKey);

    if (!fs.existsSync(target)) {
      warn(`[mikit font] 运行时 URL 对应的本地 HTML 不存在：${target}`);
      return;
    }

    addTarget(target);
  });

  return targets;
}

function createPyftsubsetArgs({ fontPath, outputPath, textPath, flavor }) {
  const args = [
    fontPath,
    `--output-file=${outputPath}`,
    `--text-file=${textPath}`,
    "--layout-features=*",
    "--name-IDs+=13,14",
    "--name-languages=*",
    "--name-legacy",
  ];

  if (flavor) {
    args.push(`--flavor=${flavor}`);
  }

  return args;
}

function decodeHtmlEntities(text) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    copy: "©",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
    times: "×",
  };

  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (/^#x/i.test(entity)) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return namedEntities[entity.toLowerCase()] || match;
  });
}

function parseHtmlAttributes(source) {
  const attributes = {};
  const attributeRe =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attributeRe.exec(source))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

function parseHtml(html) {
  const root = {
    type: "element",
    tagName: "#root",
    attributes: {},
    children: [],
    parent: null,
  };
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z](?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  let lastIndex = 0;
  let match;

  const appendText = (value) => {
    if (value) {
      stack[stack.length - 1].children.push({ type: "text", value });
    }
  };

  while ((match = tokenRe.exec(html))) {
    appendText(html.slice(lastIndex, match.index));
    const token = match[0];
    lastIndex = tokenRe.lastIndex;

    if (/^<!/i.test(token)) {
      continue;
    }

    const closingMatch = token.match(/^<\/\s*([^\s>]+)/);
    if (closingMatch) {
      const closingTag = closingMatch[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tagName === closingTag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }

    const openingMatch = token.match(/^<\s*([^\s/>]+)/);
    if (!openingMatch) {
      continue;
    }

    const tagName = openingMatch[1].toLowerCase();
    const attributeSource = token.slice(
      openingMatch[0].length,
      token.length - 1,
    );
    const parent = stack[stack.length - 1];
    const node = {
      type: "element",
      tagName,
      attributes: parseHtmlAttributes(attributeSource),
      children: [],
      parent,
    };

    parent.children.push(node);
    if (!VOID_ELEMENTS.has(tagName) && !/\/>$/.test(token)) {
      stack.push(node);
    }
  }

  appendText(html.slice(lastIndex));
  return root;
}

function normalizeFontFamily(value) {
  return value
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function getSelectorSpecificity(selector) {
  const idCount = (selector.match(/#[\w-]+/g) || []).length;
  const classCount = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || [])
    .length;
  const tagCount = selector
    .split(/\s+/)
    .filter((part) => /^[a-z][\w-]*/i.test(part)).length;

  return [idCount, classCount, tagCount];
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function matchesSimpleSelector(node, selector) {
  if (!selector || /[>+~\[]/.test(selector)) {
    return false;
  }

  if (/:root\b/.test(selector) && node.tagName !== 'html') return false;

  const cleanSelector = selector.replace(/::?[\w-]+(?:\([^)]*\))?/g, "");
  const tagMatch = cleanSelector.match(/^[a-z][\w-]*/i);
  if (tagMatch && node.tagName !== tagMatch[0].toLowerCase()) {
    return false;
  }

  const idMatches = Array.from(
    cleanSelector.matchAll(/#([\w-]+)/g),
    (match) => match[1],
  );
  if (idMatches.some((id) => node.attributes.id !== id)) {
    return false;
  }

  const classNames = new Set(
    (node.attributes.class || "").split(/\s+/).filter(Boolean),
  );
  const classMatches = Array.from(
    cleanSelector.matchAll(/\.([\w-]+)/g),
    (match) => match[1],
  );
  return classMatches.every((className) => classNames.has(className));
}

function matchesSelector(node, selector) {
  const parts = selector
    .trim()
    .replace(/\s*>\s*/g, " > ")
    .split(/\s+/)
    .filter(Boolean);
  if (
    parts.length === 0 ||
    !matchesSimpleSelector(node, parts[parts.length - 1])
  ) {
    return false;
  }

  let current = node;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index] === ">") {
      const parent = current.parent;
      const parentSelector = parts[index - 1];
      if (!parent || !matchesSimpleSelector(parent, parentSelector)) {
        return false;
      }
      current = parent;
      index -= 1;
      continue;
    }

    let ancestor = current.parent;
    while (ancestor && !matchesSimpleSelector(ancestor, parts[index])) {
      ancestor = ancestor.parent;
    }

    if (!ancestor) {
      return false;
    }
    current = ancestor;
  }

  return true;
}

function collectFontFamilyRules(cssFiles) {
  const rules = [];
  rules.variables = [];
  for (const cssFile of cssFiles) {
    let root;
    try { root = postcss.parse(cssFile.content, { from: undefined }); }
    catch (error) { if (error.name !== 'CssSyntaxError') throw error; continue; }
    root.walkRules(rule => {
      const css = rule.nodes.filter(node => node.type === 'decl').map(node => node.toString()).join(';');
      for (const declaration of rule.nodes.filter(node => node.type === 'decl' && node.prop.startsWith('--'))) {
        for (const selector of rule.selectors) rules.variables.push({
          name: declaration.prop, value: declaration.value, important: Boolean(declaration.important), selector,
          conditional: rule.parent.type !== 'root' || /:(?!root\b)/.test(selector),
          specificity: getSelectorSpecificity(selector), order: rules.variables.length,
        });
      }
      const declaration = getDeclaredFontFamily(css);
      const variableCss = rule.nodes.filter(node => node.type === 'decl' && /^(?:font|font-family)$/i.test(node.prop))
        .map(node => node.toString()).join(';');
      const hasVariables = /var\(/.test(variableCss);
      if (!declaration && !hasVariables) return;
      for (const selector of rule.selectors) {
        rules.push({
          ...declaration, selector, variableCss: hasVariables ? variableCss : null,
          conditional: rule.parent.type !== 'root' || /:(?!root\b)/.test(selector),
          specificity: getSelectorSpecificity(selector), order: rules.length
        });
      }
    });
  }
  return rules;
}

function getElementCssVariables(node, rules) {
  const inherited = node.parent?.cssVariables || new Map();
  const definitions = new Map();
  const stronger = (a, b) => !b || Number(a.important) > Number(b.important) ||
    (a.important === b.important && (compareSpecificity(a.specificity, b.specificity) > 0 ||
      (compareSpecificity(a.specificity, b.specificity) === 0 && a.order >= b.order)));
  const add = rule => {
    if (!definitions.has(rule.name)) definitions.set(rule.name, []);
    definitions.get(rule.name).push(rule);
  };
  for (const rule of rules) if (matchesSelector(node, rule.selector)) add(rule);
  try {
    postcss.parse(decodeHtmlEntities(node.attributes.style || ''), { from: undefined }).walkDecls(decl => {
      if (decl.prop.startsWith('--')) add({ name: decl.prop, value: decl.value,
        important: Boolean(decl.important), specificity: [1e9, 0, 0], order: Infinity });
    });
  } catch (error) { if (error.name !== 'CssSyntaxError') throw error; }
  const raw = new Map();
  for (const [name, declarations] of definitions) {
    let selected;
    for (const rule of declarations) if (!rule.conditional && stronger(rule, selected)) selected = rule;
    const values = [selected, ...declarations.filter(rule => rule.conditional && stronger(rule, selected))];
    raw.set(name, values.flatMap(rule => {
      if (!rule || /^(?:inherit|unset)$/.test(rule.value.trim())) return inherited.get(name) || [null];
      if (/^(?:initial|revert|revert-layer)$/.test(rule.value.trim())) return [null];
      return [rule.value];
    }));
  }
  return computeCustomProperties(raw, inherited);
}

function getVariableFontDeclarations(css, variables) {
  let root;
  try { root = postcss.parse(css, { from: undefined }); }
  catch (error) { if (error.name !== 'CssSyntaxError') throw error; return []; }
  let variants = [''];
  for (const decl of root.nodes.filter(node => node.type === 'decl')) {
    if (!/^(?:font|font-family)$/i.test(decl.prop)) continue;
    const values = resolveCssVariables(decl.value, name => variables.get(name) || [null]);
    variants = variants.flatMap(prefix => values.map(value => prefix + decl.prop + ':' +
      (value === null ? 'inherit' : value) + (decl.important ? '!important' : '') + ';')).slice(0, 100);
  }
  return variants.map(getDeclaredFontFamily).filter(Boolean);
}

function getElementFontFamilies(node, inheritedFamilies, rules) {
  node.cssVariables = getElementCssVariables(node, rules.variables);
  const stronger = (a, b) => !b || Number(a.important) > Number(b.important) ||
    (a.important === b.important && (compareSpecificity(a.specificity, b.specificity) > 0 ||
      (compareSpecificity(a.specificity, b.specificity) === 0 && a.order >= b.order)));
  let selected;
  const conditional = [];
  for (const rule of rules) {
    if (!matchesSelector(node, rule.selector)) continue;
    const declarations = rule.variableCss ? getVariableFontDeclarations(rule.variableCss, node.cssVariables) : [rule];
    declarations.forEach((declaration, index) => {
      const resolved = { ...rule, ...declaration };
      if (rule.conditional || index > 0) conditional.push(resolved);
      else if (stronger(resolved, selected)) selected = resolved;
    });
  }
  const inlineCss = decodeHtmlEntities(node.attributes.style || '');
  const inlineDeclarations = /var\(/.test(inlineCss)
    ? getVariableFontDeclarations(inlineCss, node.cssVariables) : [getDeclaredFontFamily(inlineCss)].filter(Boolean);
  const inline = inlineDeclarations[0];
  if (inline) {
    const rule = { ...inline, specificity: [1e9, 0, 0], order: Infinity };
    if (stronger(rule, selected)) selected = rule;
    for (const declaration of inlineDeclarations.slice(1)) conditional.push({ ...rule, ...declaration });
  }
  // Conditional rules can be inactive. Keep the base cascade and every branch
  // which could override it, carrying all candidates through inheritance.
  const candidates = [selected, ...conditional.filter(rule => stronger(rule, selected))];
  return [...new Set(candidates.flatMap(rule => !rule || rule.inherit
    ? inheritedFamilies : [rule.fontFamily]))];
}

function collectFontTraitRules(cssFiles) {
  const rules = [];
  for (const cssFile of cssFiles) {
    let root;
    try { root = postcss.parse(cssFile.content, { from: undefined }); }
    catch (error) { if (error.name !== 'CssSyntaxError') throw error; continue; }
    root.walkRules((rule) => {
      let conditional = false;
      for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
        conditional = true;
      }
      const css = rule.nodes.filter((node) => node.type === 'decl').map((node) => node.toString()).join(';');
      for (const property of ['font-weight', 'font-style']) {
        const declaration = getDeclaredFontTrait(css, property);
        if (!declaration) continue;
        for (const selector of rule.selectors) rules.push({
          ...declaration, property, selector, conditional: conditional || selector.includes(':'),
          specificity: getSelectorSpecificity(selector), order: rules.length,
        });
      }
    });
  }
  return rules;
}

function getElementFontTraits(node, rules) {
  const inherits = node.parent?.fontTraits || { weights: [400], styles: ['normal'] };
  const stronger = (a, b) => !b || Number(a.important) > Number(b.important) ||
    (a.important === b.important && (compareSpecificity(a.specificity, b.specificity) > 0 ||
      (compareSpecificity(a.specificity, b.specificity) === 0 && a.order >= b.order)));
  const resolve = (property, inherited, initial) => {
    let selected;
    const conditional = [];
    for (const rule of rules) {
      if (rule.property !== property || !matchesSelector(node, rule.selector)) continue;
      if (rule.conditional) conditional.push(rule);
      else if (stronger(rule, selected)) selected = rule;
    }
    const inline = getDeclaredFontTrait(decodeHtmlEntities(node.attributes.style || ''), property);
    if (inline) {
      const rule = { ...inline, specificity: [1e9, 0, 0], order: Infinity };
      if (stronger(rule, selected)) selected = rule;
    }
    let ua = 'inherit';
    if (property === 'font-weight' && /^(?:b|strong)$/.test(node.tagName)) ua = 'bolder';
    if (property === 'font-weight' && /^h[1-6]$/.test(node.tagName)) ua = 'bold';
    if (property === 'font-style' && /^(?:i|em|cite|dfn|var|address)$/.test(node.tagName)) ua = 'italic';
    const values = [selected?.value === undefined ? ua : selected.value,
      ...conditional.filter((rule) => stronger(rule, selected)).map((rule) => rule.value)];
    return [...new Set(values.flatMap((value) => {
      if (value === 'inherit' || value === 'unset') return inherited;
      if (value === 'initial') return [initial];
      if (value === null || value === 'revert' || value === 'revert-layer') return [null];
      return property === 'font-weight' ? inherited.map((weight) => computedWeight(value, weight)) : [styleKind(value)];
    }))];
  };
  return { weights: resolve('font-weight', inherits.weights, 400), styles: resolve('font-style', inherits.styles, 'normal') };
}

function stripVueInterpolations(text) {
  return text.replace(/\{\{[\s\S]*?\}\}/g, "");
}

// Describe the original template element, before v-for expansion or dynamic class changes.
function templateElementPath(node, parent, siblingPositions) {
  if (node.tagName === '#root') return '';
  const escape = (value) => Array.from(decodeHtmlEntities(value), (character, index) =>
    /[a-zA-Z0-9_-]/.test(character) && !(index === 0 && /[0-9-]/.test(character))
      ? character : '\\' + character.codePointAt(0).toString(16) + ' ').join('');
  let part = node.tagName;
  if (node.attributes.id) part += '#' + escape(node.attributes.id);
  for (const name of (node.attributes.class || '').trim().split(/\s+/).filter(Boolean)) part += '.' + escape(name);
  if (node.parent) {
    let siblings = siblingPositions.get(node.parent);
    if (!siblings) {
      siblings = { counts: new Map(), positions: new WeakMap() };
      for (const child of node.parent.children) {
        if (child.type !== 'element') continue;
        const index = (siblings.counts.get(child.tagName) || 0) + 1;
        siblings.counts.set(child.tagName, index);
        siblings.positions.set(child, index);
      }
      siblingPositions.set(node.parent, siblings);
    }
    if (siblings.counts.get(node.tagName) > 1) part += ':nth-of-type(' + siblings.positions.get(node) + ')';
  }
  return [parent?.sourceElement, part].filter(Boolean).join(' > ');
}

function collectFontCharacters({ htmlContents, cssFiles, fontFamilies, scriptContents = [],
  htmlPaths = [], pageContexts = [], risks = new Set(), dynamicBindings = new Set(), dynamicSources = new Map(), onText, onStateBinding }) {
  const canonicalFamilies = new Map([...fontFamilies].map((family) => [family.toLowerCase(), family]));
  const characterSets = Object.fromEntries([...fontFamilies].map((family) => [family, new Set()]));
  const classNames = (value, collector) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.reduce((rows, item) => limit(rows.flatMap((row) =>
      classNames(item, collector).map((name) => [row, name].filter(Boolean).join(' '))), collector), ['']);
    if (value && typeof value === 'object') return Object.entries(value).reduce((rows, [key, enabled]) =>
      limit(rows.flatMap((row) => (typeof enabled === 'symbol' ? [false, true] : [Boolean(enabled)])
        .map((include) => [row, include ? key : ''].filter(Boolean).join(' '))), collector), ['']);
    return [''];
  };
  const styleText = (value, collector) => {
    if (typeof value === 'symbol') return 'font-weight:var(--mikit-unknown);font-style:var(--mikit-unknown)';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((item) => styleText(item, collector)).filter(Boolean).join(';');
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => {
      const property = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
      return (Array.isArray(item) ? item : [item]).flatMap((entry) => {
        if (entry == null) return [];
        if (!['string', 'number'].includes(typeof entry)) { collector.add('无法确定动态样式值: ' + key); return /^font-(?:weight|style)$/.test(property) ? [property + ':var(--mikit-unknown)'] : []; }
        return [property + ':' + entry];
      });
    }).join(';');
    return '';
  };
  const cleanHtml = (html) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  htmlContents.forEach((html, pageIndex) => {
    const context = pageContexts[pageIndex];
    const page = htmlPaths[pageIndex] || '内联页面 ' + (pageIndex + 1);
    const riskFor = (expression, family, element) => ({ add(message) {
      risks.add(page + (element ? ' | 元素 ' + element : '') + ' | 表达式 ' + expression + ' | 字体 ' + (family || '未确定') + ': ' + message);
    } });
    const scripts = context ? context.scripts : [...scriptContents, ...Array.from(
      html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi), (match) => match[1])];
    const data = collectData(scripts, riskFor('脚本/依赖', null), { resolveModule: context?.resolveModule });
    const rules = collectFontFamilyRules(context ? context.cssFiles : cssFiles);
    const traitRules = onText ? collectFontTraitRules(context ? context.cssFiles : cssFiles) : [];
    const add = (family, values, dynamic = false, traits) => {
      if (!family) return;
      if (dynamic) dynamicBindings.add(family);
      for (const value of values) {
        for (const character of value) characterSets[family].add(character);
        if (onText) onText({ family, text: value, ...traits }, context ? context.cssFiles : cssFiles);
      }
    };
    const siblingPositions = new WeakMap();
    let visited = 0;
    let traversalLimitReached = false;
    const visit = (original, inheritedFamily, aliases = new Map(), parent = null, compiled = true, skipLoop = false, dynamic = false, origins = []) => {
      if (traversalLimitReached) return;
      if (visited >= 10000) {
        traversalLimitReached = true;
        riskFor('模板遍历', inheritedFamily, parent?.sourceElement).add('模板展开超过节点上限 10000，已停止展开');
        return;
      }
      visited++;
      if (original.type !== 'element' || ['script', 'style'].includes(original.tagName)) return;
      const sourceElement = templateElementPath(original, parent, siblingPositions);
      const elementRiskFor = (expression, family) => riskFor(expression, family, sourceElement);
      const bindings = new Map([...data, ...aliases]);
      const initial = { ...original, parent, sourceElement };
      const hintedFamily = getElementFontFamilies(initial, inheritedFamily, rules).join(', ');
      const evaluateBinding = (expression) => evaluateText(decodeHtmlEntities(expression), bindings, elementRiskFor(expression, hintedFamily));
      const loop = compiled && original.attributes['v-for'];
      if (loop && !skipLoop) {
        const match = loop.match(/^\s*(?:\(([^)]+)\)|([\w$]+))\s+(?:in|of)\s+([\s\S]+)$/);
        const loopRisks = elementRiskFor(loop, hintedFamily);
        if (!match) { loopRisks.add('无法解析 v-for'); return; }
        const names = (match[1] || match[2]).split(',').map((name) => name.trim());
        if (names.length > 3 || names.some((name) => !/^[a-zA-Z_$][\w$]*$/.test(name))) {
          loopRisks.add('暂不支持此 v-for 解构或别名'); return;
        }
        const frames = [];
        for (const iterable of evaluateBinding(match[3])) {
          let rows;
          if (Array.isArray(iterable) || typeof iterable === 'string') rows = Array.from(iterable, (item, index) => [item, index]);
          else if (typeof iterable === 'number' && Number.isSafeInteger(iterable) && iterable >= 0) {
            if (iterable > 100) loopRisks.add('v-for 数值范围超过上限 100，已截断');
            rows = Array.from({ length: Math.min(iterable, 100) }, (_, index) => [index + 1, index]);
          } else if (iterable && typeof iterable === 'object') rows = Object.entries(iterable).map(([key, value], index) => [value, key, index]);
          else if (iterable == null) rows = [];
          else { loopRisks.add('v-for 不是可确定的数组、对象、字符串或数值范围'); rows = []; }
          for (const row of limit(rows, loopRisks)) {
            const local = new Map(aliases);
            names.forEach((name, index) => local.set(name, candidates([row[index]])));
            frames.push(local);
          }
        }
        for (const local of limit(frames, loopRisks)) {
          if (traversalLimitReached) break;
          visit(original, inheritedFamily, local, parent, compiled, true, true, [...origins, { element: sourceElement, expression: loop }]);
        }
        return;
      }
      const bindingOrigins = [...origins];
      let variants = [{ ...original.attributes }];
      let unknownClass = false;
      if (compiled) {
        for (const key of ['class', 'style']) {
          const expression = original.attributes[':' + key] ?? original.attributes['v-bind:' + key];
          if (expression === undefined) continue;
          const values = evaluateBinding(expression);
          if (!values.length && key === 'class') unknownClass = true;
          if (!values.length && key === 'style') values.push(Symbol('unknown-style'));
          const normalized = key === 'class' ? values.flatMap((value) => classNames(value, elementRiskFor(expression, hintedFamily))) : values.map((value) => styleText(value, elementRiskFor(expression, hintedFamily)));
          if (key === 'style' && normalized.some((value) => /(?:^|;)\s*font(?:-family)?\s*:/i.test(value) && !getDeclaredFontFamily(value))) {
            elementRiskFor(expression, hintedFamily).add('无法确定动态样式中的字体，请使用运行时采集或补字');
          }
          // Keep known static text as a fallback, but the unknown branch has already emitted a risk.
          variants = limit(variants.flatMap((attributes) => (normalized.length ? normalized : ['']).map((value) => ({
            ...attributes, [key]: [attributes[key], value].filter(Boolean).join(key === 'class' ? ' ' : ';'),
          }))), elementRiskFor(expression, hintedFamily));
          bindingOrigins.push({ element: sourceElement, expression });
          dynamic = true;
        }
      }
      for (const attributes of variants) {
        if (traversalLimitReached) break;
        const node = { ...original, attributes, parent, sourceElement };
        const textOrigins = [...bindingOrigins];
        const computedFamilies = getElementFontFamilies(node, inheritedFamily, rules);
        const computedFamily = computedFamilies.join(', ');
        if (onStateBinding && compiled) {
          const emit = (expression, element = sourceElement) => onStateBinding({
            page, element, expression: decodeHtmlEntities(expression), families: computedFamilies,
          });
          for (const [name, expression] of Object.entries(original.attributes)) {
            if (/^(?:v-(?:text|html|show|if|else-if|for)$|:|v-bind:)/.test(name)) emit(expression);
          }
          for (const child of original.children) if (child.type === 'text') {
            for (const match of child.value.matchAll(/\{\{([\s\S]*?)\}\}/g)) emit(match[1].trim());
          }
          for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
            for (const [name, expression] of Object.entries(ancestor.attributes)) {
              if (/^(?:v-(?:show|if|else-if)$|:(?:class|style)$|v-bind:(?:class|style)$)/.test(name)) {
                emit(expression, ancestor.sourceElement + ' → ' + sourceElement);
              }
            }
          }
        }
        const families = [...new Set(computedFamilies.map(family => canonicalFamilies.get(family.toLowerCase())).filter(Boolean))];
        node.fontTraits = onText ? (unknownClass
          ? { weights: [null], styles: [null] } : getElementFontTraits(node, traitRules)) : undefined;
        if (families.length && onText && [...node.fontTraits.weights, ...node.fontTraits.styles].includes(null)) {
          elementRiskFor('font-weight/font-style', families.join(', ')).add('无法确定字重或样式，已保守保留可能匹配的字体');
        }
        const addText = (values, isDynamic = false, expression) => {
          for (const family of families) {
            add(family, values, isDynamic, node.fontTraits);
            if (!isDynamic || !values.length) continue;
            const sources = expression === undefined ? textOrigins : [{ element: sourceElement, expression }];
            for (const source of sources) {
              const record = { page, family, ...source };
              dynamicSources.set(JSON.stringify(record), record);
            }
          }
        };
        if (compiled) for (const [name, expression] of Object.entries(attributes)) {
          if (name.startsWith(':[') || name.startsWith('v-bind:[') || name === 'v-bind') {
            elementRiskFor(expression, computedFamily).add('暂不支持动态属性名或 v-bind 对象');
          }
          const attribute = name.startsWith('v-bind:') ? name.slice(7) : name.startsWith(':') ? name.slice(1) : '';
          if (['title', 'placeholder', 'alt', 'aria-label'].includes(attribute)) {
            addText(visibleValues(decodeHtmlEntities(expression), bindings, elementRiskFor(expression, computedFamily)), true, expression);
          }
        }
        const textExpression = compiled && attributes['v-text'];
        const htmlExpression = compiled && attributes['v-html'];
        if (textExpression !== false && textExpression !== undefined) {
          addText(visibleValues(decodeHtmlEntities(textExpression), bindings, elementRiskFor(textExpression, computedFamily)), true, textExpression);
          continue;
        }
        let children = node.children;
        let childrenCompiled = compiled;
        if (htmlExpression !== false && htmlExpression !== undefined) {
          const markup = visibleValues(decodeHtmlEntities(htmlExpression), bindings, elementRiskFor(htmlExpression, computedFamily));
          if (markup.some((value) => /<(?:style|link)\b/i.test(value))) {
            elementRiskFor(htmlExpression, computedFamily).add('v-html 注入样式表暂不支持，请使用运行时采集');
          }
          children = markup.flatMap((value) => parseHtml(cleanHtml(value)).children);
          textOrigins.push({ element: sourceElement, expression: htmlExpression });
          childrenCompiled = false;
          dynamic = true;
        }
        for (const child of children) {
          if (traversalLimitReached) break;
          if (child.type === 'text') {
            let literal = child.value;
            if (childrenCompiled) {
              for (const match of literal.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
                addText(visibleValues(decodeHtmlEntities(match[1].trim()), bindings, elementRiskFor(match[1].trim(), computedFamily)), true, match[1].trim());
              }
              literal = stripVueInterpolations(literal);
            }
            literal = decodeHtmlEntities(literal);
            if (/\S/u.test(literal)) addText([literal.replace(/\s+/g, ' ')], dynamic);
          } else visit(child, computedFamilies, aliases, node, childrenCompiled, false, dynamic, textOrigins);
        }
      }
    };
    visit(parseHtml(cleanHtml(html)), []);
  });
  return Object.fromEntries(Object.entries(characterSets).map(([family, characters]) => [family, [...characters].join('')]));
}

function mergeFontCharacterMaps(fontFamilies, ...maps) {
  const plannedFamilies = new Set(fontFamilies);
  const charactersByFamily = new Map(
    Array.from(plannedFamilies, (family) => [family, new Set()]),
  );

  maps.forEach((characterMap) => {
    plannedFamilies.forEach((family) => {
      const characters =
        characterMap instanceof Map
          ? characterMap.get(family)
          : characterMap && characterMap[family];
      if (typeof characters !== "string") {
        return;
      }

      for (const character of characters) {
        charactersByFamily.get(family).add(character);
      }
    });
  });

  return Object.fromEntries(
    Array.from(charactersByFamily, ([family, characters]) => [
      family,
      Array.from(characters).join(""),
    ]),
  );
}

function writeFontCharacterFiles({
  htmlTargets,
  cssFiles,
  fontPaths,
  fontFamilyByName = new Map(),
  fontFamilyByPath = new Map(),
  fontFaces = [],
  fontDir,
  manifestDir,
  runtimeCharactersByFamily = {},
  runtimeConfig = {},
  outputDir,
  risks = new Set(),
  dynamicBindings = new Set(),
  dynamicSources = new Map(),
  isExcluded = () => false,
}) {
  const htmlContents = htmlTargets.map((file) => fs.readFileSync(file, "utf8"));
  const fontFamilies = new Set(
    fontPaths.map((fontPath) => {
      const fontName = getFontNameFromFile(fontPath);
      return (
        fontFamilyByPath.get(getFontKey(fontPath, fontDir)) ||
        fontFamilyByName.get(fontName) || fontName
      );
    }),
  );
  const pageContexts = htmlContents.map((html, index) => createPageAnalysis({
    html, htmlPath: htmlTargets[index], outputDir, cssFiles, isExcluded,
    risks: { add(message) { risks.add(htmlTargets[index] + ' | 表达式 脚本/样式依赖 | 字体 未确定: ' + message); } },
  }));
  const stateBindings = [];
  const staticByFace = {};
  const facesByPageCss = new Map();
  const staticCharactersByFamily = collectFontCharacters({
    htmlContents, htmlPaths: htmlTargets, pageContexts, cssFiles, fontFamilies, risks, dynamicBindings, dynamicSources,
    onStateBinding(record) { stateBindings.push(record); },
    onText(record, pageCssFiles) {
      if (!facesByPageCss.has(pageCssFiles)) {
        facesByPageCss.set(pageCssFiles, collectFontFamilyMappings(pageCssFiles, fontDir).fontFaces);
      }
      addFaceCharacters(staticByFace, facesByPageCss.get(pageCssFiles), record);
    },
  });
  const extra = Object.fromEntries([...fontFamilies].map((family) => {
    const mode = runtimeConfig.familyOptions?.[family]?.asciiBaseline || runtimeConfig.asciiBaseline || 'none';
    const baseline = mode === 'full' ? Array.from({ length: 95 }, (_, index) =>
      String.fromCharCode(index + 32)).join('') : mode === 'common' ? ' 0123456789.,:%+-/()[]!' : '';
    return [family, (runtimeConfig.globalExtraText || '') +
      (runtimeConfig.familyExtraText?.[family] || '') +
      (runtimeConfig.generatedFamilyExtraText?.[family] || '') + baseline];
  }));
  const textPaths = new Map();
  const characterSources = new Map();

  fontPaths.forEach((fontPath) => {
    const fontName = getFontNameFromFile(fontPath);
    const fontKey = getFontKey(fontPath, fontDir);
    const fontFamily = fontFamilyByPath.get(fontKey) ||
      fontFamilyByName.get(fontName) || fontName;
    const faceKey = faceCharacterKey(fontKey);
    const hasFace = fontFaces.some((face) => face.key === fontKey);
    const staticText = hasFace ? [...(staticByFace[faceKey] || [])].join('') : staticCharactersByFamily[fontFamily] || '';
    // Old custom runtime runners may still return family totals; retain those
    // conservatively. The built-in runner always includes empty face entries.
    const runtimeText = Object.hasOwn(runtimeCharactersByFamily, faceKey)
      ? runtimeCharactersByFamily[faceKey] : runtimeCharactersByFamily[fontFamily] || '';
    const characters = [...new Set(staticText + runtimeText + (extra[fontFamily] || ''))].join('');
    const textPath = path.join(manifestDir, `${fontKey}.txt`);
    if (!characters) {
      if (fs.existsSync(textPath)) {
        fs.unlinkSync(textPath);
      }
      return;
    }

    fs.mkdirSync(path.dirname(textPath), { recursive: true });
    fs.writeFileSync(textPath, characters, "utf8");
    const staticCount = Array.from(
      staticText,
    ).length;
    const totalCount = Array.from(characters).length;
    const runtimeAdded = totalCount - staticCount;
    console.log(
      `字体字符清单: ${path.relative(manifestDir, textPath)}（静态 ${staticCount}，` +
        `其他新增 ${runtimeAdded}，合计 ${totalCount}）`,
    );
    textPaths.set(fontPath, textPath);
    const seen = new Set();
    const uniqueAdded = (value) => {
      let count = 0;
      for (const character of value || '') {
        if (!seen.has(character)) { seen.add(character); count += 1; }
      }
      return count;
    };
    characterSources.set(fontPath, {
      static: uniqueAdded(staticText),
      runtime: uniqueAdded(runtimeText),
      configured: uniqueAdded(extra[fontFamily]),
    });
  });
  textPaths.stateParameters = pageContexts.flatMap((context, index) => {
    const target = htmlTargets[index];
    const relative = file => path.relative(outputDir, file);
    return analyzePageStateParameters({
      scripts: [...context.scripts, ...context.moduleScripts].map(record => ({
        ...record, filePath: relative(record.filePath),
      })),
      bindings: stateBindings.filter(record => record.page === target).map(record => ({ ...record, page: relative(target) })),
      page: relative(target), localFamilies: fontFamilies,
      runtimePages: (runtimeConfig.pages || []).filter(url => deriveHtmlTargetFromUrl(url, outputDir) === target),
    });
  });
  textPaths.characterSources = characterSources;
  return textPaths;
}

function defaultCommandRunner(command, args) {
  return spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
  });
}

function runPyftsubset(
  targetFontPath,
  textPath,
  extension,
  flavor,
  commandRunner = defaultCommandRunner,
) {
  const outputPath = path.join(
    path.dirname(targetFontPath),
    `${path.basename(targetFontPath, path.extname(targetFontPath))}-subset.${extension}`,
  );
  const args = createPyftsubsetArgs({
    fontPath: targetFontPath,
    outputPath,
    textPath,
    flavor,
  });
  const command =
    process.platform === "win32" ? "pyftsubset.exe" : "pyftsubset";
  const result = commandRunner(command, args);

  if (result.error || result.status !== 0) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (result.error?.code === 'ENOENT') {
      throw new Error('未找到 pyftsubset，请先安装 Python fonttools 并确保 pyftsubset 在 PATH 中。');
    }
    const reason = result.error ? result.error.message : `退出码: ${result.status}`;
    throw new Error(`pyftsubset 无法处理字体原文件 ${targetFontPath}，生成 ${outputPath} 失败，${reason}`);
  }

  return outputPath;
}

function verifySubset(source, textPath, outputs) {
  const script = path.join(__dirname, 'font-verify.py');
  const commands = process.platform === 'win32'
    ? [['py', '-3'], ['python']]
    : [['python3'], ['python']];
  for (const [command, ...prefix] of commands) {
    const result = spawnSync(command, [...prefix, script, source, textPath, ...outputs], {
      encoding: 'utf8', windowsHide: true,
    });
    if (result.error?.code === 'ENOENT') continue;
    if (result.error || result.status !== 0) {
      throw new Error(`字体生成结果验证失败 ${source}: ${result.stderr?.trim() || result.error?.message || result.status}`);
    }
    return JSON.parse(result.stdout);
  }
  throw new Error('无法验证字体：未找到 Python，请检查 FontTools 运行环境');
}

function subsetFont(targetFontPath, textPath, formats, commandRunner) {
  const subsetFiles = [];
  try {
    for (const format of ['ttf', 'woff', 'woff2']) {
      if (!formats.has(format)) continue;
      subsetFiles.push(runPyftsubset(targetFontPath, textPath, format,
        format === 'ttf' ? undefined : format, commandRunner));
    }
  } catch (error) {
    subsetFiles.forEach((file) => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
    throw error;
  }
  return subsetFiles;
}

function removeRemoteFontFiles(files) {
  if (files.length === 0) {
    return;
  }

  console.log(
    "检测到以下字体仅由 HTTP/HTTPS 远程地址引用，已从构建输出移除：",
  );
  files.forEach((file) => {
    fs.unlinkSync(file);
    console.log(`已移除: ${path.basename(file)}`);
  });
}

function replaceSubsetFiles(subsetFiles) {
  subsetFiles.forEach((sourcePath) => {
    const targetPath = sourcePath.replace("-subset", "");
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.renameSync(sourcePath, targetPath);
  });
}

function pruneOutputFontFiles(fontDir, retainedFormats) {
  const removedFiles = [];

  glob.sync("**/*", { cwd: fontDir, nodir: true }).forEach((relativePath) => {
    if (!FONT_EXT_RE.test(relativePath)) {
      return;
    }

    const filePath = path.join(fontDir, relativePath);
    if (
      retainedFormats.get(getFontKey(filePath, fontDir))?.has(
        path.extname(relativePath).slice(1).toLowerCase())
    ) {
      return;
    }

    fs.unlinkSync(filePath);
    removedFiles.push(filePath);
  });

  if (removedFiles.length > 0) {
    console.log(
      `已清理未使用或非输出格式字体: ${removedFiles
        .map((file) => path.relative(fontDir, file))
        .join(', ')}`,
    );
  }

  return removedFiles;
}

// 只交换未保留的分支，保留目录及其内容始终留在原位置。
function selectFontPublishItems(items, excludedDirectories) {
  const { isExcluded, hasExcludedDescendant } = createDirectoryExclusion(excludedDirectories);
  const selected = [];
  function visit(target, stage) {
    if (isExcluded(target)) return;
    if (!hasExcludedDescendant(target)) {
      selected.push({ target, stage });
      return;
    }
    const names = new Set();
    for (const directory of [target, stage]) {
      if (fs.existsSync(directory)) fs.readdirSync(directory).forEach(name => names.add(name));
    }
    names.forEach(name => visit(path.join(target, name), path.join(stage, name)));
  }
  items.forEach(({ target, stage }) => visit(target, stage));
  return selected;
}

function publishFontDirectories(items, excludedDirectories = []) {
  items = selectFontPublishItems(items, excludedDirectories);
  const completed = [];
  try {
    items.forEach(({ target, stage }) => {
      const backup = path.join(path.dirname(target),
        `.mikit-font-backup-${path.basename(target)}-${process.pid}-${require('node:crypto').randomUUID()}`);
      const hadTarget = fs.existsSync(target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const entry = { target, backup, hadTarget, published: false };
      completed.push(entry);
      if (hadTarget) fs.renameSync(target, backup);
      if (fs.existsSync(stage)) {
        fs.renameSync(stage, target);
        entry.published = true;
      }
    });
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of completed.reverse()) {
      try {
        if (entry.published && fs.existsSync(entry.target)) {
          fs.rmSync(entry.target, { recursive: true, force: true });
        }
        if (entry.hadTarget && fs.existsSync(entry.backup)) {
          fs.renameSync(entry.backup, entry.target);
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${entry.target}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`字体发布失败且回滚不完整，请保留备份目录并手动恢复: ${error.message}; ${rollbackErrors.join('; ')}`);
    }
    throw error;
  }
  completed.forEach((entry) => {
    if (entry.hadTarget) {
      try { fs.rmSync(entry.backup, { recursive: true, force: true }); }
      catch (error) { console.warn(`[mikit font] 旧备份清理失败: ${entry.backup}: ${error.message}`); }
    }
  });
}

function subsetFonts(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const outputDir = path.resolve(
    projectDir,
    options.outputDir || options.output || "dist",
  );
  const fontDir = path.join(outputDir, "font");
  const { isExcluded } = createDirectoryExclusion(options.excludedDirectories);
  if (isExcluded(fontDir)) {
    console.log("[mikit build] 字体目录已配置保留，跳过字体子集化。");
    return { processed: [], skipped: [], manifests: [], removedRemote: [], removedUnused: [], risks: [], verification: [], report: null };
  }
  const manifestDir = path.resolve(
    projectDir,
    options.manifestDir || options.fontManifest || "font",
  );
  const defaultSourceDir = path.join(projectDir, "wwwroot");
  const sourceDir = path.resolve(
    projectDir,
    options.sourceDir || (fs.existsSync(defaultSourceDir) ? "wwwroot" : "."),
  );
  if (!isPathOutside(manifestDir, fontDir) ||
      !isPathOutside(manifestDir, outputDir) ||
      !isPathOutside(fontDir, manifestDir)) {
    throw new Error(`字体目录、构建目录和字符清单目录不能重叠: ${fontDir} / ${outputDir} / ${manifestDir}`);
  }
  if (fs.existsSync(manifestDir) && !fs.statSync(manifestDir).isDirectory()) {
    throw new Error(`字符清单目录不是目录: ${manifestDir}`);
  }
  const sourceFontDir = path.join(path.resolve(projectDir, options.sourceDir || 'wwwroot'), 'font');
  if (!isPathOutside(sourceFontDir, fontDir) || !isPathOutside(fontDir, sourceFontDir) ||
      !isPathOutside(sourceFontDir, manifestDir) || !isPathOutside(manifestDir, sourceFontDir)) {
    throw new Error(`原字体目录不能与输出字体目录或字符清单目录重叠: ${sourceFontDir}`);
  }
  const fontPage = options.fontPage;
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const verifier = options.verifier || (options.commandRunner ? null : verifySubset);
  const runtimeConfig =
    options.runtimeConfig || loadFontRuntimeConfig(projectDir);
  const runtimeRunner = options.runtimeRunner || runRuntimeFontCollectorSync;
  if (!fs.existsSync(fontDir)) throw new Error(`字体目录不存在: ${fontDir}`);
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(outputDir), '.mikit-font-stage-'));
  const stageFontDir = path.join(stageRoot, 'font');
  const stageManifestDir = path.join(stageRoot, 'manifest');
  try {
    if (fs.existsSync(fontDir)) fs.cpSync(fontDir, stageFontDir, { recursive: true, filter: file => !isExcluded(file) });
    if (fs.existsSync(manifestDir)) fs.cpSync(manifestDir, stageManifestDir, { recursive: true });
    return subsetFontsInStage({ ...options, fontDir, manifestDir, stageFontDir,
      stageManifestDir, outputDir, sourceDir, sourceFontDir, fontPage, commandRunner, verifier, runtimeConfig, runtimeRunner });
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function removeFontReports(directory) {
  for (const name of ['font-report.json', 'font-report.md']) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function subsetFontsInStage({ fontDir, manifestDir, stageFontDir, stageManifestDir,
  outputDir, sourceDir, sourceFontDir, fontPage, commandRunner, verifier, runtimeConfig, runtimeRunner, ...options }) {
  const { isExcluded, globIgnore } = createDirectoryExclusion(options.excludedDirectories);
  if (options.excludedDirectories && options.excludedDirectories.length) {
    runtimeConfig = { ...runtimeConfig, pages: runtimeConfig.pages.filter(url => {
      const target = deriveHtmlTargetFromUrl(url, outputDir, { isExcluded });
      return !target || !isExcluded(target);
    }) };
  }
  const staged = (file) => path.join(stageFontDir, path.relative(fontDir, file));

  const htmlTargets = collectHtmlTargets({
    outputDir,
    sourceDir,
    fontPage,
    pages: runtimeConfig.pages,
    excludedDirectories: options.excludedDirectories,
  });
  const cssFiles = collectCssFiles(outputDir, options.excludedDirectories).concat(
    collectInlineCssFiles(htmlTargets),
  );
  const fontFiles = glob.sync("**/*", { cwd: fontDir, nodir: true, ignore: globIgnore() });
  const sourceFontFiles = glob.sync('**/*', { cwd: sourceFontDir, nodir: true,
    ignore: globIgnore([], file => path.resolve(fontDir, path.relative(sourceFontDir, file))) })
    .filter((file) => !SUBSET_RE.test(file));
  const fontPlan = createFontPlan({ fontDir, sourceFontDir, cssFiles, isExcluded,
    fontFiles: sourceFontFiles,
    ttfFiles: sourceFontFiles.filter((file) => TTF_EXT_RE.test(file)),
  });
  const remoteFilesToRemove = getRemoteFontFilesToRemove({
    fontDir,
    fontFiles,
    remoteFontNames: fontPlan.remoteFontNames,
    localFontNames: fontPlan.localFontNames,
  });

  if (fontPlan.fontPathsToSubset.length === 0) {
    removeRemoteFontFiles(remoteFilesToRemove.map(staged));
    const removedUnused = pruneOutputFontFiles(stageFontDir, new Map());
    removeFontReports(stageManifestDir);
    publishFontDirectories([
      { target: fontDir, stage: stageFontDir },
      ...(fs.existsSync(stageManifestDir) || fs.existsSync(manifestDir) ? [{ target: manifestDir, stage: stageManifestDir }] : []),
    ], options.excludedDirectories);
    console.log("未发现需要压缩的本地字体，已跳过字体子集化。");
    return {
      processed: [],
      skipped: [],
      manifests: [],
      removedRemote: remoteFilesToRemove,
      removedUnused,
      risks: [],
      verification: [],
      report: null,
    };
  }

  if (htmlTargets.length === 0) {
    const scanTarget = fontPage
      ? path.join(outputDir, fontPage)
      : path.join(sourceDir, "**", "*.shtml");
    throw new Error(`未找到字体扫描页面: ${scanTarget}`);
  }
  const fontFamilies = new Set(
    fontPlan.fontPathsToSubset.map((fontPath) => {
      const fontName = getFontNameFromFile(fontPath);
      return (
        fontPlan.fontFamilyByPath.get(getFontKey(fontPath, fontDir)) ||
        fontPlan.fontFamilyByName.get(fontName) || fontName
      );
    }),
  );
  htmlTargets.forEach((file) => {
    console.log(`字体静态页面: ${path.relative(outputDir, file)}`);
  });
  runtimeConfig.pages.forEach((pageUrl) => {
    const parsedUrl = new URL(pageUrl);
    console.log(`字体运行时页面: ${parsedUrl.pathname}${parsedUrl.search}`);
  });
  const runtimeCharactersByFamily =
    runtimeConfig.pages.length === 0
      ? {}
      : runtimeRunner({
          ...runtimeConfig,
          fontFamilies: Array.from(fontFamilies),
          fontFaces: fontPlan.fontFaces,
        });

  removeRemoteFontFiles(remoteFilesToRemove.map(staged));

  const risks = new Set();
  const dynamicBindings = new Set();
  const dynamicSources = new Map();
  const textPaths = writeFontCharacterFiles({
    htmlTargets,
    cssFiles,
    fontPaths: fontPlan.fontPathsToSubset,
    fontFamilyByName: fontPlan.fontFamilyByName,
    fontFamilyByPath: fontPlan.fontFamilyByPath,
    fontFaces: fontPlan.fontFaces,
    fontDir,
    manifestDir: stageManifestDir,
    runtimeCharactersByFamily,
    runtimeConfig,
    outputDir,
    risks,
    dynamicBindings,
    dynamicSources,
    isExcluded,
  });

  if (runtimeConfig.dynamicTextPolicy === 'error' && risks.size) {
    throw new Error(`字体存在无法确定的动态展示文字: ${[...risks].join('；')}`);
  }
  const processed = [];
  const skipped = [];
  const verification = [];
  const fontReports = [];

  fontPlan.fontPathsToSubset.forEach((fontPath) => {
    const textPath = textPaths.get(fontPath);
    if (!textPath) {
      const fontKey = getFontKey(fontPath, fontDir);
      fontFiles
        .filter((file) => /\.(?:ttf|woff2?)$/i.test(file) && !SUBSET_RE.test(file))
        .filter((file) => getFontKey(path.join(fontDir, file), fontDir) === fontKey)
        .forEach((file) => {
          const unusedFontPath = path.join(stageFontDir, file);
          if (fs.existsSync(unusedFontPath)) {
            fs.unlinkSync(unusedFontPath);
          }
        });
      skipped.push(fontPath);
      console.log(
        `未提取到 ${path.basename(fontPath)} 使用的字符，已跳过且不输出字体文件。`,
      );
      return;
    }

    const formats = fontPlan.formatsByFontKey.get(getFontKey(fontPath, fontDir));
    const sourceFontPath = path.join(sourceFontDir, path.relative(fontDir, fontPath));
    fs.mkdirSync(path.dirname(staged(fontPath)), { recursive: true });
    fs.copyFileSync(sourceFontPath, staged(fontPath));
    let subsetFiles;
    try {
      subsetFiles = subsetFont(staged(fontPath), textPath, formats, commandRunner);
    } catch (error) {
      throw new Error(error.message.replaceAll(staged(fontPath), sourceFontPath));
    }
    const details = verifier ? verifier(sourceFontPath, textPath, subsetFiles) : null;
    if (details) {
      verification.push({ source: sourceFontPath, ...details });
      if (details.sourceMissing?.length) console.warn(`[mikit font] ${path.basename(fontPath)} 源字体缺少 ${details.sourceMissing.length} 个请求字符`);
    }
    const family = fontPlan.fontFamilyByPath.get(getFontKey(fontPath, fontDir)) ||
      fontPlan.fontFamilyByName.get(getFontNameFromFile(fontPath)) || getFontNameFromFile(fontPath);
    const characters = fs.readFileSync(textPath, 'utf8');
    const missingDigits = Array.from('0123456789').filter((digit) => !characters.includes(digit)).join('');
    const faces = fontPlan.fontFaces.filter((face) => face.key === getFontKey(fontPath, fontDir));
    const showFace = new Set(fontPlan.fontFaces.filter((face) => face.family.toLowerCase() === family.toLowerCase()).map((face) => face.key)).size > 1;
    fontReports.push({
      family,
      faceLabel: showFace ? family + ' / ' + [...new Set(faces.map((face) => (face.weight === 'normal' ? '400' : face.weight === 'bold' ? '700' : face.weight) + ' ' + face.style))].join(', ') : family,
      font: path.relative(fontDir, fontPath),
      sourceBytes: fs.statSync(sourceFontPath).size,
      asciiBaseline: runtimeConfig.familyOptions?.[family]?.asciiBaseline || runtimeConfig.asciiBaseline,
      asciiBaselineSource: runtimeConfig.familyOptions?.[family]?.asciiBaseline ? '字体族配置' : '全局配置',
      manifest: path.relative(stageManifestDir, textPath),
      characters: Array.from(characters).length,
      characterSources: textPaths.characterSources.get(fontPath),
      sample: Array.from(characters).slice(0, 80).join(''),
      dynamicBinding: dynamicBindings.has(family),
      dynamicSources: [...dynamicSources.values()].filter((source) => source.family === family)
        .map((source) => ({ ...source, page: path.relative(outputDir, source.page) })),
      missingDigits,
      digitSuggestion: dynamicBindings.has(family) && missingDigits
        ? `检测到可见文字动态绑定，字符清单尚未收集数字 ${missingDigits}；若运行时可能出现，` +
          `请配置 familyExtraText: ${JSON.stringify({ [family]: missingDigits })}，` +
          `或为该字体族设置 familyOptions: ${JSON.stringify({ [family]: { asciiBaseline: 'common' } })}。`
        : null,
      formats: subsetFiles.map((file) => {
        const target = path.join(fontDir, path.relative(stageFontDir, file.replace('-subset', '')));
        return {
          format: path.extname(file).slice(1),
          file: path.relative(manifestDir, target),
          bytes: fs.statSync(file).size,
        };
      }),
      verification: details || { status: 'not-run' },
    });
    replaceSubsetFiles(subsetFiles);
    processed.push(fontPath);
  });

  const retainedFormats = new Map(processed.map((fontPath) => {
    const fontKey = getFontKey(fontPath, fontDir);
    return [fontKey, fontPlan.formatsByFontKey.get(fontKey)];
  }));
  const removedUnused = pruneOutputFontFiles(stageFontDir, retainedFormats);
  const reportRisks = relevantRisks({ localFamilies: [...fontFamilies], fonts: fontReports, risks: [...risks] });
  const hasReport = processed.length > 0 || reportRisks.length > 0;
  if (hasReport) {
    fs.mkdirSync(stageManifestDir, { recursive: true });
    const report = renderFontReport({ asciiBaseline: runtimeConfig.asciiBaseline,
      localFamilies: [...fontFamilies],
      stateParameters: textPaths.stateParameters,
      fontConfig: { familyExtraText: runtimeConfig.familyExtraText,
        generatedFamilyExtraText: runtimeConfig.generatedFamilyExtraText },
      sources: { staticPages: htmlTargets.map((file) => path.relative(outputDir, file)),
        runtimePages: runtimeConfig.pages },
      risks: reportRisks.map((risk) => {
        const page = htmlTargets.find((file) => risk.startsWith(file + ' | '));
        return page ? path.relative(outputDir, page) + risk.slice(page.length) : risk;
      }), fonts: fontReports,
      skipped: skipped.map((file) => path.relative(fontDir, file)),
      removedRemote: remoteFilesToRemove.map((file) => path.relative(fontDir, file)),
      removedUnused: removedUnused.map((file) => path.relative(stageFontDir, file)),
    });
    removeFontReports(stageManifestDir);
    fs.writeFileSync(path.join(stageManifestDir, 'font-report.md'), report, 'utf8');
  } else {
    removeFontReports(stageManifestDir);
  }
  publishFontDirectories([
    { target: fontDir, stage: stageFontDir },
    ...(fs.existsSync(stageManifestDir) || fs.existsSync(manifestDir) ? [{ target: manifestDir, stage: stageManifestDir }] : []),
  ], options.excludedDirectories);

  console.log(
    `字体处理完成: ${processed.length} 个已压缩，${skipped.length} 个已跳过。`,
  );
  const reportPath = hasReport ? path.join(manifestDir, 'font-report.md') : null;
  if (reportPath) {
    if (reportRisks.length) console.log(`[mikit font] 检测到 ${reportRisks.length} 项动态文字风险。`);
    console.log(`[mikit font] 请查看字体报告：${reportPath}`);
  }
  return {
    processed,
    skipped,
    manifests: Array.from(textPaths.values(), (file) => path.join(manifestDir, path.relative(stageManifestDir, file))),
    removedRemote: remoteFilesToRemove,
    removedUnused,
    risks: [...risks],
    verification,
    report: reportPath,
  };
}

module.exports = {
  collectCssFiles,
  collectFontCharacters,
  collectFontUrls,
  collectHtmlTargets,
  deriveHtmlTargetFromUrl,
  createPyftsubsetArgs,
  createFontPlan,
  getRemoteFontFilesToRemove,
  isHttpFontUrl,
  isLocalFontUrl,
  mergeFontCharacterMaps,
  removeRemoteFontFiles,
  subsetFonts,
  writeFontCharacterFiles,
};
