'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { packGoTemplates } = require('../lib/go-packer');
const cli = path.resolve(__dirname, '../bin/mikit.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-pack-safety-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const dir of ['wwwroot', 'dist/js', 'packed', 'shared']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'packed/keep.txt'), 'keep');
  fs.writeFileSync(path.join(root, 'shared/partial.shtml'), '<!--#include virtual="include/header.shtml" -->');
  fs.writeFileSync(path.join(root, 'wwwroot/index.shtml'), 'page');
  fs.writeFileSync(path.join(root, 'dist/js/app.js'), 'script');
  return root;
}

for (const field of ['pageDirs', 'assetDirs']) {
  for (const type of ['parent', 'absolute', 'junction']) {
    test('pack rejects ' + field + ' ' + type + ' before touching files', t => {
      const root = fixture(t);
      let unsafe = '../shared';
      if (type === 'absolute') unsafe = path.join(root, 'shared');
      if (type === 'junction') {
        unsafe = 'linked';
        fs.symlinkSync(path.join(root, 'shared'), path.join(root, field === 'pageDirs' ? 'wwwroot' : 'dist', unsafe), process.platform === 'win32' ? 'junction' : 'dir');
      }
      const config = { pageDirs: ['.'], assetDirs: ['js'], [field]: [field === 'pageDirs' ? '.' : 'js', unsafe] };
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ mikit: { pack: config } }));
      assert.throws(() => packGoTemplates({ projectDir: root }), new RegExp('mikit.pack.' + field));
      const result = spawnSync(process.execPath, [cli, 'pack'], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /\[mikit pack\]/);
      assert.equal(fs.readFileSync(path.join(root, 'packed/keep.txt'), 'utf8'), 'keep');
      assert.equal(fs.readFileSync(path.join(root, 'shared/partial.shtml'), 'utf8'), '<!--#include virtual="include/header.shtml" -->');
      assert.equal(fs.existsSync(path.join(root, 'packed/index.shtml')), false);
    });
  }
}

test('valid nested pack directories stay inside output', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'wwwroot/include'));
  fs.writeFileSync(path.join(root, 'wwwroot/include/header.shtml'), 'header');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ mikit: { pack: { pageDirs: ['.', 'include'], assetDirs: ['js'] } } }));
  const result = packGoTemplates({ projectDir: root });
  assert.equal(result.pages, 2);
  assert.equal(fs.readFileSync(path.join(root, 'packed/include/header.shtml'), 'utf8'), 'header');
});

for (const destination of ['wwwroot', 'dist', 'external']) {
  test('pack rejects an output parent junction to ' + destination + ' before clearing', t => {
    const root = fixture(t);
    const project = destination === 'external' ? path.join(root, 'consumer') : root;
    if (project !== root) {
      fs.mkdirSync(project);
      for (const dir of ['wwwroot', 'dist', 'packed']) fs.renameSync(path.join(root, dir), path.join(project, dir));
    }
    const target = destination === 'external' ? path.join(root, 'shared') : path.join(root, destination);
    fs.symlinkSync(target, path.join(project, 'output-link'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ mikit: { pack: {
      output: 'output-link/result', pageDirs: ['.'], assetDirs: ['js']
    } } }));
    assert.throws(() => packGoTemplates({ projectDir: project }), /mikit.pack.output/);
    assert.equal(fs.readFileSync(path.join(project, 'packed/keep.txt'), 'utf8'), 'keep');
    assert.equal(fs.readFileSync(path.join(root, 'shared/partial.shtml'), 'utf8'), '<!--#include virtual="include/header.shtml" -->');
  });
}

test('pack follows online SSI whitespace rules in pages and include files', t => {
  const root = fixture(t);
  const inactiveIncludes = [
    '<!-- #include virtual="include/_hidden.shtml" -->',
    '<!-- #include virtual="/include/_hidden.shtml" -->',
    '<!-- # include virtual="include/_hidden.shtml" -->',
    '<!-- # include virtual="/include/_hidden.shtml" -->',
    '<!--\t#include virtual="include/_hidden.shtml" -->',
    '<!--\n#include virtual="include/_hidden.shtml" -->',
    '<!--include virtual="include/_hidden.shtml" -->'
  ];
  const activeIncludes = [
    ['<!--#include virtual="include/_visible.shtml" -->', '_visible.shtml'],
    ['<!--# include virtual="include/_visible.shtml" -->', '_visible.shtml'],
    ['<!--#\tinclude virtual="include/_visible.shtml" -->', '_visible.shtml'],
    ['<!--#\ninclude virtual="include/_visible.shtml" -->', '_visible.shtml'],
    ['<!--#include virtual="_other.shtml"-->', '_other.shtml'],
    ['<!--#include virtual="/include/_root.shtml" -->', '/include/_root.shtml'],
    ['<!--# include virtual="/include/_root.shtml" -->', '/include/_root.shtml']
  ];
  const content = [...activeIncludes.map(([include]) => include), ...inactiveIncludes].join('\n');
  const expected = [
    ...activeIncludes.map(([, name]) => '<?#template "' + name + '" .?>'),
    ...inactiveIncludes
  ].join('\n');
  fs.mkdirSync(path.join(root, 'wwwroot/include'));
  fs.writeFileSync(path.join(root, 'wwwroot/index.shtml'), content);
  fs.writeFileSync(path.join(root, 'wwwroot/include/_nested.shtml'), content);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ mikit: { pack: {
    pageDirs: ['.', 'include'], assetDirs: ['js']
  } } }));

  function assertPackedContent() {
    for (const relativePath of ['index.shtml', 'include/_nested.shtml']) {
      assert.equal(fs.readFileSync(path.join(root, 'packed', relativePath), 'utf8'), expected);
    }
  }

  packGoTemplates({ projectDir: root });
  assertPackedContent();
  const result = spawnSync(process.execPath, [cli, 'pack'], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[mikit pack\] 完成：.*页面 2 个，资源 1 个/);
  assertPackedContent();
});
