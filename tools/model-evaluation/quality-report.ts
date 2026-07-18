import type {
  EnrichmentQualityCase,
  EnrichmentQualityOutput,
} from "./quality-contract.js";
import type { LoadedCandidate } from "./lm-studio-client.js";
import type {
  QualityGenerationEvidence,
} from "./quality-lm-studio-client.js";
import type {
  QualityCaseScore,
  QualityScoreSummary,
} from "./quality-scorer.js";

export interface QualityThresholds {
  readonly requiredFactCoverage: number;
  readonly literalTagPrecision: number;
  readonly usefulTopicCoverage: number;
  readonly entityPrecision: number;
  readonly entityRecall: number;
  readonly languageAccuracy: number;
  readonly contentTypeAccuracy: number;
}

export interface QualityThresholdResults {
  readonly requiredFactCoverage: boolean;
  readonly literalTagPrecision: boolean;
  readonly usefulTopicCoverage: boolean;
  readonly entityPrecision: boolean;
  readonly entityRecall: boolean;
  readonly languageAccuracy: boolean;
  readonly contentTypeAccuracy: boolean;
  readonly passed: boolean;
}

export interface QualityReportCase extends QualityGenerationEvidence {
  readonly score?: QualityCaseScore;
}

export interface QualityCalibrationReport {
  readonly schemaVersion: "enrichment-quality-report-v1";
  readonly caseSchemaVersion: "enrichment-quality-case-v1";
  readonly outputSchemaVersion: "enrichment-output-v1";
  readonly candidateKey: string;
  readonly instanceId: string;
  readonly requestedCaseCount: number;
  readonly attemptedCaseCount: number;
  readonly schemaValidCount: number;
  readonly schemaValidRate: number;
  readonly evidenceValidCount: number;
  readonly evidenceValidRate: number;
  readonly scoredCaseCount: number;
  readonly qualitySummary?: QualityScoreSummary;
  readonly medianLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly totalDurationMs: number;
  readonly totalResponseBytes: number;
  readonly provisionalThresholds: QualityThresholds;
  readonly thresholdResults: QualityThresholdResults;
  readonly hardGatePassed: boolean;
  readonly automatedGatePassed: boolean;
  readonly cases: readonly QualityReportCase[];
}

interface ScorerApi {
  scoreQualityCase(
    benchmarkCase: EnrichmentQualityCase,
    output: EnrichmentQualityOutput,
  ): QualityCaseScore;
  summarizeQualityScores(
    scores: readonly QualityCaseScore[],
  ): QualityScoreSummary;
}

declare const require: (specifier: string) => unknown;

const scorer = require("./quality-scorer.ts") as ScorerApi;
const PROVISIONAL_THRESHOLDS: QualityThresholds = {
  requiredFactCoverage: 0.9,
  literalTagPrecision: 0.6,
  usefulTopicCoverage: 0.5,
  entityPrecision: 0.8,
  entityRecall: 0.7,
  languageAccuracy: 1,
  contentTypeAccuracy: 0.9,
};

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.ceil(ordered.length * fraction) - 1;
  return ordered[Math.max(0, index)] ?? 0;
}

function thresholdResults(
  summary: QualityScoreSummary | undefined,
): QualityThresholdResults {
  const results = {
    requiredFactCoverage:
      summary !== undefined &&
      summary.requiredFactCoverage >=
        PROVISIONAL_THRESHOLDS.requiredFactCoverage,
    literalTagPrecision:
      summary !== undefined &&
      summary.literalTagPrecision >=
        PROVISIONAL_THRESHOLDS.literalTagPrecision,
    usefulTopicCoverage:
      summary !== undefined &&
      summary.usefulTopicCoverage >=
        PROVISIONAL_THRESHOLDS.usefulTopicCoverage,
    entityPrecision:
      summary !== undefined &&
      summary.entityPrecision >= PROVISIONAL_THRESHOLDS.entityPrecision,
    entityRecall:
      summary !== undefined &&
      summary.entityRecall >= PROVISIONAL_THRESHOLDS.entityRecall,
    languageAccuracy:
      summary !== undefined &&
      summary.languageAccuracy >= PROVISIONAL_THRESHOLDS.languageAccuracy,
    contentTypeAccuracy:
      summary !== undefined &&
      summary.contentTypeAccuracy >=
        PROVISIONAL_THRESHOLDS.contentTypeAccuracy,
  };
  return {
    ...results,
    passed: Object.values(results).every(Boolean),
  };
}

function buildQualityReport(
  benchmarkCases: readonly EnrichmentQualityCase[],
  candidate: LoadedCandidate,
  evidence: readonly QualityGenerationEvidence[],
): QualityCalibrationReport {
  const caseById = new Map(benchmarkCases.map((item) => [item.id, item]));
  const reportCases: QualityReportCase[] = evidence.map((item) => {
    const benchmarkCase = caseById.get(item.fixtureId);
    if (benchmarkCase === undefined || item.output === undefined) return item;
    return {
      ...item,
      score: scorer.scoreQualityCase(benchmarkCase, item.output),
    };
  });
  const scores = reportCases.flatMap((item) =>
    item.score === undefined ? [] : [item.score],
  );
  const qualitySummary =
    scores.length === 0 ? undefined : scorer.summarizeQualityScores(scores);
  const schemaValidCount = evidence.filter(
    (item) => item.schemaResult === "passed",
  ).length;
  const thresholds = thresholdResults(qualitySummary);
  const hardGatePassed =
    evidence.length === benchmarkCases.length &&
    schemaValidCount === benchmarkCases.length &&
    qualitySummary?.hardGatePassed === true;
  return {
    schemaVersion: "enrichment-quality-report-v1",
    caseSchemaVersion: "enrichment-quality-case-v1",
    outputSchemaVersion: "enrichment-output-v1",
    candidateKey: candidate.modelKey,
    instanceId: candidate.instanceId,
    requestedCaseCount: benchmarkCases.length,
    attemptedCaseCount: evidence.length,
    schemaValidCount,
    schemaValidRate:
      benchmarkCases.length === 0 ? 0 : schemaValidCount / benchmarkCases.length,
    evidenceValidCount: schemaValidCount,
    evidenceValidRate:
      benchmarkCases.length === 0 ? 0 : schemaValidCount / benchmarkCases.length,
    scoredCaseCount: scores.length,
    ...(qualitySummary === undefined ? {} : { qualitySummary }),
    medianLatencyMs: percentile(
      evidence.map((item) => item.durationMs),
      0.5,
    ),
    p95LatencyMs: percentile(
      evidence.map((item) => item.durationMs),
      0.95,
    ),
    totalDurationMs: evidence.reduce(
      (total, item) => total + item.durationMs,
      0,
    ),
    totalResponseBytes: evidence.reduce(
      (total, item) => total + item.responseBytes,
      0,
    ),
    provisionalThresholds: PROVISIONAL_THRESHOLDS,
    thresholdResults: thresholds,
    hardGatePassed,
    automatedGatePassed: hardGatePassed && thresholds.passed,
    cases: reportCases,
  };
}

interface QualityReportRuntime {
  PROVISIONAL_THRESHOLDS: typeof PROVISIONAL_THRESHOLDS;
  buildQualityReport: typeof buildQualityReport;
}

declare const module: { exports: QualityReportRuntime };

module.exports = { PROVISIONAL_THRESHOLDS, buildQualityReport };
