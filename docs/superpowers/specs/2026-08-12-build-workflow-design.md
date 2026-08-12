# Mikit Build Workflow Design

**Date:** 2026-08-12

## Goal

Replace three project-local Node scripts with reusable `mikit replace`, `mikit pack`, and `mikit sync-svn` commands configured from the current project's `package.json`.

## Configuration

All settings live under the top-level `mikit` object in `package.json`:

- `mikit.replace`: CSS root, CSS include globs, ordered literal replacement rules, optional environment-specific targets.
- `mikit.pack`: source/output directories, page directories, copied asset directories, and excluded page patterns.
- `mikit.syncSvn`: source CSS directory, target SVN working-copy CSS directory, and file patterns.

`syncSvn.files` supports `"*"` and `"*.css"` as all CSS files in the configured source directory. Other patterns such as `style*.css` are also supported. Non-CSS files are never synchronized.

## Commands

- `mikit replace`: applies ordered literal replacements to matching CSS files. A rule may be restricted to an environment, and its target may select the current `NODE_ENV` with a `default` fallback.
- `mikit pack`: validates all inputs, safely clears the configured package output, converts `.shtml` SSI virtual includes to Go template includes, and copies configured `dist` asset directories into the fresh output.
- `mikit sync-svn`: copies changed CSS files into an existing SVN working-copy directory, skips byte-identical files, and verifies SHA-256 after copying.

## Safety and compatibility

`mikit pack` recursively clears only its validated project-local output directory before writing a fresh package. Other commands do not delete files, run `svn commit`, or synchronize non-CSS files. Missing configuration, source artifacts, or SVN target directories produce a clear error and a non-zero CLI exit status.
