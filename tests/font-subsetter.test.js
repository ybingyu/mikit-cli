const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectFontCharacters,
  collectHtmlTargets,
  createFontPlan,
  createPyftsubsetArgs,
  deriveHtmlTargetFromUrl,
  mergeFontCharacterMaps,
} = require("../lib/font-subsetter");

function createOutputFixture(t, { files = [], directories = [] } = {}) {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "mikit-font-subsetter-"),
  );
  const outputDir = path.join(fixtureRoot, "dist");
  fs.mkdirSync(outputDir);
  t.after(() => {
    files.forEach((relativePath) => {
      const filePath = path.join(outputDir, relativePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    directories.forEach((relativePath) => {
      const directoryPath = path.join(outputDir, relativePath);
      if (fs.existsSync(directoryPath)) {
        fs.rmdirSync(directoryPath);
      }
    });
    fs.rmdirSync(outputDir);
    fs.rmdirSync(fixtureRoot);
  });
  return outputDir;
}

test("uses explicit non-recursive fixture cleanup", () => {
  const source = fs.readFileSync(__filename, "utf8");

  assert.equal(
    source.includes(["function remove", "FixturePath"].join("")),
    false,
  );
  assert.equal(source.includes(["fs.readdir", "Sync("].join("")), false);
});

test("collects characters by computed font family", () => {
  const characters = collectFontCharacters({
    htmlContents: [
      '<div class="serif">甲乙<span class="sans">丙甲</span>丁</div>' +
        '<section class="panel"><strong>戊己戊</strong></section>',
    ],
    cssFiles: [
      {
        content: [
          '.serif{font-family:"Serif"}',
          '.sans{font-family:"Sans"}',
          '.panel strong{font-family:"Serif"}',
        ].join(""),
      },
    ],
    fontFamilies: new Set(["Serif", "Sans", "Unused"]),
  });

  assert.deepEqual(characters, {
    Serif: "甲乙丁戊己",
    Sans: "丙甲",
    Unused: "",
  });
});

test("collects characters from child combinator selectors", () => {
  const characters = collectFontCharacters({
    htmlContents: [
      '<nav class="navigation"><a><span>导航文字</span></a></nav>',
    ],
    cssFiles: [
      {
        content: '.navigation>a{font-family:"Nav"}',
      },
    ],
    fontFamilies: new Set(["Nav"]),
  });

  assert.equal(characters.Nav, "导航文字");
});

test("collects both static Vue directive branches without executing them", () => {
  const characters = collectFontCharacters({
    htmlContents: [
      '<div class="buy"><a v-if="btnDiscountStatus==0"><span>1.9元</span><b>点击抢购</b></a><a v-else><span>已购买</span></a></div>',
    ],
    cssFiles: [
      {
        content: '.buy{font-family:"Display"}',
      },
    ],
    fontFamilies: new Set(["Display"]),
  });

  assert.deepEqual(characters, {
    Display: "1.9元点击抢购已买",
  });
});

test("derives local HTML targets from runtime URLs", (t) => {
  const outputDir = createOutputFixture(t);

  assert.equal(
    deriveHtmlTargetFromUrl(
      "http://wb.y.bindyy.cn:8080/index.shtml?o=2",
      outputDir,
    ),
    path.resolve(outputDir, "index.html"),
  );
  assert.equal(
    deriveHtmlTargetFromUrl("http://example.test/campaign/", outputDir),
    path.resolve(outputDir, "campaign", "index.html"),
  );
  assert.equal(
    deriveHtmlTargetFromUrl(
      "http://example.test/campaign/page.html?mode=preview#details",
      outputDir,
    ),
    path.resolve(outputDir, "campaign", "page.html"),
  );
  assert.equal(
    deriveHtmlTargetFromUrl("http://example.test/api/data.json", outputDir),
    null,
  );
});

test("rejects runtime URL mappings outside the output directory", (t) => {
  const outputDir = createOutputFixture(t);
  const url = "http://example.test/%2e%2e%2foutside.shtml";

  assert.throws(
    () => deriveHtmlTargetFromUrl(url, outputDir),
    new Error(`运行时页面无法映射到构建目录：${url}`),
  );
});

test("merges planned font character maps in map and code point order", () => {
  const characters = mergeFontCharacterMaps(
    new Set(["Display", "Unused"]),
    { Display: "甲乙😀", Other: "不应保留" },
    { Display: "乙丙😀丁", Unused: "" },
  );

  assert.deepEqual(characters, {
    Display: "甲乙😀丙丁",
    Unused: "",
  });
});

test("collects configured static and deduplicated runtime HTML targets", (t) => {
  const outputDir = createOutputFixture(t, {
    files: ["font.html", "index.html"],
  });
  const fontPageTarget = path.resolve(outputDir, "font.html");
  const indexTarget = path.resolve(outputDir, "index.html");
  const missingTarget = path.resolve(outputDir, "missing.html");
  fs.writeFileSync(fontPageTarget, "font page");
  fs.writeFileSync(indexTarget, "runtime page");
  const pages = Object.freeze([
    "http://wb.y.bindyy.cn:8080/index.shtml?o=1",
    "http://wb.y.bindyy.cn:8080/index.shtml?o=2",
    "http://example.test/api/data.json",
    "http://example.test/missing.shtml",
  ]);
  const originalPages = Array.from(pages);
  const warnings = [];

  const targets = collectHtmlTargets({
    outputDir,
    pages,
    warn(message) {
      warnings.push(message);
    },
  });

  assert.deepEqual(targets, [fontPageTarget, indexTarget]);
  assert.deepEqual(pages, originalPages);
  assert.deepEqual(warnings, [
    "[mikit font] 无法将运行时 URL 映射为本地 HTML：http://example.test/api/data.json",
    `[mikit font] 运行时 URL 对应的本地 HTML 不存在：${missingTarget}`,
  ]);
});

test("falls back to root HTML files before appending runtime targets", (t) => {
  const outputDir = createOutputFixture(t, {
    files: [
      "first.html",
      "second.html",
      path.join("campaign", "index.html"),
    ],
    directories: ["campaign"],
  });
  const firstTarget = path.resolve(outputDir, "first.html");
  const secondTarget = path.resolve(outputDir, "second.html");
  const campaignTarget = path.resolve(outputDir, "campaign", "index.html");
  fs.mkdirSync(path.dirname(campaignTarget));
  fs.writeFileSync(firstTarget, "first");
  fs.writeFileSync(secondTarget, "second");
  fs.writeFileSync(campaignTarget, "campaign");
  const warnings = [];

  const targets = collectHtmlTargets({
    outputDir,
    fontPage: "not-found.html",
    pages: ["http://example.test/campaign/"],
    warn(message) {
      warnings.push(message);
    },
  });

  assert.deepEqual(
    new Set(targets),
    new Set([firstTarget, secondTarget, campaignTarget]),
  );
  assert.deepEqual(warnings, []);
});

test("deduplicates Windows HTML target paths case-insensitively", (t) => {
  const outputDir = createOutputFixture(t, { files: ["index.html"] });
  const indexTarget = path.resolve(outputDir, "index.html");
  fs.writeFileSync(indexTarget, "runtime page");
  const warnings = [];

  const targets = collectHtmlTargets({
    outputDir,
    fontPage: "not-found.html",
    pages: [
      "http://example.test/index.shtml",
      "http://example.test/INDEX.shtml",
    ],
    platform: "win32",
    warn(message) {
      warnings.push(message);
    },
  });

  assert.deepEqual(targets, [indexTarget]);
  assert.deepEqual(warnings, []);
});

test("wraps malformed percent-encoded runtime URL paths", (t) => {
  const outputDir = createOutputFixture(t);

  ["http://example.test/%.shtml", "http://example.test/%ZZ.shtml"].forEach(
    (url) => {
      assert.throws(
        () => deriveHtmlTargetFromUrl(url, outputDir),
        new Error(`运行时页面无法映射到构建目录：${url}`),
      );
    },
  );
});

test("rejects existing runtime targets whose real path escapes output", (t) => {
  const outputDir = createOutputFixture(t);
  const url = "http://example.test/index.shtml";
  const target = path.resolve(outputDir, "index.html");
  const realOutputDir = path.resolve(outputDir);
  const escapedTarget = path.resolve(outputDir, "..", "outside", "index.html");

  assert.throws(
    () =>
      deriveHtmlTargetFromUrl(url, outputDir, {
        existsSync(candidate) {
          const resolvedCandidate = path.resolve(candidate);
          return (
            resolvedCandidate === realOutputDir || resolvedCandidate === target
          );
        },
        realpathSync(candidate) {
          return path.resolve(candidate) === realOutputDir
            ? realOutputDir
            : escapedTarget;
        },
      }),
    new Error(`运行时页面无法映射到构建目录：${url}`),
  );
});

test("does not resolve the real path of a missing runtime target", (t) => {
  const outputDir = createOutputFixture(t);
  const url = "http://example.test/missing.shtml";
  const expectedTarget = path.resolve(outputDir, "missing.html");
  const realpathCalls = [];

  const target = deriveHtmlTargetFromUrl(url, outputDir, {
    existsSync(candidate) {
      return path.resolve(candidate) === path.resolve(outputDir);
    },
    realpathSync(candidate) {
      realpathCalls.push(path.resolve(candidate));
      return path.resolve(candidate);
    },
  });

  assert.equal(target, expectedTarget);
  assert.deepEqual(realpathCalls, [path.resolve(outputDir)]);
});

test("does not downgrade runtime target traversal errors to warnings", (t) => {
  const outputDir = createOutputFixture(t);
  const url = "http://example.test/%2e%2e%2foutside.shtml";
  const warnings = [];

  assert.throws(
    () =>
      collectHtmlTargets({
        outputDir,
        pages: [url],
        warn(message) {
          warnings.push(message);
        },
      }),
    new Error(`运行时页面无法映射到构建目录：${url}`),
  );
  assert.deepEqual(warnings, []);
});

test("plans only locally referenced TTF fonts", () => {
  const plan = createFontPlan({
    fontDir: "C:\\project\\dist\\font",
    cssFiles: [
      {
        content: [
          "@font-face{font-family:Local;src:url(../font/local.ttf)}",
          "@font-face{font-family:Remote;src:url(https://cdn.test/remote.ttf)}",
        ].join(""),
      },
    ],
    ttfFiles: ["local.ttf", "remote.ttf", "unused.ttf"],
  });

  assert.deepEqual(Array.from(plan.localFontNames), ["local"]);
  assert.deepEqual(Array.from(plan.remoteFontNames), ["remote"]);
  assert.deepEqual(plan.ttfFilesToSubset, [
    "C:\\project\\dist\\font\\local.ttf",
  ]);
});

test("maps CSS family names to their font files", () => {
  const plan = createFontPlan({
    fontDir: "C:\\project\\dist\\font",
    cssFiles: [
      {
        content:
          '@font-face{font-family:"Display Serif";src:url(../font/display.ttf)}',
      },
    ],
    ttfFiles: ["display.ttf"],
  });

  assert.equal(plan.fontFamilyByName.get("display"), "Display Serif");
});

test("passes a manifest path instead of inline Unicode", () => {
  const args = createPyftsubsetArgs({
    fontPath: "C:\\project\\dist\\font\\local.ttf",
    outputPath: "C:\\project\\dist\\font\\local-subset.woff2",
    textPath: "C:\\project\\font\\local.txt",
    flavor: "woff2",
  });

  assert.deepEqual(args, [
    "C:\\project\\dist\\font\\local.ttf",
    "--output-file=C:\\project\\dist\\font\\local-subset.woff2",
    "--text-file=C:\\project\\font\\local.txt",
    "--layout-features=*",
    "--flavor=woff2",
  ]);
  assert.equal(
    args.some((arg) => arg.startsWith("--unicodes=")),
    false,
  );
});
