# Selected-folder processing

Status: complete
Created: 2026-07-14
Completed: 2026-07-14

## Outcome

Bookmark Clean can preview bounded work for a folder returned by inspection:

```sh
npm run --silent preview -- --database <bookmarks.sqlite> --snapshot <snapshot-id> --folder <folder-id>
```

`health_check_v1` creates one job attempt per descendant bookmark. Each job allows at most six network requests and zero model calls. Preview performs no enqueue or provider calls.

## Completed slices

- P1 added the Processing public contract and planner. It selects nested folders and calculates budgets without reading bookmark content.
- P2 added the package command, CLI composition, README instructions, and persisted subprocess proof.

## Verification

- Five Processing tests and four preview subprocess tests pass.
- All 19 Processing and CLI tests pass.
- Strict typecheck and all 121 tests pass.
- The documented path works on the nested fixture.
- A redacted live run on the ignored real export previewed 5,726 jobs, at most 34,356 network requests, and zero model calls.

## Follow-up

The first Health handler needs `BookmarkCatalog.getBookmark` before it can resolve a Jobs target to its stored URL. The active handler plan keeps that lookup and minimal Health types in separate contract slices.
