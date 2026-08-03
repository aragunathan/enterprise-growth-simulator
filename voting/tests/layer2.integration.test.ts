import { describe, expect, it } from "vitest";
import type { GameData, Layer1Report, VoteResolution } from "../../simulation/src/index.js";
import { generateLayer2Narrative } from "../src/layer2.js";

/**
 * A small fixture with distinctive, real-sounding topic titles (not "Q1"/"Q2") so a
 * live model response can be checked for naming actual topics, not generic labels.
 */
const FIXTURE_GAME_DATA: GameData = {
  meta: {
    title: "Layer 2 Integration Fixture",
    version: "test",
    company: {
      location: "Austin, TX",
      industry: "SaaS",
      startHeadcount: 40,
      startRevenueUSD: 2_000_000,
      endHeadcount: 400,
      endRevenueUSD: 60_000_000,
    },
    format: { quarters: 3, targetGameplayMinutes: 1, votingMechanism: "plurality", outcomeModel: "plurality" },
    kpis: [
      { id: "RG", name: "Revenue Growth", baseline: 50, min: 0, max: 100, headline: true },
      { id: "EF", name: "Enterprise Friction", baseline: 20, min: 0, max: 100, headline: true },
    ],
    frictionDriftPerQuarter: 1,
    frictionDriftAppliesTo: "EF",
    voteTimerSeconds: 20,
    tieBreakPriority: [{ kpi: "RG", direction: "max" }],
    tieBreakFinalFallback: "first_listed_option",
  },
  quarters: [
    {
      id: 1,
      title: "Founding Team Equity Split",
      headcount: 40,
      businessContext: "",
      whyItHappens: "",
      choices: [
        { id: "A", label: "Split equity evenly among founders", immediate: { RG: 5 } },
        { id: "B", label: "Weight equity by founding contribution", immediate: { RG: 2 } },
        { id: "C", label: "Bring in a vesting cliff", immediate: { EF: 2 } },
        { id: "D", label: "Defer the split entirely", immediate: {} },
      ],
    },
    {
      id: 2,
      title: "First Enterprise Contract Negotiation",
      headcount: 120,
      businessContext: "",
      whyItHappens: "",
      choices: [
        { id: "A", label: "Accept a custom SLA to close the deal", immediate: { RG: 10, EF: 8 } },
        { id: "B", label: "Hold firm on the standard contract", immediate: { RG: 2 } },
        { id: "C", label: "Offer a steep discount instead", immediate: { RG: 6, EF: 3 } },
        { id: "D", label: "Walk away from the deal", immediate: {} },
      ],
    },
    {
      id: 3,
      title: "Remote-First Policy Reversal",
      headcount: 400,
      businessContext: "",
      whyItHappens: "",
      choices: [
        { id: "A", label: "Mandate a full return to office", immediate: { EF: 12 } },
        { id: "B", label: "Keep remote-first, add quarterly offsites", immediate: { RG: 3 } },
        { id: "C", label: "Hybrid — two office days per week", immediate: { EF: 5 } },
        { id: "D", label: "Let each team decide", immediate: { EF: 2 } },
      ],
    },
  ],
  delayedEffects: [],
  report: {
    layer1_deterministic: {
      headlineFramingRule: "test",
      scorecard: "test",
      biggestSwingsCount: 2,
      closingDiscussionQuestionRule: "test",
    },
    layer2_ai_generated: { trigger: "test", inputFields: [], outputSpec: "test", fallbackTemplate: "test" },
  },
};

const FIXTURE_VOTE_RESOLUTIONS: VoteResolution[] = [
  { quarterId: 1, winner: "A", voteCounts: { A: 4, B: 1 }, wasTie: false, tieBreakStepsUsed: [], usedFinalFallback: false },
  { quarterId: 2, winner: "A", voteCounts: { A: 3, C: 2 }, wasTie: false, tieBreakStepsUsed: [], usedFinalFallback: false },
  { quarterId: 3, winner: "A", voteCounts: { A: 3, B: 2 }, wasTie: false, tieBreakStepsUsed: [], usedFinalFallback: false },
];

const FIXTURE_LAYER1_REPORT: Layer1Report = {
  headline: "Enterprise Friction climbed from 20 to 47 over the two simulated years (+27).",
  scorecard: [
    { kpi: "RG", name: "Revenue Growth", baseline: 50, final: 67, delta: 17 },
    { kpi: "EF", name: "Enterprise Friction", baseline: 20, final: 47, delta: 27 },
  ],
  biggestSwings: [
    { kpi: "EF", name: "Enterprise Friction", baseline: 20, final: 47, delta: 27 },
    { kpi: "RG", name: "Revenue Growth", baseline: 50, final: 67, delta: 17 },
  ],
  closingDiscussionQuestion: {
    quarterId: 2,
    quarterTitle: "First Enterprise Contract Negotiation",
    basis: "closest_vote_split",
    detail: 'Q2 ("First Enterprise Contract Negotiation") had the closest vote split of the night: A:3, C:2.',
  },
};

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

// Unmocked — this test hits the real Anthropic API, unlike layer2.test.ts (which mocks
// the client and would happily "pass" even with an invalid model string). It exists
// specifically to catch that class of bug: a bad model ID, a malformed request, or a
// response shape the code doesn't actually parse correctly against the live API.
describe.skipIf(!hasApiKey)("generateLayer2Narrative — live Anthropic API", () => {
  it(
    "gets back a real 2-3 sentence narrative naming real quarter topics from the fixture, not the fallback template",
    async () => {
      const narrative = await generateLayer2Narrative(
        FIXTURE_GAME_DATA,
        FIXTURE_VOTE_RESOLUTIONS,
        FIXTURE_LAYER1_REPORT,
        { timeoutMs: 20_000 },
      );

      // It came back for real — a genuine model response, not the deterministic fallback.
      expect(narrative).not.toContain("Over the two simulated years, the room balanced growth against friction");

      // Sanity bounds on a 2-3 sentence narrative.
      expect(narrative.length).toBeGreaterThan(40);
      expect(narrative.length).toBeLessThan(900);
      expect(narrative).not.toMatch(/^[-*•]/m); // no bullet points

      // Required to name at least 2 of the fixture's actual quarter topics.
      const topicWords = [
        ["founding", "equity"],
        ["enterprise contract", "enterprise", "sla"],
        ["remote", "return to office", "hybrid", "office"],
      ];
      const mentionedTopics = topicWords.filter((words) =>
        words.some((w) => narrative.toLowerCase().includes(w.toLowerCase())),
      );
      expect(mentionedTopics.length).toBeGreaterThanOrEqual(2);
    },
    25_000,
  );
});

if (!hasApiKey) {
  // vitest silently skips the whole describe block above when there's no key; make that
  // visible in test output instead of it looking like the suite has one fewer test.
  describe("generateLayer2Narrative — live Anthropic API", () => {
    it.skip("skipped: ANTHROPIC_API_KEY is not set in this environment", () => {});
  });
}
