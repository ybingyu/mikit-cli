#!/usr/bin/env node

const program = require('commander');

// 版本信息
program
  .version('1.0.0')
  .description('Npm-based alternative to MiKit desktop app');

// 初始化当前项目的 package.json
program
  .command('init')
  .allowExcessArguments(false)
  .description('Create package.json with Mikit workflow config in current directory')
  .action(() => {
    runWorkflowCommand('init', () => {
      const { createInitialPackageJson } = require('../lib/project-initializer');
      const result = createInitialPackageJson(process.cwd());
      console.log('[mikit init] 已生成：' + result.packagePath);
    });
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
  .option('--minfont', 'Subset local fonts using built HTML and CSS', false)
  .option('--font-page <page>', 'Override automatic SHTML scan with built HTML page or glob')
  .option('--font-manifest <directory>', 'Font manifest directory relative to project', 'font')
  .action((options) => {
    runWorkflowCommand('build', () => {
      const builder = require('../lib/builder');
      builder.build({
        output: options.output,
        minify: options.min,
        minifyHtml: options.minhtml,
        minifyCss: options.mincss,
        minifyJs: options.minjs,
        optimizePng: options.png,
        autoprefixer: options.autoprefixer,
        minFont: options.minfont,
        fontPage: options.fontPage,
        fontManifest: options.fontManifest
      });
    });
  });


// 按配置量化或严格无损压缩 PNG 图片
program
  .command('png')
  .description('Optimize PNG images using package.json mikit.png config')
  .action(() => {
    runWorkflowCommand('png', () => {
      const { optimizePngImages, formatPngSummary } = require('../lib/png-optimizer');
      const summary = optimizePngImages({ projectDir: process.cwd() });
      console.log('[mikit png] 完成：' + formatPngSummary(summary));
    });
  });

// 替换构建后 CSS 资源地址
program
  .command('replace')
  .description('Replace built CSS assets using package.json mikit.replace config')
  .action(() => {
    runWorkflowCommand('replace', () => {
      const { replaceCssAssets } = require('../lib/css-replacer');
      const summary = replaceCssAssets({ projectDir: process.cwd() });
      console.log(
        '[mikit replace] 完成：处理 ' + summary.files +
        ' 个 CSS，更新 ' + summary.changed + ' 个，环境 ' + summary.env + '。'
      );
    });
  });

// 打包 Go 模板和构建资源
program
  .command('pack')
  .description('Pack SHTML as Go templates using package.json mikit.pack config')
  .action(() => {
    runWorkflowCommand('pack', () => {
      const { packGoTemplates } = require('../lib/go-packer');
      const summary = packGoTemplates({ projectDir: process.cwd() });
      console.log(
        '[mikit pack] 完成：已清空旧输出，页面 ' + summary.pages +
        ' 个，资源 ' + summary.assets + ' 个。'
      );
    });
  });

// 同步构建后的 CSS 到 SVN 工作副本
program
  .command('sync-svn')
  .description('Sync built CSS to an SVN working copy using package.json config')
  .action(() => {
    runWorkflowCommand('sync-svn', () => {
      const { syncCssToSvn } = require('../lib/svn-css-sync');
      const summary = syncCssToSvn({ projectDir: process.cwd() });
      console.log(
        '[mikit sync-svn] 完成：目标 ' + summary.targets.length +
        ' 个，更新 ' + summary.copied +
        ' 个，跳过 ' + summary.skipped + ' 个。'
      );
    });
  });

// 独立字体压缩命令
program
  .command('font')
  .description('Subset local fonts from built HTML and CSS')
  .option('-o, --output <output>', 'Build output directory (default: dist)', 'dist')
  .option('--font-page <page>', 'Override automatic SHTML scan with built HTML page or glob')
  .option('--font-manifest <directory>', 'Font manifest directory relative to project', 'font')
  .action((options) => {
    runWorkflowCommand('font', () => {
      const { subsetFonts } = require('../lib/font-subsetter');
      subsetFonts({
        projectDir: process.cwd(),
        output: options.output,
        fontPage: options.fontPage,
        fontManifest: options.fontManifest
      });
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

function runWorkflowCommand(name, action) {
  try {
    action();
  } catch (error) {
    console.error('[mikit ' + name + '] ' + error.message);
    process.exitCode = 1;
  }
}
