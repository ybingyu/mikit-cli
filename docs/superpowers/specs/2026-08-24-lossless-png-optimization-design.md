# Mikit Lossless PNG Optimization Design

**Date:** 2026-08-24

## Goal

Add recursive, strictly lossless PNG optimization for built assets. The feature must work both as a standalone `mikit png` command against an existing output directory and as the existing `mikit build --png` option after a build completes.

The optimizer must support project configuration, selectable effort presets, and exclusions for individual files or directory trees. It must not use color quantization, dithering, palette-size targets, or any other visually lossy transform.

## Chosen approach

Use `@napi-rs/image` and its synchronous `losslessCompressPngSync` API, which is powered by OxiPNG. This fits the current synchronous build pipeline and does not require users to install a separate executable.

The implementation will call only the lossless PNG API. It will not call `pngQuantize` or expose a color-count setting. Lossless reductions that preserve decoded pixels may remain enabled. Non-critical PNG headers will not be stripped.

## Configuration

Settings live under `mikit.png` in the current project's `package.json`:

```json
{
  "scripts": {
    "png": "mikit png"
  },
  "mikit": {
    "png": {
      "root": "dist",
      "level": "balanced",
      "exclude": [
        "img/no-compress.png",
        "img/original/**",
        "**/sprite-*.png"
      ]
    }
  }
}
```

- `root` is the standalone command's scan directory relative to the project. It defaults to `dist`.
- `level` accepts only `fast`, `balanced`, or `max`. It defaults to `balanced`.
- `exclude` is an array of glob patterns relative to the effective scan directory. It defaults to an empty array.
- PNG extension matching is case-insensitive and recursive.
- Invalid configuration produces a clear error before any image is modified.

## Effort presets

All presets are lossless. They differ only in the number of filter/compression alternatives considered:

- `fast`: tries a reduced filter set and uses heuristics to prioritize speed.
- `balanced`: tries the full filter set while using heuristics to avoid unproductive searches.
- `max`: tries the full filter set without the speed-oriented heuristic, prioritizing output size over runtime.

Every preset keeps color quantization and dithering disabled. Metadata stripping is disabled. A generated result is written only when it is smaller than the existing file.

These names are Mikit presets rather than direct aliases for OxiPNG command-line optimization numbers. They do not promise TinyPNG-like sizes because TinyPNG achieves much of its reduction through lossy color quantization.

## Command behavior

### Standalone command

```text
mikit png
```

The command loads `mikit.png`, scans its configured `root`, applies exclusions, optimizes matching files in place, and prints a summary.

If `package.json` has no `mikit.png` configuration, the command fails consistently with the existing package-configured workflow commands rather than silently using an undeclared project workflow.

### Build integration

```text
mikit build --png
mikit build --output custom-dist --png
```

After normal build processing and optional font subsetting finish, `build --png` runs the same optimizer. The build's effective output directory overrides `mikit.png.root` for that invocation. `level` and `exclude` still come from `mikit.png`.

If `--png` is provided but `mikit.png` is missing or invalid, the build fails clearly. Builds without `--png` remain unchanged.

## File handling and reporting

The optimizer reads the complete source file, produces the complete optimized buffer, compares sizes, and only then overwrites the original. A failed optimization never writes the failed output buffer.

An invalid or unsupported PNG reports the relative path and causes a non-zero command result. Files successfully processed before a later error are not rolled back.

The summary reports:

- scanned PNG count;
- optimized file count;
- excluded file count;
- files whose optimized result was not smaller;
- total bytes saved, formatted for display.

Example:

```text
[mikit png] 完成：扫描 18 个，压缩 12 个，排除 4 个，未缩小 2 个，节省 428.35 KB。
```

## Project initialization and documentation

`mikit init` will add:

- a `png` npm script using `mikit png`;
- starter `mikit.png` configuration with `root: "dist"`, `level: "balanced"`, and an empty exclusion list.

It will not make every generated build script run PNG optimization automatically. Users opt in through `mikit build --png` or the standalone npm script.

README documentation will cover configuration, exclusions, effort presets, standalone usage, build integration, strict-lossless guarantees, and the difference from TinyPNG/color-count tools.

## Implementation boundaries

Expected implementation files:

- new `lib/png-optimizer.js`;
- `bin/mikit.js`;
- `lib/builder.js`;
- `lib/project-initializer.js`;
- `package.json` and `package-lock.json`;
- PNG optimizer tests plus relevant CLI/initializer test updates;
- `README.md`.

Existing uncommitted changes to replacement-rule disabling, initializer scripts, tests, and README content must be preserved and integrated rather than reverted or overwritten.

## Verification

Tests will be written before production code and will cover:

- recursive PNG discovery and case-insensitive extensions;
- file and directory glob exclusions;
- all three preset mappings;
- pixel-lossless output expectations on representative fixtures;
- retaining the original when optimization does not reduce size;
- invalid configuration and invalid PNG errors;
- standalone CLI help, success output, and non-zero failure behavior;
- `build --png` using the actual build output directory;
- initializer defaults.

Final verification will run the focused failing/passing tests, the complete `npm test` suite, syntax checks for changed JavaScript files, `git diff --check`, and a review of the final diff to ensure unrelated working-tree changes remain intact.
