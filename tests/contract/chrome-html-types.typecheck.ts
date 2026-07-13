import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type { BookmarkSnapshotInput } from "../../modules/catalog/public.js";
import type {
  ChromeHtmlImporter,
  ChromeHtmlImportFailure,
  ChromeHtmlImportFailureCode,
  ChromeHtmlImportFailureField,
  ChromeHtmlImportRequest,
} from "../../adapters/chrome-html/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type FailureCodes = Assert<
  Equal<
    ChromeHtmlImportFailureCode,
    "empty_input" | "missing_root_list" | "invalid_entry" | "invalid_timestamp"
  >
>;
type FailureFields = Assert<
  Equal<
    ChromeHtmlImportFailureField,
    "html" | "entry" | "add_date" | "last_modified" | "last_visit"
  >
>;
type ParseMethod = Assert<
  Equal<
    ChromeHtmlImporter["parse"],
    (
      request: ChromeHtmlImportRequest,
    ) => Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure>
  >
>;

declare const capturedAt: IsoDateTime;
const request: ChromeHtmlImportRequest = { html: "<DL></DL>", capturedAt };
const failure: ChromeHtmlImportFailure = {
  code: "missing_root_list",
  path: [],
  field: "html",
};

// @ts-expect-error parser nodes never cross the public boundary
request.document = {};
// @ts-expect-error failure fields are fixed contract values
failure.field = "parser_message";

void (null as unknown as FailureCodes);
void (null as unknown as FailureFields);
void (null as unknown as ParseMethod);
void request;
void failure;
