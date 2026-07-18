import type {
  EnrichmentQualityCase,
  EnrichmentQualityOutput,
  QualityValidationResult,
} from "../../tools/model-evaluation/quality-contract.js";

export interface QualityContractApi {
  readonly QUALITY_CASE_SCHEMA_VERSION: string;
  readonly QUALITY_OUTPUT_SCHEMA_VERSION: string;
  readonly QUALITY_MAX_TOKENS: number;
  validateQualityCases(
    value: unknown,
  ): QualityValidationResult<readonly EnrichmentQualityCase[]>;
  validateQualityOutput(
    content: unknown,
    benchmarkCase: EnrichmentQualityCase,
  ): QualityValidationResult<EnrichmentQualityOutput>;
  validateQualityOutputShape(
    content: unknown,
    benchmarkCase: EnrichmentQualityCase,
  ): QualityValidationResult<EnrichmentQualityOutput>;
  buildQualityChatRequest(
    model: string,
    benchmarkCase: EnrichmentQualityCase,
  ): Record<string, unknown>;
}

export interface QualityTestHelpers {
  readonly contract: QualityContractApi;
  assert(condition: unknown, message: string): asserts condition;
  assertDeepEqual(actual: unknown, expected: unknown, message: string): void;
  loadFixture(): unknown;
  validOutput(benchmarkCase: EnrichmentQualityCase): string;
  parseValidOutput(
    benchmarkCase: EnrichmentQualityCase,
  ): EnrichmentQualityOutput;
  qualityChatResponse(
    benchmarkCase: EnrichmentQualityCase,
    envelope?: "content" | "reasoning_content",
  ): Response;
}

interface FileSystemApi {
  readFileSync(path: string, encoding: "utf8"): string;
}

declare const require: (specifier: string) => unknown;

const fileSystem = require("node:fs") as FileSystemApi;
const contract = require(
  "../../tools/model-evaluation/quality-contract.ts",
) as QualityContractApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, ` +
        `received ${JSON.stringify(actual)}`,
    );
  }
}

function loadFixture(): unknown {
  return JSON.parse(
    fileSystem.readFileSync(
      "tests/fixtures/model-evaluation/enrichment-quality-calibration-v1.json",
      "utf8",
    ),
  ) as unknown;
}

function validOutput(benchmarkCase: EnrichmentQualityCase): string {
  const firstSpanId = benchmarkCase.sourceSpans[0]?.id;
  assert(firstSpanId !== undefined, "Fixture must contain a source span");
  return JSON.stringify({
    schemaVersion: contract.QUALITY_OUTPUT_SCHEMA_VERSION,
    description: "A grounded description of the supplied source.",
    detail: "The source explains a useful resource and its stated purpose.",
    literalTags: ["local"],
    topics: ["productivity"],
    entities: [],
    likelySaveIntent: "Revisit the resource when the stated topic is needed.",
    language: benchmarkCase.gold.expectedLanguage,
    contentType: benchmarkCase.gold.acceptedContentTypes[0] ?? "article",
    fieldConfidence: {
      description: 0.9,
      detail: 0.8,
      literalTags: 0.8,
      topics: 0.7,
      entities: 0.6,
      likelySaveIntent: 0.7,
    },
    evidence: {
      description: [firstSpanId],
      detail: [firstSpanId],
      literalTags: [firstSpanId],
      topics: [firstSpanId],
      entities: [],
      likelySaveIntent: [firstSpanId],
    },
    warnings: benchmarkCase.containsPageInstruction
      ? ["untrusted_instruction"]
      : [],
  });
}

function parseValidOutput(
  benchmarkCase: EnrichmentQualityCase,
): EnrichmentQualityOutput {
  const validated = contract.validateQualityOutput(
    validOutput(benchmarkCase),
    benchmarkCase,
  );
  assert(validated.ok, "Generated test output should validate");
  return validated.value;
}

function qualityChatResponse(
  benchmarkCase: EnrichmentQualityCase,
  envelope: "content" | "reasoning_content" = "content",
): Response {
  const output = JSON.parse(validOutput(benchmarkCase)) as Record<string, any>;
  output.warnings = benchmarkCase.gold.requiredWarnings;
  const message =
    envelope === "content"
      ? { content: JSON.stringify(output) }
      : { content: "", reasoning_content: JSON.stringify(output) };
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
  });
}

const runtime: QualityTestHelpers = {
  contract,
  assert,
  assertDeepEqual,
  loadFixture,
  validOutput,
  parseValidOutput,
  qualityChatResponse,
};

declare const module: { exports: QualityTestHelpers };

module.exports = runtime;
