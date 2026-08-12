const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const serverScript = path.join(os.tmpdir(), `mikit-directory-listing-${process.pid}.js`);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mikit-directory-listing-'));
const wwwroot = path.join(fixtureRoot, 'wwwroot');
const dist = path.join(fixtureRoot, 'dist');
const port = 19080 + (process.pid % 1000);

function request(pathname) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: '127.0.0.1',
      port,
      path: pathname
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    }).on('error', reject);
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for server. Output:\n${output}`));
    }, 10000);

    function onData(data) {
      output += data.toString();
      if (output.includes(`Server is running at http://localhost:${port}`)) {
        clearTimeout(timeout);
        resolve(output);
      }
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
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

    child.once('exit', () => resolve());
    child.kill();
  });
}

(async () => {
  fs.mkdirSync(wwwroot);
  fs.writeFileSync(path.join(wwwroot, 'alpha.shtml'), 'alpha');
  fs.writeFileSync(path.join(wwwroot, 'plain.txt'), 'plain');
  fs.mkdirSync(path.join(wwwroot, 'nested'));
  fs.writeFileSync(path.join(wwwroot, 'nested', 'beta.html'), 'beta');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'bundle.js'), 'bundle');

  fs.writeFileSync(serverScript, `
process.chdir(${JSON.stringify(fixtureRoot)});
require(${JSON.stringify(path.join(repoRoot, 'lib', 'server'))}).start({
  root: '.',
  port: ${port},
  virtual: {}
});
`);

  const child = spawn(process.execPath, [serverScript], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child);

    const rootResponse = await request('/');
    assert.strictEqual(rootResponse.statusCode, 200);
    assert.match(rootResponse.body, /alpha\.shtml/);
    assert.match(rootResponse.body, /plain\.txt/);
    assert.match(rootResponse.body, /nested\//);

    const nestedResponse = await request('/nested/');
    assert.strictEqual(nestedResponse.statusCode, 200);
    assert.match(nestedResponse.body, /beta\.html/);
    assert.match(nestedResponse.body, /href="\/nested\/beta\.html"/);

    const nestedNoSlashResponse = await request('/nested');
    assert.strictEqual(nestedNoSlashResponse.statusCode, 200);
    assert.match(nestedNoSlashResponse.body, /href="\/nested\/beta\.html"/);

    const distResponse = await request('/dist/');
    assert.strictEqual(distResponse.statusCode, 200);
    assert.match(distResponse.body, /bundle\.js/);
  } finally {
    await stopServer(child);
    fs.unlinkSync(serverScript);
    fs.unlinkSync(path.join(dist, 'bundle.js'));
    fs.rmdirSync(dist);
    fs.unlinkSync(path.join(wwwroot, 'alpha.shtml'));
    fs.unlinkSync(path.join(wwwroot, 'plain.txt'));
    fs.unlinkSync(path.join(wwwroot, 'nested', 'beta.html'));
    fs.rmdirSync(path.join(wwwroot, 'nested'));
    fs.rmdirSync(wwwroot);
    fs.rmdirSync(fixtureRoot);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
