'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const packageInfo = require('../package.json');

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_SIZE = 64 * 1024;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseVersion(version) {
  if (typeof version !== 'string' || version.length > 256) return null;
  const match = VERSION.exec(version);
  if (!match || (match[4] && match[4].split('.').some(part => /^0\d+$/.test(part)))) return null;
  return { parts: match.slice(1, 4).map(BigInt), prerelease: Boolean(match[4]) };
}

function isNewerStableVersion(current, latest) {
  const installed = parseVersion(current);
  const available = parseVersion(latest);
  if (!installed || !available || available.prerelease) return false;
  for (let index = 0; index < installed.parts.length; index++) {
    if (available.parts[index] !== installed.parts[index]) {
      return available.parts[index] > installed.parts[index];
    }
  }
  return installed.prerelease;
}

function fetchLatestVersion({
  url = 'https://registry.npmjs.org/mikit-cli/latest',
  get = https.get,
  timeoutMs = 1000
} = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let response;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error('Version check timed out'));
      if (request) request.destroy();
      if (response) response.destroy();
    }, timeoutMs);
    function finish(error, version) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(version);
    }
    try {
      request = get(url, { headers: { Accept: 'application/json' } }, incoming => {
        response = incoming;
        response.on('error', error => finish(error));
        response.on('aborted', () => finish(new Error('Version response aborted')));
        if (response.statusCode !== 200) {
          finish(new Error('Version registry returned ' + response.statusCode));
          response.destroy();
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_RESPONSE_SIZE) {
            finish(new Error('Version response too large'));
            response.destroy();
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const { version } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!parseVersion(version)) throw new Error('Invalid registry version');
            finish(null, version);
          } catch (error) {
            finish(error);
          }
        });
      });
      request.on('error', error => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

function getUpdateCommand(installationDir) {
  // Global npm prefixes normally have no consuming package.json. Local and
  // workspace installs declare the dependency above a node_modules directory.
  let directory = path.resolve(installationDir);
  while (path.dirname(directory) !== directory) {
    if (path.basename(directory) === 'node_modules') {
      try {
        const project = JSON.parse(fs.readFileSync(path.join(path.dirname(directory), 'package.json'), 'utf8'));
        if (project.optionalDependencies && project.optionalDependencies['mikit-cli']) {
          return 'npm install --save-optional mikit-cli@latest';
        }
        if (project.dependencies && project.dependencies['mikit-cli']) {
          return 'npm install mikit-cli@latest';
        }
        if (project.devDependencies && project.devDependencies['mikit-cli']) {
          return 'npm install -D mikit-cli@latest';
        }
      } catch (_) {
        // Continue looking for the consuming project (including workspace roots).
      }
    }
    directory = path.dirname(directory);
  }
  return 'npm install -g mikit-cli@latest';
}

async function notifyUpdate({
  currentVersion = packageInfo.version,
  stream = process.stderr,
  env = process.env,
  cacheFile = path.join(env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'mikit-cli', 'update.json'),
  now = Date.now,
  fetchVersion = fetchLatestVersion,
  installationDir = path.resolve(__dirname, '..')
} = {}) {
  // Update checks are advisory: they must never fail the user's command.
  try {
    if (!stream.isTTY || (env.CI && env.CI !== 'false' && env.CI !== '0') || env.npm_config_update_notifier === 'false') return;
    const checkedAt = now();
    let cache;
    try {
      if (fs.statSync(cacheFile).size <= MAX_RESPONSE_SIZE) {
        cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      }
    } catch (_) {
      // Missing, unreadable or malformed caches are refreshed below.
    }
    const validLatest = cache && (cache.latest === null || Boolean(parseVersion(cache.latest)));
    const fresh = validLatest && Number.isFinite(cache.checkedAt) &&
      checkedAt >= cache.checkedAt && checkedAt - cache.checkedAt < CHECK_INTERVAL;
    if (!fresh) {
      let latest = validLatest ? cache.latest : null;
      try {
        const fetched = await fetchVersion();
        if (parseVersion(fetched)) latest = fetched;
      } catch (_) {
        // Cache failed attempts too, so offline commands do not repeatedly wait.
      }
      cache = { checkedAt, latest };
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf8');
      } catch (_) {
        // Read-only home directories do not prevent commands or notifications.
      }
    }
    if (isNewerStableVersion(currentVersion, cache.latest)) {
      stream.write('[mikit] 发现新版本：' + currentVersion + ' → ' + cache.latest +
        '\n[mikit] 更新命令：' + getUpdateCommand(installationDir) + '\n');
    }
  } catch (_) {
    // Even unexpected notification errors must not escape into command handling.
  }
}

module.exports = { notifyUpdate, fetchLatestVersion, isNewerStableVersion };
