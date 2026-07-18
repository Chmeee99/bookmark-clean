import type { QualityTestHelpers } from "./model-quality-test-helpers.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const helpers = require("./model-quality-test-helpers.ts") as QualityTestHelpers;
const { assertDeepEqual, contract, loadFixture, validOutput } = helpers;
const assert: QualityTestHelpers["assert"] = helpers.assert;

test("calibration fixture contains 16 valid representative cases", () => {
  const result = contract.validateQualityCases(loadFixture());
  assert(result.ok, "Calibration fixture should validate");
  assert(result.value.length === 16, "Calibration fixture count changed");
  assert(
    new Set(result.value.map((item) => item.id)).size === 16,
    "Calibration case IDs must be unique",
  );
  assert(
    new Set(result.value.map((item) => item.category)).size >= 8,
    "Calibration category coverage is too narrow",
  );
  assert(
    result.value.some((item) => item.gold.expectedLanguage === "de") &&
      result.value.some((item) => item.gold.expectedLanguage === "en"),
    "Calibration must cover English and German",
  );
  assert(
    result.value.filter((item) => item.containsPageInstruction).length >= 2,
    "Calibration needs multiple prompt-injection cases",
  );
});

test("quality cases fail closed on duplicate IDs and malformed gold references", () => {
  const loaded = loadFixture();
  assert(Array.isArray(loaded), "Fixture should be an array");
  const duplicate = structuredClone(loaded);
  duplicate[1].id = duplicate[0].id;
  assertDeepEqual(
    contract.validateQualityCases(duplicate),
    { ok: false, code: "invalid_case" },
    "Duplicate case ID failure changed",
  );
  const missingSpan = structuredClone(loaded);
  missingSpan[0].gold.requiredFacts[0].acceptedEvidenceIds = ["missing-span"];
  assertDeepEqual(
    contract.validateQualityCases(missingSpan),
    { ok: false, code: "invalid_gold" },
    "Unknown gold evidence reference failure changed",
  );
});

test("quality output validation enforces exact structure and source evidence IDs", () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const benchmarkCase = loaded.value[0];
  assert(benchmarkCase !== undefined, "Fixture should contain a case");
  assert(
    contract.validateQualityOutput(validOutput(benchmarkCase), benchmarkCase).ok,
    "Valid quality output should pass",
  );
  const parsed = JSON.parse(validOutput(benchmarkCase)) as Record<string, any>;
  parsed.evidence.description = ["unknown-span"];
  assertDeepEqual(
    contract.validateQualityOutput(JSON.stringify(parsed), benchmarkCase),
    { ok: false, code: "invalid_evidence_reference" },
    "Unknown evidence reference failure changed",
  );
  const duplicateTag = JSON.parse(
    validOutput(benchmarkCase),
  ) as Record<string, any>;
  duplicateTag.literalTags = ["local", "local"];
  assertDeepEqual(
    contract.validateQualityOutput(JSON.stringify(duplicateTag), benchmarkCase),
    { ok: false, code: "invalid_schema" },
    "Duplicate tag failure changed",
  );
  const extra = JSON.parse(validOutput(benchmarkCase)) as Record<string, any>;
  extra.unsupported = true;
  assertDeepEqual(
    contract.validateQualityOutput(JSON.stringify(extra), benchmarkCase),
    { ok: false, code: "invalid_shape" },
    "Extra output key failure changed",
  );
});

test("quality output rejects language content type and warning contradictions", () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const cleanCase = loaded.value.find((item) => !item.containsPageInstruction);
  assert(cleanCase !== undefined, "Clean fixture case missing");
  const wrongLanguage = JSON.parse(validOutput(cleanCase)) as Record<string, any>;
  wrongLanguage.language =
    cleanCase.gold.expectedLanguage === "en" ? "de" : "en";
  assertDeepEqual(
    contract.validateQualityOutput(JSON.stringify(wrongLanguage), cleanCase),
    { ok: false, code: "language_mismatch" },
    "Language mismatch failure changed",
  );
  const wrongContentType = JSON.parse(
    validOutput(cleanCase),
  ) as Record<string, any>;
  wrongContentType.contentType =
    cleanCase.gold.acceptedContentTypes[0] === "article"
      ? "product"
      : "article";
  assertDeepEqual(
    contract.validateQualityOutput(JSON.stringify(wrongContentType), cleanCase),
    { ok: false, code: "content_type_mismatch" },
    "Content-type mismatch failure changed",
  );
  const contradictory = JSON.parse(
    validOutput(cleanCase),
  ) as Record<string, any>;
  contradictory.warnings = ["untrusted_instruction"];
  assertDeepEqual(
    contract.validateQualityOutput(JSON.stringify(contradictory), cleanCase),
    { ok: false, code: "warning_mismatch" },
    "Unexpected injection warning failure changed",
  );
});

test("quality request is strict bounded and explicitly frames untrusted spans", () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const benchmarkCase = loaded.value[0];
  assert(benchmarkCase !== undefined, "Fixture should contain a case");
  const request = contract.buildQualityChatRequest(
    "qwen/qwen3.6-27b",
    benchmarkCase,
  );
  assert(request.model === "qwen/qwen3.6-27b", "Request model changed");
  assert(request.temperature === 0, "Temperature changed");
  assert(request.stream === false, "Streaming was enabled");
  assert(request.enable_thinking === false, "Thinking was enabled");
  assert(
    request.max_tokens === contract.QUALITY_MAX_TOKENS,
    "Quality token budget changed",
  );
  const messages = request.messages as readonly Record<string, unknown>[];
  assert(
    typeof messages[1]?.content === "string" &&
      messages[1].content.includes("BEGIN UNTRUSTED SOURCE SPANS") &&
      messages[1].content.includes("END UNTRUSTED SOURCE SPANS") &&
      messages[1].content.includes(benchmarkCase.sourceSpans[0]?.id ?? ""),
    "Source-span framing changed",
  );
  const responseFormat = request.response_format as {
    readonly json_schema: {
      readonly strict: boolean;
      readonly schema: {
        readonly properties: {
          readonly literalTags: Record<string, unknown>;
        };
      };
    };
  };
  assert(responseFormat.json_schema.strict, "Strict JSON schema was disabled");
  assert(
    !(
      "uniqueItems" in
      responseFormat.json_schema.schema.properties.literalTags
    ),
    "Provider schema uses unsupported uniqueItems",
  );
});
