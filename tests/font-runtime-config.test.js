'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_FONT_RUNTIME_CONFIG,
  loadFontRuntimeConfig,
  validateFontRuntimeConfig,
} = require('../lib/font-runtime-config');

function createFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-runtime-config-'));
}

function writePackageJson(dir, value) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(value),
    'utf8',
  );
}

function cleanup(dir, names) {
  for (const name of names) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  fs.rmdirSync(dir);
}

test('exports the frozen static default configuration', () => {
  assert.deepEqual(DEFAULT_FONT_RUNTIME_CONFIG, {
    pages: [],
    waitFor: null,
    wait: 1000,
    timeout: 15000,
    browserExecutable: null,
  });
  assert.equal(Object.isFrozen(DEFAULT_FONT_RUNTIME_CONFIG), true);
  assert.equal(Object.isFrozen(DEFAULT_FONT_RUNTIME_CONFIG.pages), true);
});

test('loads static defaults when package.json or mikit.font is absent', () => {
  const missingPackageDir = createFixture();
  const missingFontDir = createFixture();

  try {
    writePackageJson(missingFontDir, { mikit: { other: true } });

    assert.deepEqual(
      loadFontRuntimeConfig(missingPackageDir),
      DEFAULT_FONT_RUNTIME_CONFIG,
    );
    assert.deepEqual(
      loadFontRuntimeConfig(missingFontDir),
      DEFAULT_FONT_RUNTIME_CONFIG,
    );
  } finally {
    cleanup(missingPackageDir, []);
    cleanup(missingFontDir, ['package.json']);
  }
});

test('loads from process.cwd when projectDir is omitted', () => {
  const dir = createFixture();
  const originalCwd = process.cwd();

  try {
    writePackageJson(dir, { mikit: { font: { wait: 250 } } });
    process.chdir(dir);

    assert.equal(loadFontRuntimeConfig().wait, 250);
  } finally {
    process.chdir(originalCwd);
    cleanup(dir, ['package.json']);
  }
});

test('treats a null package.json root as missing mikit.font', () => {
  const dir = createFixture();

  try {
    writePackageJson(dir, null);

    assert.deepEqual(
      loadFontRuntimeConfig(dir),
      DEFAULT_FONT_RUNTIME_CONFIG,
    );
  } finally {
    cleanup(dir, ['package.json']);
  }
});

test('loads and normalizes configured runtime font pages', () => {
  const dir = createFixture();
  const browserPath = path.join(dir, 'browser.exe');

  try {
    fs.writeFileSync(browserPath, '', 'utf8');
    writePackageJson(dir, {
      mikit: {
        font: {
          pages: [
            'http://wb.y.bindyy.cn:8080/index.shtml?o=1',
            'http://wb.y.bindyy.cn:8080/index.shtml?o=2',
          ],
          waitFor: '#app',
          wait: 250,
          timeout: 5000,
          browserExecutable: 'browser.exe',
          ignored: 'unknown',
        },
      },
    });

    assert.deepEqual(loadFontRuntimeConfig(dir), {
      pages: [
        'http://wb.y.bindyy.cn:8080/index.shtml?o=1',
        'http://wb.y.bindyy.cn:8080/index.shtml?o=2',
      ],
      waitFor: '#app',
      wait: 250,
      timeout: 5000,
      browserExecutable: browserPath,
    });
  } finally {
    cleanup(dir, ['package.json', 'browser.exe']);
  }
});

test('uses process.cwd and fs.existsSync when options are omitted', () => {
  const result = validateFontRuntimeConfig({
    browserExecutable: 'package.json',
  });

  assert.equal(
    result.browserExecutable,
    path.resolve(process.cwd(), 'package.json'),
  );
});

test('uses fs.existsSync when only projectDir is provided', () => {
  const dir = createFixture();

  try {
    assert.throws(
      () =>
        validateFontRuntimeConfig(
          { browserExecutable: 'missing.exe' },
          { projectDir: dir },
        ),
      /浏览器文件不存在/,
    );
  } finally {
    cleanup(dir, []);
  }
});

test('rejects invalid runtime font configuration', () => {
  const dir = createFixture();
  const invalidCases = [
    {
      config: null,
      message: 'mikit.font 必须是对象',
    },
    {
      config: { pages: 'http://example.com/' },
      message: 'pages 必须是数组',
    },
    {
      config: { pages: [123] },
      message: 'pages[0] 必须是 HTTP 或 HTTPS URL',
    },
    {
      config: { pages: ['ftp://example.com/file'] },
      message: 'pages[0] 必须是 HTTP 或 HTTPS URL',
    },
    {
      config: { pages: ['http://user:pass@example.com/'] },
      message: '不能包含用户名或密码',
    },
    {
      config: { waitFor: '   ' },
      message: 'waitFor 必须是非空 CSS 选择器',
    },
    {
      config: { wait: -1 },
      message: 'wait 必须是非负整数',
    },
    {
      config: { wait: 1.5 },
      message: 'wait 必须是非负整数',
    },
    {
      config: { timeout: 0 },
      message: 'timeout 必须是正整数',
    },
    {
      config: { timeout: 1.5 },
      message: 'timeout 必须是正整数',
    },
    {
      config: { browserExecutable: 123 },
      message: 'browserExecutable 必须是路径字符串',
    },
    {
      config: { browserExecutable: 'missing-browser.exe' },
      message: '浏览器文件不存在',
    },
  ];

  try {
    for (const invalidCase of invalidCases) {
      assert.throws(
        () =>
          validateFontRuntimeConfig(invalidCase.config, {
            projectDir: dir,
            existsSync: fs.existsSync,
          }),
        (error) => {
          assert.equal(error.message.includes(invalidCase.message), true);
          return true;
        },
      );
    }
  } finally {
    cleanup(dir, []);
  }
});

test('validates a present non-object mikit.font value', () => {
  const dir = createFixture();

  try {
    writePackageJson(dir, { mikit: { font: null } });

    assert.throws(
      () => loadFontRuntimeConfig(dir),
      /mikit\.font 必须是对象/,
    );
  } finally {
    cleanup(dir, ['package.json']);
  }
});

test('wraps malformed package.json errors', () => {
  const dir = createFixture();

  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{bad json', 'utf8');

    assert.throws(
      () => loadFontRuntimeConfig(dir),
      /无法读取项目 package\.json/,
    );
  } finally {
    cleanup(dir, ['package.json']);
  }
});
