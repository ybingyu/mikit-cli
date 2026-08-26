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
- Do not enable optional font browser scanning unless the user needs dynamic-page text collection.
- Preserve legacy `mikit.syncSvn.target` when it is already valid. Use `targets` for multiple destinations, and never configure both fields.
- Interpret `mikit.syncSvn.files: ["*"]` as direct CSS files only, not arbitrary files or recursive content.
- Do not add preview or dry-run behavior unless the user explicitly requests a new CLI feature.

## Respect Mutation Boundaries

- Building may replace the configured build output. Packing resets its configured output directory after input preflight. Run these commands only when the user requested the corresponding generated artifact.
- `mikit replace`, `mikit png`, and `mikit font` modify configured generated files in place. Confirm that the configured root is the intended output before running them.
- `mikit sync-svn` performs the configured copy directly. It must not run `svn add`, `svn delete`, `svn commit`, create missing SVN directories, or delete content.
- Do not manually edit generated output to imitate a successful command. Fix source or configuration and rerun the CLI.

## Verify the Result

After a mutating command:

1. Check the command exit status and retain the command-prefixed error if it fails.
2. Confirm expected output directories or files exist.
3. For configuration edits, parse `package.json` and inspect the focused diff.
4. For builds, packing, PNG, replacement, or font operations, inspect representative artifacts relevant to the request.
5. For font subsetting, verify the expected TTF, WOFF, and WOFF2 outputs when fonts were processed.
6. For SVN synchronization, report target count and copied/skipped counts; do not claim an SVN commit occurred.
7. Run proportionate syntax, project tests, or `git diff --check` when repository files were changed.

Report what was changed, which command ran, what was verified, and any remaining manual prerequisite.
