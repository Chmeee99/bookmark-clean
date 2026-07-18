import type {
  EnrichmentQualityCase,
} from "../../tools/model-evaluation/quality-contract.js";
import type { LoadedCandidate } from "../../tools/model-evaluation/lm-studio-client.js";
import type {
  QualityGenerationEvidence,
} from "../../tools/model-evaluation/quality-lm-studio-client.js";
import type {
  QualityCalibrationOptions,
  QualityCalibrationResult,
} from "../../tools/model-evaluation/quality-main.js";
import type { QualityTestHelpers } from "./model-quality-test-helpers.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface QualityClientApi {
  runQualityGeneration(
    baseUrl: string,
    candidate: LoadedCandidate,
    benchmarkCase: EnrichmentQualityCase,
    fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  ): Promise<QualityGenerationEvidence>;
}

interface QualityMainApi {
  parseQualityArguments(arguments_: readonly string[]): QualityCalibrationOptions;
  runQualityCalibration(
    options: QualityCalibrationOptions,
    fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  ): Promise<QualityCalibrationResult>;
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const helpers = require("./model-quality-test-helpers.ts") as QualityTestHelpers;
const qualityClient = require(
  "../../tools/model-evaluation/quality-lm-studio-client.ts",
) as QualityClientApi;
const qualityMain = require(
  "../../tools/model-evaluation/quality-main.ts",
) as QualityMainApi;
const { contract, loadFixture, qualityChatResponse } = helpers;
const assert: QualityTestHelpers["assert"] = helpers.assert;

test("quality LM Studio client retries transport only and retains valid synthetic output", async () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const benchmarkCase = loaded.value[0];
  assert(benchmarkCase !== undefined, "Fixture should contain a case");
  const candidate = {
    modelKey: "qwen/qwen3.6-27b",
    instanceId: "qwen-instance",
  };
  const requestBodies: string[] = [];
  let calls = 0;
  const evidence = await qualityClient.runQualityGeneration(
    "http://127.0.0.1:1234",
    candidate,
    benchmarkCase,
    async (_input, init) => {
      calls += 1;
      requestBodies.push(String(init?.body));
      if (calls === 1) return new Response("temporary", { status: 503 });
      return qualityChatResponse(benchmarkCase, "reasoning_content");
    },
  );
  assert(evidence.attempts === 2, "Quality generation retry count changed");
  assert(requestBodies[0] === requestBodies[1], "Quality retry request changed");
  assert(evidence.schemaResult === "passed", "Quality output should validate");
  assert(evidence.output?.language === "en", "Valid synthetic output missing");
});

test("quality LM Studio client does not retain invalid provider prose", async () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const benchmarkCase = loaded.value[0];
  assert(benchmarkCase !== undefined, "Fixture should contain a case");
  const raw = "private malformed provider prose";
  const evidence = await qualityClient.runQualityGeneration(
    "http://127.0.0.1:1234",
    { modelKey: "qwen/qwen3.6-27b", instanceId: "qwen-instance" },
    benchmarkCase,
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: raw } }] }),
        { status: 200 },
      ),
  );
  assert(evidence.schemaResult === "failed", "Invalid prose should fail");
  assert(evidence.errorCode === "invalid_json", "Failure code changed");
  assert(
    !JSON.stringify(evidence).includes(raw),
    "Invalid provider prose was retained",
  );
});

test("quality runner validates arguments and executes all fixture cases", async () => {
  const options = qualityMain.parseQualityArguments([
    "--candidate=qwen/qwen3.6-27b",
    "--output-json=/tmp/quality.json",
    "--output-review=/tmp/quality.md",
  ]);
  assert(
    options.candidateKey === "qwen/qwen3.6-27b",
    "Candidate argument changed",
  );
  let unknownFailed = false;
  try {
    qualityMain.parseQualityArguments(["--unknown=value"]);
  } catch {
    unknownFailed = true;
  }
  assert(unknownFailed, "Unknown quality argument should fail");
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  let generationIndex = 0;
  const result = await qualityMain.runQualityCalibration(
    options,
    async (input) => {
      if (input.endsWith("/api/v1/models")) {
        return new Response(
          JSON.stringify({
            models: [
              {
                key: "qwen/qwen3.6-27b",
                type: "llm",
                loaded_instances: [{ id: "qwen-instance" }],
              },
            ],
          }),
          { status: 200 },
        );
      }
      const benchmarkCase = loaded.value[generationIndex];
      generationIndex += 1;
      assert(benchmarkCase !== undefined, "Unexpected generation request");
      return qualityChatResponse(benchmarkCase);
    },
  );
  assert(result.ok, "Fake quality calibration should execute");
  assert(result.report.attemptedCaseCount === 16, "Not all cases ran");
  assert(result.report.schemaValidRate === 1, "Schema valid rate changed");
  assert(
    result.review.includes("Candidate A") &&
      !result.review.includes("qwen/qwen3.6-27b"),
    "Generated review is not candidate-blinded",
  );
});
