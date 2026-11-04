const { createDirectoryExclusion } = require('./directory-exclusion');
const path = require('node:path');
const { isPathWithin, pathsOverlap, resolveRealPath, isProtectedPath } = require('./path-safety');
const fs = require('fs-extra');
const glob = require('glob');
const htmlMinifier = require('html-minifier');
const CleanCSS = require('clean-css');
const Terser = require('terser');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const { compileSassFile } = require('./sass-compiler');
const { readAliasConfig } = require('./projectMatcher');
const { cleanBuildOutput } = require('./build-output');

function normalizeAuthor(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readProjectAuthor(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isFile()) return '';

  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, ''));
    return normalizeAuthor(packageJson.mikit && packageJson.mikit.author);
  } catch (error) {
    return '';
  }
}

function formatCompileDate(date) {
  const pad = value => String(value).padStart(2, '0');
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') +
    ' ' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
}

function createBuildAttribution(projectDir) {
  const projectAuthor = readProjectAuthor(projectDir);
  const aliasConfig = readAliasConfig(projectDir, undefined, { silent: true });
  const globalAuthor = aliasConfig ? normalizeAuthor(aliasConfig.author) : '';
  if (!projectAuthor && !globalAuthor) return null;

  return {
    author: projectAuthor || globalAuthor,
    editor: projectAuthor && globalAuthor ? globalAuthor : '',
    compileDate: formatCompileDate(new Date())
  };
}

function createAttributionHeader(attribution) {
  const lines = ['/*', ` * Author: ${attribution.author}`];
  if (attribution.editor) lines.push(` * Editor: ${attribution.editor}`);
  lines.push(` * Compile Date: ${attribution.compileDate}`, ' */', '');
  return lines.join('\n');
}

// 构建项目
function build(options = {}) {
  const projectDir = process.cwd();
  const attribution = createBuildAttribution(projectDir);
  if (!attribution) {
    console.warn('[mikit build] 提醒：项目作者和全局作者均未配置，已跳过 CSS、JS 作者注释。');
  }
  const outputDir = path.resolve(options.output || 'dist');
  let rootDir = path.resolve('./wwwroot');
  
  // 如果wwwroot目录不存在，使用当前目录
  if (!fs.existsSync(rootDir)) {
    console.warn('wwwroot directory not found, using current directory');
    rootDir = process.cwd();
  }
  
  if (!fs.statSync(rootDir).isDirectory()) throw new Error('页面源目录不是目录：' + rootDir);
  for (const [project, source, output] of [
    [projectDir, rootDir, outputDir],
    [resolveRealPath(projectDir), resolveRealPath(rootDir), resolveRealPath(outputDir)]
  ]) {
    if (isPathWithin(output, project) || isPathWithin(output, source) ||
        (source !== project && pathsOverlap(output, source)) || isProtectedPath(project, output)) {
      throw new Error('输出目录不能与源码、项目根目录重叠或位于受保护目录中：' + outputDir);
    }
  }

  // 校验保留目录后清理输出，后续构建始终跳过保留树。
  const excludedDirectories = cleanBuildOutput(projectDir, outputDir);
  const { isExcluded } = createDirectoryExclusion(excludedDirectories);
  
  // 复制文件
  copyFiles(rootDir, outputDir, { ...options, attribution, excludedDirectories });
  
  if (options.minFont && !isExcluded(path.join(outputDir, 'font'))) {
    const { subsetFonts } = require('./font-subsetter');
    subsetFonts({
      projectDir: process.cwd(),
      sourceDir: rootDir,
      outputDir,
      excludedDirectories,
      fontPage: options.fontPage,
      fontManifest: options.fontManifest
    });
  }

  if (options.optimizePng) {
    const { optimizePngImages, formatPngSummary, reportPngFailures } = require('./png-optimizer');
    const summary = optimizePngImages({
      projectDir: process.cwd(),
      rootOverride: outputDir,
      excludedDirectories
    });
    reportPngFailures(summary, 'build');
    console.log('[mikit png] 完成：' + formatPngSummary(summary));
  }

  console.log(`Build completed successfully: ${outputDir}`);
}

// 复制文件
function copyFiles(srcDir, destDir, options) {
  const realDestDir = resolveRealPath(destDir);
  const { isExcluded, hasExcludedDescendant, globIgnore } = createDirectoryExclusion(options.excludedDirectories);
  const files = glob.sync('**/*', {
    cwd: srcDir,
    ignore: globIgnore(['node_modules/**', 'dist/**', '.git/**', '*.log'],
      file => path.resolve(destDir, path.relative(srcDir, file)))
  });
  
  files.forEach(file => {
    const srcPath = path.join(srcDir, file);
    if (isExcluded(path.join(destDir, file))) return;
    if (isPathWithin(destDir, srcPath) || isPathWithin(realDestDir, resolveRealPath(srcPath))) return;
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
      // 同时检查编译后的文件名，避免写入同名的保留目录。
      destPath = destPath.replace(/\.(scss|sass)$/, '.css');
      if (isExcluded(destPath) || hasExcludedDescendant(destPath)) return;
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
        content = minifyJs(content, srcPath);
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
        content = compileSassFile(srcPath, {
          compressed: options.minify || options.minifyCss,
          loadPaths: [path.dirname(srcPath)]
        });
        
        // 应用自动前缀
        if (options.autoprefixer) {
          content = addCssPrefixes(content);
        }
        
        // 修改目标路径为CSS文件
        destPath = destPath.replace(/\.(scss|sass)$/, '.css');
      } catch (error) {
        throw new Error('Sass 编译失败（' + srcPath + '）：' + error.message);
      }
      break;
    default:
      // 其他文本文件直接复制
      content = fs.readFileSync(srcPath, 'utf8');
      break;
  }
  
  const outputExt = path.extname(destPath).toLowerCase();
  if (content !== undefined && options.attribution && (outputExt === '.css' || outputExt === '.js')) {
    content = createAttributionHeader(options.attribution) + content.replace(/^\uFEFF/, '');
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
function minifyJs(js, srcPath) {
  try {
    const result = Terser.minify_sync(js);
    if (result.error) throw result.error;
    return result.code;
  } catch (error) {
    throw new Error('JS 压缩失败（' + srcPath + '）：' + error.message);
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
