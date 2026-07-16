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

export declare const CHROME_HTML_MAX_INPUT_BYTES: 16_777_216;

export type ChromeHtmlImportFailureCode =
  | "empty_input"
  | "missing_root_list"
  | "invalid_entry"
  | "invalid_timestamp"
  | "invalid_encoding"
  | "input_too_large"
  | "node_limit_exceeded"
  | "depth_limit_exceeded";

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

interface ChromeHtmlResourceLimitsRuntime {
  CHROME_HTML_MAX_INPUT_BYTES: typeof CHROME_HTML_MAX_INPUT_BYTES;
}

declare const require: (
  specifier:
    | "./chrome-html-resource-limits.ts"
    | "./parse-bookmarks-html.ts",
) => unknown;
declare const module: {
  exports: {
    CHROME_HTML_MAX_INPUT_BYTES: typeof CHROME_HTML_MAX_INPUT_BYTES;
    parseBookmarksHtml: typeof parseBookmarksHtml;
  };
};

const { CHROME_HTML_MAX_INPUT_BYTES: chromeHtmlMaxInputBytesRuntime } = require(
  "./chrome-html-resource-limits.ts",
) as ChromeHtmlResourceLimitsRuntime;
const { parseBookmarksHtml: parseBookmarksHtmlRuntime } = require(
  "./parse-bookmarks-html.ts",
) as ChromeHtmlRuntime;

module.exports = {
  CHROME_HTML_MAX_INPUT_BYTES: chromeHtmlMaxInputBytesRuntime,
  parseBookmarksHtml: parseBookmarksHtmlRuntime,
};
