import type {
  HealthSelectedHeader,
  HealthSelectedHeaderName,
  HealthTransportFact,
  HealthTransportFailureCode,
  HealthTransportResponse,
  RedirectHop,
} from "./public.js";

const SELECTED_HEADER_NAMES: readonly HealthSelectedHeaderName[] = [
  "content-type",
  "location",
  "retry-after",
  "etag",
  "last-modified",
];

const TRANSPORT_FAILURE_CODES: readonly HealthTransportFailureCode[] = [
  "unsupported_url",
  "timeout",
  "dns_failure",
  "tls_error",
  "connection_failure",
  "malformed_response",
  "unknown_transport",
];

const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308] as const;

type ValidationFailureCode = "invalid_fact" | "invalid_redirect";

export type HealthRedirectResponseValidation =
  | {
      readonly ok: true;
      readonly response: HealthTransportResponse;
      readonly location: string;
    }
  | { readonly ok: false; readonly code: ValidationFailureCode };

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<PropertyKey, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const actualKeys = Reflect.ownKeys(value);
  if (actualKeys.length < requiredKeys.length) {
    return false;
  }
  if (
    actualKeys.some(
      (key) => typeof key !== "string" || !allowedKeys.has(key),
    )
  ) {
    return false;
  }
  return requiredKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function isCanonicalDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }

  const actualKeys = Reflect.ownKeys(value);
  if (actualKeys.length !== value.length + 1) {
    return false;
  }
  if (!actualKeys.includes("length")) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      return false;
    }
    if (!actualKeys.includes(String(index))) {
      return false;
    }
  }

  return actualKeys.every(
    (key) =>
      key === "length" ||
      (typeof key === "string" &&
        Number.isInteger(Number(key)) &&
        Number(key) >= 0 &&
        Number(key) < value.length &&
        String(Number(key)) === key),
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && value >= 0;
}

function isStatusCode(value: unknown): value is number {
  return Number.isSafeInteger(value) && value >= 100 && value <= 599;
}

function isSelectedHeaderName(value: unknown): value is HealthSelectedHeaderName {
  return (
    typeof value === "string" &&
    SELECTED_HEADER_NAMES.includes(value as HealthSelectedHeaderName)
  );
}

function isRedirectStatusCode(
  value: unknown,
): value is (typeof REDIRECT_STATUS_CODES)[number] {
  return (
    typeof value === "number" &&
    REDIRECT_STATUS_CODES.includes(value as (typeof REDIRECT_STATUS_CODES)[number])
  );
}

function validateHeaderArray(
  value: unknown,
  allowRedirectLocationIssues: boolean,
): readonly HealthSelectedHeader[] | null {
  if (!isCanonicalDenseArray(value)) {
    return null;
  }

  const names = new Set<HealthSelectedHeaderName>();
  for (const header of value) {
    if (!hasExactKeys(header, ["name", "value"])) {
      return null;
    }

    const name = header.name;
    const headerValue = header.value;
    if (!isSelectedHeaderName(name) || typeof headerValue !== "string") {
      return null;
    }
    if (headerValue.length === 0 &&
        (!allowRedirectLocationIssues || name !== "location")) {
      return null;
    }
    if (names.has(name) && (!allowRedirectLocationIssues || name !== "location")) {
      return null;
    }
    names.add(name);
  }

  return value as readonly HealthSelectedHeader[];
}

function validateResponseShape(
  value: unknown,
  allowRedirectLocationIssues: boolean,
): HealthTransportResponse | null {
  if (
    !hasExactKeys(value, ["url", "statusCode", "headers", "durationMs"], ["body"])
  ) {
    return null;
  }
  if (!isNonEmptyString(value.url) || !isStatusCode(value.statusCode)) {
    return null;
  }
  if (!isSafeNonNegativeInteger(value.durationMs)) {
    return null;
  }

  const headers = validateHeaderArray(value.headers, allowRedirectLocationIssues);
  if (headers === null) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(value, "body") &&
      !(value.body instanceof Uint8Array)) {
    return null;
  }

  return value as unknown as HealthTransportResponse;
}

function validateFailure(value: unknown): boolean {
  if (!hasExactKeys(value, ["code", "durationMs"])) {
    return false;
  }
  return (
    typeof value.code === "string" &&
    TRANSPORT_FAILURE_CODES.includes(value.code as HealthTransportFailureCode) &&
    isSafeNonNegativeInteger(value.durationMs)
  );
}

function validateRedirectHistory(value: unknown): value is readonly RedirectHop[] {
  if (!isCanonicalDenseArray(value)) {
    return false;
  }

  for (const hop of value) {
    if (!hasExactKeys(hop, ["requestedUrl", "statusCode", "location", "nextUrl"])) {
      return false;
    }
    if (
      !isNonEmptyString(hop.requestedUrl) ||
      !isRedirectStatusCode(hop.statusCode) ||
      !isNonEmptyString(hop.location) ||
      !isNonEmptyString(hop.nextUrl)
    ) {
      return false;
    }
  }

  return value as readonly RedirectHop[];
}

function validateHealthTransportFact(
  value: unknown,
): HealthTransportFact | null {
  try {
    if (!hasExactKeys(value, ["kind", "value"])) {
      return null;
    }

    if (value.kind === "response") {
      return validateResponseShape(value.value, false) === null
        ? null
        : value as unknown as HealthTransportFact;
    }
    if (value.kind === "failure") {
      return validateFailure(value.value)
        ? value as unknown as HealthTransportFact
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

function validateHealthRedirectHistory(
  value: unknown,
): value is readonly RedirectHop[] {
  try {
    return validateRedirectHistory(value);
  } catch {
    return false;
  }
}

function validateHealthRedirectResponse(
  value: unknown,
): HealthRedirectResponseValidation {
  try {
    const response = validateResponseShape(value, true);
    if (response === null) {
      return { ok: false, code: "invalid_fact" };
    }
    if (!isRedirectStatusCode(response.statusCode)) {
      return { ok: false, code: "invalid_redirect" };
    }

    const locationHeaders = response.headers.filter(
      (header) => header.name === "location",
    );
    if (locationHeaders.length !== 1 || locationHeaders[0].value.length === 0) {
      return { ok: false, code: "invalid_redirect" };
    }

    return {
      ok: true,
      response,
      location: locationHeaders[0].value,
    };
  } catch {
    return { ok: false, code: "invalid_fact" };
  }
}

declare const module: {
  exports: {
    validateHealthTransportFact: typeof validateHealthTransportFact;
    validateHealthRedirectHistory: typeof validateHealthRedirectHistory;
    validateHealthRedirectResponse: typeof validateHealthRedirectResponse;
  };
};

module.exports = {
  validateHealthTransportFact,
  validateHealthRedirectHistory,
  validateHealthRedirectResponse,
};
