# ADR 0003: Characterize Chrome HTML bookmark input

Status: evidence captured; catalog import contract remains open
Date: 2026-07-13

## Context

The first Chrome integration step is a read-only HTML export importer. The
repository needs source examples before the catalog contract describes how an
import becomes a snapshot. A real export cannot be committed because it may
contain private titles, URLs, local paths, or profile details.

These fixtures use the de facto Netscape bookmark structure seen in Chrome
exports: a doctype and header followed by nested `DL`/`DT` elements, `H3`
folder headings, and `A` bookmark elements. They are synthetic and contain only
reserved example domains and the path `/Users/example/`.

## Decision

Keep two sanitized HTML exports as immutable source-format evidence. Keep the
expected tree hand-authored in `expected-tree.json`. Its two array elements map
to `minimal.html` and `edge-cases.html` in that order. The array is an artifact
organization choice; it does not assign source IDs or define catalog identity.

The expected tree records decoded visible text and URLs. Timestamp attributes
remain raw strings. Missing attributes remain absent. Sibling order follows the
source order at every folder level.

The fixture set records syntax and data cases for the next catalog planning
slice. It leaves URL normalization, unsupported-scheme policy, deduplication,
stable identity, and malformed-input recovery open.

## Observed fields

Fields present in the fixtures:

- File structure: `<!DOCTYPE NETSCAPE-Bookmark-file-1>`, `META`, `TITLE`,
  `H1`, `DL`, `DT`, `H3`, `A`, and `p` elements.
- Folder attributes: `ADD_DATE` and `LAST_MODIFIED` when supplied.
- Bookmark attributes: `HREF`, `ADD_DATE`, and `LAST_MODIFIED` when supplied.
- HTML entity encoding in a bookmark title, folder titles, and one URL query
  string. The expected tree contains the decoded values.

Fields absent from these fixtures by design:

- Source IDs, parent IDs, and explicit sibling-index attributes.
- `dateLastUsed`, browser-profile metadata, capture time, and any local
  identity or normalized-URL fields.
- A parser status, recovery marker, or interpretation of a URL scheme.

The absent list describes this fixture set. It does not establish that every
Chrome version emits the same set of attributes. A sanitized real export must
settle that question before the catalog contract treats any field as stable.

## Fixture counts and cases

The timestamp columns count missing attribute occurrences. “Nodes with missing
timestamps” counts nodes missing at least one of the two attributes.

| Fixture | Folders | Bookmarks | Total nodes | Empty folders | Nodes with missing timestamps | Missing `ADD_DATE` | Missing `LAST_MODIFIED` | URL schemes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `minimal.html` | 1 | 1 | 2 | 0 | 1 | 0 | 1 | `https:` × 1 |
| `edge-cases.html` | 5 | 7 | 12 | 1 | 9 | 5 | 6 | `https:` × 5, `file:` × 1, `chrome:` × 1 |
| Combined | 6 | 8 | 14 | 1 | 10 | 5 | 7 | `https:` × 6, `file:` × 1, `chrome:` × 1 |

The edge fixture has one bookmark title group with two members:
`Same Title` points to `https://example.com/alpha` and
`https://example.org/same-title` in different folders. It also has one
duplicate-URL group: `https://example.net/shared` appears under `Bookmarks Bar`
and `Special Links` with different titles.

The minimal fixture has one bookmark, `Example & Reference`, and its URL query
string decodes from `&amp;`. The edge fixture preserves the source order of
`Same Title`, `Shared Link`, `Projects & Notes`, and `No Dates & Folder` under
the root folder. Within `Projects & Notes`, the order is `Same Title`, `Empty
Folder`, and `Special Links`. `Special Links` contains `Duplicate URL`, `Local
Notes`, and `Chrome Bookmarks` in that order.

## Malformed-input boundary

Neither fixture encodes a malformed node, and the expected tree contains no
repaired output. A future parser contract must state what happens when a `DT`
contains neither an `H3` nor an `A`, an `H3` has no following `DL`, a `DL` is
unclosed, an `A` has no `HREF`, or an entity is malformed or unknown. These
fixtures provide no recovery rule for those cases.

## Questions for a sanitized real-export probe

- Do folder names, root order, and capitalization vary by Chrome version or
  profile locale?
- Which attributes occur on folders and bookmarks in current exports? In
  particular, does `LAST_MODIFIED` occur on bookmarks, and does any
  last-used attribute appear?
- How are non-ASCII titles and URLs encoded, and which entity forms occur?
- Do real exports contain empty folders, missing attributes, comments between
  nodes, or malformed nesting?
- Which non-HTTP schemes occur, and should the importer preserve every one as
  source data?
- Does the export ever contain an `A` element without an `HREF` or a folder
  heading without its child `DL`?

## Consequences

The next planner-grade catalog slice has concrete source examples and counts
to use when it defines `BookmarkSnapshotInput`. It still needs a sanitized
real-export probe before treating these synthetic cases as a complete Chrome
input inventory. No parser, identity rule, URL policy, or persistence behavior
is defined here.
