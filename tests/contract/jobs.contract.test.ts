interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

declare const require: (
  specifier: "node:test" | "../../modules/jobs/public.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const jobsPublic = require("../../modules/jobs/public.ts") as Record<string, unknown>;

test("Jobs public contract exposes no runtime surface", () => {
  const keys = Object.keys(jobsPublic);
  if (keys.length !== 0) {
    throw new Error(`Unexpected Jobs runtime exports: ${keys.join(", ")}`);
  }
});
