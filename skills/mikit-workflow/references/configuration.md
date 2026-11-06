# Mikit Configuration Reference

Load only the sections needed for the current request. The consumer project's `package.json` is authoritative.

## Invocation and Initialization

A project may use one of these forms:

```powershell
mikit <command>
npx mikit <command>
npm run <project-script>
```

`mikit init` creates `package.json` only when that file does not already exist. It generates scripts for build, font build, PNG, replacement, packing, and SVN synchronization, plus starter `mikit` sections. The starter `mikit.author` value is an empty string and must be filled with the project author and employee number when build attribution headers are required. The starter PNG setting uses the recommended default `mode: "quantize"` with `colors: 256`; this is lossy color quantization, not strict lossless compression. The starter replacement rule is enabled and contains an example URL, so it must be reviewed before running replacement or a script that includes replacement.

For a broad initialization request, inspect the project and resolve these choices before writing configuration:

- Build output and minification: none, CSS only, or HTML/CSS/JavaScript; separately ask about Autoprefixer. When Autoprefixer is enabled, preserve an existing `package.json > browserslist` or `.browserslistrc`; if neither exists, ask the user for the required browser range and confirm the proposed Browserslist entries before writing them.
- Font subsetting (optional): ask as its own decision whether to enable `--minfont` or `mikit font`. If enabled, use automatic static discovery by default; request dynamic page URLs and timing/browser settings only when the user needs rendered dynamic text.
- PNG: keep the recommended 256-color quantization or switch to strict lossless; confirm the root, then explicitly ask whether to keep no exclusions or configure optional `exclude` patterns. If inspection found `img/txt` or `img/origin` in the effective PNG root or at the same relative path in source content that will be copied to the output root, recommend those detected directories as exclusions and wait for confirmation.
- CSS replacement: obtain the literal source string and either one shared destination or separate `development` and `production` destinations.
- Packing (optional): ask as its own decision whether it is needed and, if enabled, confirm all page, asset, output, and exclusion paths.
- SVN CSS synchronization (optional): ask as its own decision whether it is needed and, if enabled, obtain the existing target directory or directories plus direct CSS patterns.
- Development server and attribution: ask only when relevant or when required values are missing.

Batch ordinary unresolved choices into a concise question set. Font subsetting, packing, and SVN synchronization must still be presented as three separate numbered questions or input fields, each labeled optional. They may be shown in one message, but must not be collapsed into one combined question or silently treated as disabled. Ask detailed settings only for the optional features the user enables. Do not make optional capabilities mandatory merely because `mikit init` provides starter sections and scripts for them.

For an existing `package.json`, merge only the requested sections instead of recreating the file.

## Development Server

### Configure once, then run only mikit start

This workflow assumes the global `mikit` command is installed. The paths, project names, domain, and author below are examples, not values to apply without checking the user's environment. Save this as a standalone workspace `mikit.alias.json`, for example `F:/NDW/mikit.alias.json`; these fields do not belong in `package.json > mikit`. `mikit init` does not create this file. Merge into existing configuration instead of replacing mappings.

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

| Field | How to write it | Behavior |
|---|---|---|
| `root` | Absolute directory string, e.g. `"F:/NDW"` | Base for relative `auto` and `projects` paths. It overrides `--root`. When omitted, use `--root` or the startup directory. A relative JSON root resolves against the startup directory, not the JSON file. Use an absolute root for startup from any directory. |
| `port` | Number, e.g. `8080` | Explicit `--port` wins, then alias `port`, then 8080. Restart the server after changing it. |
| `domain` | Base hostname only, e.g. `"y.bindyy.cn"` | No protocol, port, or project prefix. The current CLI supplies this default even when no option is provided, so JSON alone cannot select a custom domain. Pass `--domain` explicitly for a custom hostname and configure DNS/hosts. |
| `default` | Loaded alias string, e.g. `"wjms"` | Used for localhost or unmatched hostnames; omitted means the first loaded project. |
| `auto` | Array of patterns, e.g. `["【魔域】/2026/*/*/wwwroot"]`; a single string also works | A whole path segment `*` matches one directory level; no `**` or partial-segment globbing. End patterns in `wwwroot`; its parent directory supplies the alias. Use `[]` to disable scanning. |
| `projects` | Object mapping aliases to directory strings | Targets may be project directories or their `wwwroot`, relative to root or absolute. Use lowercase letters, digits, and internal hyphens for aliases. Manual mappings override matching automatic aliases. Retain `{}` when only scanning. |
| `author` | Optional string `"姓名(工号)"` | Global build attribution, not required for serving. Becomes Editor when a project author exists, otherwise Author. Omit or use an empty string when not needed. |

Use valid JSON with double quotes, no comments or trailing commas. Prefer forward slashes in Windows JSON paths; backslashes must be escaped. Confirm actual directories and the intended default alias. Automatic aliases derive from the parent of `wwwroot`, e.g. `lxzh/wwwroot` gives `lxzh`; use manual mappings to choose a stable name such as `wjms`.

### Locate the configuration from any directory

Alias selection uses explicit `--alias` where supported, then `MIKIT_ALIAS_CONFIG`, then the nearest `mikit.alias.json` found by walking upward from the current root. A configured environment path takes precedence over nearby files. Discovery from `C:/Users/ND` cannot find `F:/NDW` on another drive. For startup inside that workspace, discovery can locate the file without an environment variable; an absolute alias root still avoids project-path drift when starting in child directories.

After confirming the user's actual file path and authorization to change their environment, show or execute:

```powershell
# 示例路径；先替换成你实际保存的配置文件路径
$aliasPath = 'F:\NDW\mikit.alias.json'
Test-Path -LiteralPath $aliasPath -PathType Leaf
Get-Content -LiteralPath $aliasPath -Raw | ConvertFrom-Json

# 确认文件存在且 JSON 可解析后，保存到当前 Windows 用户
[Environment]::SetEnvironmentVariable('MIKIT_ALIAS_CONFIG', $aliasPath, 'User')

# 让当前 PowerShell 窗口立即生效
$env:MIKIT_ALIAS_CONFIG = $aliasPath
```

The variable contains the full JSON file path, not a directory. Proceed with configuration only when the file check returns True and JSON parsing succeeds. User-scope persistence does not update existing terminals or IDE processes. The current `$env:` assignment affects this PowerShell and its children; if a new terminal still inherits stale values from an old IDE or terminal application, restart that parent application completely or assign the variable in the current shell.

### Verify and start

```powershell
$env:MIKIT_ALIAS_CONFIG
[Environment]::GetEnvironmentVariable('MIKIT_ALIAS_CONFIG', 'User')
mikit start
```

Both environment reads should identify the intended file. When the user authorizes a server run, verify `Alias config:`, `Loaded projects:`, and the port in the access URLs. Do not treat `Project root:` alone as the effective alias root: it may still show the startup directory. Stop a verification server afterwards. A custom domain requires `mikit start --domain <actual-base-domain>` in the current CLI; do not promise bare startup will honor a custom JSON domain.

For a temporary file or port override:

```powershell
mikit start --alias "F:/NDW/mikit.alias.json" --port 8084
```

For ordinary serving without alias configuration, `--root` selects one project or a parent containing projects, `--domain` selects the base domain, and `--virtual` adds URL-to-directory mappings. A root containing `wwwroot` serves that project. Alias mappings take precedence when a config is loaded. `/dist/` exposes the same project's build output without source-page hot reload.

### On-demand hot reload and resource use

`mikit start` activates source watchers on demand when pages are visited. Project routes remain accessible while their source watchers are inactive. Visiting an existing source `.html` or `.shtml` page, including a directory with `index.html` or `index.shtml`, activates its `wwwroot` watcher. Local browsers, remote computers, and phones behave the same way. Aliases resolving to the same source directory share one watcher, as do multiple pages and devices. Different source roots receive separate updates.

Injected pages poll `/hot-update-status?project=...` every second and renew activity. After the last heartbeat, five idle minutes releases the source watcher; the sweep runs every 30 seconds, so release normally occurs after about 5-5.5 minutes. Browser closure is not immediate deregistration. Background tabs may continue polling, while suspended or offline pages can expire; any remaining page heartbeat keeps the shared watcher active. Returning pages reactivate it and fully reload when its session changes to pick up missed edits; visibility restoration and `pageshow` also trigger a status check.

`/dist` redirects to `/dist/`. Build previews do not inject hot reload, activate source watchers, or renew their activity. Standalone asset requests, directory listings without an index, and nonexistent pages do not activate them either. Automatic project discovery retains directory-only watches at the depths required by scan patterns so added or removed projects remain discoverable. The server still has baseline memory use; closing a source watcher releases its resources, but garbage collection and allocator behavior mean process memory need not immediately drop and no fixed drop time is guaranteed.

### Onboarding and troubleshooting

After AI-assisted CLI/Skill installation or first project onboarding, inspect the intended workspace and both current-process and persistent `MIKIT_ALIAS_CONFIG` values. Report the actual file and all fields above. Ask for missing root, port, domain, author if required, scan patterns, and manual mappings; do not invent them. Setting environment variables requires authorization, but do not ask again when that action was already approved. Explain the two startup modes and provide the configuration tutorial even when installation itself succeeded.

- Missing `Alias config:` or file errors: check the process variable, full file path, JSON syntax, and whether a stale environment value overrides discovery.
- `No project loaded` or missing targets: inspect the absolute root, relative mappings, and exact directory depth of scan patterns.
- Port in use: stop the user's earlier server when authorized, or select another available port; restart after a JSON port change.
- Localhost works but the subdomain fails: verify DNS/hosts and the actual hostname and port.

`mikit build` also reads this alias file for global author fallback or Editor, but it still builds the current consumer project; setting an alias root is not a request to build all mapped projects.

## Build

```powershell
mikit build
mikit build --min
mikit build --mincss
mikit build --mincss --minfont
mikit build --output custom-dist --png
mikit build --autoprefixer
```

Important flags:

- `--output <dir>`: output directory, default `dist`.
- `--min`: minify HTML, CSS, and JavaScript.
- `--minhtml`, `--mincss`, `--minjs`: selective minification.
- `--png`: run the configured PNG optimization during build. The default is 256-color quantization; it is lossless only when `mikit.png.mode` is explicitly `lossless`.
- `--autoprefixer`: add CSS prefixes according to the project's Browserslist configuration.

When the user enables Autoprefixer during initialization:

1. Check `package.json > browserslist` and `.browserslistrc` first. Preserve an existing valid configuration and tell the user which one will be used.
2. If no configuration exists, ask which browser range must be supported. Do not invent legacy-browser requirements.
3. Offer the following common starting point only as a recommendation that requires confirmation:

```json
{
  "browserslist": [
    "> 0.5%",
    "last 2 versions",
    "not dead"
  ]
}
```

4. Prefer adding `browserslist` to the existing `package.json` for a new setup. Do not also create `.browserslistrc`, because competing configuration sources make the effective target unclear.
- `--minfont`: subset local fonts after building. By default, recursively discover `wwwroot/**/*.shtml`, exclude files whose basename starts with `_`, and scan their same-path `.html` build outputs.
- `--font-page <page>`: override the default static SHTML discovery with an output-relative HTML file or glob. It is not a dynamic URL option.

The build clears its output directory by default. Use `mikit.build.cleanKeep` only when selected output directories should survive cleanup, and keep manually maintained source files in `wwwroot`.

### Build Output Cleanup

Configure this in the consumer project's `package.json`:

```json
{
  "mikit": {
    "build": {
      "cleanKeep": ["font", "img/origin"]
    }
  }
}
```

- Missing `mikit.build`, missing `cleanKeep`, or `cleanKeep: []` clears the entire output as before. `mikit init` emits `build: { cleanKeep: [] }`.
- Entries are explicit directory paths relative to the actual output: this example preserves `dist/font` and `dist/img/origin`, or `custom-dist/font` and `custom-dist/img/origin` with `--output custom-dist`. The names are examples; use the user's confirmed directories. Multiple directories and nested paths are supported.
- Only listed directories and their necessary parents survive cleanup. Preserving `img/origin` does not preserve other files or directories under `img`. Duplicate and overlapping entries are accepted; a preserved parent includes its whole tree. Windows path matching is case insensitive.
- Preserved trees remain unchanged throughout `mikit build`. Matching source trees are not copied, compiled, minified, or overwritten. Integrated `--minfont` and `--png` processing skips these trees; font analysis excludes their HTML, CSS, scripts, and mapped runtime pages. A kept `font/vendor` subtree is neither staged nor replaced while other fonts can still be processed.
- Use `/` or escaped `\\` in JSON. The value must be an array of nonempty relative directory paths, with no absolute paths, `..`, `*`, or `?`. Existing paths must point to directories; symbolic links and Windows junctions are rejected in preserved paths and their trees. Invalid configuration or paths fail before cleanup.
- Missing directories are allowed; matching source trees are also skipped, so the build does not populate the kept directory. The setting affects only `mikit build` and its integrated processing. Independent `mikit font`, `mikit png`, `mikit replace`, and `mikit pack` commands retain their configured scope, including when chained in an npm script.

### Build Attribution Header

Configure the original project author in `package.json`:

```json
{
  "mikit": {
    "author": "project-author(employee-id)"
  }
}
```

The global author is read from `mikit.alias.json > author`. Mikit first uses `MIKIT_ALIAS_CONFIG`; when it is absent, Mikit walks upward from the current project/root and uses the nearest `mikit.alias.json`:

```json
{
  "author": "global-author(employee-id)"
}
```

Build output CSS, JavaScript, and Sass-generated CSS receive an `Author`, optional `Editor`, and local `Compile Date` header after minification, Autoprefixer, and Sass compilation. All files in one build share one timestamp. When both authors exist, the project author is `Author` and the global author is `Editor`. When the project author is missing or blank, the global author becomes `Author` and `Editor` is omitted. When only the project author exists, the header keeps only that `Author`. If neither author is available, no header is added and the build prints one reminder. This behavior belongs to `mikit build`, not `mikit pack`.

## Font Static and Runtime Collection

Static collection is automatic: Mikit recursively discovers `wwwroot/**/*.shtml`, excludes files whose basename starts with `_`, and scans the corresponding same-path `.html` files in the build output. A dedicated `font.shtml` is not required. Use `--font-page` only when the consumer project needs to override this default page set.

Dynamic collection is separate and supplements static results. Configure rendered HTTP/HTTPS pages in `mikit.font.pages`; an empty array or omitted `pages` keeps the browser from starting.

```json
{
  "mikit": {
    "font": {
      "pages": [
        "http://site.example.test:8080/index.shtml?state=1"
      ],
      "waitFor": ".page-ready",
      "wait": 1000,
      "timeout": 15000,
      "browserExecutable": "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "asciiBaseline": "none",
      "dynamicTextPolicy": "warn",
      "globalExtraText": "",
      "familyExtraText": {},
      "generatedFamilyExtraText": {},
      "familyOptions": {}
    }
  }
}
```

- `pages`: HTTP/HTTPS URLs whose rendered text supplements static HTML/CSS scanning. An empty array avoids browser startup.
- `waitFor`: optional non-empty CSS selector.
- `wait`: non-negative delay in milliseconds after readiness.
- `timeout`: positive page/selector timeout in milliseconds.
- `browserExecutable`: optional browser executable path; omit it to use supported local Chrome/Edge discovery.
- `asciiBaseline`: `none` by default (only observed/explicit characters); `common` adds common digits and punctuation; `full` adds ASCII 32–126.
- `globalExtraText`: characters explicitly added to all font families.
- `familyExtraText`: user-owned CSS `font-family` keyed strings for family-specific additions. Preserve existing values, including those configured before generated supplements were supported.
- `generatedFamilyExtraText`: optional Skill-managed strings keyed by CSS `font-family`, defaulting to `{}`. Mikit combines these with collected text, global supplements, user supplements, and the ASCII baseline, deduplicating Unicode characters. It does not edit configuration or infer obsolete text. The Skill refreshes generated entries only with sufficient source evidence; user supplements are not migrated or deleted. Both per-family maps apply to all weights and styles of the family.
- `familyOptions`: CSS `font-family` keyed objects such as `{ "Title": { "asciiBaseline": "common" } }`.
- `dynamicTextPolicy`: `warn` by default for unresolved text; `error` stops publication when such risks occur.

Successful operations print the full path to the Markdown report, `font/font-report.md` by default; a custom manifest directory also determines the report location. Markdown replaces the former JSON report, while complete character lists remain in TXT files. Read “结果概览” for totals and “待处理事项” for source-font gaps, unresolved dynamic copy, digit coverage to confirm, and fonts whose validation did not run. “字体明细” lists deduplicated character-source counts, the effective ASCII policy, validation, TXT links, and per-format files, sizes, and reductions; a missing original file of the same format is marked as not comparable. “扫描来源与覆盖边界” lists scanned pages: omitting `pages` means no browser DOM collection, and configured pages cover only observed states.

Uncollected digits do not establish actual missing glyphs. Default `asciiBaseline: "none"` does not auto-add digits. For authorized font work, follow [dynamic font analysis](dynamic-fonts.md): maintain per-family digits in generatedFamilyExtraText when source evidence proves a changing numeric display and its font; ask only when content, font ownership, or required URLs remain unknown. Preserve existing ASCII settings and rerun to check the report and pages. Source-font gaps require a suitable replacement or fallback font; adding text cannot create glyphs absent from the original font. Unperformed validation must not be treated as a pass. Font generation, character lists, and report publication are staged and rolled back together on failure. Successful publication removes the old JSON report; an operation with no effective fonts produces no report and removes stale reports.

Font operations require `fonttools`; Brotli is needed when CSS references WOFF2. Mikit recursively scans built `**/*.css` under the output directory (including `scss/`) and built HTML `<style>` blocks, not source SCSS. After collection, it keeps only fonts locally referenced by CSS with at least one extracted character, and only the TTF, WOFF, or WOFF2 formats referenced for each font. A WOFF-only declaration requires an original WOFF file; missing usable input is reported with its path before fonts are removed. Unreferenced and zero-character fonts are removed. Dynamic URL collection additionally requires a reachable local page and Chrome or Edge.

## PNG Optimization

```json
{
  "mikit": {
    "png": {
      "root": "dist",
      "mode": "quantize",
      "colors": 256,
      "exclude": ["vendor/**", "keep/*.png"]
    }
  }
}
```

- `root`: directory scanned recursively for PNG files; default `dist`.
- `mode`: `quantize` (recommended default) or `lossless`.
- `colors`: `2` to `256`, used only by `quantize`; default and recommended starting value is `256`.
- `level`: `fast`, `balanced`, or `max`, used only by `lossless`; default `balanced`.
- `exclude`: glob patterns relative to `root`.

During initialization, always give the user an explicit choice between keeping `exclude` empty and configuring exclusions; do not turn an omitted answer into “no exclusions.” Reuse the earlier project-directory inspection: when it finds `img/txt` or `img/origin` under `root`, recommend `img/txt/**` or `img/origin/**` respectively. If the output root has not been generated yet but the same relative directory exists in source content that the build will copy to the output, it may be recommended on that basis. Present detected paths as recommendations and add them only after the user confirms.

`quantize` reduces the PNG palette and is lossy even at 256 colors. Use it when smaller files are preferred and verify representative gradients and transparent edges. Use `lossless` when decoded pixels must remain identical. In both modes, Mikit only replaces a file when the result is smaller.

## Built Text Replacement

```json
{
  "mikit": {
    "replace": {
      "root": "dist",
      "include": ["**/*.css"],
      "rules": [
        {
          "include": ["**/*.css"],
          "from": "../img/",
          "to": {
            "development": "https://img.example.test/development/",
            "production": "https://img.example.test/prod/"
          }
        }
      ]
    }
  }
}
```

- `root`: replacement root, default `dist`.
- Top-level `include`: glob patterns relative to `root`, default `['**/*.css']`. Existing explicit CSS-only configurations remain CSS-only. Add `**/*.html`, `**/*.shtml`, `**/*.js`, or `**/*.vue` only when those text types are requested.
- `rules`: ordered literal replacements. Per-rule `include` narrows the top-level selection; omitting it applies the rule to all top-level selected files. A rule cannot select files outside the top-level scope.
- `disabled: true`: skip a rule.
- `env`: optional string or array limiting a rule to `NODE_ENV` values.
- `to`: a string or an environment map with an applicable key or `default`.

The generated scripts use `NODE_ENV=development` for `replace:dev` and `NODE_ENV=production` for `replace:build`, so a two-environment address map normally uses `development` and `production`. If every environment shares the same destination, use one string instead. If an environment map needs a fallback for additional environment names, add `default` explicitly.

For example, with top-level `include: ["**/*.css", "**/*.shtml"]`, use a CSS rule with `include: ["**/*.css"]` and `from: "../img/"`, and an SHTML rule with `include: ["**/*.shtml"]` and `from: "img/"`. HTML, JS, and Vue follow the same explicit-selection pattern. Only selected valid UTF-8 text files are processed; accidental binary matches fail. Replacement is literal, ordered, and in place on built files.

## Go Template Packing

```json
{
  "mikit": {
    "pack": {
      "source": "wwwroot",
      "dist": "dist",
      "output": "packed",
      "pageDirs": [".", "include"],
      "assetDirs": ["js", "css"],
      "excludePages": ["*font*.shtml"]
    }
  }
}
```

- SHTML pages come from `source/pageDirs`.
- Assets come from `dist/assetDirs`.
- SSI virtual includes are converted to Go template include syntax.
- `excludePages` uses file-name wildcard patterns.
- Source, dist, and output paths must not overlap unsafely.
- All configured input directories are checked before `output` is reset.

## SVN CSS Synchronization

Multiple targets:

```json
{
  "mikit": {
    "syncSvn": {
      "source": "dist/css",
      "targets": [
        "F:/SVN/project-a/view/css",
        "F:/SVN/project-b/view/css"
      ],
      "files": ["*"]
    }
  }
}
```

Legacy single target:

```json
{
  "mikit": {
    "syncSvn": {
      "source": "dist/css",
      "target": "F:/SVN/project/view/css",
      "files": ["index.css", "*.min.css"]
    }
  }
}
```

Rules:

- Configure `target` or `targets`, never both.
- `targets` must be a non-empty string array. Duplicate Windows paths are removed case-insensitively.
- `files` selects direct `.css` files from `source`; `"*"` means `"*.css"`.
- Every target directory is preflighted before any copy occurs.
- Identical SHA-256 content is skipped; copied files are hashed again for verification.
- The command does not create directories or perform any SVN metadata operation.
