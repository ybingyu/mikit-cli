"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { subsetFonts } = require("../lib/font-subsetter");

const CONFIGURED_PAGES = [
  "http://font-demo.example.test:8080/index.shtml?o=1",
  "http://font-demo.example.test:8080/index.shtml?o=2",
];

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function removeDirectory(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    fs.rmdirSync(directoryPath);
  }
}

function cleanupFixture(fixture) {
  removeFile(path.join(fixture.fontDir, "display-subset.ttf"));
  removeFile(path.join(fixture.fontDir, "display-subset.woff"));
  removeFile(path.join(fixture.fontDir, "display-subset.woff2"));
  removeFile(path.join(fixture.fontDir, "display.ttf"));
  removeFile(path.join(fixture.fontDir, "display.woff"));
  removeFile(path.join(fixture.fontDir, "display.woff2"));
  removeFile(path.join(fixture.fontDir, "remote.ttf"));
  removeFile(path.join(fixture.backupDir, "display.ttf"));
  removeFile(path.join(fixture.backupDir, "remote.ttf"));
  removeFile(path.join(fixture.manifestDir, "display.txt"));
  removeFile(path.join(fixture.manifestDir, "font-report.json"));
  removeFile(path.join(fixture.cssDir, "app.css"));
  removeFile(path.join(fixture.outputDir, "index.html"));
  removeFile(path.join(fixture.root, "package.json"));
  removeDirectory(fixture.backupDir);
  removeDirectory(fixture.manifestDir);
  removeDirectory(fixture.fontDir);
  removeDirectory(fixture.cssDir);
  removeDirectory(fixture.outputDir);
  removeDirectory(fixture.root);
}

function createFixture(t, { pages, includeRemote = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mikit-font-runtime-"));
  const outputDir = path.join(root, "dist");
  const cssDir = path.join(outputDir, "css");
  const fontDir = path.join(outputDir, "font");
  const backupDir = path.join(fontDir, "bak");
  const manifestDir = path.join(root, "manifests");
  const fixture = {
    root,
    outputDir,
    cssDir,
    fontDir,
    backupDir,
    manifestDir,
  };

  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(fontDir);
  fs.writeFileSync(
    path.join(outputDir, "index.html"),
    '<div class="buy"><a v-if="btnDiscountStatus==0"><span>1.9元</span><b>点击抢购</b></a><a v-else><span>已购买</span></a></div>',
    "utf8",
  );
  fs.writeFileSync(
    path.join(cssDir, "app.css"),
    [
      "@font-face{font-family:Display;src:url(../font/display.ttf)}",
      includeRemote
        ? "@font-face{font-family:Remote;src:url(https://cdn.example.test/remote.ttf)}"
        : "",
      ".buy{font-family:Display}",
    ].join(""),
    "utf8",
  );
  fs.writeFileSync(path.join(fontDir, "display.ttf"), "original display");
  if (includeRemote) {
    fs.writeFileSync(path.join(fontDir, "remote.ttf"), "original remote");
  }

  const fontConfig = {
    wait: 0,
    timeout: 5000,
  };
  if (pages !== undefined) {
    fontConfig.pages = pages;
  }
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ mikit: { font: fontConfig } }, null, 2),
    "utf8",
  );

  t.after(() => cleanupFixture(fixture));
  return fixture;
}

function createCommandRunner(calls) {
  return (command, args) => {
    calls.push(args);
    const outputArgument = args.find((argument) =>
      argument.startsWith("--output-file="),
    );
    assert.ok(outputArgument, "pyftsubset should receive --output-file");
    fs.writeFileSync(outputArgument.slice("--output-file=".length), "subset");
    return { status: 0 };
  };
}

test("merges static and runtime characters without backing up fonts in dist", (t) => {
  const fixture = createFixture(t, {
    pages: CONFIGURED_PAGES,
    includeRemote: true,
  });
  const runtimeCalls = [];
  const pyftCalls = [];
  const logs = [];
  const originalLog = console.log;
  const manifestPath = path.join(fixture.manifestDir, "display.txt");

  try {
    console.log = (message) => logs.push(String(message));
    subsetFonts({
      projectDir: fixture.root,
      output: "dist",
      fontPage: "index.html",
      manifestDir: fixture.manifestDir,
      runtimeRunner(config) {
        runtimeCalls.push(config);
        return { Display: "300元京东E卡溯月至臻圣器匣[绑]" };
      },
      commandRunner: createCommandRunner(pyftCalls),
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(runtimeCalls[0].pages, CONFIGURED_PAGES);
  assert.deepEqual(runtimeCalls[0].fontFamilies, ["Display"]);
  assert.equal(
    fs.readFileSync(manifestPath, "utf8"),
    "1.9元点击抢购已买30京东E卡溯月至臻圣器匣[绑]",
  );
  assert.equal(pyftCalls.length, 1);
  assert.equal(
    pyftCalls.every((args) => args.some((arg) => arg.startsWith('--text-file=') && path.basename(arg.slice(12)) === 'display.txt')),
    true,
  );
  assert.equal(fs.existsSync(path.join(fixture.fontDir, "display.ttf")), true);
  assert.equal(fs.existsSync(path.join(fixture.fontDir, "display.woff")), false);
  assert.equal(fs.existsSync(path.join(fixture.fontDir, "display.woff2")), false);
  assert.equal(fs.existsSync(path.join(fixture.fontDir, "remote.ttf")), false);
  assert.equal(fs.existsSync(fixture.backupDir), false);
  assert.equal(logs.includes("字体静态页面: index.html"), true);
  assert.equal(logs.includes("字体运行时页面: /index.shtml?o=1"), true);
  assert.equal(logs.includes("字体运行时页面: /index.shtml?o=2"), true);
  assert.equal(
    logs.some((line) =>
      /display\.txt（静态 10，其他新增 16，合计 26）/.test(line),
    ),
    true,
  );
});

test("runtime collection failure happens before any local or remote font mutation", (t) => {
  const fixture = createFixture(t, {
    pages: CONFIGURED_PAGES,
    includeRemote: true,
  });
  const localFontPath = path.join(fixture.fontDir, "display.ttf");
  const remoteFontPath = path.join(fixture.fontDir, "remote.ttf");
  const originalLocalBytes = fs.readFileSync(localFontPath);
  const originalRemoteBytes = fs.readFileSync(remoteFontPath);
  const manifestPath = path.join(fixture.manifestDir, "display.txt");

  assert.throws(
    () =>
      subsetFonts({
        projectDir: fixture.root,
        output: "dist",
        fontPage: "index.html",
        manifestDir: fixture.manifestDir,
        runtimeRunner() {
          throw new Error("运行时字体页面提取失败");
        },
        commandRunner() {
          throw new Error("动态失败后不应执行 pyftsubset");
        },
      }),
    new Error("运行时字体页面提取失败"),
  );

  assert.deepEqual(fs.readFileSync(localFontPath), originalLocalBytes);
  assert.deepEqual(fs.readFileSync(remoteFontPath), originalRemoteBytes);
  assert.equal(
    fs.existsSync(path.join(fixture.backupDir, "remote.ttf")),
    false,
  );
  assert.equal(fs.existsSync(manifestPath), false);
});

test("missing runtime pages keeps the existing static-only workflow", (t) => {
  const fixture = createFixture(t);
  const pyftCalls = [];
  let runtimeCalls = 0;

  const result = subsetFonts({
    projectDir: fixture.root,
    output: "dist",
    fontPage: "index.html",
    manifestDir: fixture.manifestDir,
    runtimeRunner() {
      runtimeCalls += 1;
      throw new Error("没有 pages 时不应启动运行时采集");
    },
    commandRunner: createCommandRunner(pyftCalls),
  });

  assert.equal(runtimeCalls, 0);
  assert.equal(pyftCalls.length, 1);
  assert.equal(result.processed.length, 1);
  assert.equal(
    fs.readFileSync(path.join(fixture.manifestDir, "display.txt"), "utf8"),
    "1.9元点击抢购已买",
  );
});
