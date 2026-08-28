# Mikit Configuration Reference

Load only the sections needed for the current request. The consumer project's `package.json` is authoritative.

## Invocation and Initialization

A project may use one of these forms:

```powershell
mikit <command>
npx mikit <command>
npm run <project-script>
```

`mikit init` creates `package.json` only when that file does not already exist. It generates scripts for build, font build, PNG, replacement, packing, and SVN synchronization, plus starter `mikit` sections. The starter replacement rule is enabled and contains an example URL, so it must be reviewed before running replacement or a script that includes replacement.

For an existing `package.json`, merge only the requested sections instead of recreating the file.

## Development Server

```powershell
mikit start --port 8080 --root . --domain y.bindyy.cn
mikit start --root "F:/NDW" --alias "F:/NDW/mikit.alias.json"
```

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
- `--png`: lossless PNG optimization during build.
- `--autoprefixer`: add CSS prefixes.
- `--minfont`: subset local fonts after building. By default, recursively discover `wwwroot/**/*.shtml`, exclude files whose basename starts with `_`, and scan their same-path `.html` build outputs.
- `--font-page <page>`: override the default static SHTML discovery with an output-relative HTML file or glob. It is not a dynamic URL option.

The build replaces its output directory. Do not put manually maintained source files there.

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
      "level": "balanced",
      "exclude": ["vendor/**", "keep/*.png"]
    }
  }
}
```

- `root`: directory scanned recursively for PNG files; default `dist`.
- `level`: `fast`, `balanced`, or `max`.
- `exclude`: glob patterns relative to `root`.

The optimization is lossless and only writes a file when the compressed output is smaller.

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
            "default": "https://img.example.test/dev/",
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
