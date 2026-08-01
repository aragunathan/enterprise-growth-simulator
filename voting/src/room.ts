import { randomUUID } from "node:crypto";
import {
  GameEngine,
  generateLayer1Report,
  type ChoiceId,
  type GameData,
  type KpiState,
  type Layer1Report,
  type Quarter,
  type QuarterResult,
  type VoteCounts,
  type VoteResolution,
} from "../../simulation/src/index.js";

export type Phase = "lobby" | "voting" | "closed" | "revealed" | "report";

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  quarter: Quarter | null;
  quarterNumber: number | null;
  totalQuarters: number;
  tally: VoteCounts;
  voteDeadline: number | null;
  voteTimerSeconds: number;
  lastResolution: VoteResolution | null;
  lastResult: QuarterResult | null;
  report: Layer1Report | null;
  playerCount: number;
  kpiState: KpiState;
}

/**
 * Owns one live game session: a GameEngine instance plus the voting/room
 * bookkeeping (phase, in-flight tally, connected players) needed to drive it
 * from Socket.io events. All KPI/tie-break logic is delegated to GameEngine —
 * this class never computes an outcome itself, only calls into the engine.
 */
export class Room {
  readonly code: string;
  readonly facilitatorToken: string;
  readonly gameData: GameData;
  readonly engine: GameEngine;

  phase: Phase = "lobby";
  votes = new Map<string, ChoiceId>();
  voteResolutions: VoteResolution[] = [];
  lastResolution: VoteResolution | null = null;
  lastResult: QuarterResult | null = null;
  report: Layer1Report | null = null;
  voteDeadline: number | null = null;
  timer: ReturnType<typeof setTimeout> | null = null;
  playerIds = new Set<string>();

  constructor(code: string, gameData: GameData) {
    this.code = code;
    this.facilitatorToken = randomUUID();
    this.gameData = gameData;
    this.engine = new GameEngine(gameData);
  }

  get currentQuarter(): Quarter | undefined {
    return this.engine.currentQuarter;
  }

  tally(): VoteCounts {
    const counts: VoteCounts = {};
    for (const choiceId of this.votes.values()) {
      counts[choiceId] = (counts[choiceId] ?? 0) + 1;
    }
    return counts;
  }

  castVote(socketId: string, choiceId: ChoiceId): void {
    if (this.phase !== "voting") {
      throw new Error("voting is not open for this quarter");
    }
    const quarter = this.engine.currentQuarter;
    if (!quarter || !quarter.choices.some((c) => c.id === choiceId)) {
      throw new Error(`"${choiceId}" is not a valid choice for the current quarter`);
    }
    this.votes.set(socketId, choiceId);
  }

  /** Opens voting on the current quarter with a fresh deadline. */
  startVoting(): void {
    if (this.engine.isComplete) {
      throw new Error("all quarters have already been played");
    }
    this.clearTimer();
    this.votes.clear();
    this.lastResolution = null;
    this.lastResult = null;
    this.phase = "voting";
    this.voteDeadline = Date.now() + this.gameData.meta.voteTimerSeconds * 1000;
  }

  /**
   * Stops accepting new votes and freezes the current tally. Idempotent —
   * returns whether this call actually transitioned the phase, so callers
   * (e.g. a manual close racing the auto-close timer) can avoid re-broadcasting.
   */
  closeVoting(): boolean {
    this.clearTimer();
    if (this.phase === "voting") {
      this.phase = "closed";
      return true;
    }
    return false;
  }

  /**
   * Resolves the frozen tally via GameEngine.applyVote (which internally uses
   * the engine's tieBreakPriority chain) and applies the winning choice.
   */
  reveal(): { resolution: VoteResolution; result: QuarterResult } {
    if (this.phase !== "voting" && this.phase !== "closed") {
      throw new Error(`cannot reveal from phase "${this.phase}"`);
    }
    this.closeVoting();

    const { resolution, result } = this.engine.applyVote(this.tally());
    this.voteResolutions.push(resolution);
    this.lastResolution = resolution;
    this.lastResult = result;
    this.phase = "revealed";

    if (this.engine.isComplete) {
      this.report = generateLayer1Report(this.gameData, this.engine, this.voteResolutions);
      this.phase = "report";
    }

    return { resolution, result };
  }

  /**
   * Emergency override: force the room forward from wherever it currently is,
   * for catastrophic connectivity failure. From "voting"/"closed" this closes
   * and reveals on the current (possibly empty) tally, then opens the next
   * quarter; from "revealed" it just opens the next quarter. Still routes
   * every outcome through reveal()/startVoting(), i.e. through the engine.
   */
  forceAdvance(): { resolution: VoteResolution; result: QuarterResult } | null {
    if (this.phase === "voting" || this.phase === "closed") {
      const outcome = this.reveal();
      if (!this.engine.isComplete) {
        this.startVoting();
      }
      return outcome;
    }
    if (this.phase === "revealed" && !this.engine.isComplete) {
      this.startVoting();
    }
    return null;
  }

  clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  toSnapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      quarter: this.currentQuarter ?? null,
      quarterNumber: this.currentQuarter?.id ?? null,
      totalQuarters: this.gameData.quarters.length,
      tally: this.tally(),
      voteDeadline: this.voteDeadline,
      voteTimerSeconds: this.gameData.meta.voteTimerSeconds,
      lastResolution: this.lastResolution,
      lastResult: this.lastResult,
      report: this.report,
      playerCount: this.playerIds.size,
      kpiState: this.engine.state,
    };
  }
}
