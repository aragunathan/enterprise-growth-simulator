import type { GameEngine } from "./engine.js";
import type { GameData, KpiId, VoteCounts, VoteResolution } from "./types.js";

export interface ScorecardEntry {
  kpi: KpiId;
  name: string;
  baseline: number;
  final: number;
  delta: number;
}

export interface ClosingDiscussionQuestion {
  quarterId: number;
  quarterTitle: string;
  basis: "closest_vote_split" | "largest_ef_contribution";
  detail: string;
}

export interface Layer1Report {
  headline: string;
  scorecard: ScorecardEntry[];
  biggestSwings: ScorecardEntry[];
  closingDiscussionQuestion: ClosingDiscussionQuestion;
}

/**
 * Builds the Layer 1 deterministic report per game-data.json's report.layer1_deterministic spec:
 * a headline on final Enterprise Friction vs baseline, a full 8-KPI scorecard, the 3 biggest
 * swings, and a closing discussion question (closest vote split, falling back to the quarter
 * with the largest single contribution to final Enterprise Friction when no vote data is given).
 */
export function generateLayer1Report(
  gameData: GameData,
  engine: GameEngine,
  voteResolutions?: VoteResolution[],
): Layer1Report {
  if (!engine.isComplete) {
    throw new Error("cannot generate the report before all quarters are played");
  }

  const finalState = engine.getFinalState();
  const scorecard: ScorecardEntry[] = gameData.meta.kpis.map((def) => ({
    kpi: def.id,
    name: def.name,
    baseline: def.baseline,
    final: finalState[def.id],
    delta: finalState[def.id] - def.baseline,
  }));

  const efKpi = gameData.meta.frictionDriftAppliesTo;
  const efEntry = scorecard.find((e) => e.kpi === efKpi);
  if (!efEntry) {
    throw new Error(`scorecard is missing the friction KPI "${efKpi}"`);
  }
  const headline = buildHeadline(efEntry);

  const biggestSwings = [...scorecard]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, gameData.report.layer1_deterministic.biggestSwingsCount);

  const closingDiscussionQuestion = buildClosingDiscussionQuestion(gameData, engine, voteResolutions);

  return { headline, scorecard, biggestSwings, closingDiscussionQuestion };
}

function buildHeadline(efEntry: ScorecardEntry): string {
  const { name, baseline, final, delta } = efEntry;
  if (delta === 0) {
    return `${name} ended the two simulated years exactly where it started, at ${final}.`;
  }
  const direction = delta > 0 ? "climbed" : "fell";
  const signedDelta = delta > 0 ? `+${delta}` : `${delta}`;
  return `${name} ${direction} from ${baseline} to ${final} over the two simulated years (${signedDelta}).`;
}

function buildClosingDiscussionQuestion(
  gameData: GameData,
  engine: GameEngine,
  voteResolutions?: VoteResolution[],
): ClosingDiscussionQuestion {
  const closest = voteResolutions && voteResolutions.length > 0 ? findClosestSplit(voteResolutions) : null;

  if (closest) {
    const quarter = requireQuarter(gameData, closest.quarterId);
    return {
      quarterId: quarter.id,
      quarterTitle: quarter.title,
      basis: "closest_vote_split",
      detail: `Q${quarter.id} ("${quarter.title}") had the closest vote split of the night: ${formatVoteCounts(closest.voteCounts)}.`,
    };
  }

  const contribution = findLargestEfContribution(gameData, engine);
  const quarter = requireQuarter(gameData, contribution.quarterId);
  const signedContribution = contribution.total > 0 ? `+${contribution.total}` : `${contribution.total}`;
  return {
    quarterId: quarter.id,
    quarterTitle: quarter.title,
    basis: "largest_ef_contribution",
    detail: `Q${quarter.id} ("${quarter.title}") made the largest single contribution to final ${gameData.meta.frictionDriftAppliesTo} (${signedContribution}).`,
  };
}

function requireQuarter(gameData: GameData, quarterId: number) {
  const quarter = gameData.quarters.find((q) => q.id === quarterId);
  if (!quarter) {
    throw new Error(`no quarter with id ${quarterId}`);
  }
  return quarter;
}

/** Smallest margin between a quarter's top and second vote counts; ties broken by earliest quarter. */
function findClosestSplit(voteResolutions: VoteResolution[]): VoteResolution | null {
  let best: { resolution: VoteResolution; margin: number } | null = null;

  for (const resolution of voteResolutions) {
    const counts = Object.values(resolution.voteCounts).filter((v): v is number => typeof v === "number");
    if (counts.length === 0) continue;
    const sorted = [...counts].sort((a, b) => b - a);
    const margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
    if (!best || margin < best.margin || (margin === best.margin && resolution.quarterId < best.resolution.quarterId)) {
      best = { resolution, margin };
    }
  }

  return best?.resolution ?? null;
}

/**
 * Per quarter, the chosen choice's immediate EF delta plus any EF-affecting delayed effects it
 * originated (regardless of which quarter they landed in). The quarter with the largest absolute
 * total is the fallback closing-discussion pick; ties broken by earliest quarter.
 */
function findLargestEfContribution(gameData: GameData, engine: GameEngine): { quarterId: number; total: number } {
  const efKpi = gameData.meta.frictionDriftAppliesTo;
  let best: { quarterId: number; total: number } | null = null;

  for (const result of engine.history) {
    const immediate = result.immediateDelta[efKpi] ?? 0;
    const originatedDelayed = gameData.delayedEffects
      .filter(
        (effect) =>
          effect.originQuarter === result.quarterId && effect.originChoice === result.choiceId && effect.kpi === efKpi,
      )
      .reduce((sum, effect) => sum + effect.delta, 0);
    const total = immediate + originatedDelayed;

    if (!best || Math.abs(total) > Math.abs(best.total)) {
      best = { quarterId: result.quarterId, total };
    }
  }

  if (!best) {
    throw new Error("cannot compute closing discussion fallback: no quarters were played");
  }
  return best;
}

function formatVoteCounts(voteCounts: VoteCounts): string {
  return Object.entries(voteCounts)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([choice, count]) => `${choice}:${count}`)
    .join(", ");
}
