interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

declare const require: (
  specifier: "node:test" | "../../core/contracts/public.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const sharedContracts = require("../../core/contracts/public.ts") as Record<string, unknown>;

test("shared contracts expose no runtime surface", () => {
  const runtimeKeys = Object.keys(sharedContracts);
  if (runtimeKeys.length !== 0) {
    throw new Error(`Unexpected runtime exports: ${runtimeKeys.join(", ")}`);
  }
});
