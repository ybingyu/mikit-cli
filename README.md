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

### 字体压缩依赖（可选）

只有使用 `mikit build --minfont` 或 `mikit font` 时才需要安装 Python fonttools 和 Brotli；普通构建及其他命令不需要这些依赖。

```bash
py -m pip install fonttools brotli
```

安装后需要确保 `pyftsubset` 可以从命令行直接执行。动态页面字符提取还需要本机已安装 Chrome 或 Edge。`playwright-core` 已登记为 `mikit-cli` 的 npm 依赖，会随全局或本地安装自动安装；它不是浏览器插件或 Codex 插件，只负责调用本机已有浏览器，不会额外下载浏览器。

## 基本命令

### 初始化项目配置

在已有项目根目录执行：

```bash
mikit init
```

命令只会在当前目录生成 `package.json`，不会创建项目目录、页面、CSS 或 JavaScript 模板。生成的配置包含：

- 固定生成构建、PNG 压缩、替换、打包和 SVN 同步所需的 12 个 npm scripts。
- `mikit.replace`、`mikit.pack`、`mikit.syncSvn`、`mikit.png`、`mikit.font` 基础配置。
- CSS 文件配置默认使用 `include: ["**/*.css"]` 和 `files: ["*"]`。
- `replace.rules` 默认包含一条 `disabled: false` 的资源地址替换示例，该规则会执行；请按项目修改示例地址。如果暂时不执行，可将 `disabled` 改为 `true`。
- `syncSvn.targets` 默认是空数组，需填写一个或多个项目对应的 SVN CSS 目录后才能执行 `mikit sync-svn`。

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
Mikit-CLI 提供多种构建方式，适用于不同场景：

| 命令 | 命令行 | 功能描述 |
|------|--------|----------|
| 基本构建 | `mikit build` | 处理所有文件，编译 SCSS 为 CSS，处理 SSI 指令，不进行压缩 |
| 完整压缩 | `mikit build --min` | 执行基本构建，并对 HTML、CSS、JS 进行压缩 |
| 仅压缩 CSS | `mikit build --mincss` | 执行基本构建，仅对 CSS 文件进行压缩 |
| 字体子集化 | `mikit build --minfont` | 构建后按 CSS 字体族提取字符并压缩本地字体 |
| 无损 PNG 压缩 | `mikit build --png` | 构建完成后递归压缩输出目录中的 PNG，保持像素无损 |

**构建选项：**
- `-o, --output <output>`: 输出目录（默认：dist）
- `--min`: 压缩所有文件
- `--minhtml`: 仅压缩 HTML
- `--mincss`: 仅压缩 CSS
- `--minjs`: 仅压缩 JS
- `--autoprefixer`: 添加 CSS 前缀
- `--png`: 构建完成后对实际输出目录执行严格无损 PNG 压缩
- `--minfont`: 构建完成后开启字体子集化。如果 `package.json` 配置了 `mikit.font.pages`，同一次字体处理会自动访问这些动态 URL，并与静态 HTML 字符合并，不需要额外增加命令行参数。
- `--font-page <page>`: 指定在构建输出目录中用于静态字符扫描的 HTML 页面或 glob（默认：`font.html`）。它只控制静态 HTML 输入，不用于填写动态 URL。
- `--font-manifest <directory>`: 指定字符清单 TXT 的输出目录（默认：`../font`，相对于项目根目录）。每个提取到字符的本地字体会生成一个同名 TXT，例如 `dist/font/title.ttf` 对应 `../font/title.txt`；该参数不改变压缩后字体文件仍输出到 `dist/font`。字符数为 0 的字体不会生成 TXT；如果目录中存在上一次生成的同名 TXT，也会删除该明确文件，避免保留过期字符清单。

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
- 静态 HTML 中的字面文本会保留，因此 `v-if`、`v-else-if`、`v-else`、`v-show`、隐藏面板、未打开弹窗和 `<template>` 中明确写出的各状态文字都可参与提取。
- 纯缩进、换行等格式化空白不算有效字符；普通文本内部的连续空白会归一为一个空格。
- 只有提取到至少 1 个字符的本地字体才会生成同名 TXT 清单、备份原始 TTF，并调用 `pyftsubset` 输出 TTF、WOFF、WOFF2。
- 某字体提取字符数为 0 时，不生成空 TXT，不调用 `pyftsubset`，不备份该字体，并删除上一次遗留的同名 TXT 以及构建输出中该字体同名的 TTF、WOFF、WOFF2，因此最终不会留下任何该字体文件。
- HTTPS 字体不会压缩；`dist/font` 中仅由 HTTPS 引用的同名字体会移动到 `dist/font/bak`。

#### 动态页面字符配置

`--minfont` 是构建时开启字体处理的开关，`mikit font` 用于处理已有的 `dist`；两者都会自动读取 `package.json` 的 `mikit.font.pages`。`--font-page` 只指定静态 HTML 扫描范围，动态 URL 不写在该参数中。

对于由 Vue/JavaScript、接口数据或 URL 查询参数渲染的文字，可以在项目 `package.json` 中明确列出需要访问的页面。下面的两个 URL 会按配置顺序分别采集，不需要把两个页面状态的文字手工复制到 SHTML：

```json
{
  "mikit": {
    "font": {
      "pages": [
        "http://font-demo.example.test:8080/index.shtml?o=1",
        "http://font-demo.example.test:8080/index.shtml?o=2"
      ],
      "waitFor": "#app",
      "wait": 1000,
      "timeout": 15000,
      "browserExecutable": ""
    }
  }
}
```

配置和提取边界：

- `pages` 必须是明确、有序的 HTTP/HTTPS URL 数组。Mikit 只访问列出的 URL，不猜测 `o` 等参数值，也不会自动点击按钮切换状态。
- 缺少 `mikit.font`、缺少 `pages` 或配置为空数组时，保持原来的纯静态扫描，不启动浏览器。
- 静态扫描负责保留模板中明确写出的全部按钮/面板状态；运行时扫描补充 Vue、JavaScript、接口或 query 参数实际渲染到 DOM 的文字，最后按字体族合并并去重。
- 运行时会读取 DOM 文本，包括隐藏 DOM 中的文字；忽略 `script`、`style`、`noscript`，不扫描 JavaScript 源码字符串，也不提取 `::before`/`::after` 生成内容。
- `/index.shtml?...` 会映射到 `dist/index.html` 参与静态补充；其他 `.shtml` 映射到同路径 `.html`，以 `/` 结尾的 URL 映射到 `index.html`。
- 每页先等待 `domcontentloaded`；配置 `waitFor` 时等待该 CSS 选择器挂载，再额外等待 `wait` 毫秒。单页导航和等待上限由 `timeout` 控制，不使用 `networkidle`。
- URL 对应的本地服务必须提前运行，例如先启动 `mikit start --port 8080`；字体命令不会自动启动服务。
- 任一配置页面访问或解析失败时，命令会在移动远程字体、备份本地字体、写入字符清单或替换字体文件之前终止，避免产出只包含部分页面字符的字体包。
- 浏览器查找顺序固定为：`browserExecutable` 明确路径、`MIKIT_BROWSER_EXECUTABLE` 环境变量、系统常见 Chrome/Edge 安装位置。`browserExecutable: ""` 表示继续自动查找。
- 这是一套 Mikit 内置工作流，不是 AI 猜字，也不需要为每个 URL 分别安装 Codex/浏览器插件；所有生产字符只来自构建后的 HTML/CSS、明确配置的 URL 和这些页面实际渲染出的 DOM。

字体依赖的安装命令和适用范围请查看文档开头的“字体压缩依赖（可选）”。

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

以下四个命令从当前项目的 `package.json` 顶层 `mikit` 字段读取配置：

```bash
mikit png
mikit replace
mikit pack
mikit sync-svn
```

配置到项目的 `scripts` 后，也可以执行：

```bash
npm run png
npm run replace
npm run pack
npm run sync:svn
```

四个命令都会直接执行实际操作，不提供预览或 `dry-run` 模式。

完整配置示例：

```json
{
  "scripts": {
    "mbuild": "mikit build --mincss",
    "mbuild:font": "mikit build --mincss --minfont",
    "png": "mikit png",
    "replace": "mikit replace",
    "replace:dev": "set NODE_ENV=pp &&  npm run replace",
    "replace:build": "set NODE_ENV=production &&  npm run replace",
    "dev": "npm run mbuild  && npm run replace:dev",
    "build": "npm run mbuild  && npm run replace:build",
    "pack": "mikit pack",
    "sync:svn": "mikit sync-svn",
    "dev:svn": "npm run dev && npm run sync:svn",
    "build:svn": "npm run build && npm run sync:svn"
  },
  "mikit": {
    "replace": {
      "root": "dist",
      "include": ["**/*.css"],
      "rules": [
        {
          "disabled": false,
          "from": "../img/",
          "to": "https://img9.99.com/my/activity/example/"
        },
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
      "targets": [
        "F:\\SVN\\【简体魔域】\\public\\2026\\08\\hks\\view\\css",
        "F:\\SVN\\【简体魔域】\\public\\2026\\08\\hks-h5\\view\\css"
      ],
      "files": ["*"]
    },
    "png": {
      "root": "dist",
      "level": "balanced",
      "exclude": []
    },
    "font": {
      "pages": [],
      "wait": 1000,
      "timeout": 15000
    }
  }
}
```

### `mikit replace`

- 只处理 `include` 命中的 CSS 文件，规则按数组顺序执行。
- `from` 使用普通字符串全量替换，不需要编写正则表达式。
- `to` 可以是字符串，也可以是环境对象；优先读取当前 `NODE_ENV`，没有对应项时使用 `default`。
- 规则配置 `disabled: true` 时会直接跳过；删除 `disabled` 或改为 `false` 后才会参与替换。`env` 只在对应环境执行，也可以配置成环境名称数组。
- 下列情况会跳过：规则设置了 `disabled: true`、规则的 `env` 与当前环境不一致、CSS 文件未命中 `include`，或执行全部有效规则后文件内容没有变化。

### `mikit pack`

- 从 `pageDirs` 复制直接位于目录中的 `.shtml` 文件。
- 将 `<!--#include virtual="include/_rule.shtml"-->` 转成 `<?#template "_rule.shtml" .?>`。
- 从 `dist` 递归复制 `assetDirs` 中的资源目录到 `output`。
- 每次打包前会清空整个 `output` 目录，再重新生成本次包，避免上一版残留文件。
- 清理前会先校验所有页面目录和资源目录；配置错误时保留旧包。
- `output` 必须是项目内的独立目录，不能是项目根目录，不能与 `source`/`dist` 重叠，也不能位于 `.git`、`.svn` 或 `node_modules` 中。


### `mikit png`

递归扫描 `mikit.png.root` 下扩展名为 `.png` 的文件（扩展名大小写不敏感），使用严格无损方式重新编码，并且只有输出确实更小时才覆盖原文件。压缩不会调用颜色量化接口，不减少实际颜色数量，也不会改变解码后的像素；允许在像素完全等价时优化位深、颜色类型、调色板和 PNG 行过滤方式。非关键 PNG 元数据不会被主动整体剥离。

配置示例：

```json
"png": {
  "root": "dist",
  "level": "balanced",
  "exclude": [
    "img/no-compress.png",
    "img/original/**",
    "**/sprite-*.png"
  ]
}
```

- `root`：独立执行 `mikit png` 时的扫描目录，默认是 `dist`。
- `exclude`：相对 `root` 的 glob 数组，可排除单张图片、目录或文件名模式；建议统一使用 `/`。
- `level`：只控制压缩时尝试的无损算法范围和耗时，不是画质参数：
  - `fast`：尝试较少的过滤方案，速度最快，文件通常稍大。
  - `balanced`：默认等级，在耗时与体积之间取平衡。
  - `max`：尝试全部受支持的过滤方案，耗时最高，但不保证每张图都比 `balanced` 更小。

独立压缩已有构建目录：

```powershell
mikit png
```

构建完成后压缩 PNG：

```powershell
mikit build --output custom-dist --png
```

`build --png` 会使用本次构建的实际输出目录（例如上面的 `custom-dist`），而不是 `mikit.png.root`；`level` 和 `exclude` 仍读取 `mikit.png`。如果缺少配置、目录不存在或某张 PNG 无法解析，命令会输出包含相对图片路径的错误并以非零状态退出。

与 TinyPNG 的区别：TinyPNG 通常通过颜色量化等有损方式换取更小体积，因此很多图片会比这里的严格无损结果更小。本功能不采用这种方式，三个等级都保持解码后像素完全一致；等级越高只代表尝试更多无损压缩方案，不代表降低画质。

### `mikit sync-svn`

- `targets` 接受一个或多个 SVN CSS 目录，同一套 `source` 和 `files` 会同步到每个目录。
- 旧项目仍可使用单字符串 `target`；`target` 和 `targets` 不能同时配置。
- 所有目标目录会在复制前统一校验；任一目录不存在时，不会向其他目录复制。
- 重复目标目录会按解析后的绝对路径去重。
- `files: ["*"]` 或 `files: ["*.css"]` 表示同步 `source` 目录第一层的全部 CSS。
- 支持 `style*.css`、`phone.css` 等通配或明确文件名，多个规则可组合。
- 无论通配符如何配置，都不会同步非 CSS 文件。
- 内容相同的目标文件会跳过；复制后使用 SHA-256 校验。
- 命令输出中的更新数和跳过数是所有目标目录的累计值。
- 目标必须是已经存在的 SVN 工作副本目录。命令只复制 CSS，不执行 `svn add`、`svn commit` 或删除操作。

旧版单目录配置仍然有效：

```json
"syncSvn": {
  "source": "dist/css",
  "target": "F:\\SVN\\【简体魔域】\\public\\2026\\08\\hks\\view\\css",
  "files": ["*"]
}
```

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
