# Mikit-CLI 使用文档

## 项目介绍

Mikit-CLI 是一个基于 Node.js 的静态网站构建工具，替代传统的 MiKit 桌面应用，提供更灵活、更现代的前端开发和构建体验。

## 安装方法

### 安装 Mikit-CLI

下面三种方式按使用场景选择一种，不需要重复安装。普通用户推荐从 npm 官方仓库全局安装。

**方式一（推荐）：从 npm 官方仓库全局安装**

```bash
npm install -g mikit-cli
mikit --version
mikit --help
```

更新全局安装的版本：

```bash
npm install -g mikit-cli@latest
mikit --version
mikit --help
```

**方式二：作为项目开发依赖安装**

```bash
npm install -D mikit-cli
npx mikit --version
npx mikit --help
```

项目依赖通常通过 npm scripts 调用，例如 `npm run build`；也可以直接使用 `npx mikit`。需要更新到最新版时，执行 `npm install -D mikit-cli@latest`。

**方式三：在 Windows 上把本地源码目录安装为全局命令（仅开发和调试）**

新克隆的源码必须先安装项目依赖，再建立全局命令链接：

```powershell
Set-Location "F:\mikit-cli"
npm ci
npm install -g "file:F:\mikit-cli"
mikit --version
mikit --help
```

`npm ci` 会严格按照 `package-lock.json` 把运行依赖安装到源码目录的 `node_modules`。`npm install -g "file:..."` 仅适合 Mikit-CLI 本身的开发或调试，它建立的是指向源码目录的全局链接，不会代替源码目录安装依赖；如果跳过 `npm ci`，运行时可能出现 `Cannot find module 'commander'`。源码修改后，全局 `mikit` 会继续指向该本地目录。

### 字体子集化依赖（仅字体功能需要）

只有使用 `mikit build --minfont` 或 `mikit font` 时才需要 Python 依赖。字体仅生成 CSS 本地 URL 引用的 TTF、WOFF、WOFF2 格式；需要 WOFF2 时额外安装 `brotli`：

```powershell
py -m pip install fonttools
# 仅当 CSS 引用了 WOFF2 时：
py -m pip install brotli
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
- “帮我检查并配置 `F:\NDW\mikit.alias.json`，让项目可以用同一个端口按子域名访问。”
- “构建并压缩 CSS 和 PNG。”
- “检查配置后把 CSS 同步到 SVN。”
- “使用 `$mikit-workflow` 处理当前项目的字体子集化。”

Skill 会先检查项目和配置，缺少必要路径、地址或运行环境时会询问，不会自行猜测。安装或接入项目时，如果后续会用同端口子域名服务或全局作者注释，AI 应继续引导配置 `mikit.alias.json`：先查找已有配置和 `MIKIT_ALIAS_CONFIG`，再询问统一根目录、域名、端口、全局作者、是否启用 `auto` 自动扫描，以及是否需要手动 `projects` 映射。Windows 用户环境变量只是可选持久入口，设置前应先确认；项目位于 alias 文件下级目录时，优先使用向上自动发现即可。仓库同步到 GitHub 后，也可以通过 Codex 的 GitHub Skill 安装方式直接安装 `skills/mikit-workflow` 子目录。

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
- `mikit.author` 作者配置，以及 `mikit.replace`、`mikit.pack`、`mikit.syncSvn`、`mikit.png`、`mikit.font` 基础配置。
- `mikit.author` 默认是空字符串；填写后作为项目原作者。未填写时，`mikit build` 会尝试使用全局 alias 配置中的 `author` 作为作者。
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

例如在 `F:\NDW` 下创建 `mikit.alias.json`（以下目录和作者均为示例）：

```json
{
  "root": "F:/NDW",
  "author": "全局作者(工号)",
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

#### alias 配置项怎么写

| 配置项 | 写法示例 | 用途与规则 |
|---|---|---|
| `root` | `"F:/NDW"` | 项目统一根目录。想从任意目录启动时请填写绝对路径；auto 和 projects 的相对路径以此为基准。未设置时使用 --root，未传 --root 时使用启动目录。相对 root 按启动目录解析，不按 JSON 所在目录解析。 |
| `port` | `8080` | 端口使用数字，例如 8080 或 8084。优先级：命令行 --port > JSON 的 port > 8080。 |
| `domain` | `"y.bindyy.cn"` | 子域名的基础域名，不含协议、端口或项目名前缀。当前 CLI 默认传入 y.bindyy.cn，仅修改 JSON 不会切换域名；自定义域名需显式传 --domain，并配置 DNS 或 hosts。 |
| `default` | `"wjms"` | 可选。用于指定默认项目的别名。访问 `localhost` 或未匹配的主机名时使用该项目；省略时使用第一个成功加载的项目。配置的别名未加载成功时会显示警告，并回退到第一个项目。 |
| `auto` | `["【魔域】/2026/*/*/wwwroot"]` | 可选的自动扫描规则，建议使用数组；也支持单个字符串。整段 * 只匹配一级目录，不支持 ** 或部分目录名通配。以 wwwroot 结尾，使用其父目录名生成别名。无需扫描时写 []。 |
| `projects` | `{"wjms": "【魔域】/2026/0518 拉新召回/lxzh/wwwroot"}` | 手动别名映射，可指向项目目录或 wwwroot，也可使用绝对路径。别名建议用小写英文字母、数字及中间的连字符；手动配置覆盖同名自动别名。仅自动扫描时写 {}。 |
| `author` | `"全局作者(工号)"` | 可选的全局构建作者，与启动服务无关。项目作者存在时用作 Editor；项目作者为空时用作 Author。不需要时省略或写空字符串。 |

以上路径、作者和项目名均为示例，请按实际目录填写；已有配置只补齐需要的字段，不要覆盖原有映射。这些字段放在独立的 `mikit.alias.json` 顶层，不放进 `package.json > mikit`；`mikit init` 不会创建这个文件。即使不配置手动别名，也建议保留 `"projects": {}`。

保存上面的 `mikit.alias.json` 后，只需把文件路径保存为当前 Windows 用户环境变量。以下命令只需执行一次，示例路径需替换为实际路径：

```powershell
[Environment]::SetEnvironmentVariable(
  'MIKIT_ALIAS_CONFIG',
  'F:\NDW\mikit.alias.json',
  'User'
)
```

重新打开 PowerShell，以后从任意目录直接运行：

```powershell
mikit start
```

首次启动时确认 `Alias config:` 指向正确的配置文件，且 `Loaded projects:` 包含预期别名即可。

如果不想重新打开当前 PowerShell，可以先让环境变量在当前窗口立即生效：

```powershell
$env:MIKIT_ALIAS_CONFIG = 'F:\NDW\mikit.alias.json'
mikit start
```

#### 启动排查

- 没有 `Alias config:` 或提示配置不存在：核对当前进程环境变量、文件完整路径和 JSON 语法。双引号包裹键和字符串，不写注释或尾逗号；Windows 路径优先使用 `/`，使用反斜杠时必须写成 `\\`。
- 提示 `No project loaded` 或目标目录不存在：检查绝对路径 `root`、`projects` 的相对路径和 `auto` 的目录层数；先核对磁盘上的真实目录。
- 端口被占用：停止自己先前启动的服务，或通过 `--port` 临时使用其他可用端口；修改 JSON 的 `port` 后需重启服务。
- localhost 能访问但子域名打不开：确认 DNS/hosts 将所用子域名解析到本机，并核对域名与端口。

启动后使用同一个端口访问：

```text
http://wjms.y.bindyy.cn:8080/index.shtml
http://wjms.y.bindyy.cn:8080/dist/
http://wb.y.bindyy.cn:8080/index.shtml
http://worldcup.y.bindyy.cn:8080/index.shtml
```

端口优先级：命令行 `--port` 优先，其次使用 alias 配置里的 `port`，最后默认 `8080`。

注意：
- `projects` 和 `auto` 中的相对路径以 alias 的 `root` 为基准；未设置该字段时，才使用 `--root` 或当前启动目录。
- `auto` 支持 `*` 通配一级目录；服务会监听 alias 配置和自动扫描目录变化，新增项目或修改配置后通常不需要重启服务。
- `/index.shtml` 等普通路径访问映射项目的 `wwwroot`；`/dist/` 访问同项目的 `dist` 目录。
- 访问 `wwwroot` 开发页面后会按需开启源码监听并注入热更新脚本；不同源码目录的更新互不影响，指向同一源码目录的别名共用监听和更新。详见“热更新”一节的空闲释放说明。
- `/dist` 会跳转到 `/dist/`，只做构建产物预览，不注入热更新脚本，也不登记或续期源码监听。
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
| 字体子集化 | `mikit build --minfont` | 构建后按字体族提取字符并裁剪本地字体 |
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

#### 构建作者注释

在项目 `package.json` 中配置原始作者：

```json
{
  "mikit": {
    "author": "项目作者(工号)"
  }
}
```

`mikit build` 或项目中的 `mbuild` 会在普通 CSS、JavaScript 和 Sass 编译生成的 CSS 头部加入作者注释。注释在压缩、Autoprefixer 和 Sass 编译完成后添加，同一次构建的全部文件使用相同的编译时间。

当项目 `mikit.author` 和全局 alias `author` 都存在时，项目作者写入 `Author`，全局作者写入 `Editor`。全局 alias 优先读取 `MIKIT_ALIAS_CONFIG`，未设置时从项目目录向上查找最近的 `mikit.alias.json`：

```css
/*
 * Author: 项目作者(工号)
 * Editor: 全局作者(工号)
 * Compile Date: YYYY-MM-DD HH:mm
 */
```

当项目 `mikit.author` 缺失或为空，但全局 `author` 存在时，全局作者写入 `Author`，并省略 `Editor`。当项目作者存在但全局配置未设置、文件不存在、JSON 格式错误或全局 `author` 为空时，只写项目 `Author`，并省略 `Editor`。只有项目作者和全局作者都不可用时，才不添加作者注释，并且每次构建只提醒一次。该功能只属于 `mikit build`，不会在 `mikit pack` 阶段重复添加。

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

> `mikit font` 会处理已有构建输出。所有字体和字符清单先在临时目录生成、验证，再一同发布；失败时保留原输出。成功后不保留长期备份，原始字体仍以 `wwwroot/font` 为准。

#### 字体输入、映射和输出规则

- 构建输出中必须存在 `font` 目录，否则命令报错。CSS 从同一输出目录递归扫描 `**/*.css`（例如 `dist/css/`、`dist/scss/`），不读取源码 `.scss`。
- 字体位于输出目录的 `font` 中（可嵌套子目录），并且被 CSS 的本地 `url(...)` 引用 TTF、WOFF 或 WOFF2 格式时才进入计划。每个 URL 相对所在 CSS 或内联 `<style>` 的 HTML 文件解析；仅放入 `font` 而未被本地引用的文件会被清理。
- `@font-face` 的 `font-family` 用于把 CSS 字体族映射到实际字体文件；没有映射时回退到字体文件名。`font-family` 有多个候选值时，只使用列表中的第一个字体族。
- CSS 中的 HTTP/HTTPS 远程字体不做子集化。若输出目录的 `font` 中存在仅由远程 URL 引用的同名字体文件，会直接从构建输出移除；同名字体同时存在本地引用时按本地字体处理。
- 每个字体分别合并和去重字符，不会把所有字体共用一份字符清单。
- 只有“被 CSS 本地引用且提取到至少 1 个字符”的字体会保留：按字体相对路径生成 TXT，并为每个字体只生成和保留它在本地 CSS 中引用的 TTF、WOFF、WOFF2 格式；不会备份原始字体。只有 WOFF 引用时必须有原始 WOFF，即使同名字体的 TTF 存在也不会代替；缺少可用输入会在清理字体前报出具体路径。
- CSS 未引用或提取字符为 0 的字体都会从输出字体目录删除；零字符字体不生成 TXT、不调用 `pyftsubset`，并删除字符清单目录中的遗留同名 TXT。有效字体的 EOT、OTF、SVG 等非输出格式也会删除，因此字体处理完成后只保留有效字体在 CSS 中实际引用的格式。

#### 静态 HTML 提取规则

- 默认递归发现 `wwwroot/**/*.shtml`，排除任意目录下文件名以 `_` 开头的页面，再扫描它们在构建输出中的同路径 `.html`。例如 `wwwroot/index.shtml` 映射为 `dist/index.html`，`wwwroot/pages/list.shtml` 映射为 `dist/pages/list.html`；`wwwroot/include/_pop.shtml` 不会作为独立页面扫描。
- 不再要求专门维护 `font.shtml`。所有符合上述规则的 SHTML 页面都会纳入扫描；页面文字只有匹配到目标字体的 CSS `font-family`（包括继承）时，才会写入该字体的字符清单。
- 如果项目没有可发现的源 SHTML（例如只有构建输出），会递归扫描输出目录中的 `**/*.html`，并排除文件名以 `_` 开头的 HTML。
- `--font-page` 支持明确文件和 glob，例如 `index.html`、`pages/*.html`、`**/*.html`；传入后用于覆盖默认 SHTML 自动发现。指定模式没有匹配结果时，仍按兼容规则回退扫描输出目录根层的 `*.html`。匹配结果和动态 URL 映射出的本地 HTML 会去重后共同扫描。
- 静态 CSS 匹配是轻量实现，不是完整浏览器 CSS 引擎。当前支持标签、ID、class、后代选择器、子选择器、字体继承、规则顺序、选择器优先级、`!important` 和内联 `font-family`；不应依赖复杂属性选择器或兄弟选择器进行字体识别。
- HTML 中明确写出的字面文本都会参与扫描，包括 `v-if`、`v-else-if`、`v-else`、`v-show`、隐藏面板、未打开弹窗和 `<template>` 中的各状态文字。
- Vue 的 `{{ ... }}`、`v-text`、`v-html`、部分绑定属性及 `v-for` 会尝试从构建后页面的内联脚本和本地脚本中静态求出可见文字（包括已知条件分支），不把变量名直接当作字符。无法静态求值、脚本解析失败、接口返回或运行时计算的内容会记录为风险；可通过动态页面或按字体族手工补字覆盖。静态提取不等于完整运行时执行。
- 默认 `asciiBaseline: "none"`：只保留页面确实提取到的字符和用户显式补字，不自动加入数字、ASCII 或其他保底字符。需要兼容未知数字、日期、英文状态时，可明确选择 `common` / `full`，或填写补字。

- 纯缩进、换行等格式化空白不算有效字符；普通文本内部的连续空白归一为一个空格。
- 静态页面不直接把 `script`、`style` 的源码或普通 HTML 属性值当作可见文字；只对受支持的 Vue 可见绑定求值。

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
      "browserExecutable": "",
      "asciiBaseline": "none",
      "dynamicTextPolicy": "warn",
      "globalExtraText": "",
      "familyExtraText": { "活动标题": "补充文案" },
      "familyOptions": { "活动标题": { "asciiBaseline": "common" } }
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
| `asciiBaseline` | `"none"` | `none` 不补字；`common` 补常见数字及符号；`full` 补 ASCII 32–126。 |
| `globalExtraText` | `""` | 明确补给所有字体族的字符。 |
| `familyExtraText` | `{}` | 以 CSS 中的 `font-family` 为键，单独为字体族补字。 |
| `familyOptions` | `{}` | 每个字体族覆盖 `asciiBaseline`，例如 `{ "活动标题": { "asciiBaseline": "common" } }`。 |
| `dynamicTextPolicy` | `"warn"` | 静态求值存在未知动态文案时警告并继续；`error` 则终止且不发布。 |

`mikit init` 默认生成 `pages`、`wait`、`timeout` 及上述补字和动态风险策略字段；`waitFor` 和 `browserExecutable` 需要时手动添加。

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

字体字符来自构建后的 HTML/CSS 及可静态确定的 Vue/JS 展示文案、显式补字和已配置页面的实际 DOM，不从未配置的动态状态猜字。成功处理有效字体后，终端会提示 Markdown 报告的完整路径。默认打开项目 `font/font-report.md`；若自定义了字符清单目录，以终端提示的路径为准。报告替代原 `font-report.json`，完整字符清单仍保存在 TXT 文件中。

建议按以下顺序阅读：

1. **结果概览**：先看处理的字体数、输出文件数、总体积、静态与运行时页面数，以及动态风险、源字体缺字和未执行验证的数量。
2. **待处理事项**：优先处理“源字体缺字”和“动态文字风险”，再确认“数字覆盖待确认”和“未执行字体验证”。源字体缺字会列出实际字符及 Unicode 码点，需要更换字体或配置回退字体；补字配置无法增加原字体没有的字形。动态风险会标明页面、字体族、表达式或依赖，便于定位未确定的文案。未执行验证不能视为验证通过。
3. **字体明细**：按字体族核对字符总数、静态采集、运行时新增、配置新增、实际生效的 ASCII 策略和验证结果。点击字符清单查看完整 TXT；逐字体还会展示字符预览、实际输出格式、字体文件、同格式体积及减少比例。原同格式文件不存在时会标注“无法比较”。
4. **扫描来源与覆盖边界**：核对静态页面和运行时页面列表。未配置 `pages` 时不会执行浏览器 DOM 采集；配置后也只覆盖本次实际采集的 DOM 状态。接口返回、用户输入、异步更新和其他交互状态仍需确认，没有告警不代表全部运行时状态都已覆盖。

“数字覆盖待确认”仅在字体存在动态文字绑定且字符清单仍缺少部分 `0–9` 时提示。尚未采集的数字不等于源字体缺字，也不能单独证明页面已经缺字。默认 `asciiBaseline: "none"` 不会根据提示自动补数字。

先确认运行时文案是否可能出现提示的数字。若需要补字，在项目 `package.json > mikit.font` 中按 CSS 字体族配置 `"familyExtraText": { "活动标题": "23" }`（示例仅补运行时需要的字符）；也可以显式配置 `"familyOptions": { "活动标题": { "asciiBaseline": "common" } }`，或为需采集的状态补充 `pages`。随后重新执行字体处理，核对报告与实际页面。报告、字符清单和字体结果一起发布；字体生成、验证或发布失败时保留上次结果。没有有效字体时不生成报告，并清理过期报告。

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
- `mikit start` 根据页面访问按需开启源码监听。服务启动后，各项目地址可以正常访问；访问实际存在的 HTML/SHTML 开发页面，或带 `index.html` / `index.shtml` 的目录时，会开启对应 `wwwroot` 的监听。本机、其他电脑和手机访问的行为相同。
- 开发页面会注入项目级轮询脚本，每秒查询当前项目的更新状态并续期监听。同一个源码目录的多个别名、页面和设备共用一份监听。
- CSS 变更优先刷新对应样式表；HTML、JavaScript 等其他文件变更时刷新页面。
- 不同源码目录之间的更新相互隔离；多个别名指向同一源码目录时，这些页面会一起收到更新。
- 所有页面停止心跳后，空闲满 5 分钟释放源码监听，每 30 秒检查一次，通常约 5～5.5 分钟完成。关闭浏览器不会立即释放；只要仍有页面或设备发送心跳，就继续保留监听。后台标签页可能继续轮询，也可能被浏览器暂停。
- 页面从休眠或断网中恢复后会重新登记；如果监听已释放并重新创建，页面会自动整页刷新，补上未监听期间的变化。回到可见状态时也会检查更新。
- `/dist` 会跳转到 `/dist/`；构建预览不注入热更新、不登记也不续期源码监听。单独请求图片、CSS、JavaScript、无首页的目录列表或不存在的页面也不会登记。
- 自动发现项目仍会监听扫描规则所需的目录层级，用于识别新增、删除的项目，不会因此递归监听所有项目的源码内容。服务本身仍有基础内存占用；释放源码监听可减少资源占用，但 Node.js 垃圾回收和操作系统不保证进程内存立即下降，也没有固定下降时间。

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
    "replace:dev": "set NODE_ENV=development &&  npm run replace",
    "replace:build": "set NODE_ENV=production &&  npm run replace",
    "dev": "npm run mbuild  && npm run replace:dev",
    "build": "npm run mbuild  && npm run replace:build",
    "pack": "mikit pack",
    "sync:svn": "mikit sync-svn",
    "dev:svn": "npm run dev && npm run sync:svn",
    "build:svn": "npm run build && npm run sync:svn"
  },
  "mikit": {
    "author": "项目作者(工号)",
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
            "development": "https://wjdown.99.com/games/my/2026/hks/font/",
            "production": "https://myvideo.99.com/games/my/2026/hks/font/"
          }
        },
        {
          "from": "../font/",
          "to": {
            "development": "https://wjdown.99.com/games/my/2026/hks/font/",
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
      "browserExecutable": "",
      "asciiBaseline": "none",
      "dynamicTextPolicy": "warn",
      "globalExtraText": "",
      "familyExtraText": { "活动标题": "补充文案" },
      "familyOptions": { "活动标题": { "asciiBaseline": "common" } }
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
  "mikit": {
    "author": "项目作者(工号)"
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
- 启动后未访问源码页面时，没有对应源码监听属于正常行为；先打开实际存在的 HTML/SHTML 页面再修改源码。
- 若页面长时间休眠或断网，恢复后等待状态请求成功；监听重新创建时应自动整页刷新。关闭页面后需等最后一次心跳后约 5～5.5 分钟才会释放，其他页面持续心跳时不会释放。
- 终端是否输出了文件变化和热更新通知日志。

### 3. SCSS 编译错误

检查 SCSS 语法、导入路径、变量和嵌套关系。构建时的错误会显示源文件路径。

`mikit start` 会在浏览器请求对应 CSS 时即时编译 SCSS。编译失败后，终端优先输出 `[mikit start] Sass 编译错误`、实际出错的源文件路径及行列号，并显示该行代码和指示位置；即使错误发生在导入的 `_` 部分文件中，也应先查看所指向的源文件，而不是只看入口 SCSS。关键帧 mixin 的内容展开错误（例如将 `from` 误写为 `form`）会指向错误的选择器行。修复源码后重新请求或刷新页面即可再次编译。

`[mikit start] Sass 弃用警告` 会与编译错误分别标识；例如 `[slash-div]` 提示旧式 `/` 除法，不等于本次编译失败的原因。若两者同时出现，先处理编译错误，再按需处理弃用警告。

### 4. 找不到 `pyftsubset`

确认已经执行：

```powershell
py -m pip install fonttools
# 仅当 CSS 引用了 WOFF2 时：
py -m pip install brotli
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
- 页面文字最终使用的第一个计算字体族，能映射到待处理的本地字体。

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
