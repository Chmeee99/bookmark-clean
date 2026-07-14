# Bookmark Clean

Bookmark Clean imports a Chrome bookmarks HTML export into SQLite and can inspect the saved folder tree.

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

## Inspect a snapshot

Use the `snapshotId` returned by import:

```sh
npm run --silent inspect -- --database <bookmarks.sqlite> --snapshot <snapshot-id>
```

The command writes the stored folder hierarchy to stdout as one JSON line. Each folder has its ID, title, nested folders, and the number of bookmarks below it. Bookmark titles and URLs are omitted.

Inspection uses the same failure stream convention as import. Its exit codes are:

- `1`: unexpected failure
- `2`: invalid arguments
- `4`: storage unavailable
- `5`: invalid stored snapshot
- `6`: snapshot not found

Inspection does not modify Chrome or write snapshots. Opening the database applies any pending Catalog migrations.
