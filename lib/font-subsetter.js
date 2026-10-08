const { spawnSync } = require("child_process");
const fs = require("fs");
const glob = require("glob");
const path = require("path");

const { getDeclaredFontFamily } = require('./font-css');
const { loadFontRuntimeConfig } = require("./font-runtime-config");
const { collectData, visibleValues, parseExpression, evaluate } = require('./font-static-text');
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

function collectCssFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return glob
    .sync("**/*.css", { cwd: dir, absolute: true, nodir: true })
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

function collectFontFamilyMappings(cssFiles, fontDir) {
  const fontFamilyByName = new Map();
  const fontFamilyByPath = new Map();

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
      collectFontUrls(match[1]).forEach((url) => {
        if (FONT_EXT_RE.test(url)) {
          fontFamilyByName.set(getFontNameFromUrl(url), fontFamily);
          const resolved = resolveLocalFontPath(url, cssFile, fontDir);
          if (resolved) {
            fontFamilyByPath.set(getFontKey(resolved, fontDir), fontFamily);
          }
        }
      });
    }
  });

  return { fontFamilyByName, fontFamilyByPath };
}

function createFontPlan({ fontDir, cssFiles, ttfFiles = [], fontFiles = ttfFiles }) {
  const localFontNames = new Set();
  const remoteFontNames = new Set();
  const formatsByFontKey = new Map();
  const formatsByName = new Map();
  const { fontFamilyByName, fontFamilyByPath } = collectFontFamilyMappings(
    cssFiles, fontDir,
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
    const candidates = ['ttf', 'woff', 'woff2'].filter((format) =>
      formats.has(format));
    const input = candidates
      .map((format) => path.join(fontDir, `${fontKey}.${format}`))
      .find((file) => availableFiles.has(
        path.normalize(path.relative(fontDir, file))));
    if (!input) {
      const expected = path.join(fontDir, `${fontKey}.${candidates[0]}`);
      throw new Error(`缺少可用的字体原文件: ${expected}`);
    }
    fontPathsToSubset.push(input);
  });

  return {
    localFontNames,
    remoteFontNames,
    fontFamilyByName,
    fontFamilyByPath,
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

function collectBuiltShtmlTargets({ sourceDir, outputDir }) {
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return null;
  }

  const relativeSourcePages = glob.sync("**/*.shtml", {
    cwd: path.resolve(sourceDir),
    nodir: true,
    ignore: ["**/_*.shtml", "node_modules/**", ".git/**"],
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
}) {
  const normalizedOutputDir = path.resolve(outputDir);
  let staticTargets = [];

  if (fs.existsSync(normalizedOutputDir)) {
    if (fontPage) {
      const requestedTargets = glob.sync(fontPage, {
        cwd: normalizedOutputDir,
        absolute: true,
        nodir: true,
      });
      staticTargets =
        requestedTargets.length > 0
          ? requestedTargets
          : glob.sync("*.html", {
              cwd: normalizedOutputDir,
              absolute: true,
              nodir: true,
            });
    } else {
      const builtShtmlTargets = collectBuiltShtmlTargets({
        sourceDir,
        outputDir: normalizedOutputDir,
      });
      staticTargets =
        builtShtmlTargets === null
          ? glob.sync("**/*.html", {
              cwd: normalizedOutputDir,
              absolute: true,
              nodir: true,
              ignore: ["**/_*.html"],
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
    const targetKey = getTargetKey(normalizedTarget);
    if (!seenTargets.has(targetKey)) {
      seenTargets.add(targetKey);
      targets.push(normalizedTarget);
    }
  };

  staticTargets.sort().forEach(addTarget);
  pages.forEach((url) => {
    const target = deriveHtmlTargetFromUrl(url, normalizedOutputDir);
    if (!target) {
      if (!warnedUnsupportedUrls.has(url)) {
        warnedUnsupportedUrls.add(url);
        warn(`[mikit font] 无法将运行时 URL 映射为本地 HTML：${url}`);
      }
      return;
    }

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
  let order = 0;

  cssFiles.forEach((cssFile) => {
    const css = cssFile.content.replace(/\/\*[\s\S]*?\*\//g, "");
    const blockRe = /([^{}]+)\{([^{}]*)\}/g;
    let match;

    while ((match = blockRe.exec(css))) {
      const selectorText = match[1].trim();
      if (selectorText.startsWith('@')) continue;
      const declaration = getDeclaredFontFamily(match[2]);
      if (!declaration) continue;

      selectorText.split(",").forEach((selector) => {
        const normalizedSelector = selector.trim();
        if (!normalizedSelector) {
          return;
        }

        rules.push({
          selector: normalizedSelector,
          ...declaration,
          specificity: getSelectorSpecificity(normalizedSelector),
          order,
        });
        order += 1;
      });
    }
  });

  return rules;
}

function getElementFontFamily(node, inheritedFamily, rules) {
  let selectedRule = null;

  rules.forEach((rule) => {
    if (!matchesSelector(node, rule.selector)) {
      return;
    }

    if (
      !selectedRule ||
      Number(rule.important) > Number(selectedRule.important) ||
      (rule.important === selectedRule.important &&
        (compareSpecificity(rule.specificity, selectedRule.specificity) > 0 ||
          (compareSpecificity(rule.specificity, selectedRule.specificity) ===
            0 &&
            rule.order > selectedRule.order)))
    ) {
      selectedRule = rule;
    }
  });

  const inline = getDeclaredFontFamily(decodeHtmlEntities(node.attributes.style || ''));
  if (inline && (!selectedRule || inline.important || !selectedRule.important)) {
    selectedRule = inline;
  }

  return !selectedRule || selectedRule.inherit
    ? inheritedFamily
    : selectedRule.fontFamily;
}

function stripVueInterpolations(text) {
  return text.replace(/\{\{[\s\S]*?\}\}/g, "");
}

function collectFontCharacters({ htmlContents, cssFiles, fontFamilies, scriptContents = [], risks = new Set(), dynamicBindings = new Set() }) {
  const canonicalFamilies = new Map(
    Array.from(fontFamilies, (family) => [family.toLowerCase(), family]),
  );
  const characterSets = Object.fromEntries(
    Array.from(fontFamilies, (family) => [family, new Set()]),
  );
  const rules = collectFontFamilyRules(cssFiles);
  const scripts = [...scriptContents, ...htmlContents.flatMap((html) =>
    Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi), (match) => match[1])
      .filter((value) => value.trim()))];
  const data = collectData(scripts, risks);
  const addValues = (family, values) => {
    if (!family) return;
    values.forEach((value) => {
      for (const character of decodeHtmlEntities(value)) characterSets[family].add(character);
    });
  };
  const visit = (node, inheritedFamily, aliases = new Map()) => {
    if (
      node.type !== "element" ||
      node.tagName === "script" ||
      node.tagName === "style"
    ) {
      return;
    }

    const computedFamily = getElementFontFamily(node, inheritedFamily, rules);
    const canonicalFamily = computedFamily
      ? canonicalFamilies.get(computedFamily.toLowerCase())
      : null;

    let localAliases = aliases;
    if (node.attributes['v-for']) {
      const match = node.attributes['v-for'].match(/^(?:\(\s*)?([\w$]+)(?:\s*,[^)]*)?\)?\s+(?:in|of)\s+(.+)$/);
      if (match) {
        // Collection expressions need structural values rather than display text.
        const iterable = parseExpression(match[2]);
        if (!iterable) risks.add(`无法解析 v-for 列表: ${match[2]}`);
        const values = evaluate(iterable, data, risks).flatMap((item) => Array.isArray(item) ? item : [item]);
        localAliases = new Map(aliases);
        localAliases.set(match[1], { type: 'Literal', value: values });
      }
    }
    const bindings = new Map([...data, ...localAliases]);
    for (const [name, expression] of canonicalFamily ? Object.entries(node.attributes) : []) {
      if (name === 'v-html' || name === 'v-text' || name.startsWith(':') &&
          ['title', 'placeholder', 'alt', 'aria-label'].includes(name.slice(1))) {
        dynamicBindings.add(canonicalFamily);
        addValues(canonicalFamily, visibleValues(expression, bindings, risks, name === 'v-html'));
      }
    }
    node.children.forEach((child) => {
      if (child.type === "text") {
        if (!canonicalFamily) {
          return;
        }

        for (const match of child.value.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
          dynamicBindings.add(canonicalFamily);
          addValues(canonicalFamily, visibleValues(match[1].trim(), bindings, risks));
        }
        const decodedText = decodeHtmlEntities(
          stripVueInterpolations(child.value),
        );
        if (!/\S/u.test(decodedText)) {
          return;
        }

        const text = decodedText.replace(/\s+/g, " ");
        Array.from(text).forEach((character) =>
          characterSets[canonicalFamily].add(character),
        );
        return;
      }

      visit(child, computedFamily, localAliases);
    });
  };

  htmlContents.forEach((html) => visit(parseHtml(html), null));
  return Object.fromEntries(
    Object.entries(characterSets).map(([family, characters]) => [
      family,
      Array.from(characters).join(""),
    ]),
  );
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
  fontDir,
  manifestDir,
  runtimeCharactersByFamily = {},
  runtimeConfig = {},
  outputDir,
  risks = new Set(),
  dynamicBindings = new Set(),
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
  const scriptContents = [];
  htmlContents.forEach((html, index) => {
    for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi)) {
      const url = match[1].split(/[?#]/, 1)[0];
      if (/^(?:https?:)?\/\//i.test(url)) continue;
      const script = url.startsWith('/') ? path.resolve(outputDir, '.' + url) :
        path.resolve(path.dirname(htmlTargets[index]), url);
      if (isPathOutside(outputDir, script)) {
        risks.add(`脚本越出构建目录: ${url}`);
      } else if (fs.existsSync(script) && fs.statSync(script).isFile()) {
        scriptContents.push(fs.readFileSync(script, 'utf8'));
      } else {
        risks.add(`未找到本地脚本: ${url}`);
      }
    }
  });
  const staticCharactersByFamily = collectFontCharacters({
    htmlContents, cssFiles, fontFamilies, scriptContents, risks, dynamicBindings,
  });
  const extra = Object.fromEntries([...fontFamilies].map((family) => {
    const mode = runtimeConfig.familyOptions?.[family]?.asciiBaseline || runtimeConfig.asciiBaseline || 'none';
    const baseline = mode === 'full' ? Array.from({ length: 95 }, (_, index) =>
      String.fromCharCode(index + 32)).join('') : mode === 'common' ? ' 0123456789.,:%+-/()[]!' : '';
    return [family, (runtimeConfig.globalExtraText || '') +
      (runtimeConfig.familyExtraText?.[family] || '') + baseline];
  }));
  const charactersByFamily = mergeFontCharacterMaps(
    fontFamilies, staticCharactersByFamily, runtimeCharactersByFamily, extra,
  );
  const textPaths = new Map();
  const characterSources = new Map();

  fontPaths.forEach((fontPath) => {
    const fontName = getFontNameFromFile(fontPath);
    const fontKey = getFontKey(fontPath, fontDir);
    const fontFamily = fontFamilyByPath.get(fontKey) ||
      fontFamilyByName.get(fontName) || fontName;
    const characters = charactersByFamily[fontFamily] || "";
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
      staticCharactersByFamily[fontFamily] || "",
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
      static: uniqueAdded(staticCharactersByFamily[fontFamily]),
      runtime: uniqueAdded(runtimeCharactersByFamily[fontFamily]),
      configured: uniqueAdded(extra[fontFamily]),
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

function publishFontDirectories(items) {
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
      fs.renameSync(stage, target);
      entry.published = true;
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
    if (fs.existsSync(fontDir)) fs.cpSync(fontDir, stageFontDir, { recursive: true });
    if (fs.existsSync(manifestDir)) fs.cpSync(manifestDir, stageManifestDir, { recursive: true });
    return subsetFontsInStage({ ...options, fontDir, manifestDir, stageFontDir,
      stageManifestDir, outputDir, sourceDir, fontPage, commandRunner, verifier, runtimeConfig, runtimeRunner });
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function subsetFontsInStage({ fontDir, manifestDir, stageFontDir, stageManifestDir,
  outputDir, sourceDir, fontPage, commandRunner, verifier, runtimeConfig, runtimeRunner, ...options }) {
  const staged = (file) => path.join(stageFontDir, path.relative(fontDir, file));

  const htmlTargets = collectHtmlTargets({
    outputDir,
    sourceDir,
    fontPage,
    pages: runtimeConfig.pages,
  });
  const cssFiles = collectCssFiles(outputDir).concat(
    collectInlineCssFiles(htmlTargets),
  );
  const fontFiles = glob.sync("**/*", { cwd: fontDir, nodir: true });
  const ttfFiles = fontFiles.filter(
    (file) => TTF_EXT_RE.test(file) && !SUBSET_RE.test(file),
  );
  const fontPlan = createFontPlan({ fontDir, cssFiles, ttfFiles, fontFiles });
  const remoteFilesToRemove = getRemoteFontFilesToRemove({
    fontDir,
    fontFiles,
    remoteFontNames: fontPlan.remoteFontNames,
    localFontNames: fontPlan.localFontNames,
  });

  if (fontPlan.fontPathsToSubset.length === 0) {
    removeRemoteFontFiles(remoteFilesToRemove.map(staged));
    const removedUnused = pruneOutputFontFiles(stageFontDir, new Map());
    if (fs.existsSync(path.join(stageManifestDir, 'font-report.json'))) {
      fs.unlinkSync(path.join(stageManifestDir, 'font-report.json'));
    }
    publishFontDirectories([
      { target: fontDir, stage: stageFontDir },
      ...(fs.existsSync(stageManifestDir) || fs.existsSync(manifestDir) ? [{ target: manifestDir, stage: stageManifestDir }] : []),
    ]);
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
        });

  removeRemoteFontFiles(remoteFilesToRemove.map(staged));

  const risks = new Set();
  const dynamicBindings = new Set();
  const textPaths = writeFontCharacterFiles({
    htmlTargets,
    cssFiles,
    fontPaths: fontPlan.fontPathsToSubset,
    fontFamilyByName: fontPlan.fontFamilyByName,
    fontFamilyByPath: fontPlan.fontFamilyByPath,
    fontDir,
    manifestDir: stageManifestDir,
    runtimeCharactersByFamily,
    runtimeConfig,
    outputDir,
    risks,
    dynamicBindings,
  });

  if (runtimeConfig.dynamicTextPolicy === 'error' && risks.size) {
    throw new Error(`字体存在无法确定的动态展示文字: ${[...risks].join('；')}`);
  }
  for (const risk of risks) console.warn(`[mikit font] ${risk}`);
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
    let subsetFiles;
    try {
      subsetFiles = subsetFont(staged(fontPath), textPath, formats, commandRunner);
    } catch (error) {
      throw new Error(error.message.replaceAll(staged(fontPath), fontPath));
    }
    const details = verifier ? verifier(fontPath, textPath, subsetFiles) : null;
    if (details) {
      verification.push({ source: fontPath, ...details });
      if (details.sourceMissing?.length) console.warn(`[mikit font] ${path.basename(fontPath)} 源字体缺少 ${details.sourceMissing.length} 个请求字符`);
    }
    const family = fontPlan.fontFamilyByPath.get(getFontKey(fontPath, fontDir)) ||
      fontPlan.fontFamilyByName.get(getFontNameFromFile(fontPath)) || getFontNameFromFile(fontPath);
    const characters = fs.readFileSync(textPath, 'utf8');
    const missingDigits = Array.from('0123456789').filter((digit) => !characters.includes(digit)).join('');
    fontReports.push({
      family,
      font: path.relative(fontDir, fontPath),
      manifest: path.relative(stageManifestDir, textPath),
      characters: Array.from(characters).length,
      characterSources: textPaths.characterSources.get(fontPath),
      sample: Array.from(characters).slice(0, 80).join(''),
      dynamicBinding: dynamicBindings.has(family),
      missingDigits,
      digitSuggestion: dynamicBindings.has(family) && missingDigits
        ? `检测到可见文字动态绑定，字符清单尚未收集数字 ${missingDigits}；若运行时可能出现，` +
          `请配置 familyExtraText: ${JSON.stringify({ [family]: missingDigits })}，` +
          `或为该字体族设置 familyOptions: ${JSON.stringify({ [family]: { asciiBaseline: 'common' } })}。`
        : null,
      formats: subsetFiles.map((file) => ({
        format: path.extname(file).slice(1), bytes: fs.statSync(file).size,
      })),
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
  if (processed.length) {
    fs.mkdirSync(stageManifestDir, { recursive: true });
    fs.writeFileSync(path.join(stageManifestDir, 'font-report.json'),
    JSON.stringify({ version: 1, asciiBaseline: runtimeConfig.asciiBaseline,
      sources: { staticPages: htmlTargets.map((file) => path.relative(outputDir, file)),
        runtimePages: runtimeConfig.pages },
      risks: [...risks], fonts: fontReports }, null, 2) + '\n', 'utf8');
  } else if (fs.existsSync(path.join(stageManifestDir, 'font-report.json'))) {
    fs.unlinkSync(path.join(stageManifestDir, 'font-report.json'));
  }
  publishFontDirectories([
    { target: fontDir, stage: stageFontDir },
    ...(fs.existsSync(stageManifestDir) || fs.existsSync(manifestDir) ? [{ target: manifestDir, stage: stageManifestDir }] : []),
  ]);

  console.log(
    `字体处理完成: ${processed.length} 个已压缩，${skipped.length} 个已跳过。`,
  );
  const reportPath = processed.length ? path.join(manifestDir, 'font-report.json') : null;
  if (reportPath) {
    console.log(`[mikit font] 请查看字体报告：${reportPath}（请检查尚未收集的数字与补字建议）。`);
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
