#!/usr/bin/env node

const program = require('commander');
const path = require('path');
const fs = require('fs-extra');

// 版本信息
program
  .version('1.0.0')
  .description('Npm-based alternative to MiKit desktop app');

// 初始化项目命令
program
  .command('init <project-name>')
  .description('Create a new project with template')
  .option('-t, --template <template>', 'Template name (default, mobile)', 'default')
  .action((projectName, options) => {
    const projectPath = path.join(process.cwd(), projectName);
    
    // 检查目录是否存在
    if (fs.existsSync(projectPath)) {
      console.error('Error: Directory already exists');
      process.exit(1);
    }
    
    // 创建目录
    fs.mkdirSync(projectPath, { recursive: true });
    
    // 根据模板创建项目结构
    createProjectFromTemplate(projectPath, options.template);
    
    console.log(`Project ${projectName} created successfully!`);
  });

// 启动开发服务器命令
program
  .command('start')
  .description('Start local development server')
  .option('-p, --port <port>', 'Server port (default: 8080)')
  .option('-r, --root <root>', 'Root directory (default: .)', '.')
  .option('-d, --domain <domain>', 'Domain name (default: y.bindyy.cn)', 'y.bindyy.cn')
  .option('-a, --alias <alias>', 'Alias config file for subdomain project mapping')
  .option('-v, --virtual <virtual>', 'Virtual directory mapping (format: /path:/physical/path)', (value, previous) => {
    const mappings = previous || {};
    // 查找第一个冒号的位置，处理Windows路径中的冒号
    const colonIndex = value.indexOf(':');
    if (colonIndex > 0) {
      const path = value.substring(0, colonIndex);
      const physicalPath = value.substring(colonIndex + 1);
      mappings[path] = physicalPath;
    }
    return mappings;
  }, {})
  .action((options) => {
    const server = require('../lib/server');
    server.start({
      port: options.port,
      root: options.root,
      domain: options.domain,
      alias: options.alias,
      virtual: options.virtual
    });
  });

// 构建项目命令
program
  .command('build')
  .description('Build project for production')
  .option('-o, --output <output>', 'Output directory (default: dist)', 'dist')
  .option('--min', 'Minify files', false)
  .option('--minhtml', 'Minify HTML', false)
  .option('--mincss', 'Minify CSS', false)
  .option('--minjs', 'Minify JS', false)
  .option('--png', 'Optimize PNG images', false)
  .option('--autoprefixer', 'Add CSS prefixes', false)
  .action((options) => {
    const builder = require('../lib/builder');
    builder.build({
      output: options.output,
      minify: options.min,
      minifyHtml: options.minhtml,
      minifyCss: options.mincss,
      minifyJs: options.minjs,
      optimizePng: options.png,
      autoprefixer: options.autoprefixer
    });
  });

// 服务命令（别名）
program
  .command('serve')
  .description('Start local development server (alias for start)')
  .option('-p, --port <port>', 'Server port (default: 8080)')
  .option('-r, --root <root>', 'Root directory (default: .)', '.')
  .option('-d, --domain <domain>', 'Domain name (default: y.bindyy.cn)', 'y.bindyy.cn')
  .option('-a, --alias <alias>', 'Alias config file for subdomain project mapping')
  .option('-v, --virtual <virtual>', 'Virtual directory mapping (format: /path:/physical/path)', (value, previous) => {
    const mappings = previous || {};
    // 查找第一个冒号的位置，处理Windows路径中的冒号
    const colonIndex = value.indexOf(':');
    if (colonIndex > 0) {
      const path = value.substring(0, colonIndex);
      const physicalPath = value.substring(colonIndex + 1);
      mappings[path] = physicalPath;
    }
    return mappings;
  }, {})
  .action((options) => {
    const server = require('../lib/server');
    server.start({
      port: options.port,
      root: options.root,
      domain: options.domain,
      alias: options.alias,
      virtual: options.virtual
    });
  });

// 监视命令
program
  .command('watch')
  .description('Watch files for changes and rebuild')
  .option('-r, --root <root>', 'Root directory (default: .)', '.')
  .action((options) => {
    console.log('Watch mode is not yet implemented');
  });

// 帮助命令
program
  .command('help')
  .description('Display help information')
  .action(() => {
    program.outputHelp();
  });

// 解析命令行参数
program.parse(process.argv);

// 如果没有指定命令，显示帮助
if (!program.args.length) {
  program.outputHelp();
}

// 创建项目模板
function createProjectFromTemplate(projectPath, template) {
  // 简单的模板结构
  const templates = {
    default: {
      'wwwroot/index.html': `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <h1>Hello World!</h1>
    <script src="js/script.js"></script>
</body>
</html>`,
      'wwwroot/css/style.css': `body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 20px;
}

h1 {
    color: #333;
}`,
      'wwwroot/js/script.js': `console.log('Hello World!');`,
      'package.json': `{
  "name": "${path.basename(projectPath)}",
  "version": "1.0.0",
  "description": "",
  "scripts": {
    "start": "mikit start",
    "build": "mikit build",
    "serve": "mikit serve",
    "watch": "mikit watch"
  },
  "devDependencies": {
    "mikit-cli": "file:../mikit-cli"
  }
}`
    },
    mobile: {
      'wwwroot/index.html': `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Mobile Project</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <h1>Hello Mobile!</h1>
    <script src="js/script.js"></script>
</body>
</html>`,
      'wwwroot/css/style.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    color: #333;
}

h1 {
    font-size: 1.8rem;
    margin: 20px;
}`,
      'wwwroot/js/script.js': `console.log('Hello Mobile!');`,
      'package.json': `{
  "name": "${path.basename(projectPath)}",
  "version": "1.0.0",
  "description": "",
  "scripts": {
    "start": "mikit start",
    "build": "mikit build",
    "serve": "mikit serve",
    "watch": "mikit watch"
  },
  "devDependencies": {
    "mikit-cli": "file:../mikit-cli"
  }
}`
    }
  };

  const selectedTemplate = templates[template] || templates.default;

  // 创建文件
  Object.keys(selectedTemplate).forEach(filePath => {
    const fullPath = path.join(projectPath, filePath);
    const directory = path.dirname(fullPath);
    
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, selectedTemplate[filePath]);
  });
}
