interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

declare const require: (
  specifier: "node:test" | "../../adapters/chrome-html/public.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const chromeHtmlPublic = require("../../adapters/chrome-html/public.ts") as Record<
  string,
  unknown
>;

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

test("Chrome HTML adapter public contract exposes only its parser", () => {
  assertDeepEqual(
    Object.keys(chromeHtmlPublic),
    ["CHROME_HTML_MAX_INPUT_BYTES", "parseBookmarksHtml"],
    "Chrome HTML adapter public runtime exports changed",
  );
  if (
    chromeHtmlPublic.CHROME_HTML_MAX_INPUT_BYTES !== 16_777_216 ||
    typeof chromeHtmlPublic.parseBookmarksHtml !== "function"
  ) {
    throw new Error("Chrome HTML public exports changed");
  }
});
