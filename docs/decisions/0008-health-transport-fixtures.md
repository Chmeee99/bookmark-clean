# ADR 0008: Node Health transport evidence

Status: evidence retained; loopback fixture removed
Date: 2026-07-13

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
