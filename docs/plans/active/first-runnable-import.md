# First runnable import

Status: complete
Created: 2026-07-14
Completed: 2026-07-14

## Outcome

Bookmark Clean now has one supported local command that imports a Chrome bookmarks HTML export into persistent SQLite and emits a stable JSON result:

```sh
npm run --silent import -- --input <bookmarks.html> --database <bookmarks.sqlite>
```

The command owns arguments, file access, capture time, composition, process streams, and exit codes. Chrome HTML owns parsing, Catalog owns validation and identity, SQLite owns persistence lifecycle, and the Orchestrator owns parse-then-import sequencing.

## Completed slices

- S1 exposed exactly `createBookmarkCatalog` and `createCryptoCatalogIdFactory` through Catalog's public runtime entrypoint.
- S2 exposed exactly `parseBookmarksHtml` through the Chrome HTML public runtime entrypoint.
- S3 added the opaque `openCatalogDatabase` session with migrate-before-use and idempotent close.
- S4 added `createBookmarkCleanApp` with staged source and Catalog failures that preserve author-owned values.
- S5 added the local CLI composition root, package command, README, and subprocess acceptance coverage.

## Verified behavior

- Success emits one JSON line on stdout and exit `0`.
- Invalid arguments emit `invalid_arguments` and exit `2`.
- Unreadable input emits `input_unavailable` and exit `3`.
- Unavailable storage emits `storage_unavailable` and exit `4`.
- Typed source rejection emits structured `import_failed` fields and exit `5` without diagnostics.
- The top-level rejection guard maps unexpected execution to `unexpected_failure` and exit `1` without exception prose; the acceptance harness does not inject provider failures to force this branch.
- Storage closes before output; the subprocess test reopens the real database and loads the reported snapshot.
- The documented silent npm entrypoint was executed directly and emitted only the success JSON line.
- Strict typecheck and all 107 tests pass, including the 10,000-node proof.

## Evidence limit

The acceptance input is the repository's synthetic Chrome-style fixture. It proves the runnable production path with real parser, Catalog, SQLite, and process code, but it does not establish compatibility with arbitrary real Chrome exports.

## Follow-up planning triggers

- Add one sanitized representative real export before making a broad Chrome compatibility claim.
- Plan a local HTTP service only when a concrete non-CLI consumer exists.
- Plan Chrome API import only after the local service boundary is selected.
- Keep Jobs, enrichment, search, UI, and Chrome mutation outside this completed plan.
