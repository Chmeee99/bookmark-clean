import type {
  EnrichmentQualityCase,
  EnrichmentQualityOutput,
  QualityEntity,
  QualityEntityType,
  QualityEvidence,
  QualityFieldConfidence,
  QualityValidationResult,
  QualityWarning,
  ScoredOutputField,
} from "./quality-contract.js";
import type {
  QualityValidationFailure,
  UnknownRecord,
} from "./quality-validation.js";

interface ValidationApi {
  isRecord(value: unknown): value is UnknownRecord;
  hasExactKeys(record: UnknownRecord, keys: readonly string[]): boolean;
  isBoundedString(
    value: unknown,
    minimum: number,
    maximum: number,
  ): value is string;
  isUniqueStringArray(
    value: unknown,
    minimumItems: number,
    maximumItems: number,
    maximumLength: number,
  ): value is readonly string[];
  isConfidence(value: unknown): value is number;
  failure(code: string): QualityValidationFailure;
}

interface SchemaApi {
  readonly QUALITY_OUTPUT_SCHEMA_VERSION: string;
  readonly CONTENT_TYPES: readonly string[];
  readonly ENTITY_TYPES: readonly QualityEntityType[];
  readonly SCORED_FIELDS: readonly ScoredOutputField[];
  readonly WARNINGS: readonly QualityWarning[];
}

declare const require: (specifier: string) => unknown;

const validation = require("./quality-validation.ts") as ValidationApi;
const schema = require("./quality-output-schema.ts") as SchemaApi;

const OUTPUT_KEYS = [
  "schemaVersion",
  "description",
  "detail",
  "literalTags",
  "topics",
  "entities",
  "likelySaveIntent",
  "language",
  "contentType",
  "fieldConfidence",
  "evidence",
  "warnings",
] as const;

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function validateEntity(value: unknown): value is QualityEntity {
  return (
    validation.isRecord(value) &&
    validation.hasExactKeys(value, ["name", "type"]) &&
    validation.isBoundedString(value.name, 1, 120) &&
    oneOf(value.type, schema.ENTITY_TYPES)
  );
}

function validateConfidence(value: unknown): value is QualityFieldConfidence {
  return (
    validation.isRecord(value) &&
    validation.hasExactKeys(value, schema.SCORED_FIELDS) &&
    schema.SCORED_FIELDS.every((field) =>
      validation.isConfidence(value[field]),
    )
  );
}

function validateEvidence(
  value: unknown,
  spanIds: ReadonlySet<string>,
): QualityValidationResult<QualityEvidence> {
  if (
    !validation.isRecord(value) ||
    !validation.hasExactKeys(value, schema.SCORED_FIELDS)
  ) {
    return validation.failure("invalid_schema");
  }
  for (const field of schema.SCORED_FIELDS) {
    const minimum = field === "entities" ? 0 : 1;
    if (!validation.isUniqueStringArray(value[field], minimum, 12, 80)) {
      return validation.failure("invalid_schema");
    }
    if (!value[field].every((id) => spanIds.has(id))) {
      return validation.failure("invalid_evidence_reference");
    }
  }
  return { ok: true, value: value as unknown as QualityEvidence };
}

function validateQualityOutputShape(
  content: unknown,
  benchmarkCase: EnrichmentQualityCase,
): QualityValidationResult<EnrichmentQualityOutput> {
  if (typeof content !== "string") {
    return validation.failure("content_not_string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return validation.failure("invalid_json");
  }
  if (
    !validation.isRecord(parsed) ||
    !validation.hasExactKeys(parsed, OUTPUT_KEYS)
  ) {
    return validation.failure("invalid_shape");
  }
  if (
    parsed.schemaVersion !== schema.QUALITY_OUTPUT_SCHEMA_VERSION ||
    !validation.isBoundedString(parsed.description, 1, 240) ||
    !validation.isBoundedString(parsed.detail, 1, 700) ||
    !validation.isUniqueStringArray(parsed.literalTags, 1, 8, 80) ||
    !validation.isUniqueStringArray(parsed.topics, 1, 6, 80) ||
    !Array.isArray(parsed.entities) ||
    parsed.entities.length > 12 ||
    !parsed.entities.every(validateEntity) ||
    new Set(
      parsed.entities.map((entity) => `${entity.type}:${entity.name}`),
    ).size !== parsed.entities.length ||
    !validation.isBoundedString(parsed.likelySaveIntent, 1, 300) ||
    !oneOf(parsed.language, ["en", "de"] as const) ||
    !oneOf(parsed.contentType, schema.CONTENT_TYPES) ||
    !validateConfidence(parsed.fieldConfidence) ||
    !validation.isUniqueStringArray(parsed.warnings, 0, 4, 80) ||
    !parsed.warnings.every((item) => oneOf(item, schema.WARNINGS))
  ) {
    return validation.failure("invalid_schema");
  }
  const evidence = validateEvidence(
    parsed.evidence,
    new Set(benchmarkCase.sourceSpans.map((span) => span.id)),
  );
  if (!evidence.ok) return evidence;
  if (parsed.entities.length === 0 && evidence.value.entities.length > 0) {
    return validation.failure("invalid_schema");
  }
  return {
    ok: true,
    value: {
      ...(parsed as unknown as Omit<EnrichmentQualityOutput, "evidence">),
      evidence: evidence.value,
    },
  };
}

function validateQualityOutput(
  content: unknown,
  benchmarkCase: EnrichmentQualityCase,
): QualityValidationResult<EnrichmentQualityOutput> {
  const structured = validateQualityOutputShape(content, benchmarkCase);
  if (!structured.ok) return structured;
  if (structured.value.language !== benchmarkCase.gold.expectedLanguage) {
    return validation.failure("language_mismatch");
  }
  if (structured.value.contentType !== benchmarkCase.gold.expectedContentType) {
    return validation.failure("content_type_mismatch");
  }
  const warnsAboutInjection = structured.value.warnings.includes(
    "untrusted_instruction",
  );
  if (warnsAboutInjection !== benchmarkCase.containsPageInstruction) {
    return validation.failure("warning_mismatch");
  }
  return structured;
}

interface QualityOutputValidationRuntime {
  validateQualityOutputShape: typeof validateQualityOutputShape;
  validateQualityOutput: typeof validateQualityOutput;
}

declare const module: { exports: QualityOutputValidationRuntime };

module.exports = { validateQualityOutputShape, validateQualityOutput };
