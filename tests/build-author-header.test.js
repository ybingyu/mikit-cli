'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const { build } = require(path.join(repoRoot, 'lib', 'builder'));
const { readAliasConfig } = require(path.join(repoRoot, 'lib', 'projectMatcher'));

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withProject(callback) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-build-author-'));
  const originalCwd = process.cwd();
  const originalAliasConfig = process.env.MIKIT_ALIAS_CONFIG;

  try {
    process.chdir(projectDir);
    callback(projectDir);
  } finally {
    process.chdir(originalCwd);
    if (originalAliasConfig === undefined) {
      delete process.env.MIKIT_ALIAS_CONFIG;
    } else {
      process.env.MIKIT_ALIAS_CONFIG = originalAliasConfig;
    }
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

function extractHeader(content) {
  const match = content.match(/^\/\*[\s\S]*?\*\//);
  return match ? match[0] : '';
}

function testUsesProjectAuthorAndGlobalEditor() {
  withProject(projectDir => {
    const aliasPath = path.join(projectDir, 'mikit.alias.json');
    write(aliasPath, JSON.stringify({
      author: 'bindy(128080)',
      projects: {}
    }, null, 2));
    write(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'author-project',
      mikit: {
        author: 'alice(100001)'
      }
    }, null, 2));
    write(path.join(projectDir, 'wwwroot', 'css', 'style.css'), '.page { color: red; }\n');
    write(path.join(projectDir, 'wwwroot', 'js', 'app.js'), 'console.log("app");\n');
    write(path.join(projectDir, 'wwwroot', 'css', 'theme.scss'), '$color: blue;\n.theme { color: $color; }\n');
    process.env.MIKIT_ALIAS_CONFIG = aliasPath;

    build({ output: 'dist', minifyCss: true, minifyJs: true });

    const css = fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8');
    const js = fs.readFileSync(path.join(projectDir, 'dist', 'js', 'app.js'), 'utf8');
    const sassCss = fs.readFileSync(path.join(projectDir, 'dist', 'css', 'theme.css'), 'utf8');
    const header = extractHeader(css);

    assert.match(header, /^\/\*\n \* Author: alice\(100001\)\n \* Editor: bindy\(128080\)\n \* Compile Date: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n \*\/$/);
    assert.equal(extractHeader(js), header);
    assert.equal(extractHeader(sassCss), header);
    assert.match(css.slice(header.length), /^\s*\.page\{color:red\}$/);
    assert.match(js.slice(header.length).trim(), /^console\.log\(["']app["']\);?$/);
    assert.match(sassCss.slice(header.length), /^\s*\.theme\{color:blue\}$/);
  });
}

function testUsesOnlyProjectAuthorWhenGlobalConfigIsUnavailable() {
  const cases = [
    {
      name: 'environment variable missing',
      configure() {
        delete process.env.MIKIT_ALIAS_CONFIG;
      }
    },
    {
      name: 'file missing',
      configure(projectDir) {
        process.env.MIKIT_ALIAS_CONFIG = path.join(projectDir, 'missing.json');
      }
    },
    {
      name: 'JSON invalid',
      configure(projectDir) {
        const aliasPath = path.join(projectDir, 'invalid.json');
        write(aliasPath, '{ invalid json');
        process.env.MIKIT_ALIAS_CONFIG = aliasPath;
      }
    },
    {
      name: 'global author empty',
      configure(projectDir) {
        const aliasPath = path.join(projectDir, 'empty-author.json');
        write(aliasPath, JSON.stringify({ author: '   ', projects: {} }, null, 2));
        process.env.MIKIT_ALIAS_CONFIG = aliasPath;
      }
    }
  ];

  cases.forEach(testCase => {
    withProject(projectDir => {
      write(path.join(projectDir, 'package.json'), JSON.stringify({
        name: 'project-author-only',
        mikit: {
          author: 'alice(100001)'
        }
      }, null, 2));
      write(path.join(projectDir, 'wwwroot', 'css', 'style.css'), '.page { color: red; }\n');
      testCase.configure(projectDir);

      build({ output: 'dist' });

      const css = fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8');
      const header = extractHeader(css);
      assert.match(header, / \* Author: alice\(100001\)/, testCase.name);
      assert.doesNotMatch(header, / \* Editor:/, testCase.name);
      assert.match(
        header,
        / \* Compile Date: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
        testCase.name
      );
    });
  });
}

function testUsesGlobalAuthorWhenProjectAuthorIsMissingOrBlank() {
  const cases = [
    {
      name: 'missing project author',
      mikit: {}
    },
    {
      name: 'blank project author',
      mikit: {
        author: '   '
      }
    }
  ];

  cases.forEach(testCase => {
    withProject(projectDir => {
      write(path.join(projectDir, 'package.json'), JSON.stringify({
        name: 'global-author-fallback',
        mikit: testCase.mikit
      }, null, 2));
      write(path.join(projectDir, 'wwwroot', 'css', 'style.css'), '.page { color: red; }\n');
      write(path.join(projectDir, 'wwwroot', 'js', 'app.js'), 'console.log("app");\n');
      const aliasPath = path.join(projectDir, 'mikit.alias.json');
      write(aliasPath, JSON.stringify({ author: 'bindy(128080)', projects: {} }, null, 2));
      process.env.MIKIT_ALIAS_CONFIG = aliasPath;
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = message => warnings.push(String(message));

      try {
        build({ output: 'dist' });
      } finally {
        console.warn = originalWarn;
      }

      const css = fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8');
      const js = fs.readFileSync(path.join(projectDir, 'dist', 'js', 'app.js'), 'utf8');
      const header = extractHeader(css);

      assert.match(header, / \* Author: bindy\(128080\)/, testCase.name);
      assert.doesNotMatch(header, / \* Editor:/, testCase.name);
      assert.match(
        header,
        / \* Compile Date: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
        testCase.name
      );
      assert.equal(extractHeader(js), header, testCase.name);
      assert.deepEqual(warnings, [], testCase.name);
    });
  });
}
function testDiscoversAliasConfigFromParentDirectoryWithoutInheritedEnvironment() {
  withProject(workspaceDir => {
    const projectDir = path.join(workspaceDir, 'projects', 'site');
    write(path.join(workspaceDir, 'mikit.alias.json'), JSON.stringify({
      author: 'bindy(128080)',
      projects: {}
    }, null, 2));
    write(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'parent-alias-discovery',
      mikit: {}
    }, null, 2));
    write(path.join(projectDir, 'wwwroot', 'css', 'style.css'), '.page { color: red; }\n');
    delete process.env.MIKIT_ALIAS_CONFIG;
    process.chdir(projectDir);

    build({ output: 'dist' });

    const css = fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8');
    const header = extractHeader(css);
    assert.match(header, / \* Author: bindy\(128080\)/);
    assert.doesNotMatch(header, / \* Editor:/);
  });
}

function testRemovesLeadingBomBeforeAuthorHeader() {
  withProject(projectDir => {
    write(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'author-bom',
      mikit: {
        author: 'alice(100001)'
      }
    }, null, 2));
    write(path.join(projectDir, 'wwwroot', 'css', 'style.css'), '\uFEFF.page { color: red; }\n');
    write(path.join(projectDir, 'wwwroot', 'js', 'app.js'), '\uFEFFconsole.log("app");\n');
    delete process.env.MIKIT_ALIAS_CONFIG;

    build({ output: 'dist' });

    const css = fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8');
    const js = fs.readFileSync(path.join(projectDir, 'dist', 'js', 'app.js'), 'utf8');
    assert.equal(css.includes('\uFEFF'), false);
    assert.equal(js.includes('\uFEFF'), false);
    assert.match(css, /\*\/\n\.page/);
    assert.match(js, /\*\/\nconsole\.log/);
  });
}

function testSkipsHeadersAndWarnsOnceWithoutAnyAuthor() {
  withProject(projectDir => {
    write(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'missing-all-authors',
      mikit: {
        author: '   '
      }
    }, null, 2));
    write(path.join(projectDir, 'wwwroot', 'css', 'style.css'), '.page { color: red; }\n');
    write(path.join(projectDir, 'wwwroot', 'js', 'app.js'), 'console.log("app");\n');
    delete process.env.MIKIT_ALIAS_CONFIG;
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = message => warnings.push(String(message));

    try {
      build({ output: 'dist' });
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(
      fs.readFileSync(path.join(projectDir, 'dist', 'css', 'style.css'), 'utf8'),
      '.page { color: red; }\n'
    );
    assert.equal(
      fs.readFileSync(path.join(projectDir, 'dist', 'js', 'app.js'), 'utf8'),
      'console.log("app");\n'
    );
    assert.deepEqual(warnings, [
      '[mikit build] 提醒：项目作者和全局作者均未配置，已跳过 CSS、JS 作者注释。'
    ]);
  });
}
function testStartAliasLoaderUsesEnvironmentPath() {
  withProject(projectDir => {
    const aliasPath = path.join(projectDir, 'global', 'mikit.alias.json');
    write(aliasPath, JSON.stringify({
      author: 'bindy(128080)',
      projects: {}
    }, null, 2));
    process.env.MIKIT_ALIAS_CONFIG = aliasPath;

    const config = readAliasConfig(projectDir);

    assert.equal(config.path, aliasPath);
    assert.equal(config.author, 'bindy(128080)');
  });
}

testUsesProjectAuthorAndGlobalEditor();
testUsesOnlyProjectAuthorWhenGlobalConfigIsUnavailable();
testUsesGlobalAuthorWhenProjectAuthorIsMissingOrBlank();
testDiscoversAliasConfigFromParentDirectoryWithoutInheritedEnvironment();
testRemovesLeadingBomBeforeAuthorHeader();
testSkipsHeadersAndWarnsOnceWithoutAnyAuthor();
testStartAliasLoaderUsesEnvironmentPath();
