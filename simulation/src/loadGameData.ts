import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { GameData } from "./types.js";

const DEFAULT_GAME_DATA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "game-data.json",
);

/**
 * Loads and validates game-data.json. Defaults to the repo's docs/game-data.json
 * but accepts an explicit path (used by tests to load fixtures).
 */
export function loadGameData(path: string = DEFAULT_GAME_DATA_PATH): GameData {
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as GameData;
  validateGameData(data);
  return data;
}

function validateGameData(data: GameData): void {
  if (!data.meta || !Array.isArray(data.meta.kpis) || data.meta.kpis.length === 0) {
    throw new Error("game data is missing meta.kpis");
  }
  if (!Array.isArray(data.quarters) || data.quarters.length === 0) {
    throw new Error("game data is missing quarters");
  }
  if (!Array.isArray(data.delayedEffects)) {
    throw new Error("game data is missing delayedEffects");
  }
  if (!Array.isArray(data.meta.tieBreakPriority) || data.meta.tieBreakPriority.length === 0) {
    throw new Error("game data is missing meta.tieBreakPriority");
  }

  const kpiIds = new Set(data.meta.kpis.map((k) => k.id));

  for (const quarter of data.quarters) {
    if (!Array.isArray(quarter.choices) || quarter.choices.length === 0) {
      throw new Error(`quarter ${quarter.id} has no choices`);
    }
    for (const choice of quarter.choices) {
      for (const kpi of Object.keys(choice.immediate)) {
        if (!kpiIds.has(kpi as never)) {
          throw new Error(`quarter ${quarter.id} choice ${choice.id} references unknown KPI "${kpi}"`);
        }
      }
    }
  }

  for (const effect of data.delayedEffects) {
    if (!kpiIds.has(effect.kpi)) {
      throw new Error(`delayed effect from Q${effect.originQuarter}/${effect.originChoice} references unknown KPI "${effect.kpi}"`);
    }
    if (effect.targetQuarter <= effect.originQuarter) {
      throw new Error(
        `delayed effect from Q${effect.originQuarter}/${effect.originChoice} targets Q${effect.targetQuarter}, which is not after its origin`,
      );
    }
  }
}
