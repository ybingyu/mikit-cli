# Hybrid Runtime Font Subsetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `mikit font` and `mikit build --minfont` so each local font manifest contains the union of static template text and rendered text from explicitly configured URLs.

**Architecture:** Keep the existing synchronous font workflow and static HTML parser. Load and validate optional `mikit.font` settings, run the asynchronous Playwright collector in a dedicated Node worker through a synchronous `spawnSync` bridge, then merge both per-family character maps before any font file is moved, backed up, or replaced.

**Tech Stack:** Node.js 18 CommonJS, Commander 11, `playwright-core` 1.48.2, Node `node:test`/`assert`, the existing CSS/HTML parser, and `pyftsubset`.

---

## File structure

- Create `lib/font-runtime-config.js`: optional `mikit.font` loading, defaults, URL/type/path validation.
- Create `lib/font-runtime-collector.js`: Chrome/Edge launch, explicit URL navigation, browser DOM extraction, per-family collection.
- Create `lib/font-runtime-runner.js`: synchronous child-process bridge and result validation.
- Create `lib/font-runtime-worker.js`: stdin/stdout JSON adapter around the asynchronous collector.
- Modify `lib/font-subsetter.js`: URL-derived static targets, map merge, and mutation-safe runtime preflight.
- Modify `bin/mikit.js`: concise standalone `mikit font` failures.
- Modify `lib/project-initializer.js`: disabled-by-default runtime font settings.
- Modify `package.json` and `package-lock.json`: `playwright-core` and focused tests.
- Create `tests/font-runtime-config.test.js`, `tests/font-runtime-collector.test.js`, `tests/font-runtime-runner.test.js`, `tests/font-runtime-integration.test.js`, and `tests/font-runtime-smoke.js`.
- Modify `tests/font-subsetter.test.js`, `tests/font-cli.test.js`, `tests/project-init.test.js`, and `README.md`.

### Task 1: Optional runtime-font configuration

**Files:**
- Create: `tests/font-runtime-config.test.js`
- Create: `lib/font-runtime-config.js`

- [ ] **Step 1: Write failing defaults and valid-settings tests**

Create `tests/font-runtime-config.test.js` with `node:test`. Use `fs.mkdtempSync()`, unlink each named file, and remove only the known empty fixture directory with `fs.rmdirSync()`:

```js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_FONT_RUNTIME_CONFIG,
  loadFontRuntimeConfig,
  validateFontRuntimeConfig
} = require('../lib/font-runtime-config');

function writePackage(dir, value) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(value, null, 2), 'utf8');
}
function cleanup(dir, names) {
  names.forEach((name) => {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
  if (fs.existsSync(dir)) fs.rmdirSync(dir);
}

test('missing package or mikit.font keeps static-only defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-config-'));
  try {
    assert.deepEqual(loadFontRuntimeConfig(dir), DEFAULT_FONT_RUNTIME_CONFIG);
    writePackage(dir, { name: 'fixture', mikit: { png: {} } });
    assert.deepEqual(loadFontRuntimeConfig(dir), DEFAULT_FONT_RUNTIME_CONFIG);
  } finally {
    cleanup(dir, ['package.json']);
  }
});

test('loads ordered pages and resolves a relative browser path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-config-'));
  const browserPath = path.join(dir, 'browser.exe');
  try {
    fs.writeFileSync(browserPath, 'fixture', 'utf8');
    writePackage(dir, { mikit: { font: {
      pages: [
        'http://wb.y.bindyy.cn:8080/index.shtml?o=1',
        'http://wb.y.bindyy.cn:8080/index.shtml?o=2'
      ],
      waitFor: '#app', wait: 250, timeout: 5000,
      browserExecutable: 'browser.exe', ignoredKey: true
    } } });
    assert.deepEqual(loadFontRuntimeConfig(dir), {
      pages: [
        'http://wb.y.bindyy.cn:8080/index.shtml?o=1',
        'http://wb.y.bindyy.cn:8080/index.shtml?o=2'
      ],
      waitFor: '#app', wait: 250, timeout: 5000,
      browserExecutable: browserPath
    });
  } finally {
    cleanup(dir, ['package.json', 'browser.exe']);
  }
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node tests/font-runtime-config.test.js`

Expected: FAIL with `Cannot find module '../lib/font-runtime-config'`.

- [ ] **Step 3: Add failing validation cases**

Append table-driven assertions:

```js
const invalidCases = [
  [{ pages: 'http://example.test' }, /pages 必须是数组/],
  [{ pages: [1] }, /pages\[0\] 必须是 HTTP 或 HTTPS URL/],
  [{ pages: ['ftp://example.test/a'] }, /pages\[0\] 必须是 HTTP 或 HTTPS URL/],
  [{ pages: ['https://u:p@example.test/a'] }, /不能包含用户名或密码/],
  [{ pages: [], waitFor: '' }, /waitFor 必须是非空 CSS 选择器/],
  [{ pages: [], wait: -1 }, /wait 必须是非负整数/],
  [{ pages: [], wait: 1.5 }, /wait 必须是非负整数/],
  [{ pages: [], timeout: 0 }, /timeout 必须是正整数/],
  [{ pages: [], timeout: 1.5 }, /timeout 必须是正整数/],
  [{ pages: [], browserExecutable: 1 }, /browserExecutable 必须是路径字符串/],
  [{ pages: [], browserExecutable: 'missing.exe' }, /浏览器文件不存在/]
];
invalidCases.forEach(([config, pattern]) => {
  assert.throws(() => validateFontRuntimeConfig(config, { projectDir: process.cwd() }), pattern);
});
```

Also write malformed `package.json` and assert `loadFontRuntimeConfig()` reports `无法读取项目 package.json`.

- [ ] **Step 4: Implement the loader**

Create `lib/font-runtime-config.js`:

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FONT_RUNTIME_CONFIG = Object.freeze({
  pages: Object.freeze([]), waitFor: null, wait: 1000,
  timeout: 15000, browserExecutable: null
});

function validateFontRuntimeConfig(config, options = {}) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const existsSync = options.existsSync || fs.existsSync;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('mikit.font 必须是对象。');
  }
  const pages = config.pages === undefined ? [] : config.pages;
  if (!Array.isArray(pages)) throw new Error('mikit.font.pages 必须是数组。');
  const normalizedPages = pages.map((value, index) => {
    if (typeof value !== 'string') {
      throw new Error(`mikit.font.pages[${index}] 必须是 HTTP 或 HTTPS URL。`);
    }
    let parsed;
    try { parsed = new URL(value); }
    catch (error) {
      throw new Error(`mikit.font.pages[${index}] 必须是 HTTP 或 HTTPS URL：${value}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error(`mikit.font.pages[${index}] 必须是 HTTP 或 HTTPS URL：${value}`);
    }
    if (parsed.username || parsed.password) {
      throw new Error(`mikit.font.pages[${index}] 不能包含用户名或密码：${value}`);
    }
    return parsed.href;
  });
  const waitFor = config.waitFor === undefined || config.waitFor === null ? null : config.waitFor;
  if (waitFor !== null && (typeof waitFor !== 'string' || !waitFor.trim())) {
    throw new Error('mikit.font.waitFor 必须是非空 CSS 选择器。');
  }
  const wait = config.wait === undefined ? 1000 : config.wait;
  if (!Number.isInteger(wait) || wait < 0) throw new Error('mikit.font.wait 必须是非负整数。');
  const timeout = config.timeout === undefined ? 15000 : config.timeout;
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error('mikit.font.timeout 必须是正整数。');
  let browserExecutable = config.browserExecutable;
  if (browserExecutable === undefined || browserExecutable === '') {
    browserExecutable = null;
  } else {
    if (typeof browserExecutable !== 'string') {
      throw new Error('mikit.font.browserExecutable 必须是路径字符串。');
    }
    browserExecutable = path.resolve(projectDir, browserExecutable);
    if (!existsSync(browserExecutable)) {
      throw new Error(`mikit.font.browserExecutable 浏览器文件不存在：${browserExecutable}`);
    }
  }
  return {
    pages: normalizedPages,
    waitFor: waitFor === null ? null : waitFor.trim(),
    wait, timeout, browserExecutable
  };
}

function loadFontRuntimeConfig(projectDir) {
  const resolved = path.resolve(projectDir || process.cwd());
  const packagePath = path.join(resolved, 'package.json');
  if (!fs.existsSync(packagePath)) return { ...DEFAULT_FONT_RUNTIME_CONFIG, pages: [] };
  let packageJson;
  try { packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')); }
  catch (error) { throw new Error(`无法读取项目 package.json：${error.message}`); }
  const fontConfig = packageJson && packageJson.mikit && packageJson.mikit.font;
  if (fontConfig === undefined) return { ...DEFAULT_FONT_RUNTIME_CONFIG, pages: [] };
  return validateFontRuntimeConfig(fontConfig, { projectDir: resolved });
}

module.exports = {
  DEFAULT_FONT_RUNTIME_CONFIG,
  loadFontRuntimeConfig,
  validateFontRuntimeConfig
};
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `node tests/font-runtime-config.test.js`

Expected: all tests PASS.

```bash
git add lib/font-runtime-config.js tests/font-runtime-config.test.js
git commit -m "feat: validate runtime font page config"
```

### Task 2: Asynchronous browser collector with an injectable adapter

**Files:**
- Create: `tests/font-runtime-collector.test.js`
- Create: `lib/font-runtime-collector.js`

- [ ] **Step 1: Write failing browser-side extraction tests**

Create fake text nodes and invoke exported `extractTextRecords()` directly. Include normal text, `display:none` text, and text under `SCRIPT`, `STYLE`, and `NOSCRIPT`:

```js
const rows = [
  ['可见文字', 'DIV', '"Display", serif'],
  ['隐藏状态', 'SPAN', '"Display", serif'],
  ['脚本字符', 'SCRIPT', 'monospace'],
  ['样式字符', 'STYLE', 'monospace'],
  ['降级字符', 'NOSCRIPT', 'serif']
];
const nodes = rows.map(([text, tag, family]) => ({
  nodeValue: text,
  parentElement: {
    __family: family,
    closest(selector) {
      return selector.split(',').includes(tag.toLowerCase()) ? {} : null;
    }
  }
}));
const original = {
  document: global.document,
  NodeFilter: global.NodeFilter,
  getComputedStyle: global.getComputedStyle
};
try {
  let index = 0;
  global.NodeFilter = { SHOW_TEXT: 4 };
  global.document = {
    body: {},
    createTreeWalker() { return { nextNode: () => nodes[index++] || null }; }
  };
  global.getComputedStyle = (element) => ({ fontFamily: element.__family });
  assert.deepEqual(extractTextRecords(), [
    { text: '可见文字', fontFamily: '"Display", serif' },
    { text: '隐藏状态', fontFamily: '"Display", serif' }
  ]);
} finally {
  global.document = original.document;
  global.NodeFilter = original.NodeFilter;
  global.getComputedStyle = original.getComputedStyle;
}
```

This test proves hidden text is not filtered by layout state, while executable/non-rendered tag contents are excluded.

- [ ] **Step 2: Write failing two-URL adapter tests**

Inject a fake `chromium`. Return `300元京东E卡` for `?o=1` and `溯月至臻圣器匣[绑]` for `?o=2`; include repeated characters and a non-local family. Assert:

```js
assert.deepEqual(result, {
  Display: '300元京东E卡溯月至臻圣器匣[绑]',
  Unused: ''
});
assert.deepEqual(visited, [
  'http://wb.y.bindyy.cn:8080/index.shtml?o=1',
  'http://wb.y.bindyy.cn:8080/index.shtml?o=2'
]);
assert.deepEqual(gotoOptions, { waitUntil: 'domcontentloaded', timeout: 15000 });
assert.deepEqual(selectorOptions, { state: 'attached', timeout: 15000 });
assert.deepEqual(delays, [1000, 1000]);
```

Emit one fake console error and assert it produces a warning but the collection still resolves.

- [ ] **Step 3: Run and verify RED**

Run: `node tests/font-runtime-collector.test.js`

Expected: FAIL with `Cannot find module '../lib/font-runtime-collector'`.

- [ ] **Step 4: Implement extraction, browser selection, navigation, and collection**

Create `lib/font-runtime-collector.js`:

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function normalizeRuntimeFontFamily(value) {
  return String(value || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}
function extractTextRecords() {
  const output = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript')) continue;
    const text = String(node.nodeValue || '').replace(/\s+/g, ' ');
    if (!text.trim()) continue;
    output.push({ text, fontFamily: getComputedStyle(parent).fontFamily });
  }
  return output;
}
function addRecords(characterSets, canonicalFamilies, records, pageUrl) {
  if (!Array.isArray(records)) throw new Error(`运行时字体提取返回格式错误：${pageUrl}`);
  records.forEach((record, index) => {
    if (!record || typeof record.text !== 'string' || typeof record.fontFamily !== 'string') {
      throw new Error(`运行时字体提取返回格式错误：${pageUrl} 第 ${index + 1} 项`);
    }
    const normalized = normalizeRuntimeFontFamily(record.fontFamily);
    const canonical = canonicalFamilies.get(normalized.toLowerCase());
    if (!canonical) return;
    Array.from(record.text).forEach((character) => characterSets[canonical].add(character));
  });
}
function getBrowserExecutableCandidates(platform = process.platform, env = process.env) {
  const candidates = [];
  const add = (base, ...parts) => {
    if (base) candidates.push(path.join(base, ...parts));
  };
  if (platform === 'win32') {
    add(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe');
    add(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe');
    add(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe');
    add(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    add(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    add(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable'
    );
  }
  return candidates;
}
function resolveBrowserExecutable(config, dependencies = {}) {
  const existsSync = dependencies.existsSync || fs.existsSync;
  const env = dependencies.env || process.env;
  if (config.browserExecutable) return config.browserExecutable;
  if (env.MIKIT_BROWSER_EXECUTABLE) {
    const envPath = path.resolve(env.MIKIT_BROWSER_EXECUTABLE);
    if (!existsSync(envPath)) {
      throw new Error(`MIKIT_BROWSER_EXECUTABLE 浏览器文件不存在：${envPath}`);
    }
    return envPath;
  }
  const candidates = dependencies.candidates ||
    getBrowserExecutableCandidates(dependencies.platform, env);
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error('未找到可用的 Chrome 或 Edge 浏览器。');
  return match;
}
async function launchInstalledBrowser(chromium, config, dependencies = {}) {
  const executablePath = resolveBrowserExecutable(config, dependencies);
  return chromium.launch({ headless: true, executablePath });
}
async function collectRuntimeFontCharacters(config, dependencies = {}) {
  const chromium = dependencies.chromium || require('playwright-core').chromium;
  const onWarning = dependencies.onWarning || ((message) => console.warn(message));
  const fontFamilies = Array.from(config.fontFamilies || []);
  const canonicalFamilies = new Map(fontFamilies.map((family) => [family.toLowerCase(), family]));
  const characterSets = Object.fromEntries(fontFamilies.map((family) => [family, new Set()]));
  const browser = await launchInstalledBrowser(chromium, config, dependencies);
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') onWarning(`[mikit font] 页面控制台错误：${message.text()}`);
    });
    for (const pageUrl of config.pages) {
      try {
        const response = await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded', timeout: config.timeout
        });
        if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
        if (config.waitFor) {
          await page.waitForSelector(config.waitFor, {
            state: 'attached', timeout: config.timeout
          });
        }
        if (config.wait > 0) await page.waitForTimeout(config.wait);
        addRecords(characterSets, canonicalFamilies, await page.evaluate(extractTextRecords), pageUrl);
      } catch (error) {
        throw new Error(`运行时字体页面提取失败（${pageUrl}）：${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  return Object.fromEntries(Object.entries(characterSets).map(([family, characters]) => [
    family, Array.from(characters).join('')
  ]));
}

module.exports = {
  addRecords,
  collectRuntimeFontCharacters,
  extractTextRecords,
  getBrowserExecutableCandidates,
  launchInstalledBrowser,
  normalizeRuntimeFontFamily,
  resolveBrowserExecutable
};
```

- [ ] **Step 5: Add exact failure and browser-selection tests**

Assert with injected fakes:

- explicit `browserExecutable` wins and launches with `{ headless: true, executablePath }`;
- `MIKIT_BROWSER_EXECUTABLE` is second in priority and a missing environment path fails clearly;
- standard Windows, macOS, and Linux Chrome/Edge candidate paths are checked in documented order;
- no existing candidate reports `未找到可用的 Chrome 或 Edge 浏览器`;
- HTTP 500, navigation rejection, selector timeout, and malformed evaluation data include the exact URL;
- `browser.close()` runs after success and failure;
- a second-URL failure rejects the complete operation, so no partial map is returned.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node tests/font-runtime-collector.test.js`

Expected: all tests PASS without launching a real browser.

```bash
git add lib/font-runtime-collector.js tests/font-runtime-collector.test.js
git commit -m "feat: collect rendered font characters"
```

### Task 3: Synchronous worker bridge

**Files:**
- Create: `tests/font-runtime-runner.test.js`
- Create: `lib/font-runtime-runner.js`
- Create: `lib/font-runtime-worker.js`

- [ ] **Step 1: Write failing serialization and validation tests**

Inject a fake spawn function:

```js
const calls = [];
const result = runRuntimeFontCollectorSync({
  pages: ['http://example.test/index.shtml?o=1'],
  waitFor: '#app', wait: 1000, timeout: 15000,
  browserExecutable: null, fontFamilies: ['Display']
}, {
  spawn(command, args, options) {
    calls.push({ command, args, options });
    return { status: 0, stdout: '{"Display":"动态文字"}', stderr: '' };
  },
  workerPath: 'C:\\fixture\\font-runtime-worker.js'
});
assert.deepEqual(result, { Display: '动态文字' });
assert.equal(calls[0].command, process.execPath);
assert.deepEqual(calls[0].args, ['C:\\fixture\\font-runtime-worker.js']);
assert.equal(
  JSON.parse(calls[0].options.input).pages[0],
  'http://example.test/index.shtml?o=1'
);
```

Also assert spawn errors, non-zero exits, invalid JSON, arrays, and non-string map values produce a concise error.

- [ ] **Step 2: Run and verify RED**

Run: `node tests/font-runtime-runner.test.js`

Expected: FAIL with `Cannot find module '../lib/font-runtime-runner'`.

- [ ] **Step 3: Implement the synchronous runner**

Create `lib/font-runtime-runner.js`:

```js
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function validateRuntimeCharacterMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('运行时字体提取返回格式错误：结果必须是对象。');
  }
  Object.entries(value).forEach(([family, characters]) => {
    if (!family || typeof characters !== 'string') {
      throw new Error('运行时字体提取返回格式错误：字体族和值必须是字符串。');
    }
  });
  return value;
}
function runRuntimeFontCollectorSync(config, dependencies = {}) {
  const spawn = dependencies.spawn || spawnSync;
  const workerPath = dependencies.workerPath || path.join(__dirname, 'font-runtime-worker.js');
  const result = spawn(process.execPath, [workerPath], {
    input: JSON.stringify(config), encoding: 'utf8', windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw new Error(`运行时字体提取失败：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`运行时字体提取失败：子进程退出码 ${result.status}。`);
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch (error) { throw new Error(`运行时字体提取返回格式错误：${error.message}`); }
  return validateRuntimeCharacterMap(parsed);
}
module.exports = { runRuntimeFontCollectorSync, validateRuntimeCharacterMap };
```

- [ ] **Step 4: Implement and test the worker**

Create `lib/font-runtime-worker.js`:

```js
'use strict';
const { collectRuntimeFontCharacters } = require('./font-runtime-collector');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  try {
    const config = JSON.parse(input);
    const result = await collectRuntimeFontCharacters(config, {
      onWarning(message) { process.stderr.write(`${message}\n`); }
    });
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stderr.write(`[mikit font] ${error.message}\n`);
    process.exitCode = 1;
  }
});
```

Add a subprocess test that sends `{` to the real worker and asserts status `1`, empty stdout, stderr beginning `[mikit font]`, and no stack trace.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node tests/font-runtime-runner.test.js`

Expected: all tests PASS.

```bash
git add lib/font-runtime-runner.js lib/font-runtime-worker.js tests/font-runtime-runner.test.js
git commit -m "feat: bridge runtime font collection synchronously"
```

### Task 4: Static branch coverage, URL mapping, and deterministic merge

**Files:**
- Modify: `tests/font-subsetter.test.js`
- Modify: `lib/font-subsetter.js:154-169,482-571,655-765`

- [ ] **Step 1: Add failing static conditional-branch tests**

Extend imports with `collectHtmlTargets`, `deriveHtmlTargetFromUrl`, and `mergeFontCharacterMaps`. Assert both button states are collected without evaluating Vue directives:

```js
const characters = collectFontCharacters({
  htmlContents: [
    '<div class="buy">' +
      '<a v-if="btnDiscountStatus==0"><span>1.9元</span><b>点击抢购</b></a>' +
      '<a v-else><span>已购买</span></a>' +
    '</div>'
  ],
  cssFiles: [{ content: '.buy{font-family:"Display"}' }],
  fontFamilies: new Set(['Display'])
});
assert.equal(characters.Display, '1.9元点击抢购已买');
```

The expected string deduplicates the repeated `购` by Unicode code point while retaining first-seen order.

- [ ] **Step 2: Add failing URL-target and merge tests**

Create temporary `dist/index.html` and `dist/campaign/index.html`. Assert:

```js
assert.equal(
  deriveHtmlTargetFromUrl('http://wb.y.bindyy.cn:8080/index.shtml?o=2#top', outputDir),
  path.join(outputDir, 'index.html')
);
assert.equal(
  deriveHtmlTargetFromUrl('https://example.test/campaign/', outputDir),
  path.join(outputDir, 'campaign', 'index.html')
);
assert.deepEqual(
  mergeFontCharacterMaps(
    new Set(['Display', 'Unused']),
    { Display: '甲乙😀' },
    { Display: '乙丙😀丁', Unused: '' }
  ),
  { Display: '甲乙😀丙丁', Unused: '' }
);
```

Call `collectHtmlTargets()` with both approved `wb` URLs and assert `index.html` occurs once. Add a missing mapped file and assert one warning without removing runtime URL handling.

- [ ] **Step 3: Run and verify RED**

Run: `node tests/font-subsetter.test.js`

Expected: FAIL because the new URL and merge functions are absent.

- [ ] **Step 4: Implement URL mapping and map merging**

Add and export:

```js
function deriveHtmlTargetFromUrl(pageUrl, outputDir) {
  const parsed = new URL(pageUrl);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  else if (/\.shtml$/i.test(pathname)) pathname = pathname.replace(/\.shtml$/i, '.html');
  else if (!/\.html$/i.test(pathname)) return null;
  const root = path.resolve(outputDir);
  const target = path.resolve(root, pathname.replace(/^\/+/, ''));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`运行时页面无法映射到构建目录：${pageUrl}`);
  }
  return target;
}
function mergeFontCharacterMaps(fontFamilies, ...maps) {
  const result = Object.fromEntries(Array.from(fontFamilies, (family) => [family, new Set()]));
  maps.forEach((map) => {
    Object.entries(map || {}).forEach(([family, characters]) => {
      if (!result[family]) return;
      Array.from(characters).forEach((character) => result[family].add(character));
    });
  });
  return Object.fromEntries(Object.entries(result).map(([family, characters]) => [
    family, Array.from(characters).join('')
  ]));
}
```

Change `collectHtmlTargets({ outputDir, fontPage, pages = [], warn = console.warn })` to first preserve the existing requested-page/root-HTML behavior, then append derived targets. Deduplicate normalized absolute paths. For each unsupported or missing derived file call exactly one warning:

```js
warn(`[mikit font] 运行时 URL 对应的本地 HTML 不存在：${target}`);
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `node tests/font-subsetter.test.js`

Expected: all static parser, mapping, and merge tests PASS.

```bash
git add lib/font-subsetter.js tests/font-subsetter.test.js
git commit -m "feat: map runtime pages to static templates"
```

### Task 5: Integrate runtime data before every font mutation

**Files:**
- Create: `tests/font-runtime-integration.test.js`
- Modify: `lib/font-subsetter.js:154-169,482-571,655-765`

- [ ] **Step 1: Write a failing hybrid end-to-end fixture test**

Create `tests/font-runtime-integration.test.js`. The temporary fixture contains:

```text
package.json
 dist/index.html
 dist/css/app.css
 dist/font/display.ttf
```

Use this HTML and CSS:

```html
<div class="buy">
  <a v-if="btnDiscountStatus==0"><span>1.9元</span><b>点击抢购</b></a>
  <a v-else><span>已购买</span></a>
</div>
```

```css
@font-face{font-family:Display;src:url(../font/display.ttf)}
.buy{font-family:Display}
```

Configure exactly:

```js
pages: [
  'http://wb.y.bindyy.cn:8080/index.shtml?o=1',
  'http://wb.y.bindyy.cn:8080/index.shtml?o=2'
]
```

Inject a `runtimeRunner` returning:

```js
{ Display: '300元京东E卡溯月至臻圣器匣[绑]' }
```

Inject a `commandRunner` that finds the `--output-file=` argument, writes known bytes to that exact path, and returns `{ status: 0 }`. Assert:

```js
assert.deepEqual(runtimeCalls[0].pages, configuredPages);
assert.deepEqual(runtimeCalls[0].fontFamilies, ['Display']);
assert.equal(
  fs.readFileSync(manifestPath, 'utf8'),
  '1.9元点击抢购已买30京东E卡溯月至臻圣器匣[绑]'
);
assert.equal(pyftCalls.length, 3);
assert.equal(pyftCalls.every((args) => args.includes(`--text-file=${manifestPath}`)), true);
assert.equal(fs.existsSync(path.join(fontDir, 'display.ttf')), true);
assert.equal(fs.existsSync(path.join(fontDir, 'display.woff')), true);
assert.equal(fs.existsSync(path.join(fontDir, 'display.woff2')), true);
assert.equal(fs.existsSync(path.join(fontDir, 'bak', 'display.ttf')), true);
assert.equal(logs.includes('字体静态页面: index.html'), true);
assert.equal(logs.includes('字体运行时页面: /index.shtml?o=1'), true);
assert.equal(logs.includes('字体运行时页面: /index.shtml?o=2'), true);
assert.equal(
  logs.some((line) => /display\.txt（静态 10，运行时新增 16，合计 26）/.test(line)),
  true
);
```

Capture `console.log` only for the duration of this test and restore it in `finally`. Use only explicit `fs.unlinkSync()` calls for known files and `fs.rmdirSync()` for known empty directories.

- [ ] **Step 2: Add failing all-or-nothing mutation-order tests**

Create a second fixture with local `display.ttf` and remote-only `remote.ttf`. Make `runtimeRunner` throw `运行时字体页面提取失败`. Assert:

```js
assert.deepEqual(fs.readFileSync(localFontPath), originalLocalBytes);
assert.deepEqual(fs.readFileSync(remoteFontPath), originalRemoteBytes);
assert.equal(fs.existsSync(path.join(fontDir, 'bak', 'remote.ttf')), false);
assert.equal(fs.existsSync(manifestPath), false);
```

Create a third fixture without `mikit.font.pages`; inject a runner that throws if called. Assert static-only subsetting completes, proving an absent or empty URL list does not launch a browser worker.

- [ ] **Step 3: Run and verify RED**

Run: `node tests/font-runtime-integration.test.js`

Expected: FAIL because `subsetFonts()` neither loads runtime config nor calls `runtimeRunner`.

- [ ] **Step 4: Load runtime settings at the synchronous font boundary**

Add top-level imports:

```js
const { loadFontRuntimeConfig } = require('./font-runtime-config');
const { runRuntimeFontCollectorSync } = require('./font-runtime-runner');
```

At the start of `subsetFonts()` after resolving paths but before creating `bak`, load the optional config:

```js
const runtimeConfig = options.runtimeConfig || loadFontRuntimeConfig(projectDir);
const runtimeRunner = options.runtimeRunner || runRuntimeFontCollectorSync;
```

This keeps `builder.build()` and Commander actions synchronous; no `parseAsync()` conversion is required.

- [ ] **Step 5: Collect runtime characters before moving, backing up, writing, or replacing fonts**

After creating `fontPlan`, preserve remote-only behavior but make the local-font path preflight first:

```js
if (fontPlan.ttfFilesToSubset.length === 0) {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  moveRemoteFontFiles(remoteFilesToMove, backupDir);
  console.log('未发现需要压缩的本地字体，已跳过字体子集化。');
  return { processed: [], skipped: [], manifests: [], movedRemote: remoteFilesToMove };
}

const htmlTargets = collectHtmlTargets({
  outputDir,
  fontPage,
  pages: runtimeConfig.pages
});
if (htmlTargets.length === 0) {
  throw new Error(`未找到字体扫描页面: ${path.join(outputDir, fontPage)}`);
}
const fontFamilies = new Set(fontPlan.ttfFilesToSubset.map((fontPath) => {
  const fontName = getFontNameFromFile(fontPath);
  return fontPlan.fontFamilyByName.get(fontName) || fontName;
}));
htmlTargets.forEach((file) => {
  console.log(`字体静态页面: ${path.relative(outputDir, file)}`);
});
runtimeConfig.pages.forEach((pageUrl) => {
  const parsed = new URL(pageUrl);
  console.log(`字体运行时页面: ${parsed.pathname}${parsed.search}`);
});
const runtimeCharactersByFamily = runtimeConfig.pages.length === 0
  ? {}
  : runtimeRunner({ ...runtimeConfig, fontFamilies: Array.from(fontFamilies) });

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
moveRemoteFontFiles(remoteFilesToMove, backupDir);
```

Only after this block copy original local TTFs, write manifests, execute `pyftsubset`, and replace subset files.

- [ ] **Step 6: Merge runtime data into manifest writing**

Add `runtimeCharactersByFamily = {}` to `writeFontCharacterFiles()` parameters. Replace its direct static result with:

```js
const staticCharactersByFamily = collectFontCharacters({
  htmlContents,
  cssFiles,
  fontFamilies
});
const charactersByFamily = mergeFontCharacterMaps(
  fontFamilies,
  staticCharactersByFamily,
  runtimeCharactersByFamily
);
```

Pass `runtimeCharactersByFamily` from `subsetFonts()`. For each font, compute `staticCount`, `totalCount`, and `runtimeAdded = totalCount - staticCount`, then replace the existing manifest log with:

```js
console.log(
  `字体字符清单: ${fontName}.txt（静态 ${staticCount}，` +
  `运行时新增 ${runtimeAdded}，合计 ${totalCount}）`
);
```

Preserve existing filename mapping, empty manifests, backups, remote-font handling, and TTF/WOFF/WOFF2 replacement.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
node tests/font-subsetter.test.js
node tests/font-runtime-integration.test.js
```

Expected: both PASS; the forced runtime failure leaves original local and remote font files untouched.

```bash
git add lib/font-subsetter.js tests/font-runtime-integration.test.js
git commit -m "feat: merge static and runtime font characters"
```

### Task 6: Dependency, CLI, initializer, and suite wiring

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `bin/mikit.js:143-158`
- Modify: `lib/project-initializer.js:27-57`
- Modify: `tests/font-cli.test.js`
- Modify: `tests/project-init.test.js`

- [ ] **Step 1: Install the browser driver without bundled browser downloads**

Run: `npm install playwright-core@1.48.2 --save`

Expected: exit 0; `package.json` contains `"playwright-core": "^1.48.2"`; the lock contains `node_modules/playwright-core`; no browser download runs because the package is `playwright-core`.

- [ ] **Step 2: Write failing CLI error-format and initializer tests**

In `tests/font-cli.test.js`, make a temporary package with invalid `mikit.font.pages`, run `mikit font`, and assert:

```js
assert.equal(result.status, 1);
assert.match(result.stderr, /^\[mikit font\] /m);
assert.doesNotMatch(result.stderr, /\n\s+at /);
```

Unlink only its `package.json` and remove the known empty fixture directory.

Extend the expected `packageJson.mikit` in `tests/project-init.test.js`:

```js
font: {
  pages: [],
  wait: 1000,
  timeout: 15000
}
```

- [ ] **Step 3: Run and verify RED**

Run:

```bash
node tests/font-cli.test.js
node tests/project-init.test.js
```

Expected: CLI test FAILS because standalone `font` is not wrapped by `runWorkflowCommand`; initializer test FAILS because `mikit.font` is absent.

- [ ] **Step 4: Wrap font failures and add initializer defaults**

Change `bin/mikit.js`:

```js
.action((options) => {
  runWorkflowCommand('font', () => {
    const { subsetFonts } = require('../lib/font-subsetter');
    subsetFonts({
      projectDir: process.cwd(),
      output: options.output,
      fontPage: options.fontPage,
      fontManifest: options.fontManifest
    });
  });
});
```

Add this sibling section to `createInitialPackageJson()` without changing existing scripts/config:

```js
font: {
  pages: [],
  wait: 1000,
  timeout: 15000
}
```

- [ ] **Step 5: Add all deterministic tests to `npm test`**

Use this explicit order:

```json
"test": "node tests/font-subsetter.test.js && node tests/font-runtime-config.test.js && node tests/font-runtime-collector.test.js && node tests/font-runtime-runner.test.js && node tests/font-runtime-integration.test.js && node tests/font-cli.test.js && node tests/ssi-root.test.js && node tests/build-workflow.test.js && node tests/build-workflow-cli.test.js && node tests/project-init.test.js && node tests/png-optimizer.test.js && node tests/png-build-cli.test.js"
```

Do not add the real-browser smoke test to `npm test`.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
node tests/font-cli.test.js
node tests/project-init.test.js
npm test
```

Expected: all focused and existing repository tests PASS.

```bash
git add package.json package-lock.json bin/mikit.js lib/project-initializer.js tests/font-cli.test.js tests/project-init.test.js
git commit -m "feat: expose runtime font configuration"
```

### Task 7: Real-browser smoke test and README

**Files:**
- Create: `tests/font-runtime-smoke.js`
- Modify: `README.md`

- [ ] **Step 1: Create an opt-in real-browser smoke test**

Create `tests/font-runtime-smoke.js` with `node:http`. Bind to `127.0.0.1` on an ephemeral port. Serve an HTML page with an `@font-face`-named `Display` style, `#app`, one `display:none` node containing `隐藏字符`, and a script that reads `o` and inserts either `300元京东E卡` or `溯月至臻圣器匣[绑]`.

Call the real collector:

```js
const result = await collectRuntimeFontCharacters({
  pages: [
    `http://127.0.0.1:${port}/index.shtml?o=1`,
    `http://127.0.0.1:${port}/index.shtml?o=2`
  ],
  waitFor: '#app',
  wait: 0,
  timeout: 5000,
  browserExecutable: null,
  fontFamilies: ['Display']
});
assert.equal(
  result.Display,
  '300元京东E卡隐藏字符溯月至臻圣器匣[绑]'
);
console.log('font runtime smoke passed');
```

Always close the HTTP server in `finally`. Do not create or recursively remove fixture directories.

- [ ] **Step 2: Run the real browser smoke**

Run: `node tests/font-runtime-smoke.js`

Expected when Chrome or Edge is installed: exit 0 and print `font runtime smoke passed`.

If no supported Chrome or Edge executable is found, report the exact `未找到可用的 Chrome 或 Edge 浏览器` result during final verification; do not claim this smoke passed.

- [ ] **Step 3: Document the exact configuration and boundaries**

Update the README font section with:

```json
{
  "mikit": {
    "font": {
      "pages": [
        "http://wb.y.bindyy.cn:8080/index.shtml?o=1",
        "http://wb.y.bindyy.cn:8080/index.shtml?o=2"
      ],
      "waitFor": "#app",
      "wait": 1000,
      "timeout": 15000,
      "browserExecutable": ""
    }
  }
}
```

Document each behavior explicitly:

- static parsing keeps literal `v-if`, `v-else-if`, `v-else`, `v-show`, hidden panel, unopened popup, and `<template>` text;
- runtime scanning visits only `pages` entries; it never guesses `o` values, clicks buttons, or starts `mikit start`;
- production manifests are determined only by configured URLs, built HTML/CSS, and rendered DOM state; AI does not guess or add characters;
- JavaScript source strings and generated ::before/::after content are not collected;
- runtime collection includes hidden DOM text and excludes `script/style/noscript`;
- `/index.shtml?...` maps to `dist/index.html`, another `.shtml` maps to the corresponding `.html`, and trailing `/` maps to `index.html`;
- pages use `domcontentloaded`, optional attached `waitFor`, then `wait`; `networkidle` is not used;
- empty/missing `pages` remains static-only and does not require a browser;
- browser resolution order is explicit `browserExecutable`, `MIKIT_BROWSER_EXECUTABLE`, then supported Chrome/Edge locations;
- any configured-page failure aborts before font files are moved, backed up, or replaced;
- `playwright-core` does not download a browser; Python fonttools and Brotli remain required for subsetting.

- [ ] **Step 4: Run syntax and whitespace checks**

Run:

```bash
node --check lib/font-runtime-config.js
node --check lib/font-runtime-collector.js
node --check lib/font-runtime-runner.js
node --check lib/font-runtime-worker.js
node --check lib/font-subsetter.js
node --check bin/mikit.js
node --check lib/project-initializer.js
node --check tests/font-runtime-config.test.js
node --check tests/font-runtime-collector.test.js
node --check tests/font-runtime-runner.test.js
node --check tests/font-runtime-integration.test.js
node --check tests/font-runtime-smoke.js
git diff --check
```

Expected: every syntax check exits 0; `git diff --check` prints nothing.

- [ ] **Step 5: Commit docs and smoke coverage**

```bash
git add README.md tests/font-runtime-smoke.js
git commit -m "docs: explain hybrid runtime font scanning"
```

### Task 8: Final regression and approved-URL verification

**Files:**
- Modify only the exact file identified by a failing check.

- [ ] **Step 1: Run every focused font test**

Run:

```bash
node tests/font-subsetter.test.js
node tests/font-runtime-config.test.js
node tests/font-runtime-collector.test.js
node tests/font-runtime-runner.test.js
node tests/font-runtime-integration.test.js
node tests/font-cli.test.js
```

Expected: all tests PASS.

- [ ] **Step 2: Run the complete repository suite**

Run: `npm test`

Expected: all font, SSI, workflow, initializer, and PNG tests PASS.

- [ ] **Step 3: Run real browser verification and inspect the approved URLs**

Run: `node tests/font-runtime-smoke.js`

Expected with Chrome or Edge installed: `font runtime smoke passed`.

Then search configuration/examples:

```bash
rg -n "wb\.y\.bindyy\.cn:8080/index\.shtml\?o=|pages|page\.goto|click\(" README.md tests lib
```

Expected: these two explicit production examples appear in order:

```text
http://wb.y.bindyy.cn:8080/index.shtml?o=1
http://wb.y.bindyy.cn:8080/index.shtml?o=2
```

Expected: runtime navigation iterates the configured `pages`; there is no URL-state guessing loop and no automated button-click exploration.

- [ ] **Step 4: Verify final diff and repository state**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~7..HEAD
git diff HEAD~7..HEAD -- lib bin tests README.md package.json package-lock.json
```

Expected: no whitespace errors; changes are restricted to planned font runtime files, tests, README, CLI, initializer, and package metadata. No consumer-project `dist`, generated font output, server, replace, pack, PNG, or SVN behavior changed.

- [ ] **Step 5: Commit only if final verification required a correction**

Stage each corrected file by its exact path, for example:

```bash
git add lib/font-runtime-collector.js tests/font-runtime-collector.test.js
git commit -m "fix: complete runtime font verification"
```

If no correction was required, do not create an empty commit.
