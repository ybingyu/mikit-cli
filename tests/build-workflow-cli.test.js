'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Transformer } = require('@napi-rs/image');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'mikit.js');

function mkdir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function write(filePath, content) {
  mkdir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function run(command, cwd, env = {}) {
  return spawnSync(process.execPath, [cliPath, command], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

function cleanup(rootDir, files, dirs) {
  files.forEach(relativePath => {
    const filePath = path.join(rootDir, relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  dirs.forEach(relativePath => {
    const dirPath = path.resolve(rootDir, relativePath);
    if (fs.existsSync(dirPath)) fs.rmdirSync(dirPath);
  });
}

function testHelpAndMissingConfig() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-workflow-cli-missing-'));
  const packagePath = path.join(fixtureDir, 'package.json');

  try {
    write(packagePath, JSON.stringify({ name: 'missing-config', version: '1.0.0' }));

    const help = spawnSync(process.execPath, [cliPath, '--help'], {
      cwd: fixtureDir,
      encoding: 'utf8'
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /\breplace\b/);
    assert.match(help.stdout, /\bpack\b/);
    assert.match(help.stdout, /\bsync-svn\b/);
    assert.match(help.stdout, /\bpng\b/);
    assert.doesNotMatch(help.stdout, /dry-run/);

    for (const command of ['replace', 'pack', 'sync-svn', 'png']) {
      const result = run(command, fixtureDir);
      assert.equal(result.status, 1, `${command} should exit 1. stdout=${result.stdout} stderr=${result.stderr}`);
      assert.match(result.stderr, new RegExp(`\\[mikit ${command}\\]`));
      assert.match(result.stderr, /package\.json 缺少 mikit 配置/);
      assert.doesNotMatch(result.stderr, /\n\s+at\s/);
    }
  } finally {
    cleanup(fixtureDir, ['package.json'], ['.']);
  }
}

function testSuccessfulCommands() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-workflow-cli-success-'));
  const svnCssDir = path.join(fixtureDir, 'svn', 'css');
  mkdir(svnCssDir);

  const packageJson = {
    name: 'workflow-cli-success',
    version: '1.0.0',
    mikit: {
      replace: {
        root: 'dist',
        include: ['**/*.css'],
        rules: [
          { from: '../img/', to: 'https://image.example/' },
          {
            from: '../font/',
            to: {
              default: 'https://font-dev.example/',
              production: 'https://font-prod.example/'
            }
          }
        ]
      },
      pack: {
        source: 'wwwroot',
        dist: 'dist',
        output: 'packed',
        pageDirs: ['.', 'include'],
        assetDirs: ['css', 'js'],
        excludePages: []
      },
      syncSvn: {
        source: 'dist/css',
        target: svnCssDir,
        files: ['*']
      }
    }
  };

  write(path.join(fixtureDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  write(path.join(fixtureDir, 'dist', 'css', 'style.css'), 'a{background:url(../img/a.png);src:url(../font/a.woff2)}');
  write(path.join(fixtureDir, 'dist', 'css', 'ignore.txt'), 'not css');
  write(path.join(fixtureDir, 'dist', 'js', 'app.js'), 'console.log("app")');
  write(path.join(fixtureDir, 'wwwroot', 'index.shtml'), '<!--#include virtual="include/_rule.shtml"-->');
  write(path.join(fixtureDir, 'wwwroot', 'include', '_rule.shtml'), '<p>rule</p>');

  try {
    const replace = run('replace', fixtureDir, { NODE_ENV: 'production' });
    assert.equal(replace.status, 0, replace.stderr);
    assert.match(replace.stdout, /更新 1 个/);
    assert.match(
      fs.readFileSync(path.join(fixtureDir, 'dist', 'css', 'style.css'), 'utf8'),
      /https:\/\/font-prod\.example\//
    );

    const pack = run('pack', fixtureDir);
    assert.equal(pack.status, 0, pack.stderr);
    assert.match(pack.stdout, /页面 2 个，资源 3 个/);
    assert.equal(
      fs.readFileSync(path.join(fixtureDir, 'packed', 'index.shtml'), 'utf8'),
      '<?#template "_rule.shtml" .?>'
    );

    const sync = run('sync-svn', fixtureDir);
    assert.equal(sync.status, 0, sync.stderr);
    assert.match(sync.stdout, /更新 1 个，跳过 0 个/);
    assert.equal(fs.existsSync(path.join(svnCssDir, 'style.css')), true);
    assert.equal(fs.existsSync(path.join(svnCssDir, 'ignore.txt')), false);
  } finally {
    cleanup(
      fixtureDir,
      [
        'package.json',
        'dist/css/style.css',
        'dist/css/ignore.txt',
        'dist/js/app.js',
        'wwwroot/index.shtml',
        'wwwroot/include/_rule.shtml',
        'packed/index.shtml',
        'packed/include/_rule.shtml',
        'packed/css/style.css',
        'packed/css/ignore.txt',
        'packed/js/app.js',
        'svn/css/style.css'
      ],
      [
        'packed/include',
        'packed/css',
        'packed/js',
        'packed',
        'wwwroot/include',
        'wwwroot',
        'dist/css',
        'dist/js',
        'dist',
        'svn/css',
        'svn',
        '.'
      ]
    );
  }
}

function testSuccessfulPngCommand() {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-png-cli-success-'));
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = (offset / 4) & 0xff;
    pixels[offset + 1] = 64;
    pixels[offset + 2] = 128;
    pixels[offset + 3] = 255;
  }

  try {
    write(path.join(fixtureDir, 'package.json'), JSON.stringify({
      name: 'png-cli-success',
      version: '1.0.0',
      mikit: {
        png: {
          root: 'dist',
          level: 'balanced',
          exclude: []
        }
      }
    }, null, 2));
    mkdir(path.join(fixtureDir, 'dist', 'img'));
    fs.writeFileSync(
      path.join(fixtureDir, 'dist', 'img', 'a.png'),
      Transformer.fromRgbaPixels(pixels, 32, 32).pngSync()
    );

    const result = run('png', fixtureDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[mikit png\] 完成：扫描 1 个/);
    assert.equal(fs.existsSync(path.join(fixtureDir, 'dist', 'img', 'a.png')), true);
  } finally {
    cleanup(
      fixtureDir,
      ['package.json', 'dist/img/a.png'],
      ['dist/img', 'dist', '.']
    );
  }
}

testHelpAndMissingConfig();
testSuccessfulCommands();
testSuccessfulPngCommand();
