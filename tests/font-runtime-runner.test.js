'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const {
  runRuntimeFontCollectorSync,
  validateRuntimeCharacterMap,
} = require('../lib/font-runtime-runner');

const workerPath = path.resolve(
  __dirname,
  '..',
  'lib',
  'font-runtime-worker.js',
);

test('validates and returns a runtime character map unchanged', () => {
  const map = { Display: '动态文字' };

  assert.equal(validateRuntimeCharacterMap(map), map);
});

test('rejects invalid runtime character map containers', () => {
  for (const value of [null, [], {}, 'text']) {
    assert.throws(
      () => validateRuntimeCharacterMap(value),
      /运行时字体提取返回格式错误：结果必须是非空对象/,
    );
  }
});

test('rejects empty family names and non-string characters', () => {
  assert.throws(
    () => validateRuntimeCharacterMap({ '   ': '文字' }),
    /运行时字体提取返回格式错误：字体名称不能为空/,
  );
  assert.throws(
    () => validateRuntimeCharacterMap({ Display: ['动态文字'] }),
    /运行时字体提取返回格式错误：字体“Display”的字符必须是字符串/,
  );
});

test('runs the worker synchronously with exact process arguments', () => {
  const config = {
    pages: ['http://wb.y.bindyy.cn:8080/index.shtml?o=1'],
    fontFamilies: ['Display'],
  };
  const calls = [];
  let forwardedStderr = '';
  const originalWrite = process.stderr.write;

  process.stderr.write = (chunk) => {
    forwardedStderr += chunk;
    return true;
  };

  try {
    const result = runRuntimeFontCollectorSync(config, {
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return {
          status: 0,
          stdout: JSON.stringify({ Display: '动态文字' }),
          stderr: '[mikit font] 页面警告\n',
        };
      },
    });

    assert.deepEqual(result, { Display: '动态文字' });
    assert.deepEqual(calls, [
      {
        command: process.execPath,
        args: [workerPath],
        options: {
          input: JSON.stringify(config),
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        },
      },
    ]);
    assert.equal(forwardedStderr, '[mikit font] 页面警告\n');
  } finally {
    process.stderr.write = originalWrite;
  }
});

test('wraps spawn errors', () => {
  assert.throws(
    () =>
      runRuntimeFontCollectorSync({}, {
        spawn() {
          return { error: new Error('spawn EPERM') };
        },
      }),
    /运行时字体提取失败：spawn EPERM/,
  );
});

test('reports non-zero worker exit status', () => {
  assert.throws(
    () =>
      runRuntimeFontCollectorSync({}, {
        spawn() {
          return { status: 7, stdout: '', stderr: '' };
        },
      }),
    /运行时字体提取失败：子进程退出码 7。/,
  );
});

test('wraps invalid worker JSON as a format error', () => {
  assert.throws(
    () =>
      runRuntimeFontCollectorSync({}, {
        spawn() {
          return { status: 0, stdout: '{', stderr: '' };
        },
      }),
    /运行时字体提取返回格式错误：无法解析 JSON/,
  );
});

test('validates maps returned by the worker', () => {
  const invalidOutputs = [
    ['[]', /结果必须是非空对象/],
    ['{}', /结果必须是非空对象/],
    ['{"":"文字"}', /字体名称不能为空/],
    ['{"Display":12}', /字体“Display”的字符必须是字符串/],
  ];

  for (const [stdout, expectedError] of invalidOutputs) {
    assert.throws(
      () =>
        runRuntimeFontCollectorSync({}, {
          spawn() {
            return { status: 0, stdout, stderr: '' };
          },
        }),
      expectedError,
    );
  }
});

test('worker reports invalid stdin JSON without stdout or a stack', () => {
  const result = spawnSync(process.execPath, [workerPath], {
    input: '{',
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.status, 1, result.error && result.error.message);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^\[mikit font\] /);
  assert.doesNotMatch(result.stderr, /\n\s+at\s|font-runtime-worker\.js:\d+/);
});
