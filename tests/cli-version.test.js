'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { version } = require('../package.json');

for (const flag of ['--version', '-V']) {
  test(`CLI ${flag} reports the published package version`, () => {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/mikit.js'), flag], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), version);
    assert.equal(result.stderr, '');
  });
}
