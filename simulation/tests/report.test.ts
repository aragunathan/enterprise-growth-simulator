import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine.js";
import { loadGameData } from "../src/loadGameData.js";
import { generateLayer1Report } from "../src/report.js";
import { MINI_GAME_DATA } from "./fixtures/miniGameData.js";
import type { VoteResolution } from "../src/types.js";

describe("generateLayer1Report — mechanics (mini game data)", () => {
  it("throws if the game isn't complete yet", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.applyChoice("A");
    expect(() => generateLayer1Report(MINI_GAME_DATA, engine)).toThrow(/before all quarters/);
  });

  it("builds a headline comparing final Y (the friction KPI) to baseline", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.playAll(["B", "A", "B"]); // Y: 50 -> 52 -> 54 -> 56 (no delayed effect, drift only)
    const report = generateLayer1Report(MINI_GAME_DATA, engine);

    expect(report.headline).toContain("Metric Y");
    expect(report.headline).toContain("50");
    expect(report.headline).toContain("56");
  });

  it("produces a full scorecard with baseline, final, and delta for every KPI", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.playAll(["A", "A", "B"]);
    const report = generateLayer1Report(MINI_GAME_DATA, engine);

    expect(report.scorecard).toHaveLength(MINI_GAME_DATA.meta.kpis.length);
    const xEntry = report.scorecard.find((e) => e.kpi === "X");
    expect(xEntry).toMatchObject({ baseline: 50 });
    expect(xEntry?.delta).toBe(xEntry!.final - xEntry!.baseline);
  });

  it("returns the top N biggest swings per report.layer1_deterministic.biggestSwingsCount, sorted by magnitude", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    engine.playAll(["B", "A", "B"]); // X moves +10 (Q1 only), Y drifts +6 over 3 quarters (drift only)
    const report = generateLayer1Report(MINI_GAME_DATA, engine);

    expect(report.biggestSwings).toHaveLength(MINI_GAME_DATA.report.layer1_deterministic.biggestSwingsCount);
    for (let i = 1; i < report.biggestSwings.length; i++) {
      expect(Math.abs(report.biggestSwings[i - 1]!.delta)).toBeGreaterThanOrEqual(
        Math.abs(report.biggestSwings[i]!.delta),
      );
    }
  });

  it("picks the closing discussion question from the closest vote split when vote data is supplied", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    const voteResolutions: VoteResolution[] = [];
    voteResolutions.push(engine.applyVote({ A: 10, B: 9, C: 1 }).resolution); // Q1: margin 1 (closest)
    voteResolutions.push(engine.applyVote({ A: 15, B: 1 }).resolution); // Q2: margin 14
    voteResolutions.push(engine.applyVote({ A: 20 }).resolution); // Q3: margin 20

    const report = generateLayer1Report(MINI_GAME_DATA, engine, voteResolutions);
    expect(report.closingDiscussionQuestion.basis).toBe("closest_vote_split");
    expect(report.closingDiscussionQuestion.quarterId).toBe(1);
  });

  it("falls back to the quarter with the largest single contribution to final friction when no vote data is supplied", () => {
    const engine = new GameEngine(MINI_GAME_DATA);
    // Q1 choice A contributes 0 directly to Y, but originates the Q1->Q2 delayed effect of +20 on Y —
    // by far the largest single EF-equivalent contribution among the three quarters.
    engine.playAll(["A", "A", "B"]);

    const report = generateLayer1Report(MINI_GAME_DATA, engine);
    expect(report.closingDiscussionQuestion.basis).toBe("largest_ef_contribution");
    expect(report.closingDiscussionQuestion.quarterId).toBe(1);
  });
});

describe("generateLayer1Report — real game data smoke test", () => {
  it("produces a coherent report for a full real playthrough", () => {
    const gameData = loadGameData();
    const engine = new GameEngine(gameData);
    engine.playAll(["A", "A", "A", "A", "A", "A", "A", "A"]);

    const report = generateLayer1Report(gameData, engine);

    expect(report.headline).toContain("Enterprise Friction");
    expect(report.scorecard).toHaveLength(8);
    expect(report.biggestSwings).toHaveLength(gameData.report.layer1_deterministic.biggestSwingsCount);
    expect(report.closingDiscussionQuestion.quarterId).toBeGreaterThanOrEqual(1);
    expect(report.closingDiscussionQuestion.quarterId).toBeLessThanOrEqual(8);
  });
});
