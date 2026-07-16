# Foundation and first import: completed baseline

Status: completed and compressed
Created: 2026-07-12  
Compressed: 2026-07-13
Completed work: Slices 1–17

## Purpose

This file records the useful result of the first workstream. Completed Slice Packets and executor instructions were removed because the ops ledgers and repository contain the execution history.

The current recovery plan is [durable-processing-and-health.md](./durable-processing-and-health.md).

## Verified baseline

- Node 26 runs the strict TypeScript test and typecheck setup.
- Built-in SQLite supports the required FTS5, transaction, Float32 BLOB, backup, close, and reopen operations on the development machine.
- Chrome bookmark HTML parses into a typed tree while preserving hierarchy and sibling order.
- Catalog validation and immutable SQLite persistence survive close and reopen.
- A generated 10,000-node import completed with exact counts and ordering. The recorded local run took about 135 ms, produced a 5.7 MB database, and increased observed RSS by about 89 MB.
- LM Studio model discovery worked. Qwen3.5 9B returned HTTP 200 and failed the first strict structured-output check with `invalid_json`. No model passed an enrichment quality gate.

## What this work did not deliver

- A runnable application or composition root
- `start`, `dev`, `build`, or `serve` commands
- A local web interface or Chrome extension
- Page extraction, successful enrichment, search, or review flows
- A real-export acceptance run
- Any committed project files

## Preservation boundary

The recovery review should begin with these behaviors marked as candidates to keep:

1. Chrome HTML parsing and exact hierarchy/order preservation.
2. Catalog validation and SQLite close/reopen persistence.
3. The 10,000-node end-to-end integrity check.
4. The smallest durable resume path needed by a selected-folder workflow.

Everything else must earn its place through a current product caller, a PRD acceptance criterion in the next vertical increment, or unique defect coverage. Passing tests alone do not establish value.

## Lessons carried forward

- Start each horizon with one runnable product path.
- Add a contract when current implementation evidence exposes a boundary problem.
- Keep completed work in the ops ledger and version control. Active plans contain upcoming work only.
- Use focused verification during a slice and one full-suite run at its end.
- Stop after 50,000 tokens or 60 minutes and report the result.
- Stop with `PARTIAL` after two checkpoints without user-visible progress.
