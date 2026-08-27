const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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
  assert.doesNotMatch(result.stdout, /--font-page <page>[\s\S]*?default: \"font\.html\"/);
  assert.match(
    result.stdout,
    /--font-manifest <directory>[\s\S]*?\(default: "font"\)/,
  );
});

test("font command exposes standalone subsetting options", () => {
  const result = runHelp("font");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Subset local fonts from built HTML and CSS/);
  assert.match(result.stdout, /--output <output>/);
  assert.match(result.stdout, /--font-page <page>/);
  assert.doesNotMatch(result.stdout, /--font-page <page>[\s\S]*?default: \"font\.html\"/);
  assert.match(
    result.stdout,
    /--font-manifest <directory>[\s\S]*?\(default: "font"\)/,
  );
});

test("font command formats runtime configuration errors without a stack", (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mikit-font-cli-"));
  const packagePath = path.join(fixtureDir, "package.json");
  fs.writeFileSync(
    packagePath,
    JSON.stringify({ mikit: { font: { pages: "invalid" } } }),
    "utf8",
  );
  t.after(() => {
    if (fs.existsSync(packagePath)) {
      fs.unlinkSync(packagePath);
    }
    if (fs.existsSync(fixtureDir)) {
      fs.rmdirSync(fixtureDir);
    }
  });

  const result = spawnSync(process.execPath, [cliPath, "font"], {
    cwd: fixtureDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[mikit font\] /m);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});
