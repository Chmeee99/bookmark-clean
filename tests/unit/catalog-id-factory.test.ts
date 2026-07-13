import type { CatalogIdFactory } from "../../modules/catalog/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

interface CryptoCatalogIdFactoryApi {
  createCryptoCatalogIdFactory(): CatalogIdFactory;
}

declare const require: (
  specifier:
    | "node:test"
    | "../../modules/catalog/crypto-id-factory.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { createCryptoCatalogIdFactory } = require(
  "../../modules/catalog/crypto-id-factory.ts",
) as CryptoCatalogIdFactoryApi;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERATED_ID_COUNT = 10_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

test("factory emits separated canonical UUID IDs", () => {
  const factory = createCryptoCatalogIdFactory();
  const snapshotIds = Array.from(
    { length: GENERATED_ID_COUNT },
    () => factory.nextSnapshotId(),
  );
  const bookmarkIds = Array.from(
    { length: GENERATED_ID_COUNT },
    () => factory.nextBookmarkId(),
  );

  assertEqual(snapshotIds.length, GENERATED_ID_COUNT, "Wrong snapshot ID count");
  assertEqual(bookmarkIds.length, GENERATED_ID_COUNT, "Wrong bookmark ID count");
  assert(
    snapshotIds.every((id) => id.startsWith("snapshot:") && UUID_PATTERN.test(id.slice(9))),
    "Snapshot IDs must use the snapshot prefix and UUID syntax",
  );
  assert(
    bookmarkIds.every((id) => id.startsWith("bookmark:") && UUID_PATTERN.test(id.slice(9))),
    "Bookmark IDs must use the bookmark prefix and UUID syntax",
  );
  assert(
    snapshotIds.every((id) => id.length > "snapshot:".length),
    "Snapshot IDs must be non-empty after their prefix",
  );
  assert(
    bookmarkIds.every((id) => id.length > "bookmark:".length),
    "Bookmark IDs must be non-empty after their prefix",
  );
  assert(
    snapshotIds.every((id) => !id.startsWith("bookmark:")),
    "Snapshot IDs must not use the bookmark prefix",
  );
  assert(
    bookmarkIds.every((id) => !id.startsWith("snapshot:")),
    "Bookmark IDs must not use the snapshot prefix",
  );
  assertEqual(
    new Set(snapshotIds).size,
    GENERATED_ID_COUNT,
    "Snapshot IDs must be unique",
  );
  assertEqual(
    new Set(bookmarkIds).size,
    GENERATED_ID_COUNT,
    "Bookmark IDs must be unique",
  );
});
