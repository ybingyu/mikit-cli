const path = require('path');
const fs = require('fs');

// 存储已安装的项目
const installedProject = {};
// 默认项目ID
let defaultId = null;
// 项目ID计数器
let idCounter = 0;

// 加载项目
function loadProject(projPath) {
  const projbase = path.basename(projPath);
  // 如果项目名称包含非ASCII字符，使用自增ID，否则使用项目名称的小写形式
  let id = /[^\u0000-\u00FF]/.test(projbase) ? idCounter++ : projbase.toLowerCase();
  // 如果项目名称包含点号或者ID已存在，使用自增ID
  if (!!~projbase.indexOf('.') || installedProject[id]) {
    id = idCounter++;
  }
  
  // 检查项目目录是否存在
  if (!fs.existsSync(projPath)) {
    console.error(`Project directory not found: ${projPath}`);
    return null;
  }
  
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

// 设置默认项目
function setDefault(id) {
  if (installedProject[id]) {
    defaultId = id;
  }
}

// 项目匹配中间件
const middleware = module.exports = function(req, res, next) {
  // 从请求域名中提取第一个部分作为项目ID
  const idx = req.hostname.split('.')[0];
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
module.exports.setDefault = setDefault;
module.exports.getDefault = function() {
  return defaultId;
};