const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "bin", "mikit.js");

function runHelp(command) {
  return spawnSync(process.execPath, [cliPath, command, "--help"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });
}

test("build exposes optional font subsetting flags", () => {
  const result = runHelp("build");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--minfont/);
  assert.match(result.stdout, /--font-page <page>/);
  assert.match(result.stdout, /--font-manifest <directory>/);
});

test("font command exposes standalone subsetting options", () => {
  const result = runHelp("font");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Subset local fonts from built HTML and CSS/);
  assert.match(result.stdout, /--output <output>/);
  assert.match(result.stdout, /--font-page <page>/);
  assert.match(result.stdout, /--font-manifest <directory>/);
});
