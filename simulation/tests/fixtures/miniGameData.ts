import type { GameData } from "../../src/types.js";

/**
 * A small, hand-computed synthetic game used to unit-test engine mechanics
 * (drift, delayed effects, clamping, tie-breaks) in isolation from the real
 * balancing numbers in docs/game-data.json, which can change independently.
 */
export const MINI_GAME_DATA: GameData = {
  meta: {
    title: "Mini Test Game",
    version: "test",
    company: {
      location: "Testville",
      industry: "test",
      startHeadcount: 100,
      startRevenueUSD: 1,
      endHeadcount: 100,
      endRevenueUSD: 1,
    },
    format: {
      quarters: 3,
      targetGameplayMinutes: 1,
      votingMechanism: "test",
      outcomeModel: "plurality",
    },
    kpis: [
      { id: "X" as never, name: "Metric X", baseline: 50, min: 0, max: 100, headline: true },
      { id: "Y" as never, name: "Metric Y", baseline: 50, min: 0, max: 100, headline: true },
    ],
    frictionDriftPerQuarter: 2,
    frictionDriftAppliesTo: "Y" as never,
    voteTimerSeconds: 20,
    tieBreakPriority: [
      { kpi: "X" as never, direction: "max" },
      { kpi: "Y" as never, direction: "min" },
    ],
    tieBreakFinalFallback: "first_listed_option",
  },
  quarters: [
    {
      id: 1,
      title: "Q1",
      headcount: 100,
      businessContext: "",
      whyItHappens: "",
      choices: [
        { id: "A", label: "A", immediate: { X: 10 } as never },
        { id: "B", label: "B", immediate: { X: 10 } as never },
        { id: "C", label: "C", immediate: { Y: -5 } as never },
        { id: "D", label: "D", immediate: { Y: 5 } as never },
      ],
    },
    {
      id: 2,
      title: "Q2",
      headcount: 100,
      businessContext: "",
      whyItHappens: "",
      choices: [
        { id: "A", label: "A", immediate: {} },
        { id: "B", label: "B", immediate: { X: -5 } as never },
        { id: "C", label: "C", immediate: {} },
        { id: "D", label: "D", immediate: {} },
      ],
    },
    {
      id: 3,
      title: "Q3",
      headcount: 100,
      businessContext: "",
      whyItHappens: "",
      choices: [
        { id: "A", label: "A", immediate: { X: 1000, Y: -1000 } as never },
        { id: "B", label: "B", immediate: {} },
        { id: "C", label: "C", immediate: {} },
        { id: "D", label: "D", immediate: {} },
      ],
    },
  ],
  delayedEffects: [
    {
      originQuarter: 1,
      originChoice: "A",
      targetQuarter: 2,
      kpi: "Y" as never,
      delta: 20,
      note: "test delayed effect",
    },
  ],
  report: {
    layer1_deterministic: {
      headlineFramingRule: "One sentence on final Y vs baseline",
      scorecard: "all KPIs, final value vs Q1 baseline",
      biggestSwingsCount: 2,
      closingDiscussionQuestionRule: "closest vote split; fallback: quarter with largest single contribution to final Y",
    },
    layer2_ai_generated: {
      trigger: "test",
      inputFields: [],
      outputSpec: "test",
      fallbackTemplate: "test",
    },
  },
};
