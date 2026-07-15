import type {
  HealthObservationErrorCode,
  HealthStatus,
  HealthTransportFailureCode,
  RedirectHop,
} from "./public.js";

type HealthClassificationFact =
  | {
      readonly kind: "response";
      readonly statusCode: number;
      readonly redirects: readonly RedirectHop[];
    }
  | {
      readonly kind: "failure";
      readonly code: HealthTransportFailureCode;
    };

interface HealthClassification {
  readonly status: HealthStatus;
  readonly errorCode?: HealthObservationErrorCode;
}

declare const module: {
  exports: { classifyHealthFact: typeof classifyHealthFact };
};

function responseStatus(
  statusCode: number,
  redirects: readonly RedirectHop[],
): HealthStatus {
  if (statusCode >= 200 && statusCode <= 299) {
    if (redirects.length === 0) return "healthy";
    const temporary = redirects.some(
      ({ statusCode: redirectStatus }) =>
        redirectStatus === 302 || redirectStatus === 303 || redirectStatus === 307,
    );
    return temporary ? "redirect_temporary" : "redirect_permanent";
  }
  if (statusCode === 401) return "authentication_required";
  if (statusCode === 403) return "forbidden";
  if (statusCode === 404) return "not_found";
  if (statusCode === 410) return "gone";
  if (statusCode === 429) return "rate_limited";
  if (statusCode >= 500 && statusCode <= 599) return "server_error";
  return "uncertain";
}

function failureStatus(code: HealthTransportFailureCode): HealthStatus {
  switch (code) {
    case "unsupported_url":
    case "timeout":
    case "dns_failure":
    case "tls_error":
      return code;
    case "connection_failure":
    case "malformed_response":
    case "unknown_transport":
      return "uncertain";
  }
}

function classifyHealthFact(fact: HealthClassificationFact): HealthClassification {
  if (fact.kind === "response") {
    return { status: responseStatus(fact.statusCode, fact.redirects) };
  }
  return { status: failureStatus(fact.code), errorCode: fact.code };
}

module.exports = { classifyHealthFact };
