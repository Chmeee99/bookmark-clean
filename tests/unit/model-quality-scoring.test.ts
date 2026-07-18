import type {
  EnrichmentQualityCase,
  EnrichmentQualityOutput,
} from "../../tools/model-evaluation/quality-contract.js";
import type {
  QualityCaseScore,
  QualityScoreSummary,
} from "../../tools/model-evaluation/quality-scorer.js";
import type { QualityTestHelpers } from "./model-quality-test-helpers.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface QualityScorerApi {
  scoreQualityCase(
    benchmarkCase: EnrichmentQualityCase,
    output: EnrichmentQualityOutput,
  ): QualityCaseScore;
  summarizeQualityScores(
    scores: readonly QualityCaseScore[],
  ): QualityScoreSummary;
}

interface QualityReviewApi {
  renderBlindedReview(
    cases: readonly EnrichmentQualityCase[],
    outputs: ReadonlyMap<string, EnrichmentQualityOutput>,
  ): string;
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const helpers = require("./model-quality-test-helpers.ts") as QualityTestHelpers;
const scorer = require(
  "../../tools/model-evaluation/quality-scorer.ts",
) as QualityScorerApi;
const review = require(
  "../../tools/model-evaluation/quality-review.ts",
) as QualityReviewApi;
const {
  assertDeepEqual,
  contract,
  loadFixture,
  parseValidOutput,
  validOutput,
} = helpers;
const assert: QualityTestHelpers["assert"] = helpers.assert;

test("quality scorer uses exact declared labels and evidence coverage", () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const benchmarkCase = loaded.value[0];
  assert(benchmarkCase !== undefined, "Fixture should contain a case");
  const base = parseValidOutput(benchmarkCase);
  const output: EnrichmentQualityOutput = {
    ...base,
    detail: "A supported summary without any forbidden exact phrase.",
    literalTags: ["heat pumps", "unlisted label"],
    topics: ["home energy", "unlisted topic"],
    evidence: {
      ...base.evidence,
      description: ["summary"],
      detail: ["summary", "cost"],
    },
  };
  const score = scorer.scoreQualityCase(benchmarkCase, output);
  assert(score.coveredRequiredFactCount === 2, "Fact coverage count changed");
  assert(score.requiredFactCoverage === 1, "Fact coverage rate changed");
  assert(score.literalTagPrecision === 0.5, "Tag precision changed");
  assert(score.literalTagRecall === 0.25, "Tag recall changed");
  assert(score.usefulTopicCoverage === 1 / 3, "Topic coverage changed");
  assert(score.entityPrecision === 1, "Empty entity precision changed");
  assert(score.entityRecall === 1, "Empty entity recall changed");
  assert(score.languageMatch, "Language score changed");
  assert(score.contentTypeMatch, "Content-type score changed");
  assert(score.warningMatch, "Warning comparison changed");
  assert(score.forbiddenClaimMatches.length === 0, "Unexpected forbidden match");
  assert(score.hardGatePassed, "Valid exact score should pass hard gates");
});

test("quality scorer reports exact forbidden claims and weighted summaries", () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const firstCase = loaded.value[0];
  const secondCase = loaded.value[1];
  assert(firstCase !== undefined && secondCase !== undefined, "Cases missing");
  const firstBase = parseValidOutput(firstCase);
  const secondBase = parseValidOutput(secondCase);
  const firstOutput = {
    ...firstBase,
    detail: "This source promises guaranteed savings.",
    evidence: {
      ...firstBase.evidence,
      description: ["summary"],
      detail: ["summary", "cost"],
    },
  };
  const secondOutput = {
    ...secondBase,
    entities: [
      { name: "WhisperFlow Local", type: "product" as const },
      { name: "Invented Vendor", type: "organization" as const },
    ],
    evidence: {
      ...secondBase.evidence,
      description: ["product"],
      detail: ["product", "platforms"],
      entities: ["product"],
    },
  };
  const firstScore = scorer.scoreQualityCase(firstCase, firstOutput);
  const secondScore = scorer.scoreQualityCase(secondCase, secondOutput);
  assertDeepEqual(
    firstScore.forbiddenClaimMatches,
    ["guaranteed savings"],
    "Forbidden exact phrase matching changed",
  );
  assert(!firstScore.hardGatePassed, "Forbidden claim should fail hard gate");
  assert(secondScore.entityPrecision === 0.5, "Entity precision changed");
  assert(secondScore.entityRecall === 1 / 3, "Entity recall changed");
  const summary = scorer.summarizeQualityScores([firstScore, secondScore]);
  assert(summary.caseCount === 2, "Summary case count changed");
  assert(summary.forbiddenClaimMatchCount === 1, "Forbidden total changed");
  assert(summary.hardGateFailureCount === 1, "Hard failure total changed");
  assert(
    summary.requiredFactCoverage === 4 / 4,
    "Weighted required fact coverage changed",
  );
});

test("shape validation retains exact provider classifications for scoring", () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const benchmarkCase = loaded.value[0];
  assert(benchmarkCase !== undefined, "Fixture should contain a case");
  const parsed = JSON.parse(validOutput(benchmarkCase)) as Record<string, any>;
  parsed.contentType = "product";
  const content = JSON.stringify(parsed);
  assertDeepEqual(
    contract.validateQualityOutput(content, benchmarkCase),
    { ok: false, code: "content_type_mismatch" },
    "Closed expected-label validation changed",
  );
  const shaped = contract.validateQualityOutputShape(content, benchmarkCase);
  assert(shaped.ok, "Structurally valid classification should be retained");
  const score = scorer.scoreQualityCase(benchmarkCase, shaped.value);
  assert(!score.contentTypeMatch, "Classification mismatch was not scored");
  assert(!score.hardGatePassed, "Classification mismatch passed hard gate");
});

test("blinded review is deterministic and contains blank human ratings", () => {
  const loaded = contract.validateQualityCases(loadFixture());
  assert(loaded.ok, "Fixture should validate");
  const cases = [loaded.value[1], loaded.value[0]].filter(
    (item): item is EnrichmentQualityCase => item !== undefined,
  );
  const outputs = new Map(
    cases.map((benchmarkCase) => [
      benchmarkCase.id,
      parseValidOutput(benchmarkCase),
    ]),
  );
  const rendered = review.renderBlindedReview(cases, outputs);
  assert(rendered.includes("Candidate A"), "Blind candidate label missing");
  assert(!rendered.includes("qwen"), "Review leaked a model identity");
  assert(
    rendered.indexOf("article-heat-pumps-en") <
      rendered.indexOf("product-local-speech-en"),
    "Review case order is not deterministic",
  );
  assert(
    rendered.includes("| Groundedness (1-5) |  |") &&
      rendered.includes("| Usefulness (1-5) |  |") &&
      rendered.includes("| Retrieval value (1-5) |  |"),
    "Human rating fields are not blank",
  );
  assert(
    rendered.includes("BEGIN SOURCE SPANS") &&
      rendered.includes("END SOURCE SPANS"),
    "Review source framing changed",
  );
});
