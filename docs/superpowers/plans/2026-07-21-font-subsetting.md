# Font Subsetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reusable per-font subsetting to `mikit-cli` through `mikit build --minfont` and `mikit font`.

**Architecture:** A focused `lib/font-subsetter.js` module scans final build HTML/CSS, computes characters using CSS font inheritance, writes one manifest per local font, and invokes `pyftsubset` with `--text-file`. The builder and CLI only orchestrate this module, keeping font logic independent from file copying and minification.

**Tech Stack:** Node.js 18, Commander, existing `fs-extra`/`glob`, Python fonttools `pyftsubset`.

---

### Task 1: Font analysis core

**Files:**
- Create: `lib/font-subsetter.js`
- Create: `tests/font-subsetter.test.js`

- [ ] Write failing tests for CSS inheritance, child overrides, remote-font exclusion, and `--text-file` argv.
- [ ] Run `node --test tests/font-subsetter.test.js` and confirm the module is missing.
- [ ] Implement HTML parsing, CSS font-family rule parsing, local font planning, readable per-font manifests, and argv construction.
- [ ] Run the test again and confirm all assertions pass.

### Task 2: Font processing orchestration

**Files:**
- Modify: `lib/font-subsetter.js`
- Modify: `tests/font-subsetter.test.js`

- [ ] Add a failing orchestration test with an injected command runner and explicit fixture paths.
- [ ] Implement source backup, empty-font skipping, TTF/WOFF/WOFF2 generation, exact output replacement, and actionable missing-tool errors.
- [ ] Verify the focused test passes without invoking external fonttools.

### Task 3: CLI and builder integration

**Files:**
- Modify: `bin/mikit.js`
- Modify: `lib/builder.js`
- Create: `tests/font-cli.test.js`

- [ ] Write failing CLI help tests for `build --minfont`, `--font-page`, `--font-manifest`, and `mikit font`.
- [ ] Add the build options and standalone command.
- [ ] Invoke subsetting after final build files are written and before the success log.
- [ ] Verify CLI help tests pass.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`

- [ ] Document commands, defaults, manifests, empty/remote behavior, and the `pyftsubset` prerequisite.
- [ ] Add a focused `npm test` command for the new tests.
- [ ] Run syntax checks, unit tests, CLI help tests, and a real manifest scan against the skin project.
- [ ] Confirm existing `lib/server.js` and `tests/directory-listing.test.js` changes remain untouched.
