const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const sass = require('node-sass');
const chokidar = require('chokidar');
const projectMatcher = require('./projectMatcher');

const LIVE_RELOAD_PORT = 35730;
const LIVE_RELOAD_BIND_HOST = '0.0.0.0';
const LIVE_RELOAD_FALLBACK_HOST = 'localhost';
const LIVE_RELOAD_NOTIFY_HOST = '127.0.0.1';

function toReloadPath(filePath) {
  return filePath.split(path.sep).join('/');
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
  const host = getLiveReloadHost(req);
  return `\n<script src="http://${host}:${LIVE_RELOAD_PORT}/livereload.js?snipver=1"></script>\n`;
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
  const port = options.port || 8080;
  const domain = options.domain || 'y.bindyy.cn';
  const virtual = options.virtual || {};
  const rootPath = path.resolve(process.cwd(), options.root || '.');
  
  // 加载根目录下的项目。根目录本身是项目时只加载它，否则加载一级子目录项目。
  const projects = projectMatcher.loadProjects(rootPath);
  const currentProject = projects[0] || null;
  
  console.log(`Process cwd: ${process.cwd()}`);
  console.log(`Project root: ${rootPath}`);
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
  
  // 配置SSI中间件
  app.use((req, res, next) => {
    const root = req.projectRoot || process.cwd();
    const filePath = path.join(root, req.path);
    
    if ((path.extname(filePath) === '.shtml' || path.extname(filePath) === '.html') && fs.existsSync(filePath)) {
      try {
        // 读取文件内容
        let content = fs.readFileSync(filePath, 'utf8');
        
        // 解析SSI指令
        content = processSSI(content, path.dirname(filePath), req);
        
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('livereload.js')) {
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
  app.use('/css', (req, res, next) => {
    const root = req.projectRoot || process.cwd();
    // 直接使用req.path，因为中间件已经挂载在/css路径上
    // 移除查询参数，以匹配对应的SCSS文件
    const cleanPath = req.path.split('?')[0];
    const cssPath = path.join(root, 'css', cleanPath);
    const scssPath = cssPath.replace('.css', '.scss');
    
    if (fs.existsSync(scssPath)) {
      try {
        const result = sass.renderSync({
          file: scssPath,
          outputStyle: 'expanded',
          includePaths: [path.join(root, 'css')]
        });
        
        res.set('Content-Type', 'text/css');
        res.send(result.css);
      } catch (error) {
        console.error('Sass compilation error:', error.message);
        res.status(500).send('Sass compilation error');
      }
    } else {
      next();
    }
  });
  
  // 递归解析SSI指令
  function processSSI(content, baseDir, req) {
    // 匹配SSI include指令
    const includeRegex = /<!--#include\s+(virtual|file)="([^"]+)"\s*-->/g;
    let result = content.replace(includeRegex, (match, type, includePath) => {
      const includeFilePath = path.join(baseDir, includePath);
      
      if (fs.existsSync(includeFilePath)) {
        try {
          const includeContent = fs.readFileSync(includeFilePath, 'utf8');
          // 递归处理include文件中的SSI指令
          return processSSI(includeContent, path.dirname(includeFilePath), req);
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
        content = processSSI(content, root, req);
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('livereload.js')) {
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
        if (!content.includes('livereload.js')) {
          content += getLiveReloadScript(req);
        }
        res.send(content);
      } catch (error) {
        console.error(`Error processing index.html: ${error.message}`);
        res.sendFile(indexHtml);
      }
    } else {
      // 返回404错误
      res.status(404).send('Not Found');
    }
  });

  // 处理SHTML文件请求
  app.get('*.shtml', (req, res) => {
    const root = req.projectRoot || process.cwd();
    // 移除查询参数，获取实际文件路径
    const cleanPath = req.path.split('?')[0];
    const filePath = path.join(root, cleanPath);
    
    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        // 解析SSI include指令
        content = processSSI(content, path.dirname(filePath), req);
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('livereload.js')) {
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
  
  // 存储最后修改时间
  let lastModified = Date.now();

  // 提供热更新状态端点
  app.get('/hot-update-status', (req, res) => {
    res.json({
      lastModified: lastModified
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
  }
  
  // 通知 LiveReload 服务器
  function notifyLiveReload(filePath) {
    const project = projects.find(item => filePath.indexOf(item.wwwroot) === 0);
    const projectRoot = project ? project.wwwroot : rootPath;
    
    // 确定文件类型并生成对应的变更文件列表
    const ext = path.extname(filePath);
    let files = [];
    
    if (ext === '.scss' || ext === '.sass') {
      // 对于 SCSS/SASS 文件，通知对应的 CSS 文件
      const cssPath = filePath.replace(/\.(scss|sass)$/, '.css');
      // 将绝对路径转换为相对路径
      const relativeCssPath = toReloadPath(path.relative(projectRoot, cssPath));
      files.push(relativeCssPath);
      console.log(`Notifying LiveReload for CSS: ${relativeCssPath}`);
    } else {
      // 对于其他文件，直接通知
      // 将绝对路径转换为相对路径
      const relativeFilePath = toReloadPath(path.relative(projectRoot, filePath));
      files.push(relativeFilePath);
      console.log(`Notifying LiveReload for: ${relativeFilePath}`);
    }
    
    // 通知共享 LiveReload 端口。即使当前进程不是端口持有者，也能刷新已连接的页面。
    try {
      const req = http.request({
        hostname: LIVE_RELOAD_NOTIFY_HOST,
        port: LIVE_RELOAD_PORT,
        path: '/changed',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }, (res) => {
        res.resume();
      });

      req.on('error', (e) => {
        console.warn('Failed to notify LiveReload server:', e.message);
        console.warn('Hot reload may not work properly');
      });

      req.write(JSON.stringify({
        files: files
      }));
      req.end();
    } catch (error) {
      console.warn('Failed to notify LiveReload server:', error.message);
      console.warn('Hot reload may not work properly');
    }
  }

  // 开始监听文件变化
  if (projects.length) {
    projects.forEach(project => watchFiles(project.wwwroot, virtual));
  } else {
    watchFiles(rootPath, virtual);
  }

  // 处理HTML文件请求
  app.get('*.html', (req, res) => {
    const root = req.projectRoot || process.cwd();
    // 移除查询参数，获取实际文件路径
    const cleanPath = req.path.split('?')[0];
    const filePath = path.join(root, cleanPath);
    
    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('livereload.js')) {
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
