# Mikit Troubleshooting Reference

Use this reference only when setup or execution fails. Preserve the original command and error message before changing anything.

## Command Not Found

Check the project before choosing an installation:

```powershell
Get-Command mikit -ErrorAction SilentlyContinue
npm ls mikit-cli --depth=0
```

- If the project declares `mikit-cli`, use `npx mikit` or its npm scripts.
- If the user wants a global installation, request authorization before running `npm install -g mikit-cli`.
- For local Mikit-CLI development, a global file installation may point at the local repository, but do not assume that path on another machine.

After installation, run `mikit --help` or `npx mikit --help`.

## Missing or Invalid `package.json`

- Commands using `mikit.replace`, `mikit.pack`, `mikit.syncSvn`, or `mikit.png` require a readable project `package.json` and the corresponding object.
- `mikit init` creates a new file but refuses to overwrite an existing one.
- If JSON parsing fails, fix syntax narrowly and preserve unrelated scripts and dependencies.
- Validate after editing:

```powershell
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
```

## Windows and JSON Paths

In JSON, prefer forward slashes:

```json
"F:/SVN/project/view/css"
```

If backslashes are used, escape each one:

```json
"F:\\SVN\\project\\view\\css"
```

Use literal-path-aware PowerShell commands when inspecting paths containing Chinese characters, spaces, brackets, or wildcard characters.

## Hot Reload and Idle Watchers

- Open an existing source HTML/SHTML page before testing an edit. An inactive watcher before any page visit is expected; routing remains available. Asset requests and directory listings without an index do not activate it.
- Check the injected `id="mikit-hot-reload"` script and successful `/hot-update-status?project=...` requests under the current hostname. The query must match the routed project ID. Other computers and phones activate and renew watchers the same way as local browsers.
- `/dist` redirects to `/dist/`; both use build preview without hot reload or source-watcher registration/renewal. Do not diagnose the absence of automatic refresh there as a failure.
- Different source directories must stay isolated. Aliases sharing one resolved source directory intentionally share its watcher and updates.
- Closing one tab does not immediately release the watcher. All pages and devices using that source directory must stop heartbeats; release occurs about 5-5.5 minutes after the last heartbeat. Background tabs may keep polling.
- After suspension or network loss, let the returning page complete a status request. It reactivates the watcher and fully refreshes when the watcher session changed, including edits made while inactive.
- Do not infer leaked watchers solely from process memory failing to drop immediately. The server and automatic directory discovery retain baseline resources; garbage collection and memory reuse have no guaranteed release time.
- When a server run is authorized, verify source activation, project isolation, and the absence of dist registration with temporary fixtures; close all test services afterwards. Do not restart an existing service or leave a persistent server running without authorization.

## Build or Output Problems

- If `MIKIT_ALIAS_CONFIG` was just saved as a Windows user environment variable, an already-running IDE may not expose it through `process.env`. Mikit can still use the nearest `mikit.alias.json` found by walking upward from the current project/root; explicit `--alias` remains available for `start` and `serve`.
- If build output has no author header, check both `package.json > mikit.author` and the global `mikit.alias.json > author`. A valid global author becomes `Author` when the project author is empty; headers are skipped only when both values are unavailable.
- Confirm the command is running from the intended project root.
- Confirm `wwwroot` exists for a build.
- Confirm configured `dist`, `output`, or operation root points to generated content.
- Build output and pack output may be reset by their commands. Do not restore them by editing generated files; correct source/configuration and rerun.
- For pack failures, check every configured `pageDirs` and `assetDirs` directory. Input validation occurs before output reset.

## Font Problems

Check Python prerequisites:

```powershell
py -m pip show fonttools brotli
pyftsubset --help
```

Do not install missing packages without authorization.

For runtime page collection:

- Ensure each `mikit.font.pages` entry is a reachable HTTP/HTTPS URL.
- Start the local Mikit server first when URLs depend on it.
- Add each required state URL explicitly; Mikit does not guess query parameters or click page controls.
- Increase `wait`, use `waitFor`, or increase `timeout` only when the page actually needs it.
- Verify Chrome or Edge is installed, or provide a valid `browserExecutable`.
- A main page HTTP error fails collection; unrelated non-font resource errors may be ignored, while font resource HTTP failures are reported.

After a successful font operation, follow the printed full path to the Markdown report (`font/font-report.md` by default, or the configured manifest directory). Read it in this order:

1. Check “结果概览” and “待处理事项”. “源字体缺字” lists requested characters absent from the original font, including Unicode code points; replace the font or configure a fallback because adding text cannot create missing glyphs. “动态文字风险” identifies unresolved copy by page, family, and expression or dependency. “未执行字体验证” means coverage is unknown, not passed.
2. If “数字覆盖待确认” appears, follow [dynamic font analysis](dynamic-fonts.md) to inspect the source before asking the user. Proven changing numeric displays with known fonts should receive merged per-family digits proactively; uncertain copy or font ownership still requires clarification. These are uncollected digits, not proof of source-font gaps. The report provides JSON configuration examples; replace placeholders and preserve existing configuration, then rerun and verify. The CLI default remains `asciiBaseline: "none"`.
3. Use “字体明细” to check character-source counts, the effective ASCII policy, verification, and linked TXT character lists and font files. Compare sizes only against an existing original of the same format; otherwise the report marks them as not comparable.
4. Check “扫描来源与覆盖边界”. Without `pages`, no browser DOM collection ran; configured pages cover only observed DOM states. Confirm API responses, user input, asynchronous updates, and uncollected interaction states separately.

Then verify only the TTF, WOFF, or WOFF2 files actually referenced for each font in built CSS, including CSS under `scss/` or other output folders. For WOFF-only references, ensure the original WOFF exists before running the command. A failed operation preserves the previous fonts, character lists, and report. If no effective fonts remain, no new report is generated and stale reports are removed.

## PNG Problems

- Confirm `mikit.png.root` exists.
- Confirm `level` is exactly `fast`, `balanced`, or `max`.
- Confirm `exclude` is an array of non-empty glob strings.
- A valid run may report unchanged files when lossless compression cannot make them smaller.

## CSS Replacement Problems

- Confirm `mikit.replace.root` exists and `include` matches CSS files.
- Confirm every active rule has a non-empty `from` and a usable `to` value.
- Check the active `NODE_ENV` when `env` or environment-specific `to` values are used.
- Replacement is literal; do not treat `from` as a regular expression.

## SVN Synchronization Problems

- Confirm the source directory exists and contains direct CSS files matching `files`.
- Configure exactly one of `target` or `targets`.
- Confirm every target directory already exists. Mikit deliberately does not create SVN directories.
- Because all targets are preflighted, fix every invalid target before retrying.
- The command copies files only. Run SVN status or commit separately only when the user explicitly asks for it.

## Verification Discipline

If execution under an agent sandbox fails before Mikit starts, distinguish process-launch or permission failures from product failures. Retry only through an allowed execution route; do not change Mikit code merely because the sandbox could not create a process.
