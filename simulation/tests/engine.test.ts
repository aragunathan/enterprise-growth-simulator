import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine.js";
import { loadGameData } from "../src/loadGameData.js";
import { MINI_GAME_DATA } from "./fixtures/miniGameData.js";
import { PLAYTHROUGHS } from "./fixtures/playthroughs.js";

describe("GameEngine — regression fixtures (real game data)", () => {
  const gameData = loadGameData();

  for (const playthrough of PLAYTHROUGHS) {
    it(`reproduces the verified playthrough: ${playthrough.name}`, () => {
      const engine = new GameEngine(gameData);
      engine.playAll(playthrough.choices);

      expect(engine.isComplete).toBe(true);
      expect(engine.getFinalState()).toEqual(playthrough.expectedFinal);
    });
  }

  it("exposes the friction KPI drifting by frictionDriftPerQuarter every quarter even with no other deltas", () => {
    const engine = new GameEngine(gameData);
    const results = engine.playAll(["A", "A", "A", "A", "A", "A", "A", "A"]);
    for (const result of results) {
      expect(result.frictionDrift).toBe(gameData.meta.frictionDriftPerQuarter);
    }
  });
});

describe("GameEngine — immediate deltas", () => {
  it("applies the chosen option's immediate deltas plus friction drift", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    const result = engine.applyChoice("A");

    // X: 50 + 10 = 60 (no drift applies to X)
    // Y: 50 + 0 (no delta) + 2 (drift) = 52
    expect(result.kpiAfter).toEqual({ X: 60, Y: 52 });
    expect(result.kpiBefore).toEqual({ X: 50, Y: 50 });
    expect(result.immediateDelta).toEqual({ X: 10 });
    expect(result.clampedKpis).toEqual([]);
  });

  it("advances currentQuarter and reports completion correctly", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    expect(engine.currentQuarter?.id).toBe(1);
    expect(engine.isComplete).toBe(false);

    engine.applyChoice("A");
    expect(engine.currentQuarter?.id).toBe(2);

    engine.applyChoice("A");
    expect(engine.currentQuarter?.id).toBe(3);

    engine.applyChoice("B");
    expect(engine.currentQuarter).toBeUndefined();
    expect(engine.isComplete).toBe(true);
  });
});

describe("GameEngine — delayed effects", () => {
  it("applies a delayed effect only when its origin choice was actually taken", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.applyChoice("A"); // Q1: X=60, Y=52 (origin for the Q1->Q2 delayed effect on Y)
    const q2Result = engine.applyChoice("A"); // Q2: no immediate delta

    // Y: 52 + 20 (delayed effect from Q1 choice A) + 2 (drift) = 74
    expect(q2Result.kpiAfter.Y).toBe(74);
    expect(q2Result.appliedDelayedEffects).toHaveLength(1);
    expect(q2Result.appliedDelayedEffects[0]?.originChoice).toBe("A");
  });

  it("does not apply a delayed effect when a different choice was taken at its origin quarter", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.applyChoice("B"); // Q1: X=60, Y=52, but origin choice is B, not A
    const q2Result = engine.applyChoice("A"); // Q2: no immediate delta

    // Y: 52 + 2 (drift only, no delayed effect) = 54
    expect(q2Result.kpiAfter.Y).toBe(54);
    expect(q2Result.appliedDelayedEffects).toHaveLength(0);
  });
});

describe("GameEngine — clamping", () => {
  it("clamps every KPI to its min/max after the quarter's deltas are applied", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.applyChoice("B"); // Q1
    engine.applyChoice("A"); // Q2
    const q3Result = engine.applyChoice("A"); // Q3: X +1000, Y -1000 (will blow through both bounds)

    expect(q3Result.kpiAfterUnclamped.X).toBeGreaterThan(100);
    expect(q3Result.kpiAfterUnclamped.Y).toBeLessThan(0);
    expect(q3Result.kpiAfter).toEqual({ X: 100, Y: 0 });
    expect(q3Result.clampedKpis.sort()).toEqual(["X", "Y"]);
  });
});

describe("GameEngine — vote resolution and tie-breaking", () => {
  it("picks the clear plurality winner without invoking tie-break rules", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    const resolution = engine.resolveVote({ A: 5, B: 1, C: 1, D: 1 });

    expect(resolution.winner).toBe("A");
    expect(resolution.wasTie).toBe(false);
    expect(resolution.tieBreakStepsUsed).toEqual([]);
    expect(resolution.usedFinalFallback).toBe(false);
  });

  it("breaks a tie using the first tieBreakPriority rule when it discriminates", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    // A has X:10 (better under "X max"), C has no X delta (0)
    const resolution = engine.resolveVote({ A: 2, C: 2 });

    expect(resolution.winner).toBe("A");
    expect(resolution.wasTie).toBe(true);
    expect(resolution.tieBreakStepsUsed).toEqual([{ kpi: "X", direction: "max" }]);
    expect(resolution.usedFinalFallback).toBe(false);
  });

  it("cascades to the second tieBreakPriority rule when the first doesn't discriminate", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    // C and D both have no X delta (tied on rule 1); C has Y:-5, D has Y:5 — "Y min" favors C
    const resolution = engine.resolveVote({ C: 2, D: 2 });

    expect(resolution.winner).toBe("C");
    expect(resolution.tieBreakStepsUsed).toEqual([
      { kpi: "X", direction: "max" },
      { kpi: "Y", direction: "min" },
    ]);
    expect(resolution.usedFinalFallback).toBe(false);
  });

  it("falls back to the first-listed option when the entire tie-break chain doesn't discriminate", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    // A and B are identical on both X and Y deltas — chain exhausts without a winner
    const resolution = engine.resolveVote({ A: 3, B: 3 });

    expect(resolution.winner).toBe("A");
    expect(resolution.usedFinalFallback).toBe(true);
  });

  it("applyVote resolves and applies the winning choice in one step", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    const { resolution, result } = engine.applyVote({ A: 5, B: 1, C: 1, D: 1 });

    expect(resolution.winner).toBe("A");
    expect(result.choiceId).toBe("A");
    expect(engine.currentQuarter?.id).toBe(2);
  });
});

describe("GameEngine — error handling", () => {
  it("throws when applying a choice after the game is already complete", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.playAll(["A", "A", "A"]);
    expect(() => engine.applyChoice("A")).toThrow(/already been played/);
  });

  it("throws when applying an unknown choice id for the current quarter", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    // @ts-expect-error deliberately invalid choice id
    expect(() => engine.applyChoice("Z")).toThrow(/no choice/);
  });

  it("throws when playAll is given the wrong number of choices", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    expect(() => engine.playAll(["A", "A"])).toThrow(/expected 3 choices/);
  });

  it("throws when reading final state before the game is complete", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.applyChoice("A");
    expect(() => engine.getFinalState()).toThrow(/before all quarters/);
  });
});
