interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

declare const require: (
  specifier: "node:test" | "../../modules/health/public.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const healthPublic = require("../../modules/health/public.ts") as Record<string, unknown>;

test("Health public contract exposes only its checker and handler factories", () => {
  const keys = Object.keys(healthPublic);
  if (
    JSON.stringify(keys) !== JSON.stringify([
      "createHealthCheckJobHandler",
      "createHealthChecker",
    ]) ||
    typeof healthPublic.createHealthChecker !== "function" ||
    typeof healthPublic.createHealthCheckJobHandler !== "function"
  ) {
    throw new Error(`Unexpected Health runtime exports: ${keys.join(", ")}`);
  }
});
