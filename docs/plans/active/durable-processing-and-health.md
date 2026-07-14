# Recovery code review and reduction plan

Status: complete
Created: 2026-07-13
Review: [code-reduction-review.md](../../reports/code-reduction-review.md)
Refresh: recovery queue closed

## Outcome

Remove code and tests that do not support the first runnable product path. Jobs production and durable SQL proofs stay. Catalog/import verification is compressed around the retained 10,000-node vertical proof.

## Current baseline

- 97 tests pass; strict typecheck passes.
- Production: 4,627 lines.
- Tests and fixtures: 8,782 lines.
- R2–R8H removed 4,774 code, test, and fixture lines.
- There is no runtime command or application composition root.

## Controls

- One slice and one executor lane at a time.
- Stop at 50,000 tokens or 60 minutes.
- Review before deletion; run focused verification during edits and the full suite once at slice end.
- Cleanup slices delete more test lines than they add and change at most seven code/test files.
- Keep completed Slice Packets out of this file.

## Completed decisions

- Keep distinct Jobs SQL and reopen proofs.
- R8B deleted the 222-line SQLite capability spike.
- R8C–R8F removed 482 Catalog/parser/service test lines while retaining their declared boundaries.
- R8H removed 98 Catalog SQLite test lines while retaining all eight storage boundaries.
- Keep `temporary-database.ts`, the 430-line 10,000-node test, and its 165-line generator.

## Queue

Complete. Any next plan should target the first runnable product path, not another speculative cleanup pass. Re-audit only after a real composition root identifies newly redundant code.
