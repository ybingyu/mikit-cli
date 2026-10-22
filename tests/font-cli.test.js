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


test('font command reports a missing original input with its path and no stack', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'font'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'site.css'),
    '@font-face{font-family:Boat;src:url(font/boat.woff)}');
  const result = spawnSync(process.execPath, [cliPath, 'font'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[mikit font\] .*boat\.ttf/m);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('font CLI publishes a Markdown report and announces its full path after successful validation', (t) => {
  const source = 'C:\\Windows\\Fonts\\arial.ttf';
  if (!fs.existsSync(source)) { t.skip('Arial fixture unavailable'); return; }
  const availability = spawnSync('pyftsubset', ['--help'], { windowsHide: true });
  if (availability.error) { t.skip('pyftsubset unavailable'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-md-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fontDir = path.join(root, 'dist', 'font');
  fs.mkdirSync(fontDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'wwwroot', 'font'), { recursive: true });
  fs.copyFileSync(source, path.join(root, 'wwwroot', 'font', 'title.ttf'));
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span class="title">ABC12</span>');
  fs.writeFileSync(path.join(root, 'dist', 'site.css'), '@font-face{font-family:Title;src:url(font/title.ttf)}.title{font-family:Title}');
  const result = spawnSync(process.execPath, [cliPath, 'font'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const report = path.join(root, 'font', 'font-report.md');
  assert.match(result.stdout, /^\[mikit font\] 请查看字体报告：/m);
  assert.ok(result.stdout.includes(report));
  assert.match(fs.readFileSync(report, 'utf8'), /字体文件验证通过/);
  assert.equal(fs.existsSync(path.join(root, 'font', 'font-report.json')), false);
});


test('font CLI rebuilds repeated subsets from original TTF including previously removed fonts', (t) => {
  const original = 'C:\\Windows\\Fonts\\arial.ttf';
  if (!fs.existsSync(original)) { t.skip('Arial fixture unavailable'); return; }
  if (spawnSync('pyftsubset', ['--help'], { windowsHide: true }).error) {
    t.skip('pyftsubset unavailable'); return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-repeat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'wwwroot', 'font', 'nested');
  const outputDir = path.join(root, 'custom-dist');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'font'), { recursive: true });
  for (const name of ['title', 'unused']) fs.copyFileSync(original, path.join(sourceDir, name + '.ttf'));
  const originalBytes = fs.readFileSync(original);
  fs.writeFileSync(path.join(outputDir, 'site.css'),
    '@font-face{font-family:Title;src:url(font/nested/title.woff2)}' +
    '@font-face{font-family:Unused;src:url(font/nested/unused.woff2)}');
  const run = () => spawnSync(process.execPath, [cliPath, 'font', '--output', 'custom-dist'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(outputDir, 'index.html'), '<span style="font-family:Title">AB</span>');
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(fs.readdirSync(path.join(outputDir, 'font', 'nested')), ['title.woff2']);
  fs.writeFileSync(path.join(outputDir, 'index.html'),
    '<span style="font-family:Title">ABC</span><span style="font-family:Unused">XYZ</span>');
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stderr, /源字体缺少/);
  assert.deepEqual(fs.readdirSync(path.join(outputDir, 'font', 'nested')).sort(), ['title.woff2', 'unused.woff2']);
  const report = fs.readFileSync(path.join(root, 'font', 'font-report.md'), 'utf8');
  assert.match(report, /字体文件验证通过/);
  assert.match(report, /\| Title \| 3 \|/);
  assert.match(report, /\| Unused \| 3 \|/);
  assert.doesNotMatch(report, /减少比例|原同格式体积|无法比较/);
  assert.equal(fs.readFileSync(path.join(root, 'font', 'nested', 'title.txt'), 'utf8'), 'ABC');
  for (const name of ['title', 'unused']) {
    assert.deepEqual(fs.readFileSync(path.join(sourceDir, name + '.ttf')), originalBytes);
  }
});

test('font CLI refuses to reuse dist subsets when the original font is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-font-no-original-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fontDir = path.join(root, 'dist', 'font');
  fs.mkdirSync(fontDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'font'));
  fs.writeFileSync(path.join(fontDir, 'title.ttf'), 'existing subset');
  fs.writeFileSync(path.join(root, 'font', 'title.txt'), 'old manifest');
  fs.writeFileSync(path.join(root, 'dist', 'site.css'), '@font-face{font-family:Title;src:url(font/title.ttf)}');
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<span style="font-family:Title">AB</span>');
  const result = spawnSync(process.execPath, [cliPath, 'font'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[mikit font\]/m);
  assert.ok(result.stderr.includes(path.join(root, 'wwwroot', 'font', 'title.ttf')), result.stderr);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.equal(fs.readFileSync(path.join(fontDir, 'title.ttf'), 'utf8'), 'existing subset');
  assert.equal(fs.readFileSync(path.join(root, 'font', 'title.txt'), 'utf8'), 'old manifest');
});
