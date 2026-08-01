import type {
  AppliedDelayedEffect,
  ChoiceId,
  GameData,
  KpiId,
  KpiState,
  Quarter,
  QuarterResult,
  TieBreakRule,
  VoteCounts,
  VoteResolution,
} from "./types.js";

/**
 * Deterministic rules engine for the Enterprise Growth Simulator.
 *
 * Per quarter, in order: apply the chosen option's immediate KPI deltas,
 * apply any delayed effects whose target quarter has arrived, apply the
 * baseline Enterprise Friction drift, then clamp every KPI to its bounds.
 * Order between immediate/delayed/drift doesn't affect the result (all are
 * additive before the single end-of-quarter clamp) but is applied in this
 * sequence for traceability in QuarterResult.
 */
export class GameEngine {
  private readonly gameData: GameData;
  private _state: KpiState;
  private readonly choicesMade = new Map<number, ChoiceId>();
  private readonly quarterHistory: QuarterResult[] = [];
  private quarterCursor = 0;

  constructor(gameData: GameData) {
    this.gameData = gameData;
    this._state = GameEngine.buildBaselineState(gameData);
  }

  private static buildBaselineState(gameData: GameData): KpiState {
    const state = {} as KpiState;
    for (const def of gameData.meta.kpis) {
      state[def.id] = def.baseline;
    }
    return state;
  }

  /** The next quarter to be played, or undefined if the game is complete. */
  get currentQuarter(): Quarter | undefined {
    return this.gameData.quarters[this.quarterCursor];
  }

  get isComplete(): boolean {
    return this.quarterCursor >= this.gameData.quarters.length;
  }

  /** A snapshot copy of current KPI state. */
  get state(): KpiState {
    return { ...this._state };
  }

  get history(): readonly QuarterResult[] {
    return this.quarterHistory;
  }

  private requireCurrentQuarter(): Quarter {
    const quarter = this.currentQuarter;
    if (!quarter) {
      throw new Error("all quarters have already been played");
    }
    return quarter;
  }

  /**
   * Resolves which choice wins a quarter's vote, without applying it.
   * Ties are broken by walking meta.tieBreakPriority: at each step, keep only
   * the tied candidates whose immediate delta on that KPI is most favorable
   * (min/max per the rule's direction). If a tie survives the full chain,
   * falls back to the first-listed option among the remaining candidates.
   */
  resolveVote(voteCounts: VoteCounts): VoteResolution {
    const quarter = this.requireCurrentQuarter();
    const tallies = quarter.choices.map((c) => voteCounts[c.id] ?? 0);
    const maxVotes = Math.max(...tallies);
    let candidates = quarter.choices.filter((c) => (voteCounts[c.id] ?? 0) === maxVotes);
    const wasTie = candidates.length > 1;
    const tieBreakStepsUsed: TieBreakRule[] = [];
    let usedFinalFallback = false;

    if (wasTie) {
      for (const rule of this.gameData.meta.tieBreakPriority) {
        if (candidates.length <= 1) break;
        tieBreakStepsUsed.push(rule);
        const values = candidates.map((c) => c.immediate[rule.kpi] ?? 0);
        const target = rule.direction === "max" ? Math.max(...values) : Math.min(...values);
        candidates = candidates.filter((c) => (c.immediate[rule.kpi] ?? 0) === target);
      }
      if (candidates.length > 1) {
        usedFinalFallback = true;
        candidates = [candidates[0]!];
      }
    }

    return {
      quarterId: quarter.id,
      winner: candidates[0]!.id,
      voteCounts,
      wasTie,
      tieBreakStepsUsed,
      usedFinalFallback,
    };
  }

  /** Resolves the current quarter's vote and applies the winning choice. */
  applyVote(voteCounts: VoteCounts): { resolution: VoteResolution; result: QuarterResult } {
    const resolution = this.resolveVote(voteCounts);
    const result = this.applyChoice(resolution.winner);
    return { resolution, result };
  }

  /** Applies a specific choice to the current quarter (bypassing voting). */
  applyChoice(choiceId: ChoiceId): QuarterResult {
    const quarter = this.requireCurrentQuarter();
    const choice = quarter.choices.find((c) => c.id === choiceId);
    if (!choice) {
      throw new Error(`quarter ${quarter.id} has no choice "${choiceId}"`);
    }

    const kpiBefore = this.state;
    const working = { ...this._state };

    for (const [kpi, delta] of Object.entries(choice.immediate) as [KpiId, number][]) {
      working[kpi] += delta;
    }

    const appliedDelayedEffects: AppliedDelayedEffect[] = this.gameData.delayedEffects.filter(
      (effect) =>
        effect.targetQuarter === quarter.id && this.choicesMade.get(effect.originQuarter) === effect.originChoice,
    );
    for (const effect of appliedDelayedEffects) {
      working[effect.kpi] += effect.delta;
    }

    const frictionKpi = this.gameData.meta.frictionDriftAppliesTo;
    const frictionDrift = this.gameData.meta.frictionDriftPerQuarter;
    working[frictionKpi] += frictionDrift;

    const kpiAfterUnclamped = { ...working };
    const clampedKpis: KpiId[] = [];
    for (const def of this.gameData.meta.kpis) {
      const raw = working[def.id];
      const clamped = Math.min(def.max, Math.max(def.min, raw));
      if (clamped !== raw) clampedKpis.push(def.id);
      working[def.id] = clamped;
    }

    this._state = working;
    this.choicesMade.set(quarter.id, choiceId);
    this.quarterCursor += 1;

    const result: QuarterResult = {
      quarterId: quarter.id,
      choiceId,
      kpiBefore,
      immediateDelta: choice.immediate,
      appliedDelayedEffects,
      frictionDrift,
      kpiAfterUnclamped,
      kpiAfter: { ...working },
      clampedKpis,
    };
    this.quarterHistory.push(result);
    return result;
  }

  /** Convenience: play every quarter in order with a fixed choice per quarter. */
  playAll(choiceIds: ChoiceId[]): QuarterResult[] {
    if (choiceIds.length !== this.gameData.quarters.length) {
      throw new Error(
        `expected ${this.gameData.quarters.length} choices, one per quarter, got ${choiceIds.length}`,
      );
    }
    for (const choiceId of choiceIds) {
      this.applyChoice(choiceId);
    }
    return [...this.quarterHistory];
  }

  getFinalState(): KpiState {
    if (!this.isComplete) {
      throw new Error("cannot read final state before all quarters are played");
    }
    return this.state;
  }
}
