# AGENTS.md

本文件适用于仓库根目录及其全部子目录，用于约束在 `mikit-cli` 中工作的自动化 Agent。

## 交流与决策

- 默认使用中文沟通和汇报。
- 如果需求缺少会影响实现的关键信息，先询问用户，不要猜测路径、环境、输出目录、替换地址、动态字体页面或 SVN 目标。
- 先确认用户要修改的是 Mikit-CLI 本身，还是要在其他静态网站项目中调用 Mikit-CLI；不要混淆两类任务。
- 只实现用户要求的范围。除非明确提出，不新增预览、dry-run、自动提交或其他扩展能力。

## 项目概览

Mikit-CLI 是一个基于 Node.js、采用 CommonJS 的静态网站开发与构建 CLI。命令入口是 `bin/mikit.js`，主要能力包括：

- `mikit init`：初始化消费项目的 `package.json` 和 `mikit` 配置。
- `mikit start` / `mikit serve`：启动本地开发服务器、SSI、子域名项目路由及热更新。
- `mikit build`：将 `wwwroot` 构建到 `dist` 或指定输出目录。
- `mikit font`：对构建输出中的本地字体进行子集化。
- `mikit png`：无损压缩配置目录中的 PNG。
- `mikit replace`：按配置替换构建后 CSS 内容。
- `mikit pack`：将 SHTML 页面转换为 Go 模板并收集构建资源。
- `mikit sync-svn`：把配置的直接 CSS 文件同步到一个或多个 SVN 工作副本目录。

## 目录职责

- `bin/mikit.js`：CLI 命令、参数、用户可见输出和统一错误入口。
- `lib/`：各项功能的实现模块；优先保持模块职责单一。
- `tests/`：基于 Node.js `assert` 的可直接执行测试，无独立测试框架。
- `demo/wwwroot/`：演示项目源码。
- `demo/dist/`：演示项目生成结果；除非任务明确要求重新构建演示项目，否则不要主动改写。
- `docs/`：设计或补充文档；个人 AI 计划和规格使用 `docs/superpowers/`。
- `skills/mikit-workflow/`：面向消费项目的 Codex 工作流说明，不是 CLI 实现替代品。
- `README.md`：面向使用者的安装、命令、配置和故障排查文档。

## 修改前检查

1. 执行 `git status --short`，识别并保留已有未提交修改。
2. 阅读与任务直接相关的实现、测试和 README 段落。
3. 不还原、不覆盖、不格式化用户或其他任务留下的无关变更。
4. 涉及生成目录、外部 SVN 路径、全局安装或运行中服务时，先确认影响范围。
5. 对可能清空输出目录的构建或打包命令，必须先检查配置中的输入、输出路径是否正确且互不危险重叠。

## 实现规范

- 沿用现有 CommonJS 写法：`require(...)`、`module.exports`、2 空格缩进、单引号和分号。
- 保持改动聚焦，避免无关重构、全文件格式化和大范围换行符变化。
- 文件路径统一通过 `node:path` 解析；不要手工拼接 Windows 路径。
- 文件操作前验证路径、类型和必要配置；错误信息应指出具体配置字段或实际路径。
- CLI 工作流命令应通过现有统一错误处理输出简洁、带 `[mikit <command>]` 前缀的信息，不向普通用户倾倒无关堆栈。
- 新增或修改命令参数时，同步检查：
  - `bin/mikit.js` 的命令定义与传参；
  - 对应 `lib/` 模块；
  - 直接模块测试和 CLI 测试；
  - `README.md`；
  - 如影响消费项目工作流，再更新 `skills/mikit-workflow/` 的说明或 references。
- 新增或修改功能只要涉及消费项目的 `package.json > mikit` 配置字段、结构或默认值，就必须同步修改 `mikit init` 的默认输出（`lib/project-initializer.js`）及 `tests/project-init.test.js` 的断言，不能只修改运行时读取逻辑。README、Skill 和飞书文档是否同步修改，按“文档与交付”规则先判断并询问用户。
- 不静默安装 npm、Python、浏览器或全局依赖；确需安装时先说明原因并获得用户同意。

## 必须保持的行为边界

### 源文件与生成文件

- 在消费项目中，`wwwroot` 是源码，`dist` 和 `packed` 通常是生成输出。
- `build` 可能重建输出目录，`pack` 会在输入预检通过后重置配置的输出目录。
- `replace`、`png` 和 `font` 会原地修改配置指向的生成文件。
- 不要通过手工编辑生成文件伪造命令成功；应修复源码或配置后重新执行对应命令。

### SSI、服务与构建

- SSI 解析在开发服务器和构建流程中应保持一致。
- 以 `/` 开头的 include 从当前项目 `wwwroot` 根目录解析。
- 不以 `/` 开头的 `virtual` include 相对包含它的页面或 include 文件解析。
- 多项目/alias、`/dist/` 预览和热更新修改要保持项目隔离；启动的测试服务必须在测试结束时关闭。

### CSS 替换和打包

- `replace` 按配置顺序执行字面量替换，并尊重 `disabled`、`env` 和环境映射。
- `pack` 必须先验证所有输入路径，再清理输出目录。
- 打包时保持现有 SSI-to-Go-template 转换规则及配置的页面、资源、排除项语义。

### SVN CSS 同步

- `sync-svn` 只同步配置源目录下匹配的直接 `.css` 文件；`files: ["*"]` 不代表任意文件或递归目录。
- 支持旧版单目标 `syncSvn.target` 和多目标 `syncSvn.targets`，但两者不能同时配置。
- Windows 下多目标路径按大小写不敏感方式去重。
- 在复制任何文件前预检所有目标目录，避免部分目标已更新、后续目标才失败。
- 内容相同的文件通过 SHA-256 跳过；复制后再次校验内容。
- 不创建缺失的 SVN 目录，不删除文件，不执行 `svn add`、`svn delete`、`svn commit` 或其他 SVN 元数据操作。
- 只有用户明确要求同步时才能执行该命令；同步完成不等于允许提交 SVN。

### PNG 和字体

- PNG 优化必须保持无损，并且仅在结果更小时覆盖原文件。
- 字体功能依赖 `pyftsubset`；动态页面采集还依赖可访问页面及本机 Chrome/Edge。
- 对实际处理的有效字体，应保持 TTF、WOFF、WOFF2 输出和可检查的字符清单/manifest 行为。
- 不要自行猜测动态页面 URL、等待选择器、浏览器路径或字体映射。

## 测试与验证

优先运行最小相关测试，再根据改动范围运行完整测试。

```powershell
# 单个相关测试
node tests/<name>.test.js

# 完整测试套件
npm test

# JavaScript 语法检查
node --check bin/mikit.js
node --check lib/<changed-file>.js

# 补丁格式检查
git diff --check
```

验证要求：

- 修复缺陷时，优先新增能复现问题的回归测试。
- 测试夹具放在系统临时目录或测试专用目录，并在 `finally` 中清理文件、目录、子进程和监听端口。
- 涉及 CLI 时，既检查退出码，也检查用户可见输出和错误前缀。
- 涉及文件变更时，验证实际文件内容、文件范围和不会误处理的反例。
- 涉及多目标同步、打包或重建时，增加“预检失败不产生部分写入”的覆盖。
- 若 Windows 受限环境出现 `CreateProcessAsUserW failed: 5`、`spawnSync` 的 `status: null` 等子进程创建错误，不要直接认定为产品缺陷；应区分运行环境失败与断言失败，并如实汇报未完成的验证。
- 仅修改 Markdown 时，至少执行内容回读和 `git diff --check`；通常不必运行完整代码测试。

## 文档与交付

- 新增或修改功能后，主动判断是否有必要同步修改 `README.md`、`skills/mikit-workflow/` 和[项目飞书文档](https://my.feishu.cn/docx/G2BMd0GS3ozjcoxUo3Fcu8SBnmb)；判断时分别考虑用户可见行为、消费项目操作流程及团队共享说明是否发生变化。
- 在实际修改上述文档前，向用户说明每一项的判断结果和理由，并询问是否按判断结果同步更新；未经用户确认，不直接修改这些文档。
- 如果用户确认修改飞书文档，使用适用的飞书 Skill，重新获取最新文档和 block ID，仅修改必要范围，并在写入后回读核对。
- 完成前再次检查 `git status --short` 和聚焦 diff，确认没有带入无关文件。
- 最终汇报应包含：修改了什么、涉及哪些文件、执行了哪些验证、有哪些验证因环境原因未执行。
- 除非用户明确要求，不执行 `git commit`、`git push`、发布、全局安装、启动常驻服务或外部 SVN 同步。
