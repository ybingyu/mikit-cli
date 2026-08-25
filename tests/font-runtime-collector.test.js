'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  addRecords,
  collectRuntimeFontCharacters,
  extractTextRecords,
  getBrowserExecutableCandidates,
  launchInstalledBrowser,
  normalizeRuntimeFontFamily,
  resolveBrowserExecutable,
} = require('../lib/font-runtime-collector');

const PAGE_ONE = 'http://wb.y.bindyy.cn:8080/index.shtml?o=1';
const PAGE_TWO = 'http://wb.y.bindyy.cn:8080/index.shtml?o=2';

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  delete globalThis[name];
}

function createFamilyState(families) {
  const canonicalFamilies = new Map();
  const charactersByFamily = new Map();

  for (const family of families) {
    canonicalFamilies.set(family.toLowerCase(), family);
    charactersByFamily.set(family, new Set());
  }

  return { canonicalFamilies, charactersByFamily };
}

function createBrowserHarness({
  recordsByUrl = {},
  gotoByUrl = {},
  selectorErrorByUrl = {},
  evaluationByUrl = {},
} = {}) {
  const calls = {
    close: 0,
    evaluate: [],
    goto: [],
    launch: [],
    newPage: 0,
    selectors: [],
    delays: [],
  };
  let currentUrl = null;
  let consoleListener = null;
  let markConsoleListenerReady;
  const consoleListenerReady = new Promise((resolve) => {
    markConsoleListenerReady = resolve;
  });

  const page = {
    on(eventName, listener) {
      assert.equal(eventName, 'console');
      consoleListener = listener;
      markConsoleListenerReady();
    },
    async goto(pageUrl, options) {
      currentUrl = pageUrl;
      calls.goto.push({ pageUrl, options });
      const configured = gotoByUrl[pageUrl];
      if (configured instanceof Error) {
        throw configured;
      }
      if (typeof configured === 'function') {
        return configured(pageUrl, options);
      }
      return configured === undefined
        ? { ok: () => true, status: () => 200 }
        : configured;
    },
    async waitForSelector(selector, options) {
      calls.selectors.push({ selector, options, pageUrl: currentUrl });
      if (selectorErrorByUrl[currentUrl]) {
        throw selectorErrorByUrl[currentUrl];
      }
    },
    async waitForTimeout(delay) {
      calls.delays.push(delay);
    },
    async evaluate(fn) {
      calls.evaluate.push({ fn, pageUrl: currentUrl });
      if (evaluationByUrl[currentUrl] instanceof Error) {
        throw evaluationByUrl[currentUrl];
      }
      if (Object.prototype.hasOwnProperty.call(evaluationByUrl, currentUrl)) {
        return evaluationByUrl[currentUrl];
      }
      return recordsByUrl[currentUrl] || [];
    },
  };

  const browser = {
    async newPage() {
      calls.newPage += 1;
      return page;
    },
    async close() {
      calls.close += 1;
    },
  };

  const chromium = {
    async launch(options) {
      calls.launch.push(options);
      return browser;
    },
  };

  return {
    calls,
    chromium,
    async waitForConsoleListener() {
      await consoleListenerReady;
    },
    emitConsoleError(message) {
      assert.ok(consoleListener, 'console listener should be registered');
      consoleListener({
        type: () => 'error',
        text: () => message,
      });
    },
  };
}

test('normalizes the first runtime font family only', () => {
  assert.equal(normalizeRuntimeFontFamily('  "Display Serif", Arial  '), 'Display Serif');
  assert.equal(normalizeRuntimeFontFamily(" 'Quoted' , sans-serif"), 'Quoted');
  assert.equal(normalizeRuntimeFontFamily('Plain'), 'Plain');
});

test('extracts normal and hidden text while excluding non-content elements', () => {
  const descriptors = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    NodeFilter: Object.getOwnPropertyDescriptor(globalThis, 'NodeFilter'),
    getComputedStyle: Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle'),
  };
  const body = {};
  const normalParent = {
    fontFamily: '"Display", Arial',
    closest: () => null,
  };
  const hiddenParent = {
    display: 'none',
    fontFamily: 'Hidden',
    closest: () => null,
  };
  const excludedParent = (tagName) => ({
    fontFamily: 'Excluded',
    closest: (selector) => {
      assert.equal(selector, 'script,style,noscript');
      return { tagName };
    },
  });
  const nodes = [
    { nodeValue: '  普通\n\t文字  ', parentElement: normalParent },
    { nodeValue: ' 隐藏   状态 ', parentElement: hiddenParent },
    { nodeValue: '脚本', parentElement: excludedParent('SCRIPT') },
    { nodeValue: '样式', parentElement: excludedParent('STYLE') },
    { nodeValue: '降级', parentElement: excludedParent('NOSCRIPT') },
    { nodeValue: '   ', parentElement: normalParent },
    { nodeValue: '无父节点', parentElement: null },
  ];
  const walkerArguments = [];

  try {
    globalThis.NodeFilter = { SHOW_TEXT: 4 };
    globalThis.document = {
      body,
      createTreeWalker(root, whatToShow) {
        walkerArguments.push({ root, whatToShow });
        let index = 0;
        return {
          nextNode() {
            const node = nodes[index];
            index += 1;
            return node || null;
          },
        };
      },
    };
    globalThis.getComputedStyle = (parent) => ({
      fontFamily: parent.fontFamily,
    });

    assert.deepEqual(extractTextRecords(), [
      { text: '普通 文字', fontFamily: '"Display", Arial' },
      { text: '隐藏 状态', fontFamily: 'Hidden' },
    ]);
    assert.deepEqual(walkerArguments, [{ root: body, whatToShow: 4 }]);
  } finally {
    restoreGlobal('document', descriptors.document);
    restoreGlobal('NodeFilter', descriptors.NodeFilter);
    restoreGlobal('getComputedStyle', descriptors.getComputedStyle);
  }

  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, 'document'),
    descriptors.document,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, 'NodeFilter'),
    descriptors.NodeFilter,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle'),
    descriptors.getComputedStyle,
  );
});

test('adds Unicode code points only for planned font families', () => {
  const { canonicalFamilies, charactersByFamily } = createFamilyState([
    'Display',
    'Unused',
  ]);

  addRecords(
    [
      { text: '甲😀乙甲', fontFamily: '"display", Arial' },
      { text: '不进入', fontFamily: 'Remote' },
      { text: '乙丙😀', fontFamily: 'DISPLAY' },
    ],
    canonicalFamilies,
    charactersByFamily,
    PAGE_ONE,
  );

  assert.equal(Array.from(charactersByFamily.get('Display')).join(''), '甲😀乙丙');
  assert.equal(Array.from(charactersByFamily.get('Unused')).join(''), '');
});

test('rejects malformed runtime evaluation records with URL and item index', () => {
  const { canonicalFamilies, charactersByFamily } = createFamilyState(['Display']);

  assert.throws(
    () => addRecords({}, canonicalFamilies, charactersByFamily, PAGE_ONE),
    (error) => error.message.includes(PAGE_ONE) && error.message.includes('必须是数组'),
  );

  const malformedRecords = [
    [{ text: 123, fontFamily: 'Display' }, '第 1 项'],
    [{ text: '文字', fontFamily: null }, '第 1 项'],
    [null, '第 1 项'],
  ];

  for (const [record, indexText] of malformedRecords) {
    assert.throws(
      () => addRecords([record], canonicalFamilies, charactersByFamily, PAGE_TWO),
      (error) => error.message.includes(PAGE_TWO) && error.message.includes(indexText),
    );
  }
});

test('returns installed browser candidates in Windows order', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
  };

  assert.deepEqual(getBrowserExecutableCandidates('win32', env), [
    path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.win32.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.win32.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.win32.join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.win32.join(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
});

test('returns Chrome then Edge candidates on macOS and Linux', () => {
  assert.deepEqual(getBrowserExecutableCandidates('darwin', {}), [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]);
  assert.deepEqual(getBrowserExecutableCandidates('linux', {}), [
    'google-chrome',
    'google-chrome-stable',
    'microsoft-edge',
    'microsoft-edge-stable',
  ]);
});

test('prefers explicit browser executable and launches with exact options', async () => {
  const explicitPath = path.resolve('explicit-browser.exe');
  const launchCalls = [];
  const expectedBrowser = {};
  const chromium = {
    async launch(options) {
      launchCalls.push(options);
      return expectedBrowser;
    },
  };

  const resolved = resolveBrowserExecutable(
    { browserExecutable: explicitPath },
    {
      env: { MIKIT_BROWSER_EXECUTABLE: 'environment-browser.exe' },
      existsSync: () => true,
      candidates: ['candidate-browser.exe'],
      platform: 'win32',
    },
  );
  const browser = await launchInstalledBrowser(chromium, resolved);

  assert.equal(resolved, explicitPath);
  assert.equal(browser, expectedBrowser);
  assert.deepEqual(launchCalls, [
    { headless: true, executablePath: explicitPath },
  ]);
});

test('uses the MIKIT_BROWSER_EXECUTABLE environment path before candidates', () => {
  const environmentValue = 'relative/environment-browser.exe';
  const environmentPath = path.resolve(environmentValue);
  const checked = [];

  const resolved = resolveBrowserExecutable(
    {},
    {
      env: { MIKIT_BROWSER_EXECUTABLE: environmentValue },
      existsSync(candidate) {
        checked.push(candidate);
        return candidate === environmentPath;
      },
      candidates: ['candidate-browser.exe'],
      platform: 'linux',
    },
  );

  assert.equal(resolved, environmentPath);
  assert.deepEqual(checked, [environmentPath]);
});

test('reports a missing MIKIT_BROWSER_EXECUTABLE path clearly', () => {
  assert.throws(
    () => resolveBrowserExecutable(
      {},
      {
        env: { MIKIT_BROWSER_EXECUTABLE: 'missing-browser.exe' },
        existsSync: () => false,
        candidates: ['candidate-browser.exe'],
        platform: 'linux',
      },
    ),
    /MIKIT_BROWSER_EXECUTABLE 浏览器文件不存在/,
  );
});

test('selects the first existing installed browser candidate', () => {
  const checked = [];
  const resolved = resolveBrowserExecutable(
    {},
    {
      env: {},
      candidates: ['first-browser', 'second-browser', 'third-browser'],
      existsSync(candidate) {
        checked.push(candidate);
        return candidate === 'second-browser';
      },
      platform: 'linux',
    },
  );

  assert.equal(resolved, 'second-browser');
  assert.deepEqual(checked, ['first-browser', 'second-browser']);
});

test('reports when no installed Chrome or Edge browser is available', () => {
  assert.throws(
    () => resolveBrowserExecutable(
      {},
      {
        env: {},
        candidates: ['missing-one', 'missing-two'],
        existsSync: () => false,
        platform: 'linux',
      },
    ),
    /未找到可用的 Chrome 或 Edge 浏览器/,
  );
});

test('collects two explicit URLs in order and warns without failing on console errors', async () => {
  const harness = createBrowserHarness({
    recordsByUrl: {
      [PAGE_ONE]: [
        { text: '300元京东E卡', fontFamily: 'Display' },
        { text: '00京', fontFamily: 'Display' },
        { text: '远程字体', fontFamily: 'Remote' },
      ],
      [PAGE_TWO]: [
        { text: '溯月至臻圣器匣[绑]', fontFamily: '"display", Arial' },
        { text: '溯器', fontFamily: 'DISPLAY' },
      ],
    },
  });
  const warnings = [];

  const resultPromise = collectRuntimeFontCharacters(
    {
      pages: [PAGE_ONE, PAGE_TWO],
      waitFor: '#app',
      wait: 1000,
      timeout: 15000,
      browserExecutable: 'C:\\Browser\\chrome.exe',
      fontFamilies: ['Display', 'Unused'],
    },
    {
      chromium: harness.chromium,
      onWarning: (message) => warnings.push(message),
    },
  );
  await harness.waitForConsoleListener();
  harness.emitConsoleError('Vue render warning');
  const result = await resultPromise;

  assert.deepEqual(result, {
    Display: '300元京东E卡溯月至臻圣器匣[绑]',
    Unused: '',
  });
  assert.deepEqual(harness.calls.launch, [
    { headless: true, executablePath: 'C:\\Browser\\chrome.exe' },
  ]);
  assert.equal(harness.calls.newPage, 1);
  assert.deepEqual(harness.calls.goto, [
    {
      pageUrl: PAGE_ONE,
      options: { waitUntil: 'domcontentloaded', timeout: 15000 },
    },
    {
      pageUrl: PAGE_TWO,
      options: { waitUntil: 'domcontentloaded', timeout: 15000 },
    },
  ]);
  assert.deepEqual(harness.calls.selectors, [
    {
      selector: '#app',
      options: { state: 'attached', timeout: 15000 },
      pageUrl: PAGE_ONE,
    },
    {
      selector: '#app',
      options: { state: 'attached', timeout: 15000 },
      pageUrl: PAGE_TWO,
    },
  ]);
  assert.deepEqual(harness.calls.delays, [1000, 1000]);
  assert.equal(harness.calls.evaluate.length, 2);
  assert.equal(harness.calls.evaluate[0].fn, extractTextRecords);
  assert.equal(harness.calls.evaluate[1].fn, extractTextRecords);
  assert.deepEqual(warnings, [
    '[mikit font] 页面控制台错误：Vue render warning',
  ]);
  assert.equal(harness.calls.close, 1);
});

test('wraps page failures with the exact URL and always closes the browser', async (t) => {
  const failureCases = [
    {
      name: 'HTTP 500',
      url: PAGE_ONE,
      harness: createBrowserHarness({
        gotoByUrl: {
          [PAGE_ONE]: { ok: () => false, status: () => 500 },
        },
      }),
      message: 'HTTP 500',
    },
    {
      name: 'navigation rejection',
      url: PAGE_ONE,
      harness: createBrowserHarness({
        gotoByUrl: { [PAGE_ONE]: new Error('navigation rejected') },
      }),
      message: 'navigation rejected',
    },
    {
      name: 'selector timeout',
      url: PAGE_ONE,
      harness: createBrowserHarness({
        selectorErrorByUrl: { [PAGE_ONE]: new Error('selector timeout') },
      }),
      message: 'selector timeout',
    },
    {
      name: 'malformed evaluation data',
      url: PAGE_ONE,
      harness: createBrowserHarness({
        evaluationByUrl: { [PAGE_ONE]: [{ text: 123, fontFamily: 'Display' }] },
      }),
      message: '第 1 项',
    },
  ];

  for (const failureCase of failureCases) {
    await t.test(failureCase.name, async () => {
      await assert.rejects(
        collectRuntimeFontCharacters(
          {
            pages: [failureCase.url],
            waitFor: '#app',
            wait: 0,
            timeout: 1234,
            browserExecutable: 'browser.exe',
            fontFamilies: ['Display'],
          },
          { chromium: failureCase.harness.chromium, onWarning: () => {} },
        ),
        (error) => {
          assert.equal(error.message.includes(failureCase.url), true);
          assert.equal(error.message.includes(failureCase.message), true);
          assert.equal(
            error.message.startsWith(`运行时字体页面提取失败（${failureCase.url}）：`),
            true,
          );
          return true;
        },
      );
      assert.equal(failureCase.harness.calls.close, 1);
    });
  }
});

test('rejects the whole collection when the second URL fails without returning partial output', async () => {
  const harness = createBrowserHarness({
    recordsByUrl: {
      [PAGE_ONE]: [{ text: '第一页', fontFamily: 'Display' }],
    },
    gotoByUrl: {
      [PAGE_TWO]: new Error('second page failed'),
    },
  });
  let resolvedValue = null;

  await assert.rejects(
    collectRuntimeFontCharacters(
      {
        pages: [PAGE_ONE, PAGE_TWO],
        waitFor: null,
        wait: 0,
        timeout: 15000,
        browserExecutable: 'browser.exe',
        fontFamilies: ['Display'],
      },
      { chromium: harness.chromium, onWarning: () => {} },
    ).then((value) => {
      resolvedValue = value;
      return value;
    }),
    (error) => error.message.includes(PAGE_TWO),
  );

  assert.equal(resolvedValue, null);
  assert.equal(harness.calls.close, 1);
  assert.deepEqual(
    harness.calls.goto.map((call) => call.pageUrl),
    [PAGE_ONE, PAGE_TWO],
  );
});
