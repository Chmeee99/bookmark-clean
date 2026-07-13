# ADR 0008: Use loopback fixtures for Health transport evidence

Status: accepted test evidence
Date: 2026-07-13

## Context

The Health module needs concrete evidence about the runtime fetch behavior that
will sit behind its future fetch port. The PRD treats a health observation as
network evidence and keeps staleness as a separate policy decision. The module
map puts request headers, timeout handling, redirect walking, and DNS/TLS error
mapping behind the Health boundary.

This slice characterizes those inputs with local servers. It keeps the test
evidence independent of live sites and of future Health policy.

## Decision

Keep a test-only fixture in `tests/helpers/health-loopback-fixture.ts`.

- The HTTP server binds to `127.0.0.1` on port `0` and serves fixed routes for
  status 200, redirects 301 and 302, statuses 401, 403, 404, 410, 429, and
  503, one connection close, and one pending response.
- The 200 route returns fixed HTML, `content-type`, and `x-fixture-route`
  values. The 429 route returns `retry-after: 7`. Redirect locations point to
  the fixture's 200 route.
- A separate `node:net` server binds to `127.0.0.1` on port `0` and sends a
  malformed `Content-Length` header.
- Both servers track accepted sockets. Cleanup closes each listener and
  destroys remaining sockets. The cleanup operation is idempotent.
- The helper exposes fixture URLs and request counters. It has no HealthStatus
  labels or policy functions.

The discovery test uses `redirect: "manual"` when it needs a redirect hop. It
also makes one default-follow request to observe the final response URL. Every
rejection assertion reads top-level error type/name fields only.

## Runtime

The observations below came from the selected local runtime:

| Field | Value |
| --- | --- |
| Node.js | `v26.4.0` |
| Built-in fetch implementation | Undici `8.5.0` |
| Platform | `darwin arm64` |
| Focused command | `node --test tests/spikes/health-transport-fixtures.test.ts` |

## Observed facts

The focused suite passed six tests.

| Scenario | Observed fetch facts |
| --- | --- |
| Status 200 | The promise resolved with `status = 200`, `ok = true`, and the requested URL. `content-type` was `text/html; charset=utf-8`; `x-fixture-route` was `status-200`; the body was `<!doctype html><html><body>fixture-status-200</body></html>`. |
| Manual 301 | The promise resolved with `status = 301`, `ok = false`, the requested URL, and `location` equal to the fixture's status-200 URL. |
| Manual 302 | The promise resolved with `status = 302`, `ok = false`, the requested URL, and `location` equal to the fixture's status-200 URL. |
| Default-follow 302 | The final response had `status = 200`, `ok = true`, the fixture's status-200 URL, and `redirected = true`. The response object exposed the final URL. |
| Status 401, 403, 404, 410, 429, 503 | Each promise resolved with its exact HTTP status, `ok = false`, the requested URL, and the matching `x-fixture-route` header. `retry-after` was `7` for 429 and absent for the other five routes. |
| Pending response | An explicit `AbortController` stopped the request after a 100 ms bounded timer. The rejection name was `AbortError`. The message was not read. |
| Connection close | The promise rejected with top-level type/name `TypeError`/`TypeError`. The message was not read. |
| Malformed HTTP | The promise rejected with top-level type/name `TypeError`/`TypeError`. The message was not read. |

The redirect test counted one 301 request, two 302 requests, and one final
200 request. The other route checks made one request per route. All fixture URL
hosts were `127.0.0.1`, and the cleanup test completed two consecutive close
calls.

## Contract implications

These observations are enough to keep a future fetch port focused on transport
facts:

- response status and `ok`;
- requested and final URL;
- selected response headers;
- a bounded response body when the caller requests one;
- manually observed redirect hops;
- a typed rejection envelope whose stable fields are limited to the observed
  top-level type and name.

The clock remains a separate dependency for check time and duration. The
observation repository remains a separate dependency for persistence. This
slice gives those ports runtime evidence without changing their public
contracts.

Default-follow behavior hides prior hops behind the final response. Manual
redirect mode returns each 301 or 302 with its `Location`, which lets a future
redirect walker record the chain and apply a declared bound. A default-follow
request still provides evidence about the final response URL.

## Limits

The fixture uses plain HTTP on loopback. It gives no evidence about DNS
resolution, TLS certificates, or remote socket behavior. Those distinctions
need injected adapter fixtures with typed outcomes. The connection-close and
malformed-response cases both collapse to the same top-level `TypeError` facts
on this runtime; their messages and parser/socket diagnostics stay outside the
contract.

The 100 ms timer bounds test cleanup. It selects no production timeout value.
This slice also selects no retry policy, redirect limit, SSRF policy,
concurrency rule, body fingerprint algorithm, staleness rule, persistence
behavior, or HealthStatus mapping.

No route receives a `HealthStatus` in this slice. Later code must use an
explicit contract for any mapping and must never parse exception-message text.

## Consequences

The transport scenarios are repeatable without live internet access, DNS, TLS
certificates, a browser, or external services. The fixture is isolated to test
helpers and the discovery spike. A process running the suite needs permission
to bind loopback listeners; no external network permission is needed.
