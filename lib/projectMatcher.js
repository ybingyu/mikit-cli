const path = require('path');
const fs = require('fs');

// 存储已安装的项目
const installedProject = {};
// 默认项目ID
let defaultId = null;
// 项目ID计数器
let idCounter = 0;

function createProjectId(projPath) {
  const projbase = path.basename(projPath);
  let id = /[^\u0000-\u00FF]/.test(projbase) ? idCounter++ : projbase.toLowerCase();

  if (!!~projbase.indexOf('.') || installedProject[id]) {
    id = idCounter++;
  }

  return String(id);
}

function hasWwwroot(projPath) {
  return fs.existsSync(path.join(projPath, 'wwwroot'));
}

// 加载项目
function loadProject(projPath) {
  // 检查项目目录是否存在
  if (!fs.existsSync(projPath)) {
    console.error(`Project directory not found: ${projPath}`);
    return null;
  }

  if (!hasWwwroot(projPath)) {
    return null;
  }

  const id = createProjectId(projPath);
  
  // 创建项目对象
  const project = {
    id: id,
    path: projPath,
    wwwroot: path.join(projPath, 'wwwroot'),
    getMiddleware: function() {
      return (req, res, next) => {
        // 这里可以添加项目特定的中间件逻辑
        // 目前我们只是设置项目的根目录
        req.projectRoot = this.wwwroot;
        next();
      };
    }
  };
  
  installedProject[id] = project;
  setDefault(id);
  return project;
}

function loadProjects(rootPath) {
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

// 设置默认项目
function setDefault(id) {
  if (installedProject[id]) {
    defaultId = id;
  }
}

// 项目匹配中间件
const middleware = module.exports = function(req, res, next) {
  // 从请求域名中提取第一个部分作为项目ID
  const idx = req.hostname.split('.')[0].toLowerCase();
  // 如果该项目ID存在于已安装项目中，则使用该项目的中间件处理请求
  if (installedProject[idx]) {
    req.handler = installedProject[idx];
    req.handler.getMiddleware()(req, res, next);
  }

  // 如果没有匹配到项目，则使用默认项目
  if (!req.handler) {
    if (defaultId && installedProject[defaultId]) {
      req.handler = installedProject[defaultId];
      req.handler.getMiddleware()(req, res, next);
    } else {
      next('No project found, List all project');
    }
  }
};

// 导出其他方法
module.exports.installedProject = installedProject;
module.exports.loadProject = loadProject;
module.exports.loadProjects = loadProjects;
module.exports.setDefault = setDefault;
module.exports.getDefault = function() {
  return defaultId;
};
module.exports.getProjects = function() {
  return Object.keys(installedProject).map(id => installedProject[id]);
};
