'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function mkdir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function write(filePath, content) {
  mkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function createFixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-workflow-'));
  const svnCssDirA = path.join(projectDir, 'svn-view-a', 'css');
  const svnCssDirB = path.join(projectDir, 'svn-view-b', 'css');
  mkdir(svnCssDirA);
  mkdir(svnCssDirB);

  const packageJson = {
    name: 'workflow-fixture',
    version: '1.0.0',
    mikit: {
      replace: {
        root: 'dist',
        include: ['**/*.css'],
        rules: [
          { disabled: true, from: '../img/', to: 'https://disabled.example/' },
          { from: '../img/origin/', to: 'https://origin.example/' },
          { from: '../img/', to: 'https://image.example/' },
          {
            from: '../../font/',
            to: {
              default: 'https://font-dev.example/',
              production: 'https://font-prod.example/'
            }
          },
          { from: '?#font-spider', to: '' },
          { from: 'dev-host.example', to: 'prod-host.example', env: 'production' }
        ]
      },
      pack: {
        source: 'wwwroot',
        dist: 'dist',
        output: 'packed',
        pageDirs: ['.', 'include'],
        assetDirs: ['js', 'css'],
        excludePages: ['*font*.shtml']
      },
      syncSvn: {
        source: 'dist/css',
        targets: [svnCssDirA, svnCssDirB],
        files: ['*']
      }
    }
  };

  write(path.join(projectDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  write(
    path.join(projectDir, 'dist', 'css', 'style.css'),
    '.a{background:url(../img/origin/a.png)}.b{background:url(../img/b.png)}' +
      '@font-face{src:url(../../font/a.woff2?#font-spider)}' +
      '.host{src:url(https://dev-host.example/a.png)}'
  );
  write(path.join(projectDir, 'dist', 'css', 'phone.css'), '.phone{color:red}');
  write(path.join(projectDir, 'dist', 'css', 'notes.txt'), 'do not sync');
  write(path.join(projectDir, 'dist', 'js', 'app.js'), 'console.log("app");');
  write(
    path.join(projectDir, 'wwwroot', 'index.shtml'),
    '<main><!--#include virtual="include/_rule.shtml"--></main>'
  );
  write(path.join(projectDir, 'wwwroot', 'font-preview.shtml'), 'excluded');
  write(path.join(projectDir, 'wwwroot', 'include', '_rule.shtml'), '<section>rule</section>');
  write(path.join(svnCssDirA, 'phone.css'), '.phone{color:red}');
  write(path.join(projectDir, 'packed', 'stale.txt'), 'old package');
  write(path.join(projectDir, 'packed', 'old', 'legacy.css'), '.legacy{}');

  return { projectDir, svnCssDirA, svnCssDirB };
}

function cleanupFixture(projectDir) {
  const files = [
    'package.json',
    'dist/css/style.css',
    'dist/css/phone.css',
    'dist/css/notes.txt',
    'dist/js/app.js',
    'wwwroot/index.shtml',
    'wwwroot/font-preview.shtml',
    'wwwroot/include/_rule.shtml',
    'packed/index.shtml',
    'packed/stale.txt',
    'packed/old/legacy.css',
    'packed/include/_rule.shtml',
    'packed/css/style.css',
    'packed/css/phone.css',
    'packed/css/notes.txt',
    'packed/js/app.js',
    'svn-view-a/css/style.css',
    'svn-view-a/css/phone.css',
    'svn-view-b/css/style.css',
    'svn-view-b/css/phone.css'
  ];

  files.forEach(relativePath => {
    const filePath = path.join(projectDir, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  const dirs = [
    'packed/old',
    'packed/include',
    'packed/css',
    'packed/js',
    'packed',
    'wwwroot/include',
    'wwwroot',
    'dist/css',
    'dist/js',
    'dist',
    'svn-view-a/css',
    'svn-view-a',
    'svn-view-b/css',
    'svn-view-b',
    '.'
  ];

  dirs.forEach(relativePath => {
    const dirPath = path.resolve(projectDir, relativePath);
    if (fs.existsSync(dirPath)) fs.rmdirSync(dirPath);
  });
}

const { projectDir, svnCssDirA, svnCssDirB } = createFixture();

try {
  const { replaceCssAssets } = require(path.join(repoRoot, 'lib', 'css-replacer'));
  const { packGoTemplates } = require(path.join(repoRoot, 'lib', 'go-packer'));
  const { syncCssToSvn } = require(path.join(repoRoot, 'lib', 'svn-css-sync'));

  const replaceSummary = replaceCssAssets({ projectDir, env: 'production' });
  assert.equal(replaceSummary.files, 2);
  const replacedCss = fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8');
  assert.match(replacedCss, /https:\/\/origin\.example\/a\.png/);
  assert.match(replacedCss, /https:\/\/image\.example\/b\.png/);
  assert.doesNotMatch(replacedCss, /disabled\.example/);
  assert.match(replacedCss, /https:\/\/font-prod\.example\/a\.woff2/);
  assert.doesNotMatch(replacedCss, /font-spider/);
  assert.match(replacedCss, /prod-host\.example/);
  assert.equal(fs.readFileSync(path.join(projectDir, 'dist', 'css', 'notes.txt'), 'utf8'), 'do not sync');

  const packSummary = packGoTemplates({ projectDir });
  assert.equal(packSummary.pages, 2);
  assert.equal(packSummary.assets, 4);
  assert.equal(packSummary.cleaned, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'packed', 'stale.txt')), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'packed', 'old')), false);
  assert.equal(
    fs.readFileSync(path.join(projectDir, 'packed', 'index.shtml'), 'utf8'),
    '<main><?#template "_rule.shtml" .?></main>'
  );
  assert.equal(
    fs.readFileSync(path.join(projectDir, 'packed', 'include', '_rule.shtml'), 'utf8'),
    '<section>rule</section>'
  );
  assert.equal(fs.existsSync(path.join(projectDir, 'packed', 'font-preview.shtml')), false);
  assert.equal(
    fs.readFileSync(path.join(projectDir, 'packed', 'js', 'app.js'), 'utf8'),
    'console.log("app");'
  );

  const packagePath = path.join(projectDir, 'package.json');
  const safePackageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  safePackageJson.mikit.pack.output = '.';
  fs.writeFileSync(packagePath, JSON.stringify(safePackageJson, null, 2), 'utf8');
  assert.throws(
    () => packGoTemplates({ projectDir }),
    /mikit\.pack\.output 不能是项目根目录/
  );
  safePackageJson.mikit.pack.output = 'packed';
  fs.writeFileSync(packagePath, JSON.stringify(safePackageJson, null, 2), 'utf8');

  const syncSummary = syncCssToSvn({ projectDir });
  assert.equal(syncSummary.copied, 3);
  assert.equal(syncSummary.skipped, 1);
  assert.deepEqual(syncSummary.targets, [path.resolve(svnCssDirA), path.resolve(svnCssDirB)]);
  assert.deepEqual(syncSummary.files, ['phone.css', 'style.css']);
  assert.equal(
    fs.readFileSync(path.join(svnCssDirA, 'style.css'), 'utf8'),
    fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8')
  );
  assert.equal(
    fs.readFileSync(path.join(svnCssDirB, 'style.css'), 'utf8'),
    fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8')
  );
  assert.equal(fs.existsSync(path.join(svnCssDirA, 'notes.txt')), false);
  assert.equal(fs.existsSync(path.join(svnCssDirB, 'notes.txt')), false);
} finally {
  cleanupFixture(projectDir);
}
