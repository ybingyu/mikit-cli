'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FONT_RUNTIME_CONFIG = Object.freeze({
  pages: Object.freeze([]),
  waitFor: null,
  wait: 1000,
  timeout: 15000,
  browserExecutable: null,
  asciiBaseline: 'none',
  dynamicTextPolicy: 'warn',
  globalExtraText: '',
  familyExtraText: Object.freeze({}),
  familyOptions: Object.freeze({}),
});

function createDefaultConfig() {
  return {
    pages: [],
    waitFor: DEFAULT_FONT_RUNTIME_CONFIG.waitFor,
    wait: DEFAULT_FONT_RUNTIME_CONFIG.wait,
    timeout: DEFAULT_FONT_RUNTIME_CONFIG.timeout,
    browserExecutable: DEFAULT_FONT_RUNTIME_CONFIG.browserExecutable,
    asciiBaseline: DEFAULT_FONT_RUNTIME_CONFIG.asciiBaseline,
    dynamicTextPolicy: DEFAULT_FONT_RUNTIME_CONFIG.dynamicTextPolicy,
    globalExtraText: '',
    familyExtraText: {},
    familyOptions: {},
  };
}

function validateFontRuntimeConfig(config, {
  projectDir = process.cwd(),
  existsSync = fs.existsSync,
} = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('mikit.font 必须是对象');
  }

  const pages = config.pages === undefined ? [] : config.pages;
  if (!Array.isArray(pages)) {
    throw new Error('pages 必须是数组');
  }

  const normalizedPages = pages.map((page, index) => {
    if (typeof page !== 'string') {
      throw new Error(`pages[${index}] 必须是 HTTP 或 HTTPS URL`);
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(page);
    } catch (error) {
      throw new Error(`pages[${index}] 必须是 HTTP 或 HTTPS URL`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`pages[${index}] 必须是 HTTP 或 HTTPS URL`);
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error(`pages[${index}] 不能包含用户名或密码`);
    }

    return parsedUrl.href;
  });

  let waitFor = config.waitFor;
  if (waitFor === undefined || waitFor === null) {
    waitFor = null;
  } else if (typeof waitFor !== 'string' || waitFor.trim() === '') {
    throw new Error('waitFor 必须是非空 CSS 选择器');
  } else {
    waitFor = waitFor.trim();
  }

  const wait = config.wait === undefined
    ? DEFAULT_FONT_RUNTIME_CONFIG.wait
    : config.wait;
  if (!Number.isInteger(wait) || wait < 0) {
    throw new Error('wait 必须是非负整数');
  }

  const timeout = config.timeout === undefined
    ? DEFAULT_FONT_RUNTIME_CONFIG.timeout
    : config.timeout;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error('timeout 必须是正整数');
  }

  let browserExecutable = config.browserExecutable;
  if (browserExecutable === undefined || browserExecutable === '') {
    browserExecutable = null;
  } else {
    if (typeof browserExecutable !== 'string') {
      throw new Error('browserExecutable 必须是路径字符串');
    }
    browserExecutable = path.resolve(projectDir, browserExecutable);
    if (!existsSync(browserExecutable)) {
      throw new Error(`浏览器文件不存在: ${browserExecutable}`);
    }
  }

  const asciiBaseline = config.asciiBaseline ?? 'none';
  if (!['none', 'common', 'full'].includes(asciiBaseline)) {
    throw new Error('asciiBaseline 必须是 none、common 或 full');
  }
  const dynamicTextPolicy = config.dynamicTextPolicy ?? 'warn';
  if (!['warn', 'error'].includes(dynamicTextPolicy)) {
    throw new Error('dynamicTextPolicy 必须是 warn 或 error');
  }
  const globalExtraText = config.globalExtraText ?? '';
  if (typeof globalExtraText !== 'string') {
    throw new Error('globalExtraText 必须是字符串');
  }
  const familyExtraText = config.familyExtraText ?? {};
  const familyOptions = config.familyOptions ?? {};
  for (const [label, value] of [['familyExtraText', familyExtraText], ['familyOptions', familyOptions]]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} 必须是对象`);
    }
  }
  for (const [family, text] of Object.entries(familyExtraText)) {
    if (typeof text !== 'string') throw new Error(`familyExtraText.${family} 必须是字符串`);
  }
  for (const [family, option] of Object.entries(familyOptions)) {
    if (!option || typeof option !== 'object' || Array.isArray(option) ||
        (option.asciiBaseline !== undefined && !['none', 'common', 'full'].includes(option.asciiBaseline))) {
      throw new Error(`familyOptions.${family}.asciiBaseline 必须是 none、common 或 full`);
    }
  }

  return {
    pages: normalizedPages,
    waitFor,
    wait,
    timeout,
    browserExecutable,
    asciiBaseline,
    dynamicTextPolicy,
    globalExtraText,
    familyExtraText,
    familyOptions,
  };
}

function loadFontRuntimeConfig(projectDir = process.cwd()) {
  const resolvedProjectDir = path.resolve(projectDir);
  const packagePath = path.join(resolvedProjectDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return createDefaultConfig();
  }

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取项目 package.json: ${error.message}`);
  }

  if (
    !packageJson ||
    !packageJson.mikit ||
    packageJson.mikit.font === undefined
  ) {
    return createDefaultConfig();
  }

  return validateFontRuntimeConfig(packageJson.mikit.font, {
    projectDir: resolvedProjectDir,
    existsSync: fs.existsSync,
  });
}

module.exports = {
  DEFAULT_FONT_RUNTIME_CONFIG,
  loadFontRuntimeConfig,
  validateFontRuntimeConfig,
};
