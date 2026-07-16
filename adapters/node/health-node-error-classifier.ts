import type { HealthTransportFailureCode } from "../../modules/health/public.js";

type LookupFailureCode = "dns_failure" | "unknown_transport";

const DNS_FAILURE_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

// Node 26 TLS/X509 error codes. Keep this explicit so unknown platform errors
// cannot acquire Health meaning from their prose or a certificate-looking name.
const CERTIFICATE_FAILURE_CODES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_CRL",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "CERT_SIGNATURE_FAILURE",
  "CRL_SIGNATURE_FAILURE",
  "CERT_NOT_YET_VALID",
  "CERT_HAS_EXPIRED",
  "CRL_NOT_YET_VALID",
  "CRL_HAS_EXPIRED",
  "ERROR_IN_CERT_NOT_BEFORE_FIELD",
  "ERROR_IN_CERT_NOT_AFTER_FIELD",
  "ERROR_IN_CRL_LAST_UPDATE_FIELD",
  "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_CHAIN_TOO_LONG",
  "CERT_REVOKED",
  "INVALID_CA",
  "PATH_LENGTH_EXCEEDED",
  "INVALID_PURPOSE",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function structuredCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function mapNodeLookupError(error: unknown): LookupFailureCode {
  const code = structuredCode(error);
  return code !== undefined && DNS_FAILURE_CODES.has(code)
    ? "dns_failure"
    : "unknown_transport";
}

function mapNodeRequestError(
  error: unknown,
  protocol: "http:" | "https:",
): HealthTransportFailureCode {
  const code = structuredCode(error);
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "connection_failure";
  if (code?.startsWith("HPE_") === true) return "malformed_response";
  if (protocol === "https:" && (
    code === "EPROTO" ||
    code?.startsWith("ERR_SSL_") === true ||
    (code !== undefined && CERTIFICATE_FAILURE_CODES.has(code))
  )) return "tls_error";
  return "unknown_transport";
}

export { mapNodeLookupError, mapNodeRequestError };
