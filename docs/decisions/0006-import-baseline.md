# ADR 0006: Set a local 10,000-node import baseline

Status: observed local baseline
Date: 2026-07-13

## Context

The first MVP acceptance criterion requires importing at least 10,000 Chrome
bookmarks while preserving hierarchy and sibling order. Slices 10, 13, 14,
and 16 provide the parser, Catalog service, ID factory, migration, and
SQLite snapshot store. This slice measures those pieces together with a
deterministic export.

## Decision

Keep the generated benchmark as an integrity gate for the first import path.
Record its measurements as machine-specific observations. The result is a
local baseline and has no cross-machine performance SLA.

Future performance work starts with a new measurement and a separate slice.
The benchmark keeps its exact count, order, sample, reconstruction, reopen,
and row-uniqueness assertions during that work.

## Fixed benchmark

The generator emits one Netscape-style HTML export with:

- 100 root folders;
- 99 bookmarks in every folder;
- 100 folders, 9,900 bookmarks, and 10,000 total nodes;
- titles, URLs, timestamps, and source order derived from zero-based indexes;
- URLs below the reserved `https://example.com/` domain;
- one fixed capture timestamp: `2026-07-13T12:00:00.000Z`.

The benchmark parses the export, migrates a temporary SQLite file, composes
the Catalog service with the crypto ID factory and SQLite store, and imports
the parsed input. It loads the snapshot through Catalog before closing the
database, checks every root and child position, checks beginning/middle/end
sample values, and checks one snapshot row plus 10,000 node rows with unique
local and source IDs. It then closes and reopens the file and repeats the
Catalog reconstruction and integrity checks.

## Observed run

This is the second of two sequential focused runs on the same local machine.
The command was:

```text
node --test tests/performance/import-10k.test.ts
```

| Metric | Observation |
| --- | ---: |
| Node.js | `v26.4.0` |
| SQLite | `3.53.3` |
| Platform | `darwin` |
| Architecture | `arm64` |
| Folders | `100` |
| Bookmarks | `9,900` |
| Total nodes | `10,000` |
| Parse-to-import-commit time | `118.97 ms` |
| RSS before run | `121,913,344 bytes` |
| Peak RSS observed | `209,469,440 bytes` |
| RSS delta | `87,556,096 bytes` |
| Database file after commit | `5,693,440 bytes` |

The focused run passed. A preceding sequential focused run also passed with
the same topology and integrity assertions. These numbers describe this
runtime and machine; they do not set an SLA or establish real-user export
acceptance.

## Consequences

The import path has repeatable scale evidence before optimization or real
export validation begins. Generated data cannot answer how a private Chrome
corpus behaves, so a sanitized real-export run remains a later milestone.
