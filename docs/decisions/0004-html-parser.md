# ADR 0004: Use parse5 for Chrome bookmark HTML

Status: accepted for the Chrome HTML adapter  
Date: 2026-07-13

## Context

The read-only importer needs to parse Chrome's Netscape-style bookmark export. The source is HTML with nested `DL`/`DT` structures, folder `H3` elements, bookmark `A` elements, raw attributes, encoded text, empty folders, and occasionally imperfect nesting.

Node 26.4.0 provides neither `DOMParser` nor another global HTML parser. A custom tokenizer would add more code than the bookmark behavior itself and would make malformed-input handling our responsibility.

## Evidence

Platform check:

```text
node -e "console.log(JSON.stringify({DOMParser:typeof DOMParser,HTMLParser:typeof HTMLParser}))"
{"DOMParser":"undefined","HTMLParser":"undefined"}
```

Registry metadata was read on 2026-07-13:

| Package | Version | Runtime dependencies | Unpacked size | Last modified | Module | License |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `parse5` | 8.0.1 | 1 (`entities`) | 337,099 bytes | 2026-04-19 | ESM | MIT |
| `htmlparser2` | 12.0.0 | 4 | 235,104 bytes | 2026-03-20 | ESM | MIT |

Commands:

```text
npm view parse5 version dependencies dist.unpackedSize time.modified engines type license
npm view htmlparser2 version dependencies dist.unpackedSize time.modified engines type license
```

Primary sources:

- [parse5 documentation](https://parse5.js.org/)
- [parse5 8.0.1 API](https://parse5.js.org/modules/parse5.html)
- [parse5 package metadata](https://www.npmjs.com/package/parse5)
- [htmlparser2 repository and releases](https://github.com/fb55/htmlparser2)
- [htmlparser2 package metadata](https://www.npmjs.com/package/htmlparser2)
- [node-html-parser package metadata](https://www.npmjs.com/package/node-html-parser)

`parse5` implements the WHATWG HTML parsing model and states that it parses HTML the way a browser does. Its default tree preserves child order, attributes, element names, text nodes, and empty elements. Parsing a string builds data only; it does not execute scripts, resolve URLs, or fetch resources.

`htmlparser2` is also maintained and current. Its package brings four runtime dependencies and a broader streaming/DOM utility stack. Those capabilities are unnecessary for one local bookmark export at a time.

`node-html-parser` has a convenient DOM-like API, but its own package documentation says some malformed HTML may parse incorrectly because speed and a simplified tree are design priorities. The bookmark fixture work explicitly keeps malformed-input behavior visible, so that trade-off is a poor fit.

## Decision

Use `parse5` with the compatible range `^8.0.1`. The parser implementation slice may add only `parse5`; npm may record its declared `entities` dependency in the lockfile.

The Chrome HTML adapter may use this surface:

```ts
import { parse, type DefaultTreeAdapterMap } from "parse5";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

const document = parse(html, { sourceCodeLocationInfo: false });
```

Adapter traversal may read only default-tree node relationships and source syntax needed by the contract:

- `childNodes` for source order;
- element `tagName` and `attrs`;
- text-node `value`;
- parent/child relationships needed to associate an `H3` with its following `DL`.

The adapter will wrap these details in its own private functions. `parse5` types and nodes must not cross the adapter boundary.

## Boundary rules for the parser implementation

- Parse the string locally. No script execution, resource loading, URL resolution, or browser emulation.
- Preserve source order and decoded text values. Preserve URL strings after entity decoding.
- Use the Catalog contract and validator as the output boundary.
- Do not use selectors, serialization, tree mutation, custom tree adapters, SAX packages, or other parse5 toolset packages.
- Do not treat parser recovery as catalog truth. Explicit malformed cases return typed adapter failures under the Slice 9 packet.
- Do not normalize URLs, merge nodes, infer timestamps, or assign catalog IDs.

## Consequences

The project adds one direct runtime dependency when Slice 9 begins. The lockfile will capture the exact release and transitive `entities` version. The adapter gets browser-like HTML recovery and a typed tree without taking a dependency on a full DOM implementation.

The package choice does not define bookmark semantics. Catalog validation remains the final input gate, and a sanitized real Chrome export remains required before claiming broad Chrome-version compatibility.
