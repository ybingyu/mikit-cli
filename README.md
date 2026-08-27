# Mikit-CLI 使用文档

## 项目介绍

Mikit-CLI 是一个基于 Node.js 的静态网站构建工具，替代传统的 MiKit 桌面应用，提供更灵活、更现代的前端开发和构建体验。

## 安装方法

### 安装 Mikit-CLI

下面三种方式按使用场景选择一种，不需要重复安装。

**方式一：从 npm 全局安装发布版本**

```bash
npm install -g mikit-cli
```

**方式二：在 Windows 上把本地源码目录安装为全局命令**

新克隆的源码必须先安装项目依赖，再建立全局命令链接：

```powershell
Set-Location "F:\mikit-cli"
npm ci
npm install -g "file:F:\mikit-cli"
mikit --help
```

`npm ci` 会严格按照 `package-lock.json` 把运行依赖安装到源码目录的 `node_modules`。`npm install -g "file:..."` 适合开发或调试，它建立的是指向源码目录的全局链接，不会代替源码目录安装依赖；如果跳过 `npm ci`，运行时可能出现 `Cannot find module 'commander'`。源码修改后，全局 `mikit` 会继续指向该本地目录。

**方式三：作为项目开发依赖安装**

```bash
npm install --save-dev mikit-cli
```

本地依赖通常通过项目的 npm scripts 调用，例如 `npm run build`；也可以使用 `npx mikit --help`。

### 字体子集化依赖（仅字体功能需要）

只有使用 `mikit build --minfont` 或 `mikit font` 时才需要 Python 依赖。每个有效字体固定生成 TTF、WOFF、WOFF2，因此建议一次安装 `fonttools` 和 `brotli`：

```powershell
py -m pip install fonttools brotli
pyftsubset --help
```

- `fonttools` 提供字体裁剪命令 `pyftsubset`。
- `brotli` 用于生成 WOFF2。
- 普通构建、开发服务器、PNG、替换、打包和 SVN 同步不需要这些 Python 包。
- 只有 `package.json` 中 `mikit.font.pages` 非空、需要动态 URL 提取时，才需要本机安装 Chrome 或 Edge。
- `playwright-core` 是 Mikit-CLI 的 npm 依赖，会随 Mikit-CLI 自动安装；它不是浏览器插件或 Codex 插件，也不会下载浏览器，只负责驱动本机已有的 Chrome/Edge。

### 安装 Codex Skill（可选）

`skills/mikit-workflow` 为 Codex 提供自然语言编排层，实际启动、构建、字体裁剪、PNG 压缩、CSS 替换、打包和 SVN 同步仍由 Mikit-CLI 执行。安装 Skill 不能替代上面的 CLI 安装。

在 Mikit-CLI 源码仓库根目录首次安装：

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$skillDest = Join-Path $codexHome "skills\mikit-workflow"
if (Test-Path -LiteralPath $skillDest) {
  throw "Skill 已存在，请先确认现有版本：$skillDest"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillDest) | Out-Null
Copy-Item -LiteralPath ".\skills\mikit-workflow" -Destination $skillDest -Recurse
```

安装后在下一轮 Codex 对话中可以直接描述需求，例如：

- “帮我给当前项目接入 Mikit。”
- “构建并压缩 CSS 和 PNG。”
- “检查配置后把 CSS 同步到 SVN。”
- “使用 `$mikit-workflow` 处理当前项目的字体子集化。”

Skill 会先检查项目和配置，缺少必要路径、地址或运行环境时会询问，不会自行猜测。仓库同步到 GitHub 后，也可以通过 Codex 的 GitHub Skill 安装方式直接安装 `skills/mikit-workflow` 子目录。

## 基本命令

### 命令速查

| 命令 | 用途 |
|------|------|
| `mikit init` | 在当前目录生成带 Mikit 工作流配置的 `package.json` |
| `mikit start` | 启动本地开发服务器 |
| `mikit build` | 从 `wwwroot` 构建生产文件；例如 `mikit build --mincss`（压缩 CSS）、`mikit build --mincss --minfont`（同时处理字体）、`mikit build --output custom-dist --png`（自定义输出并压缩 PNG） |
| `mikit font` | 直接处理已有构建输出中的本地字体 |
| `mikit png` | 按 `mikit.png` 配置压缩 PNG；默认使用 Imagine 风格的 256 色量化，也可切换严格无损 |
| `mikit replace` | 按 `mikit.replace` 配置替换构建后 CSS 内容 |
| `mikit pack` | 按 `mikit.pack` 配置打包 SHTML 和资源 |
| `mikit sync-svn` | 按 `mikit.syncSvn` 配置同步 CSS 到 SVN 工作副本 |

使用 `mikit --help` 查看全部命令，使用 `mikit <command> --help` 查看命令选项。

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
- `mikit.png` 默认生成 `mode: "quantize"` 和 `colors: 256`；如需原有严格无损压缩，改为 `mode: "lossless"`。

`init` 实际生成的字体配置是：

```json
"font": {
  "pages": [],
  "wait": 1000,
  "timeout": 15000
}
```

其中 `pages: []` 表示只做静态 HTML/CSS 扫描，不启动浏览器。`waitFor` 和 `browserExecutable` 是受支持的可选字段，但 `init` 默认不生成，需要动态页面等待或指定浏览器时再手动添加。

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
| 基本构建 | `mikit build` | 复制和处理文件，编译 SCSS、展开 SSI，不进行压缩 |
| 完整压缩 | `mikit build --min` | 执行基本构建，并对 HTML、CSS、JS 进行压缩 |
| 仅压缩 CSS | `mikit build --mincss` | 执行基本构建，仅压缩 CSS |
| 字体子集化 | `mikit build --minfont` | 构建后按字体族提取字符并裁剪本地 TTF |
| PNG 压缩 | `mikit build --png` | 构建后递归压缩输出目录中的 PNG；默认量化到最多 256 色，可配置为严格无损 |

**构建选项：**

- `-o, --output <output>`：输出目录（默认：`dist`）。构建开始时会清空该输出目录。
- `--min`：压缩 HTML、CSS、JS。
- `--minhtml`：仅压缩 HTML。
- `--mincss`：仅压缩 CSS。
- `--minjs`：仅压缩 JavaScript。
- `--autoprefixer`：为 CSS 添加浏览器前缀。
- `--png`：构建后对本次实际输出目录执行 PNG 压缩；默认使用 Imagine/pngquant 风格的 256 色量化，具体模式读取 `mikit.png`。
- `--minfont`：构建后开启字体子集化；如果 `mikit.font.pages` 非空，会在同一次处理中自动访问动态 URL。
- `--font-page <page>`：覆盖默认的 SHTML 自动扫描，指定相对构建输出目录的静态 HTML 页面或 glob，例如 `pages/*.html`、`**/*.html`。不传时会递归扫描 `wwwroot` 中所有非 `_` 开头的 `.shtml` 对应构建页面；它不用于填写动态 URL。
- `--font-manifest <directory>`：指定字符清单 TXT 的输出目录（默认：`font`，相对项目根目录解析），不改变字体文件的输出位置。例如项目为 `D:\site` 时，默认目录是 `D:\site\font`，与 `wwwroot`、`dist` 同级；可传入 `font-manifests` 将清单输出到 `D:\site\font-manifests`。

### 3. 字体子集化

字体子集化读取**实际构建输出目录**中的 HTML、CSS 和 `font` 目录。默认输出是 `dist`；使用 `--output custom-dist` 时，字体输入和输出也改为 `custom-dist`，不是固定读取 `dist`。该功能默认关闭。

构建并处理字体：

```bash
mikit build --mincss --minfont
mikit build --output custom-dist --mincss --minfont
```

直接处理已有构建输出：

```bash
mikit font
mikit font --output custom-dist
```

覆盖自动扫描页面，并自定义字符清单目录：

```bash
mikit font --font-page "**/*.html" --font-manifest "font-manifests"
```

> `mikit font` 会直接修改已有构建输出中的字体文件。原始字体以 `wwwroot/font` 为准；构建输出中不再创建 `font/bak`，需要恢复时重新构建即可。

#### 字体输入、映射和输出规则

- 构建输出中必须存在 `font` 目录，否则命令报错。CSS 从同一输出目录的 `css` 目录递归扫描。
- 只处理同时满足以下条件的字体：文件是 `.ttf`、位于输出目录的 `font` 第一层、并且被 CSS 的本地 `url(...)` 引用。仅把 TTF 放进 `font`、但没有本地 CSS 引用时不会处理。
- `@font-face` 的 `font-family` 用于把 CSS 字体族映射到实际字体文件；没有映射时回退到 TTF 文件名。`font-family` 有多个候选值时，只使用列表中的第一个字体族。
- CSS 中的 HTTP/HTTPS 远程字体不做子集化。若输出目录的 `font` 中存在仅由远程 URL 引用的同名字体文件，会直接从构建输出移除；同名字体同时存在本地引用时按本地字体处理。
- 每个字体分别合并和去重字符，不会把所有字体共用一份字符清单。
- 提取到至少 1 个字符时：生成同名 TXT，并输出同名 TTF、WOFF、WOFF2；不会在构建输出中备份原始 TTF。
- 提取字符为 0 时：不生成 TXT、不调用 `pyftsubset`，并删除字符清单目录中的遗留同名 TXT，以及构建输出字体目录中的遗留同名 TTF、WOFF、WOFF2；因此本次构建不会输出该字体的三种格式。

#### 静态 HTML 提取规则

- 默认递归发现 `wwwroot/**/*.shtml`，排除任意目录下文件名以 `_` 开头的页面，再扫描它们在构建输出中的同路径 `.html`。例如 `wwwroot/index.shtml` 映射为 `dist/index.html`，`wwwroot/pages/list.shtml` 映射为 `dist/pages/list.html`；`wwwroot/include/_pop.shtml` 不会作为独立页面扫描。
- 不再要求专门维护 `font.shtml`。所有符合上述规则的 SHTML 页面都会纳入扫描；页面文字只有匹配到目标字体的 CSS `font-family`（包括继承）时，才会写入该字体的字符清单。
- 如果项目没有可发现的源 SHTML（例如只有构建输出），会递归扫描输出目录中的 `**/*.html`，并排除文件名以 `_` 开头的 HTML。
- `--font-page` 支持明确文件和 glob，例如 `index.html`、`pages/*.html`、`**/*.html`；传入后用于覆盖默认 SHTML 自动发现。指定模式没有匹配结果时，仍按兼容规则回退扫描输出目录根层的 `*.html`。匹配结果和动态 URL 映射出的本地 HTML 会去重后共同扫描。
- 静态 CSS 匹配是轻量实现，不是完整浏览器 CSS 引擎。当前支持标签、ID、class、后代选择器、子选择器、字体继承、规则顺序、选择器优先级、`!important` 和内联 `font-family`；不应依赖复杂属性选择器或兄弟选择器进行字体识别。
- HTML 中明确写出的字面文本都会参与扫描，包括 `v-if`、`v-else-if`、`v-else`、`v-show`、隐藏面板、未打开弹窗和 `<template>` 中的各状态文字。
- Vue 的 `{{ ... }}` 插值表达式会整体忽略，避免把变量名和语法符号误当成页面字符。例如：

```html
<p>封魔之力达{{fmzl[user.user_type]}} <b>好运次数+2</b></p>
```

静态扫描只提取字面内容 `封魔之力达 好运次数+2`，不会提取 `fmzl`、`user_type`、`{{`、`[]`、`.` 等表达式内容。插值运行后显示的数字或文字，只能通过 `mikit.font.pages` 的动态页面结果补充；未配置动态 URL 时 Mikit 不会猜测运行值。

- 纯缩进、换行等格式化空白不算有效字符；普通文本内部的连续空白归一为一个空格。
- 静态扫描忽略 `script` 和 `style` 元素内容，也不从 HTML 属性值中提取文字。

#### 动态页面字符配置

`--minfont` 是构建时开启字体处理的开关，`mikit font` 用于处理已有构建输出；两者都会自动读取当前项目 `package.json` 的 `mikit.font`。**动态 URL 只有写入 `mikit.font.pages` 才会访问**；`--font-page` 只控制静态 HTML 输入，不包含动态提取。

对于 Vue/JavaScript、接口数据或 URL 查询参数渲染的文字，可以明确列出所有要采集的页面状态。以下域名是不可直接访问的文档示例，必须替换为本机实际 URL：

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

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `pages` | `[]` | 明确、有序的 HTTP/HTTPS URL 数组；空数组表示不启动浏览器，只做静态扫描。URL 不能包含用户名或密码。 |
| `waitFor` | `null` | 等待指定 CSS 选择器的元素进入 DOM（`attached`），不要求元素可见。 |
| `wait` | `1000` | `waitFor` 完成后额外等待的毫秒数，必须是非负整数。 |
| `timeout` | `15000` | 每页导航和 `waitFor` 的超时毫秒数，必须是正整数。 |
| `browserExecutable` | `null` | Chrome/Edge 可执行文件路径；相对路径按项目根目录解析。省略或空字符串表示自动查找。 |

`mikit init` 默认只生成 `pages`、`wait`、`timeout`；`waitFor` 和 `browserExecutable` 需要时手动添加。

#### 动态提取边界和失败处理

- Mikit 只按数组顺序访问明确列出的 URL，不猜测 query 参数值，也不会自动点击按钮切换状态；需要采集多个状态时，应逐个列出 URL。
- URL 对应的本地服务必须提前启动，例如先运行 `mikit start --port 8080`；字体命令不会自动启动服务。
- 每页依次执行 `domcontentloaded → waitFor（如有）→ wait`，不使用 `networkidle`。
- 运行时读取 `document.body` 中的文本节点，并按文本父元素计算后的第一个 `font-family` 归类；隐藏 DOM 也会读取。
- 运行时忽略 `script`、`style`、`noscript`，不读取 JavaScript 源码、HTML 属性值和 `::before`/`::after` 伪元素内容。
- `.shtml` URL 会映射到构建输出中的同路径 `.html` 作为静态补充；以 `/` 结尾的 URL 映射到 `index.html`。无法映射或本地文件不存在时会警告，动态 URL 本身仍会访问；但整个任务仍需至少找到一个静态 HTML 扫描页面。
- 任一页面导航、HTTP 主文档状态、等待或解析失败时，任务会在删除远程字体构建副本、写入清单和替换字体文件之前终止，避免生成只覆盖部分页面状态的字体包。

#### 页面错误日志规则

- 主页面返回 HTTP 4xx/5xx 时，该页面提取失败并终止字体任务。
- 图片、CSS、JavaScript、接口等非字体资源返回 HTTP 4xx/5xx 时不输出日志。
- 字体资源返回 HTTP 4xx/5xx 时输出状态码和完整 URL；相同“状态码 + URL”只输出一次。
- 其他 Vue/JavaScript `console.error` 仍会输出，便于发现页面逻辑错误。

#### 浏览器查找顺序

依次使用：`browserExecutable` 明确路径、`MIKIT_BROWSER_EXECUTABLE` 环境变量、系统常见 Chrome/Edge 安装位置。`browserExecutable: ""` 表示继续自动查找。

这是一套 Mikit 内置的确定性工具流程，不是 AI 猜字，也不需要为每个 URL 分别安装插件。生产字符只来自构建后的 HTML/CSS、明确配置的 URL 和页面实际渲染出的 DOM。

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
- 开发页面会注入项目级轮询脚本，每秒查询当前项目的更新状态。
- CSS 变更优先刷新对应样式表；HTML、JavaScript 等其他文件变更时刷新页面。
- 多项目共用端口时，变更只通知所属项目，不会刷新其他子域名。

### 4. 构建优化
- 可选压缩 HTML、CSS、JavaScript。
- 可选通过 autoprefixer 添加 CSS 前缀。
- SCSS 中 `_` 前缀文件作为 partial，不单独输出；`include` 目录中 `_` 前缀文件不会直接复制到构建目录。
- 可在构建完成后继续执行字体子集化和 PNG 压缩；PNG 默认量化到最多 256 色，也可切换为严格无损。

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
      "mode": "quantize",
      "colors": 256,
      "level": "balanced",
      "exclude": []
    },
    "font": {
      "pages": [],
      "waitFor": null,
      "wait": 1000,
      "timeout": 15000,
      "browserExecutable": ""
    }
  }
}
```

上面的 `font` 展示了全部受支持字段；`mikit init` 默认不会生成 `waitFor` 和 `browserExecutable`。

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

递归扫描 `mikit.png.root` 下扩展名为 `.png` 的文件（扩展名大小写不敏感），并且只有输出确实更小时才覆盖原文件。默认使用与 Imagine 相同的 pngquant 调用方式，把图片量化到最多 256 色；这是有损压缩，通常能比严格无损明显缩小体积，但不保证逐像素一致，也不保证完整保留 PNG 非关键元数据。

默认配置：

```json
"png": {
  "root": "dist",
  "mode": "quantize",
  "colors": 256,
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
- `mode`：压缩模式；省略时默认是 `quantize`。
  - `quantize`：默认模式，使用 pngquant 颜色量化，效果对应 Imagine 的 PNG“色彩”设置，属于有损压缩。
  - `lossless`：完整保留原有严格无损模式，解码后的像素保持一致，并保留原有非主动剥离元数据的行为。
- `colors`：仅用于 `quantize`，必须是 `2` 到 `256` 的整数，默认 `256`。数值越低通常压缩越强，但颜色损失、渐变色带和透明边缘变化也可能更明显。
- `level`：仅用于 `lossless`，控制尝试的无损算法范围和耗时，不是画质参数：
  - `fast`：尝试较少的过滤方案，速度最快，文件通常稍大。
  - `balanced`：默认无损等级，在耗时与体积之间取平衡。
  - `max`：尝试全部受支持的过滤方案，耗时最高，但不保证每张图都比 `balanced` 更小。

切换为原有严格无损模式：

```json
"png": {
  "root": "dist",
  "mode": "lossless",
  "level": "max",
  "exclude": []
}
```

独立压缩已有构建目录：

```powershell
mikit png
```

构建完成后压缩 PNG：

```powershell
mikit build --output custom-dist --png
```

`build --png` 会使用本次构建的实际输出目录（例如上面的 `custom-dist`），而不是 `mikit.png.root`；`mode`、`colors`、`level` 和 `exclude` 仍读取 `mikit.png`。如果缺少配置、目录不存在或某张 PNG 无法解析，命令会输出包含相对图片路径的错误并以非零状态退出。

与 Imagine / TinyPNG 的关系：默认 `quantize` 直接使用 Imagine 同类的 pngquant 颜色量化思路，体积通常会比原有严格无损模式小很多，效果也更接近 TinyPNG 一类有损压缩服务，但具体输出和压缩率不保证完全相同。需要逐像素一致时应显式使用 `mode: "lossless"`；此时 `fast`、`balanced`、`max` 只影响无损算法尝试范围，不会降低画质。

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

如果开发服务器端口被占用，可指定其他端口：

```bash
mikit start --port 8085
```

如果提示 LiveReload 的 35730 端口已占用，Mikit 会尝试复用已有服务；当前页面刷新主要依赖同一开发服务器上的 `/hot-update-status`。

### 2. 热更新不生效

依次检查：

- 当前访问的是 `wwwroot` 开发页面，而不是不注入热更新脚本的 `/dist/`。
- 页面源码中存在 `id="mikit-hot-reload"` 的脚本。
- 浏览器能请求当前域名下的 `/hot-update-status?project=...`。
- 子域名与 alias/自动扫描出的项目 ID 一致，文件确实位于该项目的 `wwwroot`。
- 终端是否输出了文件变化和热更新通知日志。

### 3. SCSS 编译错误

检查 SCSS 语法、导入路径、变量和嵌套关系。构建时的错误会显示源文件路径。

### 4. 找不到 `pyftsubset`

确认已经执行：

```powershell
py -m pip install fonttools brotli
pyftsubset --help
```

如果安装成功但命令仍找不到，请将 Python 的 Scripts 目录加入 `PATH`，重新打开终端后再验证。

### 5. 动态文字没有进入字符清单

检查以下项目：

- 命令包含 `--minfont`，或使用的是独立命令 `mikit font`。
- URL 写在 `package.json > mikit.font.pages`，而不是写进 `--font-page`。
- 本地服务已启动，URL 能在 Chrome/Edge 中访问。
- 页面需要的状态 URL 已逐个列出；Mikit 不自动猜参数或点击按钮。
- 如果数据异步渲染，配置正确的 `waitFor` 和足够的 `wait`。
- 页面文字最终使用的第一个计算字体族，能映射到待处理的本地 TTF。

### 6. 动态页面出现 404 时为什么没有日志

非字体图片、CSS、JavaScript、接口等资源的 HTTP 错误会被静默忽略；字体资源的 4xx/5xx 会输出状态码和完整 URL。主页面本身返回 4xx/5xx 会使字体任务失败。

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
