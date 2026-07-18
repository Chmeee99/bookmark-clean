import type {
  EnrichmentGoldContract,
  EnrichmentQualityCase,
  QualityCategory,
  QualityContentType,
  QualityEntity,
  QualityEntityType,
  QualityValidationResult,
  QualityWarning,
  ScoredOutputField,
  SourceSpanKind,
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
  failure(code: string): QualityValidationFailure;
}

interface SchemaApi {
  readonly CONTENT_TYPES: readonly QualityContentType[];
  readonly ENTITY_TYPES: readonly QualityEntityType[];
  readonly TOPIC_TYPES: readonly string[];
  readonly SCORED_FIELDS: readonly ScoredOutputField[];
  readonly WARNINGS: readonly QualityWarning[];
}

declare const require: (specifier: string) => unknown;

const validation = require("./quality-validation.ts") as ValidationApi;
const schema = require("./quality-output-schema.ts") as SchemaApi;

const QUALITY_CASE_SCHEMA_VERSION = "enrichment-quality-case-v1";
const CASE_KEYS = [
  "schemaVersion",
  "id",
  "category",
  "title",
  "sourceSpans",
  "containsPageInstruction",
  "gold",
] as const;
const GOLD_KEYS = [
  "expectedLanguage",
  "acceptedContentTypes",
  "requiredFacts",
  "acceptedLiteralTags",
  "acceptedTopics",
  "acceptedEntities",
  "forbiddenEntities",
  "requiredWarnings",
  "forbiddenClaims",
] as const;
const CASE_CATEGORIES = [
  "article",
  "product",
  "documentation",
  "repository",
  "video",
  "sparse",
  "redirect",
  "failure",
  "prompt_injection",
] as const satisfies readonly QualityCategory[];
const SPAN_KINDS = [
  "metadata",
  "heading",
  "paragraph",
  "list",
  "code",
] as const satisfies readonly SourceSpanKind[];

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

function validateGold(
  value: unknown,
  spanIds: ReadonlySet<string>,
): value is EnrichmentGoldContract {
  if (!validation.isRecord(value) || !validation.hasExactKeys(value, GOLD_KEYS)) {
    return false;
  }
  if (
    !oneOf(value.expectedLanguage, ["en", "de"] as const) ||
    !validation.isUniqueStringArray(value.acceptedContentTypes, 1, 4, 80) ||
    !value.acceptedContentTypes.every((item) => oneOf(item, schema.CONTENT_TYPES)) ||
    !validation.isUniqueStringArray(value.acceptedLiteralTags, 1, 20, 80) ||
    !validation.isUniqueStringArray(value.acceptedTopics, 1, 20, 80) ||
    !value.acceptedTopics.every((item) => oneOf(item, schema.TOPIC_TYPES)) ||
    !Array.isArray(value.acceptedEntities) ||
    value.acceptedEntities.length > 20 ||
    !value.acceptedEntities.every(validateEntity) ||
    new Set(
      value.acceptedEntities.map((entity) => `${entity.type}:${entity.name}`),
    ).size !== value.acceptedEntities.length ||
    !Array.isArray(value.forbiddenEntities) ||
    value.forbiddenEntities.length > 20 ||
    !value.forbiddenEntities.every(validateEntity) ||
    new Set(
      value.forbiddenEntities.map((entity) => `${entity.type}:${entity.name}`),
    ).size !== value.forbiddenEntities.length ||
    !validation.isUniqueStringArray(value.requiredWarnings, 0, 4, 80) ||
    !value.requiredWarnings.every((item) => oneOf(item, schema.WARNINGS)) ||
    !validation.isUniqueStringArray(value.forbiddenClaims, 0, 20, 200)
  ) {
    return false;
  }
  if (!Array.isArray(value.requiredFacts) || value.requiredFacts.length === 0) {
    return false;
  }
  const factIds = new Set<string>();
  for (const fact of value.requiredFacts) {
    if (
      !validation.isRecord(fact) ||
      !validation.hasExactKeys(fact, [
        "id",
        "outputFields",
        "acceptedEvidenceIds",
      ]) ||
      !validation.isBoundedString(fact.id, 1, 80) ||
      factIds.has(fact.id) ||
      !validation.isUniqueStringArray(fact.outputFields, 1, 6, 80) ||
      !fact.outputFields.every((item) => oneOf(item, schema.SCORED_FIELDS)) ||
      !validation.isUniqueStringArray(fact.acceptedEvidenceIds, 1, 12, 80) ||
      !fact.acceptedEvidenceIds.every((id) => spanIds.has(id))
    ) {
      return false;
    }
    factIds.add(fact.id);
  }
  return true;
}

function validateSpans(
  spans: readonly unknown[],
): QualityValidationResult<ReadonlySet<string>> {
  const spanIds = new Set<string>();
  for (const span of spans) {
    if (
      !validation.isRecord(span) ||
      !validation.hasExactKeys(span, ["id", "kind", "text"]) ||
      !validation.isBoundedString(span.id, 1, 80) ||
      spanIds.has(span.id) ||
      !oneOf(span.kind, SPAN_KINDS) ||
      !validation.isBoundedString(span.text, 1, 2_000)
    ) {
      return validation.failure("invalid_span");
    }
    spanIds.add(span.id);
  }
  return { ok: true, value: spanIds };
}

function validateQualityCases(
  value: unknown,
): QualityValidationResult<readonly EnrichmentQualityCase[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return validation.failure("invalid_cases");
  }
  const caseIds = new Set<string>();
  const cases: EnrichmentQualityCase[] = [];
  for (const item of value) {
    if (
      !validation.isRecord(item) ||
      !validation.hasExactKeys(item, CASE_KEYS) ||
      item.schemaVersion !== QUALITY_CASE_SCHEMA_VERSION ||
      !validation.isBoundedString(item.id, 1, 80) ||
      caseIds.has(item.id) ||
      !oneOf(item.category, CASE_CATEGORIES) ||
      !validation.isBoundedString(item.title, 1, 200) ||
      typeof item.containsPageInstruction !== "boolean" ||
      !Array.isArray(item.sourceSpans) ||
      item.sourceSpans.length === 0 ||
      item.sourceSpans.length > 20
    ) {
      return validation.failure("invalid_case");
    }
    const spans = validateSpans(item.sourceSpans);
    if (!spans.ok) return spans;
    if (!validateGold(item.gold, spans.value)) {
      return validation.failure("invalid_gold");
    }
    const requiresInjectionWarning =
      item.gold.requiredWarnings.includes("untrusted_instruction");
    if (requiresInjectionWarning !== item.containsPageInstruction) {
      return validation.failure("invalid_gold");
    }
    caseIds.add(item.id);
    cases.push(item as unknown as EnrichmentQualityCase);
  }
  return { ok: true, value: cases };
}

interface QualityCaseValidationRuntime {
  QUALITY_CASE_SCHEMA_VERSION: typeof QUALITY_CASE_SCHEMA_VERSION;
  validateQualityCases: typeof validateQualityCases;
}

declare const module: { exports: QualityCaseValidationRuntime };

module.exports = {
  QUALITY_CASE_SCHEMA_VERSION,
  validateQualityCases,
};
