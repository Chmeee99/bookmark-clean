import type {
  IsoDateTime,
  Outcome,
} from "../../core/contracts/public.js";
import type { BookmarkSnapshotInput } from "../../modules/catalog/public.js";

export interface ChromeHtmlImporter {
  parse(
    request: ChromeHtmlImportRequest,
  ): Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure>;
}

export interface ChromeHtmlImportRequest {
  readonly html: string;
  readonly capturedAt: IsoDateTime;
}

export type ChromeHtmlImportFailureCode =
  | "empty_input"
  | "missing_root_list"
  | "invalid_entry"
  | "invalid_timestamp";

export type ChromeHtmlImportFailureField =
  | "html"
  | "entry"
  | "add_date"
  | "last_modified"
  | "last_visit";

export interface ChromeHtmlImportFailure {
  readonly code: ChromeHtmlImportFailureCode;
  readonly path: readonly number[];
  readonly field: ChromeHtmlImportFailureField;
  readonly diagnostic?: string;
}

export declare function parseBookmarksHtml(
  request: ChromeHtmlImportRequest,
): Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure>;

interface ChromeHtmlRuntime {
  parseBookmarksHtml: typeof parseBookmarksHtml;
}

declare const require: (specifier: "./parse-bookmarks-html.ts") => unknown;
declare const module: {
  exports: { parseBookmarksHtml: typeof parseBookmarksHtml };
};

const { parseBookmarksHtml: parseBookmarksHtmlRuntime } = require(
  "./parse-bookmarks-html.ts",
) as ChromeHtmlRuntime;

module.exports = { parseBookmarksHtml: parseBookmarksHtmlRuntime };
