export type Fetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpEvidence {
  readonly status?: number;
  readonly attempts: number;
  readonly durationMs: number;
  readonly responseBytes: number;
  readonly body?: string;
  readonly errorCode?: string;
}

export interface StructuredContentEvidence {
  readonly attempts: number;
  readonly durationMs: number;
  readonly responseBytes: number;
  readonly responseJsonResult: "passed" | "failed" | "not_attempted";
  readonly content?: string;
  readonly errorCode?: string;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestText(
  input: string,
  init: RequestInit,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<HttpEvidence> {
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(input, {
        ...init,
        signal: controller.signal,
      });
      const body = await response.text();
      if (response.status >= 500 && response.status <= 599 && attempt === 1) {
        continue;
      }
      return {
        status: response.status,
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        responseBytes: new TextEncoder().encode(body).byteLength,
        body,
      };
    } catch {
      if (attempt === 1) continue;
      return {
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        responseBytes: 0,
        errorCode: "transport_error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    attempts: 2,
    durationMs: Date.now() - startedAt,
    responseBytes: 0,
    errorCode: "transport_error",
  };
}

function extractContent(response: unknown): string | undefined {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    return undefined;
  }
  const choice = response.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return undefined;
  }
  const content = choice.message.content;
  const reasoningContent = choice.message.reasoning_content;
  if (typeof content === "string" && content.length > 0) {
    return content;
  }
  if (
    (content === "" || content === null || content === undefined) &&
    typeof reasoningContent === "string" &&
    reasoningContent.length > 0
  ) {
    return reasoningContent;
  }
  return undefined;
}

async function requestStructuredContent(
  input: string,
  request: Readonly<Record<string, unknown>>,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<StructuredContentEvidence> {
  const response = await requestText(
    input,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
    fetcher,
    timeoutMs,
  );
  const common = {
    attempts: response.attempts,
    durationMs: response.durationMs,
    responseBytes: response.responseBytes,
  };
  if (response.errorCode !== undefined) {
    return {
      ...common,
      responseJsonResult: "not_attempted",
      errorCode: response.errorCode,
    };
  }
  if (
    response.status === undefined ||
    response.status < 200 ||
    response.status >= 300
  ) {
    return {
      ...common,
      responseJsonResult: "not_attempted",
      errorCode: `http_${response.status ?? 0}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body ?? "") as unknown;
  } catch {
    return {
      ...common,
      responseJsonResult: "failed",
      errorCode: "invalid_response_json",
    };
  }
  const content = extractContent(parsed);
  if (content === undefined) {
    return {
      ...common,
      responseJsonResult: "passed",
      errorCode: "invalid_response_content",
    };
  }
  return { ...common, responseJsonResult: "passed", content };
}

interface LmStudioTransportRuntime {
  requestText: typeof requestText;
  requestStructuredContent: typeof requestStructuredContent;
}

declare const module: { exports: LmStudioTransportRuntime };

module.exports = { requestText, requestStructuredContent };
