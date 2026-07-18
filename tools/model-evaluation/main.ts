import type {
  BenchmarkCase,
  ValidationResult,
} from "./benchmark-contract.js";
import type {
  GenerationEvidence,
  LoadedCandidate,
} from "./lm-studio-client.js";
import type { ModelBenchmarkSummary } from "./report.js";

interface FileSystemApi {
  readFileSync(path: string, encoding: "utf8"): string;
}

interface PathApi {
  resolve(...paths: string[]): string;
}

interface ContractApi {
  readonly DEFAULT_CANDIDATE_KEYS: readonly string[];
  validateBenchmarkCases(
    value: unknown,
  ): ValidationResult<readonly BenchmarkCase[]>;
}

interface ClientApi {
  listLoadedCandidates(
    baseUrl: string,
    requestedKeys: readonly string[],
  ): Promise<ValidationResult<readonly LoadedCandidate[]>>;
  runGeneration(
    baseUrl: string,
    candidate: LoadedCandidate,
    benchmarkCase: BenchmarkCase,
  ): Promise<GenerationEvidence>;
}

interface ReportApi {
  summarizeModel(
    evidence: readonly GenerationEvidence[],
  ): ModelBenchmarkSummary;
}

interface ProcessApi {
  readonly argv: readonly string[];
  cwd(): string;
  exitCode?: number;
  readonly stdout: { write(chunk: string): boolean };
}

declare const require: {
  (specifier: string): unknown;
  readonly main?: unknown;
};
declare const module: { exports: { runBenchmark: typeof runBenchmark } };

const fileSystem = require("node:fs") as FileSystemApi;
const path = require("node:path") as PathApi;
const processApi = require("node:process") as ProcessApi;
const contract = require("./benchmark-contract.ts") as ContractApi;
const client = require("./lm-studio-client.ts") as ClientApi;
const report = require("./report.ts") as ReportApi;

const DEFAULT_BASE_URL = "http://127.0.0.1:1234";
const DEFAULT_FIXTURE_PATH =
  "tests/fixtures/model-evaluation/structured-output-pilot.json";

interface BenchmarkOptions {
  readonly baseUrl: string;
  readonly candidateKeys: readonly string[];
  readonly fixturePath: string;
}

interface BenchmarkReport {
  readonly baseUrl: string;
  readonly requestedCandidateKeys: readonly string[];
  readonly missingCandidateKeys: readonly string[];
  readonly models: readonly ModelBenchmarkSummary[];
  readonly evidence: readonly GenerationEvidence[];
  readonly errorCode?: string;
}

function parseArguments(arguments_: readonly string[]): BenchmarkOptions {
  let baseUrl = DEFAULT_BASE_URL;
  let fixturePath = DEFAULT_FIXTURE_PATH;
  let candidateKeys: readonly string[] = contract.DEFAULT_CANDIDATE_KEYS;
  for (const argument of arguments_) {
    if (argument.startsWith("--base-url=")) {
      baseUrl = argument.slice("--base-url=".length);
    } else if (argument.startsWith("--fixtures=")) {
      fixturePath = argument.slice("--fixtures=".length);
    } else if (argument.startsWith("--candidates=")) {
      candidateKeys = argument
        .slice("--candidates=".length)
        .split(",")
        .filter((value) => value.length > 0);
    } else {
      throw new Error(`Unknown model benchmark argument: ${argument}`);
    }
  }
  if (
    baseUrl.length === 0 ||
    fixturePath.length === 0 ||
    candidateKeys.length === 0 ||
    new Set(candidateKeys).size !== candidateKeys.length
  ) {
    throw new Error("Model benchmark arguments are invalid");
  }
  return { baseUrl, candidateKeys, fixturePath };
}

function loadCases(fixturePath: string): readonly BenchmarkCase[] {
  const parsed = JSON.parse(
    fileSystem.readFileSync(path.resolve(processApi.cwd(), fixturePath), "utf8"),
  ) as unknown;
  const validated = contract.validateBenchmarkCases(parsed);
  if (!validated.ok) {
    throw new Error(`Benchmark fixtures failed: ${validated.code}`);
  }
  return validated.value;
}

async function runBenchmark(
  options: BenchmarkOptions,
): Promise<BenchmarkReport> {
  const cases = loadCases(options.fixturePath);
  const loaded = await client.listLoadedCandidates(
    options.baseUrl,
    options.candidateKeys,
  );
  if (!loaded.ok) {
    return {
      baseUrl: options.baseUrl,
      requestedCandidateKeys: options.candidateKeys,
      missingCandidateKeys: options.candidateKeys,
      models: [],
      evidence: [],
      errorCode: loaded.code,
    };
  }
  const loadedKeys = new Set(loaded.value.map((item) => item.modelKey));
  const missingCandidateKeys = options.candidateKeys.filter(
    (key) => !loadedKeys.has(key),
  );
  const evidence: GenerationEvidence[] = [];
  for (const candidate of loaded.value) {
    for (const benchmarkCase of cases) {
      evidence.push(
        await client.runGeneration(
          options.baseUrl,
          candidate,
          benchmarkCase,
        ),
      );
    }
  }
  const models = loaded.value.map((candidate) =>
    report.summarizeModel(
      evidence.filter(
        (item) =>
          item.modelKey === candidate.modelKey &&
          item.instanceId === candidate.instanceId,
      ),
    ),
  );
  return {
    baseUrl: options.baseUrl,
    requestedCandidateKeys: options.candidateKeys,
    missingCandidateKeys,
    models,
    evidence,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(processApi.argv.slice(2));
  const result = await runBenchmark(options);
  processApi.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    result.errorCode !== undefined ||
    result.missingCandidateKeys.length > 0 ||
    result.models.length === 0 ||
    result.models.some((model) => !model.passed)
  ) {
    processApi.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch(() => {
    processApi.exitCode = 1;
  });
}

module.exports = { runBenchmark };
