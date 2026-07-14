# Bookmark Clean

Bookmark Clean currently provides one local command: import a Chrome bookmarks HTML export into a persistent SQLite database.

## Requirements

- Node.js 26
- Installed npm dependencies

## Import bookmarks

```sh
npm run --silent import -- --input <bookmarks.html> --database <bookmarks.sqlite>
```

On success, the command writes one JSON line to stdout:

```json
{"ok":true,"snapshotId":"snapshot:<uuid>","rootCount":1,"folderCount":1,"bookmarkCount":1}
```

On failure, it writes one JSON line to stderr. Exit codes are:

- `1`: unexpected failure
- `2`: invalid arguments
- `3`: input unavailable
- `4`: storage unavailable
- `5`: typed import rejection

The command does not modify Chrome or the source HTML file.
