'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORMAT_ERROR_PREFIX = '运行时字体提取返回格式错误：';

function runtimeFormatError(message) {
  return new Error(`${FORMAT_ERROR_PREFIX}${message}`);
}

function validateRuntimeCharacterMap(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    throw runtimeFormatError('结果必须是非空对象。');
  }

  for (const [family, characters] of Object.entries(value)) {
    if (!family.trim()) {
      throw runtimeFormatError('字体名称不能为空。');
    }
    if (typeof characters !== 'string') {
      throw runtimeFormatError(`字体“${family}”的字符必须是字符串。`);
    }
  }

  return value;
}

function runRuntimeFontCollectorSync(config, dependencies = {}) {
  const spawn = dependencies.spawn || spawnSync;
  const workerPath = dependencies.workerPath || path.join(
    __dirname,
    'font-runtime-worker.js',
  );
  const result = spawn(process.execPath, [workerPath], {
    input: JSON.stringify(config),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw new Error(`运行时字体提取失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `运行时字体提取失败：子进程退出码 ${result.status}。`,
    );
  }

  let characterMap;
  try {
    characterMap = JSON.parse(result.stdout);
  } catch (error) {
    throw runtimeFormatError(`无法解析 JSON：${error.message}`);
  }

  return validateRuntimeCharacterMap(characterMap);
}

module.exports = {
  runRuntimeFontCollectorSync,
  validateRuntimeCharacterMap,
};
