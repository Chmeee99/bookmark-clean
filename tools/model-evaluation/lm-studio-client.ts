import type {
  BenchmarkCase,
  ValidationResult,
} from "./benchmark-contract.js";
import type {
  Fetcher,
  HttpEvidence,
  StructuredContentEvidence,
} from "./lm-studio-transport.js";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

export interface LoadedCandidate {
  readonly modelKey: string;
  readonly instanceId: string;
}

export interface GenerationEvidence {
  readonly fixtureId: string;
  readonly modelKey: string;
  readonly instanceId: string;
  readonly attempts: number;
  readonly durationMs: number;
  readonly responseBytes: number;
  readonly jsonResult: "passed" | "failed" | "not_attempted";
  readonly schemaResult: "passed" | "failed" | "not_attempted";
  readonly injectionResult: "passed" | "failed" | "not_applicable";
  readonly errorCode?: string;
}

interface ContractApi {
  buildChatRequest(
    model: string,
    benchmarkCase: BenchmarkCase,
  ): Record<string, unknown>;
  validateBenchmarkOutput(
    content: unknown,
    benchmarkCase: BenchmarkCase,
  ): ValidationResult<unknown>;
}

const MODEL_LIST_TIMEOUT_MS = 10_000;
const GENERATION_TIMEOUT_MS = 300_000;

declare const require: (specifier: string) => unknown;

const contract = (require as unknown as (specifier: string) => unknown)(
  "./benchmark-contract.ts",
) as ContractApi;
const transport = require("./lm-studio-transport.ts") as {
  requestText(
    input: string,
    init: RequestInit,
    fetcher: Fetcher,
    timeoutMs: number,
  ): Promise<HttpEvidence>;
  requestStructuredContent(
    input: string,
    request: Readonly<Record<string, unknown>>,
    fetcher: Fetcher,
    timeoutMs: number,
  ): Promise<StructuredContentEvidence>;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure<T>(code: string): ValidationResult<T> {
  return { ok: false, code };
}

function selectLoadedCandidates(
  modelList: unknown,
  requestedKeys: readonly string[],
): ValidationResult<readonly LoadedCandidate[]> {
  if (!isRecord(modelList) || !Array.isArray(modelList.models)) {
    return failure("invalid_model_list");
  }
  const selected: LoadedCandidate[] = [];
  for (const model of modelList.models) {
    if (
      !isRecord(model) ||
      typeof model.key !== "string" ||
      (model.type !== "llm" && model.type !== "embedding") ||
      !Array.isArray(model.loaded_instances)
    ) {
      return failure("invalid_model_entry");
    }
    if (model.type !== "llm" || !requestedKeys.includes(model.key)) continue;
    for (const instance of model.loaded_instances) {
      if (!isRecord(instance) || typeof instance.id !== "string") {
        return failure("invalid_loaded_instance");
      }
      selected.push({ modelKey: model.key, instanceId: instance.id });
    }
  }
  selected.sort(
    (left, right) =>
      requestedKeys.indexOf(left.modelKey) -
        requestedKeys.indexOf(right.modelKey) ||
      left.instanceId.localeCompare(right.instanceId),
  );
  return { ok: true, value: selected };
}

async function listLoadedCandidates(
  baseUrl: string,
  requestedKeys: readonly string[],
  fetcher: Fetcher = fetch,
): Promise<ValidationResult<readonly LoadedCandidate[]>> {
  const response = await transport.requestText(
    `${baseUrl.replace(/\/$/, "")}/api/v1/models`,
    { method: "GET", headers: { accept: "application/json" } },
    fetcher,
    MODEL_LIST_TIMEOUT_MS,
  );
  if (response.errorCode !== undefined) return failure(response.errorCode);
  if (response.status === undefined || response.status < 200 || response.status >= 300) {
    return failure(`http_${response.status ?? 0}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body ?? "") as unknown;
  } catch {
    return failure("invalid_model_list_json");
  }
  return selectLoadedCandidates(parsed, requestedKeys);
}

async function runGeneration(
  baseUrl: string,
  candidate: LoadedCandidate,
  benchmarkCase: BenchmarkCase,
  fetcher: Fetcher = fetch,
): Promise<GenerationEvidence> {
  const response = await transport.requestStructuredContent(
    `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
    contract.buildChatRequest(candidate.instanceId, benchmarkCase),
    fetcher,
    GENERATION_TIMEOUT_MS,
  );
  const common = {
    fixtureId: benchmarkCase.id,
    modelKey: candidate.modelKey,
    instanceId: candidate.instanceId,
    attempts: response.attempts,
    durationMs: response.durationMs,
    responseBytes: response.responseBytes,
  };
  if (response.errorCode !== undefined) {
    return {
      ...common,
      jsonResult: response.responseJsonResult,
      schemaResult:
        response.responseJsonResult === "passed"
          ? "failed"
          : "not_attempted",
      injectionResult: "not_applicable",
      errorCode: response.errorCode,
    };
  }
  const validation = contract.validateBenchmarkOutput(
    response.content,
    benchmarkCase,
  );
  if (!validation.ok) {
    return {
      ...common,
      jsonResult: "passed",
      schemaResult: "failed",
      injectionResult:
        validation.code === "page_instruction_mismatch"
          ? "failed"
          : "not_applicable",
      errorCode: validation.code,
    };
  }
  return {
    ...common,
    jsonResult: "passed",
    schemaResult: "passed",
    injectionResult: benchmarkCase.containsPageInstruction
      ? "passed"
      : "not_applicable",
  };
}

interface LmStudioClientRuntime {
  selectLoadedCandidates: typeof selectLoadedCandidates;
  listLoadedCandidates: typeof listLoadedCandidates;
  runGeneration: typeof runGeneration;
}

declare const module: { exports: LmStudioClientRuntime };

module.exports = {
  selectLoadedCandidates,
  listLoadedCandidates,
  runGeneration,
};
