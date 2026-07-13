import type {
  Outcome,
} from "../../core/contracts/public.js";
import type {
  HealthSelectedHeader,
  HealthStatus,
  HealthTransportFailureCode,
  HealthTransportFact,
  HealthTransportResponse,
  RedirectHop,
} from "./public.js";
import type { HealthRedirectResponseValidation } from "./health-fact-validation.js";

interface HealthFactValidationApi {
  validateHealthTransportFact(value: unknown): HealthTransportFact | null;
  validateHealthRedirectHistory(
    value: unknown,
  ): value is readonly RedirectHop[];
  validateHealthRedirectResponse(
    value: unknown,
  ): HealthRedirectResponseValidation;
}

declare const require: (
  specifier: "./health-fact-validation.ts",
) => unknown;

const {
  validateHealthRedirectHistory,
  validateHealthRedirectResponse,
  validateHealthTransportFact,
} = require("./health-fact-validation.ts") as HealthFactValidationApi;

type HealthClassification = {
  readonly status: HealthStatus;
  readonly finalUrl?: string;
  readonly httpStatus?: number;
  readonly headers: readonly HealthSelectedHeader[];
  readonly errorCode?: HealthTransportFailureCode;
};

type HealthClassificationFailure = {
  readonly code: "invalid_fact" | "redirect_required" | "invalid_redirect";
};

const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308] as const;
const FAILURE_STATUS_BY_CODE: Readonly<
  Record<HealthTransportFailureCode, HealthStatus>
> = {
  unsupported_url: "unsupported_url",
  timeout: "timeout",
  dns_failure: "dns_failure",
  tls_error: "tls_error",
  connection_failure: "uncertain",
  malformed_response: "uncertain",
  unknown_transport: "uncertain",
};

function failure(
  code: HealthClassificationFailure["code"],
): Outcome<never, HealthClassificationFailure> {
  return { ok: false, error: { code } };
}

function isRedirectStatusCode(value: number): boolean {
  return (REDIRECT_STATUS_CODES as readonly number[]).includes(value);
}

function classifyResponseStatus(
  statusCode: number,
  redirects: readonly RedirectHop[],
): HealthStatus {
  if (statusCode >= 200 && statusCode <= 299) {
    if (redirects.length === 0) {
      return "healthy";
    }
    return redirects.every(
      (redirect) => redirect.statusCode === 301 || redirect.statusCode === 308,
    )
      ? "redirect_permanent"
      : "redirect_temporary";
  }
  switch (statusCode) {
    case 401:
      return "authentication_required";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 410:
      return "gone";
    case 429:
      return "rate_limited";
    default:
      return statusCode >= 500 && statusCode <= 599
        ? "server_error"
        : "uncertain";
  }
}

function isAbsoluteUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function classifyTerminalHealthFact(
  fact: HealthTransportFact,
  redirects: readonly RedirectHop[],
): Outcome<HealthClassification, HealthClassificationFailure> {
  const validatedFact = validateHealthTransportFact(fact);
  if (validatedFact === null || !validateHealthRedirectHistory(redirects)) {
    return failure("invalid_fact");
  }

  if (validatedFact.kind === "failure") {
    const { code } = validatedFact.value;
    return {
      ok: true,
      value: {
        status: FAILURE_STATUS_BY_CODE[code],
        headers: [],
        errorCode: code,
      },
    };
  }

  if (isRedirectStatusCode(validatedFact.value.statusCode)) {
    return failure("redirect_required");
  }

  return {
    ok: true,
    value: {
      status: classifyResponseStatus(validatedFact.value.statusCode, redirects),
      finalUrl: validatedFact.value.url,
      httpStatus: validatedFact.value.statusCode,
      headers: validatedFact.value.headers,
    },
  };
}

function resolveHealthRedirect(
  currentUrl: string,
  response: HealthTransportResponse,
): Outcome<RedirectHop, HealthClassificationFailure> {
  if (!isAbsoluteUrl(currentUrl)) {
    return failure("invalid_redirect");
  }

  const validated = validateHealthRedirectResponse(response);
  if (!validated.ok) {
    return failure(validated.code);
  }

  let nextUrl: string;
  try {
    nextUrl = new URL(validated.location, currentUrl).toString();
  } catch {
    return failure("invalid_redirect");
  }

  return {
    ok: true,
    value: {
      requestedUrl: currentUrl,
      statusCode: validated.response.statusCode,
      location: validated.location,
      nextUrl,
    },
  };
}

declare const module: {
  exports: {
    classifyTerminalHealthFact: typeof classifyTerminalHealthFact;
    resolveHealthRedirect: typeof resolveHealthRedirect;
  };
};

module.exports = {
  classifyTerminalHealthFact,
  resolveHealthRedirect,
};
