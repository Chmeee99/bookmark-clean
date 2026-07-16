interface NodeTestApi { test(name: string, callback: () => void): void; }
interface ClassifierApi {
  mapNodeLookupError(error: unknown): "dns_failure" | "unknown_transport";
  mapNodeRequestError(
    error: unknown,
    protocol: "http:" | "https:",
  ): "connection_failure" | "malformed_response" | "tls_error" | "unknown_transport";
}

declare const require: (specifier: string) => unknown;
const { test } = require("node:test") as NodeTestApi;
const { mapNodeLookupError, mapNodeRequestError } = require(
  "../../adapters/node/health-node-error-classifier.ts",
) as ClassifierApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test("maps only explicit structured DNS codes", () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
    assert(mapNodeLookupError({ code }) === "dns_failure", `${code} was not DNS`);
  }
  assert(mapNodeLookupError({ code: "EUNKNOWN" }) === "unknown_transport", "Unknown code broadened");
  assert(mapNodeLookupError(new Error("ENOTFOUND in prose")) === "unknown_transport",
    "Resolver prose was interpreted");
});

test("maps explicit certificate validation and identity codes", () => {
  for (const code of [
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "CERT_NOT_YET_VALID",
    "CERT_REVOKED",
    "CERT_UNTRUSTED",
    "CERT_REJECTED",
    "HOSTNAME_MISMATCH",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ]) {
    assert(mapNodeRequestError({ code }, "https:") === "tls_error", `${code} was not TLS`);
  }
});

test("preserves connection parser protocol and unknown controls", () => {
  assert(mapNodeRequestError({ code: "ECONNREFUSED" }, "http:") === "connection_failure",
    "Connection refusal changed");
  assert(mapNodeRequestError({ code: "HPE_INVALID_CONSTANT" }, "http:") === "malformed_response",
    "Parser failure changed");
  assert(mapNodeRequestError({ code: "EPROTO" }, "https:") === "tls_error",
    "HTTPS protocol failure changed");
  assert(mapNodeRequestError({ code: "EPROTO" }, "http:") === "unknown_transport",
    "HTTP failure was treated as TLS");
  assert(mapNodeRequestError({ code: "ERR_SSL_WRONG_VERSION_NUMBER" }, "https:") === "tls_error",
    "OpenSSL protocol failure changed");
  assert(mapNodeRequestError({ code: "CERTIFICATE_WORD_IN_UNKNOWN_CODE" }, "https:") ===
    "unknown_transport", "Unknown certificate-looking code broadened");
  assert(mapNodeRequestError(new Error("CERT_HAS_EXPIRED in prose"), "https:") ===
    "unknown_transport", "TLS prose was interpreted");
});
