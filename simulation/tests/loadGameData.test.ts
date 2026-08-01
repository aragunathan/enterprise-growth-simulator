import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameData } from "../src/loadGameData.js";

describe("loadGameData — real docs/game-data.json", () => {
  it("loads and exposes the documented meta values the engine depends on", () => {
    const data = loadGameData();

    expect(data.meta.kpis).toHaveLength(8);
    expect(data.meta.frictionDriftPerQuarter).toBe(3);
    expect(data.meta.frictionDriftAppliesTo).toBe("EF");
    expect(data.meta.tieBreakPriority[0]).toEqual({ kpi: "EF", direction: "min" });
    expect(data.meta.tieBreakFinalFallback).toBe("first_listed_option");
    expect(data.quarters).toHaveLength(8);
    expect(data.delayedEffects.length).toBeGreaterThan(0);
  });
});

describe("loadGameData — validation", () => {
  function writeTempJson(content: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "egs-loadGameData-test-"));
    const path = join(dir, "game-data.json");
    writeFileSync(path, JSON.stringify(content));
    return path;
  }

  it("throws when quarters is missing", () => {
    const path = writeTempJson({
      meta: { kpis: [{ id: "X", baseline: 0, min: 0, max: 100 }], tieBreakPriority: [{ kpi: "X", direction: "max" }] },
      delayedEffects: [],
    });
    expect(() => loadGameData(path)).toThrow(/quarters/);
  });

  it("throws when a choice references an unknown KPI", () => {
    const path = writeTempJson({
      meta: {
        kpis: [{ id: "X", baseline: 0, min: 0, max: 100 }],
        tieBreakPriority: [{ kpi: "X", direction: "max" }],
      },
      quarters: [{ id: 1, choices: [{ id: "A", immediate: { UNKNOWN: 5 } }] }],
      delayedEffects: [],
    });
    expect(() => loadGameData(path)).toThrow(/unknown KPI/);
  });

  it("throws when a delayed effect targets a quarter at or before its origin", () => {
    const path = writeTempJson({
      meta: {
        kpis: [{ id: "X", baseline: 0, min: 0, max: 100 }],
        tieBreakPriority: [{ kpi: "X", direction: "max" }],
      },
      quarters: [{ id: 1, choices: [{ id: "A", immediate: {} }] }],
      delayedEffects: [{ originQuarter: 2, originChoice: "A", targetQuarter: 2, kpi: "X", delta: 1 }],
    });
    expect(() => loadGameData(path)).toThrow(/not after its origin/);
  });
});
