# Alias subdomain mapping

Use `--alias` when project folder names cannot be used directly as subdomains.
This keeps the visible port consistent while mapping each subdomain prefix to a real `wwwroot` directory.

## Start

```bash
mikit start --port 8080 --root "F:\NDW\【魔域】\2026" --alias mikit.alias.json
```

The port is customizable with `--port`. If `--port` is omitted, Mikit uses `port` from the alias config. If neither is set, it falls back to `8080`.

## Config

```json
{
  "domain": "y.bindyy.cn",
  "port": 8080,
  "default": "b",
  "auto": [
    "【魔域】/2026/*/*/wwwroot"
  ],
  "projects": {
    "b": "0421 无尽榜单/wjms/wwwroot",
    "xchz": "my-260130-xchz/wwwroot"
  }
}
```

Paths are resolved relative to `--root`, unless the config has its own `root` field.
`auto` scans matching `wwwroot` directories and generates aliases from the parent folder name. Explicit `projects` entries can still be used for custom aliases or one-off paths.
Alias config changes and auto-scanned project directory changes are reloaded while the server is running.

## Access

```text
http://b.y.bindyy.cn:8080/
http://b.y.bindyy.cn:8080/dist/
http://xchz.y.bindyy.cn:8080/
```

Normal paths are served from the mapped `wwwroot` directory. `/dist/` is served from the same project's `dist` directory.
Project-scoped hot reload is injected for `wwwroot` pages only: changes in one project refresh only that project's pages.
`/dist/` pages are served without hot reload injection.

Make sure the subdomains resolve to `127.0.0.1`, for example through wildcard DNS or hosts entries.
