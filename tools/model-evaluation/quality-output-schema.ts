import type {
  QualityContentType,
  QualityEntityType,
  QualityWarning,
  ScoredOutputField,
} from "./quality-contract.js";

const QUALITY_OUTPUT_SCHEMA_VERSION = "enrichment-output-v1";

const SCORED_FIELDS = [
  "description",
  "detail",
  "literalTags",
  "topics",
  "entities",
  "likelySaveIntent",
] as const satisfies readonly ScoredOutputField[];

const CONTENT_TYPES = [
  "article",
  "product",
  "documentation",
  "repository",
  "video",
  "landing_page",
  "redirect",
  "failure",
] as const satisfies readonly QualityContentType[];

const TOPIC_TYPES = [
  "software_development",
  "business",
  "technology",
  "science",
  "news",
  "education",
  "entertainment",
  "lifestyle",
  "other",
] as const;

const ENTITY_TYPES = [
  "organization",
  "person",
  "product",
  "technology",
  "place",
  "event",
  "other",
] as const satisfies readonly QualityEntityType[];

const WARNINGS = [
  "untrusted_instruction",
  "sparse_source",
  "redirect_only",
  "fetch_failure",
] as const satisfies readonly QualityWarning[];

const QUALITY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: {
      type: "string",
      enum: [QUALITY_OUTPUT_SCHEMA_VERSION],
    },
    description: { type: "string", minLength: 1, maxLength: 240 },
    detail: { type: "string", minLength: 1, maxLength: 700 },
    literalTags: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 80 },
      minItems: 1,
      maxItems: 8,
    },
    topics: {
      type: "array",
      items: { type: "string", enum: TOPIC_TYPES },
      minItems: 1,
      maxItems: 6,
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          type: { type: "string", enum: ENTITY_TYPES },
        },
        required: ["name", "type"],
        additionalProperties: false,
      },
      maxItems: 12,
    },
    likelySaveIntent: { type: "string", minLength: 1, maxLength: 300 },
    language: { type: "string", enum: ["en", "de"] },
    contentType: { type: "string", enum: CONTENT_TYPES },
    fieldConfidence: {
      type: "object",
      properties: Object.fromEntries(
        SCORED_FIELDS.map((field) => [
          field,
          { type: "number", minimum: 0, maximum: 1 },
        ]),
      ),
      required: SCORED_FIELDS,
      additionalProperties: false,
    },
    evidence: {
      type: "object",
      properties: Object.fromEntries(
        SCORED_FIELDS.map((field) => [
          field,
          {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 80 },
            maxItems: 12,
          },
        ]),
      ),
      required: SCORED_FIELDS,
      additionalProperties: false,
    },
    warnings: {
      type: "array",
      items: { type: "string", enum: WARNINGS },
      maxItems: WARNINGS.length,
    },
  },
  required: [
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
  ],
  additionalProperties: false,
} as const;

interface QualityOutputSchemaRuntime {
  QUALITY_OUTPUT_SCHEMA_VERSION: typeof QUALITY_OUTPUT_SCHEMA_VERSION;
  QUALITY_OUTPUT_SCHEMA: typeof QUALITY_OUTPUT_SCHEMA;
  SCORED_FIELDS: typeof SCORED_FIELDS;
  CONTENT_TYPES: typeof CONTENT_TYPES;
  TOPIC_TYPES: typeof TOPIC_TYPES;
  ENTITY_TYPES: typeof ENTITY_TYPES;
  WARNINGS: typeof WARNINGS;
}

declare const module: { exports: QualityOutputSchemaRuntime };

module.exports = {
  QUALITY_OUTPUT_SCHEMA_VERSION,
  QUALITY_OUTPUT_SCHEMA,
  SCORED_FIELDS,
  CONTENT_TYPES,
  TOPIC_TYPES,
  ENTITY_TYPES,
  WARNINGS,
};
