import type {
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  BookmarkSnapshotInput,
  CatalogFailure,
  ImportSummary,
} from "../../modules/catalog/public.js";
import type {
  ChromeHtmlImporter,
  ChromeHtmlImportFailure,
  ChromeHtmlImportRequest,
} from "../../adapters/chrome-html/public.js";
import type {
  BookmarkCleanApp,
  BookmarkCleanAppDependencies,
} from "../../core/orchestrator/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface OrchestratorApi {
  createBookmarkCleanApp(
    dependencies: BookmarkCleanAppDependencies,
  ): BookmarkCleanApp;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const orchestratorPublic = loadModule(
  "../../core/orchestrator/public.ts",
) as OrchestratorApi & Record<string, unknown>;
const { createBookmarkCleanApp } = orchestratorPublic;

const CAPTURED_AT = "2026-07-14T12:00:00.000Z" as IsoDateTime;
const REQUEST: ChromeHtmlImportRequest = {
  html: "<DL></DL>",
  capturedAt: CAPTURED_AT,
};
const SNAPSHOT: BookmarkSnapshotInput = {
  source: "chrome_html",
  capturedAt: CAPTURED_AT,
  roots: [],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeCatalog(
  importSnapshot: BookmarkCatalog["importSnapshot"],
): BookmarkCatalog {
  return {
    importSnapshot,
    async getSnapshot() {
      throw new Error("getSnapshot must not be called");
    },
    async getBookmark() {
      throw new Error("getBookmark must not be called");
    },
  };
}

test("source failure short-circuits Catalog and preserves its author-owned failure", async () => {
  assert(
    JSON.stringify(Object.keys(orchestratorPublic)) ===
      JSON.stringify(["createBookmarkCleanApp"]),
    "Orchestrator public runtime exports changed",
  );
  const sourceFailure: ChromeHtmlImportFailure = {
    code: "empty_input",
    path: [],
    field: "html",
  };
  let receivedRequest: ChromeHtmlImportRequest | undefined;
  let catalogCalls = 0;
  const importer: ChromeHtmlImporter = {
    parse(request) {
      receivedRequest = request;
      return { ok: false, error: sourceFailure };
    },
  };
  const catalog = makeCatalog(async () => {
    catalogCalls += 1;
    throw new Error("Catalog must not run after source failure");
  });

  const result = await createBookmarkCleanApp({ importer, catalog })
    .importChromeHtml(REQUEST);

  assert(receivedRequest === REQUEST, "Importer did not receive the request reference");
  assert(catalogCalls === 0, "Catalog ran after source failure");
  assert(!result.ok, "Source failure unexpectedly succeeded");
  assert(result.error.stage === "source", "Source failure stage changed");
  assert(result.error.failure === sourceFailure, "Source failure reference changed");
});

test("Catalog failure follows parsing and preserves snapshot and failure references", async () => {
  const calls: string[] = [];
  const catalogFailure: CatalogFailure = { code: "storage_unavailable" };
  let receivedSnapshot: BookmarkSnapshotInput | undefined;
  const importer: ChromeHtmlImporter = {
    parse() {
      calls.push("parse");
      return { ok: true, value: SNAPSHOT };
    },
  };
  const catalog = makeCatalog(async (snapshot) => {
    calls.push("catalog");
    receivedSnapshot = snapshot;
    return { ok: false, error: catalogFailure };
  });

  const result = await createBookmarkCleanApp({ importer, catalog })
    .importChromeHtml(REQUEST);

  assert(calls.join(",") === "parse,catalog", "Parse/import call order changed");
  assert(receivedSnapshot === SNAPSHOT, "Parsed snapshot reference changed");
  assert(!result.ok, "Catalog failure unexpectedly succeeded");
  assert(result.error.stage === "catalog", "Catalog failure stage changed");
  assert(result.error.failure === catalogFailure, "Catalog failure reference changed");
});

test("success returns the Catalog outcome without replacing its summary", async () => {
  const summary: ImportSummary = {
    snapshotId: "snapshot:orchestrator" as SnapshotId,
    rootCount: 0,
    folderCount: 0,
    bookmarkCount: 0,
  };
  const catalogOutcome: Outcome<ImportSummary, CatalogFailure> = {
    ok: true,
    value: summary,
  };
  const importer: ChromeHtmlImporter = {
    parse: () => ({ ok: true, value: SNAPSHOT }),
  };
  const catalog = makeCatalog(async () => catalogOutcome);

  const result = await createBookmarkCleanApp({ importer, catalog })
    .importChromeHtml(REQUEST);

  assert(result === catalogOutcome, "Successful Catalog outcome reference changed");
  assert(result.ok && result.value === summary, "Import summary reference changed");
});
