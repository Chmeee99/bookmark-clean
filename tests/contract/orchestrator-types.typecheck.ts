import type { Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  ImportSummary,
} from "../../modules/catalog/public.js";
import type {
  ChromeHtmlImporter,
  ChromeHtmlImportRequest,
} from "../../adapters/chrome-html/public.js";
import {
  createBookmarkCleanApp,
  type BookmarkCleanApp,
  type BookmarkCleanAppDependencies,
  type ImportChromeHtmlFailure,
  type ImportChromeHtmlOutcome,
} from "../../core/orchestrator/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type FailureContract = Assert<Equal<
  ImportChromeHtmlFailure,
  | {
      readonly stage: "source";
      readonly failure: import(
        "../../adapters/chrome-html/public.js"
      ).ChromeHtmlImportFailure;
    }
  | {
      readonly stage: "catalog";
      readonly failure: import(
        "../../modules/catalog/public.js"
      ).CatalogFailure;
    }
>>;
type OutcomeContract = Assert<Equal<
  ImportChromeHtmlOutcome,
  | { readonly ok: true; readonly value: ImportSummary }
  | { readonly ok: false; readonly error: ImportChromeHtmlFailure }
>>;
type ApplicationContract = Assert<Equal<
  BookmarkCleanApp["importChromeHtml"],
  (request: ChromeHtmlImportRequest) => Promise<ImportChromeHtmlOutcome>
>>;
type DependencyContract = Assert<Equal<
  BookmarkCleanAppDependencies,
  {
    readonly importer: ChromeHtmlImporter;
    readonly catalog: BookmarkCatalog;
  }
>>;
type FactoryContract = Assert<Equal<
  typeof createBookmarkCleanApp,
  (dependencies: BookmarkCleanAppDependencies) => BookmarkCleanApp
>>;

declare const failure: ImportChromeHtmlFailure;
declare const genericOutcome: Outcome<ImportSummary, { readonly code: "example" }>;
// @ts-expect-error the orchestrator does not flatten author-owned failures into a code
failure.code;
const unsupportedStage: ImportChromeHtmlFailure = {
  // @ts-expect-error the staged union is closed
  stage: "storage",
  failure: { code: "storage_unavailable" },
};

void genericOutcome;
void unsupportedStage;
void (null as unknown as FailureContract);
void (null as unknown as OutcomeContract);
void (null as unknown as ApplicationContract);
void (null as unknown as DependencyContract);
void (null as unknown as FactoryContract);
