# ADR 0008: Node Health transport evidence

Status: evidence retained; superseded for current production transport behavior
Date: 2026-07-13

## Supersession note

As of 2026-07-16, this ADR remains the dated discovery record for the removed
fixture. Current production behavior is defined in
`docs/architecture/module-map.md` and proved by
`tests/integration/health-node-transport.test.ts`,
`tests/integration/health-node-evidence.test.ts`, and
`tests/integration/health-https-success.test.ts`. VER-584, VER-608, VER-612,
and VER-613 record the structured DNS/TLS classification, request-target
safety, complete deadline, and aggregate verification evidence. Loopback
listener permission remains an environment requirement recorded by RISK-006.
The full release gate remains `npm run check`. Restricted environments may use
`npm run check:restricted`, which transparently excludes only test files marked
with the `loopback-listener` capability; GitHub CI never uses that fallback.

## Observed runtime

Node v26.4.0 with Undici 8.5.0 was tested on macOS arm64 using HTTP and raw TCP servers bound to `127.0.0.1`.

- A 200 response exposed the requested URL, exact status, selected headers, and body.
- Manual 301 and 302 requests exposed `Location`; default-follow 302 exposed only the final URL and `redirected = true`.
- HTTP 401, 403, 404, 410, 429, and 503 resolved as responses with exact statuses. The 429 response exposed `retry-after: 7`.
- Aborting a pending response produced the stable top-level name `AbortError`.
- Connection close and malformed HTTP both produced top-level `TypeError`. Their messages were not read.
- Fixture cleanup closed listeners and sockets and tolerated a repeated close.

## Contract limits

These facts cover loopback HTTP only. They establish no DNS, TLS, remote-socket, retry, SSRF, concurrency, staleness, or production-timeout behavior. A future adapter must author typed causes from structured runtime facts. Exception messages, traces, headers, and body prose cannot select Health meaning.

Manual redirect handling is required when every hop must be recorded and bounded. Response bodies must be capped before storage or hashing.

## Cleanup note

The 290-line fixture and 244-line discovery test were removed after evidence capture. A future production Health adapter should add the smallest fixtures required by its actual transport contract.
