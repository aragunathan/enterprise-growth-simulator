import { describe, expect, it } from "vitest";
import { GameEngine, generateLayer1Report, loadGameData, type ChoiceId } from "../../simulation/src/index.js";
import { buildFallbackNarrative, generateLayer2Narrative, type AnthropicMessagesClient } from "../src/layer2.js";
import { Room } from "../src/room.js";

/** Plays all 8 quarters (plurality, no ties) so a real Layer1Report + vote history exist. */
function playFullGame() {
  const gameData = loadGameData();
  const engine = new GameEngine(gameData);
  const resolutions = [];
  const choices: ChoiceId[] = ["A", "B", "C", "D", "A", "B", "C", "D"];
  for (const choiceId of choices) {
    const { resolution } = engine.applyVote({ [choiceId]: 3 });
    resolutions.push(resolution);
  }
  const report = generateLayer1Report(gameData, engine, resolutions);
  return { gameData, engine, resolutions, report };
}

describe("generateLayer2Narrative", () => {
  it("returns the model's narrative on a normal successful generation", async () => {
    const { gameData, resolutions, report } = playFullGame();
    const fakeClient: AnthropicMessagesClient = {
      messages: {
        create: async (params) => {
          // The prompt must actually carry the report's real inputs.
          expect(params.messages[0]!.content).toContain(gameData.quarters[0]!.title);
          return {
            content: [
              {
                type: "text",
                text: `In ${gameData.quarters[0]!.title} and ${gameData.quarters[3]!.title}, the room made calls that shaped the rest of the run.`,
              },
            ],
          };
        },
      },
    };

    const narrative = await generateLayer2Narrative(gameData, resolutions, report, { client: fakeClient });

    expect(narrative).toBe(
      `In ${gameData.quarters[0]!.title} and ${gameData.quarters[3]!.title}, the room made calls that shaped the rest of the run.`,
    );
    expect(narrative).not.toBe(buildFallbackNarrative(gameData, report));
  });

  it("falls back to the real-numbers template on a forced failure (never rejects, never returns placeholder text)", async () => {
    const { gameData, resolutions, report } = playFullGame();
    const throwingClient: AnthropicMessagesClient = {
      messages: {
        create: async () => {
          throw new Error("simulated API failure");
        },
      },
    };

    const narrative = await generateLayer2Narrative(gameData, resolutions, report, { client: throwingClient });

    const expectedFallback = buildFallbackNarrative(gameData, report);
    expect(narrative).toBe(expectedFallback);
    expect(narrative).not.toMatch(/not yet wired up/i);
    // The fallback must be filled with the real computed numbers, not a placeholder.
    const rg = report.scorecard.find((e) => e.kpi === "RG")!;
    const ef = report.scorecard.find((e) => e.kpi === "EF")!;
    expect(narrative).toContain(String(rg.final));
    expect(narrative).toContain(String(ef.final));
  });

  it("falls back to the real-numbers template on a forced timeout, without waiting for the slow call", async () => {
    const { gameData, resolutions, report } = playFullGame();
    let slowCallResolved = false;
    const slowClient: AnthropicMessagesClient = {
      messages: {
        create: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              slowCallResolved = true;
              resolve({ content: [{ type: "text", text: "too slow to matter" }] });
            }, 200);
          }),
      },
    };

    const start = Date.now();
    const narrative = await generateLayer2Narrative(gameData, resolutions, report, {
      client: slowClient,
      timeoutMs: 20,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(150);
    expect(slowCallResolved).toBe(false);
    expect(narrative).toBe(buildFallbackNarrative(gameData, report));
  });

  it("falls back when the model responds with empty text", async () => {
    const { gameData, resolutions, report } = playFullGame();
    const emptyClient: AnthropicMessagesClient = {
      messages: { create: async () => ({ content: [{ type: "text", text: "   " }] }) },
    };

    const narrative = await generateLayer2Narrative(gameData, resolutions, report, { client: emptyClient });

    expect(narrative).toBe(buildFallbackNarrative(gameData, report));
  });
});

describe("Room wiring — the narrative is triggered inside reveal(), not on request", () => {
  it("kicks off room.layer2Narrative the instant the final quarter's vote resolves, resolving to the success text", async () => {
    const gameData = loadGameData();
    const room = new Room("TEST", gameData, {
      client: {
        messages: {
          create: async () => ({ content: [{ type: "text", text: "The room closed strong." }] }),
        },
      },
    });

    for (let i = 0; i < gameData.quarters.length; i++) {
      room.startVoting();
      room.castVote(`socket-${i}`, "A");
      room.closeVoting();
      // layer2Narrative must not exist until the *final* quarter's reveal.
      if (i < gameData.quarters.length - 1) {
        expect(room.layer2Narrative).toBeNull();
      }
      room.reveal();
    }

    expect(room.phase).toBe("report");
    expect(room.layer2Narrative).not.toBeNull();
    await expect(room.layer2Narrative).resolves.toBe("The room closed strong.");
  });

  it("kicks off the promise before reveal() returns, so it's already in flight before any reveal-screen broadcast", () => {
    const gameData = loadGameData();
    let callStarted = false;
    const room = new Room("TEST", gameData, {
      client: {
        messages: {
          create: async () => {
            callStarted = true;
            return { content: [{ type: "text", text: "narrative" }] };
          },
        },
      },
      timeoutMs: 10_000,
    });

    for (let i = 0; i < gameData.quarters.length; i++) {
      room.startVoting();
      room.castVote(`socket-${i}`, "A");
      room.closeVoting();
      room.reveal();
    }

    // Synchronous assertion, right after reveal() returns and before any awaiting —
    // proves the API call was fired inside reveal(), not deferred to report-request time.
    expect(callStarted).toBe(true);
  });
});
