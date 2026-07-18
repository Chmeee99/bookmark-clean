import type {
  EnrichmentQualityCase,
  EnrichmentQualityOutput,
  QualityValidationResult,
} from "./quality-contract.js";
import type { LoadedCandidate } from "./lm-studio-client.js";
import type {
  Fetcher,
  StructuredContentEvidence,
} from "./lm-studio-transport.js";

export interface QualityGenerationEvidence {
  readonly fixtureId: string;
  readonly modelKey: string;
  readonly instanceId: string;
  readonly attempts: number;
  readonly durationMs: number;
  readonly responseBytes: number;
  readonly responseJsonResult: "passed" | "failed" | "not_attempted";
  readonly schemaResult: "passed" | "failed" | "not_attempted";
  readonly errorCode?: string;
  readonly output?: EnrichmentQualityOutput;
}

interface ContractApi {
  buildQualityChatRequest(
    model: string,
    benchmarkCase: EnrichmentQualityCase,
  ): Record<string, unknown>;
  validateQualityOutputShape(
    content: unknown,
    benchmarkCase: EnrichmentQualityCase,
  ): QualityValidationResult<EnrichmentQualityOutput>;
}

interface TransportApi {
  requestStructuredContent(
    input: string,
    request: Readonly<Record<string, unknown>>,
    fetcher: Fetcher,
    timeoutMs: number,
  ): Promise<StructuredContentEvidence>;
}

declare const require: (specifier: string) => unknown;

const contract = require("./quality-contract.ts") as ContractApi;
const transport = require("./lm-studio-transport.ts") as TransportApi;
const GENERATION_TIMEOUT_MS = 300_000;

async function runQualityGeneration(
  baseUrl: string,
  candidate: LoadedCandidate,
  benchmarkCase: EnrichmentQualityCase,
  fetcher: Fetcher = fetch,
): Promise<QualityGenerationEvidence> {
  const response = await transport.requestStructuredContent(
    `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
    contract.buildQualityChatRequest(candidate.instanceId, benchmarkCase),
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
    responseJsonResult: response.responseJsonResult,
  };
  if (response.errorCode !== undefined) {
    return {
      ...common,
      schemaResult:
        response.responseJsonResult === "passed"
          ? "failed"
          : "not_attempted",
      errorCode: response.errorCode,
    };
  }
  const validation = contract.validateQualityOutputShape(
    response.content,
    benchmarkCase,
  );
  if (!validation.ok) {
    return {
      ...common,
      schemaResult: "failed",
      errorCode: validation.code,
    };
  }
  return {
    ...common,
    schemaResult: "passed",
    output: validation.value,
  };
}

interface QualityLmStudioClientRuntime {
  runQualityGeneration: typeof runQualityGeneration;
}

declare const module: { exports: QualityLmStudioClientRuntime };

module.exports = { runQualityGeneration };
