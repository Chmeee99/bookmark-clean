import type { IsoDateTime } from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  CatalogFailure,
  CatalogIdFactory,
  ImportSummary,
} from "../../modules/catalog/public.js";
import type {
  ChromeHtmlImporter,
  ChromeHtmlImportFailure,
  ChromeHtmlImportRequest,
} from "../../adapters/chrome-html/public.js";
import type {
  CatalogDatabaseFailure,
  CatalogDatabaseSession,
} from "../../adapters/sqlite/public.js";
import type {
  BookmarkCleanApp,
  BookmarkCleanAppDependencies,
  ImportChromeHtmlFailure,
} from "../../core/orchestrator/public.js";

export interface ImportCommandSuccess {
  readonly ok: true;
  readonly snapshotId: string;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}

export interface ImportCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "input_unavailable"
    | "storage_unavailable"
    | "import_failed"
    | "unexpected_failure";
  readonly stage?: "source" | "catalog";
  readonly failureCode?: string;
  readonly path?: readonly number[];
  readonly field?: string;
}

export type ImportCommandResult =
  | { readonly exitCode: 0; readonly output: ImportCommandSuccess }
  | {
      readonly exitCode: 1 | 2 | 3 | 4 | 5;
      readonly output: ImportCommandFailure;
    };

export type RunImportCommand = (
  arguments_: readonly string[],
) => Promise<ImportCommandResult>;

interface FileSystemApi {
  closeSync(descriptor: number): void;
  openSync(path: string, flags: "r"): number;
  readSync(
    descriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): number;
}

interface NodeBuffer extends Uint8Array {
  subarray(start: number, end: number): NodeBuffer;
}

interface BufferRuntime {
  readonly Buffer: {
    allocUnsafe(size: number): NodeBuffer;
  };
}

interface TextDecoderRuntime {
  readonly TextDecoder: new (
    label?: string,
    options?: { readonly fatal?: boolean },
  ) => {
    decode(input?: Uint8Array): string;
  };
}

interface CatalogRuntime {
  createBookmarkCatalog(dependencies: {
    readonly idFactory: CatalogIdFactory;
    readonly store: CatalogDatabaseSession["store"];
  }): BookmarkCatalog;
  createCryptoCatalogIdFactory(): CatalogIdFactory;
}

interface ChromeHtmlRuntime {
  CHROME_HTML_MAX_INPUT_BYTES: 16_777_216;
  parseBookmarksHtml: ChromeHtmlImporter["parse"];
}

interface SqliteRuntime {
  openCatalogDatabase(databasePath: string):
    | { readonly ok: true; readonly value: CatalogDatabaseSession }
    | { readonly ok: false; readonly error: CatalogDatabaseFailure };
}

interface OrchestratorRuntime {
  createBookmarkCleanApp(
    dependencies: BookmarkCleanAppDependencies,
  ): BookmarkCleanApp;
}

interface ImportOptions {
  readonly inputPath: string;
  readonly databasePath: string;
}

declare const require: (specifier: string) => unknown;
declare const module: {
  exports: { runImportCommand: RunImportCommand };
};

const loadModule = require as unknown as (specifier: string) => unknown;
const { Buffer } = loadModule("node:buffer") as BufferRuntime;
const { closeSync, openSync, readSync } = loadModule("node:fs") as FileSystemApi;
const { TextDecoder } = loadModule("node:util") as TextDecoderRuntime;
const {
  createBookmarkCatalog,
  createCryptoCatalogIdFactory,
} = loadModule("../../modules/catalog/public.ts") as CatalogRuntime;
const { CHROME_HTML_MAX_INPUT_BYTES, parseBookmarksHtml } = loadModule(
  "../../adapters/chrome-html/public.ts",
) as ChromeHtmlRuntime;
const { openCatalogDatabase } = loadModule(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;
const { createBookmarkCleanApp } = loadModule(
  "../../core/orchestrator/public.ts",
) as OrchestratorRuntime;

function parseArguments(arguments_: readonly string[]): ImportOptions | undefined {
  if (arguments_.length !== 4) return undefined;

  let inputPath: string | undefined;
  let databasePath: string | undefined;
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value.length === 0) return undefined;
    if (flag === "--input" && inputPath === undefined) {
      inputPath = value;
    } else if (flag === "--database" && databasePath === undefined) {
      databasePath = value;
    } else {
      return undefined;
    }
  }

  if (inputPath === undefined || databasePath === undefined) return undefined;
  return { inputPath, databasePath };
}

function failure(
  exitCode: 1 | 2 | 3 | 4 | 5,
  code: ImportCommandFailure["code"],
): ImportCommandResult {
  return { exitCode, output: { ok: false, code } };
}

function success(summary: ImportSummary): ImportCommandResult {
  return {
    exitCode: 0,
    output: {
      ok: true,
      snapshotId: summary.snapshotId,
      rootCount: summary.rootCount,
      folderCount: summary.folderCount,
      bookmarkCount: summary.bookmarkCount,
    },
  };
}

function structuredFailureFields(
  failureValue: ChromeHtmlImportFailure | CatalogFailure,
): Pick<ImportCommandFailure, "failureCode" | "path" | "field"> {
  return {
    failureCode: failureValue.code,
    ...("path" in failureValue ? { path: failureValue.path } : {}),
    ...("field" in failureValue && failureValue.field !== undefined
      ? { field: failureValue.field }
      : {}),
  };
}

function importFailure(error: ImportChromeHtmlFailure): ImportCommandResult {
  return {
    exitCode: 5,
    output: {
      ok: false,
      code: "import_failed",
      stage: error.stage,
      ...structuredFailureFields(error.failure),
    },
  };
}

function readBoundedHtml(path: string):
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly code: "input_unavailable" | "invalid_encoding" | "input_too_large";
    } {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const bytes = Buffer.allocUnsafe(CHROME_HTML_MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(
        descriptor,
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (read === 0) break;
      length += read;
    }
    closeSync(descriptor);
    descriptor = undefined;
    if (length > CHROME_HTML_MAX_INPUT_BYTES) {
      return { ok: false, code: "input_too_large" };
    }
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      return { ok: true, value: decoder.decode(bytes.subarray(0, length)) };
    } catch {
      return { ok: false, code: "invalid_encoding" };
    }
  } catch {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The command still owns one fixed input-unavailable result.
      }
    }
    return { ok: false, code: "input_unavailable" };
  }
}

const runImportCommand: RunImportCommand = async (arguments_) => {
  const options = parseArguments(arguments_);
  if (options === undefined) return failure(2, "invalid_arguments");

  const capturedAt = new Date().toISOString() as IsoDateTime;
  const input = readBoundedHtml(options.inputPath);
  if (!input.ok) {
    if (input.code === "input_too_large" || input.code === "invalid_encoding") {
      return importFailure({
        stage: "source",
        failure: {
          code: input.code,
          path: [],
          field: "html",
        },
      });
    }
    return failure(3, "input_unavailable");
  }

  const opened = openCatalogDatabase(options.databasePath);
  if (!opened.ok) return failure(4, "storage_unavailable");

  try {
    const catalog = createBookmarkCatalog({
      idFactory: createCryptoCatalogIdFactory(),
      store: opened.value.store,
    });
    const importer: ChromeHtmlImporter = { parse: parseBookmarksHtml };
    const application = createBookmarkCleanApp({ importer, catalog });
    const request: ChromeHtmlImportRequest = { html: input.value, capturedAt };
    const imported = await application.importChromeHtml(request);
    return imported.ok ? success(imported.value) : importFailure(imported.error);
  } finally {
    opened.value.close();
  }
};

module.exports = { runImportCommand };
