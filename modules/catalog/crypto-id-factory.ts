import type { BookmarkId, SnapshotId } from "../../core/contracts/public.js";
import type { CatalogIdFactory } from "./public.js";

interface CryptoApi {
  randomUUID(): string;
}

declare const require: (specifier: "node:crypto") => CryptoApi;
declare const module: {
  exports: {
    createCryptoCatalogIdFactory: typeof createCryptoCatalogIdFactory;
  };
};

const { randomUUID } = require("node:crypto");

function createCryptoCatalogIdFactory(): CatalogIdFactory {
  return {
    nextSnapshotId() {
      return `snapshot:${randomUUID()}` as SnapshotId;
    },
    nextBookmarkId() {
      return `bookmark:${randomUUID()}` as BookmarkId;
    },
  };
}

module.exports = { createCryptoCatalogIdFactory };
