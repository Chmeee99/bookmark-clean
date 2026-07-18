export interface UnknownRecord {
  readonly [key: string]: unknown;
}

export interface QualityValidationFailure {
  readonly ok: false;
  readonly code: string;
}

export type QualityValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | QualityValidationFailure;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: UnknownRecord, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(record);
  return (
    ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === "string" && keys.includes(key)) &&
    keys.every((key) => ownKeys.includes(key))
  );
}

function isBoundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isUniqueStringArray(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumLength: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumItems &&
    value.length <= maximumItems &&
    value.every((item) => isBoundedString(item, 1, maximumLength)) &&
    new Set(value).size === value.length
  );
}

function isConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function failure(code: string): QualityValidationFailure {
  return { ok: false, code };
}

interface QualityValidationRuntime {
  isRecord: typeof isRecord;
  hasExactKeys: typeof hasExactKeys;
  isBoundedString: typeof isBoundedString;
  isUniqueStringArray: typeof isUniqueStringArray;
  isConfidence: typeof isConfidence;
  failure: typeof failure;
}

declare const module: { exports: QualityValidationRuntime };

module.exports = {
  isRecord,
  hasExactKeys,
  isBoundedString,
  isUniqueStringArray,
  isConfidence,
  failure,
};
