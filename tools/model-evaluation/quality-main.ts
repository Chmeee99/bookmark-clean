import type {
  EnrichmentQualityCase,
  EnrichmentQualityOutput,
  QualityValidationResult,
} from "./quality-contract.js";
import type {
  LoadedCandidate,
} from "./lm-studio-client.js";
import type { Fetcher } from "./lm-studio-transport.js";
import type {
  QualityGenerationEvidence,
} from "./quality-lm-studio-client.js";
import type {
  QualityCalibrationReport,
} from "./quality-report.js";

export interface QualityCalibrationOptions {
  readonly baseUrl: string;
  readonly candidateKey: string;
  readonly fixturePath: string;
  readonly outputJsonPath: string;
  readonly outputReviewPath: string;
}

export type QualityCalibrationResult =
  | {
      readonly ok: true;
      readonly report: QualityCalibrationReport;
      readonly review: string;
    }
  | { readonly ok: false; readonly errorCode: string };

interface FileSystemApi {
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, encoding: "utf8"): void;
  renameSync(oldPath: string, newPath: string): void;
}

interface PathApi {
  resolve(...paths: string[]): string;
}

interface ProcessApi {
  readonly argv: readonly string[];
  readonly pid: number;
  cwd(): string;
  exitCode?: number;
  readonly stdout: { write(chunk: string): boolean };
}

interface ContractApi {
  validateQualityCases(
    value: unknown,
  ): QualityValidationResult<readonly EnrichmentQualityCase[]>;
}

interface DiscoveryApi {
  listLoadedCandidates(
    baseUrl: string,
    requestedKeys: readonly string[],
    fetcher?: Fetcher,
  ): Promise<QualityValidationResult<readonly LoadedCandidate[]>>;
}

interface QualityClientApi {
  runQualityGeneration(
    baseUrl: string,
    candidate: LoadedCandidate,
    benchmarkCase: EnrichmentQualityCase,
    fetcher?: Fetcher,
  ): Promise<QualityGenerationEvidence>;
}

interface ReportApi {
  buildQualityReport(
    benchmarkCases: readonly EnrichmentQualityCase[],
    candidate: LoadedCandidate,
    evidence: readonly QualityGenerationEvidence[],
  ): QualityCalibrationReport;
}

interface ReviewApi {
  renderBlindedReview(
    cases: readonly EnrichmentQualityCase[],
    outputs: ReadonlyMap<string, EnrichmentQualityOutput>,
  ): string;
}

declare const require: {
  (specifier: string): unknown;
  readonly main?: unknown;
};
declare const module: {
  exports: {
    parseQualityArguments: typeof parseQualityArguments;
    runQualityCalibration: typeof runQualityCalibration;
  };
};

const fileSystem = require("node:fs") as FileSystemApi;
const path = require("node:path") as PathApi;
const processApi = require("node:process") as ProcessApi;
const contract = require("./quality-contract.ts") as ContractApi;
const discovery = require("./lm-studio-client.ts") as DiscoveryApi;
const qualityClient = require(
  "./quality-lm-studio-client.ts",
) as QualityClientApi;
const reportBuilder = require("./quality-report.ts") as ReportApi;
const reviewBuilder = require("./quality-review.ts") as ReviewApi;

const DEFAULT_BASE_URL = "http://127.0.0.1:1234";
const DEFAULT_CANDIDATE = "qwen/qwen3.6-27b";
const DEFAULT_FIXTURE =
  "tests/fixtures/model-evaluation/enrichment-quality-calibration-v1.json";
const DEFAULT_JSON_REPORT =
  "docs/reports/enrichment-quality-calibration-qwen3.6-27b.json";
const DEFAULT_REVIEW_REPORT =
  "docs/reports/enrichment-quality-calibration-blind-review.md";

function parseQualityArguments(
  arguments_: readonly string[],
): QualityCalibrationOptions {
  const values = {
    baseUrl: DEFAULT_BASE_URL,
    candidateKey: DEFAULT_CANDIDATE,
    fixturePath: DEFAULT_FIXTURE,
    outputJsonPath: DEFAULT_JSON_REPORT,
    outputReviewPath: DEFAULT_REVIEW_REPORT,
  };
  for (const argument of arguments_) {
    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const value = separator === -1 ? "" : argument.slice(separator + 1);
    if (name === "--base-url") values.baseUrl = value;
    else if (name === "--candidate") values.candidateKey = value;
    else if (name === "--fixtures") values.fixturePath = value;
    else if (name === "--output-json") values.outputJsonPath = value;
    else if (name === "--output-review") values.outputReviewPath = value;
    else throw new Error(`Unknown quality calibration argument: ${argument}`);
  }
  if (
    Object.values(values).some((value) => value.length === 0) ||
    values.outputJsonPath === values.outputReviewPath
  ) {
    throw new Error("Quality calibration arguments are invalid");
  }
  return values;
}

function loadCases(fixturePath: string): readonly EnrichmentQualityCase[] {
  const parsed = JSON.parse(
    fileSystem.readFileSync(path.resolve(processApi.cwd(), fixturePath), "utf8"),
  ) as unknown;
  const validated = contract.validateQualityCases(parsed);
  if (!validated.ok) {
    throw new Error(`Quality fixtures failed: ${validated.code}`);
  }
  return validated.value;
}

async function runQualityCalibration(
  options: QualityCalibrationOptions,
  fetcher: Fetcher = fetch,
): Promise<QualityCalibrationResult> {
  const cases = loadCases(options.fixturePath);
  const loaded = await discovery.listLoadedCandidates(
    options.baseUrl,
    [options.candidateKey],
    fetcher,
  );
  if (!loaded.ok) return { ok: false, errorCode: loaded.code };
  if (loaded.value.length === 0) {
    return { ok: false, errorCode: "candidate_not_loaded" };
  }
  if (loaded.value.length !== 1) {
    return { ok: false, errorCode: "candidate_instance_ambiguous" };
  }
  const candidate = loaded.value[0];
  if (candidate === undefined) {
    return { ok: false, errorCode: "candidate_not_loaded" };
  }
  const evidence: QualityGenerationEvidence[] = [];
  for (const benchmarkCase of cases) {
    evidence.push(
      await qualityClient.runQualityGeneration(
        options.baseUrl,
        candidate,
        benchmarkCase,
        fetcher,
      ),
    );
  }
  const report = reportBuilder.buildQualityReport(cases, candidate, evidence);
  const outputs = new Map(
    evidence.flatMap((item) =>
      item.output === undefined
        ? []
        : [[item.fixtureId, item.output] as const],
    ),
  );
  return {
    ok: true,
    report,
    review: reviewBuilder.renderBlindedReview(cases, outputs),
  };
}

function writeAtomically(targetPath: string, data: string): void {
  const resolved = path.resolve(processApi.cwd(), targetPath);
  const temporary = `${resolved}.${processApi.pid}.tmp`;
  fileSystem.writeFileSync(temporary, data, "utf8");
  fileSystem.renameSync(temporary, resolved);
}

async function main(): Promise<void> {
  const options = parseQualityArguments(processApi.argv.slice(2));
  const result = await runQualityCalibration(options);
  if (!result.ok) {
    processApi.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    processApi.exitCode = 1;
    return;
  }
  writeAtomically(
    options.outputJsonPath,
    `${JSON.stringify(result.report, null, 2)}\n`,
  );
  writeAtomically(options.outputReviewPath, result.review);
  processApi.stdout.write(
    `${JSON.stringify({
      outputJsonPath: options.outputJsonPath,
      outputReviewPath: options.outputReviewPath,
      candidateKey: result.report.candidateKey,
      attemptedCaseCount: result.report.attemptedCaseCount,
      schemaValidRate: result.report.schemaValidRate,
      hardGatePassed: result.report.hardGatePassed,
      automatedGatePassed: result.report.automatedGatePassed,
    }, null, 2)}\n`,
  );
  if (!result.report.automatedGatePassed) processApi.exitCode = 1;
}

if (require.main === module) {
  void main().catch(() => {
    processApi.exitCode = 1;
  });
}

module.exports = { parseQualityArguments, runQualityCalibration };
