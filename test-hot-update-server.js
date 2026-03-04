const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const app = express();
const port = 8085;
const root = path.join(__dirname, 'test-project-wwwroot', 'wwwroot');

// 存储最后修改时间
let lastModified = Date.now();

// 提供热更新状态端点
app.get('/hot-update-status', (req, res) => {
  res.json({
    lastModified: lastModified
  });
});

// 处理HTML文件请求
app.get('*.html', (req, res) => {
  const filePath = path.join(root, req.path);
  console.log('Processing HTML file:', req.path);
  
  if (fs.existsSync(filePath)) {
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      // 注入热更新脚本
      const hotUpdateScript = `
<script>
  // 热更新脚本
  console.log('Hot update script loaded');
  
  let lastChecked = 0;
  
  // 检查更新
  function checkForUpdates() {
    console.log('Checking for updates...');
    fetch('/hot-update-status')
      .then(response => {
        console.log('Response received:', response.status);
        return response.json();
      })
      .then(data => {
        console.log('Update status:', data, 'lastChecked:', lastChecked);
        if (data.lastModified > lastChecked) {
          console.log('Update detected, refreshing page...');
          lastChecked = data.lastModified;
          window.location.reload();
        } else {
          console.log('No update detected');
        }
      })
      .catch(error => {
        console.error('Error checking for updates:', error);
      })
      .finally(() => {
        // 继续检查
        setTimeout(checkForUpdates, 3000); // 增加检查间隔，减少请求频率
      });
  }
  
  // 开始检查
  checkForUpdates();
</script>
`;
      content += hotUpdateScript;
      res.send(content);
      console.log('Hot update script injected into:', req.path);
    } catch (error) {
      console.error(`Error processing ${req.path}: ${error.message}`);
      res.sendFile(filePath);
    }
  } else {
    res.status(404).send('Not Found');
  }
});

// 静态文件服务
app.use(express.static(root));

// 监听文件变化
const watcher = chokidar.watch(root, {
  ignored: /node_modules/,
  persistent: true
});

watcher.on('change', (filePath) => {
  console.log(`File changed: ${filePath}`);
  lastModified = Date.now();
});

// 启动服务器
app.listen(port, () => {
  console.log(`Test server is running at http://localhost:${port}`);
});