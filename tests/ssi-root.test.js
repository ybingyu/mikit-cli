const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: pathname }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    }).on('error', reject);
  });
}

function waitForServer(child, port) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for server. Output:\n${output}`));
    }, 10000);

    function onData(data) {
      output += data.toString();
      if (output.includes(`Server is running at http://localhost:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}. Output:\n${output}`));
    });
  });
}

function stopServer(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once('exit', resolve);
    child.kill();
  });
}

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-ssi-root-'));
  const wwwroot = path.join(fixtureRoot, 'wwwroot');
  const include = path.join(wwwroot, 'include');
  const pages = path.join(wwwroot, 'pages');
  const pageInclude = path.join(pages, 'include');

  fs.mkdirSync(include, { recursive: true });
  fs.mkdirSync(pageInclude, { recursive: true });
  fs.writeFileSync(path.join(include, '_pop.shtml'), '<span>root include</span>');
  fs.writeFileSync(path.join(pageInclude, '_relative.shtml'), '<span>relative include</span>');
  fs.writeFileSync(
    path.join(pages, 'index.shtml'),
    '<main>' +
      '<!--#include virtual="/include/_pop.shtml" -->' +
      '<!--# include virtual="/include/_pop.shtml" -->' +
      '<!--include virtual="/include/_pop.shtml" -->' +
      '<!--#include virtual="include/_relative.shtml" -->' +
      '</main>'
  );

  return { fixtureRoot, wwwroot };
}

function removeFixture(fixtureRoot) {
  const wwwroot = path.join(fixtureRoot, 'wwwroot');
  const include = path.join(wwwroot, 'include');
  const pages = path.join(wwwroot, 'pages');
  const dist = path.join(fixtureRoot, 'dist');

  const files = [
    path.join(include, '_pop.shtml'),
    path.join(pages, 'include', '_relative.shtml'),
    path.join(pages, 'index.shtml'),
    path.join(dist, 'pages', 'index.html'),
    path.join(dist, 'pages', 'include', '_relative.shtml')
  ];
  files.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  [
    path.join(dist, 'pages', 'include'),
    path.join(dist, 'pages'),
    path.join(dist, 'include'),
    dist,
    path.join(pages, 'include'),
    include,
    pages,
    wwwroot,
    fixtureRoot
  ].forEach(dirPath => {
    if (fs.existsSync(dirPath)) {
      fs.rmdirSync(dirPath);
    }
  });
}

(async () => {
  const { fixtureRoot } = createFixture();
  const originalCwd = process.cwd();
  const port = 20080 + (process.pid % 1000);
  const serverScript = path.join(os.tmpdir(), `mikit-ssi-root-${process.pid}.js`);
  let child;

  try {
    process.chdir(fixtureRoot);
    require(path.join(repoRoot, 'lib', 'builder')).build({
      output: path.join(fixtureRoot, 'dist')
    });
    const builtPage = fs.readFileSync(
      path.join(fixtureRoot, 'dist', 'pages', 'index.html'),
      'utf8'
    );
    assert.equal((builtPage.match(/<span>root include<\/span>/g) || []).length, 3);
    assert.equal((builtPage.match(/<span>relative include<\/span>/g) || []).length, 1);

    fs.writeFileSync(serverScript, `
process.chdir(${JSON.stringify(fixtureRoot)});
require(${JSON.stringify(path.join(repoRoot, 'lib', 'server'))}).start({
  root: '.',
  port: ${port},
  virtual: {}
});
`);
    child = spawn(process.execPath, [serverScript], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForServer(child, port);

    const response = await request(port, '/pages/index.shtml');
    assert.equal(response.statusCode, 200);
    assert.equal((response.body.match(/<span>root include<\/span>/g) || []).length, 3);
    assert.equal((response.body.match(/<span>relative include<\/span>/g) || []).length, 1);
    assert.doesNotMatch(response.body, /<!--\s*#?\s*include\s+(?:virtual|file)=/);
  } finally {
    if (child) {
      await stopServer(child);
    }
    if (fs.existsSync(serverScript)) {
      fs.unlinkSync(serverScript);
    }
    process.chdir(originalCwd);
    removeFixture(fixtureRoot);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
