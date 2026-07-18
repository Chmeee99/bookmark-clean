import type {
  EnrichmentQualityCase,
  EnrichmentQualityOutput,
} from "./quality-contract.js";

function renderSourceSpans(benchmarkCase: EnrichmentQualityCase): string {
  return benchmarkCase.sourceSpans
    .map((span) => `[${span.id}] (${span.kind}) ${span.text}`)
    .join("\n");
}

function renderGoldReference(benchmarkCase: EnrichmentQualityCase): string {
  const gold = benchmarkCase.gold;
  return [
    `- Expected language: ${gold.expectedLanguage}`,
    `- Accepted content types: ${gold.acceptedContentTypes.join(", ")}`,
    `- Required fact IDs: ${gold.requiredFacts.map((fact) => fact.id).join(", ")}`,
    `- Accepted literal tags: ${gold.acceptedLiteralTags.join(", ")}`,
    `- Accepted topics: ${gold.acceptedTopics.join(", ")}`,
    `- Accepted entities: ${
      gold.acceptedEntities
        .map((entity) => `${entity.name} (${entity.type})`)
        .join(", ") || "none"
    }`,
    `- Required warnings: ${gold.requiredWarnings.join(", ") || "none"}`,
    `- Forbidden exact claims: ${gold.forbiddenClaims.join(", ") || "none"}`,
  ].join("\n");
}

function renderOutput(output: EnrichmentQualityOutput | undefined): string {
  return output === undefined
    ? "No schema-valid candidate output."
    : JSON.stringify(output, null, 2);
}

function renderCase(
  benchmarkCase: EnrichmentQualityCase,
  output: EnrichmentQualityOutput | undefined,
): string {
  return [
    `## ${benchmarkCase.id}`,
    "",
    `Category: ${benchmarkCase.category}`,
    "",
    "BEGIN SOURCE SPANS",
    "```text",
    renderSourceSpans(benchmarkCase),
    "```",
    "END SOURCE SPANS",
    "",
    "### Candidate A output",
    "",
    "```json",
    renderOutput(output),
    "```",
    "",
    "### Human rating",
    "",
    "| Criterion | Rating |",
    "| --- | --- |",
    "| Groundedness (1-5) |  |",
    "| Usefulness (1-5) |  |",
    "| Retrieval value (1-5) |  |",
    "| Notes |  |",
    "",
    "<details>",
    "<summary>Gold reference</summary>",
    "",
    renderGoldReference(benchmarkCase),
    "",
    "</details>",
  ].join("\n");
}

function renderBlindedReview(
  cases: readonly EnrichmentQualityCase[],
  outputs: ReadonlyMap<string, EnrichmentQualityOutput>,
): string {
  const renderedCases = [...cases]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((benchmarkCase) =>
      renderCase(benchmarkCase, outputs.get(benchmarkCase.id)),
    );
  return [
    "# Enrichment quality blinded review",
    "",
    "Candidate identity is intentionally hidden. Review each source and Candidate A output before opening the gold reference.",
    "",
    ...renderedCases,
    "",
  ].join("\n");
}

interface QualityReviewRuntime {
  renderBlindedReview: typeof renderBlindedReview;
}

declare const module: { exports: QualityReviewRuntime };

module.exports = { renderBlindedReview };
