const express = require('express');
const path = require('path');
const fs = require('fs');
const sass = require('node-sass');
const chokidar = require('chokidar');
const lrServer = require('tiny-lr')();
const projectMatcher = require('./projectMatcher');

// 启动 LiveReload 服务器
lrServer.listen(35730, function() {
  console.log('LiveReload server is running on port 35730');
});

// 启动服务器
function start(options) {
  const app = express();
  const port = options.port || 8080;
  const domain = options.domain || 'y.bindyy.cn';
  
  // 加载当前目录作为项目
  const currentProject = projectMatcher.loadProject(process.cwd());
  
  console.log(`Process cwd: ${process.cwd()}`);
  console.log(`Loaded project: ${currentProject ? currentProject.id : 'No project loaded'}`);
  console.log(`Starting development server at http://localhost:${port}`);
  console.log(`You can also access this project at http://${currentProject.id}.${domain}:${port}`);
  
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
          // 注入 LiveReload 脚本
          const liveReloadScript = `
<script src="http://localhost:35730/livereload.js"></script>
`;
          content += liveReloadScript;
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
          // 注入 LiveReload 脚本
          const liveReloadScript = `
<script src="http://localhost:35730/livereload.js"></script>
`;
          content += liveReloadScript;
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
    const filePath = path.join(root, req.path);
    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        // 解析SSI include指令
        content = processSSI(content, path.dirname(filePath), req);
        // 检查是否已经注入了 LiveReload 脚本
        if (!content.includes('livereload.js')) {
          // 注入 LiveReload 脚本
          const liveReloadScript = `
<script src="http://localhost:35730/livereload.js"></script>
`;
          content += liveReloadScript;
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
  function watchFiles(root) {
    const watcher = chokidar.watch(root, {
      ignored: /node_modules/,
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
    // 确定文件类型并生成对应的变更文件列表
    const ext = path.extname(filePath);
    let files = [];
    
    if (ext === '.scss' || ext === '.sass') {
      // 对于 SCSS/SASS 文件，通知对应的 CSS 文件
      const cssPath = filePath.replace(/\.(scss|sass)$/, '.css');
      files.push(cssPath);
      console.log(`Notifying LiveReload for CSS: ${cssPath}`);
    } else {
      // 对于其他文件，直接通知
      files.push(filePath);
      console.log(`Notifying LiveReload for: ${filePath}`);
    }
    
    // 通知 LiveReload 服务器
    lrServer.changed({
      body: {
        files: files
      }
    });
  }

  // 开始监听文件变化
  watchFiles(currentProject ? currentProject.wwwroot : process.cwd());

  // 注入 LiveReload 脚本
  app.use((req, res, next) => {
    const root = req.projectRoot || process.cwd();
    const filePath = path.join(root, req.path);
    const ext = path.extname(filePath);
    
    if (ext === '.shtml' || ext === '.html') {
      // 读取文件内容
      fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) {
          next();
          return;
        }
        
        // 检查是否已经注入了 LiveReload 脚本
        if (content.includes('livereload.js')) {
          next();
          return;
        }
        
        // 注入 LiveReload 脚本
        const liveReloadScript = `
<script src="http://localhost:35730/livereload.js"></script>
`;
        
        // 在文件末尾添加脚本
        const modifiedContent = content + liveReloadScript;
        res.send(modifiedContent);
      });
    } else {
      next();
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
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

module.exports = {
  start
};