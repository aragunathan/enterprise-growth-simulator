import type { ChoiceId, KpiState } from "../../src/types.js";

export interface Playthrough {
  name: string;
  choices: ChoiceId[];
  expectedFinal: KpiState;
}

/**
 * Two hand-verified playthroughs supplied as regression fixtures. The engine
 * must reproduce these exact final KPI values.
 */
export const PLAYTHROUGHS: Playthrough[] = [
  {
    name: "all quarters choice A",
    choices: ["A", "A", "A", "A", "A", "A", "A", "A"],
    expectedFinal: {
      RG: 95,
      Cash: 0,
      EE: 45,
      CX: 75,
      Comp: 100,
      Innov: 25,
      DV: 75,
      EF: 14,
    },
  },
  {
    name: "C,A,C,C,A,B,A,C",
    choices: ["C", "A", "C", "C", "A", "B", "A", "C"],
    expectedFinal: {
      RG: 95,
      Cash: 5,
      EE: 45,
      CX: 65,
      Comp: 100,
      Innov: 45,
      DV: 60,
      EF: 14,
    },
  },
];
