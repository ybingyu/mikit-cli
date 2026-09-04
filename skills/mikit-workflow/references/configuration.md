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

- Build output and minification: none, CSS only, or HTML/CSS/JavaScript; separately ask about Autoprefixer.
- Font subsetting (optional): ask as its own decision whether to enable `--minfont` or `mikit font`. If enabled, use automatic static discovery by default; request dynamic page URLs and timing/browser settings only when the user needs rendered dynamic text.
- PNG: keep the recommended 256-color quantization or switch to strict lossless; confirm the root, then explicitly ask whether to keep no exclusions or configure optional `exclude` patterns. If inspection found `img/txt` or `img/origin` in the effective PNG root or at the same relative path in source content that will be copied to the output root, recommend those detected directories as exclusions and wait for confirmation.
- CSS replacement: obtain the literal source string and either one shared destination or separate `development` and `production` destinations.
- Packing (optional): ask as its own decision whether it is needed and, if enabled, confirm all page, asset, output, and exclusion paths.
- SVN CSS synchronization (optional): ask as its own decision whether it is needed and, if enabled, obtain the existing target directory or directories plus direct CSS patterns.
- Development server and attribution: ask only when relevant or when required values are missing.

Batch ordinary unresolved choices into a concise question set. Font subsetting, packing, and SVN synchronization must still be presented as three separate numbered questions or input fields, each labeled optional. They may be shown in one message, but must not be collapsed into one combined question or silently treated as disabled. Ask detailed settings only for the optional features the user enables. Do not make optional capabilities mandatory merely because `mikit init` provides starter sections and scripts for them.

For an existing `package.json`, merge only the requested sections instead of recreating the file.

## Development Server

```powershell
mikit start --port 8080 --root . --domain y.bindyy.cn
mikit start --root "F:/NDW" --alias "F:/NDW/mikit.alias.json"
[Environment]::SetEnvironmentVariable('MIKIT_ALIAS_CONFIG', 'F:/NDW/mikit.alias.json', 'User')
```

`MIKIT_ALIAS_CONFIG` supplies a persistent alias path to new Windows processes. Alias resolution uses explicit `--alias` first, then `MIKIT_ALIAS_CONFIG`, then the nearest `mikit.alias.json` found by walking upward from the current root. `mikit build` uses the same file for the global author fallback or optional `Editor`, so parent-directory discovery still works when an IDE process did not inherit the user environment variable.

During AI-assisted installation or first project onboarding, guide the user through this alias check after `mikit --help` or Skill installation succeeds. Inspect the intended project/workspace root for an existing nearest-parent `mikit.alias.json` and inspect `MIKIT_ALIAS_CONFIG` without changing it. If a file exists, report its path and summarize whether `domain`, `port`, `auto`, `projects`, and `author` are present. If no usable file exists and the user expects same-port subdomain access or global build attribution, ask where the shared workspace root is, which domain and port to use, what global author to write, whether `auto` should scan project `wwwroot` folders, and which manual aliases are required. Set a Windows user environment variable only after explicit confirmation; for projects below the alias file, nearest-parent discovery is normally enough.

Supported options include:

- `--port`: development server port.
- `--root`: one project or a parent directory containing projects.
- `--domain`: base wildcard domain.
- `--alias`: alias and automatic project-discovery JSON.
- `--virtual`: virtual URL-to-physical-path mapping.

When the root itself contains `wwwroot`, Mikit serves that project. With a parent root, subdomains select child projects. `/dist/` exposes build output and does not receive the source-page hot-reload injection.

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
- `--autoprefixer`: add CSS prefixes.
- `--minfont`: subset local fonts after building. By default, recursively discover `wwwroot/**/*.shtml`, exclude files whose basename starts with `_`, and scan their same-path `.html` build outputs.
- `--font-page <page>`: override the default static SHTML discovery with an output-relative HTML file or glob. It is not a dynamic URL option.

The build replaces its output directory. Do not put manually maintained source files there.

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
      "browserExecutable": "C:/Program Files/Google/Chrome/Application/chrome.exe"
    }
  }
}
```

- `pages`: HTTP/HTTPS URLs whose rendered text supplements static HTML/CSS scanning. An empty array avoids browser startup.
- `waitFor`: optional non-empty CSS selector.
- `wait`: non-negative delay in milliseconds after readiness.
- `timeout`: positive page/selector timeout in milliseconds.
- `browserExecutable`: optional browser executable path; omit it to use supported local Chrome/Edge discovery.

Font operations require `fonttools` and Brotli so `pyftsubset` can generate TTF, WOFF, and WOFF2. After collection, Mikit keeps only fonts that are locally referenced by CSS and have at least one extracted character; each retained font keeps TTF, WOFF, and WOFF2, while unreferenced fonts, zero-character fonts, and other font formats are removed from the build output. Dynamic URL collection additionally requires a reachable local page and Chrome or Edge.

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

## CSS Replacement

```json
{
  "mikit": {
    "replace": {
      "root": "dist",
      "include": ["**/*.css"],
      "rules": [
        {
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
- `include`: CSS glob patterns.
- `rules`: ordered literal replacements.
- `disabled: true`: skip a rule.
- `env`: optional string or array limiting a rule to `NODE_ENV` values.
- `to`: a string or an environment map with an applicable key or `default`.

The generated scripts use `NODE_ENV=development` for `replace:dev` and `NODE_ENV=production` for `replace:build`, so a two-environment address map normally uses `development` and `production`. If every environment shares the same destination, use one string instead. If an environment map needs a fallback for additional environment names, add `default` explicitly.

Only matched CSS files are processed. Replacement is literal, ordered, and in place.

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
