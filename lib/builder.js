const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const htmlMinifier = require('html-minifier');
const CleanCSS = require('clean-css');
const Terser = require('terser');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const sass = require('node-sass');

// 构建项目
function build(options) {
  const outputDir = path.resolve(options.output || 'dist');
  let rootDir = path.resolve('./wwwroot');
  
  // 如果wwwroot目录不存在，使用当前目录
  if (!fs.existsSync(rootDir)) {
    console.warn('wwwroot directory not found, using current directory');
    rootDir = process.cwd();
  }
  
  // 清空输出目录
  fs.emptyDirSync(outputDir);
  
  // 复制文件
  copyFiles(rootDir, outputDir, options);
  
  if (options.minFont) {
    const { subsetFonts } = require('./font-subsetter');
    subsetFonts({
      projectDir: process.cwd(),
      sourceDir: rootDir,
      outputDir,
      fontPage: options.fontPage,
      fontManifest: options.fontManifest
    });
  }

  if (options.optimizePng) {
    const { optimizePngImages, formatPngSummary } = require('./png-optimizer');
    const summary = optimizePngImages({
      projectDir: process.cwd(),
      rootOverride: outputDir
    });
    console.log('[mikit png] 完成：' + formatPngSummary(summary));
  }

  console.log(`Build completed successfully: ${outputDir}`);
}

// 复制文件
function copyFiles(srcDir, destDir, options) {
  const files = glob.sync('**/*', {
    cwd: srcDir,
    ignore: [
      'node_modules/**',
      'dist/**',
      '.git/**',
      '*.log'
    ]
  });
  
  files.forEach(file => {
    const srcPath = path.join(srcDir, file);
    let destPath = path.join(destDir, file);
    
    // 排除 include/ 目录下带 _ 前缀的文件
    if ((file.startsWith('include/') || file.startsWith('include\\')) && path.basename(file).startsWith('_')) {
      return;
    }
    
    // 排除带 _ 前缀的 .shtml 文件
    if (path.basename(file).startsWith('_') && path.extname(file) === '.shtml') {
      return;
    }
    
    // 排除 css 目录下带 _ 前缀的文件
    if ((file.startsWith('css/') || file.startsWith('css\\')) && path.basename(file).startsWith('_')) {
      return;
    }
    
    if (fs.statSync(srcPath).isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
    } else {
      // 将 .shtml 后缀改为 .html
      if (path.extname(file) === '.shtml') {
        destPath = destPath.replace(/\.shtml$/, '.html');
      }
      processFile(srcPath, destPath, options, srcDir);
    }
  });
}

// 处理文件
function processFile(srcPath, destPath, options, rootDir) {
  const ext = path.extname(srcPath);
  
  // 对于非文本文件，直接复制
  if (!isTextFile(ext) && ext !== '.scss' && ext !== '.sass') {
    fs.copySync(srcPath, destPath);
    return;
  }
  
  let content;
  
  switch (ext) {
    case '.html':
    case '.shtml':
      content = fs.readFileSync(srcPath, 'utf8');
      // 处理SSI指令
      content = processSSI(content, path.dirname(srcPath), rootDir);
      if (options.minify || options.minifyHtml) {
        content = minifyHtml(content);
      }
      break;
    case '.css':
      content = fs.readFileSync(srcPath, 'utf8');
      if (options.autoprefixer) {
        content = addCssPrefixes(content);
      }
      if (options.minify || options.minifyCss) {
        content = minifyCss(content);
      }
      break;
    case '.js':
      content = fs.readFileSync(srcPath, 'utf8');
      if (options.minify || options.minifyJs) {
        content = minifyJs(content);
      }
      break;
    case '.scss':
    case '.sass':
      // 跳过带 _ 前缀的 Sass 文件
      if (path.basename(srcPath).startsWith('_')) {
        return;
      }
      // 编译Sass文件为CSS
      try {
        const result = sass.renderSync({
          file: srcPath,
          outputStyle: options.minify || options.minifyCss ? 'compressed' : 'expanded',
          includePaths: [path.dirname(srcPath)]
        });
        content = result.css.toString();
        
        // 应用自动前缀
        if (options.autoprefixer) {
          content = addCssPrefixes(content);
        }
        
        // 修改目标路径为CSS文件
        destPath = destPath.replace(/\.(scss|sass)$/, '.css');
      } catch (error) {
        console.error(`Sass compilation error: ${error.message}`);
        return;
      }
      break;
    default:
      // 其他文本文件直接复制
      content = fs.readFileSync(srcPath, 'utf8');
      break;
  }
  
  if (content !== undefined) {
    // 确保目标目录存在
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.writeFileSync(destPath, content);
  }
}

// 检查是否为文本文件
function isTextFile(ext) {
  const textExts = ['.html', '.shtml', '.css', '.js', '.json', '.xml', '.txt', '.md'];
  return textExts.includes(ext);
}

// 处理SSI指令
function processSSI(content, baseDir, rootDir) {
  // 匹配SSI include指令
  const includeRegex = /<!--\s*#?\s*include\s+(virtual|file)="([^"]+)"\s*-->/g;
  return content.replace(includeRegex, (match, type, includePath) => {
    const isRootRelative = /^[/\\]/.test(includePath);
    const normalizedPath = includePath.replace(/^[/\\]+/, '');
    const includeFilePath = type === 'virtual' && isRootRelative
      ? path.join(rootDir, normalizedPath)
      : path.resolve(baseDir, includePath);
    
    if (fs.existsSync(includeFilePath)) {
      try {
        const includeContent = fs.readFileSync(includeFilePath, 'utf8');
        // 递归处理include文件中的SSI指令
        return processSSI(includeContent, path.dirname(includeFilePath), rootDir);
      } catch (error) {
        console.error(`Error reading include file ${includeFilePath}: ${error.message}`);
        return match; // 返回原始指令
      }
    } else {
      console.warn(`Include file not found: ${includeFilePath}`);
      return match; // 返回原始指令
    }
  });
}

// 压缩HTML
function minifyHtml(html) {
  return htmlMinifier.minify(html, {
    removeComments: true,
    removeCommentsFromCDATA: true,
    collapseWhitespace: true,
    conservativeCollapse: false,
    removeAttributeQuotes: true,
    useShortDoctype: true,
    removeEmptyAttributes: true,
    removeEmptyElements: false,
    removeOptionalTags: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    minifyCSS: true,
    minifyJS: true
  });
}

// 压缩CSS
function minifyCss(css) {
  const cleaner = new CleanCSS();
  return cleaner.minify(css).styles;
}

// 压缩JS
function minifyJs(js) {
  try {
    const result = Terser.minify(js);
    if (result.error) {
      console.error(`JS minification error: ${result.error}`);
      return js; // 出错时返回原始内容
    }
    return result.code || js;
  } catch (error) {
    console.error(`JS minification error: ${error.message}`);
    return js;
  }
}

// 添加CSS前缀
function addCssPrefixes(css) {
  try {
    const result = postcss([autoprefixer]).process(css, { from: undefined });
    return result.css;
  } catch (error) {
    console.error(`CSS autoprefixer error: ${error.message}`);
    return css; // 出错时返回原始内容
  }
}

module.exports = {
  build
};
