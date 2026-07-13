interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

declare const require: (
  specifier: "node:test" | "../../modules/health/public.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const healthPublic = require("../../modules/health/public.ts") as Record<
  string,
  unknown
>;

test("Health public contract exposes no runtime surface", () => {
  const keys = Object.keys(healthPublic);
  if (keys.length !== 0) {
    throw new Error(`Unexpected Health runtime exports: ${keys.join(", ")}`);
  }
});
