'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeRuntimeFontFamily(value) {
  return value
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function extractTextRecords() {
  const records = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();

  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest('script,style,noscript')) {
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (text) {
        records.push({
          text,
          fontFamily: getComputedStyle(parent).fontFamily,
        });
      }
    }
    node = walker.nextNode();
  }

  return records;
}

function addRecords(
  records,
  canonicalFamilies,
  charactersByFamily,
  pageUrl,
  outputByFamily,
) {
  if (!Array.isArray(records)) {
    throw new Error(`运行时字体页面数据必须是数组（${pageUrl}）`);
  }

  records.forEach((record, index) => {
    if (
      !record ||
      typeof record !== 'object' ||
      typeof record.text !== 'string' ||
      typeof record.fontFamily !== 'string'
    ) {
      throw new Error(
        `运行时字体页面数据无效（${pageUrl}，第 ${index + 1} 项）：` +
          'text 和 fontFamily 必须是字符串',
      );
    }

    const normalizedFamily = normalizeRuntimeFontFamily(record.fontFamily);
    const canonicalFamily = canonicalFamilies.get(
      normalizedFamily.toLowerCase(),
    );
    if (!canonicalFamily) {
      return;
    }

    const characters = charactersByFamily.get(canonicalFamily);
    const charactersSeenBeforeRecord = new Set(characters);
    for (const character of Array.from(record.text)) {
      if (
        outputByFamily &&
        !charactersSeenBeforeRecord.has(character)
      ) {
        outputByFamily.get(canonicalFamily).push(character);
      }
      characters.add(character);
    }
  });
}

function getBrowserExecutableCandidates(
  platform = process.platform,
  env = process.env,
) {
  if (platform === 'win32') {
    const chromeSegments = ['Google', 'Chrome', 'Application', 'chrome.exe'];
    const edgeSegments = ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
    const localAppData = env.LOCALAPPDATA;
    const programFiles = env.PROGRAMFILES;
    const programFilesX86 = env['PROGRAMFILES(X86)'];

    return [
      localAppData && path.win32.join(localAppData, ...chromeSegments),
      programFiles && path.win32.join(programFiles, ...chromeSegments),
      programFilesX86 && path.win32.join(programFilesX86, ...chromeSegments),
      localAppData && path.win32.join(localAppData, ...edgeSegments),
      programFiles && path.win32.join(programFiles, ...edgeSegments),
      programFilesX86 && path.win32.join(programFilesX86, ...edgeSegments),
    ].filter(Boolean);
  }

  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }

  if (platform === 'linux') {
    return [
      'google-chrome',
      'google-chrome-stable',
      'microsoft-edge',
      'microsoft-edge-stable',
    ];
  }

  return [];
}

function resolveBrowserExecutable(config = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  const existsSync = dependencies.existsSync || fs.existsSync;
  const platform = dependencies.platform || process.platform;

  if (config.browserExecutable) {
    return config.browserExecutable;
  }

  if (env.MIKIT_BROWSER_EXECUTABLE) {
    const environmentPath = path.resolve(env.MIKIT_BROWSER_EXECUTABLE);
    if (!existsSync(environmentPath)) {
      throw new Error(
        `MIKIT_BROWSER_EXECUTABLE 浏览器文件不存在: ${environmentPath}`,
      );
    }
    return environmentPath;
  }

  const candidates = dependencies.candidates ||
    getBrowserExecutableCandidates(platform, env);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('未找到可用的 Chrome 或 Edge 浏览器');
}

async function launchInstalledBrowser(chromium, executablePath) {
  return chromium.launch({
    headless: true,
    executablePath,
  });
}

async function collectRuntimeFontCharacters(config, dependencies = {}) {
  const canonicalFamilies = new Map();
  const charactersByFamily = new Map();
  const outputByFamily = new Map();
  const onWarning = dependencies.onWarning || console.warn;

  for (const family of config.fontFamilies) {
    canonicalFamilies.set(family.toLowerCase(), family);
    charactersByFamily.set(family, new Set());
    outputByFamily.set(family, []);
  }

  const chromium = dependencies.chromium || require('playwright-core').chromium;
  const executablePath = resolveBrowserExecutable(config, dependencies);
  let browser;

  try {
    browser = await launchInstalledBrowser(chromium, executablePath);
    const page = await browser.newPage();

    page.on('console', (message) => {
      if (message.type() === 'error') {
        onWarning(`[mikit font] 页面控制台错误：${message.text()}`);
      }
    });

    for (const pageUrl of config.pages) {
      try {
        const response = await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout,
        });
        if (response && !response.ok()) {
          throw new Error(`HTTP ${response.status()}`);
        }

        if (config.waitFor) {
          await page.waitForSelector(config.waitFor, {
            state: 'attached',
            timeout: config.timeout,
          });
        }
        if (config.wait > 0) {
          await page.waitForTimeout(config.wait);
        }

        const records = await page.evaluate(extractTextRecords);
        addRecords(
          records,
          canonicalFamilies,
          charactersByFamily,
          pageUrl,
          outputByFamily,
        );
      } catch (error) {
        throw new Error(
          `运行时字体页面提取失败（${pageUrl}）：${error.message}`,
        );
      }
    }

    const result = {};
    for (const [family, outputCharacters] of outputByFamily) {
      result[family] = outputCharacters.join('');
    }
    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  normalizeRuntimeFontFamily,
  extractTextRecords,
  addRecords,
  getBrowserExecutableCandidates,
  resolveBrowserExecutable,
  launchInstalledBrowser,
  collectRuntimeFontCharacters,
};
