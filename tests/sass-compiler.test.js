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
      reject(new Error(`Timed out waiting for Sass server. Output:\n${output}`));
    }, 10000);

    function onData(data) {
      output += data.toString();
      if (output.includes(`Server is running at http://localhost:${port}`)) {
        clearTimeout(timeout);
        resolve(() => output);
      }
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Sass server exited early with code ${code}. Output:\n${output}`));
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

(async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-sass-'));
  const wwwroot = path.join(fixtureRoot, 'wwwroot');
  const cssDir = path.join(wwwroot, 'css');
  const distDir = path.join(fixtureRoot, 'dist');
  const port = 22000 + (process.pid % 1000);
  const serverScript = path.join(os.tmpdir(), `mikit-sass-server-${process.pid}.js`);
  const originalCwd = process.cwd();
  let child;

  try {
    fs.mkdirSync(cssDir, { recursive: true });
    fs.writeFileSync(path.join(cssDir, '_tokens.scss'), '$brand: #336699;\n');
    fs.writeFileSync(
      path.join(cssDir, 'main.scss'),
      "@use 'tokens';\n.card { color: tokens.$brand; }\n"
    );
    fs.writeFileSync(
      path.join(cssDir, 'legacy.sass'),
      "$accent: #cc3300\n.legacy\n  color: $accent\n"
    );

    process.chdir(fixtureRoot);
    require(path.join(repoRoot, 'lib', 'builder')).build({ output: distDir });

    const builtCss = fs.readFileSync(path.join(distDir, 'css', 'main.css'), 'utf8');
    assert.match(builtCss, /color:\s*#336699/);
    const builtIndentedCss = fs.readFileSync(path.join(distDir, 'css', 'legacy.css'), 'utf8');
    assert.match(builtIndentedCss, /color:\s*#cc3300/);

    fs.writeFileSync(serverScript, `
process.chdir(${JSON.stringify(fixtureRoot)});
require(${JSON.stringify(path.join(repoRoot, 'lib', 'server'))}).start({
  root: '.',
  port: ${port},
  virtual: {}
});
`);
    const childEnv = { ...process.env };
    delete childEnv.MIKIT_ALIAS_CONFIG;
    child = spawn(process.execPath, [serverScript], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const getServerOutput = await waitForServer(child, port);

    const response = await request(port, '/css/main.css');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(response.statusCode, 200, getServerOutput());
    assert.match(response.body, /color:\s*#336699/);

    const indentedResponse = await request(port, '/css/legacy.css');
    assert.equal(indentedResponse.statusCode, 200, getServerOutput());
    assert.match(indentedResponse.body, /color:\s*#cc3300/);

    const packageJson = require(path.join(repoRoot, 'package.json'));
    assert.equal(packageJson.dependencies['node-sass'], undefined);
    assert.equal(typeof packageJson.dependencies.sass, 'string');
  } finally {
    if (child) {
      await stopServer(child);
    }
    if (fs.existsSync(serverScript)) {
      fs.unlinkSync(serverScript);
    }
    process.chdir(originalCwd);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
