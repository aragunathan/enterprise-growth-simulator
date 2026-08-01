import { describe, expect, it } from "vitest";
import { loadGameData } from "../../simulation/src/index.js";
import { Room } from "../src/room.js";

describe("Room.closeVoting — idempotency guard", () => {
  it("returns true the first time it closes an open vote, false on every call after", () => {
    const room = new Room("TEST", loadGameData());
    room.startVoting();

    expect(room.phase).toBe("voting");
    expect(room.closeVoting()).toBe(true);
    expect(room.phase).toBe("closed");

    // Simulates a manual "close early" racing an already-fired auto-close timer:
    // whichever call arrives second must be a no-op, so app.ts knows not to
    // re-broadcast "vote:closed" a second time.
    expect(room.closeVoting()).toBe(false);
    expect(room.closeVoting()).toBe(false);
  });

  it("returns false when called before voting ever opened", () => {
    const room = new Room("TEST", loadGameData());
    expect(room.phase).toBe("lobby");
    expect(room.closeVoting()).toBe(false);
  });
});
