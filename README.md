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

## Preview selected-folder work

Use a folder ID returned by inspection:

```sh
npm run --silent preview -- --database <bookmarks.sqlite> --snapshot <snapshot-id> --folder <folder-id>
```

The command reports the exact bookmark and job counts for `health_check_v1`. It also reports the maximum network requests and model calls. The current profile allows one job attempt, at most six network requests per bookmark, and no model calls.

Preview is a dry run. It does not enqueue jobs, call the network or a model, or write snapshot data. Opening the database may apply pending Catalog migrations.

Preview failures use stderr with these exits:

- `1`: unexpected failure
- `2`: invalid arguments
- `4`: storage unavailable
- `5`: invalid stored snapshot
- `6`: snapshot not found
- `7`: folder not found
- `8`: estimate overflow

## Enqueue selected-folder work

Use the snapshot and folder IDs returned by inspection. Supply a non-empty run ID for the logical run:

```sh
npm run --silent enqueue -- --database <bookmarks.sqlite> --snapshot <snapshot-id> --folder <folder-id> --run <run-id>
```

The command creates one durable `health_check_v1` job per bookmark below the selected folder. Success writes one JSON line containing the run ID, the same bounded preview, and the saved batch summary. Repeating the same selection and run ID returns the original batch.

Enqueue only saves work. It does not start a worker or make network requests.

Failures use stderr with these exits:

- `1`: unexpected failure
- `2`: invalid arguments
- `4`: storage unavailable
- `5`: invalid stored snapshot
- `6`: snapshot not found
- `7`: folder not found
- `8`: estimate overflow
- `9`: empty selection
- `10`: run conflict
- `11`: enqueue rejected
