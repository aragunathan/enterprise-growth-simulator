import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioc, type Socket } from "socket.io-client";
import { createApp } from "../src/app.js";
import {
  GameEngine,
  generateLayer1Report,
  loadGameData,
  type ChoiceId,
  type VoteResolution,
} from "../../simulation/src/index.js";

function once(socket: Socket, event: string): Promise<any> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket: Socket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe("voting layer e2e (real Socket.io connections, simulating separate browser tabs)", () => {
  let handle: ReturnType<typeof createApp>;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    handle = createApp();
    await new Promise<void>((resolve) => handle.httpServer.listen(0, resolve));
    const port = (handle.httpServer.address() as AddressInfo).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await new Promise<void>((resolve) => handle.httpServer.close(() => resolve()));
  });

  function connect(): Socket {
    const s = ioc(baseUrl, { transports: ["websocket"], forceNew: true });
    sockets.push(s);
    return s;
  }

  it("plays a full 8-quarter game through independent client connections, deferring every vote resolution (including an engineered tie) to GameEngine", async () => {
    const facilitator = connect();
    const screen = connect();
    const players = [connect(), connect(), connect(), connect(), connect()];
    await Promise.all([facilitator, screen, ...players].map((s) => once(s, "connect")));

    const created = await emitAck(facilitator, "room:create", {});
    expect(created.ok).toBe(true);
    const { code, facilitatorToken } = created;
    expect(created.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(created.voteUrl).toContain(`/vote/${code}`);

    const facJoin = await emitAck(facilitator, "room:join", { code, role: "facilitator", facilitatorToken });
    expect(facJoin.ok).toBe(true);
    await emitAck(screen, "room:join", { code, role: "screen" });
    for (const p of players) {
      const res = await emitAck(p, "room:join", { code, role: "player" });
      expect(res.ok).toBe(true);
    }

    // A scratch GameEngine kept one quarter in lockstep with the room's server-side
    // engine, used only to independently compute what the *real* engine would resolve
    // each tally to — the test then asserts the server reports exactly that, proving
    // the voting layer calls into GameEngine rather than re-deriving the outcome itself.
    const gameData = loadGameData();
    const referenceEngine = new GameEngine(gameData);
    const collectedResolutions: VoteResolution[] = [];

    // 5 players' choice per quarter. Q1 is engineered so B and D tie at 2 votes each:
    // both have EF:+5 (ties on the first tieBreakPriority rule), so the chain must
    // cascade to the second rule (Cash, max) — B:0 beats D:-10 — to produce a winner.
    const votePlan: ChoiceId[][] = [
      ["B", "B", "D", "D", "C"],
      ["A", "A", "A", "B", "C"],
      ["C", "C", "C", "A", "D"],
      ["A", "A", "B", "C", "D"],
      ["D", "D", "D", "A", "B"],
      ["A", "B", "C", "D", "A"],
      ["C", "C", "A", "B", "D"],
      ["A", "A", "D", "B", "C"],
    ];

    let quarterStartPromise = once(screen, "quarter:start");
    const startRes = await emitAck(facilitator, "facilitator:startGame", { code, facilitatorToken });
    expect(startRes.ok).toBe(true);

    for (let q = 0; q < votePlan.length; q++) {
      const quarterStart = await quarterStartPromise;
      expect(quarterStart.quarterNumber).toBe(q + 1);

      const votes = votePlan[q]!;
      for (let i = 0; i < players.length; i++) {
        const res = await emitAck(players[i]!, "vote:cast", { choiceId: votes[i] });
        expect(res.ok).toBe(true);
      }

      const tally: Partial<Record<ChoiceId, number>> = {};
      for (const v of votes) tally[v] = (tally[v] ?? 0) + 1;
      const expectedResolution = referenceEngine.resolveVote(tally);

      await emitAck(facilitator, "facilitator:closeVote", { code, facilitatorToken });

      const revealPromise = once(screen, "vote:revealed");
      const isLastQuarter = q === votePlan.length - 1;
      const reportPromise = isLastQuarter ? once(screen, "game:report") : null;

      const revealRes = await emitAck(facilitator, "facilitator:revealResult", { code, facilitatorToken });
      expect(revealRes.ok).toBe(true);
      const revealed = await revealPromise;

      expect(revealed.resolution.winner).toBe(expectedResolution.winner);
      expect(revealed.resolution.wasTie).toBe(expectedResolution.wasTie);
      expect(revealed.resolution.tieBreakStepsUsed).toEqual(expectedResolution.tieBreakStepsUsed);
      expect(revealed.resolution.usedFinalFallback).toBe(expectedResolution.usedFinalFallback);
      collectedResolutions.push(revealed.resolution);

      if (q === 0) {
        // Confirm the engineered tie actually exercised the multi-step cascade.
        // Q1's 2-2 tie is also, by construction, the closest possible vote split
        // (margin 0, the minimum any quarter can have) — so it must drive the
        // Q8 report's closing discussion question, asserted below.
        expect(expectedResolution.wasTie).toBe(true);
        expect(expectedResolution.winner).toBe("B");
        expect(expectedResolution.tieBreakStepsUsed.map((r: { kpi: string }) => r.kpi)).toEqual(["EF", "Cash"]);
        expect(expectedResolution.usedFinalFallback).toBe(false);
      }

      referenceEngine.applyChoice(expectedResolution.winner);

      if (!isLastQuarter) {
        quarterStartPromise = once(screen, "quarter:start");
        const nextRes = await emitAck(facilitator, "facilitator:nextQuarter", { code, facilitatorToken });
        expect(nextRes.ok).toBe(true);
      } else {
        const report = await reportPromise!;
        expect(report.report.scorecard).toHaveLength(8);
        expect(report.layer2Placeholder).toMatch(/not yet wired up/i);

        const finalFromServer: Record<string, number> = {};
        for (const entry of report.report.scorecard as { kpi: string; final: number }[]) {
          finalFromServer[entry.kpi] = entry.final;
        }
        expect(finalFromServer).toEqual(referenceEngine.getFinalState());

        // Rebuild the report independently (same generateLayer1Report the server calls,
        // fed the vote-resolution history the server itself broadcast) and confirm the
        // closing discussion question — not just headline/scorecard/report *presence* —
        // matches exactly. This is what proves it picked the right quarter, not just any.
        const expectedReport = generateLayer1Report(gameData, referenceEngine, collectedResolutions);
        expect(report.report.closingDiscussionQuestion).toEqual(expectedReport.closingDiscussionQuestion);
        expect(report.report.closingDiscussionQuestion.basis).toBe("closest_vote_split");
        expect(report.report.closingDiscussionQuestion.quarterId).toBe(1); // Q1's 2-2 tie is the closest split
        expect(report.report.headline).toBe(expectedReport.headline);
        expect(report.report.biggestSwings).toEqual(expectedReport.biggestSwings);
      }
    }
  });

  it("resolves a fully-tied, zero-vote quarter without a quorum and lets the facilitator force-advance", async () => {
    const facilitator = connect();
    const screen = connect();
    await Promise.all([facilitator, screen].map((s) => once(s, "connect")));

    const created = await emitAck(facilitator, "room:create", {});
    const { code, facilitatorToken } = created;
    await emitAck(facilitator, "room:join", { code, role: "facilitator", facilitatorToken });
    await emitAck(screen, "room:join", { code, role: "screen" });

    const referenceEngine = new GameEngine(loadGameData());
    const expectedResolution = referenceEngine.resolveVote({});

    const quarterStartPromise = once(screen, "quarter:start");
    await emitAck(facilitator, "facilitator:startGame", { code, facilitatorToken });
    await quarterStartPromise;

    // No player ever votes — plurality-of-zero, full tie across all 4 choices.
    const revealPromise = once(screen, "vote:revealed");
    const nextQuarterPromise = once(screen, "quarter:start");
    const forceRes = await emitAck(facilitator, "facilitator:forceAdvance", { code, facilitatorToken });
    expect(forceRes.ok).toBe(true);

    const revealed = await revealPromise;
    expect(revealed.resolution.winner).toBe(expectedResolution.winner);
    expect(revealed.resolution.wasTie).toBe(true);
    expect(revealed.resolution.usedFinalFallback).toBe(expectedResolution.usedFinalFallback);

    const nextQuarter = await nextQuarterPromise;
    expect(nextQuarter.quarterNumber).toBe(2);
  });

  describe("vote timer (real elapsed time, not mocked — voteTimerSeconds shortened for test speed)", () => {
    // A separate app instance per test, built on gameData with a 1-second vote timer
    // instead of the real 20s, so these tests exercise the exact same unmocked
    // setTimeout path in app.ts without spending 20 real seconds per test run.
    function shortTimerGameData() {
      const gameData = loadGameData();
      return { ...gameData, meta: { ...gameData.meta, voteTimerSeconds: 1 } };
    }

    async function startShortTimerRoom() {
      const shortHandle = createApp({ gameData: shortTimerGameData() });
      await new Promise<void>((resolve) => shortHandle.httpServer.listen(0, resolve));
      const port = (shortHandle.httpServer.address() as AddressInfo).port;
      const shortBaseUrl = `http://localhost:${port}`;

      const facilitator = ioc(shortBaseUrl, { transports: ["websocket"], forceNew: true });
      const screen = ioc(shortBaseUrl, { transports: ["websocket"], forceNew: true });
      sockets.push(facilitator, screen);
      await Promise.all([facilitator, screen].map((s) => once(s, "connect")));

      const created = await emitAck(facilitator, "room:create", {});
      const { code, facilitatorToken } = created;
      await emitAck(facilitator, "room:join", { code, role: "facilitator", facilitatorToken });
      await emitAck(screen, "room:join", { code, role: "screen" });

      return { shortHandle, facilitator, screen, code, facilitatorToken };
    }

    it("auto-closes the vote by itself once the real timer expires, with no manual close", async () => {
      const { shortHandle, facilitator, screen, code, facilitatorToken } = await startShortTimerRoom();
      try {
        const quarterStartPromise = once(screen, "quarter:start");
        await emitAck(facilitator, "facilitator:startGame", { code, facilitatorToken });
        await quarterStartPromise;

        // Still open well before the 1s deadline — nobody has closed it.
        let closedEarly = false;
        const earlyListener = () => (closedEarly = true);
        screen.once("vote:closed", earlyListener);
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(closedEarly).toBe(false);
        screen.off("vote:closed", earlyListener);

        // Wait out the real remainder of the timer — nobody calls facilitator:closeVote.
        const autoClosed = await once(screen, "vote:closed");
        expect(autoClosed.auto).toBe(true);
      } finally {
        // httpServer.close()'s callback only fires once all connections are closed;
        // Socket.io connections are kept alive, so the sockets must be closed first
        // or this hangs until the suite's outer timeout.
        facilitator.close();
        screen.close();
        await new Promise<void>((resolve) => shortHandle.httpServer.close(() => resolve()));
      }
    });

    it("does not double-broadcast vote:closed when a manual close arrives just after the auto-close timer fires", async () => {
      const { shortHandle, facilitator, screen, code, facilitatorToken } = await startShortTimerRoom();
      try {
        const quarterStartPromise = once(screen, "quarter:start");
        await emitAck(facilitator, "facilitator:startGame", { code, facilitatorToken });
        await quarterStartPromise;

        let closedEvents = 0;
        screen.on("vote:closed", () => closedEvents++);

        // Wait past the 1s deadline so the auto-close has already fired server-side...
        await new Promise((resolve) => setTimeout(resolve, 1100));
        expect(closedEvents).toBe(1);

        // ...then race a manual close against it. Room.closeVoting()'s idempotency
        // guard (see room.test.ts) means app.ts must not re-broadcast.
        const closeRes = await emitAck(facilitator, "facilitator:closeVote", { code, facilitatorToken });
        expect(closeRes.ok).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(closedEvents).toBe(1);
      } finally {
        facilitator.close();
        screen.close();
        await new Promise<void>((resolve) => shortHandle.httpServer.close(() => resolve()));
      }
    });
  });
});
