---
name: mikit-workflow
description: Configure, run, verify, and troubleshoot Mikit-CLI workflows in existing static-site projects. Use when the user asks to initialize Mikit configuration, start its local server, build wwwroot, subset fonts, optimize PNG files, replace built CSS asset URLs, pack SHTML as Go templates, or sync configured CSS files to SVN working copies. Do not use for reimplementing Mikit internals or unrelated generic Node.js build tasks.
---

# Mikit Workflow

Use Mikit-CLI as the execution layer. This skill interprets the request, inspects the project, prepares only the necessary configuration, runs the existing command, and verifies the observable result. Do not copy Mikit implementation logic into the skill.

## Establish the Task

1. Identify the intended project root and requested outcome.
2. If the project path, target environment, output directory, dynamic font URL, replacement address, or SVN target is required but missing, ask for that value instead of inventing it.
3. Distinguish between changing Mikit-CLI itself and using Mikit in a consumer project. Use this workflow only for the latter unless the user explicitly asks to develop the CLI.

## Inspect Before Changing Anything

- Check `git status` and preserve unrelated work.
- Inspect `package.json`, `wwwroot`, `dist`, `packed`, and any alias configuration relevant to the request.
- Treat `wwwroot` as source. Treat `dist` and `packed` as generated output unless the user explicitly says otherwise.
- Read [configuration.md](references/configuration.md) only for the commands or configuration sections needed by the current task.
- Read [troubleshooting.md](references/troubleshooting.md) only after an environment, dependency, path, browser, or command failure.

## Guide AI-Assisted Installation

When the user asks an AI agent to install Mikit-CLI, install or update this Skill, or add Mikit to a consumer project, treat alias configuration as an onboarding step whenever development-server routing or global build attribution may be used. Installation is not complete just because `mikit --help` works.

- After CLI or Skill verification, inspect `MIKIT_ALIAS_CONFIG` and the nearest `mikit.alias.json` from the intended project root or workspace root.
- If an alias file exists, report its path and whether `domain`, `port`, `auto`, `projects`, and `author` are configured. Do not rewrite it unless the user asked to change it.
- If no usable alias file exists, guide the user to create a workspace-level `mikit.alias.json` such as `F:/NDW/mikit.alias.json` when several projects share one parent. Ask for the unified root, domain, port, global author, whether to enable `auto`, and any required manual `projects` aliases.
- Prefer nearest-parent discovery for projects under a common workspace. Offer `MIKIT_ALIAS_CONFIG` only as an optional persistent fallback for new terminal processes, and ask before setting or changing a Windows user environment variable.
- For same-port subdomain previews, remind the user that the visible port is shared and subdomains select projects, for example `http://project.y.bindyy.cn:8080/` and `http://project.y.bindyy.cn:8080/dist/`.

## Handle Initialization and Broad Configuration Requests

When the user asks to initialize Mikit, add Mikit to an existing project, or configure several capabilities together, do not limit discovery to the features named in the first sentence. Inspect the project first, then give the user a concise capability checklist and batch only the unresolved decisions. Explain detected values and safe defaults so the user can accept them instead of having to invent every field.

Treat font subsetting, packing, and SVN synchronization as three independent optional decisions. Ask each one as a separate numbered question or separate input field and label each as optional. They may appear in the same message, but do not combine them into one “other optional features” question and do not silently default any of them to disabled. Ask a feature's detailed follow-up values only after the user chooses to enable it.

- **Build:** confirm the source and output directories, then offer no minification, CSS-only minification (`--mincss`), or full HTML/CSS/JavaScript minification (`--min`). Also ask about Autoprefixer when the project may need browser prefixes. Mention that local-font subsetting is available, but collect the user's decision only in the separate optional font-subsetting question.
- **Font subsetting (optional):** separately ask whether to enable local-font subsetting through `--minfont` or `mikit font`. Mention the Python prerequisites before the user decides. If enabled, distinguish automatic static collection from optional dynamic-page collection. Inspect the website project for clear dynamic-text signals before deciding whether a follow-up is needed. Static collection normally needs no page configuration; when dynamic text is likely, ask the user to confirm the complete runtime URLs before writing `mikit.font.pages`.
- **PNG:** recommend the current default `mode: "quantize"` with `colors: 256`, clearly labeling it as 256-color lossy quantization. Ask whether to keep that recommended default or switch to strict `lossless`; ask for `fast`, `balanced`, or `max` only for lossless mode. Confirm the effective root. Separately ask whether to keep the optional exclusion list empty or configure `exclude` patterns; do not silently choose “none.” If project inspection already found `img/txt` or `img/origin` under the effective PNG root, or found the same relative directories in source content that will map into the output root, recommend the detected directories as candidate exclusions such as `img/txt/**` or `img/origin/**`. Ask the user to confirm the recommendation instead of adding it automatically.
- **CSS replacement:** inspect likely built CSS paths, but do not invent the literal `from` value or destination URLs. Ask whether development and production use different addresses. When they do, configure a `to` environment map with `development` and `production`, matching the generated `replace:dev` and `replace:build` scripts; otherwise a single string is sufficient.
- **Packing (optional):** separately ask whether the project needs SHTML-to-Go-template packing. If yes, confirm `source`, `dist`, `output`, `pageDirs`, `assetDirs`, and page exclusions before enabling or running it.
- **SVN synchronization (optional):** separately ask whether built CSS must be copied to SVN working copies. If yes, obtain the source CSS directory, one or more existing target directories, and direct CSS file patterns. Make clear that this does not add, commit, or publish SVN changes.
- **Development server and attribution:** when relevant, confirm the port/root/domain and any alias or virtual mappings. Inspect the project and global author settings; ask for the project author and employee number only when attribution is required and no usable value exists.

Do not force the user to configure every optional capability. Record declined features as out of scope, preserve already-valid project settings, and ask follow-up questions only for enabled features whose required values remain unknown. Before writing changes, summarize the resulting scripts and `mikit` sections that will be added or changed.

## Choose the CLI Invocation

Prefer the invocation already established by the project:

1. Use an existing npm script when it exactly represents the requested workflow.
2. Otherwise use `npx mikit ...` when `mikit-cli` is a project dependency.
3. Otherwise use `mikit ...` when the global command is available.
4. If Mikit-CLI is absent, explain which installation fits the project and obtain authorization before installing it. Do not silently install packages or Python dependencies.

Use `mikit --help` or `mikit <command> --help` when command support or options are uncertain.

## Route the Request

| Intent | Command |
| --- | --- |
| Add the standard Mikit workflow to a directory without `package.json` | `mikit init` |
| Start the development server | `mikit start` |
| Build `wwwroot` into production output | `mikit build` plus only the requested flags |
| Subset fonts in existing build output | `mikit font` |
| Optimize PNG files using project configuration | `mikit png` |
| Replace built CSS resource strings | `mikit replace` |
| Convert SHTML includes and collect configured assets | `mikit pack` |
| Copy configured direct CSS files to SVN working copies | `mikit sync-svn` |

## Configure Minimally

- `mikit init` refuses to overwrite an existing `package.json`. If one already exists, inspect it and merge only the required scripts and `mikit` sections.
- Keep paths relative to the consumer project when practical. In JSON on Windows, prefer `/` or escaped `\\` separators.
- Before a build, inspect `package.json > mikit.author` and the optional global `mikit.alias.json > author`. Do not invent either value. When the project author is empty, the global author becomes `Author`; only when both are empty will CSS/JS author headers be skipped.
- The global author comes from `mikit.alias.json > author`. Resolve the alias file in this order: explicit `--alias` where supported, `MIKIT_ALIAS_CONFIG`, then the nearest `mikit.alias.json` found by walking upward from the current root. With a project author it becomes `Editor`; without a project author it becomes `Author`. A missing path, unreadable file, invalid JSON, or empty global author does not block a build that still has a project author.
- Treat `mikit.png.mode: "quantize"` with `colors: 256` as the recommended default, not as lossless compression. Use `mode: "lossless"` only when the user requires pixel-identical output.
- For font subsetting, keep the default static discovery unless the user explicitly needs a narrower page set: Mikit scans `wwwroot/**/*.shtml`, excludes files whose basename starts with `_`, and maps each source page to the same-path `.html` in the build output. Use `--font-page` only to override this static discovery; do not require a dedicated `font.shtml`.
- Decide whether dynamic font collection needs a user follow-up:
  - If the project appears static, keep `mikit.font.pages` omitted or empty and explain that font collection is static-only; do not ask for runtime URLs without a concrete reason.
  - Treat Vue interpolation/directives, API-rendered copy, conditional states, button-triggered panels, rankings, countdowns, login states, or JavaScript-written text as signals that static scanning may be incomplete. These signals justify a question, not automatic configuration.
  - If the user already supplied complete HTTP/HTTPS URLs, validate and use them without asking the same question again.
  - If project files expose only candidate routes or query states, list those candidates and ask the user to confirm the complete URLs, including host, port, and every required state. Do not invent query parameters, state values, click sequences, authentication, or page coverage.
  - After URLs are confirmed, ask for `waitFor`, `wait`, `timeout`, or `browserExecutable` only when the page behavior requires non-default values.
  - If the user declines dynamic collection or cannot yet provide URLs, leave `pages` empty and clearly report that Vue/API/runtime-only text is not covered.
- `mikit.font.pages` is the browser-based dynamic collection setting and accepts complete HTTP/HTTPS URLs. `--font-page` only overrides the static built-HTML page set and must not be presented as a substitute.
- Preserve legacy `mikit.syncSvn.target` when it is already valid. Use `targets` for multiple destinations, and never configure both fields.
- Interpret `mikit.syncSvn.files: ["*"]` as direct CSS files only, not arbitrary files or recursive content.
- Do not add preview or dry-run behavior unless the user explicitly requests a new CLI feature.

## Respect Mutation Boundaries

- Building may replace the configured build output. Packing resets its configured output directory after input preflight. Run these commands only when the user requested the corresponding generated artifact.
- `mikit replace`, `mikit png`, and `mikit font` modify configured generated files in place. Confirm that the configured root is the intended output before running them. `mikit font` removes fonts that are not locally referenced by CSS or produce zero extracted characters, and leaves only TTF, WOFF, and WOFF2 for retained fonts.
- `mikit sync-svn` performs the configured copy directly. It must not run `svn add`, `svn delete`, `svn commit`, create missing SVN directories, or delete content.
- Do not manually edit generated output to imitate a successful command. Fix source or configuration and rerun the CLI.

## Verify the Result

After a mutating command:

1. Check the command exit status and retain the command-prefixed error if it fails.
2. Confirm expected output directories or files exist.
3. For configuration edits, parse `package.json` and inspect the focused diff.
4. For builds, packing, PNG, replacement, or font operations, inspect representative artifacts relevant to the request. When either the project or global author is configured, verify representative CSS and JavaScript headers and confirm Sass-generated CSS uses the same compile timestamp.
5. For font subsetting, verify that only CSS-referenced fonts with non-zero extracted characters remain, with TTF, WOFF, and WOFF2 outputs for each retained font.
6. For SVN synchronization, report target count and copied/skipped counts; do not claim an SVN commit occurred.
7. Run proportionate syntax, project tests, or `git diff --check` when repository files were changed.

### Report PNG Results Consistently

After `mikit png` or `mikit build --png`, report:

- The exact command and effective PNG root.
- The effective mode: `quantize` with its color count, or `lossless` with its level.
- The CLI summary counts for scanned, optimized, excluded, and unchanged files.
- The total bytes saved, using the CLI-formatted value.
- A representative artifact check when files were optimized. Identify the checked PNG and confirm it still exists and is readable; include before/after sizes only when they were actually captured.
- Any command failure or remaining prerequisite. If no file became smaller, say so explicitly instead of implying compression changed files.

Treat the Mikit CLI summary as the source of truth for totals. Do not invent per-file savings, and do not describe quantization as lossless.

Report what was changed, which command ran, what was verified, and any remaining manual prerequisite.
