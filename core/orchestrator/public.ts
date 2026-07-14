import type {
  ChromeHtmlImporter,
  ChromeHtmlImportFailure,
  ChromeHtmlImportRequest,
} from "../../adapters/chrome-html/public.js";
import type {
  BookmarkCatalog,
  CatalogFailure,
  ImportSummary,
} from "../../modules/catalog/public.js";

export interface BookmarkCleanApp {
  importChromeHtml(
    request: ChromeHtmlImportRequest,
  ): Promise<ImportChromeHtmlOutcome>;
}

export type ImportChromeHtmlFailure =
  | {
      readonly stage: "source";
      readonly failure: ChromeHtmlImportFailure;
    }
  | {
      readonly stage: "catalog";
      readonly failure: CatalogFailure;
    };

export type ImportChromeHtmlOutcome =
  | { readonly ok: true; readonly value: ImportSummary }
  | { readonly ok: false; readonly error: ImportChromeHtmlFailure };

export interface BookmarkCleanAppDependencies {
  readonly importer: ChromeHtmlImporter;
  readonly catalog: BookmarkCatalog;
}

export declare function createBookmarkCleanApp(
  dependencies: BookmarkCleanAppDependencies,
): BookmarkCleanApp;

interface BookmarkCleanAppRuntime {
  createBookmarkCleanApp: typeof createBookmarkCleanApp;
}

declare const require: (specifier: "./bookmark-clean-app.ts") => unknown;
declare const module: {
  exports: { createBookmarkCleanApp: typeof createBookmarkCleanApp };
};

const { createBookmarkCleanApp: createBookmarkCleanAppRuntime } = require(
  "./bookmark-clean-app.ts",
) as BookmarkCleanAppRuntime;

module.exports = { createBookmarkCleanApp: createBookmarkCleanAppRuntime };
