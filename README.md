# Mikit-CLI 使用文档

## 项目介绍

Mikit-CLI 是一个基于 Node.js 的静态网站构建工具，替代传统的 MiKit 桌面应用，提供更灵活、更现代的前端开发和构建体验。

## 安装方法

### 全局安装
```bash
npm install -g mikit-cli
npm install -g file:F:\mikit-cli
```

### 本地安装
```bash
# 在项目目录中
npm install --save-dev mikit-cli
```

## 基本命令

### 初始化项目配置

在已有项目根目录执行：

```bash
mikit init
```

命令只会在当前目录生成 `package.json`，不会创建项目目录、页面、CSS 或 JavaScript 模板。生成的配置包含：

- `mikit replace`、`mikit pack`、`mikit sync-svn` 对应的 npm scripts。
- `mikit.replace`、`mikit.pack`、`mikit.syncSvn` 基础配置。
- CSS 文件配置默认使用 `include: ["**/*.css"]` 和 `files: ["*"]`。
- `replace.rules` 默认留空，需按项目填写替换规则。
- `syncSvn.target` 默认留空，需填写项目对应的 SVN CSS 目录。

如果当前目录已经存在 `package.json`，命令会报错退出并保留原文件，不会覆盖。原来的 `mikit init <project-name>` 项目模板功能已移除。

### 1. 启动开发服务器
```bash
mikit start [选项]
```

**选项：**
- `-p, --port <port>`: 服务器端口（默认：8080）
- `-r, --root <root>`: 根目录（默认：.）
- `-d, --domain <domain>`: 域名（默认：y.bindyy.cn）
- `-a, --alias <alias>`: 子域名别名映射配置文件
- `-v, --virtual <virtual>`: 虚拟目录映射（格式：/path:/physical/path）

**示例：**
```bash
mikit start --port 8084
mikit start --domain test.example.com
mikit start --virtual /demo:d:\ProgramFiles\Mikit
```

**同端口多项目示例：**
如果一个目录下有多个 MiKit 项目，每个项目都有自己的 `wwwroot` 目录，可以在这些项目的上级目录启动一个服务：
```bash
mikit start --port 8080 --root .
```

目录示例：
```text
workspace/
├── project-a/
│   └── wwwroot/
├── project-b/
│   └── wwwroot/
└── project-c/
    └── wwwroot/
```

启动后可使用同一个端口，通过不同子域名访问不同项目：
```text
http://project-a.y.bindyy.cn:8080
http://project-b.y.bindyy.cn:8080
http://project-c.y.bindyy.cn:8080
```

如果当前目录本身就是一个项目（当前目录下直接存在 `wwwroot`），则只加载当前项目。

**Alias 子域名映射模式：**
如果项目目录名包含中文、空格，或者项目不是标准的 `项目名/wwwroot` 结构，可以使用 alias 配置把子域名前缀映射到真实目录。这样不用调整原项目结构，也能保持同一个访问端口。

例如在 `F:\NDW` 下创建 `mikit.alias.json`：

```json
{
  "domain": "y.bindyy.cn",
  "port": 8080,
  "default": "wjms",
  "auto": [
    "【魔域】/2026/*/*/wwwroot",
    "【魔域】/*/*/wwwroot"
  ],
  "projects": {
    "wjms": "【魔域】/2026/0518 拉新召回/lxzh/wwwroot",
    "wb": "【魔域】/网吧/wb/wwwroot",
    "worldcup": "【魔域】/2026/0611 世界杯/worldcup"
  }
}
```

`auto` 会自动扫描符合规则的项目，不需要每个新项目都手动加到 `projects`。例如：

```text
【魔域】/2026/0518 拉新召回/lxzh/wwwroot
```

会自动生成子域名前缀：

```text
lxzh.y.bindyy.cn
```

`projects` 仍然可以保留，用来处理需要自定义别名、覆盖自动别名、或者目录不符合扫描规则的项目。

启动服务：

```bash
mikit start --port 8080 --root "F:\NDW" --alias "F:\NDW\mikit.alias.json"
```

启动后使用同一个端口访问：

```text
http://wjms.y.bindyy.cn:8080/index.shtml
http://wjms.y.bindyy.cn:8080/dist/
http://wb.y.bindyy.cn:8080/index.shtml
http://worldcup.y.bindyy.cn:8080/index.shtml
```

端口优先级：命令行 `--port` 优先，其次使用 alias 配置里的 `port`，最后默认 `8080`。

注意：
- `projects` 里的路径默认相对 `--root`。
- `auto` 支持 `*` 通配一级目录；服务会监听 alias 配置和自动扫描目录变化，新增项目或修改配置后通常不需要重启服务。
- `/index.shtml` 等普通路径访问映射项目的 `wwwroot`；`/dist/` 访问同项目的 `dist` 目录。
- `wwwroot` 页面会注入项目级热更新脚本；只有当前项目文件变化时才刷新，不会因为其他子域名项目变化而刷新。
- `/dist/` 只做构建产物预览，不注入热更新脚本。
- JSON 路径建议使用 `/`，不要写成 `\`，避免 `\2026`、`\0518` 被当作 JSON 转义字符。
- JSON 最后一项不能有尾逗号。
- 子域名需要能解析到本机，例如通过通配 DNS 或 hosts 配置到 `127.0.0.1`。

### 2. 构建项目
Mikit-CLI 提供四种构建命令，适用于不同场景：

| 命令 | 命令行 | 功能描述 |
|------|--------|----------|
| 基本构建 | `mikit build` | 处理所有文件，编译 SCSS 为 CSS，处理 SSI 指令，不进行压缩 |
| 完整压缩 | `mikit build --min` | 执行基本构建，并对 HTML、CSS、JS 进行压缩 |
| 仅压缩 CSS | `mikit build --mincss` | 执行基本构建，仅对 CSS 文件进行压缩 |
| 字体子集化 | `mikit build --minfont` | 构建后按 CSS 字体族提取字符并压缩本地字体 |

**构建选项：**
- `-o, --output <output>`: 输出目录（默认：dist）
- `--min`: 压缩所有文件
- `--minhtml`: 仅压缩 HTML
- `--mincss`: 仅压缩 CSS
- `--minjs`: 仅压缩 JS
- `--autoprefixer`: 添加 CSS 前缀
- `--minfont`: 构建完成后执行字体子集化
- `--font-page <page>`: 字体扫描页面或 glob（默认：font.html）
- `--font-manifest <directory>`: 字符清单目录（默认：../font）

### 3. 字体子集化

字体子集化读取最终 `dist` 中的 HTML 和 CSS，按实际 `font-family` 继承与覆盖关系为每个本地 TTF 生成独立字符清单，再输出 TTF、WOFF 和 WOFF2。该功能默认关闭。

构建并压缩字体：

```bash
mikit build --mincss --minfont
```

仅对已有 `dist` 执行字体处理：

```bash
mikit font
```

自定义扫描页面和字符清单位置：

```bash
mikit font --font-page "*.html" --font-manifest "../font"
```

默认行为：

- 优先扫描 `dist/font.html`；不存在时回退到 `dist` 根目录下的 HTML。
- 扫描 `dist/css` 下全部 CSS，并处理后代选择器、字体继承和子元素覆盖。
- 每个本地字体生成一个同名 TXT，例如 `font/nd.txt`。
- HTTPS 字体不会压缩；`dist/font` 中仅由 HTTPS 引用的同名字体会移动到 `dist/font/bak`。
- 没有提取到字符的字体保留空清单并跳过压缩。
- 原始本地 TTF 会备份到 `dist/font/bak`。

字体压缩依赖 Python fonttools，WOFF2 还需要 Brotli。这两个依赖不会随 `npm install -g mikit-cli` 自动安装，使用 `mikit build --minfont` 或 `mikit font` 前需要用户手动安装：

```bash
py -m pip install fonttools brotli
```

安装后需要确保 `pyftsubset` 可以从命令行直接执行。

如果不使用字体压缩功能，则不需要安装 Python、fonttools 或 Brotli，`mikit start`、普通 `mikit build`、`mikit replace`、`mikit pack`、`mikit sync-svn` 和 `mikit init` 均不受影响。

## 核心功能

### 1. SSI (Server Side Includes) 支持
自动处理 SSI 指令，包括：
- `<!--#include virtual="path" -->`
- `<!--#include file="path" -->`

### 2. SCSS 编译
- 自动将 SCSS 文件编译为 CSS
- 支持 `_` 前缀的部分文件（不会单独编译）
- 支持嵌套导入和变量

### 3. 热更新
- 使用 LiveReload 实现实时预览
- 支持 HTML、CSS、JS 文件的热更新
- 无需手动刷新浏览器

### 4. 构建优化
- 文件压缩（HTML、CSS、JS）
- CSS 自动前缀（通过 autoprefixer）
- 智能文件过滤（跳过 `_` 前缀文件）

### 5. 子域名匹配机制
- 支持通过子域名访问不同项目
- 默认使用项目文件夹名称生成子域名，例如 `project-a` 对应 `project-a.y.bindyy.cn`
- 多项目模式下，多个项目共用同一个服务端口
- 可通过 `--domain` 选项自定义域名

**使用方法：**
1. 确保访问域名能解析到本机 `127.0.0.1`。
   - 如果有通配 DNS，可以配置 `*.y.bindyy.cn -> 127.0.0.1`。
   - 如果使用 hosts 文件，需要逐个添加项目子域名，例如：`127.0.0.1 project-a.y.bindyy.cn`。
2. 在项目上级目录启动服务器：`mikit start --port 8080 --root .`
3. 通过 `http://项目文件夹名.y.bindyy.cn:端口` 访问项目。

**示例：**
- 项目目录：`test-mikit-cli`
- 访问 URL：`http://test-mikit-cli.y.bindyy.cn:8080`

**自定义域名示例：**
```bash
mikit start --port 8080 --root . --domain test.local
```

访问 URL：
```text
http://test-mikit-cli.test.local:8080
```

## 构建后处理命令

以下三个命令从当前项目的 `package.json` 顶层 `mikit` 字段读取配置：

```bash
mikit replace
mikit pack
mikit sync-svn
```

配置到项目的 `scripts` 后，也可以执行：

```bash
npm run replace
npm run pack
npm run sync:svn
```

三个命令都会直接执行实际操作，不提供预览或 `dry-run` 模式。

完整配置示例：

```json
{
  "scripts": {
    "mbuild": "mikit build --mincss",
    "replace": "mikit replace",
    "replace:dev": "set NODE_ENV=pp && npm run replace",
    "replace:build": "set NODE_ENV=production && npm run replace",
    "pack": "mikit pack",
    "sync:svn": "mikit sync-svn"
  },
  "mikit": {
    "replace": {
      "root": "dist",
      "include": ["**/*.css"],
      "rules": [
        {
          "from": "../img/origin/",
          "to": "https://image.99.com/my/activity/2026/08/hks/origin/"
        },
        {
          "from": "../img/",
          "to": "https://img9.99.com/my/activity/2026/08/hks/"
        },
        {
          "from": "../../font/",
          "to": {
            "default": "https://wjdown.99.com/games/my/2026/hks/font/",
            "production": "https://myvideo.99.com/games/my/2026/hks/font/"
          }
        },
        {
          "from": "../font/",
          "to": {
            "default": "https://wjdown.99.com/games/my/2026/hks/font/",
            "production": "https://myvideo.99.com/games/my/2026/hks/font/"
          }
        },
        { "from": "?#font-spider", "to": "" },
        {
          "from": "wjdown.99.com",
          "to": "myvideo.99.com",
          "env": "production"
        }
      ]
    },
    "pack": {
      "source": "wwwroot",
      "dist": "dist",
      "output": "packed",
      "pageDirs": [".", "include"],
      "assetDirs": ["js", "css"],
      "excludePages": ["*font*.shtml"]
    },
    "syncSvn": {
      "source": "dist/css",
      "target": "F:\\SVN\\【简体魔域】\\public\\2026\\08\\hks\\view\\css",
      "files": ["*"]
    }
  }
}
```

### `mikit replace`

- 只处理 `include` 命中的 CSS 文件，规则按数组顺序执行。
- `from` 使用普通字符串全量替换，不需要编写正则表达式。
- `to` 可以是字符串，也可以是环境对象；优先读取当前 `NODE_ENV`，没有对应项时使用 `default`。
- 规则配置 `env` 后只在对应环境执行；也可以配置成环境名称数组。
- 下列情况会跳过写入：CSS 文件未命中 `include`、规则的 `env` 与当前环境不一致，或执行全部规则后文件内容没有变化。

### `mikit pack`

- 从 `pageDirs` 复制直接位于目录中的 `.shtml` 文件。
- 将 `<!--#include virtual="include/_rule.shtml"-->` 转成 `<?#template "_rule.shtml" .?>`。
- 从 `dist` 递归复制 `assetDirs` 中的资源目录到 `output`。
- 每次打包前会清空整个 `output` 目录，再重新生成本次包，避免上一版残留文件。
- 清理前会先校验所有页面目录和资源目录；配置错误时保留旧包。
- `output` 必须是项目内的独立目录，不能是项目根目录，不能与 `source`/`dist` 重叠，也不能位于 `.git`、`.svn` 或 `node_modules` 中。

### `mikit sync-svn`

- `files: ["*"]` 或 `files: ["*.css"]` 表示同步 `source` 目录第一层的全部 CSS。
- 支持 `style*.css`、`phone.css` 等通配或明确文件名，多个规则可组合。
- 无论通配符如何配置，都不会同步非 CSS 文件。
- 内容相同的目标文件会跳过；复制后使用 SHA-256 校验。
- 目标必须是已经存在的 SVN 工作副本目录。命令只复制 CSS，不执行 `svn add`、`svn commit` 或删除操作。

## 项目结构

推荐的项目结构：
```
project/
├── wwwroot/
│   ├── css/            # CSS/SCSS 文件
│   │   ├── _reset.scss  # 部分文件（带 _ 前缀）
│   │   └── index.scss   # 主 SCSS 文件
│   ├── js/             # JavaScript 文件
│   ├── img/            # 图片文件
│   ├── include/        # SSI 包含文件
│   └── index.shtml      # 页面文件（支持 SSI）
└── package.json        # 项目配置
```

## 配置示例

### package.json 示例
```json
{
  "name": "test-project",
  "version": "1.0.0",
  "scripts": {
    "start": "mikit start --port 8084",
    "build": "mikit build",
    "build:minify": "mikit build --min",
    "build:minify-css": "mikit build --mincss"
  },
  "devDependencies": {
    "mikit-cli": "file:../mikit-cli"
  }
}
```

## 常见问题

### 1. 端口被占用
如果遇到端口被占用的错误，可以使用 `--port` 选项指定其他端口：
```bash
mikit start --port 8085
```

### 2. 热更新不生效
确保：
- 浏览器支持 LiveReload
- 没有防火墙阻止 LiveReload 端口（35730）
- 文件路径正确，没有特殊字符

### 3. SCSS 编译错误
检查 SCSS 语法是否正确，特别是嵌套和变量使用。

## 高级功能

### 1. 自定义构建配置
可以在 `package.json` 中配置构建选项，例如：
```json
"scripts": {
  "build:prod": "mikit build --min --autoprefixer"
}
```

### 2. 多环境构建
为不同环境创建不同的构建命令：
```json
"scripts": {
  "build:dev": "mikit build",
  "build:staging": "mikit build --mincss",
  "build:prod": "mikit build --min --autoprefixer"
}
```

## 总结

Mikit-CLI 提供了一套完整的静态网站开发和构建工具链，支持现代前端开发工作流。通过简单的命令行操作，可以实现从开发到构建的全流程管理，提高开发效率和项目质量。
