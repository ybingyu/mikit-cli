const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { compileSassFile } = require('./sass-compiler');
const { formatSassError, formatSassWarning } = require('./sass-diagnostics');
const chokidar = require('chokidar');
const projectMatcher = require('./projectMatcher');
const { attachWatcherErrorHandler, createAutoWatchIgnored } = require('./watcher-safety');

const LIVE_RELOAD_PORT = 35730;
const LIVE_RELOAD_BIND_HOST = '0.0.0.0';
const LIVE_RELOAD_FALLBACK_HOST = 'localhost';

function toReloadPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function normalizeReloadPath(filePath) {
  return toReloadPath(filePath).replace(/^\/+/, '');
}

function resolveSSIIncludePath(type, includePath, baseDir, rootDir) {
  const isRootRelative = /^[/\\]/.test(includePath);
  const normalizedPath = includePath.replace(/^[/\\]+/, '');

  return type === 'virtual' && isRootRelative
    ? path.join(rootDir, normalizedPath)
    : path.resolve(baseDir, includePath);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPathInside(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getRawRequestPath(req) {
  return (req.path || req.url || '').split('?')[0];
}

function decodeRequestPath(req) {
  const rawPath = getRawRequestPath(req);

  try {
    return decodeURIComponent(rawPath);
  } catch (error) {
    return rawPath;
  }
}

function resolveRequestPath(root, req) {
  const resolvedRoot = path.resolve(root);
  const cleanPath = decodeRequestPath(req).replace(/\\/g, '/');
  const requestPath = cleanPath.startsWith('/') ? `.${cleanPath}` : `./${cleanPath}`;
  const filePath = path.resolve(resolvedRoot, requestPath);

  return isPathInside(resolvedRoot, filePath) ? filePath : '';
}

function getDirectoryListingHtml(root, dirPath, requestPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

  const baseHref = requestPath.endsWith('/') ? requestPath : `${requestPath}/`;
  const relativeTitle = path.relative(root, dirPath) || '.';
  const items = entries.map(entry => {
    const name = `${entry.name}${entry.isDirectory() ? '/' : ''}`;
    const href = `${baseHref}${encodeURIComponent(entry.name)}${entry.isDirectory() ? '/' : ''}`;

    return `<li><a href="${href}">${escapeHtml(name)}</a></li>`;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Index of ${escapeHtml(baseHref)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; line-height: 1.5; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    ul { margin: 0; padding-left: 20px; }
  </style>
</head>
<body>
  <h1>Index of ${escapeHtml(relativeTitle)}</h1>
  <ul>
${items}
  </ul>
</body>
</html>`;
}

function sendDirectoryListing(req, res, root, dirPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(dirPath);
  const requestPath = getRawRequestPath(req);

  if (!isPathInside(resolvedRoot, resolvedDir) || !fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    return false;
  }

  res.type('html').send(getDirectoryListingHtml(resolvedRoot, resolvedDir, requestPath));
  return true;
}

// 全局 LiveReload 服务器实例
// 使用全局变量确保多个实例共享同一个 LiveReload 服务器
let lrServer = null;
let lrServerStarted = false;

// 获取或创建 LiveReload 服务器实例
function getLiveReloadServer() {
  if (!lrServer) {
    lrServer = require('tiny-lr')({
      port: LIVE_RELOAD_PORT,
      errorListener: function(error) {
        if (error.code === 'EADDRINUSE') {
          console.log(`LiveReload server port ${LIVE_RELOAD_PORT} is already in use, using existing server`);
          lrServerStarted = true;
        } else {
          console.error('LiveReload server error:', error.message);
        }
      }
    });
  }
  return lrServer;
}

function getLiveReloadHost(req) {
  return req && req.hostname ? req.hostname : LIVE_RELOAD_FALLBACK_HOST;
}

function getLiveReloadScript(req) {
  const projectId = req && req.handler && req.handler.id ? req.handler.id : '';

  return `
<script id="mikit-hot-reload" data-project="${projectId}">
(function () {
  var project = document.currentScript && document.currentScript.getAttribute('data-project');
  var lastModified = null;
  var timer = null;

  function isCssFile(file) {
    return /\\.css(?:\\.map)?(?:\\?|$)/i.test(file || '');
  }

  function updateStyleHref(link) {
    var href = link.getAttribute('href');

    if (!href || href.indexOf('data:') === 0 || href.indexOf('blob:') === 0) {
      return;
    }

    var absoluteUrl = new URL(href, window.location.href);
    absoluteUrl.searchParams.set('mikit-css-reload', Date.now());
    link.setAttribute('href', absoluteUrl.href);
  }

  function refreshStylesheets(files) {
    var links = Array.prototype.slice.call(document.querySelectorAll('link[rel~="stylesheet"][href]'));

    if (!links.length) {
      return false;
    }

    links.forEach(updateStyleHref);
    return true;
  }

  function checkForUpdates() {
    if (!project) {
      return;
    }

    fetch('/hot-update-status?project=' + encodeURIComponent(project), { cache: 'no-store' })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (lastModified === null) {
          lastModified = data.lastModified || 0;
          return;
        }

        if (data.lastModified && data.lastModified > lastModified) {
          var files = Array.isArray(data.files) ? data.files : [];
          var cssOnly = files.length > 0 && files.every(isCssFile);

          lastModified = data.lastModified;

          if (cssOnly && refreshStylesheets(files)) {
            return;
          }

          window.location.reload();
          return;
        }

        lastModified = data.lastModified || lastModified;
      })
      .catch(function () {})
      .finally(function () {
        timer = setTimeout(checkForUpdates, 1000);
      });
  }

  window.addEventListener('beforeunload', function () {
    if (timer) {
      clearTimeout(timer);
    }
  });

  checkForUpdates();
})();
</script>
`;
}

// 尝试启动 LiveReload 服务器
// 注意：如果端口被占用，我们不会报错，因为可能有其他实例已经在运行
// 多个实例会共享同一个 LiveReload 服务器
function startLiveReloadServer() {
  // 如果已经启动，直接返回
  if (lrServerStarted) {
    return;
  }
  
  const server = getLiveReloadServer();
  
  // 监听所有网络接口，确保自定义域名也能访问
  server.listen(LIVE_RELOAD_PORT, LIVE_RELOAD_BIND_HOST, function() {
    console.log(`LiveReload server is running on port ${LIVE_RELOAD_PORT} (listening on all interfaces)`);
    lrServerStarted = true;
  });
}

// 启动 LiveReload 服务器
startLiveReloadServer();

// 启动服务器
function start(options) {
  const app = express();
  
  // 为LiveReload服务器添加代理路由，避免跨域问题
  app.get('/livereload.js', (req, res) => {
    const http = require('http');
    
    const options = {
      hostname: 'localhost',
      port: 35730,
      path: '/livereload.js',
      method: 'GET'
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (e) => {
      console.error(`Proxy request error: ${e.message}`);
      res.status(500).send('Proxy request failed');
    });
    
    proxyReq.end();
  });
  
  // 为LiveReload WebSocket添加代理
  app.get('/livereload', (req, res) => {
    const http = require('http');
    
    const options = {
      hostname: 'localhost',
      port: 35730,
      path: '/livereload',
      method: 'GET'
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (e) => {
      console.error(`Proxy request error: ${e.message}`);
      res.status(500).send('Proxy request failed');
    });
    
    proxyReq.end();
  });
  const virtual = options.virtual || {};
  const rootPath = path.resolve(process.cwd(), options.root || '.');
  let aliasConfig = projectMatcher.readAliasConfig(rootPath, options.alias);
  const port = options.port || (aliasConfig && aliasConfig.port) || 8080;
  const domain = options.domain || (aliasConfig && aliasConfig.domain) || 'y.bindyy.cn';
  let projects = [];
  const projectWatchers = new Map();
  const projectModifiedTimes = new Map();
  const projectChangedFiles = new Map();

  function loadConfiguredProjects() {
    aliasConfig = projectMatcher.readAliasConfig(rootPath, options.alias);
    projects = aliasConfig
      ? projectMatcher.loadAliasProjects(rootPath, aliasConfig)
      : projectMatcher.loadProjects(rootPath);
    syncProjectWatchers();
    return projects;
  }

  function syncProjectWatchers() {
    projects.forEach(project => {
      getProjectModifiedTime(project.id);
      const current = projectWatchers.get(project.id);
      if (current && current.wwwroot === project.wwwroot) {
        return;
      }

      if (current && current.watcher && typeof current.watcher.close === 'function') {
        current.watcher.close();
      }

      projectWatchers.set(project.id, {
        wwwroot: project.wwwroot,
        watcher: watchFiles(project.wwwroot, virtual)
      });
    });

    Array.from(projectWatchers.keys()).forEach(id => {
      if (!projects.some(project => project.id === id)) {
        const current = projectWatchers.get(id);
        if (current && current.watcher && typeof current.watcher.close === 'function') {
          current.watcher.close();
        }
        projectWatchers.delete(id);
        projectModifiedTimes.delete(id);
      }
    });
  }

  function reloadConfiguredProjects(reason) {
    const loadedProjects = loadConfiguredProjects();
    console.log(`Reloaded projects${reason ? ` (${reason})` : ''}: ${loadedProjects.length ? loadedProjects.map(project => project.id).join(', ') : 'No project loaded'}`);
  }

  loadConfiguredProjects();
  
  console.log(`Process cwd: ${process.cwd()}`);
  console.log(`Project root: ${rootPath}`);
  if (aliasConfig) {
    console.log(`Alias config: ${aliasConfig.path}`);
  }
  console.log(`Loaded projects: ${projects.length ? projects.map(project => project.id).join(', ') : 'No project loaded'}`);
  console.log(`Starting development server at http://localhost:${port}`);
  projects.forEach(project => {
    console.log(`You can also access ${project.id} at http://${project.id}.${domain}:${port}`);
  });
  
  // 配置虚拟目录
  if (Object.keys(virtual).length > 0) {
    console.log('Virtual directories configured:');
    Object.entries(virtual).forEach(([path, physicalPath]) => {
      console.log(`  ${path} -> ${physicalPath}`);
      app.use(path, express.static(physicalPath, {
        maxAge: 0 // 禁用缓存
      }));
    });
  }
  
  // 添加HTTP缓存控制中间件
  app.use((req, res, next) => {
    // 对于开发环境，禁用缓存
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });
  
  // 添加项目匹配中间件
  app.use(projectMatcher);

  // Map /dist to the matched project's dist output directory.
  app.use((req, res, next) => {
    if (req.path !== '/dist') {
      return next();
    }

    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
    res.redirect(302, `/dist/${query}`);
  });

  const distRouter = express.Router();

  distRouter.use((req, res, next) => {
    if (!req.handler || !req.handler.path) {
      return next();
    }

    const distRoot = path.join(req.handler.path, 'dist');
    if (!fs.existsSync(distRoot)) {
      return res.status(404).send('Dist directory not found');
    }

    req.projectRoot = distRoot;
    next();
  });

  distRouter.get('/', (req, res) => {
    const root = req.projectRoot;
    const indexShtml = path.join(root, 'index.shtml');
    const indexHtml = path.join(root, 'index.html');

    if (fs.existsSync(indexShtml)) {
      try {
        let content = fs.readFileSync(indexShtml, 'utf8');
        content = processSSI(content, root, req, root);
        res.send(content);
      } catch (error) {
        console.error(`Error processing dist index.shtml: ${error.message}`);
        res.status(500).send('Internal Server Error');
      }
    } else if (fs.existsSync(indexHtml)) {
      try {
        let content = fs.readFileSync(indexHtml, 'utf8');
        res.send(content);
      } catch (error) {
        console.error(`Error processing dist index.html: ${error.message}`);
        res.sendFile(indexHtml);
      }
    } else {
      sendDirectoryListing(req, res, root, root);
    }
  });

  distRouter.get('*.shtml', (req, res) => {
    const root = req.projectRoot;
    const filePath = resolveRequestPath(root, req);

    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = processSSI(content, path.dirname(filePath), req, root);
        res.send(content);
      } catch (error) {
        console.error(`Error processing dist ${req.path}: ${error.message}`);
        res.sendFile(filePath);
      }
    } else {
      res.status(404).send('Not Found');
    }
  });

  distRouter.get('*.html', (req, res) => {
    const root = req.projectRoot;
    const filePath = resolveRequestPath(root, req);

    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        res.send(content);
      } catch (error) {
        console.error(`Error processing dist ${req.path}: ${error.message}`);
        res.sendFile(filePath);
      }
    } else {
      res.status(404).send('Not Found');
    }
  });

  distRouter.use((req, res, next) => {
    express.static(req.projectRoot, {
      index: false,
      maxAge: 0
    })(req, res, next);
  });

  app.use('/dist', distRouter);
  
  // 配置SSI中间件
  app.use((req, res, next) => {
    const root = req.projectRoot || process.cwd();
    const filePath = resolveRequestPath(root, req);
    
    if ((path.extname(filePath) === '.shtml' || path.extname(filePath) === '.html') && fs.existsSync(filePath)) {
      try {
        // 读取文件内容
        let content = fs.readFileSync(filePath, 'utf8');
        
        // 解析SSI指令
        content = processSSI(content, path.dirname(filePath), req, root);
        
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('mikit-hot-reload')) {
          content += getLiveReloadScript(req);
        }
        
        res.send(content);
      } catch (error) {
        console.error(`SSI processing error: ${error.message}`);
        next();
      }
    } else {
      next();
    }
  });
  
  // 配置Sass编译中间件
  app.use((req, res, next) => {
    const root = req.projectRoot || process.cwd();
    // 任意 CSS 请求都可以由同路径的 SCSS/SASS 文件即时编译生成
    const cssPath = resolveRequestPath(root, req);
    if (path.extname(cssPath) !== '.css') {
      return next();
    }

    const scssPath = cssPath.replace(/\.css$/, '.scss');
    const sassPath = cssPath.replace(/\.css$/, '.sass');
    const sourcePath = fs.existsSync(scssPath) ? scssPath : sassPath;
    
    if (fs.existsSync(sourcePath)) {
      const warnings = [];
      const reportWarnings = () => warnings.forEach(warning => console.warn(warning));
      try {
        const css = compileSassFile(sourcePath, {
          loadPaths: [path.dirname(sourcePath), path.join(root, 'css')],
          logger: {
            warn(message, options) {
              warnings.push(formatSassWarning(message, options));
            },
            debug() {}
          }
        });

        reportWarnings();
        res.set('Content-Type', 'text/css');
        res.send(css);
      } catch (error) {
        console.error(formatSassError(error, sourcePath));
        reportWarnings();
        res.status(500).send('Sass compilation error');
      }
    } else {
      next();
    }
  });
  
  // 递归解析SSI指令
  function processSSI(content, baseDir, req, rootDir) {
    // 匹配SSI include指令
    const includeRegex = /<!--\s*#?\s*include\s+(virtual|file)="([^"]+)"\s*-->/g;
    let result = content.replace(includeRegex, (match, type, includePath) => {
      const includeFilePath = resolveSSIIncludePath(type, includePath, baseDir, rootDir);
      
      if (fs.existsSync(includeFilePath)) {
        try {
          const includeContent = fs.readFileSync(includeFilePath, 'utf8');
          // 递归处理include文件中的SSI指令
          return processSSI(includeContent, path.dirname(includeFilePath), req, rootDir);
        } catch (error) {
          console.error(`Error reading include file ${includeFilePath}: ${error.message}`);
          return match; // 返回原始指令
        }
      } else {
        console.warn(`Include file not found: ${includeFilePath}`);
        return match; // 返回原始指令
      }
    });
    
    // 匹配SSI echo指令
    const echoRegex = /<!--#echo\s+var="([^"]+)"\s*-->/g;
    result = result.replace(echoRegex, (match, varName) => {
      // 简单的环境变量支持
      const envVars = {
        'DATE_LOCAL': new Date().toLocaleString(),
        'DOCUMENT_URI': req ? req.path : '',
        'SERVER_NAME': 'localhost',
        'SERVER_PORT': port
      };
      return envVars[varName] || '';
    });
    
    return result;
  }

  function findStylesheetReloadPaths(projectRoot) {
    const cssFiles = new Set();
    const pageExts = new Set(['.html', '.shtml']);
    const linkRegex = /<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;

    function walk(dir) {
      if (!fs.existsSync(dir)) {
        return;
      }

      fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          return;
        }

        const entryPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(entryPath);
          return;
        }

        if (!pageExts.has(path.extname(entry.name).toLowerCase())) {
          return;
        }

        try {
          let content = fs.readFileSync(entryPath, 'utf8');
          content = processSSI(content, path.dirname(entryPath), null, projectRoot);

          let match;
          while ((match = linkRegex.exec(content))) {
            const href = match[1].split('#')[0].split('?')[0];

            if (!href || /^https?:\/\//i.test(href) || href.indexOf('//') === 0) {
              continue;
            }

            const cssPath = href.charAt(0) === '/'
              ? href.slice(1)
              : toReloadPath(path.relative(projectRoot, path.resolve(path.dirname(entryPath), href)));

            if (path.extname(cssPath).toLowerCase() === '.css') {
              cssFiles.add(normalizeReloadPath(cssPath));
            }
          }
        } catch (error) {
          console.warn(`Failed to inspect stylesheet links in ${entryPath}: ${error.message}`);
        }
      });
    }

    walk(projectRoot);
    return Array.from(cssFiles);
  }

  function getCssReloadFiles(filePath, projectRoot) {
    const relativeSource = normalizeReloadPath(path.relative(projectRoot, filePath));
    const directCss = normalizeReloadPath(relativeSource.replace(/\.(scss|sass)$/i, '.css'));
    const sourceBaseName = path.basename(filePath);

    if (sourceBaseName.charAt(0) !== '_') {
      return [directCss];
    }

    const stylesheetPaths = findStylesheetReloadPaths(projectRoot);
    return stylesheetPaths.length ? stylesheetPaths : [directCss];
  }

  // 处理根路径请求
  app.get('/', (req, res) => {
    const root = req.projectRoot || process.cwd();
    const indexShtml = path.join(root, 'index.shtml');
    const indexHtml = path.join(root, 'index.html');
    
    if (fs.existsSync(indexShtml)) {
      // 读取并处理index.shtml文件
      try {
        let content = fs.readFileSync(indexShtml, 'utf8');
        // 解析SSI include指令
        content = processSSI(content, root, req, root);
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('mikit-hot-reload')) {
          content += getLiveReloadScript(req);
        }
        res.send(content);
      } catch (error) {
        console.error(`Error processing index.shtml: ${error.message}`);
        res.status(500).send('Internal Server Error');
      }
    } else if (fs.existsSync(indexHtml)) {
      // 读取并处理index.html文件
      try {
        let content = fs.readFileSync(indexHtml, 'utf8');
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('mikit-hot-reload')) {
          content += getLiveReloadScript(req);
        }
        res.send(content);
      } catch (error) {
        console.error(`Error processing index.html: ${error.message}`);
        res.sendFile(indexHtml);
      }
    } else {
      sendDirectoryListing(req, res, root, root);
    }
  });

  // 处理SHTML文件请求
  app.get('*.shtml', (req, res) => {
    const root = req.projectRoot || process.cwd();
    // 移除查询参数，获取实际文件路径
    const filePath = resolveRequestPath(root, req);
    
    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        // 解析SSI include指令
        content = processSSI(content, path.dirname(filePath), req, root);
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('mikit-hot-reload')) {
          content += getLiveReloadScript(req);
        }
        res.send(content);
      } catch (error) {
        console.error(`Error processing ${req.path}: ${error.message}`);
        res.sendFile(filePath);
      }
    } else {
      res.status(404).send('Not Found');
    }
  });
  
  function getProjectModifiedTime(projectId) {
    if (!projectModifiedTimes.has(projectId)) {
      projectModifiedTimes.set(projectId, Date.now());
    }

    return projectModifiedTimes.get(projectId);
  }

  function touchProject(projectId) {
    if (projectId) {
      projectModifiedTimes.set(projectId, Date.now());
    }
  }

  function setProjectChangedFiles(projectId, files) {
    if (projectId) {
      projectChangedFiles.set(projectId, files);
    }
  }

  // 提供热更新状态端点
  app.get('/hot-update-status', (req, res) => {
    const projectId = req.query.project || (req.handler && req.handler.id) || '';

    res.json({
      project: projectId,
      lastModified: getProjectModifiedTime(projectId),
      files: projectChangedFiles.get(projectId) || []
    });
  });

  // 监听文件变化并通知 LiveReload
  function watchFiles(root, virtual) {
    // 构建忽略列表，包括node_modules、dist和虚拟目录
    const ignoredPaths = [/node_modules/, /dist/];
    
    // 添加虚拟目录到忽略列表
    Object.values(virtual).forEach(virtualPath => {
      ignoredPaths.push(virtualPath);
    });
    
    const watcher = chokidar.watch(root, {
      ignored: ignoredPaths,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });
    attachWatcherErrorHandler(watcher, `project: ${root}`);
    
    // 监听文件变化
    watcher.on('change', (filePath) => {
      console.log(`File changed: ${filePath}`);
      notifyLiveReload(filePath);
    });
    
    // 监听文件添加
    watcher.on('add', (filePath) => {
      console.log(`File added: ${filePath}`);
      notifyLiveReload(filePath);
    });
    
    // 监听文件删除
    watcher.on('unlink', (filePath) => {
      console.log(`File deleted: ${filePath}`);
      notifyLiveReload(filePath);
    });
    
    console.log('Watching files for changes...');
    return watcher;
  }

  function watchAliasSources() {
    if (!aliasConfig) {
      return;
    }

    const reload = (() => {
      let timer = null;
      return (reason) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          reloadConfiguredProjects(reason);
        }, 200);
      };
    })();

    if (aliasConfig.path && fs.existsSync(aliasConfig.path)) {
      const aliasWatcher = chokidar.watch(aliasConfig.path, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100
        }
      });
      attachWatcherErrorHandler(aliasWatcher, `alias config: ${aliasConfig.path}`);
      aliasWatcher.on('change', () => reload('alias config changed'));
    }

    projectMatcher.getAutoWatchRoots(aliasConfig).forEach(watchRoot => {
      const autoWatcher = chokidar.watch(watchRoot, {
        ignored: createAutoWatchIgnored(watchRoot),
        ignoreInitial: true,
        depth: 4,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100
        }
      });
      attachWatcherErrorHandler(autoWatcher, `auto projects: ${watchRoot}`);
      autoWatcher
        .on('addDir', () => reload('auto project directory changed'))
        .on('unlinkDir', () => reload('auto project directory changed'));
    });
  }
  
  // 通知 LiveReload 服务器
  function notifyLiveReload(filePath) {
    const project = projects.find(item => filePath.indexOf(item.wwwroot) === 0);
    const projectRoot = project ? project.wwwroot : rootPath;
    
    // 确定文件类型并生成对应的变更文件列表
    const ext = path.extname(filePath);
    let files = [];
    
    if (ext === '.scss' || ext === '.sass') {
      files = getCssReloadFiles(filePath, projectRoot);
      console.log(`Notifying hot reload for CSS: ${files.join(', ')}`);
    } else if (ext === '.css') {
      const relativeCssPath = normalizeReloadPath(path.relative(projectRoot, filePath));
      files.push(relativeCssPath);
      console.log(`Notifying hot reload for CSS: ${relativeCssPath}`);
    } else {
      // 对于其他文件，直接通知
      // 将绝对路径转换为相对路径
      const relativeFilePath = normalizeReloadPath(path.relative(projectRoot, filePath));
      files.push(relativeFilePath);
      console.log(`Notifying LiveReload for: ${relativeFilePath}`);
    }

    if (project) {
      setProjectChangedFiles(project.id, files);
      touchProject(project.id);
      console.log(`Project hot reload updated: ${project.id}`);
    }
  }

  // 项目文件监听在 loadConfiguredProjects/syncProjectWatchers 中维护。
  watchAliasSources();

  // 处理HTML文件请求
  app.get('*.html', (req, res) => {
    const root = req.projectRoot || process.cwd();
    // 移除查询参数，获取实际文件路径
    const filePath = resolveRequestPath(root, req);
    
    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('mikit-hot-reload')) {
          content += getLiveReloadScript(req);
        }
        res.send(content);
      } catch (error) {
        console.error(`Error processing ${req.path}: ${error.message}`);
        res.sendFile(filePath);
      }
    } else {
      res.status(404).send('Not Found');
    }
  });

  // 动态静态文件服务
  app.use((req, res, next) => {
    const root = req.projectRoot || process.cwd();
    const dirPath = resolveRequestPath(root, req);

    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const indexShtml = path.join(dirPath, 'index.shtml');
      const indexHtml = path.join(dirPath, 'index.html');

      if (fs.existsSync(indexShtml)) {
        try {
          let content = fs.readFileSync(indexShtml, 'utf8');
          content = processSSI(content, dirPath, req, root);
          if (!content.includes('mikit-hot-reload')) {
            content += getLiveReloadScript(req);
          }
          res.send(content);
        } catch (error) {
          console.error(`Error processing ${path.join(getRawRequestPath(req), 'index.shtml')}: ${error.message}`);
          res.status(500).send('Internal Server Error');
        }
        return;
      }

      if (fs.existsSync(indexHtml)) {
        try {
          let content = fs.readFileSync(indexHtml, 'utf8');
          if (!content.includes('mikit-hot-reload')) {
            content += getLiveReloadScript(req);
          }
          res.send(content);
        } catch (error) {
          console.error(`Error processing ${path.join(getRawRequestPath(req), 'index.html')}: ${error.message}`);
          res.sendFile(indexHtml);
        }
        return;
      }

      if (sendDirectoryListing(req, res, root, dirPath)) {
        return;
      }
    }

    next();
  });

  app.use((req, res, next) => {
    const root = req.projectRoot || process.cwd();
    express.static(root, {
      index: false, // 禁用默认索引文件，让我们的自定义路由处理根路径
      maxAge: 0 // 禁用缓存
    })(req, res, next);
  });
  
  // 启动服务器
  const httpServer = app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });

  httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Please stop the existing service or start Mikit-CLI with another port, for example: mikit start --port 8081 --root ${options.root || '.'}`);
      process.exit(1);
    }

    console.error(`Server error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  start
};
