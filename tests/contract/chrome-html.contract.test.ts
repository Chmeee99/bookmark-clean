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

test("Chrome HTML adapter public contract exposes no runtime surface", () => {
  assertDeepEqual(
    Object.keys(chromeHtmlPublic),
    [],
    "Chrome HTML adapter public module has runtime exports",
  );
});
