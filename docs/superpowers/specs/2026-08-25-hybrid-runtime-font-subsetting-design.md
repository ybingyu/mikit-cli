# Mikit Hybrid Runtime Font Subsetting Design

**Date:** 2026-08-25

## Goal

Extend the existing `mikit font` and `mikit build --minfont` workflow so font character manifests include both:

1. literal text from built HTML templates, including inactive `v-if`, `v-else-if`, `v-else`, `v-show`, hidden panels, and unopened popup branches; and
2. text produced only after JavaScript runs on an explicit list of URLs, including Vue-rendered arrays, query-parameter variants, API data, and interpolated values.

The result must remain deterministic and auditable: characters are grouped by the actual local `font-family`, merged into the existing per-font TXT manifests, and passed to the existing `pyftsubset` pipeline. AI-based guessing and automatic UI exploration are not part of the first version.

## Chosen approach

Use a hybrid collector:

```text
built HTML template scan
          +
explicit URL runtime scan
          ↓
per-font character merge and deduplication
          ↓
existing TXT manifests
          ↓
existing TTF / WOFF / WOFF2 subsetting
```

The static collector remains responsible for text that may not exist in the current runtime DOM. The runtime collector launches an installed Chromium-family browser, executes the page, reads rendered text nodes, and obtains their computed `font-family` values.

Neither source replaces the other. The final character set is their union.

## Configuration

Runtime font settings live under `mikit.font` in the current project's `package.json`:

```json
{
  "mikit": {
    "font": {
      "pages": [
        "http://wb.y.bindyy.cn:8080/index.shtml?o=1",
        "http://wb.y.bindyy.cn:8080/index.shtml?o=2"
      ],
      "waitFor": "#app",
      "wait": 1000,
      "timeout": 15000,
      "browserExecutable": ""
    }
  }
}
```

Configuration rules:

- `pages` is an ordered array of explicit HTTP or HTTPS URLs. Empty or missing `pages` preserves the current static-only behavior and does not launch a browser.
- `waitFor` is an optional CSS selector. When present, every page must contain a matching element before collection starts.
- `wait` is an additional non-negative delay in milliseconds after DOM readiness and `waitFor` success. It defaults to `1000` when runtime pages are configured.
- `timeout` is the positive navigation and selector-wait timeout in milliseconds. It defaults to `15000`.
- `browserExecutable` is an optional browser executable path. An empty or missing value asks Mikit to locate an installed Chrome or Edge browser.
- Unknown keys do not change behavior. Invalid types, invalid URLs, negative delays, or a non-existent explicit browser path fail before font files are modified.

The existing CLI options remain supported:

- `--font-page <page>` controls the existing static scan page or glob.
- `--font-manifest <directory>` controls manifest output.
- CLI options continue to override their existing defaults; runtime URL configuration comes from `mikit.font`.

No automatic URL guessing is performed. Mikit does not try `o=1`, `o=2`, or other query values unless they are listed in `pages`.

## Static template collection

The existing built-HTML/CSS parser remains active. It must continue treating framework directives as inert HTML attributes rather than evaluating their conditions.

For example:

```html
<a v-if="btnDiscountStatus==0">
  <span>1.9元</span><b>点击抢购</b>
</a>
<a v-else>
  <span>已购买</span>
</a>
```

The static result includes characters from both `1.9元点击抢购` and `已购买`, regardless of the current value of `btnDiscountStatus`.

Static collection includes:

- normal text nodes;
- inactive `v-if`, `v-else-if`, and `v-else` branches still present in built HTML;
- `v-show` content;
- nodes hidden by CSS;
- unopened popup and tab-panel markup;
- `<template>` element content represented as normal template markup.

Static collection continues excluding executable `<script>` and `<style>` contents. JavaScript source strings are not treated as page text because they cannot be mapped reliably to a rendered font family.

### Static target resolution for runtime URLs

To capture inactive branches from the same templates used by runtime pages, Mikit adds local static targets derived from each configured URL:

- the query string and hash are ignored;
- `/index.shtml` maps to `dist/index.html`;
- another `.shtml` pathname maps to the same relative pathname with `.html`;
- a pathname ending in `/` maps to `index.html` under that path.

Derived files are deduplicated and merged with the existing `--font-page` targets. A missing derived local file is reported as a warning because an explicit URL may legitimately point to a page outside the current build output. The URL is still scanned at runtime.

The existing static behavior remains available even when no runtime pages are configured.

## Runtime page collection

### Browser driver

Use `playwright-core` rather than downloading a bundled browser. Mikit launches an already installed Chrome or Edge executable.

Browser resolution order:

1. `mikit.font.browserExecutable` when configured;
2. the `MIKIT_BROWSER_EXECUTABLE` environment variable;
3. supported Chrome and Edge executable locations for the current operating system.

If runtime pages are configured and no browser can be found, the command fails with an actionable error. Static-only font processing does not require Playwright or a browser launch.

The browser runs headlessly and is always closed in a `finally` path, including navigation, extraction, and subsetting failures.

### Page readiness

For every configured URL, Mikit:

1. navigates and waits for `domcontentloaded`;
2. waits for `waitFor` when configured;
3. waits the configured additional `wait` delay;
4. extracts the runtime characters.

The collector does not use `networkidle` because Mikit development pages may contain hot-reload polling and therefore never become network-idle.

The first version does not click buttons, switch tabs, mutate Vue state, submit forms, or infer actions. Alternative states must be represented either by static template branches or by explicitly configured URLs.

### Runtime text and font mapping

Runtime extraction walks DOM text nodes after page readiness. It excludes text under `script`, `style`, and `noscript` elements. It does not require nodes to be visible, so `display: none`, `visibility: hidden`, `v-show="false"`, unopened popups, and hidden panels remain eligible.

For each text node:

1. whitespace is normalized consistently with the existing static collector;
2. the parent element's `getComputedStyle(element).fontFamily` is read;
3. the first effective family is normalized and matched case-insensitively against local families discovered from CSS `@font-face` mappings;
4. matching characters are added to that family's ordered set.

A runtime text node whose computed family does not match a local font is ignored, matching the existing behavior of only subsetting locally referenced fonts.

The runtime collector does not extract generated `::before` or `::after` CSS `content` in the first version.

## Merge and manifest behavior

Static and runtime results use the same canonical family names obtained from the existing CSS/font plan. For each local font:

1. preserve the static collector's character order;
2. append previously unseen runtime characters in configured page order and DOM order;
3. remove duplicates by Unicode code point;
4. write the existing human-readable `<font-name>.txt` manifest;
5. run the existing `pyftsubset --text-file` TTF, WOFF, and WOFF2 workflow.

The merge must not combine unrelated font families. A CSS family name that differs from its font filename continues to use the existing `@font-face` mapping.

Logs identify the sources used and make missing coverage diagnosable. Example:

```text
字体静态页面: index.html
字体运行时页面: index.shtml?o=1
字体运行时页面: index.shtml?o=2
字体字符清单: SourceHanSansCN-Medium.txt（静态 42，运行时新增 11，合计 53）
```

Query strings may remain in per-page logs, but browser executable paths and full DOM content are not printed.

## Command behavior

### Standalone processing

```powershell
mikit font
```

The command loads `mikit.font`, scans the existing output directory, optionally collects configured runtime URLs, writes manifests, and subsets fonts.

### Build integration

```powershell
mikit build --mincss --minfont
```

Normal build output is completed first. Font processing then uses the effective build output directory for static templates and font assets while runtime pages use the explicit configured URLs.

Mikit does not automatically start `mikit start`. If configured URLs point to a local Mikit development server, that server must already be running. An unreachable URL fails clearly rather than silently producing an incomplete font.

### Backward compatibility

Projects without `mikit.font.pages` retain current behavior:

- no browser is launched;
- the existing `font.html` preference and root-HTML fallback remain available;
- existing manifests, backups, remote-font handling, and `pyftsubset` output remain unchanged.

## Failure handling

Runtime collection is correctness-critical. The command exits non-zero before subsetting when any of these occur:

- invalid runtime configuration;
- no usable browser when `pages` is non-empty;
- navigation failure or timeout;
- configured `waitFor` selector timeout;
- page closes or crashes during extraction;
- runtime extraction returns malformed data.

A JavaScript console error is logged as a warning but does not fail the command by itself, because unrelated analytics and third-party scripts may fail while the required page content still renders.

All runtime pages must complete successfully. Partial runtime results are not used to produce subset fonts.

Existing font backup and replacement safety behavior remains unchanged. Runtime collection completes before any subset files replace existing font files.

## AI boundary

AI is not part of the required character pipeline. The first version must be deterministic and reproducible from configuration, HTML, CSS, and rendered DOM state.

A later optional diagnostic command may inspect source code and suggest possibly missing URL parameters or states, but it must never silently add guessed characters or control the browser during normal font packaging.

## Implementation boundaries

Expected implementation areas:

- `lib/font-subsetter.js`: merge static and runtime character maps and derive local template targets from URLs;
- a focused runtime collector module, rather than placing browser lifecycle code inside the HTML parser;
- `lib/project-config.js` or a font-specific configuration loader for `mikit.font` validation;
- `bin/mikit.js` and `lib/builder.js`: pass project font configuration through standalone and build flows;
- `lib/project-initializer.js`: add a disabled-by-default starter configuration of `"font": { "pages": [], "wait": 1000, "timeout": 15000 }` while preserving every existing generated workflow entry;
- `package.json` and `package-lock.json`: add the browser driver dependency;
- focused unit/CLI tests and README documentation.

The runtime collector and static parser remain separate modules with a small data contract: each returns a per-family character map. Browser discovery, navigation, DOM extraction, merging, manifest writing, and `pyftsubset` execution must remain independently testable.

No unrelated builder, server, replacement, PNG, pack, or SVN behavior will be refactored.

## Verification

Tests are written before production changes and cover:

- `v-if` and `v-else` literal text both remaining in static collection;
- runtime results adding characters absent from static HTML;
- per-family merging, Unicode code-point deduplication, and deterministic ordering;
- two explicit query-parameter URLs contributing different characters;
- hidden runtime nodes remaining eligible;
- script/style/noscript contents being excluded;
- computed family normalization and `@font-face` filename mapping;
- URL pathname to local `dist/*.html` target derivation;
- missing derived templates warning without skipping runtime collection;
- invalid URL, invalid delay, missing browser, navigation failure, and `waitFor` timeout behavior;
- no browser launch when `pages` is absent or empty;
- standalone `mikit font` and `mikit build --minfont` integration;
- preservation of existing remote-font movement, backup, and output behavior.

Browser-dependent code is exercised through an injectable browser adapter in the normal automated test suite so tests do not depend on a developer's installed Chrome. A focused real-browser smoke test against a local fixture is also documented and run during final verification when Chrome or Edge is available.

Final verification runs:

- focused font tests;
- the complete `npm test` suite;
- syntax checks for every changed JavaScript file;
- `git diff --check`;
- a real local fixture containing URL variants and Vue-style conditional branches;
- final diff review to ensure unrelated files and generated consumer-project output were not changed.

## Non-goals

The first version does not:

- automatically guess URL parameters;
- click buttons or attempt to reach every application state;
- call project APIs directly;
- parse arbitrary JavaScript strings as visible page content;
- extract CSS pseudo-element `content`;
- start or stop the Mikit development server;
- use AI to decide which characters enter a production font manifest.
