interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

declare const require: (
  specifier: "node:test" | "../../modules/jobs/public.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const jobsPublic = require("../../modules/jobs/public.ts") as Record<string, unknown>;

test("Jobs public contract exposes only its composition factories", () => {
  const keys = Object.keys(jobsPublic).sort();
  const expected = ["createJobEnqueuer", "createJobQueue", "createJobWorker"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected Jobs runtime exports: ${keys.join(", ")}`);
  }
  for (const key of expected) {
    if (typeof jobsPublic[key] !== "function") {
      throw new Error(`Jobs runtime export is not a function: ${key}`);
    }
  }
});
