# Read-only library inspection

Status: complete
Created: 2026-07-14
Completed: 2026-07-14

## Outcome

Bookmark Clean can print the folder tree for an imported snapshot:

```sh
npm run --silent inspect -- --database <bookmarks.sqlite> --snapshot <snapshot-id>
```

The output is one JSON line with snapshot totals and the stored folder hierarchy. Each folder has its ID, title, nested folders, and descendant bookmark count. The output excludes bookmark titles, URLs, source IDs, node dates, and diagnostics.

## Completed work

- The Local CLI contract now defines the inspection shape, failure codes, exits, lifecycle, and privacy boundary.
- I1 added the package command, additive dispatch, folder-only projection, README instructions, and subprocess acceptance coverage.
- Catalog, SQLite, Orchestrator, schema, Jobs, and the private raw export stayed unchanged.

## Verified behavior

- Stored folder order is preserved across two nested levels.
- Empty folders report zero bookmarks. Parent counts include direct and nested bookmarks.
- Invalid arguments exit `2`; unavailable storage exits `4`; invalid stored snapshots exit `5`; missing snapshots exit `6`.
- Database sessions close before process output.
- The existing import command passes its full regression suite unchanged.
- Strict typecheck and all 112 tests pass.
- The documented import-to-inspect npm path succeeds against a persisted fixture database.

## Follow-up planning trigger

Create a new plan for selected-folder processing preview. It should consume a folder ID and report bounded job, network, and model estimates before any work is queued. HTTP/UI, health execution, enrichment, search, and Chrome mutation remain outside this completed plan.
