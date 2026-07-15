# Selected-folder durable enqueue

Status: complete on 2026-07-15.

## Outcome

The Local CLI can save one durable `health_check_v1` batch for a selected Catalog folder without running a worker. Processing owns traversal, order, budgets, and run identity. Jobs owns validation and atomic enqueue. The CLI owns arguments, output, routing, and resource closure.

The package command is:

```sh
npm run --silent enqueue -- --database <bookmarks.sqlite> --snapshot <snapshot-id> --folder <folder-id> --run <run-id>
```

Repeating the same selection and run ID returns the original batch. A successful command writes one JSON line with the exact run ID, bounded preview, and saved batch summary. Failures use the fixed codes and exits in `docs/architecture/module-map.md`.

## Delivered slices

- E1: narrow Jobs enqueue composition seam.
- E2: Processing durable-start types.
- E3: deterministic Processing starter and public factory.
- E4: real SQLite persistence and replay proof.
- E5: direct Local enqueue command with typed failure mapping and guaranteed session closure.
- E6: package routing, subprocess acceptance, test enrollment, and README instructions.

## Verification

- Direct command: success, exact replay, invalid arguments before storage, real typed failures, and database reopen checks.
- Process command: stdout and stderr placement, exit codes, output shape, selected-folder counts, and exact replay.
- Existing import, inspect, and preview subprocess suites pass unchanged.
- Strict typecheck passes.
- The repository test script passes all 186 tests.

## Deferred work

These are separate workstreams and were not started:

- A one-job worker command after production operating values are decided.
- Batch progress output after its user-facing contract is defined.
- A repeated worker loop after stop and backoff policy are explicit.
- Automatic run-ID generation if caller-authored IDs prove awkward.
