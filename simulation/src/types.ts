export type KpiId = "RG" | "Cash" | "EE" | "CX" | "Comp" | "Innov" | "DV" | "EF";

export type KpiState = Record<KpiId, number>;

export interface KpiDefinition {
  id: KpiId;
  name: string;
  baseline: number;
  min: number;
  max: number;
  headline: boolean;
}

export interface TieBreakRule {
  kpi: KpiId;
  direction: "min" | "max";
}

export interface GameMeta {
  title: string;
  version: string;
  company: {
    location: string;
    industry: string;
    startHeadcount: number;
    startRevenueUSD: number;
    endHeadcount: number;
    endRevenueUSD: number;
  };
  format: {
    quarters: number;
    targetGameplayMinutes: number;
    votingMechanism: string;
    outcomeModel: string;
  };
  kpis: KpiDefinition[];
  frictionDriftPerQuarter: number;
  frictionDriftAppliesTo: KpiId;
  voteTimerSeconds: number;
  tieBreakPriority: TieBreakRule[];
  tieBreakFinalFallback: "first_listed_option";
}

export type ChoiceId = "A" | "B" | "C" | "D";

export interface Choice {
  id: ChoiceId;
  label: string;
  immediate: Partial<KpiState>;
}

export interface Quarter {
  id: number;
  title: string;
  headcount: number;
  postMergerHeadcount?: number;
  businessContext: string;
  whyItHappens: string;
  choices: Choice[];
}

export interface DelayedEffect {
  originQuarter: number;
  originChoice: ChoiceId;
  targetQuarter: number;
  kpi: KpiId;
  delta: number;
  note: string;
}

export interface ReportSpec {
  layer1_deterministic: {
    headlineFramingRule: string;
    scorecard: string;
    biggestSwingsCount: number;
    closingDiscussionQuestionRule: string;
  };
  layer2_ai_generated: {
    trigger: string;
    inputFields: string[];
    outputSpec: string;
    fallbackTemplate: string;
  };
}

export interface GameData {
  meta: GameMeta;
  quarters: Quarter[];
  delayedEffects: DelayedEffect[];
  report: ReportSpec;
}

/** A delayed effect that landed in a given quarter, resolved against the choice that originated it. */
export interface AppliedDelayedEffect extends DelayedEffect {}

/** The result of playing a single quarter. */
export interface QuarterResult {
  quarterId: number;
  choiceId: ChoiceId;
  kpiBefore: KpiState;
  immediateDelta: Partial<KpiState>;
  appliedDelayedEffects: AppliedDelayedEffect[];
  frictionDrift: number;
  kpiAfterUnclamped: KpiState;
  kpiAfter: KpiState;
  clampedKpis: KpiId[];
}

export type VoteCounts = Partial<Record<ChoiceId, number>>;

export interface VoteResolution {
  quarterId: number;
  winner: ChoiceId;
  voteCounts: VoteCounts;
  wasTie: boolean;
  tieBreakStepsUsed: TieBreakRule[];
  usedFinalFallback: boolean;
}
