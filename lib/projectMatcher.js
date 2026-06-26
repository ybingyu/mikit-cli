const path = require('path');
const fs = require('fs');

const installedProject = {};
let defaultId = null;
let idCounter = 0;

function reset() {
  Object.keys(installedProject).forEach(id => {
    delete installedProject[id];
  });
  defaultId = null;
  idCounter = 0;
}

function normalizeProjectId(id) {
  return String(id).trim().toLowerCase();
}

function createAliasId(name) {
  return normalizeProjectId(name)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidAlias(id) {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id);
}

function createProjectId(projPath) {
  const projbase = path.basename(projPath);
  let id = /[^\u0000-\u00FF]/.test(projbase) ? idCounter++ : projbase.toLowerCase();

  if (projbase.indexOf('.') !== -1 || installedProject[id]) {
    id = idCounter++;
  }

  return String(id);
}

function hasWwwroot(projPath) {
  return fs.existsSync(path.join(projPath, 'wwwroot'));
}

function createProject(id, projPath, wwwrootPath) {
  const project = {
    id: id,
    path: projPath,
    wwwroot: wwwrootPath,
    getMiddleware: function() {
      return (req, res, next) => {
        req.projectRoot = this.wwwroot;
        next();
      };
    }
  };

  installedProject[id] = project;
  setDefault(id);
  return project;
}

function loadProject(projPath) {
  if (!fs.existsSync(projPath)) {
    console.error(`Project directory not found: ${projPath}`);
    return null;
  }

  if (!hasWwwroot(projPath)) {
    return null;
  }

  const id = createProjectId(projPath);
  return createProject(id, projPath, path.join(projPath, 'wwwroot'));
}

function loadProjects(rootPath) {
  reset();
  const projects = [];

  if (!fs.existsSync(rootPath)) {
    console.error(`Root directory not found: ${rootPath}`);
    return projects;
  }

  const rootProject = loadProject(rootPath);
  if (rootProject) {
    projects.push(rootProject);
    setDefault(rootProject.id);
    return projects;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  entries.forEach(entry => {
    if (!entry.isDirectory()) {
      return;
    }

    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      return;
    }

    const project = loadProject(path.join(rootPath, entry.name));
    if (project) {
      projects.push(project);
    }
  });

  if (projects[0]) {
    setDefault(projects[0].id);
  }

  return projects;
}

function readAliasConfig(rootPath, aliasPath) {
  if (!aliasPath) {
    return null;
  }

  const configPath = path.resolve(process.cwd(), aliasPath);

  if (!fs.existsSync(configPath)) {
    console.error(`Alias config not found: ${configPath}`);
    return null;
  }

  try {
    const configText = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const config = JSON.parse(configText);
    const mappings = config.projects || config.aliases || (config.auto || config.scan ? {} : config);

    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
      console.error(`Alias config must be an object: ${configPath}`);
      return null;
    }

    return {
      path: configPath,
      root: path.resolve(process.cwd(), config.root || rootPath),
      domain: config.domain,
      port: config.port,
      default: config.default,
      auto: config.auto || config.scan || [],
      mappings: mappings
    };
  } catch (error) {
    console.error(`Failed to read alias config ${configPath}: ${error.message}`);
    return null;
  }
}

function getAutoPatterns(aliasConfig) {
  const auto = aliasConfig && aliasConfig.auto ? aliasConfig.auto : [];

  if (typeof auto === 'string') {
    return [auto];
  }

  if (Array.isArray(auto)) {
    return auto;
  }

  return [];
}

function splitPattern(pattern) {
  return String(pattern)
    .split(/[\\/]+/)
    .filter(Boolean);
}

function resolvePatternMatches(rootPath, pattern) {
  const parts = splitPattern(pattern);
  const matches = [];

  function walk(currentPath, index) {
    if (index >= parts.length) {
      if (fs.existsSync(currentPath) && fs.statSync(currentPath).isDirectory()) {
        matches.push(currentPath);
      }
      return;
    }

    const part = parts[index];
    if (part === '*') {
      if (!fs.existsSync(currentPath)) {
        return;
      }

      fs.readdirSync(currentPath, { withFileTypes: true }).forEach(entry => {
        if (entry.isDirectory()) {
          walk(path.join(currentPath, entry.name), index + 1);
        }
      });
      return;
    }

    walk(path.join(currentPath, part), index + 1);
  }

  walk(rootPath, 0);
  return matches;
}

function getAutoAliasId(targetPath, fallbackIndex) {
  const baseName = path.basename(path.dirname(targetPath));
  const alias = createAliasId(baseName);
  return alias || `project-${fallbackIndex}`;
}

function getUniqueAliasId(id, usedIds) {
  let nextId = id;
  let index = 2;

  while (usedIds.has(nextId)) {
    nextId = `${id}-${index}`;
    index += 1;
  }

  usedIds.add(nextId);
  return nextId;
}

function getAutoWatchRoots(aliasConfig) {
  const rootPath = aliasConfig ? aliasConfig.root : process.cwd();
  const roots = new Set();

  getAutoPatterns(aliasConfig).forEach(pattern => {
    const parts = splitPattern(pattern);
    const staticParts = [];

    for (const part of parts) {
      if (part === '*') {
        break;
      }
      staticParts.push(part);
    }

    roots.add(path.resolve(rootPath, ...staticParts));
  });

  return Array.from(roots).filter(item => fs.existsSync(item));
}

function getAliasTargetPath(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    return value.wwwroot || value.root || value.path;
  }

  return null;
}

function resolveAliasProject(rootPath, id, targetPath) {
  const absoluteTarget = path.resolve(rootPath, targetPath);

  if (!fs.existsSync(absoluteTarget)) {
    console.warn(`Alias target not found: ${id} -> ${absoluteTarget}`);
    return null;
  }

  const stat = fs.statSync(absoluteTarget);
  if (!stat.isDirectory()) {
    console.warn(`Alias target is not a directory: ${id} -> ${absoluteTarget}`);
    return null;
  }

  const directWwwroot = path.join(absoluteTarget, 'wwwroot');
  const wwwroot = fs.existsSync(directWwwroot) ? directWwwroot : absoluteTarget;
  const projPath = fs.existsSync(directWwwroot) ? absoluteTarget : path.dirname(absoluteTarget);

  return createProject(id, projPath, wwwroot);
}

function loadAliasProjects(rootPath, aliasConfig) {
  reset();
  const projects = [];
  const usedIds = new Set();

  if (!aliasConfig) {
    return projects;
  }

  getAutoPatterns(aliasConfig).forEach(pattern => {
    resolvePatternMatches(aliasConfig.root || rootPath, pattern).forEach((targetPath, index) => {
      const id = getUniqueAliasId(getAutoAliasId(targetPath, index + 1), usedIds);

      if (!isValidAlias(id)) {
        console.warn(`Invalid auto alias ignored: ${id} -> ${targetPath}`);
        return;
      }

      const project = resolveAliasProject(aliasConfig.root || rootPath, id, targetPath);
      if (project) {
        projects.push(project);
      }
    });
  });

  Object.entries(aliasConfig.mappings).forEach(([rawId, value]) => {
    const id = normalizeProjectId(rawId);
    const targetPath = getAliasTargetPath(value);

    if (!isValidAlias(id)) {
      console.warn(`Invalid alias ignored: ${rawId}. Use letters, numbers, and hyphen only.`);
      return;
    }

    if (!targetPath) {
      console.warn(`Alias target is empty: ${rawId}`);
      return;
    }

    usedIds.add(id);
    const project = resolveAliasProject(aliasConfig.root || rootPath, id, targetPath);
    if (project) {
      const index = projects.findIndex(item => item.id === id);
      if (index >= 0) {
        projects[index] = project;
      } else {
        projects.push(project);
      }
    }
  });

  if (aliasConfig.default) {
    const defaultAlias = normalizeProjectId(aliasConfig.default);
    if (installedProject[defaultAlias]) {
      setDefault(defaultAlias);
    } else {
      console.warn(`Default alias not found: ${aliasConfig.default}`);
      if (projects[0]) {
        setDefault(projects[0].id);
      }
    }
  } else if (projects[0]) {
    setDefault(projects[0].id);
  }

  return projects;
}

function setDefault(id) {
  if (installedProject[id]) {
    defaultId = id;
  }
}

const middleware = module.exports = function(req, res, next) {
  const idx = req.hostname.split('.')[0].toLowerCase();

  if (installedProject[idx]) {
    req.handler = installedProject[idx];
    return req.handler.getMiddleware()(req, res, next);
  }

  if (defaultId && installedProject[defaultId]) {
    req.handler = installedProject[defaultId];
    return req.handler.getMiddleware()(req, res, next);
  }

  next('No project found, List all project');
};

module.exports.installedProject = installedProject;
module.exports.reset = reset;
module.exports.readAliasConfig = readAliasConfig;
module.exports.getAutoWatchRoots = getAutoWatchRoots;
module.exports.loadProject = loadProject;
module.exports.loadProjects = loadProjects;
module.exports.loadAliasProjects = loadAliasProjects;
module.exports.setDefault = setDefault;
module.exports.getDefault = function() {
  return defaultId;
};
module.exports.getProjects = function() {
  return Object.keys(installedProject).map(id => installedProject[id]);
};
