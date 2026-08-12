# Mikit Build Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add reusable, package.json-configured `replace`, `pack`, and `sync-svn` commands to mikit-cli.

**Architecture:** A shared project-config loader validates the current project's `package.json`. Three focused libraries own CSS replacement, Go-template packaging, and CSS-to-SVN synchronization, while `bin/mikit.js` only registers commands and reports failures.

**Tech Stack:** Node.js CommonJS, commander, fs-extra, glob, SHA-256 via node:crypto, assert-based integration tests.

---

### Task 1: Project configuration and CSS replacement

**Files:**
- Create: `lib/project-config.js`
- Create: `lib/css-replacer.js`
- Test: `tests/build-workflow.test.js`

- [x] Write a failing fixture test that loads `mikit.replace` from `package.json`, finds configured CSS globs, applies ordered literal rules, selects environment-specific targets, and leaves non-CSS files unchanged.
- [x] Run `node tests/build-workflow.test.js` and confirm it fails because the new modules do not exist.
- [x] Implement strict package/config loading and the minimal replacement behavior.
- [x] Re-run the test and confirm the replacement assertions pass.

### Task 2: Go-template package output

**Files:**
- Create: `lib/go-packer.js`
- Test: `tests/build-workflow.test.js`

- [x] Add failing assertions for configured page directories, exclusion patterns, SSI-to-Go conversion, and recursive copying of configured `dist` asset directories.
- [x] Validate every input, safely clear the configured output directory, then generate a fresh package without stale files.
- [x] Re-run the test and confirm package output matches the fixture.

### Task 3: CSS synchronization to SVN

**Files:**
- Create: `lib/svn-css-sync.js`
- Test: `tests/build-workflow.test.js`

- [x] Add failing assertions that `files: ["*"]` selects every direct `.css` file, excludes non-CSS files, skips identical targets, copies changed files, and verifies copied hashes.
- [x] Implement wildcard matching, source/target validation, SHA-256 comparison, and copy verification.
- [x] Re-run the test and confirm synchronization assertions pass.

### Task 4: CLI integration and documentation

**Files:**
- Modify: `bin/mikit.js`
- Modify: `package.json`
- Modify: `README.md`
- Create: `tests/build-workflow-cli.test.js`

- [x] Add failing CLI tests for all three registered commands and clear errors when the relevant `mikit` configuration is absent.
- [x] Register `replace`, `pack`, and `sync-svn` without a dry-run option.
- [x] Add both test files to `npm test`.
- [x] Document the complete `package.json` configuration, wildcard semantics, command examples, and non-deletion/non-commit behavior.
- [x] Run the CLI tests and full `npm test`.

### Task 5: Verification

**Files:**
- Verify all modified implementation, test, and documentation files.

- [x] Run `node --check` for every new/modified JavaScript file.
- [x] Run `npm test` and confirm all suites pass.
- [x] Run `git diff --check` and inspect `git diff` for unrelated changes.
