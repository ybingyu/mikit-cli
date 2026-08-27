const { spawnSync } = require("child_process");
const fs = require("fs");
const glob = require("glob");
const path = require("path");

const { loadFontRuntimeConfig } = require("./font-runtime-config");
const { runRuntimeFontCollectorSync } = require("./font-runtime-runner");

const FONT_EXT_RE = /\.(?:eot|ttf|otf|woff2?|svg)(?:[?#].*)?$/i;
const TTF_EXT_RE = /\.ttf$/i;
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

function collectFontUrls(content) {
  const urls = [];
  const urlRe = /url\(([^)]+)\)/gi;
  let match;

  while ((match = urlRe.exec(content))) {
    urls.push(normalizeCssUrl(match[1]));
  }

  return urls;
}

function collectFontFamilyMappings(cssFiles) {
  const fontFamilyByName = new Map();

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
        }
      });
    }
  });

  return fontFamilyByName;
}

function createFontPlan({ fontDir, cssFiles, ttfFiles }) {
  const localFontNames = new Set();
  const remoteFontNames = new Set();
  const fontFamilyByName = collectFontFamilyMappings(cssFiles);

  cssFiles.forEach((cssFile) => {
    collectFontUrls(cssFile.content).forEach((url) => {
      if (isHttpFontUrl(url)) {
        remoteFontNames.add(getFontNameFromUrl(url));
        return;
      }

      if (isLocalFontUrl(url)) {
        localFontNames.add(getFontNameFromUrl(url));
      }
    });
  });

  const ttfFilesToSubset = ttfFiles
    .filter((file) => TTF_EXT_RE.test(file) && !SUBSET_RE.test(file))
    .filter((file) => localFontNames.has(getFontNameFromFile(file)))
    .map((file) => path.join(fontDir, file));

  return {
    localFontNames,
    remoteFontNames,
    fontFamilyByName,
    ttfFilesToSubset,
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

function collectHtmlTargets({
  outputDir,
  fontPage = "font.html",
  pages = [],
  warn = console.warn,
  platform = process.platform,
}) {
  const normalizedOutputDir = path.resolve(outputDir);
  let staticTargets = [];

  if (fs.existsSync(normalizedOutputDir)) {
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

  staticTargets.forEach(addTarget);
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
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>/gi;
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
      const declarationMatch = match[2].match(
        /(?:^|;)\s*font-family\s*:\s*([^;}!]+)(\s*!important)?/i,
      );
      if (!declarationMatch || selectorText.startsWith("@")) {
        continue;
      }

      const fontFamily = normalizeFontFamily(declarationMatch[1]);
      selectorText.split(",").forEach((selector) => {
        const normalizedSelector = selector.trim();
        if (!normalizedSelector) {
          return;
        }

        rules.push({
          selector: normalizedSelector,
          fontFamily,
          important: Boolean(declarationMatch[2]),
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

  const inlineMatch = (node.attributes.style || "").match(
    /(?:^|;)\s*font-family\s*:\s*([^;!]+)(?:\s*!important)?/i,
  );
  if (inlineMatch) {
    return normalizeFontFamily(inlineMatch[1]);
  }

  return selectedRule ? selectedRule.fontFamily : inheritedFamily;
}

function stripVueInterpolations(text) {
  return text.replace(/\{\{[\s\S]*?\}\}/g, "");
}

function collectFontCharacters({ htmlContents, cssFiles, fontFamilies }) {
  const canonicalFamilies = new Map(
    Array.from(fontFamilies, (family) => [family.toLowerCase(), family]),
  );
  const characterSets = Object.fromEntries(
    Array.from(fontFamilies, (family) => [family, new Set()]),
  );
  const rules = collectFontFamilyRules(cssFiles);

  const visit = (node, inheritedFamily) => {
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

    node.children.forEach((child) => {
      if (child.type === "text") {
        if (!canonicalFamily) {
          return;
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

      visit(child, computedFamily);
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
  manifestDir,
  runtimeCharactersByFamily = {},
}) {
  const htmlContents = htmlTargets.map((file) => fs.readFileSync(file, "utf8"));
  const fontFamilies = new Set(
    fontPaths.map((fontPath) => {
      const fontName = getFontNameFromFile(fontPath);
      return fontFamilyByName.get(fontName) || fontName;
    }),
  );
  const staticCharactersByFamily = collectFontCharacters({
    htmlContents,
    cssFiles,
    fontFamilies,
  });
  const charactersByFamily = mergeFontCharacterMaps(
    fontFamilies,
    staticCharactersByFamily,
    runtimeCharactersByFamily,
  );
  const textPaths = new Map();

  fontPaths.forEach((fontPath) => {
    const fontName = getFontNameFromFile(fontPath);
    const fontFamily = fontFamilyByName.get(fontName) || fontName;
    const characters = charactersByFamily[fontFamily] || "";
    const textPath = path.join(manifestDir, `${fontName}.txt`);
    if (!characters) {
      if (fs.existsSync(textPath)) {
        fs.unlinkSync(textPath);
      }
      return;
    }

    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }
    fs.writeFileSync(textPath, characters, "utf8");
    const staticCount = Array.from(
      staticCharactersByFamily[fontFamily] || "",
    ).length;
    const totalCount = Array.from(characters).length;
    const runtimeAdded = totalCount - staticCount;
    console.log(
      `字体字符清单: ${fontName}.txt（静态 ${staticCount}，` +
        `运行时新增 ${runtimeAdded}，合计 ${totalCount}）`,
    );
    textPaths.set(fontPath, textPath);
  });

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

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        "未找到 pyftsubset，请先安装 Python fonttools 并确保 pyftsubset 在 PATH 中。",
      );
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `pyftsubset 生成 ${path.basename(outputPath)} 失败，退出码: ${result.status}`,
    );
  }

  return outputPath;
}

function subsetFont(targetFontPath, textPath, commandRunner) {
  return [
    runPyftsubset(targetFontPath, textPath, "ttf", undefined, commandRunner),
    runPyftsubset(targetFontPath, textPath, "woff", "woff", commandRunner),
    runPyftsubset(targetFontPath, textPath, "woff2", "woff2", commandRunner),
  ];
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

function subsetFonts(options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const outputDir = path.resolve(
    projectDir,
    options.outputDir || options.output || "dist",
  );
  const fontDir = path.join(outputDir, "font");
  const cssDir = path.join(outputDir, "css");
  const manifestDir = path.resolve(
    projectDir,
    options.manifestDir || options.fontManifest || "font",
  );
  const fontPage = options.fontPage || "font.html";
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const runtimeConfig =
    options.runtimeConfig || loadFontRuntimeConfig(projectDir);
  const runtimeRunner = options.runtimeRunner || runRuntimeFontCollectorSync;

  if (!fs.existsSync(fontDir)) {
    throw new Error(`字体目录不存在: ${fontDir}`);
  }
  const cssFiles = collectCssFiles(cssDir);
  const fontFiles = fs.readdirSync(fontDir);
  const ttfFiles = fontFiles.filter(
    (file) => TTF_EXT_RE.test(file) && !SUBSET_RE.test(file),
  );
  const fontPlan = createFontPlan({ fontDir, cssFiles, ttfFiles });
  const remoteFilesToRemove = getRemoteFontFilesToRemove({
    fontDir,
    fontFiles,
    remoteFontNames: fontPlan.remoteFontNames,
    localFontNames: fontPlan.localFontNames,
  });

  if (fontPlan.ttfFilesToSubset.length === 0) {
    removeRemoteFontFiles(remoteFilesToRemove);
    console.log("未发现需要压缩的本地字体，已跳过字体子集化。");
    return {
      processed: [],
      skipped: [],
      manifests: [],
      removedRemote: remoteFilesToRemove,
    };
  }

  const htmlTargets = collectHtmlTargets({
    outputDir,
    fontPage,
    pages: runtimeConfig.pages,
  });
  if (htmlTargets.length === 0) {
    throw new Error(`未找到字体扫描页面: ${path.join(outputDir, fontPage)}`);
  }
  const fontFamilies = new Set(
    fontPlan.ttfFilesToSubset.map((fontPath) => {
      const fontName = getFontNameFromFile(fontPath);
      return fontPlan.fontFamilyByName.get(fontName) || fontName;
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

  removeRemoteFontFiles(remoteFilesToRemove);

  const textPaths = writeFontCharacterFiles({
    htmlTargets,
    cssFiles,
    fontPaths: fontPlan.ttfFilesToSubset,
    fontFamilyByName: fontPlan.fontFamilyByName,
    manifestDir,
    runtimeCharactersByFamily,
  });

  const processed = [];
  const skipped = [];

  fontPlan.ttfFilesToSubset.forEach((fontPath) => {
    const textPath = textPaths.get(fontPath);
    if (!textPath) {
      const fontName = getFontNameFromFile(fontPath);
      fontFiles
        .filter((file) => /\.(?:ttf|woff2?)$/i.test(file) && !SUBSET_RE.test(file))
        .filter((file) => getFontNameFromFile(file) === fontName)
        .forEach((file) => {
          const unusedFontPath = path.join(fontDir, file);
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

    const subsetFiles = subsetFont(fontPath, textPath, commandRunner);
    replaceSubsetFiles(subsetFiles);
    processed.push(fontPath);
  });

  console.log(
    `字体处理完成: ${processed.length} 个已压缩，${skipped.length} 个已跳过。`,
  );
  return {
    processed,
    skipped,
    manifests: Array.from(textPaths.values()),
    removedRemote: remoteFilesToRemove,
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
