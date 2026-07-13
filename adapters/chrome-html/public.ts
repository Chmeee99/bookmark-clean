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
